import test, { after, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { createVehicle, listOwnVehicles, updateOwnVehicle } from "../src/vehicles/vehicle-service.js";
import type { RouteCandidate, RouteComputationRequest } from "../src/maps/types.js";
import { runTripsSweep } from "../src/modules/trips/sweeper.js";
import * as S from "./trips-support.js";

/**
 * Lado conductor (pantallas 17–20): requisitos de publicación, planificador con verificación de provincia POR PARADA,
 * «Guardar ruta» (viaje puntual y serie semanal), puerta de publicación y bandeja de solicitudes.
 * Base de datos propia: mvc_trips.
 */
let pool: pg.Pool;
let app: FastifyInstance;
let routeProvider: S.FakeRouteProvider;
let geocoder: S.FakeGeocoder;
let w: S.World;
let tokens: { ana: string; miguel: string; laura: string };

/** Proveedor cuyas rutas «se salen» de la provincia por el oeste (lng < -6,6) aunque origen y destino estén dentro. */
class LeakyRouteProvider extends S.FakeRouteProvider {
  override async computeRoutes(request: RouteComputationRequest): Promise<RouteCandidate[]> {
    const routes = await super.computeRoutes(request);
    return routes.map(route => ({
      ...route,
      geometry: {
        type: "LineString" as const,
        coordinates: [route.geometry.coordinates[0]!, [-7.2, 37.3], route.geometry.coordinates[route.geometry.coordinates.length - 1]!]
      }
    }));
  }
}

before(async () => {
  pool = S.createPool();
  routeProvider = new S.FakeRouteProvider();
  geocoder = new S.FakeGeocoder();
  app = await S.buildTripsApp(pool, { routeProvider, geocodingProvider: geocoder });
});

beforeEach(async () => {
  await S.truncateAll(pool);
  routeProvider.calls = [];
  geocoder.queries = [];
  w = await S.seedWorld(pool);
  tokens = {
    ana: await S.sessionTokenFor(pool, w.ana),
    miguel: await S.sessionTokenFor(pool, w.miguel),
    laura: await S.sessionTokenFor(pool, w.laura)
  };
});

after(async () => {
  await app.close();
  await pool.end();
});

const tomorrow = (): string => S.addDaysIso(S.madrid(new Date()).date, 1);

function routeBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    vehicleId: w.vehicleId, provinceId: w.provinceId, category: "work",
    origin: { lat: S.SEVILLA.palomares.lat, lng: S.SEVILLA.palomares.lng, label: "Palomares del Río" },
    destination: { lat: S.SEVILLA.trabajo.lat, lng: S.SEVILLA.trabajo.lng, label: "Sevilla (Trabajo)" },
    stops: [{ lat: S.SEVILLA.mairena.lat, lng: S.SEVILLA.mairena.lng, label: "Mairena del Aljarafe" }],
    frequency: "one_off", outboundLocal: "07:00", returnLocal: "15:00", startDate: tomorrow(),
    seats: 3, maxDetourMinutes: 5, pickupOnRoute: true,
    ...extra
  };
}

function planBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provinceId: w.provinceId,
    origin: { lat: S.SEVILLA.palomares.lat, lng: S.SEVILLA.palomares.lng, label: "Palomares del Río" },
    destination: { lat: S.SEVILLA.trabajo.lat, lng: S.SEVILLA.trabajo.lng, label: "Sevilla (Trabajo)" },
    stops: [{ lat: S.SEVILLA.mairena.lat, lng: S.SEVILLA.mairena.lng, label: "Mairena del Aljarafe" }],
    departureLocal: "07:00",
    ...extra
  };
}

