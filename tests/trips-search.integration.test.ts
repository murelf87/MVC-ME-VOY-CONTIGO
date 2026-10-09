import test, { after, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { registerRatingSummaryProvider, resetRatingColumnCache } from "../src/modules/trips/public-user.js";
import * as S from "./trips-support.js";

/**
 * Catálogo, mapa de inicio (09), búsqueda (10/11), detalle (12), puntos de recogida (13) y presupuesto («Ver desglose»).
 * Base de datos propia: mvc_trips.
 */
let pool: pg.Pool;
let app: FastifyInstance;
let w: S.World;
let tokens: { ana: string; miguel: string; laura: string };

const SEARCH_ORIGIN = { originLat: "37.3450", originLng: "-6.0610" }; // junto a Mairena del Aljarafe
const SEARCH_DEST = { destLat: "37.3890", destLng: "-5.9850" }; // junto a «Sevilla (Trabajo)»

function searchUrl(extra: Record<string, string>): string {
  return `/v1/search/trips?${new URLSearchParams({ provinceId: w.provinceId, ...SEARCH_ORIGIN, ...SEARCH_DEST, ...extra })}`;
}

before(async () => {
  pool = S.createPool();
  app = await S.buildTripsApp(pool);
});

beforeEach(async () => {
  await S.truncateAll(pool);
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

describe("catálogo", () => {
  test("categorías públicas: Trabajo, Universidad, FP, Hospital, Deporte y Otros", async () => {
    const r = await S.api(app).get("/v1/trip-categories");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.items.map((c: { id: string }) => c.id), ["work", "university", "fp_academies", "hospital", "sport", "other"]);
    assert.deepEqual(r.body.items.map((c: { label: string }) => c.label), ["Trabajo", "Universidad", "FP", "Hospital", "Deporte", "Otros"]);
  });
});

describe("mapa de inicio (pantalla 09)", () => {
  test("posición SIEMPRE aproximada (cuadrícula de 0,01°), plazas libres y filtros", async () => {
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { category: "university" });
    const r = await S.api(app).get(`/v1/trips/map?provinceId=${w.provinceId}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.cars.length, 1);
    const car = r.body.cars[0];
    assert.equal(car.tripId, t.tripId);
    assert.equal(car.state, "scheduled");
    assert.equal(car.position.precision, "approximate");
    assert.equal(car.position.source, "origin");
    assert.equal(Math.round(car.position.lat * 100) / 100, car.position.lat, "latitud en cuadrícula de 0,01°");
    assert.equal(Math.round(car.position.lng * 100) / 100, car.position.lng, "longitud en cuadrícula de 0,01°");
    assert.equal(car.seatsAvailable, 3);
    assert.equal(car.full, false);
    assert.equal(car.originLabel, "Palomares del Río");
    // nunca la coordenada exacta del origen
    assert.ok(!JSON.stringify(r.body).includes("37.3133"), "la latitud exacta no debe salir en el mapa");
    assert.ok(!JSON.stringify(r.body).includes("-6.0504"), "la longitud exacta no debe salir en el mapa");

    const none = await S.api(app).get(`/v1/trips/map?provinceId=${w.provinceId}&category=hospital`);
    assert.equal(none.body.cars.length, 0, "el filtro por categoría excluye el viaje");
    const uni = await S.api(app).get(`/v1/trips/map?provinceId=${w.provinceId}&category=university`);
    assert.equal(uni.body.cars.length, 1);
  });

  test("«Completo»: el coche aparece en gris y `onlyWithSeats` lo oculta", async () => {
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { capacity: 1 });
    await S.seedRequest(pool, t.tripId, w.miguel, 0, 2, { status: "confirmed" });
    const all = await S.api(app).get(`/v1/trips/map?provinceId=${w.provinceId}`);
    assert.equal(all.body.cars[0].full, true);
    assert.equal(all.body.cars[0].seatsAvailable, 0);
    const free = await S.api(app).get(`/v1/trips/map?provinceId=${w.provinceId}&onlyWithSeats=true`);
    assert.equal(free.body.cars.length, 0);
  });

  test("no muestra borradores, cancelados, otras provincias ni salidas fuera de la ventana", async () => {
    await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { status: "cancelled" });
    await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { departureAt: S.hoursAfter(new Date(), 30) });
    const otherProvince = await S.seedOtherProvince(pool);
    const r = await S.api(app).get(`/v1/trips/map?provinceId=${otherProvince}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.cars.length, 0);
    const own = await S.api(app).get(`/v1/trips/map?provinceId=${w.provinceId}&withinHours=12`);
    assert.equal(own.body.cars.length, 0, "ni el cancelado ni el de dentro de 30 h");
    const wide = await S.api(app).get(`/v1/trips/map?provinceId=${w.provinceId}&withinHours=48`);
    assert.equal(wide.body.cars.length, 1);
  });

  test("viaje en curso: posición en directo aproximada; una posición vieja se marca `stale`", async () => {
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { status: "active", departureAt: S.minutesAfter(new Date(), -10) });
    await S.setPosition(pool, t.tripId, w.ana, { lat: 37.3299, lng: -6.0555 }, S.secondsAfter(new Date(), -10));
    const fresh = await S.api(app).get(`/v1/trips/map?provinceId=${w.provinceId}`);
    const car = fresh.body.cars[0];
    assert.equal(car.state, "live");
    assert.equal(car.position.source, "live_gps");
    assert.equal(car.position.precision, "approximate");
    assert.equal(car.position.stale, false);
    assert.equal(car.position.lat, 37.33);
    assert.equal(car.position.lng, -6.06);

    await S.setPosition(pool, t.tripId, w.ana, { lat: 37.3299, lng: -6.0555 }, S.secondsAfter(new Date(), -300));
    const stale = await S.api(app).get(`/v1/trips/map?provinceId=${w.provinceId}`);
    assert.equal(stale.body.cars[0].position.stale, true, "con más de 60 s no se presenta como «en directo»");
  });

  test("provincia inexistente → 404 y parámetros inválidos → 400 VALIDATION_ERROR (no 500)", async () => {
    const missing = await S.api(app).get(`/v1/trips/map?provinceId=${"00000000-0000-4000-8000-000000000000"}`);
    assert.equal(missing.status, 404);
    assert.equal(S.codeOf(missing), "PROVINCE_NOT_FOUND");
    const bad = await S.api(app).get(`/v1/trips/map?provinceId=no-es-uuid`);
    assert.equal(bad.status, 400);
    assert.equal(S.codeOf(bad), "VALIDATION_ERROR");
  });
});

