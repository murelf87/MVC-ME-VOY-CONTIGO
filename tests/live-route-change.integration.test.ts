import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DomainError } from "../src/errors.js";
import { expirePendingRouteChanges } from "../src/modules/live/index.js";
import { getBookingLive, getInCarState } from "../src/modules/live/passenger-service.js";
import {
  cancelRouteChange, createRouteChange, getRouteChangeView, respondRouteChange, type CreateRouteChangeInput
} from "../src/modules/live/route-change-service.js";
import type { LiveRouteChange } from "../src/modules/live/types.js";
import {
  between, createPool, FakeRouteProvider, minutesAfter, principalOf, secondsAfter, seedBooking, seedQuote, seedTrip, seedUser,
  seedWorld, setPosition, truncateAll, SEVILLA, type SeededTrip, type World
} from "./live-support.js";

const pool = createPool();
const NOW = new Date("2026-10-05T05:17:00.000Z");
const DEPARTURE = new Date("2026-10-05T05:25:00.000Z");

before(async () => { await pool.query("select 1 from route_change_impacts limit 1"); });
beforeEach(async () => {
  await truncateAll(pool);
  delete process.env.LIVE_MATERIAL_SCHEDULE_DELTA_S;
  delete process.env.LIVE_ROUTE_CHANGE_TTL_SECONDS;
});
after(async () => { await pool.end(); });

/**
 * Junto a Puerta de Jerez y ≈1,2 km al norte del tramo S1–S2 (C. Luis Montoto – Puerta de Jerez): su proyección sobre la ruta cae en
 * ese tramo (más cerca que de Santa Justa) y el desvío (≈1,6 km, ≈4 min con la parada) es un cambio MATERIAL.
 */
const FAR_STOP = { lat: 37.3935, lng: -5.9919, label: "Plaza de la Encarnación" };
/** Prácticamente sobre la ruta (≈ 30 m): +60 s de parada, por debajo del umbral → NO material. */
const NEAR_STOP = { lat: 37.38365, lng: -5.9849, label: "C. Recaredo" };

type Scene = { world: World; trip: SeededTrip; miguelBooking: string; lauraBooking: string; miguelRequest: string; lauraRequest: string };

async function scene(options: { status?: "published" | "active"; capacity?: number; maxDetourM?: number; flexibilityMinutes?: number } = {}): Promise<Scene> {
  const world = await seedWorld(pool);
  const trip = await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, {
    status: options.status ?? "published",
    departureAt: DEPARTURE,
    capacity: options.capacity ?? 3,
    maxDetourM: options.maxDetourM ?? 3000,
    flexibilityMinutes: options.flexibilityMinutes ?? 0,
    ...(options.status === "active" ? { startedAt: minutesAfter(NOW, -7) } : {})
  });
  const miguel = await seedBooking(pool, trip.tripId, world.miguel, 1, 3);
  const laura = await seedBooking(pool, trip.tripId, world.laura, 2, 3);
  return {
    world, trip,
    miguelBooking: miguel.bookingId!, lauraBooking: laura.bookingId!,
    miguelRequest: miguel.requestId, lauraRequest: laura.requestId
  };
}

const driver = (s: Scene) => principalOf(s.world.ana, ["driver", "passenger"]);
const miguel = (s: Scene) => principalOf(s.world.miguel);
const laura = (s: Scene) => principalOf(s.world.laura);

function input(s: Scene, stop: { lat: number; lng: number; label?: string }, extra: Partial<CreateRouteChangeInput> = {}): CreateRouteChangeInput {
  return { tripId: s.trip.tripId, stop, ...extra };
}

async function propose(
  s: Scene, stop: { lat: number; lng: number; label?: string } = FAR_STOP, provider = new FakeRouteProvider(),
  extra: Partial<CreateRouteChangeInput> = {}
) {
  return createRouteChange(pool, driver(s), provider, input(s, stop, extra), NOW);
}

async function failsWith(promise: Promise<unknown>, code: string, status: number): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof DomainError, `esperaba DomainError ${code}, llegó ${String(error)}`);
    assert.equal(error.code, code);
    assert.equal(error.statusCode, status);
    return error;
  }
  assert.fail(`esperaba el error ${code}`);
}

async function tripState(tripId: string) {
  const trip = (await pool.query(`select route_version, route_distance_m, route_duration_s from trips where id=$1`, [tripId])).rows[0];
  const stops = (await pool.query(`select seq, label, kind from trip_stops where trip_id=$1 order by seq`, [tripId])).rows;
  const segments = (await pool.query(
    `select seq, from_stop_seq, to_stop_seq, distance_m, duration_s, capacity from trip_segments where trip_id=$1 order by seq`, [tripId]
  )).rows;
  const requests = (await pool.query(
    `select id, from_segment_seq, to_segment_seq from ride_requests where trip_id=$1 order by from_segment_seq, id`, [tripId]
  )).rows;
  return { trip, stops, segments, requests };
}

async function notifications(userId: string, kind?: string) {
  return (await pool.query(
    `select kind, title, body, data from notifications where user_id=$1 ${kind ? "and kind=$2" : ""} order by created_at, id`,
    kind ? [userId, kind] : [userId]
  )).rows;
}

/* ───────────────────────────── Propuesta material ───────────────────────────── */