describe("requisitos para publicar (pantalla 17)", () => {
  test("conductor completo: puede publicar y ve su vehículo con color", async () => {
    const r = await S.api(app, tokens.ana).get("/v1/me/driver/readiness");
    assert.equal(r.status, 200);
    assert.equal(r.body.canPublish, true);
    assert.deepEqual(r.body.blockers, []);
    assert.deepEqual(r.body.items.map((i: { key: string }) => i.key),
      ["public_photo", "identity", "vehicle", "vehicle_documents", "vehicle_photo", "insurance", "driver_license"]);
    assert.ok(r.body.items.filter((i: { blocking: boolean }) => i.blocking).every((i: { state: string }) => i.state === "approved"));
    assert.equal(r.body.items.find((i: { key: string }) => i.key === "driver_license").blocking, false);
    assert.equal(r.body.vehicle.displayName, "Seat Arona");
    assert.equal(r.body.vehicle.color, "Gris");
    assert.equal(r.body.vehicle.passengerSeats, 3);
    assert.ok(r.body.items.find((i: { key: string }) => i.key === "insurance").expiresOn);
  });

  test("sin vehículo, con seguro caducado, foto pendiente o identidad sin verificar → bloqueos concretos", async () => {
    const bare = await S.seedUser(pool, "Sin Coche", { roles: ["driver", "passenger"], photoApproved: false, identity: "unverified" });
    const noCar = await S.api(app, await S.sessionTokenFor(pool, bare)).get("/v1/me/driver/readiness");
    assert.equal(noCar.body.canPublish, false);
    assert.equal(noCar.body.vehicle, null);
    for (const key of ["public_photo", "identity", "vehicle", "vehicle_documents", "vehicle_photo", "insurance"]) {
      assert.ok(noCar.body.blockers.includes(key), `bloquea ${key}`);
    }
    assert.equal(noCar.body.items.find((i: { key: string }) => i.key === "vehicle").state, "missing");

    await pool.query(`update vehicles set insurance_expires_on = (current_date - 1) where id=$1`, [w.vehicleId]);
    const expired = await S.api(app, tokens.ana).get("/v1/me/driver/readiness");
    assert.equal(expired.body.canPublish, false);
    assert.equal(expired.body.items.find((i: { key: string }) => i.key === "insurance").state, "expired");
    assert.deepEqual(expired.body.blockers, ["insurance"]);

    await pool.query(`update vehicles set insurance_expires_on = null where id=$1`, [w.vehicleId]);
    const noExpiry = await S.api(app, tokens.ana).get("/v1/me/driver/readiness");
    assert.equal(noExpiry.body.items.find((i: { key: string }) => i.key === "insurance").state, "in_review", "aprobado sin fecha de caducidad no basta");

    await pool.query(`update profiles set identity_status='pending' where user_id=$1`, [w.ana]);
    const pending = await S.api(app, tokens.ana).get("/v1/me/driver/readiness");
    assert.equal(pending.body.items.find((i: { key: string }) => i.key === "identity").state, "in_review");
  });

  test("solo el rol de conductor; sin sesión 401", async () => {
    assert.equal((await S.api(app, tokens.miguel).get("/v1/me/driver/readiness")).status, 403);
    assert.equal((await S.api(app).get("/v1/me/driver/readiness")).status, 401);
  });

  test("el color del vehículo se guarda desde los endpoints de vehículo existentes (servicio heredado ampliado)", async () => {
    const principal = S.principalOf(w.ana, ["driver", "passenger"]);
    const created = await createVehicle(pool, principal, { make: "Cupra", model: "Formentor", plate: S.nextPlate(), passengerSeats: 4, color: "  Azul   noche " });
    assert.equal(created.color, "Azul noche");
    const withoutColor = await createVehicle(pool, principal, { make: "Seat", model: "Ibiza", plate: S.nextPlate(), passengerSeats: 4 });
    assert.equal(withoutColor.color, null);
    // actualizar sin `color` lo conserva; con cadena vacía o null lo borra; demasiado largo → error
    const kept = await updateOwnVehicle(pool, principal, created.id, { make: "Cupra", model: "Formentor", plate: created.plate, passengerSeats: 4 });
    assert.equal(kept.color, "Azul noche");
    const cleared = await updateOwnVehicle(pool, principal, created.id, { make: "Cupra", model: "Formentor", plate: created.plate, passengerSeats: 4, color: null });
    assert.equal(cleared.color, null);
    const changed = await updateOwnVehicle(pool, principal, created.id, { make: "Cupra", model: "Formentor", plate: created.plate, passengerSeats: 4, color: "Rojo" });
    assert.equal(changed.color, "Rojo");
    await assert.rejects(
      () => updateOwnVehicle(pool, principal, created.id, { make: "Cupra", model: "Formentor", plate: created.plate, passengerSeats: 4, color: "x".repeat(41) }),
      (error: { code?: string }) => error.code === "INVALID_VEHICLE_FIELD"
    );
    const listed = await listOwnVehicles(pool, principal);
    assert.ok(listed.every((row: Record<string, unknown>) => "color" in row));
    // y se refleja en los requisitos
    await pool.query(`update vehicles set insurance_status='approved', insurance_expires_on=current_date+300, vehicle_photo_status='approved',
                                         review_status='approved', documentation_status='approved' where id=$1`, [created.id]);
    const readiness = await S.api(app, tokens.ana).get("/v1/me/driver/readiness");
    assert.ok(["Gris", "Rojo", null].includes(readiness.body.vehicle.color));
  });
});

