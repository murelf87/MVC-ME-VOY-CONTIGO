import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DomainError } from "../src/errors.js";
import { getDriverConsole } from "../src/modules/live/console-service.js";
import { getInCarState } from "../src/modules/live/passenger-service.js";
import { getLivePrivacy, setLivePrivacy } from "../src/modules/live/privacy-service.js";
import { createRouteChange } from "../src/modules/live/route-change-service.js";
import { createShare, getShare, getSharedTrip, hashShareToken, revokeShare } from "../src/modules/live/share-service.js";
import { createRating } from "../src/modules/live/feedback-service.js";
import { generateOwnPickupCode, verifyPickupCode } from "../src/services/trip-execution-service.js";
import {
  between, createPool, FakeRouteProvider, minutesAfter, principalOf, secondsAfter, seedBooking, seedTrip, seedUser, seedWorld,
  setPosition, truncateAll, SEVILLA, type SeededTrip, type World
} from "./live-support.js";

const pool = createPool();
const NOW = new Date("2026-10-05T05:17:00.000Z");
const DEPARTURE = new Date("2026-10-05T05:10:00.000Z");

before(async () => { await pool.query("select 1 from trip_shares limit 1"); });
beforeEach(async () => {
  await truncateAll(pool);
  delete process.env.PUBLIC_SHARE_BASE_URL;
  delete process.env.LIVE_STALE_AFTER_SECONDS;
});
after(async () => { await pool.end(); });

type Scene = { world: World; trip: SeededTrip; miguelBooking: string; lauraBooking: string };

async function scene(status: "published" | "active" | "completed" = "active"): Promise<Scene> {
  const world = await seedWorld(pool);
  const trip = await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, { status, departureAt: DEPARTURE });
  const done = status === "completed";
  const miguel = await seedBooking(pool, trip.tripId, world.miguel, 1, 3, done ? { status: "completed", pickedUpAt: minutesAfter(DEPARTURE, 2) } : {});
  const laura = await seedBooking(pool, trip.tripId, world.laura, 2, 3, done ? { status: "completed", pickedUpAt: minutesAfter(DEPARTURE, 20) } : {});
  return { world, trip, miguelBooking: miguel.bookingId!, lauraBooking: laura.bookingId! };
}

const asAna = (s: Scene) => principalOf(s.world.ana, ["driver", "passenger"]);
const asMiguel = (s: Scene) => principalOf(s.world.miguel);
const asLaura = (s: Scene) => principalOf(s.world.laura);

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

/* ───────────────────────────── Compartir viaje (privado) ───────────────────────────── */

test("crear el enlace: token opaco de un solo uso visible, solo se guarda su hash y caduca en 6 h por defecto", async () => {
  const s = await scene();
  const created = await createShare(pool, asMiguel(s), s.miguelBooking, {}, NOW);
  assert.match(created.token, /^mvc_share_[A-Za-z0-9_-]{43}$/);
  assert.equal(created.url, null, "sin PUBLIC_SHARE_BASE_URL no se inventa una URL");
  assert.equal(created.status, "active");
  assert.equal(created.includePlate, false);
  assert.equal(created.bookingId, s.miguelBooking);
  assert.equal(created.tripId, s.trip.tripId);
  assert.equal(created.expiresAt, minutesAfter(NOW, 360).toISOString());
  assert.equal(created.createdAt, NOW.toISOString());
  assert.equal(created.revokedAt, null);
  assert.equal(created.lastViewedAt, null);
  assert.equal(created.viewCount, 0);

  const stored = (await pool.query(`select * from trip_shares`)).rows;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].token_hash, hashShareToken(created.token));
  assert.equal(JSON.stringify(stored).includes(created.token), false, "el token en claro no se guarda");
  assert.equal((await pool.query(`select 1 from audit_events where action='trip_share.created' and entity_id=$1`, [created.id])).rowCount, 1);
  assert.equal(JSON.stringify(await pool.query(`select metadata from audit_events`)).includes(created.token), false);

  // GET devuelve el estado del enlace sin el token.
  const state = await getShare(pool, asMiguel(s), s.miguelBooking, NOW);
  assert.equal(state.share!.id, created.id);
  assert.equal("token" in state.share!, false);
  assert.equal("url" in state.share!, false);
});