test("cambio material: queda PENDIENTE, no se aplica y cada pasajero ve su Antes/Ahora", async () => {
  const s = await scene();
  const before = await tripState(s.trip.tripId);
  const { view, created } = await propose(s);
  assert.equal(created, true);
  assert.equal(view.status, "pending");
  assert.equal(view.resolution, null);
  assert.equal(view.autoApplied, false);
  assert.equal(view.role, "driver");
  assert.equal(view.surcharge, "none");
  assert.equal(view.kind, "new_stop");
  assert.equal(view.newStop.label, "Plaza de la Encarnación");
  assert.equal(view.newStop.afterStopSeq, 1, "por proyección cae entre S1 y S2");
  assert.equal(view.newStop.seq, null);
  assert.deepEqual(view.counts, { required: 2, accepted: 0, rejected: 0, pending: 2 });
  assert.equal(view.expiresAt, secondsAfter(NOW, 300).toISOString());
  assert.equal(view.participants!.length, 2);
  assert.ok(view.participants!.every(p => p.requiresAcceptance && p.decision === null));
  assert.equal(view.myImpact, null);
  assert.ok(view.detour.addedDistanceM > 1000 && view.detour.addedDistanceM < 3000);
  assert.equal(view.detour.maxDetourM, 3000);
  // 4 horas: duración = (tramos nuevos − tramo antiguo) + 60 s de parada
  const provider = new FakeRouteProvider();
  const legs = await Promise.all([
    provider.computeRoutes({ origin: { latitude: SEVILLA.luisMontoto.lat, longitude: SEVILLA.luisMontoto.lng }, destination: { latitude: FAR_STOP.lat, longitude: FAR_STOP.lng }, alternatives: false }),
    provider.computeRoutes({ origin: { latitude: FAR_STOP.lat, longitude: FAR_STOP.lng }, destination: { latitude: SEVILLA.puertaJerez.lat, longitude: SEVILLA.puertaJerez.lng }, alternatives: false })
  ]);
  const expectedDuration = legs[0]![0]!.durationSeconds + legs[1]![0]!.durationSeconds - s.trip.segments[1]!.durationS + 60;
  assert.equal(view.detour.addedDurationSeconds, expectedDuration);

  // Nada cambia hasta que acepten.
  assert.deepEqual(await tripState(s.trip.tripId), before);

  // Vista de Miguel (pantalla 22): su recogida y su destino, impacto y decisión pendiente.
  const mine = await getRouteChangeView(pool, s.world.miguel, view.id, NOW);
  assert.equal(mine.role, "passenger");
  assert.equal(mine.participants, null);
  assert.equal(mine.linkedRequestId, null);
  assert.equal(mine.myDecision, null);
  assert.ok(mine.myImpact);
  assert.equal(mine.myImpact.requiresAcceptance, true);
  assert.equal(mine.myImpact.dropoff.material, true);
  assert.equal(mine.myImpact.dropoff.deltaSeconds, view.detour.addedDurationSeconds);
  assert.equal(mine.myImpact.pickup.deltaSeconds, 0);
  assert.equal(Date.parse(mine.myImpact.dropoff.afterAt!) - Date.parse(mine.myImpact.dropoff.beforeAt!), view.detour.addedDurationSeconds * 1000);
  assert.equal(mine.stops.pickup!.label, "C. Luis Montoto");
  assert.equal(mine.stops.dropoff!.label, "Universidad de Sevilla");
  assert.ok(mine.path.after.length > mine.path.before.length, "la ruta propuesta añade el punto de la nueva parada");
  assert.ok(mine.path.after.some(p => Math.abs(p.lat - FAR_STOP.lat) < 1e-6 && Math.abs(p.lng - FAR_STOP.lng) < 1e-6));
  // Sin presupuesto aprobado el precio NO se inventa.
  assert.deepEqual(mine.myImpact.price.delta, { cents: null, currency: "EUR", status: "pending_definition" });
  assert.equal(mine.myImpact.price.changed, false);
  assert.equal(mine.myImpact.price.material, false);

  // Avisos: un aviso por pasajero que debe aceptar; el conductor no recibe nada hasta que se resuelva.
  assert.equal((await notifications(s.world.miguel, "route_change_proposed")).length, 1);
  assert.equal((await notifications(s.world.laura, "route_change_proposed")).length, 1);
  assert.equal((await notifications(s.world.ana)).length, 0);

  // Aparece como pendiente en /live e /in-car de quien debe decidir.
  const live = await getBookingLive(pool, miguel(s), s.miguelBooking, NOW);
  assert.deepEqual(live.pendingRouteChange, { proposalId: view.id, expiresAt: view.expiresAt, awaitingMyDecision: true });
  const inCar = await getInCarState(pool, laura(s), s.lauraBooking, NOW);
  assert.equal(inCar.pendingRouteChange!.proposalId, view.id);
});