describe("búsqueda (pantallas 10 y 11)", () => {
  test("resultado con conductor (PublicUser), vehículo sin matrícula, plazas, ETA y precio «Por definir»", async () => {
    const departure = S.hoursAfter(new Date(), 2);
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { departureAt: departure });
    const arrive = S.madrid(t.arrivals[2]!).time;
    const r = await S.api(app).get(searchUrl({ arriveBy: arrive, mode: "one_off", date: S.madrid(departure).date }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.items.length, 1);
    const item = r.body.items[0];
    assert.equal(item.tripId, t.tripId);
    assert.equal(item.driver.displayName, "Ana García López");
    assert.equal(item.driver.firstName, "Ana");
    assert.ok(item.driver.photoUrl.startsWith("https://media.mvc.test/"));
    assert.ok(!("phone" in item.driver), "PublicUser nunca incluye teléfono");
    assert.equal(item.vehicle.make, "Seat");
    assert.equal(item.vehicle.color, "Gris");
    assert.equal(item.vehicle.plate, null, "la matrícula completa no se enseña a quien no participa");
    assert.equal(item.vehicle.plateHint, w.plate.slice(-3));
    assert.ok(!JSON.stringify(r.body).includes(w.plate), "la matrícula completa no aparece en ningún lugar");
    assert.equal(item.seatsAvailable, 3);
    assert.equal(item.pickup.label, "Mairena del Aljarafe");
    assert.equal(item.pickup.stopSeq, 1);
    assert.equal(item.pickup.location.precision, "approximate", "en resultados de búsqueda las paradas van aproximadas");
    assert.equal(item.dropoff.label, "Sevilla (Trabajo)");
    assert.equal(item.dropoff.arriveAtLocal, arrive);
    assert.equal(item.fromSegmentSeq, 1);
    assert.equal(item.toSegmentSeq, 2);
    assert.ok(item.roadDistanceM > 0 && item.durationMinutes > 0);
    assert.deepEqual(item.price, { cents: null, currency: "EUR", status: "pending_definition" });
    assert.equal(r.body.criteria.mode, "one_off");
    assert.equal(r.body.criteria.arriveBy, arrive);
    assert.deepEqual(r.body.suggestions, []);
  });

  test("disponibilidad por tramo: ocupar solo el tramo 0 no resta plazas a quien sube en la parada 1", async () => {
    const departure = S.hoursAfter(new Date(), 2);
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { departureAt: departure, capacity: 2 });
    await S.seedRequest(pool, t.tripId, w.laura, 0, 1, { status: "confirmed" }); // solo Palomares → Mairena
    const arrive = S.madrid(t.arrivals[2]!).time;
    const q = { arriveBy: arrive, mode: "one_off", date: S.madrid(departure).date };
    const r = await S.api(app).get(searchUrl(q));
    assert.equal(r.body.items[0].seatsAvailable, 2, "el tramo 1 sigue libre");

    await S.seedRequest(pool, t.tripId, w.miguel, 1, 2, { status: "confirmed" });
    const withSeat = await S.api(app).get(searchUrl(q));
    assert.equal(withSeat.body.items[0].seatsAvailable, 1);
  });

  test("con el tramo lleno: `onlyWithSeats` (por defecto) lo oculta y `false` lo muestra con 0 plazas", async () => {
    const departure = S.hoursAfter(new Date(), 2);
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { departureAt: departure, capacity: 1 });
    await S.seedRequest(pool, t.tripId, w.miguel, 1, 2, { status: "confirmed" });
    const q = { arriveBy: S.madrid(t.arrivals[2]!).time, mode: "one_off", date: S.madrid(departure).date };
    const hidden = await S.api(app).get(searchUrl(q));
    assert.equal(hidden.body.items.length, 0);
    const shown = await S.api(app).get(searchUrl({ ...q, onlyWithSeats: "false" }));
    assert.equal(shown.body.items.length, 1);
    assert.equal(shown.body.items[0].seatsAvailable, 0);
  });

  test("un hold activo reserva la plaza (el pago pendiente cuenta) y uno caducado no", async () => {
    const departure = S.hoursAfter(new Date(), 2);
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { departureAt: departure, capacity: 1 });
    const held = await S.seedRequest(pool, t.tripId, w.miguel, 1, 2, { status: "payment_pending", holdExpiresAt: S.minutesAfter(new Date(), 10) });
    const q = { arriveBy: S.madrid(t.arrivals[2]!).time, mode: "one_off", date: S.madrid(departure).date };
    assert.equal((await S.api(app).get(searchUrl(q))).body.items.length, 0, "hold activo → sin plaza");
    await pool.query(`update seat_holds set expires_at = now() - interval '1 minute' where id = $1`, [held.holdId]);
    assert.equal((await S.api(app).get(searchUrl(q))).body.items.length, 1, "hold caducado → la plaza vuelve a estar libre");
  });

  test("la hora de llegada fuera de tolerancia no coincide y las sugerencias proponen ampliar el horario", async () => {
    const departure = S.hoursAfter(new Date(), 2);
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { departureAt: departure });
    const date = S.madrid(departure).date;
    const later = S.madrid(S.minutesAfter(t.arrivals[2]!, 40)).time;
    const r = await S.api(app).get(searchUrl({ arriveBy: later, mode: "one_off", date }));
    assert.equal(r.status, 200);
    assert.equal(r.body.items.length, 0);
    assert.ok(r.body.suggestions.length >= 1, "«Sin coincidencias» trae sugerencias");
    const widen = r.body.suggestions.find((s: { kind: string }) => s.kind === "widen_time");
    assert.ok(widen, "sugiere ampliar el horario");
    assert.ok(widen.wouldMatch >= 1);
    assert.ok(typeof widen.message === "string" && widen.message.length > 0);
    // aplicar la sugerencia produce el resultado anunciado
    const applied = await S.api(app).get(searchUrl({ arriveBy: later, mode: "one_off", date, toleranceMinutes: String(widen.apply.toleranceMinutes) }));
    assert.equal(applied.body.items.length, widen.wouldMatch);
  });

  test("modo semanal: recurrencia, días y categoría", async () => {
    // serie publicada por la API (el mismo camino que usa la app)
    const driver = S.api(app, tokens.ana);
    const tomorrow = S.addDaysIso(S.madrid(new Date()).date, 1);
    const published = await driver.post("/v1/me/routes", {
      vehicleId: w.vehicleId, provinceId: w.provinceId, category: "university",
      origin: { lat: S.SEVILLA.palomares.lat, lng: S.SEVILLA.palomares.lng, label: "Palomares del Río" },
      destination: { lat: S.SEVILLA.trabajo.lat, lng: S.SEVILLA.trabajo.lng, label: "Sevilla (Trabajo)" },
      stops: [{ lat: S.SEVILLA.mairena.lat, lng: S.SEVILLA.mairena.lng, label: "Mairena del Aljarafe" }],
      frequency: "daily_workdays", outboundLocal: "07:00", returnLocal: "15:00", startDate: tomorrow, seats: 3, maxDetourMinutes: 5, pickupOnRoute: false
    }, { "Idempotency-Key": S.idemKey() });
    assert.equal(published.status, 201, JSON.stringify(published.body));
    const first = published.body.trips.find((t: { leg: string }) => t.leg === "outbound");
    const arrivalLocal = S.madrid(new Date(await (async () => {
      const row = await pool.query<{ arrive: Date }>(
        `select t.departure_at + (select coalesce(sum(duration_s),0) from trip_segments where trip_id=t.id) * interval '1 second' as arrive
           from trips t where t.id=$1`, [first.id]);
      return row.rows[0]!.arrive;
    })())).time;
    const r = await S.api(app).get(searchUrl({ arriveBy: arrivalLocal, mode: "weekly", weekdays: "mon,tue,wed,thu,fri", category: "university", onlyWithSeats: "true" }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.items.length >= 1, "encuentra la ida de la serie");
    const item = r.body.items[0];
    assert.ok(item.seriesId, "los resultados semanales llevan seriesId");
    assert.equal(item.recurrence.fullMatch, true);
    assert.deepEqual(item.recurrence.weekdays, ["mon", "tue", "wed", "thu", "fri"]);
    assert.equal(item.return.available, true);
    assert.equal(item.return.departsLocal, "15:00");
    const wrongCategory = await S.api(app).get(searchUrl({ arriveBy: arrivalLocal, mode: "weekly", category: "hospital" }));
    assert.equal(wrongCategory.body.items.length, 0);
  });

  test("origen/destino fuera de la provincia, falta de fecha, días inválidos y provincia desconocida", async () => {
    const guest = S.api(app);
    const base = { arriveBy: "08:30", mode: "one_off", date: S.madrid(new Date()).date };
    const originOut = await guest.get(`/v1/search/trips?${new URLSearchParams({
      provinceId: w.provinceId, originLat: "37.2614", originLng: "-6.9447", ...SEARCH_DEST, ...base })}`);
    assert.equal(originOut.status, 422);
    assert.equal(S.codeOf(originOut), "ORIGIN_OUTSIDE_PROVINCE");
    const destOut = await guest.get(`/v1/search/trips?${new URLSearchParams({
      provinceId: w.provinceId, ...SEARCH_ORIGIN, destLat: "37.2614", destLng: "-6.9447", ...base })}`);
    assert.equal(destOut.status, 422);
    assert.equal(S.codeOf(destOut), "DESTINATION_OUTSIDE_PROVINCE");
    const noDate = await guest.get(searchUrl({ arriveBy: "08:30", mode: "one_off" }));
    assert.equal(S.codeOf(noDate), "SEARCH_DATE_REQUIRED");
    const badDays = await guest.get(searchUrl({ arriveBy: "08:30", mode: "weekly", weekdays: "lunes,martes" }));
    assert.equal(S.codeOf(badDays), "INVALID_SEARCH_WEEKDAYS");
    const unknown = await guest.get(`/v1/search/trips?${new URLSearchParams({
      provinceId: "00000000-0000-4000-8000-000000000000", ...SEARCH_ORIGIN, ...SEARCH_DEST, ...base })}`);
    assert.equal(unknown.status, 404);
    assert.equal(S.codeOf(unknown), "PROVINCE_NOT_FOUND");
    const invalid = await guest.get(`/v1/search/trips?provinceId=${w.provinceId}&arriveBy=8am`);
    assert.equal(invalid.status, 400);
    assert.equal(S.codeOf(invalid), "VALIDATION_ERROR");
  });

  test("no mezcla provincias: un viaje de otra provincia no aparece", async () => {
    const departure = S.hoursAfter(new Date(), 2);
    await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { departureAt: departure });
    const other = await S.seedOtherProvince(pool);
    const r = await S.api(app).get(`/v1/search/trips?${new URLSearchParams({
      provinceId: other, originLat: "37.5", originLng: "-4.0", destLat: "37.6", destLng: "-4.1",
      arriveBy: "19:00", mode: "one_off", date: S.madrid(departure).date })}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.items.length, 0);
  });

  test("limitación de peticiones: 429 RATE_LIMITED con el formato estándar", async () => {
    const previous = process.env.TRIPS_RATE_SEARCH_PER_MINUTE;
    process.env.TRIPS_RATE_SEARCH_PER_MINUTE = "2";
    const limited = await S.buildTripsApp(pool);
    try {
      const url = searchUrl({ arriveBy: "08:30", mode: "one_off", date: S.madrid(new Date()).date });
      const a = S.api(limited);
      assert.equal((await a.get(url)).status, 200);
      assert.equal((await a.get(url)).status, 200);
      const third = await a.get(url);
      assert.equal(third.status, 429);
      assert.equal(S.codeOf(third), "RATE_LIMITED");
      assert.ok(third.body.requestId);
    } finally {
      await limited.close();
      if (previous === undefined) delete process.env.TRIPS_RATE_SEARCH_PER_MINUTE;
      else process.env.TRIPS_RATE_SEARCH_PER_MINUTE = previous;
    }
  });
});

describe("valoraciones del conductor (PublicUser)", () => {
  /** Conductor tal y como lo ve un invitado en el primer resultado de una búsqueda. */
  const searchedDriver = async (): Promise<{ id: string; ratingAverage: number | null; ratingCount: number }> => {
    const departure = S.hoursAfter(new Date(), 2);
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { departureAt: departure });
    const arrive = S.madrid(t.arrivals[2]!).time;
    const r = await S.api(app).get(searchUrl({ arriveBy: arrive, mode: "one_off", date: S.madrid(departure).date }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.items[0].driver;
  };

  test("sin proveedor: se leen de profiles.rating_sum/rating_count si existen (migración 030 de `live`) y, si no, null/0", async () => {
    resetRatingColumnCache();
    const columns = (await pool.query<{ n: number }>(
      `select count(*)::int as n from information_schema.columns
        where table_schema='public' and table_name='profiles' and column_name in ('rating_sum','rating_count')`
    )).rows[0]!.n === 2;
    const driver = await searchedDriver();
    if (columns) {
      assert.equal(driver.ratingAverage, 4.8, "154 / 32 = 4,8125 → 4,8 (un decimal, mitad hacia arriba)");
      assert.equal(driver.ratingCount, 32);
    } else {
      assert.equal(driver.ratingAverage, null, "sin datos de valoraciones: null, nunca un número inventado");
      assert.equal(driver.ratingCount, 0);
    }
  });

  test("un proveedor registrado (`registerRatingSummaryProvider`) manda sobre la lectura directa y se puede retirar", async () => {
    registerRatingSummaryProvider(async (_db, ids) => new Map(ids.map((id): [string, { average: number; count: number }] => [id, { average: 3.5, count: 2 }])));
    try {
      const driver = await searchedDriver();
      assert.equal(driver.ratingAverage, 3.5);
      assert.equal(driver.ratingCount, 2);
    } finally {
      registerRatingSummaryProvider(null);
    }
  });
});

describe("detalle del viaje (pantalla 12)", () => {
  test("invitado: coordenadas aproximadas, sin matrícula, tramos con plazas y precio «Por definir»", async () => {
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, {
      stops: [S.SEVILLA.palomares, { ...S.SEVILLA.mairena, optional: true, detourMinutes: 4 }, S.SEVILLA.trabajo]
    });
    const r = await S.api(app).get(`/v1/trips/${t.tripId}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.viewer.relation, "public");
    assert.equal(r.body.viewer.precision, "approximate");
    assert.equal(r.body.vehicle.plate, null);
    assert.equal(r.body.vehicle.plateHint, w.plate.slice(-3));
    assert.equal(r.body.vehicle.displayName, "Seat Arona");
    assert.equal(r.body.vehicle.color, "Gris");
    assert.equal(r.body.stops.length, 3);
    for (const stop of r.body.stops) {
      assert.equal(stop.location.precision, "approximate");
      assert.equal(Math.round(stop.location.lat * 1000) / 1000, stop.location.lat, "3 decimales");
    }
    assert.equal(r.body.stops[1].optional, true);
    assert.equal(r.body.stops[1].detourMinutes, 4);
    assert.equal(r.body.totals.detourMinutes, 4);
    assert.equal(r.body.seats.perSegment.length, 2);
    assert.equal(r.body.seats.available, 3);
    assert.deepEqual(r.body.price, { cents: null, currency: "EUR", status: "pending_definition" });
    assert.equal(r.body.breakdownAvailable, true);
    assert.equal(r.body.owner, null);
    assert.ok(!JSON.stringify(r.body).includes(w.plate));
  });

  test("conductor: coordenadas precisas, matrícula completa y bandeja `owner`; pasajero confirmado: precisas y matrícula", async () => {
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId);
    await S.seedRequest(pool, t.tripId, w.laura, 0, 2, { status: "pending" });
    await S.seedRequest(pool, t.tripId, w.miguel, 1, 2, { status: "confirmed" });

    const driver = await S.api(app, tokens.ana).get(`/v1/trips/${t.tripId}`);
    assert.equal(driver.body.viewer.relation, "driver");
    assert.equal(driver.body.viewer.precision, "precise");
    assert.equal(driver.body.vehicle.plate, w.plate);
    assert.equal(driver.body.stops[0].location.lat, S.SEVILLA.palomares.lat);
    assert.equal(driver.body.owner.pendingRequests, 1);
    assert.deepEqual(driver.body.owner.confirmedPassengers.map((p: { firstName: string }) => p.firstName), ["Miguel"]);
    assert.equal(driver.body.canRequest, false);

    const passenger = await S.api(app, tokens.miguel).get(`/v1/trips/${t.tripId}`);
    assert.equal(passenger.body.viewer.relation, "passenger");
    assert.equal(passenger.body.viewer.precision, "precise");
    assert.equal(passenger.body.vehicle.plate, w.plate);
    assert.equal(passenger.body.owner, null);

    const requester = await S.api(app, tokens.laura).get(`/v1/trips/${t.tripId}`);
    assert.equal(requester.body.viewer.relation, "requester");
    assert.equal(requester.body.viewer.precision, "approximate", "con la solicitud solo pendiente no se revela la posición exacta");
    assert.equal(requester.body.vehicle.plate, null);
    assert.ok(requester.body.viewer.openRequest, "devuelve la solicitud abierta");
  });

  test("borradores y cancelados: 404 para todos salvo el conductor", async () => {
    const draft = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { status: "draft" });
    const cancelled = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { status: "cancelled" });
    for (const id of [draft.tripId, cancelled.tripId]) {
      const guest = await S.api(app).get(`/v1/trips/${id}`);
      assert.equal(guest.status, 404);
      assert.equal(S.codeOf(guest), "TRIP_NOT_FOUND");
      assert.equal((await S.api(app, tokens.miguel).get(`/v1/trips/${id}`)).status, 404);
      assert.equal((await S.api(app, tokens.ana).get(`/v1/trips/${id}`)).status, 200);
    }
    assert.equal((await S.api(app).get(`/v1/trips/${"00000000-0000-4000-8000-000000000000"}`)).status, 404);
  });

  test("contexto de búsqueda: «Tú te subes aquí» y bajada marcados; `canRequest` para un pasajero", async () => {
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId);
    const r = await S.api(app, tokens.miguel).get(`/v1/trips/${t.tripId}?pickupLat=37.3447&pickupLng=-6.0613&dropoffStopSeq=2`);
    assert.equal(r.status, 200);
    assert.equal(r.body.stops[1].isYourPickup, true);
    assert.equal(r.body.stops[2].isYourDropoff, true);
    assert.equal(r.body.stops[0].isYourPickup, false);
    assert.equal(r.body.canRequest, true);
    assert.equal(r.body.cannotRequestReason, null);
    const ownTrip = await S.api(app, tokens.ana).get(`/v1/trips/${t.tripId}`);
    assert.equal(ownTrip.body.canRequest, false);
  });

  test("sesión inválida → 401 (no se trata como invitado)", async () => {
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId);
    const r = await S.api(app, "mvc_sess_token-falso").get(`/v1/trips/${t.tripId}`);
    assert.equal(r.status, 401);
  });
});

