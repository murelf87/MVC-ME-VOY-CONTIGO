import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { createIncident } from "../src/modules/live/feedback-service.js";
import { getDriverConsole } from "../src/modules/live/console-service.js";
import { getBookingLive, getBookingSummary, getInCarState } from "../src/modules/live/passenger-service.js";
import { setLivePrivacy } from "../src/modules/live/privacy-service.js";
import { createRouteChange, getRouteChangeView } from "../src/modules/live/route-change-service.js";
import { createShare, getShare } from "../src/modules/live/share-service.js";
import { SHARED_TRIP_RATE_LIMIT } from "../src/modules/live/routes.js";
import { generateOwnPickupCode } from "../src/services/trip-execution-service.js";
import {
  bearer, between, buildLiveApp, createPool, FakeRouteProvider, FakeStorage, principalOf, seedBooking, seedTrip, seedWorld,
  sessionTokenFor, setPosition, setShareLiveLocation, truncateAll, SEVILLA, type SeededTrip, type World
} from "./live-support.js";

const pool = createPool();
const storage = new FakeStorage();
const provider = new FakeRouteProvider();
let app: FastifyInstance;

before(async () => { await pool.query("select 1 from trip_shares limit 1"); });
beforeEach(async () => {
  await truncateAll(pool);
  storage.objects.clear();
  app = await buildLiveApp(pool, { routeProvider: provider, privateStorage: storage });
});
afterEach(async () => { await app.close(); });
after(async () => { await pool.end(); });

const FAR_STOP = { lat: 37.3935, lng: -5.9919 };

type Scene = {
  world: World; trip: SeededTrip; miguelBooking: string; lauraBooking: string;
  token: { ana: string; miguel: string; laura: string };
};

/** Todo se siembra respecto al reloj real: los manejadores HTTP usan `new Date()`. */
async function scene(status: "published" | "active" | "completed" = "active"): Promise<Scene> {
  const world = await seedWorld(pool);
  const departure = new Date(Date.now() + (status === "published" ? 25 : -7) * (status === "completed" ? 8 * 60_000 : 60_000));
  const trip = await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, { status, departureAt: departure });
  const done = status === "completed";
  const miguel = await seedBooking(pool, trip.tripId, world.miguel, 1, 3, done ? { status: "completed", pickedUpAt: new Date(departure.getTime() + 120_000) } : {});
  const laura = await seedBooking(pool, trip.tripId, world.laura, 2, 3, done ? { status: "completed", pickedUpAt: new Date(departure.getTime() + 1_200_000) } : {});
  if (status === "active") {
    await setPosition(pool, trip.tripId, world.ana, between(SEVILLA.santaJusta, SEVILLA.luisMontoto, 0.5), new Date(Date.now() - 5000));
  }
  return {
    world, trip, miguelBooking: miguel.bookingId!, lauraBooking: laura.bookingId!,
    token: {
      ana: await sessionTokenFor(pool, world.ana),
      miguel: await sessionTokenFor(pool, world.miguel),
      laura: await sessionTokenFor(pool, world.laura)
    }
  };
}

async function call(method: "GET" | "POST" | "PUT" | "DELETE", url: string, token: string | null, payload?: unknown, headers: Record<string, string> = {}) {
  return app.inject({
    method, url,
    headers: { ...(token ? bearer(token) : {}), ...headers },
    ...(payload !== undefined ? { payload: payload as object } : {})
  });
}

/** Rutas de clave con su tipo: detecta campos que el schema de respuesta haya perdido o convertido sin avisar. */
function signature(value: unknown, path = "$", out: Set<string> = new Set()): string[] {
  if (value === null) out.add(`${path}:null`);
  else if (Array.isArray(value)) {
    out.add(`${path}:array`);
    for (const item of value) signature(item, `${path}[]`, out);
  } else if (typeof value === "object") {
    out.add(`${path}:object`);
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) signature(item, `${path}.${key}`, out);
  } else out.add(`${path}:${typeof value}`);
  return [...out].sort();
}

function sameShape(http: unknown, service: unknown, label: string): void {
  assert.deepEqual(signature(http), signature(JSON.parse(JSON.stringify(service))), `la respuesta HTTP de ${label} debe tener las mismas claves y tipos que el servicio`);
}

/* ───────────────────────────── Autenticación y validación ───────────────────────────── */