test("todas las aceptaciones aplican el cambio: parada insertada, tramo partido, rangos y geometría actualizados", async () => {
  const s = await scene();
  const { view } = await propose(s);

  const first = await respondRouteChange(pool, miguel(s), view.id, "accept", NOW);
  assert.equal(first.status, "pending", "con una aceptación sola no se aplica");
  assert.equal(first.myDecision, "accepted");
  assert.deepEqual(first.counts, { required: 2, accepted: 1, rejected: 0, pending: 1 });
  assert.equal((await tripState(s.trip.tripId)).trip.route_version, 1);
  // El pasajero que ya aceptó ya no tiene decisión pendiente.
  const liveAfterFirst = await getBookingLive(pool, miguel(s), s.miguelBooking, NOW);
  assert.equal(liveAfterFirst.pendingRouteChange!.awaitingMyDecision, false);

  const done = await respondRouteChange(pool, laura(s), view.id, "accept", NOW);
  assert.equal(done.status, "accepted");
  assert.equal(done.resolution, "all_accepted");
  assert.equal(done.autoApplied, false);
  assert.equal(done.newStop.seq, 2);
  assert.ok(done.resolvedAt);

  const after = await tripState(s.trip.tripId);
  assert.equal(after.trip.route_version, 2);
  assert.deepEqual(after.stops.map(r => [r.seq, r.label]), [
    [0, "Estación Santa Justa"], [1, "C. Luis Montoto"], [2, "Plaza de la Encarnación"], [3, "Puerta de Jerez"], [4, "Universidad de Sevilla"]
  ]);
  assert.equal(after.segments.length, 4);
  assert.deepEqual(after.segments.map(r => [r.seq, r.from_stop_seq, r.to_stop_seq]), [[0, 0, 1], [1, 1, 2], [2, 2, 3], [3, 3, 4]]);
  assert.ok(after.segments.every(r => r.capacity === 3), "las dos mitades heredan la capacidad del tramo partido");
  assert.equal(after.segments[0]!.distance_m, s.trip.segments[0]!.distanceM, "tramos no afectados intactos");
  assert.equal(after.segments[3]!.distance_m, s.trip.segments[2]!.distanceM);
  // Solicitudes: Miguel 1→3 pasa a 1→4; Laura 2→3 pasa a 3→4 (su recogida sigue siendo Puerta de Jerez).
  assert.deepEqual(after.requests.map(r => [r.from_segment_seq, r.to_segment_seq]), [[1, 4], [3, 4]]);
  // Distancia total = antes + desvío.
  assert.equal(after.trip.route_distance_m - (await (async () => s.trip.segments.reduce((a, b) => a + b.distanceM, 0))()), view.detour.addedDistanceM);
  // La geometría guardada contiene la nueva parada y queda dentro de la provincia.
  const geometry = (await pool.query<{ near: boolean; covered: boolean }>(
    `select ST_DWithin(t.route_geom, ST_SetSRID(ST_Point($2,$3),4326), 0.00001) as near, ST_CoveredBy(t.route_geom, p.geom) as covered
       from trips t join provinces p on p.id=t.province_id where t.id=$1`,
    [s.trip.tripId, FAR_STOP.lng, FAR_STOP.lat]
  )).rows[0]!;
  assert.deepEqual(geometry, { near: true, covered: true });

  assert.equal((await notifications(s.world.ana, "route_change_accepted")).length, 1);
  // Quien aceptó primero y esperaba al resto recibe la confirmación; quien cerró la votación ya ve el resultado en su respuesta.
  assert.equal((await notifications(s.world.miguel, "route_change_applied")).length, 1);
  assert.equal((await notifications(s.world.laura, "route_change_applied")).length, 0);
  // La pantalla del pasajero refleja la numeración nueva.
  const inCar = await getInCarState(pool, miguel(s), s.miguelBooking, NOW);
  assert.deepEqual(inCar.timeline.map(t => t.label), ["C. Luis Montoto", "Plaza de la Encarnación", "Puerta de Jerez", "Universidad de Sevilla"]);
  assert.equal(inCar.pendingRouteChange, null);
  const lauraLive = await getBookingLive(pool, laura(s), s.lauraBooking, NOW);
  assert.equal(lauraLive.pickup.seq, 3);
  assert.equal(lauraLive.pickup.label, "Puerta de Jerez");

  // Vista del pasajero ya aplicada: numeración vigente.
  const applied = await getRouteChangeView(pool, s.world.laura, view.id, NOW);
  assert.equal(applied.stops.pickup!.seq, 3);
  assert.equal(applied.stops.dropoff!.seq, 4);
  assert.equal(applied.myDecision, "accepted");

  // Repetir la misma decisión es idempotente (no vuelve a aplicar nada).
  const repeat = await respondRouteChange(pool, laura(s), view.id, "accept", NOW);
  assert.equal(repeat.status, "accepted");
  assert.equal((await tripState(s.trip.tripId)).trip.route_version, 2);
  await failsWith(respondRouteChange(pool, laura(s), view.id, "reject", NOW), "ROUTE_CHANGE_ALREADY_DECIDED", 409);
});

test("un rechazo cancela la propuesta: no se aplica nada y se avisa a quien aún esperaba", async () => {
  const s = await scene();
  const { view } = await propose(s);
  const before = await tripState(s.trip.tripId);

  const rejected = await respondRouteChange(pool, laura(s), view.id, "reject", NOW);
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.resolution, "rejected_by_passenger");
  assert.equal(rejected.myDecision, "rejected");
  assert.deepEqual(await tripState(s.trip.tripId), before);
  assert.equal((await notifications(s.world.ana, "route_change_rejected")).length, 1);
  assert.equal((await notifications(s.world.miguel, "route_change_cancelled")).length, 1, "Miguel no llegó a decidir y se le avisa");
  assert.equal((await notifications(s.world.laura, "route_change_cancelled")).length, 0, "quien rechazó no recibe aviso");

  // Repetir el rechazo es idempotente; aceptar después es incoherente.
  assert.equal((await respondRouteChange(pool, laura(s), view.id, "reject", NOW)).status, "rejected");
  await failsWith(respondRouteChange(pool, laura(s), view.id, "accept", NOW), "ROUTE_CHANGE_ALREADY_DECIDED", 409);
  await failsWith(respondRouteChange(pool, miguel(s), view.id, "accept", NOW), "ROUTE_CHANGE_NOT_PENDING", 409);
  assert.equal((await tripState(s.trip.tripId)).trip.route_version, 1);
});

test("aceptación parcial y después un rechazo: nada se aplica y quien ya había aceptado también recibe el aviso", async () => {
  const s = await scene();
  const { view } = await propose(s);
  const first = await respondRouteChange(pool, miguel(s), view.id, "accept", NOW);
  assert.equal(first.status, "pending");
  const before = await tripState(s.trip.tripId);

  const rejected = await respondRouteChange(pool, laura(s), view.id, "reject", NOW);
  assert.equal(rejected.status, "rejected");
  assert.deepEqual(rejected.counts, { required: 2, accepted: 1, rejected: 1, pending: 0 });
  assert.deepEqual(await tripState(s.trip.tripId), before);
  assert.equal((await notifications(s.world.miguel, "route_change_cancelled")).length, 1, "Miguel aceptó y esperaba: se le avisa");
  assert.equal((await notifications(s.world.laura, "route_change_cancelled")).length, 0);
  assert.equal((await notifications(s.world.ana, "route_change_rejected")).length, 1);
  // La propuesta ya no está pendiente para nadie.
  assert.equal((await getBookingLive(pool, miguel(s), s.miguelBooking, NOW)).pendingRouteChange, null);
  await failsWith(respondRouteChange(pool, miguel(s), view.id, "reject", NOW), "ROUTE_CHANGE_ALREADY_DECIDED", 409);
});