describe("puntos de recogida A/B (pantalla 13)", () => {
  test("requiere sesión", async () => {
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId);
    const r = await S.api(app).get(`/v1/trips/${t.tripId}/pickup-points?lat=37.346&lng=-6.06`);
    assert.equal(r.status, 401);
  });

  test("propone paradas declaradas cercanas, ordenadas por distancia a pie, dentro de la provincia", async () => {
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId);
    const r = await S.api(app, tokens.miguel).get(`/v1/trips/${t.tripId}/pickup-points?lat=37.3460&lng=-6.0600&limit=2`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.dropoff.stopSeq, 2);
    assert.ok(r.body.proposals.length >= 1);
    const first = r.body.proposals[0];
    assert.equal(first.code, "A");
    assert.equal(first.recommended, true);
    assert.equal(first.source, "driver_stop");
    assert.equal(first.name, "Mairena del Aljarafe");
    assert.equal(first.fromSegmentSeq, 1);
    assert.equal(first.detour.source, "stop");
    assert.equal(first.walk.estimated, true);
    assert.ok(first.id.startsWith("pp1_"), "id opaco");
    assert.equal(first.location.precision, "precise", "los puntos de encuentro propuestos son precisos");
    assert.ok(r.body.safetyNotice.length > 10);
    const walks = r.body.proposals.map((p: { walk: { distanceM: number } }) => p.walk.distanceM);
    assert.deepEqual([...walks].sort((a: number, b: number) => a - b), walks, "ordenadas por distancia a pie");
  });

  test("«Recoger en ruta»: propone el punto más cercano de la ruta (route_projection) con desvío estimado", async () => {
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { pickupOnRoute: true, maxDetourMinutes: 10 });
    // punto junto a la ruta entre Mairena y el destino
    const r = await S.api(app, tokens.miguel).get(`/v1/trips/${t.tripId}/pickup-points?lat=37.3680&lng=-6.0230&limit=3`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const projection = r.body.proposals.find((p: { source: string }) => p.source === "route_projection");
    assert.ok(projection, "incluye una propuesta sobre la ruta");
    assert.equal(projection.detour.source, "estimate");
    assert.equal(projection.fromSegmentSeq, 1);
    assert.ok(projection.detour.minutes <= 10);
    const inside = await pool.query<{ ok: boolean }>(
      `select ST_CoveredBy(ST_SetSRID(ST_Point($1,$2),4326), geom) as ok from provinces where id=$3`,
      [projection.location.lng, projection.location.lat, w.provinceId]
    );
    assert.equal(inside.rows[0]!.ok, true, "el punto propuesto está dentro de la provincia");
  });

  test("lejos de la ruta no hay propuestas (`proposals: []`) y los errores son estables", async () => {
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId);
    const miguel = S.api(app, tokens.miguel);
    const far = await miguel.get(`/v1/trips/${t.tripId}/pickup-points?lat=37.9&lng=-5.2`);
    assert.equal(far.status, 200);
    assert.deepEqual(far.body.proposals, []);
    const badDropoff = await miguel.get(`/v1/trips/${t.tripId}/pickup-points?lat=37.346&lng=-6.06&dropoffStopSeq=7`);
    assert.equal(badDropoff.status, 422);
    assert.equal(S.codeOf(badDropoff), "DROPOFF_STOP_INVALID");
    const dropoffZero = await miguel.get(`/v1/trips/${t.tripId}/pickup-points?lat=37.346&lng=-6.06&dropoffStopSeq=0`);
    assert.equal(dropoffZero.status, 400, "la bajada en la parada 0 ni siquiera es una petición válida");
    const own = await S.api(app, tokens.ana).get(`/v1/trips/${t.tripId}/pickup-points?lat=37.346&lng=-6.06`);
    assert.equal(own.status, 409);
    assert.equal(S.codeOf(own), "DRIVER_CANNOT_REQUEST_OWN_TRIP");
    const done = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { status: "completed", departureAt: S.hoursAfter(new Date(), -5) });
    const closed = await miguel.get(`/v1/trips/${done.tripId}/pickup-points?lat=37.346&lng=-6.06`);
    assert.equal(closed.status, 409);
    assert.equal(S.codeOf(closed), "TRIP_NOT_BOOKABLE");
    const draft = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { status: "draft" });
    assert.equal((await miguel.get(`/v1/trips/${draft.tripId}/pickup-points?lat=37.346&lng=-6.06`)).status, 404);
  });

  test("con geocodificador: nombre y dirección salen de la geocodificación inversa", async () => {
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId);
    const r = await S.api(app, tokens.miguel).get(`/v1/trips/${t.tripId}/pickup-points?lat=37.3460&lng=-6.0600`);
    assert.equal(r.status, 200);
    // En esta prueba el geocodificador falso devuelve siempre la misma dirección.
    const named = r.body.proposals[0];
    assert.ok(named.name, "la propuesta lleva nombre");
  });
});