const UUID = "00000000-0000-4000-8000-000000000000";
const PROTECTED: Array<[("GET" | "POST" | "PUT" | "DELETE"), string, unknown?]> = [
  ["GET", `/v1/bookings/${UUID}/live`],
  ["GET", `/v1/bookings/${UUID}/in-car`],
  ["GET", `/v1/bookings/${UUID}/summary`],
  ["POST", `/v1/trips/${UUID}/route-changes`, { stop: { location: { lat: 37.39, lng: -5.99 } } }],
  ["GET", `/v1/route-changes/${UUID}`],
  ["POST", `/v1/route-changes/${UUID}/respond`, { decision: "accept" }],
  ["POST", `/v1/route-changes/${UUID}/cancel`],
  ["POST", `/v1/trips/${UUID}/ratings`, { rateeUserId: UUID, stars: 5 }],
  ["POST", "/v1/incident-reports", { tripId: UUID, category: "other", description: "Una incidencia de prueba" }],
  ["GET", "/v1/me/incident-reports"],
  ["GET", `/v1/me/incident-reports/${UUID}`],
  ["POST", `/v1/incident-reports/${UUID}/attachments`, { contentType: "image/jpeg", sizeBytes: 100 }],
  ["POST", `/v1/incident-reports/${UUID}/attachments/${UUID}/complete`],
  ["POST", `/v1/bookings/${UUID}/share`, {}],
  ["GET", `/v1/bookings/${UUID}/share`],
  ["DELETE", `/v1/bookings/${UUID}/share`],
  ["GET", `/v1/me/trips/${UUID}/console`],
  ["GET", "/v1/me/live-privacy"],
  ["PUT", "/v1/me/live-privacy", { showProfileToCoPassengers: true }]
];

test("las 19 rutas privadas exigen sesión: sin cabecera o con token falso → 401", async () => {
  for (const [method, url, payload] of PROTECTED) {
    const missing = await call(method, url, null, payload);
    assert.equal(missing.statusCode, 401, `${method} ${url} sin sesión`);
    assert.equal(missing.json().error.code, "AUTH_REQUIRED");
    assert.equal(typeof missing.json().requestId, "string");
    const fake = await call(method, url, "mvc_sess_falso_falso_falso_falso_falso_falso", payload);
    assert.equal(fake.statusCode, 401, `${method} ${url} con token falso`);
    assert.match(fake.json().error.code, /^AUTH_/);
  }
});

test("validación: parámetros no UUID y cuerpos incorrectos → 400 VALIDATION_ERROR (no 500)", async () => {
  const s = await scene();
  const bad = await call("GET", "/v1/bookings/no-es-uuid/live", s.token.miguel);
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error.code, "VALIDATION_ERROR");
  assert.ok(Array.isArray(bad.json().error.details));
  assert.equal(typeof bad.json().requestId, "string");

  const cases: Array<[("POST" | "PUT"), string, unknown]> = [
    ["POST", `/v1/trips/${s.trip.tripId}/ratings`, { rateeUserId: s.world.ana, stars: 6 }],
    ["POST", `/v1/trips/${s.trip.tripId}/ratings`, { rateeUserId: s.world.ana, stars: 0 }],
    ["POST", `/v1/trips/${s.trip.tripId}/ratings`, { stars: 5 }],
    ["POST", "/v1/incident-reports", { tripId: s.trip.tripId, category: "other", description: "corta" }],
    ["POST", "/v1/incident-reports", { tripId: s.trip.tripId, category: "inventada", description: "Una descripción suficiente" }],
    ["POST", `/v1/trips/${s.trip.tripId}/route-changes`, { stop: { location: { lat: 95, lng: 0 } } }],
    ["POST", `/v1/trips/${s.trip.tripId}/route-changes`, { stop: { location: { lat: 37.3, lng: -5.9 }, label: "" } }],
    ["POST", `/v1/trips/${s.trip.tripId}/route-changes`, {}],
    ["POST", `/v1/route-changes/${UUID}/respond`, { decision: "quizá" }],
    ["POST", `/v1/bookings/${s.miguelBooking}/share`, { expiresInMinutes: 10 }],
    ["POST", `/v1/bookings/${s.miguelBooking}/share`, { expiresInMinutes: 2000 }],
    ["POST", `/v1/bookings/${s.miguelBooking}/share`, { includePlate: "sí" }],
    ["PUT", "/v1/me/live-privacy", { showProfileToCoPassengers: "yes" }],
    ["PUT", "/v1/me/live-privacy", {}]
  ];
  for (const [method, url, payload] of cases) {
    const res = await call(method, url, s.token.miguel, payload);
    assert.equal(res.statusCode, 400, `${method} ${url} ${JSON.stringify(payload)}`);
    assert.equal(res.json().error.code, "VALIDATION_ERROR");
  }
  const badKey = await call("POST", "/v1/incident-reports", s.token.miguel,
    { tripId: s.trip.tripId, category: "other", description: "Una descripción suficiente" }, { "idempotency-key": "corta" });
  assert.equal(badKey.statusCode, 400);
  const badPage = await call("GET", "/v1/me/incident-reports?limit=500", s.token.miguel);
  assert.equal(badPage.statusCode, 400);
  const malformed = await app.inject({
    method: "POST", url: "/v1/incident-reports", payload: "{no es json",
    headers: { ...bearer(s.token.miguel), "content-type": "application/json" }
  });
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.json().error.code, "VALIDATION_ERROR");
});