test("sin respuesta a tiempo caduca (aunque alguien aceptara) y no se aplica", async () => {
  const s = await scene();
  const { view } = await propose(s);
  await respondRouteChange(pool, miguel(s), view.id, "accept", NOW);

  const later = secondsAfter(NOW, 301);
  await failsWith(respondRouteChange(pool, laura(s), view.id, "accept", later), "ROUTE_CHANGE_EXPIRED", 409);
  const expired = await getRouteChangeView(pool, s.world.ana, view.id, later);
  assert.equal(expired.status, "expired");
  assert.equal(expired.resolution, "expired");
  assert.equal((await tripState(s.trip.tripId)).trip.route_version, 1);
  assert.equal((await notifications(s.world.ana, "route_change_expired")).length, 1);
  assert.equal((await notifications(s.world.laura, "route_change_expired")).length, 1, "Laura no respondió: se le avisa");
  assert.equal((await notifications(s.world.miguel, "route_change_expired")).length, 1, "Miguel aceptó y esperaba al resto: también se le avisa");
  const live = await getBookingLive(pool, laura(s), s.lauraBooking, later);
  assert.equal(live.pendingRouteChange, null);
});

test("el barrido de caducidad marca las vencidas y avisa una sola vez", async () => {
  const s = await scene();
  await propose(s);
  assert.equal(await expirePendingRouteChanges(pool, secondsAfter(NOW, 100)), 0);
  assert.equal(await expirePendingRouteChanges(pool, secondsAfter(NOW, 400)), 1);
  assert.equal(await expirePendingRouteChanges(pool, secondsAfter(NOW, 500)), 0);
  assert.equal((await notifications(s.world.ana, "route_change_expired")).length, 1);
  assert.equal((await pool.query(`select 1 from route_change_proposals where status='expired'`)).rowCount, 1);
});

test("el plazo de la propuesta es configurable", async () => {
  process.env.LIVE_ROUTE_CHANGE_TTL_SECONDS = "60";
  const s = await scene();
  const { view } = await propose(s);
  assert.equal(view.expiresAt, secondsAfter(NOW, 60).toISOString());
});

/* ───────────────────────────── Cambio no material ───────────────────────────── */

test("cambio NO material: se aplica al crearlo, se avisa a los afectados y no hace falta aceptar", async () => {
  const s = await scene();
  const { view } = await propose(s, NEAR_STOP);
  assert.equal(view.status, "accepted");
  assert.equal(view.resolution, "auto_applied");
  assert.equal(view.autoApplied, true);
  assert.equal(view.expiresAt, null);
  assert.deepEqual(view.counts, { required: 0, accepted: 0, rejected: 0, pending: 0 });
  assert.ok(view.participants!.every(p => !p.requiresAcceptance && p.decision === null));
  assert.equal(view.newStop.seq, 2);
  const state = await tripState(s.trip.tripId);
  assert.equal(state.trip.route_version, 2);
  assert.equal(state.stops.length, 5);
  assert.equal((await notifications(s.world.miguel, "route_change_applied")).length, 1);
  assert.equal((await notifications(s.world.laura, "route_change_applied")).length, 1);
  assert.equal((await notifications(s.world.miguel, "route_change_proposed")).length, 0);
  assert.equal((await notifications(s.world.ana, "route_change_accepted")).length, 1);
  // Un pasajero afectado no puede responder a algo que no requiere su aceptación.
  await failsWith(respondRouteChange(pool, miguel(s), view.id, "accept", NOW), "ROUTE_CHANGE_ACCEPTANCE_NOT_REQUIRED", 409);
  const passengerView = await getRouteChangeView(pool, s.world.miguel, view.id, NOW);
  assert.equal(passengerView.myImpact!.requiresAcceptance, false);
});

test("la flexibilidad del viaje eleva el umbral: un retraso dentro de la flexibilidad no exige aceptación", async () => {
  const s = await scene({ flexibilityMinutes: 10 });
  const { view } = await propose(s, FAR_STOP);
  assert.ok(view.detour.addedDurationSeconds < 600);
  assert.equal(view.status, "accepted");
  assert.equal(view.autoApplied, true);
});

test("el umbral de retraso material es configurable", async () => {
  process.env.LIVE_MATERIAL_SCHEDULE_DELTA_S = "30";
  const s = await scene();
  const { view } = await propose(s, NEAR_STOP);
  assert.equal(view.status, "pending", "con umbral de 30 s los 60 s de parada ya son materiales");
});

/* ───────────────────────────── Una propuesta pendiente, cancelar, idempotencia ───────────────────────────── */

test("solo una propuesta pendiente por viaje; el conductor puede retirarla y proponer otra", async () => {
  const s = await scene();
  const { view } = await propose(s);
  await failsWith(propose(s, FAR_STOP, new FakeRouteProvider()), "ROUTE_CHANGE_ALREADY_PENDING", 409);

  const cancelled = await cancelRouteChange(pool, driver(s), view.id, NOW);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.resolution, "cancelled_by_driver");
  assert.equal((await notifications(s.world.miguel, "route_change_cancelled")).length, 1);
  await failsWith(cancelRouteChange(pool, driver(s), view.id, NOW), "ROUTE_CHANGE_NOT_PENDING", 409);
  await failsWith(respondRouteChange(pool, miguel(s), view.id, "accept", NOW), "ROUTE_CHANGE_NOT_PENDING", 409);
  assert.equal((await tripState(s.trip.tripId)).trip.route_version, 1);

  const second = await propose(s);
  assert.equal(second.view.status, "pending");
  assert.notEqual(second.view.id, view.id);
});