test("con PUBLIC_SHARE_BASE_URL el enlace completo se devuelve una sola vez", async () => {
  process.env.PUBLIC_SHARE_BASE_URL = "https://mvc.example/ver/";
  const s = await scene();
  const created = await createShare(pool, asMiguel(s), s.miguelBooking, { includePlate: true, expiresInMinutes: 90 }, NOW);
  assert.equal(created.url, `https://mvc.example/ver/${created.token}`);
  assert.equal(created.includePlate, true);
  assert.equal(created.expiresAt, minutesAfter(NOW, 90).toISOString());
});

test("solo un enlace activo por reserva: al crear otro el anterior queda revocado", async () => {
  const s = await scene();
  const first = await createShare(pool, asMiguel(s), s.miguelBooking, {}, NOW);
  const second = await createShare(pool, asMiguel(s), s.miguelBooking, {}, secondsAfter(NOW, 30));
  assert.notEqual(first.token, second.token);
  await failsWith(getSharedTrip(pool, first.token, secondsAfter(NOW, 31)), "SHARE_REVOKED", 410);
  assert.equal((await getSharedTrip(pool, second.token, secondsAfter(NOW, 31))).passengerFirstName, "Miguel");
  assert.equal((await getShare(pool, asMiguel(s), s.miguelBooking, secondsAfter(NOW, 31))).share!.id, second.id);
  assert.equal((await pool.query(`select 1 from trip_shares where revoked_at is null`)).rowCount, 1);
  // Laura tiene el suyo, independiente.
  const lauras = await createShare(pool, asLaura(s), s.lauraBooking, {}, NOW);
  assert.equal((await getSharedTrip(pool, second.token, secondsAfter(NOW, 31))).passengerFirstName, "Miguel");
  assert.equal((await getSharedTrip(pool, lauras.token, secondsAfter(NOW, 31))).passengerFirstName, "Laura");
});

test("las creaciones simultáneas dejan un único enlace activo", async () => {
  const s = await scene();
  await Promise.all([1, 2, 3, 4].map(() => createShare(pool, asMiguel(s), s.miguelBooking, {}, NOW)));
  assert.equal((await pool.query(`select 1 from trip_shares`)).rowCount, 4);
  assert.equal((await pool.query(`select 1 from trip_shares where revoked_at is null`)).rowCount, 1);
});

test("duración válida: de 15 minutos a 24 horas, en minutos enteros", async () => {
  const s = await scene();
  for (const minutes of [14, 0, -5, 1441, 30.5, Number.NaN]) {
    const error = await failsWith(createShare(pool, asMiguel(s), s.miguelBooking, { expiresInMinutes: minutes }, NOW), "SHARE_INVALID_DURATION", 400);
    assert.deepEqual(error.details, { min: 15, max: 1440 });
  }
  assert.equal((await createShare(pool, asMiguel(s), s.miguelBooking, { expiresInMinutes: 15 }, NOW)).expiresAt, minutesAfter(NOW, 15).toISOString());
  assert.equal((await createShare(pool, asMiguel(s), s.miguelBooking, { expiresInMinutes: 1440 }, NOW)).expiresAt, minutesAfter(NOW, 1440).toISOString());
});

test("solo se comparte una reserva confirmada de un viaje publicado o activo", async () => {
  const s = await scene();
  await pool.query(`update bookings set status='cancelled' where id=$1`, [s.miguelBooking]);
  await failsWith(createShare(pool, asMiguel(s), s.miguelBooking, {}, NOW), "SHARE_NOT_ALLOWED", 409);

  await truncateAll(pool);
  const done = await scene("completed");
  await failsWith(createShare(pool, asMiguel(done), done.miguelBooking, {}, NOW), "SHARE_NOT_ALLOWED", 409);

  await truncateAll(pool);
  const published = await scene("published");
  assert.equal((await createShare(pool, asMiguel(published), published.miguelBooking, {}, NOW)).status, "active");
});

test("solo el pasajero titular gestiona el enlace; el resto recibe 404", async () => {
  const s = await scene();
  const stranger = await seedUser(pool, "Curioso");
  for (const who of [asLaura(s), asAna(s), principalOf(stranger)]) {
    for (const call of [
      () => createShare(pool, who, s.miguelBooking, {}, NOW),
      () => getShare(pool, who, s.miguelBooking, NOW),
      () => revokeShare(pool, who, s.miguelBooking, NOW)
    ]) {
      await failsWith(call(), "BOOKING_NOT_FOUND", 404);
    }
  }
  assert.equal((await pool.query(`select 1 from trip_shares`)).rowCount, 0);
  assert.deepEqual(await getShare(pool, asMiguel(s), s.miguelBooking, NOW), { share: null });
});

