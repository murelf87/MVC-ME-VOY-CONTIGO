import test, { after, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { confirmProviderPayment } from "../src/services/reservation-service.js";
import * as S from "./trips-support.js";

/**
 * Mis viajes (pantalla 30) y destinos favoritos + rutina semanal (pantalla 31).
 * Base de datos propia: mvc_trips.
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

const nextMonday = (): string => S.addDaysIso(S.mondayOfDate(S.madrid(new Date()).date), 7);
const WORKDAYS = ["mon", "tue", "wed", "thu", "fri"];
const PUBLIC_USER_KEYS = ["displayName", "firstName", "id", "photoUrl", "ratingAverage", "ratingCount"];

const overview = (token: string, query: string) => S.api(app, token).get(`/v1/me/trips/overview?${query}`);
const newTrip = (seed: S.TripSeed = {}): Promise<S.SeededTrip> => S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, seed);

/** Ana publica «lunes a viernes» 07:00 con `seats` plazas empezando en `startDate`, por la API. */
async function publishSeries(startDate: string, seats = 2): Promise<{ seriesId: string; anchorTripId: string }> {
  const r = await S.api(app, tokens.ana).post("/v1/me/routes", {
    vehicleId: w.vehicleId, provinceId: w.provinceId, category: "work",
    origin: { lat: S.SEVILLA.palomares.lat, lng: S.SEVILLA.palomares.lng, label: "Palomares del Río" },
    destination: { lat: S.SEVILLA.trabajo.lat, lng: S.SEVILLA.trabajo.lng, label: "Sevilla (Trabajo)" },
    stops: [{ lat: S.SEVILLA.mairena.lat, lng: S.SEVILLA.mairena.lng, label: "Mairena del Aljarafe" }],
    frequency: "daily_workdays", outboundLocal: "07:00", startDate, seats, maxDetourMinutes: 5, pickupOnRoute: false
  }, { "Idempotency-Key": S.idemKey() });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { seriesId: r.body.seriesId, anchorTripId: r.body.trips.find((t: { leg: string }) => t.leg === "outbound").id };
}

async function weeklyReservation(token: string, anchorTripId: string): Promise<{ id: string; occurrences: Array<{ requestId: string }> }> {
  const pickup = await S.api(app, token).get(`/v1/trips/${anchorTripId}/pickup-points?lat=37.3460&lng=-6.0600`);
  assert.equal(pickup.status, 200, JSON.stringify(pickup.body));
  const r = await S.api(app, token).post(`/v1/trips/${anchorTripId}/weekly-requests`, {
    pickupPointId: pickup.body.proposals[0].id, weekdays: WORKDAYS, legs: ["outbound"], startDate: nextMonday(), weeks: 1
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

describe("Mis viajes como pasajero (pantalla 30)", () => {
  test("próximos, en curso e historial: estado, ocupación, avatares solo de confirmados y cuenta atrás", async () => {
    const now = new Date();
    const soon = await newTrip({ departureAt: S.minutesAfter(now, 40) });
    const later = await newTrip({ departureAt: S.hoursAfter(now, 50) });
    const unpaid = await newTrip({ departureAt: S.hoursAfter(now, 72) });
    const live = await newTrip({ status: "active", departureAt: S.minutesAfter(now, -15) });
    const done = await newTrip({ status: "completed", departureAt: S.hoursAfter(now, -72) });
    const refused = await newTrip({ departureAt: S.hoursAfter(now, -48) });
    const cancelled = await newTrip({ status: "cancelled", departureAt: S.hoursAfter(now, 24) });

    const mSoon = await S.seedRequest(pool, soon.tripId, w.miguel, 0, 2, { status: "confirmed" });
    await S.seedRequest(pool, soon.tripId, w.laura, 0, 1, { status: "confirmed" });
    await S.seedRequest(pool, later.tripId, w.miguel, 1, 2);
    await S.seedRequest(pool, later.tripId, w.laura, 1, 2, { status: "confirmed" });
    await S.seedRequest(pool, unpaid.tripId, w.miguel, 0, 2, { status: "payment_pending" });
    await S.seedRequest(pool, live.tripId, w.miguel, 0, 2, { status: "confirmed" });
    await S.seedRequest(pool, done.tripId, w.miguel, 0, 2, { status: "confirmed", bookingStatus: "completed" });
    await S.seedRequest(pool, refused.tripId, w.miguel, 0, 2, { status: "rejected" });
    await S.seedRequest(pool, cancelled.tripId, w.miguel, 0, 2, { status: "confirmed", bookingStatus: "driver_cancelled" });

    const r = await overview(tokens.miguel, "role=passenger");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.role, "passenger");
    assert.deepEqual(r.body.counts, { upcoming: 3, inProgress: 1, history: 3 });
    assert.deepEqual(r.body.upcoming.map((c: { tripId: string }) => c.tripId), [soon.tripId, later.tripId, unpaid.tripId]);

    const [first, second, third] = r.body.upcoming;
    assert.equal(first.kind, "trip");
    assert.equal(first.role, "passenger");
    assert.equal(first.requestId, mSoon.requestId);
    assert.equal(first.id, mSoon.requestId);
    assert.equal(first.bookingId, mSoon.bookingId);
    assert.deepEqual(first.status, { code: "confirmed", label: "Confirmada" });
    assert.equal(first.phase, "scheduled");
    assert.equal(first.title, "Trabajo – Sevilla (Trabajo)");
    assert.equal(first.category, "work");
    assert.deepEqual(first.from, { label: "Palomares del Río", timeLocal: S.madrid(soon.departureAt).time });
    assert.deepEqual(first.to, { label: "Sevilla (Trabajo)", timeLocal: S.madrid(soon.arrivals[2]!).time });
    assert.ok(first.startsInMinutes >= 39 && first.startsInMinutes <= 41, `startsInMinutes=${first.startsInMinutes}`);
    assert.equal(first.liveEta, null);
    assert.deepEqual(first.occupancy, { occupied: 2, total: 3 });
    assert.deepEqual(first.riders.map((u: { firstName: string }) => u.firstName), ["Laura"], "ve a los demás confirmados");
    assert.deepEqual(Object.keys(first.riders[0]).sort(), PUBLIC_USER_KEYS.slice().sort(), "solo datos públicos");

    assert.deepEqual(second.status, { code: "pending", label: "Pendiente" });
    assert.equal(second.startsInMinutes, null, "faltan más de 3 h");
    assert.deepEqual(second.riders, [], "una solicitud pendiente no ve a los confirmados");
    assert.equal(second.bookingId, null);
    assert.deepEqual(third.status, { code: "payment_pending", label: "Pago pendiente" });
    assert.deepEqual(third.occupancy, { occupied: 1, total: 3 }, "el hold activo cuenta como plaza ocupada");

    const [running] = r.body.inProgress;
    assert.equal(running.tripId, live.tripId);
    assert.deepEqual(running.status, { code: "live", label: "En curso" });
    assert.equal(running.phase, "live");
    assert.equal(running.startsInMinutes, null);
    assert.equal(running.liveEta, null, "sin posición del conductor no se inventa una ETA");

    assert.deepEqual(r.body.history.items.map((c: { tripId: string }) => c.tripId), [cancelled.tripId, refused.tripId, done.tripId]);
    assert.deepEqual(r.body.history.items.map((c: { status: { code: string } }) => c.status.code), ["cancelled", "rejected", "completed"]);
    assert.ok(r.body.history.items.every((c: { phase: string }) => c.phase === "finished"));
    assert.equal(r.body.history.nextCursor, null);

    // Laura solo ve lo suyo y a Miguel donde ambos están confirmados.
    const laura = await overview(tokens.laura, "role=passenger");
    assert.deepEqual(laura.body.counts, { upcoming: 2, inProgress: 0, history: 0 });
    assert.deepEqual(laura.body.upcoming[0].riders.map((u: { firstName: string }) => u.firstName), ["Miguel"]);
    assert.deepEqual(laura.body.upcoming[1].riders, [], "Miguel está pendiente en ese viaje: no aparece");
  });

  test("un pago pendiente cuyo hold ya venció se caduca al abrir la pantalla: no aparece como «Pago pendiente»", async () => {
    const trip = await newTrip({ departureAt: S.hoursAfter(new Date(), 50) });
    const seeded = await S.seedRequest(pool, trip.tripId, w.miguel, 0, 2, { status: "payment_pending", holdExpiresAt: S.minutesAfter(new Date(), -1) });
    const r = await overview(tokens.miguel, "role=passenger");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.counts, { upcoming: 0, inProgress: 0, history: 1 });
    assert.deepEqual(r.body.history.items[0].status, { code: "expired", label: "Caducada" });
    assert.equal((await pool.query(`select status from ride_requests where id=$1`, [seeded.requestId])).rows[0]!.status, "expired");
    assert.equal((await pool.query(`select status from seat_holds where id=$1`, [seeded.holdId])).rows[0]!.status, "released");
    assert.equal(await S.count(pool, `select 1 from notifications where user_id='${w.miguel}' and kind='request_expired'`), 1);
  });

  test("ETA en directo: «El conductor llegará en unos N min» solo con posición fresca y el coche aún antes de la recogida", async () => {
    const trip = await newTrip({ status: "active", departureAt: S.minutesAfter(new Date(), -5) });
    await S.seedRequest(pool, trip.tripId, w.miguel, 1, 2, { status: "confirmed" }); // sube en la parada 1 (Mairena)
    const eta = async () => (await overview(tokens.miguel, "role=passenger")).body.inProgress[0].liveEta;
    const fresh = () => S.secondsAfter(new Date(), -5);
    const a = S.SEVILLA.palomares;
    const b = S.SEVILLA.mairena;

    assert.equal(await eta(), null, "sin posición");
    await S.setPosition(pool, trip.tripId, w.ana, a, fresh());
    const minutes = Math.ceil(trip.segments[0]!.durationS / 60);
    assert.deepEqual(await eta(), { minutes, phrase: `El conductor llegará en unos ${minutes} min`, stale: false });

    // al 95 % del primer tramo: a punto de llegar
    await S.setPosition(pool, trip.tripId, w.ana, { lat: a.lat + 0.95 * (b.lat - a.lat), lng: a.lng + 0.95 * (b.lng - a.lng) }, fresh());
    assert.deepEqual(await eta(), { minutes: 1, phrase: "El conductor está a punto de llegar", stale: false });

    // posición vieja (> 60 s): no se muestra una ETA que ya no es cierta
    await S.setPosition(pool, trip.tripId, w.ana, a, S.secondsAfter(new Date(), -180));
    assert.equal(await eta(), null);

    // el coche ya pasó por la recogida
    await S.setPosition(pool, trip.tripId, w.ana, S.SEVILLA.trabajo, fresh());
    assert.equal(await eta(), null);
  });

  test("reserva semanal: UNA tarjeta por reserva (no una por día), con estado agregado, antes de los viajes sueltos", async () => {
    const series = await publishSeries(nextMonday());
    const reservation = await weeklyReservation(tokens.miguel, series.anchorTripId);
    const single = await newTrip({ departureAt: S.hoursAfter(new Date(), 30) });
    await S.seedRequest(pool, single.tripId, w.miguel, 0, 2);

    let r = await overview(tokens.miguel, "role=passenger");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.counts, { upcoming: 2, inProgress: 0, history: 0 });
    const [card, one] = r.body.upcoming;
    assert.equal(card.kind, "weekly_reservation");
    assert.equal(card.id, reservation.id);
    assert.equal(card.reservationId, reservation.id);
    assert.equal(card.seriesId, series.seriesId);
    assert.deepEqual(card.recurrence, { weekdays: WORKDAYS, recurring: true, label: "Lun - Vie · Recurrente" });
    assert.deepEqual(card.status, { code: "pending", label: "Pendiente" });
    assert.equal(card.title, "Trabajo");
    assert.equal(card.to.label, "Sevilla (Trabajo)");
    assert.match(card.from.timeLocal, /^\d{2}:\d{2}$/);
    assert.equal(one.kind, "trip");
    assert.equal(one.tripId, single.tripId);

    // el conductor acepta: «Pago pendiente»
    const decided = await S.api(app, tokens.ana).post(`/v1/weekly-reservations/${reservation.id}/decision`, { decision: "accept" });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    r = await overview(tokens.miguel, "role=passenger");
    assert.deepEqual(r.body.upcoming[0].status, { code: "payment_pending", label: "Pago pendiente" });
    assert.equal(r.body.counts.upcoming, 2);

    // paga (misma función que usa la confirmación real): «Confirmada», y la ocupación refleja su plaza
    for (const occurrence of reservation.occurrences) {
      const paid = await confirmProviderPayment(pool, { requestId: occurrence.requestId, providerPaymentId: `pay-${occurrence.requestId}`, amountCents: 0 });
      assert.equal(paid.status, "confirmed");
    }
    r = await overview(tokens.miguel, "role=passenger");
    assert.deepEqual(r.body.upcoming[0].status, { code: "confirmed", label: "Confirmada" });
    assert.deepEqual(r.body.upcoming[0].occupancy, { occupied: 1, total: 2 });
    assert.equal(r.body.counts.upcoming, 2, "siguen siendo una tarjeta semanal y un viaje suelto");
  });

  test("historial paginado con cursor; `section` filtra y los contadores no cambian", async () => {
    const trips: string[] = [];
    for (let i = 1; i <= 5; i += 1) {
      const t = await newTrip({ status: "completed", departureAt: S.hoursAfter(new Date(), -24 * i) });
      await S.seedRequest(pool, t.tripId, w.miguel, 0, 2, { status: "confirmed", bookingStatus: "completed" });
      trips.push(t.tripId);
    }
    const first = await overview(tokens.miguel, "role=passenger&section=history&limit=2");
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(first.body.upcoming, []);
    assert.deepEqual(first.body.inProgress, []);
    assert.equal(first.body.counts.history, 5);
    assert.deepEqual(first.body.history.items.map((c: { tripId: string }) => c.tripId), trips.slice(0, 2));
    assert.equal(typeof first.body.history.nextCursor, "string");

    const second = await overview(tokens.miguel, `role=passenger&section=history&limit=2&cursor=${encodeURIComponent(first.body.history.nextCursor)}`);
    assert.deepEqual(second.body.history.items.map((c: { tripId: string }) => c.tripId), trips.slice(2, 4));
    const third = await overview(tokens.miguel, `role=passenger&section=history&limit=2&cursor=${encodeURIComponent(second.body.history.nextCursor)}`);
    assert.deepEqual(third.body.history.items.map((c: { tripId: string }) => c.tripId), trips.slice(4));
    assert.equal(third.body.history.nextCursor, null);

    const upcomingOnly = await overview(tokens.miguel, "role=passenger&section=upcoming");
    assert.deepEqual(upcomingOnly.body.history, { items: [], nextCursor: null });
    assert.equal(upcomingOnly.body.counts.history, 5, "los contadores no dependen de la sección");

    const bad = await overview(tokens.miguel, "role=passenger&section=history&cursor=@@@");
    assert.equal(bad.status, 400);
    assert.equal(S.codeOf(bad), "INVALID_CURSOR");
  });

  test("roles, sesión y validación", async () => {
    assert.equal((await S.api(app).get("/v1/me/trips/overview?role=passenger")).status, 401);
    const asDriver = await overview(tokens.miguel, "role=driver");
    assert.equal(asDriver.status, 403);
    assert.equal(S.codeOf(asDriver), "AUTH_FORBIDDEN");
    const driverOnly = await S.sessionTokenFor(pool, await S.seedUser(pool, "Solo Conductor", { roles: ["driver"] }));
    assert.equal((await overview(driverOnly, "role=passenger")).status, 403);
    assert.equal((await overview(driverOnly, "role=driver")).status, 200);
    assert.equal((await overview(tokens.miguel, "")).status, 400, "`role` es obligatorio");
    assert.equal((await overview(tokens.miguel, "role=passenger&limit=0")).status, 400);
    assert.equal((await overview(tokens.miguel, "role=passenger&limit=51")).status, 400);
    assert.equal((await overview(tokens.miguel, "role=passenger&section=otra")).status, 400);
  });
});

describe("Mis viajes como conductor (pantalla 30)", () => {
  test("serie como tarjeta recurrente, viajes sueltos, en curso e historial; confirmados como avatares y sin ETA", async () => {
    const now = new Date();
    const series = await publishSeries(S.addDaysIso(nextMonday(), 7), 2);
    const soon = await newTrip({ departureAt: S.minutesAfter(now, 40) });
    const live = await newTrip({ status: "active", departureAt: S.minutesAfter(now, -15) });
    const stale = await newTrip({ departureAt: S.hoursAfter(now, -5) });
    const cancelled = await newTrip({ status: "cancelled", departureAt: S.hoursAfter(now, -24) });
    const done = await newTrip({ status: "completed", departureAt: S.hoursAfter(now, -72) });
    await S.seedRequest(pool, soon.tripId, w.miguel, 0, 2, { status: "confirmed" });
    await S.seedRequest(pool, soon.tripId, w.laura, 0, 2); // pendiente: no es un avatar
    await S.seedRequest(pool, live.tripId, w.laura, 0, 2, { status: "confirmed" });
    await S.seedRequest(pool, done.tripId, w.miguel, 0, 2, { status: "confirmed", bookingStatus: "completed" });

    const r = await overview(tokens.ana, "role=driver");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.role, "driver");
    assert.deepEqual(r.body.counts, { upcoming: 2, inProgress: 1, history: 3 });

    const [seriesCard, soonCard] = r.body.upcoming;
    assert.equal(seriesCard.kind, "weekly_reservation");
    assert.equal(seriesCard.id, series.seriesId);
    assert.equal(seriesCard.seriesId, series.seriesId);
    assert.equal(seriesCard.reservationId, null);
    assert.deepEqual(seriesCard.recurrence, { weekdays: WORKDAYS, recurring: true, label: "Lun - Vie · Recurrente" });
    assert.deepEqual(seriesCard.status, { code: "scheduled", label: "Programado" });
    assert.deepEqual(seriesCard.occupancy, { occupied: 0, total: 2 });
    assert.equal(seriesCard.from.label, "Palomares del Río");
    assert.equal(seriesCard.from.timeLocal, "07:00");
    assert.equal(seriesCard.to.label, "Sevilla (Trabajo)");

    assert.equal(soonCard.kind, "trip");
    assert.equal(soonCard.role, "driver");
    assert.equal(soonCard.tripId, soon.tripId);
    assert.equal(soonCard.requestId, null);
    assert.equal(soonCard.bookingId, null);
    assert.deepEqual(soonCard.status, { code: "scheduled", label: "Programado" });
    assert.ok(soonCard.startsInMinutes >= 39 && soonCard.startsInMinutes <= 41);
    assert.deepEqual(soonCard.occupancy, { occupied: 1, total: 3 });
    assert.deepEqual(soonCard.riders.map((u: { firstName: string }) => u.firstName), ["Miguel"], "solo los confirmados");
    assert.equal(soonCard.liveEta, null);

    assert.equal(r.body.inProgress[0].tripId, live.tripId);
    assert.deepEqual(r.body.inProgress[0].status, { code: "live", label: "En curso" });
    assert.deepEqual(r.body.inProgress[0].riders.map((u: { firstName: string }) => u.firstName), ["Laura"]);
    assert.equal(r.body.inProgress[0].liveEta, null, "la ETA es del pasajero, no del conductor");

    assert.deepEqual(r.body.history.items.map((c: { tripId: string }) => c.tripId), [stale.tripId, cancelled.tripId, done.tripId]);
    assert.deepEqual(r.body.history.items.map((c: { status: { code: string } }) => c.status.code), ["expired", "cancelled", "completed"]);

    // los otros usuarios no ven nada de la conductora y un pasajero no puede pedir la vista de conductor
    const miguelDriver = await overview(tokens.miguel, "role=driver");
    assert.equal(miguelDriver.status, 403);
  });

  test("las ocurrencias lejanas de una serie no inundan la lista: solo la tarjeta de la serie", async () => {
    const series = await publishSeries(nextMonday(), 2);
    const r = await overview(tokens.ana, "role=driver");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const occurrences = await S.count(pool, `select 1 from trips where series_id='${series.seriesId}'`);
    assert.ok(occurrences >= 5, "la serie sí tiene sus ocurrencias materializadas");
    assert.equal(r.body.upcoming.length, 1);
    assert.equal(r.body.upcoming[0].kind, "weekly_reservation");
    assert.equal(r.body.counts.history, 0);
  });
});