test("Idempotency-Key: el reintento devuelve la misma propuesta sin duplicar ni recalcular", async () => {
  const s = await scene();
  const provider = new FakeRouteProvider();
  const first = await propose(s, FAR_STOP, provider, { idempotencyKey: "intento-0001" });
  const calls = provider.calls.length;
  const again = await propose(s, FAR_STOP, provider, { idempotencyKey: "intento-0001" });
  assert.equal(first.created, true);
  assert.equal(again.created, false);
  assert.equal(again.view.id, first.view.id);
  assert.equal(provider.calls.length, calls, "no vuelve a llamar al proveedor de rutas");
  assert.equal((await pool.query(`select 1 from route_change_proposals`)).rowCount, 1);
  assert.equal((await notifications(s.world.miguel, "route_change_proposed")).length, 1);

  const other = await seedTrip(pool, s.world.ana, s.world.vehicleId, s.world.provinceId, { departureAt: DEPARTURE });
  await failsWith(
    createRouteChange(pool, driver(s), provider, { tripId: other.tripId, stop: FAR_STOP, idempotencyKey: "intento-0001" }, NOW),
    "IDEMPOTENCY_KEY_REUSED", 409
  );
});

/* ───────────────────────────── Acceso ───────────────────────────── */

test("acceso: solo el conductor propietario propone; ver y responder solo los afectados", async () => {
  const s = await scene();
  const stranger = await seedUser(pool, "Curioso");
  const otherDriver = await seedUser(pool, "Otro Conductor", { roles: ["driver"] });

  await failsWith(createRouteChange(pool, miguel(s), new FakeRouteProvider(), input(s, FAR_STOP), NOW), "AUTH_FORBIDDEN", 403);
  await failsWith(createRouteChange(pool, principalOf(otherDriver, ["driver"]), new FakeRouteProvider(), input(s, FAR_STOP), NOW), "TRIP_NOT_OWNED", 403);
  await failsWith(createRouteChange(pool, driver(s), null, input(s, FAR_STOP), NOW), "MAPS_PROVIDER_UNAVAILABLE", 503);

  const { view } = await propose(s);
  await failsWith(getRouteChangeView(pool, stranger, view.id, NOW), "ROUTE_CHANGE_NOT_FOUND", 404);
  await failsWith(getRouteChangeView(pool, otherDriver, view.id, NOW), "ROUTE_CHANGE_NOT_FOUND", 404);
  await failsWith(respondRouteChange(pool, principalOf(stranger), view.id, "accept", NOW), "ROUTE_CHANGE_NOT_FOUND", 404);
  await failsWith(respondRouteChange(pool, driver(s), view.id, "accept", NOW), "ROUTE_CHANGE_NOT_FOUND", 404);
  await failsWith(cancelRouteChange(pool, miguel(s), view.id, NOW), "TRIP_NOT_OWNED", 403);
  await failsWith(cancelRouteChange(pool, principalOf(stranger), view.id, NOW), "ROUTE_CHANGE_NOT_FOUND", 404);
  await failsWith(getRouteChangeView(pool, stranger, "00000000-0000-4000-8000-000000000000", NOW), "ROUTE_CHANGE_NOT_FOUND", 404);
  // El conductor ve la vista de conductor; el pasajero afectado, la suya.
  assert.equal((await getRouteChangeView(pool, s.world.ana, view.id, NOW)).role, "driver");
  assert.equal((await getRouteChangeView(pool, s.world.laura, view.id, NOW)).role, "passenger");
});

test("un pasajero cuyo trayecto no se ve afectado ni ve ni acepta la propuesta", async () => {
  const s = await scene();
  // Carlos baja en S1 (antes de la nueva parada): no le afecta.
  const carlos = await seedUser(pool, "Carlos Ruiz");
  const early = await seedBooking(pool, s.trip.tripId, carlos, 0, 1);
  const { view } = await propose(s);
  assert.deepEqual(view.counts, { required: 2, accepted: 0, rejected: 0, pending: 2 });
  assert.equal(view.participants!.length, 2);
  await failsWith(getRouteChangeView(pool, carlos, view.id, NOW), "ROUTE_CHANGE_NOT_FOUND", 404);
  assert.equal((await getBookingLive(pool, principalOf(carlos), early.bookingId!, NOW)).pendingRouteChange, null);
  assert.equal((await notifications(carlos)).length, 0);
});

/* ───────────────────────────── Dónde se inserta la parada ───────────────────────────── */

test("la parada se coloca por proyección sobre la ruta y el conductor puede forzar el tramo con afterStopSeq", async () => {
  const placed = async (stop: { lat: number; lng: number; label: string }, extra: Partial<CreateRouteChangeInput> = {}) => {
    await truncateAll(pool);
    const s = await scene({ maxDetourM: 8000 });
    return propose(s, stop, new FakeRouteProvider(), extra);
  };
  // Sobre el tramo S0–S1 → tras la parada 0; sobre S2–S3 → tras la parada 2.
  const early = await placed({ ...between(SEVILLA.santaJusta, SEVILLA.luisMontoto, 0.5), label: "Inicio" });
  assert.equal(early.view.newStop.afterStopSeq, 0);
  const late = await placed({ ...between(SEVILLA.puertaJerez, SEVILLA.universidad, 0.5), label: "Final" });
  assert.equal(late.view.newStop.afterStopSeq, 2);
  // Un tramo indicado por el conductor manda sobre la proyección.
  const forced = await placed(FAR_STOP, { afterStopSeq: 2 });
  assert.equal(forced.view.newStop.afterStopSeq, 2);
  // Con la parada tras S2, Miguel (S1→S3) y Laura (S2→S3) atraviesan el desvío y deben aceptar.
  assert.equal(forced.view.participants!.length, 2);
  assert.ok(forced.view.participants!.every(p => p.requiresAcceptance));
});