describe("presupuesto (`quote`): «Por definir» frente a tarifa aprobada", () => {
  test("sin tarifa aprobada → todo `pending_definition`; una tarifa borrador/retirada no cuenta", async () => {
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId);
    await S.seedApprovedTariff(pool, { rateMicrosPerKm: 100_000, passengerCommissionBps: 0, status: "draft" });
    await S.seedApprovedTariff(pool, { rateMicrosPerKm: 100_000, passengerCommissionBps: 0, status: "retired" });
    const r = await S.api(app, tokens.miguel).post(`/v1/trips/${t.tripId}/quote`, {});
    assert.equal(r.status, 200);
    const q = r.body.quote;
    assert.equal(q.state, "pending_definition");
    assert.deepEqual(q.tariff, { state: "none_approved", version: null });
    for (const key of ["contribution", "managementFee", "total"]) {
      assert.deepEqual(q[key], { cents: null, currency: "EUR", status: "pending_definition" }, key);
    }
    assert.equal(q.basis.rateMicrosPerKm, null);
    assert.equal(q.basis.roadDistanceM, t.segments[0]!.distanceM + t.segments[1]!.distanceM);
    assert.equal(await S.count(pool, `select 1 from quote_snapshots`), 0, "el presupuesto no escribe instantáneas");
    assert.equal(await S.count(pool, `select 1 from tariff_versions where status='approved'`), 0, "este módulo nunca activa una tarifa");
  });

  test("con tarifa aprobada (sembrada solo en la BD de pruebas): aportación = km × tarifa, redondeo half-up, en céntimos enteros", async () => {
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId);
    await S.seedApprovedTariff(pool, { rateMicrosPerKm: 100_000, passengerCommissionBps: 0 }); // 0,10 €/km: valor de prueba
    const total = t.segments[0]!.distanceM + t.segments[1]!.distanceM;
    const r = await S.api(app).post(`/v1/trips/${t.tripId}/quote`, {});
    const q = r.body.quote;
    assert.equal(q.state, "defined");
    assert.equal(q.tariff.state, "approved");
    assert.equal(q.tariff.version, 1);
    const expected = Math.round((total * 100_000) / 10_000_000);
    assert.deepEqual(q.contribution, { cents: expected, currency: "EUR", status: "defined" });
    assert.deepEqual(q.managementFee, { cents: 0, currency: "EUR", status: "defined" });
    assert.deepEqual(q.total, { cents: expected, currency: "EUR", status: "defined" });
    assert.ok(Number.isInteger(q.total.cents));
    assert.equal(q.weekly, null);
    assert.equal(await S.count(pool, `select 1 from quote_snapshots`), 0, "calcular no fija nada");
  });

  test("tramo parcial: solo se cobra la distancia del tramo del pasajero y el tope se aplica", async () => {
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId);
    await S.seedApprovedTariff(pool, { rateMicrosPerKm: 100_000, passengerCommissionBps: 500, capCents: 50 });
    const r = await S.api(app).post(`/v1/trips/${t.tripId}/quote`, { fromSegmentSeq: 1, toSegmentSeq: 2 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.roadDistanceM, t.segments[1]!.distanceM);
    const uncapped = Math.round((t.segments[1]!.distanceM * 100_000) / 10_000_000);
    const contribution = Math.min(uncapped, 50);
    assert.equal(r.body.quote.contribution.cents, contribution);
    assert.equal(r.body.quote.managementFee.cents, Math.round((contribution * 500) / 10_000));
    assert.equal(r.body.quote.total.cents, contribution + Math.round((contribution * 500) / 10_000));
    assert.equal(r.body.seatsAvailable, 3);
  });

  test("tarifa sin comisión definida: aportación definida pero comisión y total «Por definir» (no se inventa)", async () => {
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId);
    await S.seedApprovedTariff(pool, { rateMicrosPerKm: 100_000, passengerCommissionBps: null });
    const r = await S.api(app).post(`/v1/trips/${t.tripId}/quote`, {});
    const q = r.body.quote;
    assert.equal(q.state, "pending_definition");
    assert.equal(q.contribution.status, "defined");
    assert.equal(q.managementFee.status, "pending_definition");
    assert.equal(q.total.status, "pending_definition");
    assert.equal(q.total.cents, null);
  });

  test("errores: forma de tramo inválida, tramo fuera de rango, viaje cerrado o inexistente", async () => {
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId);
    const miguel = S.api(app, tokens.miguel);
    const mixed = await miguel.post(`/v1/trips/${t.tripId}/quote`, { pickupPointId: "pp1_x", fromSegmentSeq: 0, toSegmentSeq: 1 });
    assert.equal(mixed.status, 422);
    assert.equal(S.codeOf(mixed), "INVALID_REQUEST_SHAPE");
    const outOfRange = await miguel.post(`/v1/trips/${t.tripId}/quote`, { fromSegmentSeq: 0, toSegmentSeq: 9 });
    assert.equal(outOfRange.status, 422);
    assert.equal(S.codeOf(outOfRange), "INVALID_SEGMENT_RANGE");
    const garbage = await miguel.post(`/v1/trips/${t.tripId}/quote`, { pickupPointId: "pp1_basura" });
    assert.equal(garbage.status, 422);
    assert.equal(S.codeOf(garbage), "PICKUP_POINT_INVALID");
    const done = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { status: "completed", departureAt: S.hoursAfter(new Date(), -5) });
    assert.equal(S.codeOf(await miguel.post(`/v1/trips/${done.tripId}/quote`, {})), "TRIP_NOT_BOOKABLE");
    assert.equal((await miguel.post(`/v1/trips/${"00000000-0000-4000-8000-000000000000"}/quote`, {})).status, 404);
  });

  test("el punto de recogida propuesto se revalida en el servidor: un id manipulado no abre nada", async () => {
    const t = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { pickupOnRoute: true, maxDetourMinutes: 3 });
    const miguel = S.api(app, tokens.miguel);
    const forge = (id: string, patch: Record<number, unknown>): string => {
      const decoded = JSON.parse(Buffer.from(id.slice(4), "base64url").toString("utf8")) as unknown[];
      for (const [index, value] of Object.entries(patch)) decoded[Number(index)] = value;
      return `pp1_${Buffer.from(JSON.stringify(decoded)).toString("base64url")}`;
    };

    // 1) parada declarada: las coordenadas del id se ignoran, se relee la parada real del viaje
    const stopPp = await miguel.get(`/v1/trips/${t.tripId}/pickup-points?lat=37.3460&lng=-6.0600`);
    const stopId: string = stopPp.body.proposals.find((p: { source: string }) => p.source === "driver_stop").id;
    const ok = await miguel.post(`/v1/trips/${t.tripId}/quote`, { pickupPointId: stopId });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.pickup.location.precision, "precise");
    assert.equal(ok.body.pickup.label, "Mairena del Aljarafe");
    const moved = await miguel.post(`/v1/trips/${t.tripId}/quote`, { pickupPointId: forge(stopId, { 2: 37.2614, 3: -6.9447 }) });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.pickup.location.lat, S.SEVILLA.mairena.lat, "las coordenadas manipuladas no cuentan");
    assert.equal(moved.body.pickup.location.lng, S.SEVILLA.mairena.lng);

    // 2) punto sobre la ruta: fuera de la provincia, lejos de la ruta o con desvío excesivo → 422
    const route = await miguel.get(`/v1/trips/${t.tripId}/pickup-points?lat=37.3680&lng=-6.0230&limit=3`);
    const projId: string = route.body.proposals.find((p: { source: string }) => p.source === "route_projection").id;
    assert.equal((await miguel.post(`/v1/trips/${t.tripId}/quote`, { pickupPointId: projId })).status, 200);
    const outside = await miguel.post(`/v1/trips/${t.tripId}/quote`, { pickupPointId: forge(projId, { 2: 37.2614, 3: -6.9447 }) });
    assert.equal(outside.status, 422);
    assert.equal(S.codeOf(outside), "PICKUP_POINT_OUTSIDE_PROVINCE");
    const offRoute = await miguel.post(`/v1/trips/${t.tripId}/quote`, { pickupPointId: forge(projId, { 2: 37.45, 3: -5.8 }) });
    assert.equal(offRoute.status, 422);
    assert.equal(S.codeOf(offRoute), "PICKUP_NOT_ON_ROUTE");
    // otro viaje: el id no es transferible
    const other = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { pickupOnRoute: true });
    const crossTrip = await miguel.post(`/v1/trips/${other.tripId}/quote`, { pickupPointId: projId });
    assert.equal(crossTrip.status, 422);
    assert.equal(S.codeOf(crossTrip), "PICKUP_POINT_INVALID");
    // viaje que solo recoge en paradas: un punto «en ruta» se rechaza
    const stopsOnly = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { pickupOnRoute: false });
    const stopsOnlyId = forge(projId, { 1: stopsOnly.tripId });
    const refused = await miguel.post(`/v1/trips/${stopsOnly.tripId}/quote`, { pickupPointId: stopsOnlyId });
    assert.equal(refused.status, 422);
    assert.equal(S.codeOf(refused), "PICKUP_NOT_ON_ROUTE");
  });
});