/* ───────────────────────────── Favoritos y rutina (pantalla 31) ───────────────────────────── */

type Spot = { lat: number; lng: number };
const favoriteBody = (kind: string, name: string, address: string, spot: Spot) => ({ kind, name, address, lat: spot.lat, lng: spot.lng });

async function createFavorite(token: string, kind: string, name: string, spot: Spot, address = `${name}, Sevilla`) {
  const r = await S.api(app, token).post("/v1/me/favorites", favoriteBody(kind, name, address, spot));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body as { id: string };
}

describe("Destinos favoritos (pantalla 31)", () => {
  test("alta, lectura, edición y baja con auditoría; la provincia se rellena sola", async () => {
    const created = await S.api(app, tokens.miguel).post("/v1/me/favorites", favoriteBody("work", "  Torre   Sevilla ", "Torre Sevilla, Sevilla", S.SEVILLA.trabajo));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.name, "Torre Sevilla", "espacios normalizados");
    assert.equal(created.body.kind, "work");
    assert.equal(created.body.provinceId, w.provinceId);
    assert.deepEqual(created.body.location, { lat: S.SEVILLA.trabajo.lat, lng: S.SEVILLA.trabajo.lng });
    assert.equal(await S.count(pool, `select 1 from audit_events where action='favorite.created' and actor_user_id='${w.miguel}'`), 1);
    const home = await createFavorite(tokens.miguel, "home", "Casa", S.SEVILLA.mairena);

    const list = await S.api(app, tokens.miguel).get("/v1/me/favorites");
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.items.map((f: { name: string }) => f.name), ["Torre Sevilla", "Casa"]);
    assert.equal(list.body.nextCursor, null);
    const paged = await S.api(app, tokens.miguel).get("/v1/me/favorites?limit=1");
    assert.equal(paged.body.items.length, 1);
    const next = await S.api(app, tokens.miguel).get(`/v1/me/favorites?limit=1&cursor=${encodeURIComponent(paged.body.nextCursor)}`);
    assert.deepEqual(next.body.items.map((f: { id: string }) => f.id), [home.id]);
    assert.equal(next.body.nextCursor, null);
    assert.deepEqual((await S.api(app, tokens.laura).get("/v1/me/favorites")).body.items, [], "cada usuario ve solo los suyos");

    const renamed = await S.api(app, tokens.miguel).patch(`/v1/me/favorites/${home.id}`, { name: "Mi casa", kind: "other" });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
    assert.equal(renamed.body.name, "Mi casa");
    assert.equal(renamed.body.kind, "other");
    assert.deepEqual(renamed.body.location, { lat: S.SEVILLA.mairena.lat, lng: S.SEVILLA.mairena.lng }, "sin cambiar las coordenadas");
    const moved = await S.api(app, tokens.miguel).patch(`/v1/me/favorites/${home.id}`, { lat: S.SEVILLA.montequinto.lat, lng: S.SEVILLA.montequinto.lng });
    assert.equal(moved.status, 200);
    assert.deepEqual(moved.body.location, { lat: S.SEVILLA.montequinto.lat, lng: S.SEVILLA.montequinto.lng });
    assert.equal(moved.body.provinceId, w.provinceId);

    assert.equal((await S.api(app, tokens.miguel).del(`/v1/me/favorites/${home.id}`)).status, 204);
    assert.equal((await S.api(app, tokens.miguel).del(`/v1/me/favorites/${home.id}`)).status, 404);
    assert.equal(await S.count(pool, `select 1 from audit_events where action='favorite.deleted'`), 1);
  });

  test("validación, fuera de provincia y propiedad: 400 / 422 / 404, sin sesión 401", async () => {
    const api = S.api(app, tokens.miguel);
    const ok = favoriteBody("work", "Trabajo", "Dirección", S.SEVILLA.trabajo);
    assert.equal((await api.post("/v1/me/favorites", { ...ok, kind: "gimnasio" })).status, 400);
    assert.equal((await api.post("/v1/me/favorites", { ...ok, name: "" })).status, 400);
    assert.equal((await api.post("/v1/me/favorites", { ...ok, name: "x".repeat(61) })).status, 400);
    assert.equal((await api.post("/v1/me/favorites", { ...ok, lat: 91 })).status, 400);
    assert.equal((await api.post("/v1/me/favorites", { kind: "work", name: "Sin coordenadas", address: "x" })).status, 400);
    const madrid = await api.post("/v1/me/favorites", { ...ok, lat: 40.4168, lng: -3.7038 });
    assert.equal(madrid.status, 422);
    assert.equal(S.codeOf(madrid), "FAVORITE_OUTSIDE_PROVINCES");
    assert.equal(await S.count(pool, `select 1 from favorite_places`), 0, "nada guardado");

    const mine = await createFavorite(tokens.miguel, "work", "Trabajo", S.SEVILLA.trabajo);
    assert.equal((await api.patch(`/v1/me/favorites/${mine.id}`, {})).status, 400, "al menos un campo");
    const half = await api.patch(`/v1/me/favorites/${mine.id}`, { lat: S.SEVILLA.mairena.lat });
    assert.equal(half.status, 422);
    assert.equal(S.codeOf(half), "INVALID_REQUEST_SHAPE");
    assert.equal(S.codeOf(await api.patch(`/v1/me/favorites/${mine.id}`, { lat: 40.4168, lng: -3.7038 })), "FAVORITE_OUTSIDE_PROVINCES");
    // ajeno o inexistente: 404 (no se revela que existe)
    const other = S.api(app, tokens.laura);
    assert.equal((await other.patch(`/v1/me/favorites/${mine.id}`, { name: "Robado" })).status, 404);
    assert.equal((await other.del(`/v1/me/favorites/${mine.id}`)).status, 404);
    assert.equal((await api.patch("/v1/me/favorites/00000000-0000-4000-8000-000000000000", { name: "x" })).status, 404);
    assert.equal((await api.patch("/v1/me/favorites/no-es-uuid", { name: "x" })).status, 400);
    assert.equal((await pool.query(`select name from favorite_places where id=$1`, [mine.id])).rows[0]!.name, "Trabajo");
    assert.equal((await S.api(app).get("/v1/me/favorites")).status, 401);
    assert.equal((await S.api(app).post("/v1/me/favorites", ok)).status, 401);
  });

  test("máximo de 20 destinos, también con altas simultáneas", async () => {
    await pool.query(
      `insert into favorite_places(user_id, kind, name, address, geom, province_id)
       select $1, 'other', 'Lugar ' || g, 'Dirección ' || g, ST_SetSRID(ST_Point(-6.0 + g * 0.001, 37.35), 4326), $2
         from generate_series(1, 18) g`,
      [w.miguel, w.provinceId]
    );
    const results = await Promise.all([1, 2, 3].map(n =>
      S.api(app, tokens.miguel).post("/v1/me/favorites", favoriteBody("other", `Nuevo ${n}`, "Dirección", S.SEVILLA.trabajo))));
    assert.deepEqual(results.map(x => x.status).sort(), [201, 201, 409], JSON.stringify(results.map(x => x.body)));
    assert.equal(S.codeOf(results.find(x => x.status === 409)!), "FAVORITES_LIMIT_REACHED");
    assert.equal(await S.count(pool, `select 1 from favorite_places where user_id='${w.miguel}'`), 20);
  });
});