test("revocar corta el acceso al instante, es idempotente y se audita", async () => {
  const s = await scene();
  const created = await createShare(pool, asMiguel(s), s.miguelBooking, {}, NOW);
  assert.equal((await getSharedTrip(pool, created.token, secondsAfter(NOW, 5))).passengerFirstName, "Miguel");

  await revokeShare(pool, asMiguel(s), s.miguelBooking, secondsAfter(NOW, 10));
  await failsWith(getSharedTrip(pool, created.token, secondsAfter(NOW, 11)), "SHARE_REVOKED", 410);
  const state = (await getShare(pool, asMiguel(s), s.miguelBooking, secondsAfter(NOW, 11))).share!;
  assert.equal(state.status, "revoked");
  assert.equal(state.revokedAt, secondsAfter(NOW, 10).toISOString());
  // Repetir no falla ni vuelve a auditar.
  await revokeShare(pool, asMiguel(s), s.miguelBooking, secondsAfter(NOW, 20));
  assert.equal((await pool.query(`select 1 from audit_events where action='trip_share.revoked'`)).rowCount, 1);
  assert.equal((await getShare(pool, asMiguel(s), s.miguelBooking, secondsAfter(NOW, 21))).share!.revokedAt, secondsAfter(NOW, 10).toISOString());
  // Se puede crear uno nuevo después.
  const again = await createShare(pool, asMiguel(s), s.miguelBooking, {}, secondsAfter(NOW, 60));
  assert.equal((await getSharedTrip(pool, again.token, secondsAfter(NOW, 61))).passengerFirstName, "Miguel");
});

test("el enlace caduca exactamente en expiresAt y deja de ser consultable", async () => {
  const s = await scene();
  const created = await createShare(pool, asMiguel(s), s.miguelBooking, { expiresInMinutes: 15 }, NOW);
  const justBefore = new Date(Date.parse(created.expiresAt) - 1);
  assert.equal((await getSharedTrip(pool, created.token, justBefore)).expiresAt, created.expiresAt);
  await failsWith(getSharedTrip(pool, created.token, new Date(created.expiresAt)), "SHARE_EXPIRED", 410);
  await failsWith(getSharedTrip(pool, created.token, minutesAfter(NOW, 600)), "SHARE_EXPIRED", 410);
  assert.equal((await getShare(pool, asMiguel(s), s.miguelBooking, minutesAfter(NOW, 16))).share!.status, "expired");
  // «En el coche» refleja el estado del enlace: activo mientras vale, inactivo cuando caduca.
  assert.deepEqual((await getInCarState(pool, asMiguel(s), s.miguelBooking, minutesAfter(NOW, 10))).share, { active: true, expiresAt: created.expiresAt });
  assert.deepEqual((await getInCarState(pool, asMiguel(s), s.miguelBooking, minutesAfter(NOW, 16))).share, { active: false, expiresAt: null });
});

test("tokens mal formados o desconocidos dan 404 sin revelar nada", async () => {
  const s = await scene();
  await createShare(pool, asMiguel(s), s.miguelBooking, {}, NOW);
  for (const token of ["", "abc", "mvc_share_corto", `mvc_share_${"A".repeat(80)}`, `mvc_share_${"!".repeat(43)}`, `otro_${"A".repeat(43)}`, `mvc_share_${"A".repeat(43)}`]) {
    await failsWith(getSharedTrip(pool, token, NOW), "SHARE_NOT_FOUND", 404);
  }
});