test("todas las respuestas llevan cache-control: no-store, también las de error", async () => {
  const s = await scene();
  for (const res of [
    await call("GET", `/v1/bookings/${s.miguelBooking}/live`, s.token.miguel),
    await call("GET", `/v1/bookings/${UUID}/live`, s.token.miguel),
    await call("GET", `/v1/bookings/${s.miguelBooking}/live`, null),
    await call("GET", "/v1/shared-trips/mvc_share_inexistente", null)
  ]) {
    assert.equal(res.headers["cache-control"], "no-store");
  }
});

/* ───────────────────────────── Pasajero en directo: formas del contrato ───────────────────────────── */

test("GET live / in-car: misma forma que el servicio, con cambio de ruta pendiente, código, ocupación y enlace", async () => {
  const s = await scene();
  await setLivePrivacy(pool, s.world.laura, true);
  await generateOwnPickupCode(pool, principalOf(s.world.miguel), s.miguelBooking);
  await createShare(pool, principalOf(s.world.miguel), s.miguelBooking, {});
  const proposal = await createRouteChange(pool, principalOf(s.world.ana, ["driver", "passenger"]), provider, { tripId: s.trip.tripId, stop: { ...FAR_STOP, label: "Plaza de la Encarnación" } });
  assert.equal(proposal.view.status, "pending");

  const live = await call("GET", `/v1/bookings/${s.miguelBooking}/live`, s.token.miguel);
  assert.equal(live.statusCode, 200);
  sameShape(live.json(), await getBookingLive(pool, principalOf(s.world.miguel), s.miguelBooking), "GET /live");
  assert.equal(live.json().phase, "arriving", "el coche está a ~1 min de la recogida y la señal es viva");
  assert.equal(live.json().signal, "live");
  assert.equal(live.json().pendingRouteChange.proposalId, proposal.view.id);
  assert.equal(live.json().pendingRouteChange.awaitingMyDecision, true);
  assert.equal(live.json().position.stale, false);
  assert.equal(typeof live.json().eta.minutes, "number");

  const inCar = await call("GET", `/v1/bookings/${s.miguelBooking}/in-car`, s.token.miguel);
  assert.equal(inCar.statusCode, 200);
  sameShape(inCar.json(), await getInCarState(pool, principalOf(s.world.miguel), s.miguelBooking), "GET /in-car");
  assert.equal(inCar.json().pickupCode.status, "active");
  assert.equal(inCar.json().share.active, true);
  assert.equal(inCar.json().pickupCode.codeLength, 6);
});

test("GET live: con «Compartir ubicación en viaje» desactivado por el conductor, HTTP entrega precision approximate (y la consola sigue precisa)", async () => {
  const s = await scene();
  const precise = await call("GET", `/v1/bookings/${s.miguelBooking}/live`, s.token.miguel);
  assert.equal(precise.json().position.precision, "precise");

  await setShareLiveLocation(pool, s.world.ana, false);
  const res = await call("GET", `/v1/bookings/${s.miguelBooking}/live`, s.token.miguel);
  assert.equal(res.statusCode, 200);
  sameShape(res.json(), await getBookingLive(pool, principalOf(s.world.miguel), s.miguelBooking), "GET /live (posición aproximada)");
  const position = res.json().position;
  assert.equal(position.precision, "approximate");
  assert.equal(position.headingDegrees, null);
  assert.equal(position.speedMps, null);
  assert.equal(position.accuracyM, 1000);
  assert.equal(position.location.lat, Math.round(position.location.lat * 100) / 100);
  assert.equal(position.location.lng, Math.round(position.location.lng * 100) / 100);
  assert.equal(res.json().eta.at, precise.json().eta.at, "el ETA por la ruta no depende del ajuste");
  assert.equal(typeof precise.json().eta.distanceM, "number");
  assert.equal(res.json().eta.distanceM, null, "sin ubicación precisa no se da la distancia restante en metros");

  const driverConsole = await call("GET", `/v1/me/trips/${s.trip.tripId}/console`, s.token.ana);
  assert.equal(driverConsole.statusCode, 200);
  assert.equal(driverConsole.json().position.precision, "precise");
});

