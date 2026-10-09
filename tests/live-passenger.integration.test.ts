import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DomainError } from "../src/errors.js";
import { generateOwnPickupCode, verifyPickupCode } from "../src/services/trip-execution-service.js";
import { getDriverConsole } from "../src/modules/live/console-service.js";
import { getBookingLive, getBookingSummary, getInCarState } from "../src/modules/live/passenger-service.js";
import { setLivePrivacy } from "../src/modules/live/privacy-service.js";
import {
  between, createPool, haversine, minutesAfter, principalOf, secondsAfter, seedBooking, seedTrip, seedUser, seedWorld, setPosition,
  setShareLiveLocation, truncateAll, type SeededTrip, type World, DEFAULT_STOPS, SEVILLA
} from "./live-support.js";

const pool = createPool();

before(async () => { await pool.query("select 1 from route_change_impacts limit 1"); });
beforeEach(async () => { await truncateAll(pool); });
after(async () => { await pool.end(); });

const NOW = new Date("2026-10-05T05:17:00.000Z");
const DEPARTURE = new Date("2026-10-05T05:10:00.000Z");

type Scene = {
  world: World;
  trip: SeededTrip;
  miguelBooking: string;
  lauraBooking: string;
};

/** Viaje de Ana: Santa Justa → Luis Montoto → Puerta de Jerez → Universidad. Miguel S1→S3, Laura S2→S3. */
async function scene(status: "published" | "active" | "completed" = "active"): Promise<Scene> {
  const world = await seedWorld(pool);
  const trip = await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, { status, departureAt: DEPARTURE });
  const miguel = await seedBooking(pool, trip.tripId, world.miguel, 1, 3, {
    amountCents: 0,
    ...(status === "completed" ? { status: "completed", pickedUpAt: minutesAfter(DEPARTURE, 2) } : {})
  });
  const laura = await seedBooking(pool, trip.tripId, world.laura, 2, 3, {
    amountCents: 0,
    ...(status === "completed" ? { status: "completed", pickedUpAt: minutesAfter(DEPARTURE, 20) } : {})
  });
  return { world, trip, miguelBooking: miguel.bookingId!, lauraBooking: laura.bookingId! };
}

const asMiguel = (s: Scene) => principalOf(s.world.miguel);
const asLaura = (s: Scene) => principalOf(s.world.laura);

async function expectNotFound(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof DomainError);
    assert.equal(error.code, "BOOKING_NOT_FOUND");
    assert.equal(error.statusCode, 404);
    return true;
  });
}

/* ───────────────────────────── Visibilidad ───────────────────────────── */