test("la vista pública solo muestra lo necesario: posición aproximada (~1 km), sin identificadores ni coordenadas exactas", async () => {
  const s = await scene();
  const fix = between(SEVILLA.luisMontoto, SEVILLA.puertaJerez, 0.5);
  await setPosition(pool, s.trip.tripId, s.world.ana, fix, secondsAfter(NOW, -4));
  const created = await createShare(pool, asMiguel(s), s.miguelBooking, {}, NOW);

  const view = await getSharedTrip(pool, created.token, NOW);
  assert.deepEqual(Object.keys(view).sort(), [
    "driverFirstName", "eta", "expiresAt", "passengerFirstName", "phase", "plannedDepartureAt", "position", "route", "serverTime", "signal", "vehicle"
  ]);
  assert.equal(view.passengerFirstName, "Miguel");
  assert.equal(view.driverFirstName, "Ana");
  assert.deepEqual(view.vehicle, { make: "Seat", model: "León", color: "Blanco", plate: null });
  assert.deepEqual(view.route, { originLabel: "C. Luis Montoto", destinationLabel: "Universidad de Sevilla" });
  assert.equal(view.signal, "live");
  assert.equal(view.serverTime, NOW.toISOString());
  assert.deepEqual(view.position, {
    location: { lat: 37.38, lng: -5.98 },
    recordedAt: secondsAfter(NOW, -4).toISOString(),
    ageSeconds: 4,
    stale: false,
    precision: "approximate"
  });
  assert.ok(view.eta, "hay ETA al destino de Miguel");
  assert.ok(Date.parse(view.eta.at) > NOW.getTime());
  assert.ok(view.eta.minutes > 0);
  // Una distancia exacta por la ruta, junto con el destino, revelaría el punto que la posición aproximada oculta.
  assert.equal(view.eta.distanceM, null);

  const text = JSON.stringify(view);
  for (const secret of [s.world.miguel, s.world.ana, s.world.laura, s.miguelBooking, s.trip.tripId, String(fix.lat), String(fix.lng), s.world.plate, "García", "Torres"]) {
    assert.equal(text.includes(secret), false, `la vista pública no debe contener ${secret}`);
  }
});

test("la matrícula solo se muestra si el pasajero lo decidió al crear el enlace", async () => {
  const s = await scene();
  const withPlate = await createShare(pool, asMiguel(s), s.miguelBooking, { includePlate: true }, NOW);
  assert.equal((await getSharedTrip(pool, withPlate.token, NOW)).vehicle.plate, s.world.plate);
  const without = await createShare(pool, asMiguel(s), s.miguelBooking, { includePlate: false }, secondsAfter(NOW, 1));
  assert.equal((await getSharedTrip(pool, without.token, secondsAfter(NOW, 2))).vehicle.plate, null);
});

test("cada consulta cuenta y registra la última vista; el pasajero ve cuántas veces se miró", async () => {
  const s = await scene();
  const created = await createShare(pool, asMiguel(s), s.miguelBooking, {}, NOW);
  await getSharedTrip(pool, created.token, secondsAfter(NOW, 5));
  await getSharedTrip(pool, created.token, secondsAfter(NOW, 9));
  const state = (await getShare(pool, asMiguel(s), s.miguelBooking, secondsAfter(NOW, 10))).share!;
  assert.equal(state.viewCount, 2);
  assert.equal(state.lastViewedAt, secondsAfter(NOW, 9).toISOString());
  // Las consultas fallidas no cuentan.
  await failsWith(getSharedTrip(pool, `mvc_share_${"B".repeat(43)}`, NOW), "SHARE_NOT_FOUND", 404);
  assert.equal((await getShare(pool, asMiguel(s), s.miguelBooking, secondsAfter(NOW, 11))).share!.viewCount, 2);
});

test("posición obsoleta en el enlace: se marca stale y nunca como en directo", async () => {
  const s = await scene();
  await setPosition(pool, s.trip.tripId, s.world.ana, between(SEVILLA.luisMontoto, SEVILLA.puertaJerez, 0.5), secondsAfter(NOW, -200));
  const created = await createShare(pool, asMiguel(s), s.miguelBooking, {}, NOW);
  const view = await getSharedTrip(pool, created.token, NOW);
  assert.equal(view.signal, "stale");
  assert.equal(view.position!.stale, true);
  assert.equal(view.position!.ageSeconds, 200);
  assert.equal(view.position!.precision, "approximate");
});

test("sin viaje activo no hay posición; con la reserva cancelada tampoco", async () => {
  const published = await scene("published");
  const created = await createShare(pool, asMiguel(published), published.miguelBooking, {}, NOW);
  const before = await getSharedTrip(pool, created.token, NOW);
  assert.equal(before.position, null);
  assert.equal(before.signal, "none");
  assert.equal(before.phase, "scheduled");
  assert.equal(before.plannedDepartureAt !== null, true);

  await truncateAll(pool);
  const s = await scene();
  await setPosition(pool, s.trip.tripId, s.world.ana, between(SEVILLA.luisMontoto, SEVILLA.puertaJerez, 0.5), secondsAfter(NOW, -4));
  const link = await createShare(pool, asMiguel(s), s.miguelBooking, {}, NOW);
  await pool.query(`update bookings set status='cancelled' where id=$1`, [s.miguelBooking]);
  const cancelled = await getSharedTrip(pool, link.token, NOW);
  assert.equal(cancelled.phase, "cancelled");
  assert.equal(cancelled.position, null);
  assert.equal(cancelled.eta, null);
});