describe("planificador de ruta con verificación de provincia por parada (pantallas 18 y 19)", () => {
  test("ruta correcta: titular, horas de paso por parada, distancia, geometría y proveedor", async () => {
    const r = await S.api(app, tokens.ana).post("/v1/me/routes/plan", planBody());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.canSave, true);
    assert.equal(r.body.headline, "Toda la ruta está dentro de la provincia de Sevilla.");
    assert.equal(r.body.blockingMessage, null);
    assert.deepEqual(r.body.issues, []);
    assert.equal(r.body.provinceName, "Sevilla");
    assert.deepEqual(r.body.stops.map((s: { verdict: string }) => s.verdict), ["ok", "ok", "ok"]);
    assert.deepEqual(r.body.stops.map((s: { kind: string }) => s.kind), ["origin", "stop", "destination"]);
    assert.ok(r.body.stops.every((s: { inProvince: boolean }) => s.inProvince));
    assert.equal(r.body.stops[0].etaLocal, "07:00");
    assert.equal(r.body.stops[0].offsetMinutes, 0);
    const seg0 = Math.round(S.haversine(S.SEVILLA.palomares, S.SEVILLA.mairena) * 1.3 / 8 / 60);
    assert.equal(r.body.stops[1].offsetMinutes, seg0);
    assert.ok(r.body.stops[2].offsetMinutes > r.body.stops[1].offsetMinutes);
    assert.equal(r.body.route.provider, "fake");
    assert.ok(r.body.route.distanceM > 10_000);
    assert.equal(r.body.route.geometry.type, "LineString");
    assert.ok(r.body.route.geometry.coordinates.length >= 2);
    assert.equal(geocoder.queries.length, 0, "no se geocodifica cuando todo está dentro");
    assert.ok(routeProvider.calls.length >= 1);
  });

  test("«Huelva (sugerida): fuera de provincia» → veredicto por parada, alternativas dentro de Sevilla y NO se calcula ruta", async () => {
    const r = await S.api(app, tokens.ana).post("/v1/me/routes/plan", planBody({
      stops: [{ lat: S.SEVILLA.huelva.lat, lng: S.SEVILLA.huelva.lng, label: "Huelva (sugerida)" }]
    }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.canSave, false);
    assert.equal(r.body.headline, null);
    assert.equal(r.body.blockingMessage, "Corrige los puntos fuera de la provincia para guardar.");
    assert.equal(r.body.route, null);
    const [origin, huelva, destination] = r.body.stops;
    assert.equal(origin.verdict, "ok");
    assert.equal(destination.verdict, "ok");
    assert.equal(huelva.verdict, "outside_province");
    assert.equal(huelva.inProvince, false);
    assert.equal(huelva.message, "Esta parada no está en la provincia de Sevilla.");
    assert.deepEqual(huelva.alternatives.map((a: { label: string }) => a.label), ["Aznalcóllar"], "solo alternativas dentro de la provincia");
    assert.ok(huelva.alternatives[0].location.lat > 37);
    assert.equal(r.body.issues.length, 1);
    assert.equal(r.body.issues[0].code, "STOP_OUTSIDE_PROVINCE");
    assert.equal(r.body.issues[0].severity, "error");
    assert.equal(r.body.issues[0].stopIndex, 1);
    assert.equal(routeProvider.calls.length, 0, "con un punto fuera no se llama al proveedor de rutas");
    assert.ok(geocoder.queries[0]!.includes("Huelva"), "se busca la parada por su nombre dentro de la provincia");
  });

  test("origen y destino fuera también se detectan, cada uno con su veredicto", async () => {
    const r = await S.api(app, tokens.ana).post("/v1/me/routes/plan", planBody({
      origin: { lat: S.SEVILLA.huelva.lat, lng: S.SEVILLA.huelva.lng, label: "Huelva" }, stops: []
    }));
    assert.equal(r.body.canSave, false);
    assert.deepEqual(r.body.stops.map((s: { verdict: string }) => s.verdict), ["outside_province", "ok"]);
    assert.equal(r.body.stops[0].message, "El origen no está en la provincia de Sevilla.");
  });

  test("todos los puntos dentro pero la ruta por carretera sale de la provincia → ROUTE_LEAVES_PROVINCE", async () => {
    const leaky = await S.buildTripsApp(pool, { routeProvider: new LeakyRouteProvider(), geocodingProvider: geocoder });
    try {
      const r = await S.api(leaky, tokens.ana).post("/v1/me/routes/plan", planBody());
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.canSave, false);
      assert.equal(r.body.route, null);
      assert.equal(r.body.issues[0].code, "ROUTE_LEAVES_PROVINCE");
      assert.ok(r.body.blockingMessage.includes("sale de la provincia"));
      assert.ok(r.body.stops.every((s: { verdict: string }) => s.verdict === "ok"), "los puntos están bien; el problema es el recorrido");
    } finally {
      await leaky.close();
    }
  });

  test("parada opcional: el desvío se calcula con el proveedor (ruta con parada − ruta sin ella)", async () => {
    const r = await S.api(app, tokens.ana).post("/v1/me/routes/plan", planBody({
      stops: [{ lat: S.SEVILLA.mairena.lat, lng: S.SEVILLA.mairena.lng, label: "Mairena del Aljarafe", optional: true }]
    }));
    assert.equal(r.status, 200);
    const via = (S.haversine(S.SEVILLA.palomares, S.SEVILLA.mairena) + S.haversine(S.SEVILLA.mairena, S.SEVILLA.trabajo)) * 1.3 / 8;
    const direct = S.haversine(S.SEVILLA.palomares, S.SEVILLA.trabajo) * 1.3 / 8;
    // la suma por tramos del plan se redondea por segundo; margen de 1 min
    const expected = Math.round((via - direct) / 60);
    assert.ok(Math.abs(r.body.stops[1].detourMinutes - expected) <= 1, `${r.body.stops[1].detourMinutes} ≈ ${expected}`);
    assert.equal(r.body.stops[1].optional, true);
    assert.equal(r.body.stops[0].detourMinutes, null);
  });

  test("límites y errores: 11 paradas, ruta demasiado corta, provincia inexistente, validación, rol y sin proveedor", async () => {
    const ana = S.api(app, tokens.ana);
    const many = Array.from({ length: 11 }, (_, i) => ({ lat: 37.33 + i * 0.001, lng: -6.0 + i * 0.001 }));
    const tooMany = await ana.post("/v1/me/routes/plan", planBody({ stops: many }));
    assert.equal(tooMany.status, 422);
    assert.equal(S.codeOf(tooMany), "TOO_MANY_STOPS");
    const tooShort = await ana.post("/v1/me/routes/plan", planBody({ stops: [], destination: { lat: S.SEVILLA.palomares.lat + 0.0001, lng: S.SEVILLA.palomares.lng } }));
    assert.equal(tooShort.status, 422);
    assert.equal(S.codeOf(tooShort), "ROUTE_TOO_SHORT");
    const missing = await ana.post("/v1/me/routes/plan", planBody({ provinceId: "00000000-0000-4000-8000-000000000000" }));
    assert.equal(missing.status, 404);
    assert.equal(S.codeOf(missing), "PROVINCE_NOT_FOUND");
    const invalid = await ana.post("/v1/me/routes/plan", planBody({ origin: { lat: 123, lng: -6 } }));
    assert.equal(invalid.status, 400);
    assert.equal(S.codeOf(invalid), "VALIDATION_ERROR");
    assert.equal((await S.api(app, tokens.miguel).post("/v1/me/routes/plan", planBody())).status, 403);
    assert.equal((await S.api(app).post("/v1/me/routes/plan", planBody())).status, 401);

    const noProvider = await S.buildTripsApp(pool, { routeProvider: null, geocodingProvider: null });
    try {
      const unavailable = await S.api(noProvider, tokens.ana).post("/v1/me/routes/plan", planBody());
      assert.equal(unavailable.status, 503);
      assert.equal(S.codeOf(unavailable), "MAPS_PROVIDER_UNAVAILABLE");
      // con un punto fuera no hace falta proveedor: el veredicto se da igualmente, sin alternativas
      const verdict = await S.api(noProvider, tokens.ana).post("/v1/me/routes/plan", planBody({
        stops: [{ lat: S.SEVILLA.huelva.lat, lng: S.SEVILLA.huelva.lng, label: "Huelva (sugerida)" }]
      }));
      assert.equal(verdict.status, 200);
      assert.deepEqual(verdict.body.stops[1].alternatives, []);
    } finally {
      await noProvider.close();
    }
  });

  test("reordenar paradas: cada edición se reenvía completa y las horas de paso cambian", async () => {
    const ana = S.api(app, tokens.ana);
    const stops = [
      { lat: S.SEVILLA.mairena.lat, lng: S.SEVILLA.mairena.lng, label: "Mairena" },
      { lat: S.SEVILLA.universidad.lat, lng: S.SEVILLA.universidad.lng, label: "Universidad" }
    ];
    const a = await ana.post("/v1/me/routes/plan", planBody({ stops }));
    const b = await ana.post("/v1/me/routes/plan", planBody({ stops: [...stops].reverse() }));
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.deepEqual(a.body.stops.map((s: { label: string }) => s.label), ["Palomares del Río", "Mairena", "Universidad", "Sevilla (Trabajo)"]);
    assert.deepEqual(b.body.stops.map((s: { label: string }) => s.label), ["Palomares del Río", "Universidad", "Mairena", "Sevilla (Trabajo)"]);
    assert.notEqual(a.body.route.distanceM, b.body.route.distanceM);
  });
});