test("solo el pasajero titular ve su reserva: conductor, copasajero y desconocidos reciben 404", async () => {
  const s = await scene();
  const stranger = await seedUser(pool, "Curioso");
  await setPosition(pool, s.trip.tripId, s.world.ana, between(SEVILLA.santaJusta, SEVILLA.luisMontoto, 0.5), secondsAfter(NOW, -5));

  const live = await getBookingLive(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.equal(live.bookingId, s.miguelBooking);
  assert.equal(live.driver.firstName, "Ana");
  assert.equal(live.vehicle.plate, s.world.plate);

  for (const who of [principalOf(s.world.ana, ["driver"]), asLaura(s), principalOf(stranger)]) {
    await expectNotFound(getBookingLive(pool, who, s.miguelBooking, NOW));
    await expectNotFound(getInCarState(pool, who, s.miguelBooking, NOW));
    await expectNotFound(getBookingSummary(pool, who, s.miguelBooking, NOW));
  }
  await expectNotFound(getBookingLive(pool, asMiguel(s), "00000000-0000-4000-8000-000000000000", NOW));
});

/* ───────────────────────────── 21 · Esperando el coche ───────────────────────────── */

test("viaje publicado: fase scheduled, sin posición ni señal, ETA de planificación aproximada", async () => {
  const s = await scene("published");
  const view = await getBookingLive(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.equal(view.phase, "scheduled");
  assert.equal(view.tripStatus, "published");
  assert.equal(view.position, null);
  assert.equal(view.signal, "none");
  assert.equal(view.lastUpdateAt, null);
  assert.equal(view.lastUpdateAgeSeconds, null);
  assert.deepEqual(view.arrival, { warning: false, arrived: false, warningThresholdSeconds: 300 });
  assert.equal(view.etaTarget, "pickup");
  assert.ok(view.eta);
  assert.equal(view.eta.source, "schedule");
  assert.equal(view.eta.approximate, true);
  assert.equal(view.eta.distanceM, null);
  // hora prevista = salida + tramo S0→S1
  const expected = new Date(DEPARTURE.getTime() + (s.trip.segments[0]!.durationS) * 1000).toISOString();
  assert.equal(view.pickup.plannedAt, expected);
  assert.equal(view.eta.at, expected);
  assert.equal(view.pickup.label, "C. Luis Montoto");
  assert.equal(view.dropoff.label, "Universidad de Sevilla");
  assert.deepEqual(view.chat, { peerUserId: s.world.ana, available: true });
  assert.equal(view.pendingRouteChange, null);
});

test("posición reciente: ETA por la ruta guardada (no línea recta), no obsoleta, sin aviso lejano", async () => {
  const s = await scene();
  // Ana en el punto medio S0→S1, GPS de hace 5 s.
  const where = between(SEVILLA.santaJusta, SEVILLA.luisMontoto, 0.5);
  await setPosition(pool, s.trip.tripId, s.world.ana, where, secondsAfter(NOW, -5));
  const view = await getBookingLive(pool, asLaura(s), s.lauraBooking, NOW);
  // Laura sube en S2: quedan medio tramo 0 + tramo 1 + 60 s de parada en S1.
  const seg0 = s.trip.segments[0]!;
  const seg1 = s.trip.segments[1]!;
  const remainingS = seg0.durationS * 0.5 + 60 + seg1.durationS;
  assert.equal(view.signal, "live");
  assert.equal(view.phase, "driver_en_route");
  assert.ok(view.eta);
  assert.equal(view.eta.source, "live_route");
  assert.equal(view.eta.approximate, false);
  const etaFromGps = (Date.parse(view.eta.at) - secondsAfter(NOW, -5).getTime()) / 1000;
  assert.ok(Math.abs(etaFromGps - remainingS) < 2, `eta ${etaFromGps} vs ${remainingS}`);
  const distance = seg0.distanceM * 0.5 + seg1.distanceM;
  assert.ok(view.eta.distanceM !== null && Math.abs(view.eta.distanceM - distance) < 5);
  assert.equal(view.eta.minutes, Math.ceil(((Date.parse(view.eta.at) - NOW.getTime()) / 1000) / 60));
  assert.ok(view.position);
  assert.equal(view.position.stale, false);
  assert.equal(view.position.ageSeconds, 5);
  assert.equal(view.lastUpdateAgeSeconds, 5);
  assert.equal(view.staleAfterSeconds, 60);
  assert.equal(view.arrival.warning, false);
  assert.equal(view.arrival.arrived, false);
});

test("aviso de llegada ≤ 5 min con señal viva → fase arriving; ≤ 100 m → at_pickup", async () => {
  const s = await scene();
  await setPosition(pool, s.trip.tripId, s.world.ana, between(SEVILLA.santaJusta, SEVILLA.luisMontoto, 0.5), secondsAfter(NOW, -5));
  const arriving = await getBookingLive(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.equal(arriving.phase, "arriving");
  assert.equal(arriving.arrival.warning, true);
  assert.equal(arriving.arrival.arrived, false);

  await setPosition(pool, s.trip.tripId, s.world.ana, SEVILLA.luisMontoto, secondsAfter(NOW, -3));
  const arrived = await getBookingLive(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.equal(arrived.phase, "at_pickup");
  assert.equal(arrived.arrival.arrived, true);
  assert.equal(arrived.arrival.warning, true);
});

test("posición obsoleta: nunca «en directo», sin avisos de llegada y ETA aproximada", async () => {
  const s = await scene();
  // 130 s de antigüedad, justo en el punto de recogida.
  await setPosition(pool, s.trip.tripId, s.world.ana, SEVILLA.luisMontoto, secondsAfter(NOW, -130));
  const view = await getBookingLive(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.equal(view.signal, "stale");
  assert.ok(view.position);
  assert.equal(view.position.stale, true);
  assert.equal(view.position.ageSeconds, 130);
  assert.equal(view.lastUpdateAgeSeconds, 130);
  assert.equal(view.arrival.warning, false);
  assert.equal(view.arrival.arrived, false);
  assert.equal(view.phase, "driver_en_route");
  assert.ok(view.eta);
  assert.equal(view.eta.approximate, true);
});

test("el umbral de obsolescencia es configurable y el límite es exacto", async () => {
  const s = await scene();
  await setPosition(pool, s.trip.tripId, s.world.ana, SEVILLA.santaJusta, secondsAfter(NOW, -60));
  const atLimit = await getBookingLive(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.equal(atLimit.signal, "live", "60 s exactos todavía es reciente");
  const justOver = await getBookingLive(pool, asMiguel(s), s.miguelBooking, new Date(NOW.getTime() + 1000));
  assert.equal(justOver.signal, "stale");

  process.env.LIVE_STALE_AFTER_SECONDS = "10";
  try {
    const strict = await getBookingLive(pool, asMiguel(s), s.miguelBooking, NOW);
    assert.equal(strict.signal, "stale");
    assert.equal(strict.staleAfterSeconds, 10);
  } finally {
    delete process.env.LIVE_STALE_AFTER_SECONDS;
  }
});

test("sin ninguna posición con el viaje activo: señal none y ETA de planificación", async () => {
  const s = await scene();
  const view = await getBookingLive(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.equal(view.signal, "none");
  assert.equal(view.position, null);
  assert.ok(view.eta);
  assert.equal(view.eta.source, "schedule");
  assert.equal(view.phase, "driver_en_route");
});

test("reserva cancelada o viaje terminado: no hay posición ni ETA", async () => {
  const s = await scene();
  await setPosition(pool, s.trip.tripId, s.world.ana, SEVILLA.luisMontoto, secondsAfter(NOW, -3));
  await pool.query(`update bookings set status='cancelled' where id=$1`, [s.miguelBooking]);
  const cancelled = await getBookingLive(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.equal(cancelled.phase, "cancelled");
  assert.equal(cancelled.position, null);
  assert.equal(cancelled.eta, null);
  assert.equal(cancelled.signal, "none");
  assert.equal(cancelled.chat.available, false);

  const done = await scene("completed");
  await setPosition(pool, done.trip.tripId, done.world.ana, SEVILLA.universidad, secondsAfter(NOW, -3));
  const finished = await getBookingLive(pool, asMiguel(done), done.miguelBooking, NOW);
  assert.equal(finished.phase, "completed");
  assert.equal(finished.position, null);
  assert.equal(finished.eta, null);
});

test("ya recogido: fase in_vehicle y la ETA apunta al destino", async () => {
  const s = await scene();
  await setPosition(pool, s.trip.tripId, s.world.ana, between(SEVILLA.luisMontoto, SEVILLA.puertaJerez, 0.5), secondsAfter(NOW, -4));
  await pool.query(`update bookings set picked_up_at=$2 where id=$1`, [s.miguelBooking, minutesAfter(NOW, -3)]);
  const view = await getBookingLive(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.equal(view.phase, "in_vehicle");
  assert.equal(view.etaTarget, "dropoff");
  assert.ok(view.eta);
  const seg1 = s.trip.segments[1]!;
  const seg2 = s.trip.segments[2]!;
  const remainingS = seg1.durationS * 0.5 + 60 + seg2.durationS;
  assert.ok(Math.abs((Date.parse(view.eta.at) - secondsAfter(NOW, -4).getTime()) / 1000 - remainingS) < 2);
});

test("cuando el coche ya dejó atrás el destino del pasajero, su posición deja de verse", async () => {
  const world = await seedWorld(pool);
  const trip = await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, { status: "active", departureAt: DEPARTURE });
  const early = await seedBooking(pool, trip.tripId, world.miguel, 1, 2, { pickedUpAt: minutesAfter(NOW, -8) });
  await seedBooking(pool, trip.tripId, world.laura, 2, 3);
  // El coche ya va camino de la Universidad, 1,7 km después de dejar a Miguel en Puerta de Jerez.
  await setPosition(pool, trip.tripId, world.ana, between(SEVILLA.puertaJerez, SEVILLA.universidad, 0.5), secondsAfter(NOW, -3));
  const view = await getBookingLive(pool, principalOf(world.miguel), early.bookingId!, NOW);
  assert.equal(view.position, null);
  assert.equal(view.signal, "none");
  assert.equal(view.eta, null);
  assert.equal(view.arrival.warning, false);
});

test("chat: disponible con reserva confirmada y sin bloqueo; bloqueado → no disponible", async () => {
  const s = await scene();
  assert.equal((await getBookingLive(pool, asMiguel(s), s.miguelBooking, NOW)).chat.available, true);
  await pool.query(`insert into user_blocks(blocker_user_id, blocked_user_id) values($1,$2)`, [s.world.ana, s.world.miguel]);
  const view = await getBookingLive(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.deepEqual(view.chat, { peerUserId: s.world.ana, available: false });
});

/* ───────────────────────────── 23 · En el coche ───────────────────────────── */

test("código de recogida: not_generated → active → locked → active → verified (el código en claro nunca viaja)", async () => {
  const s = await scene();
  const inCar0 = await getInCarState(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.deepEqual(inCar0.pickupCode, {
    status: "not_generated", codeLength: 6, generatedAt: null, verifiedAt: null, attemptsRemaining: null
  });

  const generated = await generateOwnPickupCode(pool, asMiguel(s), s.miguelBooking);
  const active = await getInCarState(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.equal(active.pickupCode.status, "active");
  assert.equal(active.pickupCode.attemptsRemaining, 5);
  assert.equal(active.pickupCode.generatedAt, generated.generatedAt);
  assert.equal(JSON.stringify(active).includes(generated.code), false, "el código en claro no puede aparecer en la respuesta");

  const driver = principalOf(s.world.ana, ["driver"]);
  const wrong = generated.code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i += 1) {
    await assert.rejects(verifyPickupCode(pool, driver, s.miguelBooking, wrong), (e: unknown) => e instanceof DomainError && e.code === "PICKUP_CODE_INVALID");
  }
  const locked = await getInCarState(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.equal(locked.pickupCode.status, "locked");
  assert.equal(locked.pickupCode.attemptsRemaining, 0);

  const regenerated = await generateOwnPickupCode(pool, asMiguel(s), s.miguelBooking);
  assert.equal((await getInCarState(pool, asMiguel(s), s.miguelBooking, NOW)).pickupCode.status, "active");
  await verifyPickupCode(pool, driver, s.miguelBooking, regenerated.code);
  const verified = await getInCarState(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.equal(verified.pickupCode.status, "verified");
  assert.ok(verified.pickupCode.verifiedAt);
  assert.equal(verified.pickupCode.attemptsRemaining, null);
  assert.equal(verified.phase, "in_vehicle");
});

test("ocupación y privacidad: el copasajero es «1 pasajero» salvo que él mismo comparta su perfil", async () => {
  const s = await scene();
  const view = await getInCarState(pool, asMiguel(s), s.miguelBooking, NOW);
  // Miguel viaja S1→S3 y Laura S2→S3: en el tramo S2→S3 hay 2 de 3 plazas ocupadas.
  assert.deepEqual({ occupied: view.occupancy.occupied, capacity: view.occupancy.capacity }, { occupied: 2, capacity: 3 });
  assert.equal(view.occupancy.members.length, 3);
  const [driver, me, other] = view.occupancy.members;
  assert.equal(driver!.role, "driver");
  assert.equal(driver!.user!.firstName, "Ana");
  assert.equal(driver!.user!.ratingAverage, 4.8);
  assert.equal(driver!.user!.ratingCount, 32);
  assert.equal(me!.isYou, true);
  assert.equal(me!.user!.firstName, "Miguel");
  assert.equal(other!.isYou, false);
  assert.equal(other!.user, null, "Laura no comparte su perfil por defecto");
  assert.equal(JSON.stringify(view).includes("Laura"), false);

  await setLivePrivacy(pool, s.world.laura, true);
  const shared = await getInCarState(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.equal(shared.occupancy.members[2]!.user!.firstName, "Laura");

  // Y al revés: Miguel no ha compartido su perfil, Laura no ve su nombre.
  const lauraView = await getInCarState(pool, asLaura(s), s.lauraBooking, NOW);
  assert.equal(lauraView.occupancy.members.find(m => !m.isYou && m.role === "passenger")!.user, null);
  assert.equal(JSON.stringify(lauraView).includes("Miguel"), false);
});

test("la ocupación cuenta solo el tramo propio: pasajeros que no coinciden no se suman", async () => {
  const world = await seedWorld(pool);
  const trip = await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, { status: "active", departureAt: DEPARTURE, capacity: 2 });
  const first = await seedBooking(pool, trip.tripId, world.miguel, 0, 1);
  await seedBooking(pool, trip.tripId, world.laura, 2, 3);
  const view = await getInCarState(pool, principalOf(world.miguel), first.bookingId!, NOW);
  assert.deepEqual({ occupied: view.occupancy.occupied, capacity: view.occupancy.capacity }, { occupied: 1, capacity: 2 });
  assert.equal(view.occupancy.members.length, 2, "solo el conductor y él mismo");
});

test("trayecto con estados done / current / next según el avance del coche", async () => {
  const s = await scene();
  // Antes de recoger: la recogida es la parada actual.
  await setPosition(pool, s.trip.tripId, s.world.ana, between(SEVILLA.santaJusta, SEVILLA.luisMontoto, 0.5), secondsAfter(NOW, -4));
  const before = await getInCarState(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.deepEqual(before.timeline.map(t => [t.seq, t.role, t.state]), [[1, "pickup", "current"], [2, "stop", "next"], [3, "dropoff", "next"]]);
  assert.deepEqual(before.timeline.map(t => t.label), ["C. Luis Montoto", "Puerta de Jerez", "Universidad de Sevilla"]);

  // Recogido y en el tramo S1→S2.
  await pool.query(`update bookings set picked_up_at=$2 where id=$1`, [s.miguelBooking, minutesAfter(NOW, -2)]);
  await setPosition(pool, s.trip.tripId, s.world.ana, between(SEVILLA.luisMontoto, SEVILLA.puertaJerez, 0.4), secondsAfter(NOW, -4));
  const riding = await getInCarState(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.deepEqual(riding.timeline.map(t => t.state), ["done", "current", "next"]);
  assert.equal(riding.phase, "in_vehicle");
  assert.ok(riding.etaAtDestination);
  assert.equal(riding.etaAtDestination.source, "live_route");
  assert.ok(riding.remaining);
  assert.equal(riding.remaining.minutes, riding.etaAtDestination.minutes);
  assert.equal(riding.remaining.distanceM, riding.etaAtDestination.distanceM);
  const times = riding.timeline.map(t => Date.parse(t.eta));
  assert.ok(times[1]! < times[2]!, "las horas crecen a lo largo del trayecto");

  // Ya pasó Puerta de Jerez.
  await setPosition(pool, s.trip.tripId, s.world.ana, between(SEVILLA.puertaJerez, SEVILLA.universidad, 0.5), secondsAfter(NOW, -4));
  const late = await getInCarState(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.deepEqual(late.timeline.map(t => t.state), ["done", "done", "current"]);
});

test("en el coche con el viaje sin iniciar: horas de planificación y sin posición", async () => {
  const s = await scene("published");
  const view = await getInCarState(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.equal(view.phase, "scheduled");
  assert.equal(view.signal, "none");
  assert.equal(view.lastUpdateAt, null);
  assert.deepEqual(view.share, { active: false, expiresAt: null });
  assert.equal(view.timeline.length, 3);
  assert.ok(view.etaAtDestination);
  assert.equal(view.etaAtDestination.source, "schedule");
  assert.ok(view.remaining);
  assert.ok(view.remaining.distanceM !== null && view.remaining.distanceM > 0, "distancia planificada del trayecto");
});

/* ───────────────────────────── 24 · Viaje terminado ───────────────────────────── */

test("resumen de un viaje terminado: duración real solo si el destino es el final del viaje", async () => {
  const s = await scene("completed");
  const summary = await getBookingSummary(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.equal(summary.arrived, true);
  assert.equal(summary.tripStatus, "completed");
  assert.equal(summary.bookingStatus, "completed");
  // recogido a los 2 min de la salida; el viaje terminó a los 55 min y Miguel baja en la última parada.
  assert.deepEqual(summary.duration, { seconds: 53 * 60, source: "actual" });
  assert.equal(summary.pickup.at, minutesAfter(DEPARTURE, 2).toISOString());
  assert.equal(summary.dropoff.at, minutesAfter(DEPARTURE, 55).toISOString());
  const planned = s.trip.segments[1]!.distanceM + s.trip.segments[2]!.distanceM;
  assert.deepEqual(summary.distance, { meters: planned, basis: "planned_road_route" });
  assert.deepEqual(summary.passengers, { count: 2, capacity: 3 });
  assert.equal(summary.driver.firstName, "Ana");
  assert.equal(summary.vehicle.plate, s.world.plate);
  assert.ok(summary.path.length >= 2);
  assert.deepEqual(summary.path[0], { lat: SEVILLA.luisMontoto.lat, lng: SEVILLA.luisMontoto.lng });
  assert.deepEqual(summary.path[summary.path.length - 1], { lat: SEVILLA.universidad.lat, lng: SEVILLA.universidad.lng });
  assert.deepEqual(summary.incidents, { canReport: true, mineCount: 0 });
  assert.equal(summary.rating.rateeUserId, s.world.ana);
});

test("resumen: si el pasajero baja antes del final, la duración es la planificada (no se inventa una real)", async () => {
  const world = await seedWorld(pool);
  const trip = await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, {
    status: "completed", departureAt: DEPARTURE
  });
  const early = await seedBooking(pool, trip.tripId, world.miguel, 1, 2, { status: "completed", pickedUpAt: minutesAfter(DEPARTURE, 2) });
  const summary = await getBookingSummary(pool, principalOf(world.miguel), early.bookingId!, NOW);
  assert.equal(summary.duration.source, "planned");
  assert.equal(summary.duration.seconds, trip.segments[1]!.durationS);
  assert.equal(summary.dropoff.at, new Date(minutesAfter(DEPARTURE, 2).getTime() + trip.segments[1]!.durationS * 1000).toISOString());
});

test("resumen: el pago solo es «confirmed» con un pago registrado; si no, por definir", async () => {
  const s = await scene("completed");
  const pending = await getBookingSummary(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.deepEqual(pending.payment, { status: "pending_definition", amount: { cents: null, currency: "EUR", status: "pending_definition" } });
  await pool.query(`update bookings set amount_cents=400 where id=$1`, [s.miguelBooking]);
  const paid = await getBookingSummary(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.deepEqual(paid.payment, { status: "confirmed", amount: { cents: 400, currency: "EUR", status: "defined" } });
});

test("resumen: reglas de valoración (viaje sin terminar, no presentado, ya valorado, plazo cerrado)", async () => {
  // Viaje en curso.
  const active = await scene("active");
  const running = await getBookingSummary(pool, asMiguel(active), active.miguelBooking, NOW);
  assert.equal(running.arrived, false);
  assert.equal(running.rating.canRate, false);
  assert.equal(running.rating.reason, "trip_not_completed");
  assert.equal(running.rating.windowEndsAt, null);

  // Terminado, pero la reserva quedó «no presentado».
  await truncateAll(pool);
  const s = await scene("completed");
  await pool.query(`update bookings set status='no_show', picked_up_at=null where id=$1`, [s.miguelBooking]);
  const noShow = await getBookingSummary(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.equal(noShow.arrived, false);
  assert.equal(noShow.rating.reason, "booking_not_completed");

  // Pasajero que sí viajó: puede valorar dentro del plazo.
  await pool.query(`update bookings set status='completed', picked_up_at=$2 where id=$1`, [s.miguelBooking, minutesAfter(DEPARTURE, 2)]);
  const can = await getBookingSummary(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.equal(can.rating.canRate, true);
  assert.equal(can.rating.reason, null);
  assert.equal(can.rating.windowEndsAt, minutesAfter(DEPARTURE, 55 + 14 * 24 * 60).toISOString());

  // Ya valorado.
  await pool.query(
    `insert into trip_ratings(trip_id, booking_id, rater_user_id, ratee_user_id, rater_role, stars) values($1,$2,$3,$4,'passenger',5)`,
    [s.trip.tripId, s.miguelBooking, s.world.miguel, s.world.ana]
  );
  const rated = await getBookingSummary(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.equal(rated.rating.canRate, false);
  assert.equal(rated.rating.reason, "already_rated");
  assert.equal(rated.rating.mine!.stars, 5);

  // Plazo cerrado (15 días después).
  await pool.query(`delete from trip_ratings`);
  const late = await getBookingSummary(pool, asMiguel(s), s.miguelBooking, new Date(NOW.getTime() + 15 * 24 * 3600 * 1000));
  assert.equal(late.rating.canRate, false);
  assert.equal(late.rating.reason, "window_closed");
});

test("las rutas de pasajero nunca cambian el estado de la reserva (solo lectura salvo cambios de ruta vencidos)", async () => {
  const s = await scene();
  const before = (await pool.query(`select status, picked_up_at from bookings where id=$1`, [s.miguelBooking])).rows[0];
  await getBookingLive(pool, asMiguel(s), s.miguelBooking, NOW);
  await getInCarState(pool, asMiguel(s), s.miguelBooking, NOW);
  await getBookingSummary(pool, asMiguel(s), s.miguelBooking, NOW);
  const after = (await pool.query(`select status, picked_up_at from bookings where id=$1`, [s.miguelBooking])).rows[0];
  assert.deepEqual(after, before);
});

test("paradas de DEFAULT_STOPS siguen en orden a lo largo de la ruta sembrada", async () => {
  assert.equal(DEFAULT_STOPS.length, 4);
  const world = await seedWorld(pool);
  const trip = await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, {});
  const fr = await pool.query<{ seq: number; frac: number }>(
    `select s.seq, ST_LineLocatePoint(t.route_geom, s.geom) as frac from trip_stops s join trips t on t.id=s.trip_id where s.trip_id=$1 order by s.seq`,
    [trip.tripId]
  );
  const fracs = fr.rows.map(r => r.frac);
  assert.deepEqual([...fracs].sort((a, b) => a - b), fracs);
});

/* ───────────────────────────── «Compartir ubicación en viaje» (ajuste de comms) ───────────────────────────── */

const near = (a: number, b: number, epsilon = 1e-7) => Math.abs(a - b) < epsilon;

test("conductor con «Compartir ubicación en viaje» desactivado: el pasajero ve una zona aproximada, no el coche", async () => {
  const s = await scene();
  const where = between(SEVILLA.santaJusta, SEVILLA.luisMontoto, 0.5);
  await setPosition(pool, s.trip.tripId, s.world.ana, where, secondsAfter(NOW, -5), { accuracyM: 7, speedMps: 9.4, headingDegrees: 128.5 });

  // Sin fila en user_settings: valor por defecto = compartir (posición precisa).
  const precise = await getBookingLive(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.ok(precise.position);
  assert.equal(precise.position.precision, "precise");
  assert.ok(near(precise.position.location.lat, where.lat) && near(precise.position.location.lng, where.lng));
  assert.equal(precise.position.headingDegrees, 128.5);
  assert.equal(precise.position.speedMps, 9.4);
  assert.equal(precise.position.accuracyM, 7);
  assert.ok(precise.eta && precise.eta.distanceM !== null && precise.eta.distanceM > 0, "con ubicación compartida hay distancia restante");
  const preciseInCar = await getInCarState(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.ok(preciseInCar.remaining && preciseInCar.remaining.distanceM !== null);
  assert.ok(preciseInCar.etaAtDestination && preciseInCar.etaAtDestination.distanceM !== null);

  // Un ajuste explícito en true tampoco cambia nada.
  await setShareLiveLocation(pool, s.world.ana, true);
  assert.equal((await getBookingLive(pool, asMiguel(s), s.miguelBooking, NOW)).position!.precision, "precise");

  await setShareLiveLocation(pool, s.world.ana, false);
  const approx = await getBookingLive(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.ok(approx.position);
  assert.equal(approx.position.precision, "approximate");
  // Cuadrícula de 0,01°: ni el punto exacto, ni rumbo, ni velocidad; la precisión pasa a ser el radio de la cuadrícula.
  assert.equal(approx.position.location.lat, Math.round(where.lat * 100) / 100);
  assert.equal(approx.position.location.lng, Math.round(where.lng * 100) / 100);
  assert.notEqual(approx.position.location.lat, precise.position.location.lat);
  assert.ok(haversine(approx.position.location, where) < 1000, "el error de la cuadrícula es menor que el radio declarado");
  assert.equal(approx.position.headingDegrees, null);
  assert.equal(approx.position.speedMps, null);
  assert.equal(approx.position.accuracyM, 1000);
  // La antigüedad, la señal, la hora y los minutos de llegada y el aviso de llegada no cambian.
  assert.equal(approx.position.ageSeconds, 5);
  assert.equal(approx.position.stale, false);
  assert.equal(approx.position.recordedAt, precise.position.recordedAt);
  assert.equal(approx.signal, "live");
  assert.equal(approx.lastUpdateAt, precise.lastUpdateAt);
  assert.deepEqual(approx.arrival, precise.arrival);
  assert.equal(approx.phase, precise.phase);
  // La distancia restante en metros, junto con la ruta, daría el punto exacto: se oculta; todo lo demás del ETA se mantiene.
  assert.deepEqual(approx.eta, { ...precise.eta!, distanceM: null });
  const approxInCar = await getInCarState(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.equal(approxInCar.remaining!.distanceM, null);
  assert.equal(approxInCar.etaAtDestination!.distanceM, null);
  assert.equal(approxInCar.remaining!.minutes, preciseInCar.remaining!.minutes);
  assert.equal(approxInCar.etaAtDestination!.at, preciseInCar.etaAtDestination!.at);

  // El ajuste es del CONDUCTOR y vale para todos sus pasajeros.
  assert.equal((await getBookingLive(pool, asLaura(s), s.lauraBooking, NOW)).position!.precision, "approximate");

  // Reactivarlo devuelve la posición precisa y la distancia restante.
  await setShareLiveLocation(pool, s.world.ana, true);
  const restored = await getBookingLive(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.equal(restored.position!.precision, "precise");
  assert.deepEqual(restored.eta, precise.eta);
});

test("el ajuste de un pasajero no afecta a la posición del coche; la consola del conductor siempre es precisa", async () => {
  const s = await scene();
  const where = between(SEVILLA.luisMontoto, SEVILLA.puertaJerez, 0.4);
  await setPosition(pool, s.trip.tripId, s.world.ana, where, secondsAfter(NOW, -3));
  await setShareLiveLocation(pool, s.world.miguel, false);
  await setShareLiveLocation(pool, s.world.laura, false);
  assert.equal((await getBookingLive(pool, asMiguel(s), s.miguelBooking, NOW)).position!.precision, "precise");
  assert.equal((await getBookingLive(pool, asLaura(s), s.lauraBooking, NOW)).position!.precision, "precise");

  // Con el ajuste del conductor desactivado, él sigue viendo su propia posición exacta.
  await setShareLiveLocation(pool, s.world.ana, false);
  const consoleView = await getDriverConsole(pool, principalOf(s.world.ana, ["driver", "passenger"]), s.trip.tripId, true, NOW);
  assert.ok(consoleView.position);
  assert.equal(consoleView.position.precision, "precise");
  assert.ok(near(consoleView.position.location.lat, where.lat) && near(consoleView.position.location.lng, where.lng));
  assert.equal((await getBookingLive(pool, asMiguel(s), s.miguelBooking, NOW)).position!.precision, "approximate");
});

test("posición vieja con el ajuste desactivado: sigue siendo obsoleta (stale) y aproximada, nunca «en directo»", async () => {
  const s = await scene();
  await setShareLiveLocation(pool, s.world.ana, false);
  await setPosition(pool, s.trip.tripId, s.world.ana, between(SEVILLA.santaJusta, SEVILLA.luisMontoto, 0.5), secondsAfter(NOW, -130));
  const view = await getBookingLive(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.equal(view.signal, "stale");
  assert.ok(view.position);
  assert.equal(view.position.stale, true);
  assert.equal(view.position.ageSeconds, 130);
  assert.equal(view.position.precision, "approximate");
  assert.equal(view.arrival.warning, false);
});

test("sin posición no hay nada que aproximar: el ajuste desactivado no inventa un punto", async () => {
  const s = await scene("published");
  await setShareLiveLocation(pool, s.world.ana, false);
  const view = await getBookingLive(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.equal(view.position, null);
  assert.equal(view.signal, "none");
});