test("el enlace no sigue al coche una vez que el pasajero ya bajó", async () => {
  const world = await seedWorld(pool);
  const trip = await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, { status: "active", departureAt: DEPARTURE });
  const early = await seedBooking(pool, trip.tripId, world.miguel, 1, 2, { pickedUpAt: minutesAfter(NOW, -8) });
  await seedBooking(pool, trip.tripId, world.laura, 2, 3);
  await setPosition(pool, trip.tripId, world.ana, between(SEVILLA.puertaJerez, SEVILLA.universidad, 0.5), secondsAfter(NOW, -3));
  const created = await createShare(pool, principalOf(world.miguel), early.bookingId!, {}, NOW);
  const view = await getSharedTrip(pool, created.token, NOW);
  assert.equal(view.position, null, "el coche ya pasó por el destino de Miguel");
});

/* ───────────────────────────── Consola del conductor ───────────────────────────── */

test("consola con el viaje publicado: pasajeros, códigos sin generar y acciones disponibles", async () => {
  const s = await scene("published");
  const view = await getDriverConsole(pool, asAna(s), s.trip.tripId, true, NOW);
  assert.equal(view.status, "published");
  assert.equal(view.signal, "none");
  assert.equal(view.position, null);
  assert.equal(view.next, null);
  assert.deepEqual(view.seats, { offered: 3, occupied: 2 });
  assert.deepEqual(view.counts, { total: 2, verified: 0, pending: 2 });
  assert.deepEqual(view.passengers.map(p => [p.passenger.firstName, p.pickup.label, p.dropoff.label, p.pickedUp, p.code.status]), [
    ["Miguel", "C. Luis Montoto", "Universidad de Sevilla", false, "not_generated"],
    ["Laura", "Puerta de Jerez", "Universidad de Sevilla", false, "not_generated"]
  ]);
  assert.deepEqual(view.actions, { canStart: true, canComplete: false, canProposeRouteChange: true, willMarkNoShow: 0 });
  assert.deepEqual(view.vehicle, { make: "Seat", model: "León", color: "Blanco", plate: s.world.plate });
  // Sin proveedor de rutas configurado no se ofrece proponer cambios.
  assert.equal((await getDriverConsole(pool, asAna(s), s.trip.tripId, false, NOW)).actions.canProposeRouteChange, false);
});

test("consola con el viaje activo: señal propia, siguiente recogida por ETA, códigos y no presentados", async () => {
  const s = await scene();
  await setPosition(pool, s.trip.tripId, s.world.ana, between(SEVILLA.santaJusta, SEVILLA.luisMontoto, 0.5), secondsAfter(NOW, -4));
  const generated = await generateOwnPickupCode(pool, asMiguel(s), s.miguelBooking);

  const before = await getDriverConsole(pool, asAna(s), s.trip.tripId, true, NOW);
  assert.equal(before.status, "active");
  assert.equal(before.signal, "live");
  assert.equal(before.position!.stale, false);
  assert.equal(before.next!.passenger.firstName, "Miguel", "la recogida con menor ETA");
  assert.ok(before.next!.etaToPickup);
  assert.deepEqual(before.passengers[0]!.code, { status: "active", attemptsRemaining: 5 });
  assert.deepEqual(before.passengers[1]!.code, { status: "not_generated", attemptsRemaining: null });
  assert.deepEqual(before.actions, { canStart: false, canComplete: true, canProposeRouteChange: true, willMarkNoShow: 2 });
  assert.equal(JSON.stringify(before).includes(generated.code), false, "el código en claro nunca llega a la consola");

  await verifyPickupCode(pool, asAna(s), s.miguelBooking, generated.code);
  const after = await getDriverConsole(pool, asAna(s), s.trip.tripId, true, secondsAfter(NOW, 5));
  assert.deepEqual(after.counts, { total: 2, verified: 1, pending: 1 });
  assert.equal(after.next!.passenger.firstName, "Laura");
  assert.equal(after.passengers[0]!.pickedUp, true);
  assert.deepEqual(after.passengers[0]!.code, { status: "verified", attemptsRemaining: null });
  assert.equal(after.passengers[0]!.etaToPickup, null);
  assert.equal(after.actions.willMarkNoShow, 1);

  // GPS propio obsoleto: se dice.
  const stale = await getDriverConsole(pool, asAna(s), s.trip.tripId, true, secondsAfter(NOW, 300));
  assert.equal(stale.signal, "stale");
  assert.equal(stale.position!.stale, true);
});