test("GET live: 404 con la misma forma de error para ajeno, conductor o inexistente", async () => {
  const s = await scene();
  for (const token of [s.token.laura, s.token.ana]) {
    const res = await call("GET", `/v1/bookings/${s.miguelBooking}/live`, token);
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error.code, "BOOKING_NOT_FOUND");
    assert.deepEqual(Object.keys(res.json()).sort(), ["error", "requestId"]);
  }
  const missing = await call("GET", `/v1/bookings/${UUID}/live`, s.token.miguel);
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json().error, { code: "BOOKING_NOT_FOUND", message: "Booking not found" });
});

test("GET summary, ratings e incidencias de un viaje terminado: formas del contrato y códigos 201/200", async () => {
  const s = await scene("completed");
  const miguel = principalOf(s.world.miguel);

  const open = await call("GET", `/v1/bookings/${s.miguelBooking}/summary`, s.token.miguel);
  assert.equal(open.statusCode, 200);
  sameShape(open.json(), await getBookingSummary(pool, miguel, s.miguelBooking), "GET /summary (sin valorar)");
  assert.equal(open.json().rating.canRate, true);

  const rated = await call("POST", `/v1/trips/${s.trip.tripId}/ratings`, s.token.miguel, { rateeUserId: s.world.ana, stars: 5, comment: "Todo perfecto" });
  assert.equal(rated.statusCode, 201);
  assert.deepEqual(Object.keys(rated.json()).sort(), ["comment", "createdAt", "id", "rateeUserId", "raterUserId", "stars", "tripId"]);
  assert.equal(rated.json().stars, 5);
  const again = await call("POST", `/v1/trips/${s.trip.tripId}/ratings`, s.token.miguel, { rateeUserId: s.world.ana, stars: 4 });
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().error.code, "RATING_ALREADY_SUBMITTED");

  const summary = await call("GET", `/v1/bookings/${s.miguelBooking}/summary`, s.token.miguel);
  sameShape(summary.json(), await getBookingSummary(pool, miguel, s.miguelBooking), "GET /summary (valorado)");
  assert.equal(summary.json().rating.mine.stars, 5);
  assert.equal(summary.json().rating.reason, "already_rated");
  assert.deepEqual(summary.json().payment, { status: "pending_definition", amount: { cents: null, currency: "EUR", status: "pending_definition" } });

  // Incidencias: 201 la primera vez, 200 en el reintento con la misma clave.
  const body = { tripId: s.trip.tripId, category: "lost_item" as const, description: "Me dejé el paraguas en el asiento de atrás." };
  const first = await call("POST", "/v1/incident-reports", s.token.miguel, body, { "idempotency-key": "incidencia-http-0001" });
  assert.equal(first.statusCode, 201);
  sameShape(first.json(), (await createIncident(pool, miguel, body, "incidencia-http-0001")).view, "POST /incident-reports");
  const replay = await call("POST", "/v1/incident-reports", s.token.miguel, body, { "idempotency-key": "incidencia-http-0001" });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().id, first.json().id);

  const list = await call("GET", "/v1/me/incident-reports?limit=1", s.token.miguel);
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().items.length, 1);
  assert.equal(list.json().nextCursor, null);
  const detail = await call("GET", `/v1/me/incident-reports/${first.json().id}`, s.token.miguel);
  assert.equal(detail.statusCode, 200);
  assert.deepEqual(detail.json(), first.json());
  const foreign = await call("GET", `/v1/me/incident-reports/${first.json().id}`, s.token.laura);
  assert.equal(foreign.statusCode, 404);
  assert.equal(foreign.json().error.code, "INCIDENT_NOT_FOUND");

  // Paginación opaca por HTTP.
  for (const n of [1, 2]) {
    await call("POST", "/v1/incident-reports", s.token.miguel, { ...body, description: `${body.description} (${n})` });
  }
  const page1 = await call("GET", "/v1/me/incident-reports?limit=2", s.token.miguel);
  assert.equal(page1.json().items.length, 2);
  assert.equal(typeof page1.json().nextCursor, "string");
  const page2 = await call("GET", `/v1/me/incident-reports?limit=2&cursor=${encodeURIComponent(page1.json().nextCursor)}`, s.token.miguel);
  assert.equal(page2.json().items.length, 1);
  assert.equal(page2.json().nextCursor, null);
  const badCursor = await call("GET", "/v1/me/incident-reports?cursor=zzz", s.token.miguel);
  assert.equal(badCursor.statusCode, 400);
  assert.equal(badCursor.json().error.code, "INVALID_CURSOR");

  // El conductor valora a Miguel y la consola lo refleja.
  const ratedByDriver = await call("POST", `/v1/trips/${s.trip.tripId}/ratings`, s.token.ana, { rateeUserId: s.world.miguel, stars: 4 });
  assert.equal(ratedByDriver.statusCode, 201);
  const consoleView = await call("GET", `/v1/me/trips/${s.trip.tripId}/console`, s.token.ana);
  assert.equal(consoleView.statusCode, 200);
  assert.deepEqual(consoleView.json().passengers.map((p: { ratedByMe: boolean }) => p.ratedByMe), [true, false]);
});