/* ───────────────────────────── Reglas de validación ───────────────────────────── */

test("desvío superior al máximo del viaje, fuera de la provincia, índice y ubicación inválidos", async () => {
  const s = await scene({ maxDetourM: 500 });
  const tooFar = await failsWith(propose(s, FAR_STOP), "ROUTE_CHANGE_DETOUR_TOO_LARGE", 422);
  const details = tooFar.details as { addedDistanceM: number; maxDetourM: number };
  assert.equal(details.maxDetourM, 500);
  assert.ok(details.addedDistanceM > 500);

  await failsWith(propose(s, { lat: 38.6, lng: -5.9849, label: "Fuera" }), "ROUTE_CHANGE_STOP_OUTSIDE_PROVINCE", 422);
  await failsWith(propose(s, NEAR_STOP, new FakeRouteProvider(), { afterStopSeq: 9 }), "ROUTE_CHANGE_INVALID_STOP_INDEX", 422);
  await failsWith(propose(s, NEAR_STOP, new FakeRouteProvider(), { afterStopSeq: 3 }), "ROUTE_CHANGE_INVALID_STOP_INDEX", 422);
  await failsWith(propose(s, { lat: 95, lng: 0 }), "INVALID_ROUTE_CHANGE_STOP", 400);
  assert.equal((await pool.query(`select 1 from route_change_proposals`)).rowCount, 0);
  assert.equal((await tripState(s.trip.tripId)).trip.route_version, 1);
});

test("un viaje terminado o cancelado no admite cambios de ruta", async () => {
  const s = await scene();
  await pool.query(`update trips set status='completed', completed_at=now() where id=$1`, [s.trip.tripId]);
  await failsWith(propose(s), "ROUTE_CHANGE_TRIP_NOT_CHANGEABLE", 409);
});

test("el proveedor de rutas fallido no deja nada a medias", async () => {
  const s = await scene();
  await assert.rejects(propose(s, FAR_STOP, new FakeRouteProvider({ failWith: new Error("proveedor caído") })), /proveedor caído/);
  assert.equal((await pool.query(`select 1 from route_change_proposals`)).rowCount, 0);
  assert.equal((await notifications(s.world.miguel)).length, 0);
});

test("viaje activo: exige posición conocida y la parada no puede quedar detrás del coche", async () => {
  const s = await scene({ status: "active" });
  await failsWith(propose(s), "DRIVER_POSITION_UNAVAILABLE", 409);

  // Ana ya va al 80 % del tramo S1→S2; una parada situada al 50 % queda detrás.
  await setPosition(pool, s.trip.tripId, s.world.ana, between(SEVILLA.luisMontoto, SEVILLA.puertaJerez, 0.8), secondsAfter(NOW, -5));
  await failsWith(propose(s, { ...between(SEVILLA.luisMontoto, SEVILLA.puertaJerez, 0.5), label: "Detrás" }), "ROUTE_CHANGE_STOP_BEHIND_VEHICLE", 422);

  // Con la posición obsoleta también sirve la última conocida (se sigue la ruta guardada).
  const ok = await propose(s, { ...between(SEVILLA.luisMontoto, SEVILLA.puertaJerez, 0.9), lat: between(SEVILLA.luisMontoto, SEVILLA.puertaJerez, 0.9).lat + 0.0003, label: "Delante" });
  assert.equal(ok.created, true);
});

test("viaje activo: las horas «antes» se calculan con la posición viva", async () => {
  const s = await scene({ status: "active" });
  await setPosition(pool, s.trip.tripId, s.world.ana, between(SEVILLA.santaJusta, SEVILLA.luisMontoto, 0.5), secondsAfter(NOW, -5));
  const { view } = await propose(s);
  const mine = await getRouteChangeView(pool, s.world.miguel, view.id, NOW);
  const seg0 = s.trip.segments[0]!;
  // Miguel sube en S1: medio tramo 0 desde la posición del GPS.
  const expectedPickup = secondsAfter(NOW, -5).getTime() + seg0.durationS * 0.5 * 1000;
  assert.ok(Math.abs(Date.parse(mine.myImpact!.pickup.beforeAt!) - expectedPickup) < 2000);
  assert.equal(mine.driverSignal.state, "live");
  assert.equal(mine.driverSignal.ageSeconds, 5);
});

test("señal del conductor en la vista del cambio: obsoleta se dice como tal (banner «Sin señal»)", async () => {
  const s = await scene({ status: "active" });
  await setPosition(pool, s.trip.tripId, s.world.ana, between(SEVILLA.santaJusta, SEVILLA.luisMontoto, 0.5), secondsAfter(NOW, -5));
  const { view } = await propose(s);
  const stale = await getRouteChangeView(pool, s.world.miguel, view.id, secondsAfter(NOW, 120));
  assert.equal(stale.driverSignal.state, "stale");
  assert.equal(stale.driverSignal.ageSeconds, 125);
  assert.equal(stale.driverSignal.lastUpdateAt, secondsAfter(NOW, -5).toISOString());
});

test("un pasajero ya subido al coche también debe aceptar un cambio material", async () => {
  const s = await scene({ status: "active" });
  await pool.query(`update bookings set picked_up_at=$2 where id=$1`, [s.miguelBooking, minutesAfter(NOW, -3)]);
  await setPosition(pool, s.trip.tripId, s.world.ana, between(SEVILLA.luisMontoto, SEVILLA.puertaJerez, 0.1), secondsAfter(NOW, -5));
  const { view } = await propose(s, { ...FAR_STOP, lat: FAR_STOP.lat });
  const mine = await getRouteChangeView(pool, s.world.miguel, view.id, NOW);
  assert.equal(mine.myImpact!.requiresAcceptance, true);
  assert.equal(mine.myImpact!.pickup.beforeAt, null, "ya subió: no hay hora de recogida");
});