describe("Rutina semanal (pantalla 31)", () => {
  async function twoPlaces(token: string) {
    return { home: await createFavorite(token, "home", "Casa", S.SEVILLA.mairena), work: await createFavorite(token, "work", "Trabajo", S.SEVILLA.trabajo) };
  }

  test("filas por día, lectura ordenada, edición, activar/desactivar y baja", async () => {
    const { home, work } = await twoPlaces(tokens.miguel);
    const api = S.api(app, tokens.miguel);
    const empty = await api.get("/v1/me/routine");
    assert.equal(empty.status, 200, JSON.stringify(empty.body));
    assert.deepEqual(empty.body.entries, []);
    assert.deepEqual(empty.body.suspensions, []);
    assert.equal(empty.body.places.length, 2, "`places` = todos los destinos (selector)");
    assert.equal(empty.body.nextWeek.weekStart, nextMonday());
    assert.equal(empty.body.nextWeek.weekEnd, S.addDaysIso(nextMonday(), 6));
    assert.equal(empty.body.nextWeek.suspended, false);
    assert.equal(empty.body.weeklyOffer.prefill, null);

    const created = await api.post("/v1/me/routine/entries", { weekdays: ["wed", "mon", "fri"], time: "07:30", fromPlaceId: home.id, toPlaceId: work.id });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(created.body.items.map((e: { weekday: string }) => e.weekday), ["mon", "wed", "fri"], "una fila por día, en orden");
    assert.ok(created.body.items.every((e: { time: string; enabled: boolean; fromPlace: { name: string }; toPlace: { name: string } }) =>
      e.time === "07:30" && e.enabled === true && e.fromPlace.name === "Casa" && e.toPlace.name === "Trabajo"));
    const back = await api.post("/v1/me/routine/entries", { weekdays: ["mon"], time: "17:00", fromPlaceId: work.id, toPlaceId: home.id, enabled: false });
    assert.equal(back.status, 201);
    assert.equal(back.body.items[0].enabled, false);

    const routine = await api.get("/v1/me/routine");
    assert.deepEqual(routine.body.entries.map((e: { weekday: string; time: string }) => `${e.weekday} ${e.time}`),
      ["mon 07:30", "mon 17:00", "wed 07:30", "fri 07:30"]);

    const entry = created.body.items[0];
    const edited = await api.patch(`/v1/me/routine/entries/${entry.id}`, { time: "08:15", enabled: false });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.time, "08:15");
    assert.equal(edited.body.enabled, false);
    assert.equal(edited.body.weekday, "mon", "el día no cambia al editar");

    assert.equal((await api.del(`/v1/me/routine/entries/${entry.id}`)).status, 204);
    assert.equal((await api.del(`/v1/me/routine/entries/${entry.id}`)).status, 404);
    assert.equal((await api.get("/v1/me/routine")).body.entries.length, 3);
  });

  test("errores de la rutina: duplicado, mismo lugar, hora, lugar ajeno, fila ajena y sesión", async () => {
    const { home, work } = await twoPlaces(tokens.miguel);
    const foreign = await createFavorite(tokens.laura, "work", "Trabajo de Laura", S.SEVILLA.universidad);
    const api = S.api(app, tokens.miguel);
    const body = { weekdays: ["mon", "tue"], time: "07:30", fromPlaceId: home.id, toPlaceId: work.id };
    const first = await api.post("/v1/me/routine/entries", body);
    assert.equal(first.status, 201);

    const duplicate = await api.post("/v1/me/routine/entries", { ...body, weekdays: ["tue", "wed"] });
    assert.equal(duplicate.status, 409);
    assert.equal(S.codeOf(duplicate), "ROUTINE_ENTRY_EXISTS");
    assert.deepEqual(duplicate.body.error.details.weekdays, ["tue"]);
    assert.equal(await S.count(pool, `select 1 from routine_entries`), 2, "nada a medias");

    const same = await api.post("/v1/me/routine/entries", { ...body, toPlaceId: home.id });
    assert.equal(same.status, 422);
    assert.equal(S.codeOf(same), "ROUTINE_SAME_PLACE");
    assert.equal((await api.post("/v1/me/routine/entries", { ...body, time: "25:00" })).status, 400);
    assert.equal((await api.post("/v1/me/routine/entries", { ...body, weekdays: [] })).status, 400);
    assert.equal((await api.post("/v1/me/routine/entries", { ...body, weekdays: ["mon", "mon"] })).status, 400);
    assert.equal((await api.post("/v1/me/routine/entries", { ...body, weekdays: ["funday"] })).status, 400);
    const ajeno = await api.post("/v1/me/routine/entries", { ...body, weekdays: ["thu"], toPlaceId: foreign.id });
    assert.equal(ajeno.status, 404);
    assert.equal(S.codeOf(ajeno), "FAVORITE_NOT_FOUND");

    const entry = first.body.items[0];
    const patchClash = await api.patch(`/v1/me/routine/entries/${first.body.items[1].id}`, { time: "07:30" });
    assert.equal(patchClash.status, 200, "el mismo trayecto otro día no choca");
    const other = await api.post("/v1/me/routine/entries", { weekdays: ["mon"], time: "09:00", fromPlaceId: home.id, toPlaceId: work.id });
    const clash = await api.patch(`/v1/me/routine/entries/${other.body.items[0].id}`, { time: "07:30" });
    assert.equal(clash.status, 409);
    assert.equal(S.codeOf(clash), "ROUTINE_ENTRY_EXISTS");
    assert.equal(S.codeOf(await api.patch(`/v1/me/routine/entries/${entry.id}`, { toPlaceId: home.id })), "ROUTINE_SAME_PLACE");
    assert.equal((await api.patch(`/v1/me/routine/entries/${entry.id}`, {})).status, 400);
    assert.equal(S.codeOf(await api.patch(`/v1/me/routine/entries/${entry.id}`, { toPlaceId: foreign.id })), "FAVORITE_NOT_FOUND");

    const intruder = S.api(app, tokens.laura);
    assert.equal((await intruder.patch(`/v1/me/routine/entries/${entry.id}`, { enabled: false })).status, 404);
    assert.equal((await intruder.del(`/v1/me/routine/entries/${entry.id}`)).status, 404);
    assert.equal((await S.api(app).get("/v1/me/routine")).status, 401);
    assert.equal((await S.api(app).post("/v1/me/routine/entries", body)).status, 401);
  });

  test("máximo de 40 filas y un destino en uso no se elimina (FAVORITE_IN_USE con las filas)", async () => {
    const { home, work } = await twoPlaces(tokens.miguel);
    await pool.query(
      `insert into routine_entries(user_id, weekday, time_local, from_place_id, to_place_id, enabled)
       select $1, 'mon', ('06:00'::time + g * interval '1 minute'), $2, $3, true from generate_series(1, 38) g`,
      [w.miguel, home.id, work.id]
    );
    const api = S.api(app, tokens.miguel);
    const over = await api.post("/v1/me/routine/entries", { weekdays: ["tue", "wed", "thu"], time: "07:00", fromPlaceId: home.id, toPlaceId: work.id });
    assert.equal(over.status, 409);
    assert.equal(S.codeOf(over), "ROUTINE_LIMIT_REACHED");
    assert.equal(await S.count(pool, `select 1 from routine_entries`), 38);
    assert.equal((await api.post("/v1/me/routine/entries", { weekdays: ["tue", "wed"], time: "07:00", fromPlaceId: home.id, toPlaceId: work.id })).status, 201);

    const inUse = await api.del(`/v1/me/favorites/${home.id}`);
    assert.equal(inUse.status, 409);
    assert.equal(S.codeOf(inUse), "FAVORITE_IN_USE");
    assert.equal(inUse.body.error.details.entryIds.length, 40);
    assert.equal(await S.count(pool, `select 1 from favorite_places where id='${home.id}'`), 1);
    await pool.query(`delete from routine_entries where user_id=$1`, [w.miguel]);
    assert.equal((await api.del(`/v1/me/favorites/${home.id}`)).status, 204);
  });

  test("«Plaza disponible (semanal)»: solo conductores, días derivados de la rutina y cuerpo para «Publica tu ruta»", async () => {
    const api = S.api(app, tokens.ana);
    assert.equal((await S.api(app, tokens.miguel).put("/v1/me/routine/weekly-offer", { enabled: true, seats: 1 })).status, 403);
    assert.equal((await S.api(app).put("/v1/me/routine/weekly-offer", { enabled: true, seats: 1 })).status, 401);
    assert.equal((await api.put("/v1/me/routine/weekly-offer", { enabled: true, seats: 0 })).status, 400);
    assert.equal((await api.put("/v1/me/routine/weekly-offer", { enabled: true, seats: 9 })).status, 400);

    const bare = await api.put("/v1/me/routine/weekly-offer", { enabled: true, seats: 2 });
    assert.equal(bare.status, 200, JSON.stringify(bare.body));
    assert.equal(bare.body.enabled, true);
    assert.equal(bare.body.seats, 2);
    assert.deepEqual(bare.body.weekdays, WORKDAYS, "sin rutina: lunes a viernes");
    assert.deepEqual(bare.body.conditions, { label: "Propuesta", price: { cents: null, currency: "EUR", status: "pending_definition" } });
    assert.equal(bare.body.prefill, null);

    const { home, work } = await twoPlaces(tokens.ana);
    const entries = await api.post("/v1/me/routine/entries", { weekdays: ["mon", "tue", "wed", "thu"], time: "07:30", fromPlaceId: home.id, toPlaceId: work.id });
    assert.equal(entries.status, 201);
    const offer = await api.put("/v1/me/routine/weekly-offer", { enabled: true, seats: 1 });
    assert.deepEqual(offer.body.weekdays, ["mon", "tue", "wed", "thu"]);
    assert.deepEqual(offer.body.prefill, {
      frequency: "daily_workdays", outboundLocal: "07:30", weekdays: ["mon", "tue", "wed", "thu"], seats: 1,
      origin: { lat: S.SEVILLA.mairena.lat, lng: S.SEVILLA.mairena.lng, label: "Casa" },
      destination: { lat: S.SEVILLA.trabajo.lat, lng: S.SEVILLA.trabajo.lng, label: "Trabajo" }
    });
    const routine = await api.get("/v1/me/routine");
    assert.equal(routine.body.weeklyOffer.enabled, true);
    assert.deepEqual(routine.body.weeklyOffer.prefill, offer.body.prefill);
    const off = await api.put("/v1/me/routine/weekly-offer", { enabled: false, seats: 1 });
    assert.equal(off.body.enabled, false);
    assert.equal(await S.count(pool, `select 1 from trips`), 0, "la preferencia no publica ningún viaje");
  });
});