/* ───────────────────────────── Cambio de ruta por HTTP ───────────────────────────── */

test("cambio de ruta por HTTP: 201 al proponer, 200 en el reintento, consentimiento de cada pasajero y aplicación", async () => {
  const s = await scene("published");
  const body = { stop: { location: FAR_STOP, label: "Plaza de la Encarnación" } };

  const created = await call("POST", `/v1/trips/${s.trip.tripId}/route-changes`, s.token.ana, body, { "idempotency-key": "cambio-ruta-0001" });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().status, "pending");
  assert.equal(created.json().role, "driver");
  assert.equal(created.json().surcharge, "none");
  assert.equal(created.json().newStop.afterStopSeq, 1);
  const id = created.json().id as string;
  const replay = await call("POST", `/v1/trips/${s.trip.tripId}/route-changes`, s.token.ana, body, { "idempotency-key": "cambio-ruta-0001" });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().id, id);
  const second = await call("POST", `/v1/trips/${s.trip.tripId}/route-changes`, s.token.ana, body);
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().error.code, "ROUTE_CHANGE_ALREADY_PENDING");

  // Quien no es conductor propietario no propone.
  const byPassenger = await call("POST", `/v1/trips/${s.trip.tripId}/route-changes`, s.token.miguel, body);
  assert.equal(byPassenger.statusCode, 403);
  assert.equal(byPassenger.json().error.code, "AUTH_FORBIDDEN");

  // Vista del pasajero: misma forma que el servicio.
  const mine = await call("GET", `/v1/route-changes/${id}`, s.token.miguel);
  assert.equal(mine.statusCode, 200);
  sameShape(mine.json(), await getRouteChangeView(pool, s.world.miguel, id), "GET /route-changes/{id} (pasajero)");
  assert.equal(mine.json().role, "passenger");
  assert.equal(mine.json().participants, null);
  assert.equal(mine.json().myImpact.requiresAcceptance, true);
  const driverView = await call("GET", `/v1/route-changes/${id}`, s.token.ana);
  sameShape(driverView.json(), await getRouteChangeView(pool, s.world.ana, id), "GET /route-changes/{id} (conductor)");
  assert.equal(driverView.json().participants.length, 2);
  const stranger = await call("GET", `/v1/route-changes/${UUID}`, s.token.miguel);
  assert.equal(stranger.statusCode, 404);
  assert.equal(stranger.json().error.code, "ROUTE_CHANGE_NOT_FOUND");

  const accepted = await call("POST", `/v1/route-changes/${id}/respond`, s.token.miguel, { decision: "accept" });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.json().status, "pending");
  assert.equal(accepted.json().myDecision, "accepted");
  assert.deepEqual(accepted.json().counts, { required: 2, accepted: 1, rejected: 0, pending: 1 });
  const wrongWay = await call("POST", `/v1/route-changes/${id}/respond`, s.token.miguel, { decision: "reject" });
  assert.equal(wrongWay.statusCode, 409);
  assert.equal(wrongWay.json().error.code, "ROUTE_CHANGE_ALREADY_DECIDED");
  const driverCannotRespond = await call("POST", `/v1/route-changes/${id}/respond`, s.token.ana, { decision: "accept" });
  assert.equal(driverCannotRespond.statusCode, 404);

  const done = await call("POST", `/v1/route-changes/${id}/respond`, s.token.laura, { decision: "accept" });
  assert.equal(done.statusCode, 200);
  assert.equal(done.json().status, "accepted");
  assert.equal(done.json().resolution, "all_accepted");
  assert.equal(done.json().newStop.seq, 2);
  assert.equal((await pool.query(`select 1 from trip_stops where trip_id=$1`, [s.trip.tripId])).rowCount, 5);
  const cancelNow = await call("POST", `/v1/route-changes/${id}/cancel`, s.token.ana);
  assert.equal(cancelNow.statusCode, 409);
  assert.equal(cancelNow.json().error.code, "ROUTE_CHANGE_NOT_PENDING");
});

