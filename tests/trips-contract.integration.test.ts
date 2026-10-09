import test, { after, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { tripDetail } from "../src/modules/trips/detail-service.js";
import { driverReadiness, driverRequests } from "../src/modules/trips/driver-service.js";
import { pickupPoints, quoteTrip } from "../src/modules/trips/endpoints.js";
import { listFavorites } from "../src/modules/trips/favorites-service.js";
import { tripsOverview } from "../src/modules/trips/overview-service.js";
import { loadRequestDetail } from "../src/modules/trips/request-detail.js";
import { planRoute } from "../src/modules/trips/route-planner.js";
import { getRoutine } from "../src/modules/trips/routine-service.js";
import { mapCars, searchInputFromQuery, searchTrips } from "../src/modules/trips/search-service.js";
import { loadWeeklyReservation, previewWeekly } from "../src/modules/trips/weekly.js";
import { confirmProviderPayment } from "../src/services/reservation-service.js";
import * as S from "./trips-support.js";

/**
 * Contrato del módulo `trips`: inventario OpenAPI, coherencia con docs/contracts/trips.md y — lo más importante — que el
 * schema de respuesta de cada endpoint NO recorta ni inventa campos respecto a lo que devuelve el servicio.
 * Base de datos propia: mvc_trips. No toca docs/openapi.json (lo regenera el orquestador).
 */
let pool: pg.Pool;
let app: FastifyInstance;
let w: S.World;
let tokens: { ana: string; miguel: string; laura: string };

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

/** Los 31 endpoints del módulo (BUILD_BRIEF §9): método y ruta tal y como los publica OpenAPI. */
const EXPECTED_ENDPOINTS = [
  "GET /v1/trip-categories",
  "GET /v1/trips/map",
  "GET /v1/search/trips",
  "GET /v1/trips/{tripId}",
  "GET /v1/trips/{tripId}/pickup-points",
  "POST /v1/trips/{tripId}/quote",
  "POST /v1/trips/{tripId}/requests",
  "GET /v1/ride-requests/{requestId}",
  "POST /v1/ride-requests/{requestId}/withdraw",
  "POST /v1/ride-requests/{requestId}/decision",
  "POST /v1/trips/{tripId}/weekly-requests/preview",
  "POST /v1/trips/{tripId}/weekly-requests",
  "GET /v1/weekly-reservations/{id}",
  "POST /v1/weekly-reservations/{id}/decision",
  "POST /v1/weekly-reservations/{id}/withdraw",
  "GET /v1/me/driver/requests",
  "GET /v1/me/driver/readiness",
  "POST /v1/me/routes/plan",
  "POST /v1/me/routes",
  "GET /v1/me/trips/overview",
  "GET /v1/me/favorites",
  "POST /v1/me/favorites",
  "PATCH /v1/me/favorites/{favoriteId}",
  "DELETE /v1/me/favorites/{favoriteId}",
  "GET /v1/me/routine",
  "POST /v1/me/routine/entries",
  "PATCH /v1/me/routine/entries/{entryId}",
  "DELETE /v1/me/routine/entries/{entryId}",
  "POST /v1/me/routine/suspensions",
  "DELETE /v1/me/routine/suspensions/{weekStart}",
  "PUT /v1/me/routine/weekly-offer"
];

/** Sin sesión obligatoria (opcional = funciona de invitado y personaliza si hay sesión). */
const OPTIONAL_AUTH = ["GET /v1/trips/map", "GET /v1/search/trips", "GET /v1/trips/{tripId}", "POST /v1/trips/{tripId}/quote"];
const PUBLIC = ["GET /v1/trip-categories"];
const IDEMPOTENT = ["POST /v1/trips/{tripId}/requests", "POST /v1/trips/{tripId}/weekly-requests", "POST /v1/me/routes"];

type Operation = {
  summary?: string; description?: string; tags?: string[]; security?: Array<Record<string, unknown>>;
  parameters?: Array<{ in: string; name: string; required?: boolean }>; responses?: Record<string, { description?: string }>;
};

function operations(): Map<string, Operation> {
  const spec = app.swagger() as { paths: Record<string, Record<string, Operation>> };
  const out = new Map<string, Operation>();
  for (const [path, byMethod] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(byMethod)) out.set(`${method.toUpperCase()} ${path}`, operation);
  }
  return out;
}