describe("«Suspender próxima semana» (pantalla 31)", () => {
  test("crear, repetir (idempotente), consultar y reanudar; valida lunes y rango", async () => {
    const api = S.api(app, tokens.miguel);
    const created = await api.post("/v1/me/routine/suspensions");
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(created.body, { weekStart: nextMonday(), weekEnd: S.addDaysIso(nextMonday(), 6), withdrawnRequests: 0, keptRequests: 0 });
    const again = await api.post("/v1/me/routine/suspensions", {});
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, created.body);
    assert.equal(await S.count(pool, `select 1 from routine_suspensions`), 1);
    assert.equal(await S.count(pool, `select 1 from audit_events where action='routine.suspended'`), 1, "se audita al crearla, no al repetirla");

    const routine = await api.get("/v1/me/routine");
    assert.deepEqual(routine.body.suspensions, [{ weekStart: nextMonday(), weekEnd: S.addDaysIso(nextMonday(), 6) }]);
    assert.equal(routine.body.nextWeek.suspended, true);

    const later = S.addDaysIso(nextMonday(), 14);
    assert.equal((await api.post("/v1/me/routine/suspensions", { weekStart: later })).status, 201);
    assert.equal((await api.get("/v1/me/routine")).body.suspensions.length, 2);

    for (const bad of [S.addDaysIso(nextMonday(), 1), S.addDaysIso(S.mondayOfDate(S.madrid(new Date()).date), -14), S.addDaysIso(nextMonday(), 800), "2026-02-31"]) {
      const r = await api.post("/v1/me/routine/suspensions", { weekStart: bad });
      assert.equal(r.status, 422, `${bad}: ${JSON.stringify(r.body)}`);
      assert.equal(S.codeOf(r), "INVALID_WEEK_START");
    }
    assert.equal((await api.post("/v1/me/routine/suspensions", { weekStart: "mañana" })).status, 400);

    assert.equal((await api.del(`/v1/me/routine/suspensions/${nextMonday()}`)).status, 204);
    assert.equal((await api.del(`/v1/me/routine/suspensions/${nextMonday()}`)).status, 204, "idempotente");
    const resumed = await api.get("/v1/me/routine");
    assert.equal(resumed.body.nextWeek.suspended, false);
    assert.equal(resumed.body.suspensions.length, 1);
    assert.equal((await api.del(`/v1/me/routine/suspensions/${S.addDaysIso(nextMonday(), 1)}`)).status, 422);
    assert.equal((await S.api(app).post("/v1/me/routine/suspensions")).status, 401);
    // las suspensiones son por usuario
    assert.deepEqual((await S.api(app, tokens.laura).get("/v1/me/routine")).body.suspensions, []);
  });

  test("efecto real: retira las solicitudes semanales PENDIENTES de esa semana y no toca las aceptadas o confirmadas", async () => {
    const series = await publishSeries(nextMonday(), 2);
    const reservation = await weeklyReservation(tokens.miguel, series.anchorTripId);
    // una solicitud aceptada (pago pendiente) en la misma semana en otro viaje: se cuenta, no se toca
    const wednesday = S.addDaysIso(nextMonday(), 2);
    const trip = await newTrip({ departureAt: new Date(`${wednesday}T12:00:00Z`) });
    const kept = await S.seedRequest(pool, trip.tripId, w.miguel, 0, 2, { status: "payment_pending" });

    const r = await S.api(app, tokens.miguel).post("/v1/me/routine/suspensions");
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.withdrawnRequests, 5);
    assert.equal(r.body.keptRequests, 1);
    assert.equal(await S.count(pool, `select 1 from ride_requests where weekly_reservation_id='${reservation.id}' and status='cancelled'`), 5);
    assert.equal((await pool.query(`select status from ride_requests where id=$1`, [kept.requestId])).rows[0]!.status, "payment_pending");
    assert.equal(await S.count(pool, `select 1 from audit_events where action='ride_request.withdrawn' and actor_user_id='${w.miguel}'`), 5);

    // las solicitudes retiradas desaparecen de Mis viajes (no ensucian el historial) y la tarjeta semanal ya no existe
    const view = await overview(tokens.miguel, "role=passenger");
    assert.deepEqual(view.body.counts, { upcoming: 1, inProgress: 0, history: 0 });
    assert.equal(view.body.upcoming[0].kind, "trip");
    assert.equal(view.body.upcoming[0].requestId, kept.requestId);
    // repetir no cambia nada: ya no queda nada pendiente
    const again = await S.api(app, tokens.miguel).post("/v1/me/routine/suspensions");
    assert.equal(again.status, 200);
    assert.equal(again.body.withdrawnRequests, 0);
    assert.equal(again.body.keptRequests, 1);
    // otro pasajero no se ve afectado
    const laura = await weeklyReservation(tokens.laura, series.anchorTripId);
    assert.equal(await S.count(pool, `select 1 from ride_requests where weekly_reservation_id='${laura.id}' and status='pending'`), 5);
  });
});