test("cambio de ruta por HTTP: rechazo, retirada del conductor y proveedor de rutas no configurado", async () => {
  const s = await scene("published");
  const body = { stop: { location: FAR_STOP } };
  const created = await call("POST", `/v1/trips/${s.trip.tripId}/route-changes`, s.token.ana, body);
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().newStop.label, null, "el nombre de la parada es opcional");
  const withdrawn = await call("POST", `/v1/route-changes/${created.json().id}/cancel`, s.token.ana);
  assert.equal(withdrawn.statusCode, 200);
  assert.equal(withdrawn.json().status, "cancelled");
  assert.equal(withdrawn.json().resolution, "cancelled_by_driver");
  const byPassenger = await call("POST", `/v1/route-changes/${created.json().id}/cancel`, s.token.miguel);
  assert.equal(byPassenger.statusCode, 403, "un pasajero no retira propuestas del conductor");
  assert.equal(byPassenger.json().error.code, "TRIP_NOT_OWNED");

  const again = await call("POST", `/v1/trips/${s.trip.tripId}/route-changes`, s.token.ana, body);
  const rejected = await call("POST", `/v1/route-changes/${again.json().id}/respond`, s.token.laura, { decision: "reject" });
  assert.equal(rejected.statusCode, 200);
  assert.equal(rejected.json().status, "rejected");
  assert.equal(rejected.json().resolution, "rejected_by_passenger");

  await app.close();
  app = await buildLiveApp(pool, { routeProvider: null, privateStorage: null });
  const noProvider = await call("POST", `/v1/trips/${s.trip.tripId}/route-changes`, s.token.ana, body);
  assert.equal(noProvider.statusCode, 503);
  assert.equal(noProvider.json().error.code, "MAPS_PROVIDER_UNAVAILABLE");
  const consoleView = await call("GET", `/v1/me/trips/${s.trip.tripId}/console`, s.token.ana);
  assert.equal(consoleView.json().actions.canProposeRouteChange, false);
});

/* ───────────────────────────── Adjuntos privados por HTTP ───────────────────────────── */

test("adjuntos por HTTP: intención 201, confirmación 200, errores de tipo y almacenamiento sin configurar", async () => {
  const s = await scene();
  const report = await call("POST", "/v1/incident-reports", s.token.miguel, { tripId: s.trip.tripId, category: "vehicle", description: "El coche huele mucho a humo." });
  const reportId = report.json().id as string;

  const intent = await call("POST", `/v1/incident-reports/${reportId}/attachments`, s.token.miguel, { contentType: "image/png", sizeBytes: 300 });
  assert.equal(intent.statusCode, 201);
  assert.deepEqual(Object.keys(intent.json()).sort(), ["attachmentId", "expiresAt", "headers", "uploadUrl"]);
  assert.deepEqual(intent.json().headers, { "content-type": "image/png" });

  const early = await call("POST", `/v1/incident-reports/${reportId}/attachments/${intent.json().attachmentId}/complete`, s.token.miguel);
  assert.equal(early.statusCode, 422);
  assert.equal(early.json().error.code, "INCIDENT_ATTACHMENT_MISMATCH");

  storage.objects.set(`users/${s.world.miguel}/incidents/${reportId}/${intent.json().attachmentId}.png`, { bytes: new Uint8Array(300), contentType: "image/png" });
  const done = await call("POST", `/v1/incident-reports/${reportId}/attachments/${intent.json().attachmentId}/complete`, s.token.miguel);
  assert.equal(done.statusCode, 200);
  assert.deepEqual(Object.keys(done.json()).sort(), ["contentType", "createdAt", "id", "sizeBytes", "status"]);
  assert.equal(done.json().status, "uploaded");
  const detail = await call("GET", `/v1/me/incident-reports/${reportId}`, s.token.miguel);
  assert.deepEqual(detail.json().attachments.map((a: { status: string }) => a.status), ["uploaded"]);

  const wrongType = await call("POST", `/v1/incident-reports/${reportId}/attachments`, s.token.miguel, { contentType: "application/pdf", sizeBytes: 300 });
  assert.equal(wrongType.statusCode, 400);
  assert.equal(wrongType.json().error.code, "VALIDATION_ERROR");
  const tooBig = await call("POST", `/v1/incident-reports/${reportId}/attachments`, s.token.miguel, { contentType: "image/jpeg", sizeBytes: 10 * 1024 * 1024 + 1 });
  assert.equal(tooBig.statusCode, 400);
  const foreign = await call("POST", `/v1/incident-reports/${reportId}/attachments`, s.token.laura, { contentType: "image/jpeg", sizeBytes: 10 });
  assert.equal(foreign.statusCode, 404);

  await app.close();
  app = await buildLiveApp(pool, { routeProvider: provider, privateStorage: null });
  const noStorage = await call("POST", `/v1/incident-reports/${reportId}/attachments`, s.token.miguel, { contentType: "image/jpeg", sizeBytes: 10 });
  assert.equal(noStorage.statusCode, 503);
  assert.equal(noStorage.json().error.code, "PRIVATE_STORAGE_NOT_CONFIGURED");
});