/* ───────────────────────────── Capacidad y solicitud enlazada ───────────────────────────── */

async function pendingRequest(s: Scene, from: number, to: number, status: "pending" | "accepted" | "payment_pending" = "pending") {
  const carlos = await seedUser(pool, "Carlos Ruiz");
  const request = await seedBooking(pool, s.trip.tripId, carlos, from, to, { requestStatus: status });
  return { carlos, requestId: request.requestId };
}

test("solicitud enlazada sin capacidad en un tramo afectado → 409 NO_CAPACITY_ON_SEGMENT", async () => {
  const s = await scene({ capacity: 2 });
  const linked = await pendingRequest(s, 2, 3);
  const error = await failsWith(propose(s, FAR_STOP, new FakeRouteProvider(), { requestId: linked.requestId }), "NO_CAPACITY_ON_SEGMENT", 409);
  assert.equal((error.details as { segmentSeq: number }).segmentSeq, 2);
  assert.equal((await pool.query(`select 1 from route_change_proposals`)).rowCount, 0);
});

test("solicitud enlazada con capacidad: al aplicar, el nuevo pasajero sube en la nueva parada", async () => {
  const s = await scene({ capacity: 3 });
  const linked = await pendingRequest(s, 2, 3);
  const { view } = await propose(s, FAR_STOP, new FakeRouteProvider(), { requestId: linked.requestId });
  assert.equal(view.linkedRequestId, linked.requestId);
  await respondRouteChange(pool, miguel(s), view.id, "accept", NOW);
  await respondRouteChange(pool, laura(s), view.id, "accept", NOW);
  const request = (await pool.query(`select from_segment_seq, to_segment_seq from ride_requests where id=$1`, [linked.requestId])).rows[0];
  assert.deepEqual(request, { from_segment_seq: 2, to_segment_seq: 4 }, "sube en la nueva parada (seq 2) y baja en el destino renumerado");
});

test("capacidad perdida antes de aplicar: la propuesta se cancela (capacity_lost) y nada cambia", async () => {
  const s = await scene({ capacity: 3 });
  const linked = await pendingRequest(s, 2, 3);
  const { view } = await propose(s, FAR_STOP, new FakeRouteProvider(), { requestId: linked.requestId });
  // Mientras tanto otra solicitud retiene la última plaza del tramo S2→S3 (reserva temporal activa).
  const other = await pendingRequest(s, 2, 3, "payment_pending");
  await pool.query(`insert into seat_holds(request_id, status, expires_at) values($1,'active', now() + interval '10 minutes')`, [other.requestId]);

  await respondRouteChange(pool, miguel(s), view.id, "accept", NOW);
  const result = await respondRouteChange(pool, laura(s), view.id, "accept", NOW);
  assert.equal(result.status, "cancelled");
  assert.equal(result.resolution, "capacity_lost");
  assert.equal((await tripState(s.trip.tripId)).trip.route_version, 1);
  assert.equal((await notifications(s.world.ana, "route_change_cancelled")).length, 1);
  assert.equal((await notifications(s.world.miguel, "route_change_cancelled")).length, 1, "Miguel aceptó y esperaba: se le avisa");
  assert.equal((await notifications(s.world.laura, "route_change_cancelled")).length, 0, "quien cerró la votación ya ve el resultado");
  const unchanged = (await pool.query(`select from_segment_seq, to_segment_seq from ride_requests where id=$1`, [linked.requestId])).rows[0];
  assert.deepEqual(unchanged, { from_segment_seq: 2, to_segment_seq: 3 });
});

test("solicitud enlazada de otro viaje o ya resuelta → 422 ROUTE_CHANGE_REQUEST_INVALID", async () => {
  const s = await scene();
  const otherTrip = await seedTrip(pool, s.world.ana, s.world.vehicleId, s.world.provinceId, { departureAt: DEPARTURE });
  const carlos = await seedUser(pool, "Carlos Ruiz");
  const foreign = await seedBooking(pool, otherTrip.tripId, carlos, 1, 3, { requestStatus: "pending" });
  await failsWith(propose(s, FAR_STOP, new FakeRouteProvider(), { requestId: foreign.requestId }), "ROUTE_CHANGE_REQUEST_INVALID", 422);
  const resolved = await seedBooking(pool, s.trip.tripId, carlos, 1, 3, { requestStatus: "pending" });
  await pool.query(`update ride_requests set status='rejected' where id=$1`, [resolved.requestId]);
  await failsWith(propose(s, FAR_STOP, new FakeRouteProvider(), { requestId: resolved.requestId }), "ROUTE_CHANGE_REQUEST_INVALID", 422);
});

test("ruta o reservas cambiadas mientras se esperaba → la propuesta queda cancelada (superseded)", async () => {
  const s = await scene();
  const { view } = await propose(s);
  await pool.query(`update trips set route_version = route_version + 1 where id=$1`, [s.trip.tripId]);
  await respondRouteChange(pool, miguel(s), view.id, "accept", NOW);
  const result = await respondRouteChange(pool, laura(s), view.id, "accept", NOW);
  assert.equal(result.status, "cancelled");
  assert.equal(result.resolution, "superseded");
  assert.equal((await tripState(s.trip.tripId)).stops.length, 4);

  // Una reserva nueva afectada también invalida lo calculado.
  await truncateAll(pool);
  const t = await scene();
  const proposal = (await propose(t)).view;
  const newcomer = await seedUser(pool, "Carlos Ruiz");
  await seedBooking(pool, t.trip.tripId, newcomer, 1, 3);
  await respondRouteChange(pool, miguel(t), proposal.id, "accept", NOW);
  const second = await respondRouteChange(pool, laura(t), proposal.id, "accept", NOW);
  assert.equal(second.resolution, "superseded");
});