test("consola: una propuesta de cambio de ruta pendiente aparece y bloquea otra nueva", async () => {
  const s = await scene("published");
  const { view } = await createRouteChange(
    pool, asAna(s), new FakeRouteProvider(), { tripId: s.trip.tripId, stop: { lat: 37.3935, lng: -5.9919, label: "Plaza de la Encarnación" } }, NOW
  );
  const console_ = await getDriverConsole(pool, asAna(s), s.trip.tripId, true, NOW);
  assert.deepEqual(console_.pendingRouteChange, {
    id: view.id, createdAt: view.createdAt, expiresAt: view.expiresAt, counts: view.counts
  });
  assert.equal(console_.actions.canProposeRouteChange, false);
  // Caducada deja de estar pendiente y vuelve a permitirse.
  const later = await getDriverConsole(pool, asAna(s), s.trip.tripId, true, secondsAfter(NOW, 400));
  assert.equal(later.pendingRouteChange, null);
  assert.equal(later.actions.canProposeRouteChange, true);
});

test("consola de un viaje terminado: marca a quién ya valoré y no ofrece acciones", async () => {
  const s = await scene("completed");
  const after = new Date("2026-10-05T06:30:00.000Z");
  await createRating(pool, asAna(s), s.trip.tripId, { rateeUserId: s.world.miguel, stars: 5 }, after);
  const view = await getDriverConsole(pool, asAna(s), s.trip.tripId, true, after);
  assert.equal(view.status, "completed");
  assert.deepEqual(view.passengers.map(p => [p.passenger.firstName, p.ratedByMe]), [["Miguel", true], ["Laura", false]]);
  assert.deepEqual(view.actions, { canStart: false, canComplete: false, canProposeRouteChange: false, willMarkNoShow: 0 });
  assert.equal(view.position, null);
  assert.ok(view.completedAt);
});

test("consola: solo el conductor propietario con rol de conductor; borradores no", async () => {
  const s = await scene("published");
  const otherDriver = await seedUser(pool, "Otro Conductor", { roles: ["driver"] });
  await failsWith(getDriverConsole(pool, asMiguel(s), s.trip.tripId, true, NOW), "AUTH_FORBIDDEN", 403);
  await failsWith(getDriverConsole(pool, principalOf(otherDriver, ["driver"]), s.trip.tripId, true, NOW), "TRIP_NOT_OWNED", 403);
  await pool.query(`update trips set status='draft' where id=$1`, [s.trip.tripId]);
  await failsWith(getDriverConsole(pool, asAna(s), s.trip.tripId, true, NOW), "CONSOLE_TRIP_NOT_PUBLISHED", 409);
  await failsWith(getDriverConsole(pool, asAna(s), "00000000-0000-4000-8000-000000000000", true, NOW), "TRIP_NOT_FOUND", 404);
});

/* ───────────────────────────── Privacidad del mapa en vivo ───────────────────────────── */

test("por defecto un copasajero no comparte su perfil; el cambio se guarda y se puede revertir", async () => {
  const s = await scene();
  assert.deepEqual(await getLivePrivacy(pool, s.world.miguel), { showProfileToCoPassengers: false, updatedAt: null });
  const on = await setLivePrivacy(pool, s.world.miguel, true, NOW);
  assert.deepEqual(on, { showProfileToCoPassengers: true, updatedAt: NOW.toISOString() });
  assert.deepEqual(await getLivePrivacy(pool, s.world.miguel), on);
  // Es por persona: Laura no cambia.
  assert.equal((await getLivePrivacy(pool, s.world.laura)).showProfileToCoPassengers, false);
  const off = await setLivePrivacy(pool, s.world.miguel, false, secondsAfter(NOW, 60));
  assert.deepEqual(off, { showProfileToCoPassengers: false, updatedAt: secondsAfter(NOW, 60).toISOString() });
  assert.equal((await pool.query(`select 1 from live_privacy_preferences`)).rowCount, 1);
});