/* ───────────────────────────── Compartir viaje por HTTP ───────────────────────────── */

test("compartir viaje por HTTP: crear 201, estado sin token, vista pública sin sesión y DELETE 204 idempotente", async () => {
  const s = await scene();
  const empty = await call("GET", `/v1/bookings/${s.miguelBooking}/share`, s.token.miguel);
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.json(), { share: null });

  const created = await call("POST", `/v1/bookings/${s.miguelBooking}/share`, s.token.miguel, { includePlate: false, expiresInMinutes: 120 });
  assert.equal(created.statusCode, 201);
  sameShape(created.json(), await createShare(pool, principalOf(s.world.miguel), s.miguelBooking, { expiresInMinutes: 120 }), "POST /share");
  // El segundo create (del servicio) ya revocó el primero: usamos el último token válido.
  const token = (await createShare(pool, principalOf(s.world.miguel), s.miguelBooking, {})).token;

  const state = await call("GET", `/v1/bookings/${s.miguelBooking}/share`, s.token.miguel);
  assert.equal(state.statusCode, 200);
  sameShape(state.json(), await getShare(pool, principalOf(s.world.miguel), s.miguelBooking), "GET /share");
  assert.equal("token" in state.json().share, false);

  // Vista pública: sin Authorization.
  const publicView = await call("GET", `/v1/shared-trips/${token}`, null);
  assert.equal(publicView.statusCode, 200);
  assert.equal(publicView.headers["cache-control"], "no-store");
  assert.equal(publicView.json().position.precision, "approximate");
  assert.equal(publicView.json().eta.distanceM, null, "la vista pública no da la distancia restante en metros");
  assert.equal(publicView.json().vehicle.plate, null);
  assert.equal(publicView.json().passengerFirstName, "Miguel");
  assert.equal(JSON.stringify(publicView.json()).includes(s.world.miguel), false);
  assert.equal(JSON.stringify(publicView.json()).includes(s.miguelBooking), false);

  const revoke = await call("DELETE", `/v1/bookings/${s.miguelBooking}/share`, s.token.miguel);
  assert.equal(revoke.statusCode, 204);
  assert.equal(revoke.body, "");
  assert.equal((await call("DELETE", `/v1/bookings/${s.miguelBooking}/share`, s.token.miguel)).statusCode, 204);
  const gone = await call("GET", `/v1/shared-trips/${token}`, null);
  assert.equal(gone.statusCode, 410);
  assert.equal(gone.json().error.code, "SHARE_REVOKED");
  assert.equal((await call("GET", `/v1/shared-trips/${"mvc_share_" + "Z".repeat(43)}`, null)).statusCode, 404);
  assert.equal((await call("GET", `/v1/shared-trips/cualquier-cosa`, null)).json().error.code, "SHARE_NOT_FOUND");
  assert.equal((await call("DELETE", `/v1/bookings/${s.miguelBooking}/share`, s.token.laura)).statusCode, 404);
  assert.equal((await call("POST", `/v1/bookings/${s.miguelBooking}/share`, s.token.laura, {})).statusCode, 404);
});

test("crear el enlace sin cuerpo también funciona (valores por defecto: 6 h, sin matrícula)", async () => {
  const s = await scene();
  const res = await app.inject({ method: "POST", url: `/v1/bookings/${s.miguelBooking}/share`, headers: bearer(s.token.miguel) });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().includePlate, false);
  const minutes = (Date.parse(res.json().expiresAt) - Date.parse(res.json().createdAt)) / 60_000;
  assert.equal(minutes, 360);
});

test("la vista pública está limitada a 30 peticiones por minuto → 429 RATE_LIMITED", async () => {
  assert.equal(SHARED_TRIP_RATE_LIMIT.max, 30);
  let last = 0;
  for (let i = 1; i <= SHARED_TRIP_RATE_LIMIT.max; i += 1) {
    const res = await call("GET", `/v1/shared-trips/mvc_share_${"A".repeat(43)}`, null);
    last = res.statusCode;
    assert.equal(last, 404, `petición ${i}`);
  }
  const limited = await call("GET", `/v1/shared-trips/mvc_share_${"A".repeat(43)}`, null);
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.json().error.code, "RATE_LIMITED");
  assert.equal(typeof limited.json().requestId, "string");
  // Las rutas privadas no se ven afectadas por ese límite.
  const s = await scene();
  assert.equal((await call("GET", `/v1/bookings/${s.miguelBooking}/live`, s.token.miguel)).statusCode, 200);
});