/* ───────────────────────────── Dinero: solo kilómetros, nunca tráfico ni recargos ───────────────────────────── */

test("con presupuesto aprobado el precio varía solo por kilómetros y solo para quien atraviesa el desvío", async () => {
  process.env.LIVE_MATERIAL_SCHEDULE_DELTA_S = "3600";
  const s = await scene();
  const tariff = { rateMicrosPerKm: 300_000, passengerCommissionBps: 1000 };
  const miguelDistance = s.trip.segments[1]!.distanceM + s.trip.segments[2]!.distanceM;
  const quoted = await seedQuote(pool, s.miguelRequest, tariff, miguelDistance);
  await seedQuote(pool, s.lauraRequest, tariff, s.trip.segments[2]!.distanceM);

  const { view } = await propose(s);
  // El horario no es material (umbral de 1 h): solo acepta quien tiene variación de precio.
  assert.deepEqual(view.counts, { required: 1, accepted: 0, rejected: 0, pending: 1 });
  const miguelRow = view.participants!.find(p => p.passenger.firstName === "Miguel")!;
  const lauraRow = view.participants!.find(p => p.passenger.firstName === "Laura")!;
  assert.equal(miguelRow.requiresAcceptance, true);
  assert.equal(lauraRow.requiresAcceptance, false);
  assert.equal(lauraRow.priceDelta.status, "defined");
  assert.equal(lauraRow.priceDelta.cents, 0, "Laura sube después del desvío: su trayecto no cambia");
  assert.equal(miguelRow.priceDelta.status, "defined");
  assert.ok(miguelRow.priceDelta.cents! > 0);

  const mine = await getRouteChangeView(pool, s.world.miguel, view.id, NOW);
  assert.equal(mine.myImpact!.price.changed, true);
  assert.equal(mine.myImpact!.price.material, true);
  assert.deepEqual(mine.myImpact!.price.before, { cents: quoted.totalCents, currency: "EUR", status: "defined" });
  assert.equal(mine.myImpact!.price.after.cents, quoted.totalCents + mine.myImpact!.price.delta.cents!);
  // Fórmula: aportación por km (0,30 €/km) + 10 % de comisión sobre el incremento de km.
  const extraKm = view.detour.addedDistanceM;
  const contribution = (m: number) => Math.round((m * 300_000) / 10_000_000);
  const total = (m: number) => contribution(m) + Math.round((contribution(m) * 1000) / 10_000);
  assert.equal(mine.myImpact!.price.delta.cents, total(miguelDistance + extraKm) - total(miguelDistance));
  assert.equal(mine.myImpact!.dropoff.material, false, "el horario no es la causa de la aceptación");
  assert.equal(mine.surcharge, "none");

  const lauraView = await getRouteChangeView(pool, s.world.laura, view.id, NOW);
  assert.equal(lauraView.myImpact!.requiresAcceptance, false);
  assert.equal(lauraView.myImpact!.price.changed, false);
});

test("el tráfico cambia la hora, nunca el precio", async () => {
  const s = await scene();
  const tariff = { rateMicrosPerKm: 300_000, passengerCommissionBps: 1000 };
  await seedQuote(pool, s.miguelRequest, tariff, s.trip.segments[1]!.distanceM + s.trip.segments[2]!.distanceM);

  const calm = (await propose(s, FAR_STOP, new FakeRouteProvider({ trafficFactor: 1 }))).view;
  const calmMine = await getRouteChangeView(pool, s.world.miguel, calm.id, NOW);
  await cancelRouteChange(pool, driver(s), calm.id, NOW);

  const jam = (await propose(s, FAR_STOP, new FakeRouteProvider({ trafficFactor: 3 }))).view;
  const jamMine = await getRouteChangeView(pool, s.world.miguel, jam.id, NOW);

  assert.deepEqual(jamMine.myImpact!.price, calmMine.myImpact!.price, "mismos kilómetros ⇒ mismo precio");
  assert.equal(jam.detour.addedDistanceM, calm.detour.addedDistanceM);
  assert.ok(jam.detour.addedDurationSeconds > calm.detour.addedDurationSeconds, "con atasco el retraso es mayor");
  assert.equal(jamMine.surcharge, "none");
});

test("tarifa retirada o sin comisión definida: no se inventa un precio", async () => {
  const s = await scene();
  await seedQuote(pool, s.miguelRequest, { rateMicrosPerKm: 300_000, passengerCommissionBps: 1000, status: "retired" }, 5000);
  const { view } = await propose(s);
  const mine = await getRouteChangeView(pool, s.world.miguel, view.id, NOW);
  assert.equal(mine.myImpact!.price.delta.cents !== null, true, "una tarifa retirada sigue siendo la que aceptó el usuario");

  await truncateAll(pool);
  const t = await scene();
  const quote = await seedQuote(pool, t.miguelRequest, { rateMicrosPerKm: 300_000, passengerCommissionBps: 1000 }, 5000);
  assert.ok(quote.totalCents > 0);
  await pool.query(`update tariff_versions set passenger_commission_bps=null`);
  const second = (await propose(t)).view;
  const secondMine = await getRouteChangeView(pool, t.world.miguel, second.id, NOW);
  assert.deepEqual(secondMine.myImpact!.price.delta, { cents: null, currency: "EUR", status: "pending_definition" });
});

test("las vistas nunca llevan recargo por molestias", async () => {
  const s = await scene();
  const { view } = await propose(s);
  const views: LiveRouteChange[] = [
    view,
    await getRouteChangeView(pool, s.world.miguel, view.id, NOW),
    await getRouteChangeView(pool, s.world.laura, view.id, NOW)
  ];
  assert.ok(views.every(v => v.surcharge === "none"));
  assert.equal(JSON.stringify(views).toLowerCase().includes("recargo"), false);
});