describe("inventario OpenAPI", () => {
  test("están registrados exactamente los 31 endpoints del contrato, ni uno más ni uno menos", () => {
    assert.deepEqual([...operations().keys()].sort(), [...EXPECTED_ENDPOINTS].sort());
    assert.equal(EXPECTED_ENDPOINTS.length, 31);
  });

  test("cada operación: resumen en español, etiqueta, seguridad coherente, 2xx documentado y errores con descripción", () => {
    const english = /^(get|create|list|update|delete|send|post|put|patch|fetch|retrieve)\b/i;
    for (const [key, operation] of operations()) {
      assert.ok(operation.summary && operation.summary.length >= 8, `${key}: falta el resumen`);
      assert.ok(!english.test(operation.summary!), `${key}: el resumen debe estar en español («${operation.summary}»)`);
      assert.ok((operation.tags ?? []).length === 1, `${key}: una etiqueta`);
      assert.ok(operation.description === undefined || operation.description.length >= 20, `${key}: descripción demasiado corta`);

      const codes = Object.keys(operation.responses ?? {});
      assert.ok(codes.some(code => code.startsWith("2")), `${key}: sin respuesta 2xx`);
      assert.ok(codes.includes("429"), `${key}: documenta el límite de peticiones`);
      for (const code of codes.filter(c => Number(c) >= 400)) {
        const description = operation.responses![code]!.description ?? "";
        assert.ok(description.length > 20 && description !== "Default Response", `${key} ${code}: descripción de error`);
      }
      if (PUBLIC.includes(key)) {
        assert.equal(operation.security, undefined, `${key}: pública`);
      } else if (OPTIONAL_AUTH.includes(key)) {
        assert.deepEqual(operation.security, [{ bearerAuth: [] }, {}], `${key}: sesión opcional`);
        assert.ok(codes.includes("401"), `${key}: con una sesión inválida responde 401`);
      } else {
        assert.deepEqual(operation.security, [{ bearerAuth: [] }], `${key}: sesión obligatoria`);
        assert.ok(codes.includes("401"), `${key}: documenta el 401`);
        assert.ok(codes.includes("403") || key === "GET /v1/search/trips", `${key}: documenta el 403 de rol`);
      }
    }
  });

  test("los parámetros de ruta están declarados y `Idempotency-Key` solo en las tres creaciones", () => {
    for (const [key, operation] of operations()) {
      const path = key.split(" ")[1]!;
      const declared = (operation.parameters ?? []).filter(p => p.in === "path").map(p => p.name).sort();
      const expected = [...path.matchAll(/\{(\w+)\}/g)].map(m => m[1]!).sort();
      assert.deepEqual(declared, expected, `${key}: parámetros de ruta`);
      assert.ok((operation.parameters ?? []).filter(p => p.in === "path").every(p => p.required === true), `${key}: obligatorios`);
      const hasKey = (operation.parameters ?? []).some(p => p.in === "header" && p.name.toLowerCase() === "idempotency-key");
      assert.equal(hasKey, IDEMPOTENT.includes(key), `${key}: Idempotency-Key`);
    }
  });

  test("el índice de docs/contracts/trips.md lista los mismos endpoints (con `:param` en vez de `{param}`)", () => {
    const doc = fs.readFileSync(new URL("../docs/contracts/trips.md", import.meta.url), "utf8");
    const rows = [...doc.matchAll(/^\|\s*\d+\s*\|\s*`(GET|POST|PUT|PATCH|DELETE) (\/v1\/[^`]+)`/gm)]
      .map(m => `${m[1]} ${m[2]!.replace(/:(\w+)/g, "{$1}")}`);
    assert.deepEqual(rows.sort(), [...EXPECTED_ENDPOINTS].sort(), "el documento y el código deben listar lo mismo");
  });
});

/* ───────────────────────────── La forma del servicio = la forma HTTP ───────────────────────────── */

/**
 * Diferencias de ESTRUCTURA (claves y tipos), no de valores. Detecta campos que el schema de respuesta recorta en
 * silencio o que no corresponden al servicio. Los valores volátiles (cuentas atrás, «ahora») no importan aquí.
 */
function shapeDiff(direct: unknown, http: unknown, at = "$"): string[] {
  if (direct === null || direct === undefined || http === null || http === undefined) {
    if ((direct == null) === (http == null)) return [];
    return [`${at}: ${direct == null ? "nulo" : "con valor"} en el servicio y ${http == null ? "nulo" : "con valor"} por HTTP`];
  }
  if (Array.isArray(direct) || Array.isArray(http)) {
    if (!Array.isArray(direct) || !Array.isArray(http)) return [`${at}: lista en uno y no en el otro`];
    if (direct.length !== http.length) return [`${at}: ${direct.length} elementos en el servicio y ${http.length} por HTTP`];
    return direct.flatMap((item, index) => shapeDiff(item, http[index], `${at}[${index}]`));
  }
  if (typeof direct === "object" || typeof http === "object") {
    if (typeof direct !== "object" || typeof http !== "object") return [`${at}: ${typeof direct} frente a ${typeof http}`];
    const a = direct as Record<string, unknown>;
    const b = http as Record<string, unknown>;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap(key => {
      if (!(key in b)) return [`${at}.${key}: el schema de respuesta lo recorta`];
      if (!(key in a)) return [`${at}.${key}: aparece por HTTP y no en el servicio`];
      return shapeDiff(a[key], b[key], `${at}.${key}`);
    });
  }
  return typeof direct === typeof http ? [] : [`${at}: ${typeof direct} frente a ${typeof http}`];
}

describe("la forma que devuelve cada servicio es exactamente la que sale por HTTP", () => {
  const check = async (name: string, direct: () => Promise<unknown>, http: Promise<S.ApiResult>, expectedStatus = 200) => {
    const result = await http;
    assert.equal(result.status, expectedStatus, `${name}: ${JSON.stringify(result.body)}`);
    const diff = shapeDiff(JSON.parse(JSON.stringify(await direct())), result.body);
    assert.deepEqual(diff, [], `${name}: ${diff.join(" | ")}`);
  };

  test("lecturas con datos reales (sin y con tarifa aprobada de PRUEBA): nada recortado por el schema", async () => {
    const tomorrow = S.addDaysIso(S.madrid(new Date()).date, 1);
    const trip = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { departureAt: new Date(`${tomorrow}T10:00:00Z`), category: "work" });
    const nextMonday = S.addDaysIso(S.mondayOfDate(S.madrid(new Date()).date), 7);
    const miguelP = S.principalOf(w.miguel);
    const lauraP = S.principalOf(w.laura);
    const anaP = S.principalOf(w.ana, ["driver", "passenger"]);
    const planner = { routeProvider: new S.FakeRouteProvider(), geocodingProvider: new S.FakeGeocoder() };
    const arriveBy = S.madrid(trip.arrivals[2]!).time;
    const miguel = S.api(app, tokens.miguel);
    const laura = S.api(app, tokens.laura);
    const ana = S.api(app, tokens.ana);
    const guest = S.api(app);

    // Serie semanal publicada por la API (con vuelta) para las reservas semanales.
    const published = await ana.post("/v1/me/routes", {
      vehicleId: w.vehicleId, provinceId: w.provinceId, category: "work",
      origin: { lat: S.SEVILLA.palomares.lat, lng: S.SEVILLA.palomares.lng, label: "Palomares del Río" },
      destination: { lat: S.SEVILLA.trabajo.lat, lng: S.SEVILLA.trabajo.lng, label: "Sevilla (Trabajo)" },
      stops: [{ lat: S.SEVILLA.mairena.lat, lng: S.SEVILLA.mairena.lng, label: "Mairena del Aljarafe" }],
      frequency: "daily_workdays", outboundLocal: "07:00", returnLocal: "15:00", startDate: nextMonday, seats: 3, maxDetourMinutes: 5, pickupOnRoute: false
    }, { "Idempotency-Key": S.idemKey() });
    assert.equal(published.status, 201, JSON.stringify(published.body));
    const anchor: string = published.body.trips.find((t: { leg: string }) => t.leg === "outbound").id;

    const pickupOf = async (token: string, tripId: string): Promise<string> => {
      const r = await S.api(app, token).get(`/v1/trips/${tripId}/pickup-points?lat=37.3460&lng=-6.0600`);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body.proposals[0].id as string;
    };
    const searchQuery = (extra: Record<string, string>) => new URLSearchParams({
      provinceId: w.provinceId, originLat: "37.3450", originLng: "-6.0610", destLat: "37.3890", destLng: "-5.9850", arriveBy,
      mode: "one_off", date: tomorrow, ...extra
    });
    const searchInput = (arrive: string) => searchInputFromQuery({
      provinceId: w.provinceId, originLat: 37.345, originLng: -6.061, destLat: 37.389, destLng: -5.985, arriveBy: arrive,
      mode: "one_off", date: tomorrow, weekdays: null
    });

    /** Lecturas que dependen de la tarifa: se repiten sin tarifa aprobada y con una tarifa de PRUEBA sembrada en esta BD. */
    const tariffDependent = async (label: string) => {
      await check(`${label} búsqueda`, () => searchTrips(pool, null, searchInput(arriveBy), w.miguel), miguel.get(`/v1/search/trips?${searchQuery({})}`));
      await check(`${label} búsqueda sin coincidencias (sugerencias)`,
        () => searchTrips(pool, null, searchInput("03:00"), w.miguel), miguel.get(`/v1/search/trips?${searchQuery({ arriveBy: "03:00" })}`));
      await check(`${label} detalle (invitado)`, () => tripDetail(pool, trip.tripId, null, {}), guest.get(`/v1/trips/${trip.tripId}`));
      await check(`${label} detalle (pasajero con recogida)`,
        () => tripDetail(pool, trip.tripId, w.miguel, { pickupLat: 37.346, pickupLng: -6.06 }),
        miguel.get(`/v1/trips/${trip.tripId}?pickupLat=37.346&pickupLng=-6.06`));
      await check(`${label} detalle (conductor)`, () => tripDetail(pool, trip.tripId, w.ana, {}), ana.get(`/v1/trips/${trip.tripId}`));
      const pickupPointId = await pickupOf(tokens.miguel, trip.tripId);
      await check(`${label} presupuesto`, () => quoteTrip(pool, miguelP, trip.tripId, { pickupPointId }),
        miguel.post(`/v1/trips/${trip.tripId}/quote`, { pickupPointId }));
      const weekly = { pickupPointId: await pickupOf(tokens.miguel, anchor), weekdays: ["mon", "tue", "wed", "thu", "fri"], legs: ["outbound", "return"], startDate: nextMonday, weeks: 1 };
      await check(`${label} vista previa semanal`, () => previewWeekly(pool, miguelP, anchor, weekly as never),
        miguel.post(`/v1/trips/${anchor}/weekly-requests/preview`, weekly));
    };

    await check("mapa", () => mapCars(pool, { provinceId: w.provinceId, category: null, onlyWithSeats: false, withinHours: 48, limit: 50 }),
      guest.get(`/v1/trips/map?provinceId=${w.provinceId}&onlyWithSeats=false&withinHours=48&limit=50`));
    await check("puntos de recogida", () => pickupPoints(pool, new S.FakeGeocoder(), miguelP, trip.tripId, { lat: 37.346, lng: -6.06, limit: 2 }),
      miguel.get(`/v1/trips/${trip.tripId}/pickup-points?lat=37.346&lng=-6.06`));
    await tariffDependent("sin tarifa:");

    // Solicitudes simples: pendiente → aceptada (hold) → confirmada, vistas por el pasajero y por el conductor.
    const created = await miguel.post(`/v1/trips/${trip.tripId}/requests`, { pickupPointId: await pickupOf(tokens.miguel, trip.tripId), message: "Hola" });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const requestId: string = created.body.id;
    const both = async (label: string) => {
      await check(`${label}: solicitud (pasajero)`, () => loadRequestDetail(pool, requestId, w.miguel), miguel.get(`/v1/ride-requests/${requestId}`));
      await check(`${label}: solicitud (conductor)`, () => loadRequestDetail(pool, requestId, w.ana), ana.get(`/v1/ride-requests/${requestId}`));
    };
    await both("pendiente");
    const lauraRequest = await laura.post(`/v1/trips/${trip.tripId}/requests`, { pickupPointId: await pickupOf(tokens.laura, trip.tripId) });
    assert.equal(lauraRequest.status, 201, JSON.stringify(lauraRequest.body));
    const weeklyBody = { pickupPointId: await pickupOf(tokens.miguel, anchor), weekdays: ["mon", "tue", "wed", "thu", "fri"], legs: ["outbound", "return"], startDate: nextMonday, weeks: 1 };
    const reservation = await miguel.post(`/v1/trips/${anchor}/weekly-requests`, weeklyBody);
    assert.equal(reservation.status, 201, JSON.stringify(reservation.body));
    const reservationId: string = reservation.body.id;

    const inbox = (query: string, status: "pending" | "open" | "all") => check(`bandeja ${status}`,
      () => driverRequests(pool, anaP, { status, tripId: null, offset: 0, limit: 20 }), ana.get(`/v1/me/driver/requests?${query}`));
    await inbox("status=pending", "pending");
    await inbox("status=all", "all");
    await check("reserva semanal pendiente (pasajero)", () => loadWeeklyReservation(pool, reservationId, w.miguel), miguel.get(`/v1/weekly-reservations/${reservationId}`));
    await check("reserva semanal pendiente (conductor)", () => loadWeeklyReservation(pool, reservationId, w.ana), ana.get(`/v1/weekly-reservations/${reservationId}`));

    const accepted = await ana.post(`/v1/ride-requests/${requestId}/decision`, { decision: "accept" });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    await both("aceptada con hold");
    const acceptedWeekly = await ana.post(`/v1/weekly-reservations/${reservationId}/decision`, { decision: "accept" });
    assert.equal(acceptedWeekly.status, 200, JSON.stringify(acceptedWeekly.body));
    await check("reserva semanal aceptada (pasajero)", () => loadWeeklyReservation(pool, reservationId, w.miguel), miguel.get(`/v1/weekly-reservations/${reservationId}`));
    await inbox("status=open", "open");
    const rejected = await ana.post(`/v1/ride-requests/${lauraRequest.body.id}/decision`, { decision: "reject" });
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
    await check("solicitud rechazada", () => loadRequestDetail(pool, lauraRequest.body.id, w.laura), laura.get(`/v1/ride-requests/${lauraRequest.body.id}`));

    const paid = await confirmProviderPayment(pool, { requestId, providerPaymentId: `pay-${requestId}`, amountCents: 0 });
    assert.equal(paid.status, "confirmed");
    await both("confirmada");
    await inbox("status=all", "all");

    // Mis viajes (pasajero y conductor) con tarjetas de todo tipo.
    for (const role of ["passenger", "driver"] as const) {
      const principal = role === "driver" ? anaP : miguelP;
      const token = role === "driver" ? tokens.ana : tokens.miguel;
      await check(`mis viajes (${role})`, () => tripsOverview(pool, principal, { role, section: "all", offset: 0, limit: 10 }),
        S.api(app, token).get(`/v1/me/trips/overview?role=${role}`));
    }
    await check("mis viajes (Laura, con historial)", () => tripsOverview(pool, lauraP, { role: "passenger", section: "all", offset: 0, limit: 10 }),
      laura.get("/v1/me/trips/overview?role=passenger"));

    // Conductor: requisitos y planificador (ruta correcta y con una parada fuera de provincia).
    await check("requisitos del conductor", () => driverReadiness(pool, anaP), ana.get("/v1/me/driver/readiness"));
    const newcomer = await S.seedUser(pool, "Conductor nuevo", { roles: ["driver"] });
    await check("requisitos de un conductor sin vehículo", () => driverReadiness(pool, S.principalOf(newcomer, ["driver"])),
      S.api(app, await S.sessionTokenFor(pool, newcomer)).get("/v1/me/driver/readiness"));
    const planBody = {
      provinceId: w.provinceId, departureLocal: "07:00",
      origin: { lat: S.SEVILLA.palomares.lat, lng: S.SEVILLA.palomares.lng, label: "Palomares del Río" },
      destination: { lat: S.SEVILLA.trabajo.lat, lng: S.SEVILLA.trabajo.lng, label: "Sevilla (Trabajo)" },
      stops: [{ lat: S.SEVILLA.mairena.lat, lng: S.SEVILLA.mairena.lng, label: "Mairena del Aljarafe", optional: true }]
    };
    await check("ruta planificada", () => planRoute(pool, planner, planBody as never), ana.post("/v1/me/routes/plan", planBody));
    const outside = { ...planBody, stops: [{ lat: S.SEVILLA.huelva.lat, lng: S.SEVILLA.huelva.lng, label: "Huelva (sugerida)" }] };
    await check("ruta con una parada fuera de provincia", () => planRoute(pool, planner, outside as never), ana.post("/v1/me/routes/plan", outside));

    // Favoritos y rutina.
    const home = await miguel.post("/v1/me/favorites", { kind: "home", name: "Casa", address: "Mairena del Aljarafe", lat: S.SEVILLA.mairena.lat, lng: S.SEVILLA.mairena.lng });
    const work = await miguel.post("/v1/me/favorites", { kind: "work", name: "Trabajo", address: "Torre Sevilla", lat: S.SEVILLA.trabajo.lat, lng: S.SEVILLA.trabajo.lng });
    assert.equal(home.status, 201);
    assert.equal(work.status, 201);
    assert.equal((await miguel.post("/v1/me/routine/entries", { weekdays: ["mon", "tue"], time: "07:30", fromPlaceId: home.body.id, toPlaceId: work.body.id })).status, 201);
    assert.equal((await miguel.post("/v1/me/routine/suspensions")).status, 201);
    await check("favoritos", () => listFavorites(pool, miguelP, { limit: 20 }), miguel.get("/v1/me/favorites"));
    await check("rutina (pasajero)", () => getRoutine(pool, miguelP), miguel.get("/v1/me/routine"));
    const aHome = await ana.post("/v1/me/favorites", { kind: "home", name: "Casa", address: "Palomares", lat: S.SEVILLA.palomares.lat, lng: S.SEVILLA.palomares.lng });
    const aWork = await ana.post("/v1/me/favorites", { kind: "work", name: "Trabajo", address: "Torre Sevilla", lat: S.SEVILLA.trabajo.lat, lng: S.SEVILLA.trabajo.lng });
    assert.equal((await ana.post("/v1/me/routine/entries", { weekdays: ["mon", "tue", "wed"], time: "07:00", fromPlaceId: aHome.body.id, toPlaceId: aWork.body.id })).status, 201);
    assert.equal((await ana.put("/v1/me/routine/weekly-offer", { enabled: true, seats: 2 })).status, 200);
    await check("rutina (conductor, con plaza semanal y cuerpo para publicar)", () => getRoutine(pool, anaP), ana.get("/v1/me/routine"));

    // Misma batería de lecturas con una tarifa APROBADA sembrada solo en esta BD de pruebas (valor ficticio).
    await S.seedApprovedTariff(pool, { rateMicrosPerKm: 123_456, passengerCommissionBps: 500, capCents: 1000 });
    await tariffDependent("con tarifa de prueba:");
    await both("con tarifa de prueba: confirmada");
  });
});