/* ───────────────────────────── Consola y privacidad por HTTP ───────────────────────────── */

test("consola por HTTP: misma forma que el servicio y permisos de conductor", async () => {
  const s = await scene();
  const res = await call("GET", `/v1/me/trips/${s.trip.tripId}/console`, s.token.ana);
  assert.equal(res.statusCode, 200);
  sameShape(res.json(), await getDriverConsole(pool, principalOf(s.world.ana, ["driver", "passenger"]), s.trip.tripId, true), "GET /console");
  assert.equal(res.json().status, "active");
  assert.equal(res.json().signal, "live");
  assert.equal(res.json().passengers.length, 2);

  const asPassenger = await call("GET", `/v1/me/trips/${s.trip.tripId}/console`, s.token.miguel);
  assert.equal(asPassenger.statusCode, 403);
  assert.equal(asPassenger.json().error.code, "AUTH_FORBIDDEN");
  const missing = await call("GET", `/v1/me/trips/${UUID}/console`, s.token.ana);
  assert.equal(missing.statusCode, 404);
});

test("privacidad por HTTP: GET por defecto, PUT cambia y vuelve a leerse", async () => {
  const s = await scene();
  const before = await call("GET", "/v1/me/live-privacy", s.token.miguel);
  assert.equal(before.statusCode, 200);
  assert.deepEqual(before.json(), { showProfileToCoPassengers: false, updatedAt: null });
  const put = await call("PUT", "/v1/me/live-privacy", s.token.miguel, { showProfileToCoPassengers: true });
  assert.equal(put.statusCode, 200);
  assert.equal(put.json().showProfileToCoPassengers, true);
  assert.equal(typeof put.json().updatedAt, "string");
  assert.deepEqual((await call("GET", "/v1/me/live-privacy", s.token.miguel)).json(), put.json());
  assert.equal((await call("GET", "/v1/me/live-privacy", s.token.laura)).json().showProfileToCoPassengers, false);
});

/* ───────────────────────────── OpenAPI ───────────────────────────── */

test("OpenAPI: las 20 operaciones del módulo con resumen en español, etiqueta y respuestas; solo la vista pública sin seguridad", async () => {
  const doc = app.swagger() as unknown as {
    paths: Record<string, Record<string, { summary?: string; tags?: string[]; security?: unknown[]; responses: Record<string, unknown> }>>;
  };
  const expected: Array<[string, string]> = [
    ["get", "/v1/bookings/{bookingId}/live"], ["get", "/v1/bookings/{bookingId}/in-car"], ["get", "/v1/bookings/{bookingId}/summary"],
    ["post", "/v1/trips/{tripId}/route-changes"], ["get", "/v1/route-changes/{proposalId}"],
    ["post", "/v1/route-changes/{proposalId}/respond"], ["post", "/v1/route-changes/{proposalId}/cancel"],
    ["post", "/v1/trips/{tripId}/ratings"], ["post", "/v1/incident-reports"], ["get", "/v1/me/incident-reports"],
    ["get", "/v1/me/incident-reports/{reportId}"], ["post", "/v1/incident-reports/{reportId}/attachments"],
    ["post", "/v1/incident-reports/{reportId}/attachments/{attachmentId}/complete"],
    ["post", "/v1/bookings/{bookingId}/share"], ["get", "/v1/bookings/{bookingId}/share"], ["delete", "/v1/bookings/{bookingId}/share"],
    ["get", "/v1/shared-trips/{token}"], ["get", "/v1/me/trips/{tripId}/console"],
    ["get", "/v1/me/live-privacy"], ["put", "/v1/me/live-privacy"]
  ];
  for (const [method, path] of expected) {
    const operation = doc.paths[path]?.[method];
    assert.ok(operation, `falta ${method.toUpperCase()} ${path}`);
    assert.ok((operation.summary ?? "").length >= 10, `${path}: resumen`);
    assert.ok(/[a-záéíóúñ]/i.test(operation.summary ?? ""));
    assert.ok((operation.tags ?? []).length > 0, `${path}: etiqueta`);
    assert.ok(Object.keys(operation.responses).length >= 2, `${path}: respuestas`);
    const isPublic = path === "/v1/shared-trips/{token}";
    assert.equal(Array.isArray(operation.security) && operation.security.length > 0, !isPublic, `${method} ${path}: seguridad`);
  }
  assert.ok(doc.paths["/v1/shared-trips/{token}"]?.get?.responses["429"]);
  assert.ok(doc.paths["/v1/bookings/{bookingId}/share"]?.delete?.responses["204"]);
});