describe("«Guardar ruta» (pantalla 19)", () => {
  test("viaje puntual con vuelta: dos viajes publicados con sus paradas y tramos, auditoría y respuesta", async () => {
    const date = tomorrow();
    const r = await S.api(app, tokens.ana).post("/v1/me/routes", routeBody({ startDate: date }), { "Idempotency-Key": S.idemKey() });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.seriesId, null);
    assert.equal(r.body.frequency, "one_off");
    assert.equal(r.body.occurrencesCreated, 2);
    assert.equal(r.body.horizonUntil, null);
    assert.deepEqual(r.body.trips.map((t: { leg: string }) => t.leg).sort(), ["outbound", "return"]);
    assert.ok(r.body.trips.every((t: { status: string }) => t.status === "published"));
    assert.equal(r.body.route.provider, "fake");

    const trips = (await pool.query(
      `select id, leg, kind, status, to_char(departure_at at time zone 'Europe/Madrid','HH24:MI') as local_time,
              service_date::text as service_date, offered_seats, max_detour_minutes, pickup_on_route, province_id, vehicle_id, series_id
         from trips order by leg desc`)).rows;
    assert.equal(trips.length, 2);
    const [outbound, back] = [trips.find(t => t.leg === "outbound")!, trips.find(t => t.leg === "return")!];
    assert.equal(outbound.local_time, "07:00");
    assert.equal(back.local_time, "15:00");
    assert.equal(outbound.service_date, date);
    assert.equal(outbound.kind, "single");
    assert.equal(outbound.offered_seats, 3);
    assert.equal(outbound.max_detour_minutes, 5);
    assert.equal(outbound.pickup_on_route, true);
    assert.equal(outbound.vehicle_id, w.vehicleId);
    assert.equal(outbound.series_id, null);

    const stops = async (tripId: string): Promise<string[]> =>
      (await pool.query<{ label: string }>(`select label from trip_stops where trip_id=$1 order by seq`, [tripId])).rows.map(x => x.label);
    assert.deepEqual(await stops(outbound.id), ["Palomares del Río", "Mairena del Aljarafe", "Sevilla (Trabajo)"]);
    assert.deepEqual(await stops(back.id), ["Sevilla (Trabajo)", "Mairena del Aljarafe", "Palomares del Río"], "la vuelta es la ruta inversa");
    for (const trip of trips) {
      const segs = (await pool.query(`select capacity, distance_m, duration_s from trip_segments where trip_id=$1 order by seq`, [trip.id])).rows;
      assert.equal(segs.length, 2);
      assert.ok(segs.every(s => s.capacity === 3 && s.distance_m > 0 && s.duration_s > 0));
    }
    const audit = await pool.query(`select actor_user_id, entity_type, metadata from audit_events where action='route.published'`);
    assert.equal(audit.rowCount, 1);
    assert.equal(audit.rows[0].actor_user_id, w.ana);
    assert.equal(audit.rows[0].metadata.occurrencesCreated, 2);

    // los viajes publicados ya son visibles y reservables
    const detail = await S.api(app).get(`/v1/trips/${outbound.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.status, "published");
    assert.equal(detail.body.seats.available, 3);
  });

  test("serie «lunes a viernes»: una ocurrencia real por día y sentido, solo laborables, ventana de 28 días", async () => {
    const start = tomorrow();
    const r = await S.api(app, tokens.ana).post("/v1/me/routes", routeBody({ frequency: "daily_workdays", startDate: start }), { "Idempotency-Key": S.idemKey() });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.ok(r.body.seriesId);
    assert.equal(r.body.frequency, "daily_workdays");
    const horizon: string = r.body.horizonUntil;
    assert.ok(horizon >= S.addDaysIso(S.madrid(new Date()).date, 27) && horizon <= S.addDaysIso(S.madrid(new Date()).date, 29), horizon);

    const rows = (await pool.query<{ leg: string; service_date: string; kind: string; status: string }>(
      `select leg, service_date::text, kind, status from trips where series_id=$1 order by service_date, leg`, [r.body.seriesId])).rows;
    assert.ok(rows.length >= 30, `ocurrencias: ${rows.length}`);
    assert.ok(rows.every(row => row.kind === "recurring" && row.status === "published"));
    assert.ok(rows.every(row => !["sat", "sun"].includes(S.weekdayOfDate(row.service_date))), "nunca fines de semana");
    const expectedDays: string[] = [];
    for (let day = start; day <= horizon; day = S.addDaysIso(day, 1)) {
      if (!["sat", "sun"].includes(S.weekdayOfDate(day))) expectedDays.push(day);
    }
    for (const leg of ["outbound", "return"]) {
      assert.deepEqual(rows.filter(row => row.leg === leg).map(row => row.service_date), expectedDays, `días de ${leg}`);
    }
    assert.equal(r.body.occurrencesCreated, rows.length);
    const series = (await pool.query(`select status, frequency, weekdays, materialized_until::text as until, to_char(outbound_local,'HH24:MI') as o, to_char(return_local,'HH24:MI') as b from trip_series`)).rows[0];
    assert.equal(series.status, "active");
    assert.deepEqual(series.weekdays, ["mon", "tue", "wed", "thu", "fri"]);
    assert.equal(series.until, horizon);
    assert.equal(series.o, "07:00");
    assert.equal(series.b, "15:00");
    assert.deepEqual(r.body.trips.map((t: { leg: string }) => t.leg).sort(), ["outbound", "return"]);

    // La salida de cada ocurrencia es a la hora de reloj local (también al cruzar el cambio de hora de octubre).
    const times = (await pool.query<{ t: string }>(
      `select distinct to_char(departure_at at time zone 'Europe/Madrid','HH24:MI') as t from trips where series_id=$1 and leg='outbound'`, [r.body.seriesId])).rows;
    assert.deepEqual(times.map(x => x.t), ["07:00"]);
  });

  test("ampliar la ventana es incremental e idempotente: no duplica ni recrea ocurrencias", async () => {
    const r = await S.api(app, tokens.ana).post("/v1/me/routes", routeBody({ frequency: "daily_workdays", startDate: tomorrow(), returnLocal: undefined }));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const before = await S.count(pool, `select 1 from trips where series_id='${r.body.seriesId}'`);
    const sameDay = await runTripsSweep(pool);
    assert.equal(sameDay.materialized, 0, "nada nuevo mientras no avance el reloj");
    assert.equal(await S.count(pool, `select 1 from trips where series_id='${r.body.seriesId}'`), before);

    const later = await runTripsSweep(pool, S.hoursAfter(new Date(), 24 * 14));
    assert.ok(later.materialized >= 9, `se añaden las ocurrencias de las dos semanas nuevas (${later.materialized})`);
    const after1 = await S.count(pool, `select 1 from trips where series_id='${r.body.seriesId}'`);
    assert.equal(after1, before + later.materialized);
    const again = await runTripsSweep(pool, S.hoursAfter(new Date(), 24 * 14));
    assert.equal(again.materialized, 0);
    assert.equal(await S.count(pool, `select 1 from trips where series_id='${r.body.seriesId}'`), after1);
    const dup = await pool.query(`select count(*)::int as n from (select series_id, leg, service_date from trips where series_id is not null group by 1,2,3 having count(*) > 1) q`);
    assert.equal(dup.rows[0].n, 0);
  });

  test("idempotencia: misma clave repite la respuesta sin duplicar viajes; otro cuerpo con la misma clave es 422", async () => {
    const key = S.idemKey();
    const ana = S.api(app, tokens.ana);
    const a = await ana.post("/v1/me/routes", routeBody(), { "Idempotency-Key": key });
    const b = await ana.post("/v1/me/routes", routeBody(), { "Idempotency-Key": key });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(b.headers["idempotency-replayed"], "true");
    assert.deepEqual(b.body.trips, a.body.trips);
    assert.equal(await S.count(pool, `select 1 from trips`), 2);
    const reused = await ana.post("/v1/me/routes", routeBody({ seats: 2 }), { "Idempotency-Key": key });
    assert.equal(reused.status, 422);
    assert.equal(S.codeOf(reused), "IDEMPOTENCY_KEY_REUSED");
    assert.equal(await S.count(pool, `select 1 from trips`), 2);
  });

  test("puerta de publicación: requisitos incumplidos → 409 DRIVER_NOT_READY con la lista y no se crea nada", async () => {
    await pool.query(`update vehicles set insurance_expires_on = (current_date - 1) where id=$1`, [w.vehicleId]);
    const r = await S.api(app, tokens.ana).post("/v1/me/routes", routeBody());
    assert.equal(r.status, 409);
    assert.equal(S.codeOf(r), "DRIVER_NOT_READY");
    assert.deepEqual(r.body.error.details.blockers, ["insurance"]);
    assert.equal(await S.count(pool, `select 1 from trips`), 0);
    assert.equal(await S.count(pool, `select 1 from trip_series`), 0);
    assert.equal(await S.count(pool, `select 1 from audit_events where action='route.published'`), 0);
    await pool.query(`update vehicles set insurance_expires_on = current_date + 100, insurance_status='pending' where id=$1`, [w.vehicleId]);
    const pending = await S.api(app, tokens.ana).post("/v1/me/routes", routeBody());
    assert.equal(pending.status, 409);
    assert.equal(S.codeOf(pending), "DRIVER_NOT_READY");
  });

  test("errores de datos: vehículo ajeno o inexistente, plazas de más, fechas, horas y puntos fuera de provincia", async () => {
    const ana = S.api(app, tokens.ana);
    const pedro = await S.seedUser(pool, "Pedro", { roles: ["driver", "passenger"], photoApproved: true });
    const pedroVehicle = await S.seedVehicle(pool, pedro);
    const foreign = await ana.post("/v1/me/routes", routeBody({ vehicleId: pedroVehicle }));
    assert.equal(foreign.status, 403);
    assert.equal(S.codeOf(foreign), "VEHICLE_NOT_OWNED");
    const unknown = await ana.post("/v1/me/routes", routeBody({ vehicleId: "00000000-0000-4000-8000-000000000000" }));
    assert.equal(unknown.status, 404);
    assert.equal(S.codeOf(unknown), "VEHICLE_NOT_FOUND");
    const seats = await ana.post("/v1/me/routes", routeBody({ seats: 4 }));
    assert.equal(seats.status, 422);
    assert.equal(S.codeOf(seats), "OFFERED_SEATS_EXCEED_VEHICLE");
    const yesterday = await ana.post("/v1/me/routes", routeBody({ startDate: S.addDaysIso(S.madrid(new Date()).date, -1) }));
    assert.equal(yesterday.status, 422);
    assert.ok(["PUBLISH_START_DATE_IN_PAST", "INVALID_START_DATE"].includes(S.codeOf(yesterday)!), S.codeOf(yesterday));
    const noDate = await ana.post("/v1/me/routes", routeBody({ startDate: undefined }));
    assert.equal(noDate.status, 422);
    assert.equal(S.codeOf(noDate), "ONE_OFF_DATE_REQUIRED");
    const backTooEarly = await ana.post("/v1/me/routes", routeBody({ outboundLocal: "07:00", returnLocal: "07:10" }));
    assert.equal(backTooEarly.status, 422);
    assert.equal(S.codeOf(backTooEarly), "INVALID_TIME");
    const badTime = await ana.post("/v1/me/routes", routeBody({ outboundLocal: "7am" }));
    assert.equal(badTime.status, 400);
    const outside = await ana.post("/v1/me/routes", routeBody({ stops: [{ lat: S.SEVILLA.huelva.lat, lng: S.SEVILLA.huelva.lng, label: "Huelva (sugerida)" }] }));
    assert.equal(outside.status, 422);
    assert.equal(S.codeOf(outside), "ROUTE_POINT_OUTSIDE_PROVINCE");
    assert.equal(await S.count(pool, `select 1 from trips`), 0, "ninguna publicación parcial");
    assert.equal((await S.api(app, tokens.miguel).post("/v1/me/routes", routeBody())).status, 403);
    assert.equal((await S.api(app).post("/v1/me/routes", routeBody())).status, 401);

    const leaky = await S.buildTripsApp(pool, { routeProvider: new LeakyRouteProvider(), geocodingProvider: geocoder });
    try {
      const leaves = await S.api(leaky, tokens.ana).post("/v1/me/routes", routeBody());
      assert.equal(leaves.status, 422);
      assert.equal(S.codeOf(leaves), "NO_ROUTE_WITHIN_PROVINCE");
      assert.equal(await S.count(pool, `select 1 from trips`), 0);
    } finally {
      await leaky.close();
    }
  });
});

describe("bandeja de solicitudes del conductor (pantalla 20)", () => {
  test("ocupación por tramo sin contar la propia solicitud, desvío, orden y aceptación posible", async () => {
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { departureAt: S.hoursAfter(new Date(), 5) });
    await S.seedRequest(pool, t.tripId, w.laura, 0, 2, { status: "confirmed" });
    const pending = await S.seedRequest(pool, t.tripId, w.miguel, 1, 2, {
      status: "pending", message: "Voy con maleta", pickupDetourMinutes: 2, requestedAt: S.minutesAfter(new Date(), -5)
    });
    const r = await S.api(app, tokens.ana).get("/v1/me/driver/requests");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.items.length, 1);
    const item = r.body.items[0];
    assert.equal(item.id, pending.requestId);
    assert.equal(item.kind, "single");
    assert.equal(item.status, "pending");
    assert.equal(item.passenger.firstName, "Miguel");
    assert.equal(item.tripId, t.tripId);
    assert.equal(item.from.label, "Mairena del Aljarafe");
    assert.equal(item.to.label, "Sevilla (Trabajo)");
    assert.equal(item.detourMinutes, 2);
    assert.equal(item.message, "Voy con maleta");
    assert.equal(item.occupancy.totalSeats, 3);
    assert.equal(item.occupancy.occupiedSeats, 1, "«1 / 3 plazas»: solo Laura, sin contar esta solicitud");
    assert.equal(item.occupancy.perSegment.length, 2);
    assert.deepEqual(item.occupancy.perSegment.map((x: { inRequestedRange: boolean }) => x.inRequestedRange), [false, true]);
    assert.equal(item.canAccept, true);
    assert.equal(item.blockedReason, null);
    assert.equal(item.weekly, null);
    assert.equal((await S.api(app, tokens.ana).get("/v1/me/driver/requests?status=all")).body.items.length, 2, "`all` incluye la confirmada");
  });

  test("sin plaza en el tramo: `canAccept=false` y motivo; con viaje cancelado, TRIP_NOT_BOOKABLE", async () => {
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { capacity: 1, departureAt: S.hoursAfter(new Date(), 5) });
    await S.seedRequest(pool, t.tripId, w.laura, 1, 2, { status: "confirmed" });
    await S.seedRequest(pool, t.tripId, w.miguel, 0, 2, { status: "pending" });
    const full = (await S.api(app, tokens.ana).get("/v1/me/driver/requests")).body.items[0];
    assert.equal(full.canAccept, false);
    assert.equal(full.blockedReason, "NO_CAPACITY_ON_SEGMENT");
    await pool.query(`update trips set status='cancelled' where id=$1`, [t.tripId]);
    const closed = (await S.api(app, tokens.ana).get("/v1/me/driver/requests?status=pending")).body.items;
    assert.equal(closed.length, 1, "la solicitud sigue listada, pero ya no se puede aceptar");
    assert.equal(closed[0].canAccept, false);
    assert.equal(closed[0].blockedReason, "TRIP_NOT_BOOKABLE");
  });

  test("solo ve solicitudes de SUS viajes; estados `open`/`all`; filtro por viaje y paginación", async () => {
    const mine = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { departureAt: S.hoursAfter(new Date(), 5) });
    const later = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { departureAt: S.hoursAfter(new Date(), 8) });
    const pedro = await S.seedUser(pool, "Pedro", { roles: ["driver", "passenger"], photoApproved: true });
    const pedroTrip = await S.seedTrip(pool, pedro, await S.seedVehicle(pool, pedro), w.provinceId, { departureAt: S.hoursAfter(new Date(), 6) });
    const a = await S.seedRequest(pool, mine.tripId, w.miguel, 0, 2, { status: "pending", requestedAt: S.minutesAfter(new Date(), -10) });
    const b = await S.seedRequest(pool, later.tripId, w.laura, 0, 2, { status: "pending", requestedAt: S.minutesAfter(new Date(), -20) });
    const held = await S.seedRequest(pool, mine.tripId, w.laura, 0, 1, { status: "payment_pending" });
    await S.seedRequest(pool, pedroTrip.tripId, w.miguel, 0, 2, { status: "pending" });
    await S.seedRequest(pool, mine.tripId, w.miguel, 1, 2, { status: "rejected" });

    const ana = S.api(app, tokens.ana);
    const pendingOnly = await ana.get("/v1/me/driver/requests");
    assert.deepEqual(pendingOnly.body.items.map((i: { id: string }) => i.id), [a.requestId, b.requestId], "ordenadas por salida del viaje");
    const open = await ana.get("/v1/me/driver/requests?status=open");
    assert.equal(open.body.items.length, 3);
    assert.ok(open.body.items.some((i: { id: string; status: string }) => i.id === held.requestId && i.status === "payment_pending"));
    const all = await ana.get("/v1/me/driver/requests?status=all");
    assert.equal(all.body.items.length, 4);
    assert.ok(!JSON.stringify(all.body).includes(pedroTrip.tripId), "nunca solicitudes de viajes de otro conductor");
    const onlyLater = await ana.get(`/v1/me/driver/requests?tripId=${later.tripId}`);
    assert.deepEqual(onlyLater.body.items.map((i: { id: string }) => i.id), [b.requestId]);

    const page1 = await ana.get("/v1/me/driver/requests?limit=1");
    assert.equal(page1.body.items.length, 1);
    assert.ok(page1.body.nextCursor);
    const page2 = await ana.get(`/v1/me/driver/requests?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`);
    assert.equal(page2.body.items.length, 1);
    assert.notEqual(page2.body.items[0].id, page1.body.items[0].id);
    assert.equal(page2.body.nextCursor, null);

    const pedroView = await S.api(app, await S.sessionTokenFor(pool, pedro)).get("/v1/me/driver/requests?status=all");
    assert.equal(pedroView.body.items.length, 1, "Pedro solo ve la suya");
  });

  test("rol y sesión", async () => {
    assert.equal((await S.api(app, tokens.miguel).get("/v1/me/driver/requests")).status, 403);
    assert.equal((await S.api(app).get("/v1/me/driver/requests")).status, 401);
    assert.equal((await S.api(app, tokens.ana).get("/v1/me/driver/requests?status=nada")).status, 400);
  });
});
