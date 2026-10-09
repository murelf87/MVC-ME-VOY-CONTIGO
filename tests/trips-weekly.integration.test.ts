import test, { after, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import * as S from "./trips-support.js";

/**
 * Reservas semanales (pantallas 14–16): serie publicada por la API, una ocurrencia real por día y sentido,
 * capacidad POR OCURRENCIA, última plaza en concurrencia, decisión todo-o-nada y retirada.
 * Base de datos propia: mvc_trips.
 */
let pool: pg.Pool;
let app: FastifyInstance;
let w: S.World;
let tokens: { ana: string; miguel: string; laura: string; pedro: string };
let pedroId: string;

before(async () => {
  pool = S.createPool();
  app = await S.buildTripsApp(pool);
});

beforeEach(async () => {
  await S.truncateAll(pool);
  w = await S.seedWorld(pool);
  pedroId = await S.seedUser(pool, "Pedro Ruiz", { roles: ["driver", "passenger"], photoApproved: true });
  tokens = {
    ana: await S.sessionTokenFor(pool, w.ana),
    miguel: await S.sessionTokenFor(pool, w.miguel),
    laura: await S.sessionTokenFor(pool, w.laura),
    pedro: await S.sessionTokenFor(pool, pedroId)
  };
});

after(async () => {
  await app.close();
  await pool.end();
});

/** Lunes de la próxima semana (Madrid): todos sus días laborables existen en la ventana de 28 días. */
const nextMonday = (): string => S.addDaysIso(S.mondayOfDate(S.madrid(new Date()).date), 7);
const WORKDAYS = ["mon", "tue", "wed", "thu", "fri"];

type Series = { seriesId: string; anchorTripId: string };

/** Ana publica «lunes a viernes» 07:00 (ida) y 15:00 (vuelta) con `seats` plazas, por la API. */
async function publishSeries(seats = 2, withReturn = true): Promise<Series> {
  const r = await S.api(app, tokens.ana).post("/v1/me/routes", {
    vehicleId: w.vehicleId, provinceId: w.provinceId, category: "work",
    origin: { lat: S.SEVILLA.palomares.lat, lng: S.SEVILLA.palomares.lng, label: "Palomares del Río" },
    destination: { lat: S.SEVILLA.trabajo.lat, lng: S.SEVILLA.trabajo.lng, label: "Sevilla (Trabajo)" },
    stops: [{ lat: S.SEVILLA.mairena.lat, lng: S.SEVILLA.mairena.lng, label: "Mairena del Aljarafe" }],
    frequency: "daily_workdays", outboundLocal: "07:00", ...(withReturn ? { returnLocal: "15:00" } : {}),
    startDate: S.addDaysIso(S.madrid(new Date()).date, 1), seats, maxDetourMinutes: 5, pickupOnRoute: false
  }, { "Idempotency-Key": S.idemKey() });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const anchor = r.body.trips.find((t: { leg: string }) => t.leg === "outbound");
  return { seriesId: r.body.seriesId, anchorTripId: anchor.id };
}

async function pickupFor(token: string, tripId: string): Promise<string> {
  const r = await S.api(app, token).get(`/v1/trips/${tripId}/pickup-points?lat=37.3460&lng=-6.0600`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.proposals[0].id as string;
}

async function weeklyBody(token: string, tripId: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return {
    pickupPointId: await pickupFor(token, tripId), weekdays: WORKDAYS, legs: ["outbound", "return"],
    startDate: nextMonday(), weeks: 1, ...extra
  };
}

/** Viaje-ocurrencia de la serie en una fecha y sentido. */
async function occurrence(seriesId: string, date: string, leg = "outbound"): Promise<string> {
  const r = await pool.query<{ id: string }>(`select id from trips where series_id=$1 and service_date=$2 and leg=$3`, [seriesId, date, leg]);
  assert.equal(r.rowCount, 1, `ocurrencia ${leg} ${date}`);
  return r.rows[0]!.id;
}

describe("vista previa (pantalla 14)", () => {
  test("ida y vuelta de lunes a viernes: 10 ocurrencias disponibles, tramos «Ida/Vuelta», importe semanal «Por definir»", async () => {
    const series = await publishSeries(2);
    const body = await weeklyBody(tokens.miguel, series.anchorTripId);
    const r = await S.api(app, tokens.miguel).post(`/v1/trips/${series.anchorTripId}/weekly-requests/preview`, body);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.seriesId, series.seriesId);
    assert.equal(r.body.occurrences.length, 10);
    assert.ok(r.body.occurrences.every((o: { state: string; seatsAvailable: number }) => o.state === "available" && o.seatsAvailable === 2));
    assert.deepEqual([...new Set(r.body.occurrences.map((o: { weekday: string }) => o.weekday))], WORKDAYS);
    assert.equal(r.body.canSubmit, true);
    assert.deepEqual(r.body.issues, []);
    assert.equal(r.body.legs[0].leg, "outbound");
    assert.equal(r.body.legs[0].label, "Ida (mañana)");
    assert.equal(r.body.legs[0].fromLabel, "Mairena del Aljarafe");
    assert.equal(r.body.legs[0].toLabel, "Sevilla (Trabajo)");
    assert.match(r.body.legs[0].boardsAtLocal, /^\d\d:\d\d$/);
    assert.equal(r.body.legs[1].leg, "return");
    assert.equal(r.body.legs[1].label, "Vuelta (tarde)");
    assert.equal(r.body.legs[1].fromLabel, "Sevilla (Trabajo)");
    assert.equal(r.body.legs[1].toLabel, "Mairena del Aljarafe");
    assert.ok(r.body.legs[1].boardsAtLocal >= "15:00");
    assert.equal(r.body.quote.state, "pending_definition");
    assert.equal(r.body.quote.weekly.tripsPerWeek, 10);
    assert.equal(r.body.quote.weekly.legsPerDay, 2);
    assert.deepEqual(r.body.quote.weekly.totalPerWeek, { cents: null, currency: "EUR", status: "pending_definition" });
    assert.equal(await S.count(pool, `select 1 from ride_requests`), 0, "la vista previa no escribe nada");
    assert.equal(await S.count(pool, `select 1 from weekly_reservations`), 0);
  });

  test("con tarifa aprobada (sembrada solo en la BD de pruebas) el importe semanal es la suma de los trayectos por semana", async () => {
    const series = await publishSeries(2);
    await S.seedApprovedTariff(pool, { rateMicrosPerKm: 100_000, passengerCommissionBps: 0 });
    const body = await weeklyBody(tokens.miguel, series.anchorTripId);
    const r = await S.api(app, tokens.miguel).post(`/v1/trips/${series.anchorTripId}/weekly-requests/preview`, body);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const monday = nextMonday();
    const out = (await pool.query<{ d: number }>(`select distance_m as d from trip_segments where trip_id=$1 and seq=1`, [await occurrence(series.seriesId, monday)])).rows[0]!.d;
    const back = (await pool.query<{ d: number }>(`select distance_m as d from trip_segments where trip_id=$1 and seq=0`, [await occurrence(series.seriesId, monday, "return")])).rows[0]!.d;
    const cents = (m: number): number => Math.round((m * 100_000) / 10_000_000);
    assert.equal(r.body.quote.state, "defined");
    assert.equal(r.body.quote.weekly.contributionPerWeek.status, "defined");
    assert.equal(r.body.quote.weekly.contributionPerWeek.cents, 5 * (cents(out) + cents(back)));
    assert.equal(r.body.quote.weekly.totalPerWeek.cents, 5 * (cents(out) + cents(back)));
  });

  test("excepciones y días no ofrecidos; la vuelta de un rango simétrico", async () => {
    const series = await publishSeries(2);
    const monday = nextMonday();
    const wednesday = S.addDaysIso(monday, 2);
    const body = await weeklyBody(tokens.miguel, series.anchorTripId, { exceptionDates: [wednesday], legs: ["outbound"] });
    const r = await S.api(app, tokens.miguel).post(`/v1/trips/${series.anchorTripId}/weekly-requests/preview`, body);
    assert.equal(r.status, 200);
    assert.equal(r.body.occurrences.length, 5);
    const wed = r.body.occurrences.find((o: { date: string }) => o.date === wednesday);
    assert.equal(wed.state, "skipped_exception");
    assert.equal(wed.tripId, null);
    assert.equal(r.body.quote.weekly.tripsPerWeek, 5);
    assert.equal(r.body.canSubmit, true, "una excepción no bloquea");
    const weekend = await S.api(app, tokens.miguel).post(`/v1/trips/${series.anchorTripId}/weekly-requests/preview`, { ...body, weekdays: ["sat"] });
    assert.equal(weekend.status, 422);
    assert.equal(S.codeOf(weekend), "WEEKLY_WEEKDAY_NOT_OFFERED");
  });

  test("más allá de la ventana de 28 días la serie se amplía bajo demanda", async () => {
    const series = await publishSeries(2);
    const farMonday = S.addDaysIso(nextMonday(), 28);
    const body = await weeklyBody(tokens.miguel, series.anchorTripId, { startDate: farMonday, legs: ["outbound"] });
    const r = await S.api(app, tokens.miguel).post(`/v1/trips/${series.anchorTripId}/weekly-requests/preview`, body);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.occurrences.every((o: { state: string }) => o.state === "available"), "las ocurrencias de esa semana se han materializado");
    assert.equal(r.body.occurrences[0].date, farMonday);
    const tooFar = await S.api(app, tokens.miguel).post(`/v1/trips/${series.anchorTripId}/weekly-requests/preview`, { ...body, startDate: S.addDaysIso(S.madrid(new Date()).date, 95) });
    assert.equal(tooFar.status, 422);
    assert.equal(S.codeOf(tooFar), "WEEKLY_NO_OCCURRENCES");
  });

  test("errores de entrada y de contexto", async () => {
    const series = await publishSeries(2, false);
    const miguel = S.api(app, tokens.miguel);
    const url = `/v1/trips/${series.anchorTripId}/weekly-requests/preview`;
    const body = await weeklyBody(tokens.miguel, series.anchorTripId, { legs: ["outbound"] });
    assert.equal(S.codeOf(await miguel.post(url, { ...body, legs: ["outbound", "return"] })), "SERIES_HAS_NO_RETURN");
    assert.equal(S.codeOf(await miguel.post(url, { ...body, startDate: S.addDaysIso(S.madrid(new Date()).date, -3) })), "WEEKLY_START_DATE_IN_PAST");
    assert.equal(S.codeOf(await miguel.post(url, { ...body, cancellationPolicyVersion: "política rara!!" })), "INVALID_CANCELLATION_POLICY_VERSION");
    assert.equal((await miguel.post(url, { ...body, weeks: 5 })).status, 400);
    assert.equal((await miguel.post(url, { ...body, weekdays: [] })).status, 400);
    const { pickupPointId: _omit, ...withoutPickup } = body;
    assert.equal((await miguel.post(url, withoutPickup)).status, 400);
    assert.equal(S.codeOf(await S.api(app, tokens.ana).post(url, body)), "DRIVER_CANNOT_REQUEST_OWN_TRIP");
    assert.equal((await S.api(app).post(url, body)).status, 401);
    // viaje puntual: no es periódico
    const single = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { departureAt: S.hoursAfter(new Date(), 5) });
    assert.equal(S.codeOf(await miguel.post(`/v1/trips/${single.tripId}/weekly-requests/preview`, body)), "TRIP_NOT_RECURRING");
    assert.equal((await miguel.post(`/v1/trips/${"00000000-0000-4000-8000-000000000000"}/weekly-requests/preview`, body)).status, 404);
    // el id de recogida debe ser de ESTE viaje
    const otherSeries = await publishSeries(2, false);
    const foreignPickup = await pickupFor(tokens.miguel, otherSeries.anchorTripId);
    assert.equal(S.codeOf(await miguel.post(url, { ...body, pickupPointId: foreignPickup })), "PICKUP_POINT_INVALID");
  });
});

describe("crear la reserva semanal", () => {
  test("una solicitud pendiente por ocurrencia, una reserva, un solo aviso al conductor y auditoría", async () => {
    const series = await publishSeries(2);
    const body = await weeklyBody(tokens.miguel, series.anchorTripId, { message: "Voy con mochila", cancellationPolicyVersion: "2026-10-v1" });
    const r = await S.api(app, tokens.miguel).post(`/v1/trips/${series.anchorTripId}/weekly-requests`, body, { "Idempotency-Key": S.idemKey() });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const res = r.body;
    assert.equal(res.status, "pending");
    assert.equal(res.seriesId, series.seriesId);
    assert.equal(res.passenger.firstName, "Miguel");
    assert.equal(res.driver.firstName, "Ana");
    assert.deepEqual(res.weekdays, WORKDAYS);
    assert.equal(res.startDate, nextMonday());
    assert.equal(res.weeks, 1);
    assert.equal(res.cancellationPolicyVersion, "2026-10-v1");
    assert.equal(res.occurrences.length, 10);
    assert.ok(res.occurrences.every((o: { state: string; requestStatus: string; requestId: string }) => o.state === "requested" && o.requestStatus === "pending" && o.requestId));
    assert.equal(res.hold, null);
    assert.deepEqual(res.nextAction, { kind: "wait_for_driver", deadlineAt: null });

    const requests = (await pool.query(`select status, from_segment_seq, to_segment_seq, weekly_reservation_id, dropoff_stop_seq, message from ride_requests`)).rows;
    assert.equal(requests.length, 10);
    assert.ok(requests.every(x => x.status === "pending" && x.weekly_reservation_id === res.id && x.message === "Voy con mochila"));
    // ida: tramo 1→2 (sube en Mairena); vuelta simétrica: 0→1
    assert.equal(requests.filter(x => x.from_segment_seq === 1 && x.to_segment_seq === 2).length, 5);
    assert.equal(requests.filter(x => x.from_segment_seq === 0 && x.to_segment_seq === 1).length, 5);
    assert.equal(await S.count(pool, `select 1 from seat_holds`), 0, "pendiente ≠ plaza reservada");
    const notices = await pool.query(`select user_id, kind, data from notifications`);
    assert.equal(notices.rowCount, 1, "UN aviso, no diez");
    assert.equal(notices.rows[0].user_id, w.ana);
    assert.equal(notices.rows[0].kind, "weekly_request_received");
    assert.equal(notices.rows[0].data.reservationId, res.id);
    assert.equal(await S.count(pool, `select 1 from audit_events where action='weekly_request.created'`), 1);
  });

  test("idempotencia: la misma clave repite la reserva y no duplica solicitudes", async () => {
    const series = await publishSeries(2);
    const body = await weeklyBody(tokens.miguel, series.anchorTripId, { legs: ["outbound"] });
    const key = S.idemKey();
    const a = await S.api(app, tokens.miguel).post(`/v1/trips/${series.anchorTripId}/weekly-requests`, body, { "Idempotency-Key": key });
    const b = await S.api(app, tokens.miguel).post(`/v1/trips/${series.anchorTripId}/weekly-requests`, body, { "Idempotency-Key": key });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(b.headers["idempotency-replayed"], "true");
    assert.equal(b.body.id, a.body.id);
    assert.equal(await S.count(pool, `select 1 from ride_requests`), 5);
    assert.equal(await S.count(pool, `select 1 from weekly_reservations`), 1);
    const reused = await S.api(app, tokens.miguel).post(`/v1/trips/${series.anchorTripId}/weekly-requests`, { ...body, weekdays: ["mon"] }, { "Idempotency-Key": key });
    assert.equal(reused.status, 422);
    assert.equal(S.codeOf(reused), "IDEMPOTENCY_KEY_REUSED");
  });

  test("sin clave: repetir la misma reserva choca con las solicitudes abiertas (no hay doble reserva)", async () => {
    const series = await publishSeries(2);
    const body = await weeklyBody(tokens.miguel, series.anchorTripId, { legs: ["outbound"] });
    assert.equal((await S.api(app, tokens.miguel).post(`/v1/trips/${series.anchorTripId}/weekly-requests`, body)).status, 201);
    const again = await S.api(app, tokens.miguel).post(`/v1/trips/${series.anchorTripId}/weekly-requests`, body);
    assert.equal(again.status, 409);
    assert.equal(S.codeOf(again), "WEEKLY_OCCURRENCE_UNAVAILABLE");
    assert.equal(again.body.error.details.dates.length, 5);
    assert.equal(await S.count(pool, `select 1 from ride_requests`), 5);
    // dos envíos simultáneos sin clave: uno solo
    const other = await S.api(app, tokens.laura);
    const laura = await weeklyBody(tokens.laura, series.anchorTripId, { legs: ["outbound"] });
    const results = await Promise.all([1, 2].map(() => other.post(`/v1/trips/${series.anchorTripId}/weekly-requests`, laura)));
    assert.deepEqual(results.map(x => x.status).sort(), [201, 409]);
    assert.equal(await S.count(pool, `select 1 from weekly_reservations where passenger_user_id='${w.laura}'`), 1);
  });

  test("capacidad POR OCURRENCIA: un día completo bloquea; `allowPartial` omite ese día y reserva el resto", async () => {
    const series = await publishSeries(2);
    const wednesday = S.addDaysIso(nextMonday(), 2);
    const wednesdayTrip = await occurrence(series.seriesId, wednesday);
    // ocupan las dos plazas del tramo 1 ese miércoles (otros pasajeros con reserva confirmada)
    await S.seedRequest(pool, wednesdayTrip, pedroId, 1, 2, { status: "confirmed" });
    const third = await S.seedUser(pool, "Tercero", { photoApproved: true });
    await S.seedRequest(pool, wednesdayTrip, third, 0, 2, { status: "confirmed" });

    const body = await weeklyBody(tokens.miguel, series.anchorTripId, { legs: ["outbound"] });
    const preview = await S.api(app, tokens.miguel).post(`/v1/trips/${series.anchorTripId}/weekly-requests/preview`, body);
    const wed = preview.body.occurrences.find((o: { date: string }) => o.date === wednesday);
    assert.equal(wed.state, "skipped_full");
    assert.equal(wed.seatsAvailable, 0);
    assert.equal(preview.body.canSubmit, false);
    assert.equal(preview.body.issues[0].code, "WEEKLY_OCCURRENCE_UNAVAILABLE");
    assert.equal(preview.body.issues[0].date, wednesday);
    assert.ok(preview.body.occurrences.filter((o: { state: string }) => o.state === "available").length === 4);

    const blocked = await S.api(app, tokens.miguel).post(`/v1/trips/${series.anchorTripId}/weekly-requests`, body);
    assert.equal(blocked.status, 409);
    assert.equal(S.codeOf(blocked), "WEEKLY_OCCURRENCE_UNAVAILABLE");
    assert.deepEqual(blocked.body.error.details.dates, [wednesday]);
    assert.equal(await S.count(pool, `select 1 from ride_requests where passenger_user_id='${w.miguel}'`), 0, "nada a medias");

    const partialPreview = await S.api(app, tokens.miguel).post(`/v1/trips/${series.anchorTripId}/weekly-requests/preview`, { ...body, allowPartial: true });
    assert.equal(partialPreview.body.canSubmit, true);
    const partial = await S.api(app, tokens.miguel).post(`/v1/trips/${series.anchorTripId}/weekly-requests`, { ...body, allowPartial: true });
    assert.equal(partial.status, 201, JSON.stringify(partial.body));
    assert.equal(await S.count(pool, `select 1 from ride_requests where passenger_user_id='${w.miguel}'`), 4);
    assert.equal(partial.body.occurrences.find((o: { date: string }) => o.date === wednesday).state, "skipped_full");
  });

  test("un tramo ocupado no bloquea otro: el miércoles con el tramo 0 lleno sigue libre para quien sube en la parada 1", async () => {
    const series = await publishSeries(1);
    const wednesday = S.addDaysIso(nextMonday(), 2);
    await S.seedRequest(pool, await occurrence(series.seriesId, wednesday), pedroId, 0, 1, { status: "confirmed" });
    const body = await weeklyBody(tokens.miguel, series.anchorTripId, { legs: ["outbound"] });
    const r = await S.api(app, tokens.miguel).post(`/v1/trips/${series.anchorTripId}/weekly-requests`, body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.occurrences.length, 5);
    assert.ok(r.body.occurrences.every((o: { state: string }) => o.state === "requested"));
  });

  test("roles, sesión y viaje cancelado", async () => {
    const series = await publishSeries(2);
    const body = await weeklyBody(tokens.miguel, series.anchorTripId, { legs: ["outbound"] });
    const url = `/v1/trips/${series.anchorTripId}/weekly-requests`;
    const driverOnly = await S.seedUser(pool, "Solo Conductor", { roles: ["driver"] });
    assert.equal((await S.api(app, await S.sessionTokenFor(pool, driverOnly)).post(url, body)).status, 403);
    assert.equal((await S.api(app).post(url, body)).status, 401);
    await pool.query(`update trip_series set status='paused' where id=$1`, [series.seriesId]);
    const paused = await S.api(app, tokens.miguel).post(url, body);
    assert.equal(paused.status, 409);
    assert.equal(S.codeOf(paused), "TRIP_NOT_BOOKABLE");
  });
});

describe("decisión del conductor sobre la reserva semanal", () => {
  async function createWeekly(token: string, series: Series, extra: Record<string, unknown> = {}) {
    const r = await S.api(app, token).post(`/v1/trips/${series.anchorTripId}/weekly-requests`, await weeklyBody(token, series.anchorTripId, { legs: ["outbound"], ...extra }));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body as { id: string; occurrences: Array<{ requestId: string; date: string }> };
  }

  test("aceptar es todo o nada: un hold por ocurrencia con la misma caducidad y estado agregado `payment_pending`", async () => {
    const series = await publishSeries(2);
    const reservation = await createWeekly(tokens.miguel, series);
    const decided = await S.api(app, tokens.ana).post(`/v1/weekly-reservations/${reservation.id}/decision`, { decision: "accept" });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    assert.equal(decided.body.kind, "weekly");
    assert.equal(decided.body.status, "payment_pending");
    assert.equal(decided.body.requestIds.length, 5);
    assert.equal(await S.count(pool, `select 1 from seat_holds where status='active'`), 5);
    const expiries = await pool.query(`select distinct expires_at from seat_holds`);
    assert.equal(expiries.rowCount, 1, "misma caducidad para toda la reserva");
    assert.equal(await S.count(pool, `select 1 from ride_requests where status='payment_pending'`), 5);
    const view = await S.api(app, tokens.miguel).get(`/v1/weekly-reservations/${reservation.id}`);
    assert.equal(view.status, 200);
    assert.equal(view.body.status, "payment_pending");
    assert.equal(view.body.hold.active, true);
    assert.ok(view.body.hold.remainingSeconds > 880 && view.body.hold.remainingSeconds <= 900);
    assert.equal(view.body.nextAction.kind, "pay");
    const notices = await pool.query(`select kind from notifications where user_id=$1`, [w.miguel]);
    assert.deepEqual(notices.rows.map(x => x.kind), ["request_accepted"], "un solo aviso al pasajero");
    assert.equal(await S.count(pool, `select 1 from audit_events where action='weekly_request.decided'`), 1);
  });

  test("si una ocurrencia ya no tiene plaza, no se acepta NADA (409 con las fechas) y todo sigue pendiente", async () => {
    const series = await publishSeries(1);
    const reservation = await createWeekly(tokens.miguel, series);
    const thursday = S.addDaysIso(nextMonday(), 3);
    await S.seedRequest(pool, await occurrence(series.seriesId, thursday), pedroId, 1, 2, { status: "confirmed" });
    const r = await S.api(app, tokens.ana).post(`/v1/weekly-reservations/${reservation.id}/decision`, { decision: "accept" });
    assert.equal(r.status, 409);
    assert.equal(S.codeOf(r), "NO_CAPACITY_ON_SEGMENT");
    assert.deepEqual(r.body.error.details.dates, [thursday]);
    assert.equal(await S.count(pool, `select 1 from seat_holds where status='active'`), 0, "ningún hold activo: no se acepta nada a medias");
    assert.equal(await S.count(pool, `select 1 from ride_requests where status='pending'`), 5);
    // el conductor aún puede rechazar
    const rejected = await S.api(app, tokens.ana).post(`/v1/weekly-reservations/${reservation.id}/decision`, { decision: "reject" });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.status, "rejected");
    assert.equal(await S.count(pool, `select 1 from ride_requests where status='rejected'`), 5);
    const view = await S.api(app, tokens.miguel).get(`/v1/weekly-reservations/${reservation.id}`);
    assert.equal(view.body.status, "rejected");
    assert.equal(view.body.nextAction.kind, "search_again");
  });

  test("última plaza compartida: dos reservas semanales aceptadas a la vez → solo una prospera", async () => {
    const series = await publishSeries(1);
    const miguel = await createWeekly(tokens.miguel, series);
    const laura = await createWeekly(tokens.laura, series);
    const results = await Promise.all([
      S.api(app, tokens.ana).post(`/v1/weekly-reservations/${miguel.id}/decision`, { decision: "accept" }),
      S.api(app, tokens.ana).post(`/v1/weekly-reservations/${laura.id}/decision`, { decision: "accept" })
    ]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409], JSON.stringify(results.map(r => r.body)));
    assert.equal(S.codeOf(results.find(r => r.status === 409)!), "NO_CAPACITY_ON_SEGMENT");
    assert.equal(await S.count(pool, `select 1 from seat_holds where status='active'`), 5, "5 ocurrencias, una plaza cada una");
    const perTrip = await pool.query<{ n: number }>(
      `select count(*)::int as n from seat_holds h join ride_requests r on r.id=h.request_id where h.status='active' group by r.trip_id`);
    assert.ok(perTrip.rows.every(row => row.n === 1), "ninguna ocurrencia sobrevendida");
  });

  test("una reserva semanal y una solicitud puntual compiten por la última plaza de un día: sin sobreventa ni bloqueos", async () => {
    const series = await publishSeries(1);
    const weekly = await createWeekly(tokens.miguel, series);
    const tuesday = S.addDaysIso(nextMonday(), 1);
    const tuesdayTrip = await occurrence(series.seriesId, tuesday);
    const single = await S.api(app, tokens.laura).post(`/v1/trips/${tuesdayTrip}/requests`, { fromSegmentSeq: 1, toSegmentSeq: 2 });
    assert.equal(single.status, 201);
    const results = await Promise.all([
      S.api(app, tokens.ana).post(`/v1/weekly-reservations/${weekly.id}/decision`, { decision: "accept" }),
      S.api(app, tokens.ana).post(`/v1/ride-requests/${single.body.id}/decision`, { decision: "accept" })
    ]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409], JSON.stringify(results.map(r => r.body)));
    const holdsTuesday = await S.count(pool, `select 1 from seat_holds h join ride_requests r on r.id=h.request_id where h.status='active' and r.trip_id='${tuesdayTrip}'`);
    assert.equal(holdsTuesday, 1, "una sola plaza el martes");
  });

  test("autorización: solo el conductor decide; una solicitud suelta de una reserva se decide por la reserva", async () => {
    const series = await publishSeries(2);
    const reservation = await createWeekly(tokens.miguel, series);
    const url = `/v1/weekly-reservations/${reservation.id}/decision`;
    for (const token of [tokens.miguel, tokens.pedro, tokens.laura]) {
      const r = await S.api(app, token).post(url, { decision: "accept" });
      assert.ok([403, 404].includes(r.status), `status ${r.status}`);
      assert.notEqual(r.status, 200);
    }
    assert.equal((await S.api(app).post(url, { decision: "accept" })).status, 401);
    assert.equal((await S.api(app, tokens.ana).post(url, { decision: "nunca" })).status, 400);
    const single = await S.api(app, tokens.ana).post(`/v1/ride-requests/${reservation.occurrences[0]!.requestId}/decision`, { decision: "accept" });
    assert.equal(single.status, 409);
    assert.equal(S.codeOf(single), "REQUEST_IN_WEEKLY_RESERVATION");
    assert.equal(single.body.error.details.reservationId, reservation.id);
    assert.equal(await S.count(pool, `select 1 from seat_holds`), 0);
  });

  test("lectura por recurso: titular y conductor sí; cualquier otro 404", async () => {
    const series = await publishSeries(2);
    const reservation = await createWeekly(tokens.miguel, series);
    const url = `/v1/weekly-reservations/${reservation.id}`;
    assert.equal((await S.api(app, tokens.miguel).get(url)).status, 200);
    assert.equal((await S.api(app, tokens.ana).get(url)).status, 200);
    for (const token of [tokens.laura, tokens.pedro]) {
      const r = await S.api(app, token).get(url);
      assert.equal(r.status, 404);
      assert.equal(S.codeOf(r), "WEEKLY_RESERVATION_NOT_FOUND");
    }
    assert.equal((await S.api(app).get(url)).status, 401);
  });

  test("retirar: cancela las ocurrencias pendientes; si ya no hay pendientes, 409", async () => {
    const series = await publishSeries(2);
    const reservation = await createWeekly(tokens.miguel, series);
    const withdrawn = await S.api(app, tokens.miguel).post(`/v1/weekly-reservations/${reservation.id}/withdraw`);
    assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.body));
    assert.equal(withdrawn.body.status, "cancelled");
    assert.equal(await S.count(pool, `select 1 from ride_requests where status='cancelled'`), 5);
    const again = await S.api(app, tokens.miguel).post(`/v1/weekly-reservations/${reservation.id}/withdraw`);
    assert.equal(again.status, 409);
    assert.equal(S.codeOf(again), "REQUEST_NOT_WITHDRAWABLE");
    assert.equal((await S.api(app, tokens.laura).post(`/v1/weekly-reservations/${reservation.id}/withdraw`)).status, 404);
    // tras aceptar no se puede retirar (cancelar es de `money`)
    const second = await createWeekly(tokens.laura, series);
    await S.api(app, tokens.ana).post(`/v1/weekly-reservations/${second.id}/decision`, { decision: "accept" });
    const late = await S.api(app, tokens.laura).post(`/v1/weekly-reservations/${second.id}/withdraw`);
    assert.equal(late.status, 409);
    assert.equal(S.codeOf(late), "REQUEST_NOT_WITHDRAWABLE");
  });

  test("la bandeja del conductor muestra la reserva semanal UNA vez (`kind: weekly`)", async () => {
    const series = await publishSeries(2);
    const reservation = await createWeekly(tokens.miguel, series, { legs: ["outbound", "return"] });
    const inbox = await S.api(app, tokens.ana).get("/v1/me/driver/requests");
    assert.equal(inbox.status, 200, JSON.stringify(inbox.body));
    assert.equal(inbox.body.items.length, 1, "10 solicitudes, una tarjeta");
    const item = inbox.body.items[0];
    assert.equal(item.kind, "weekly");
    assert.equal(item.id, reservation.id);
    assert.equal(item.passenger.firstName, "Miguel");
    assert.deepEqual(item.weekly.weekdays, WORKDAYS);
    assert.equal(item.weekly.occurrences, 10);
    assert.equal(item.canAccept, true);
    // sin plaza en una ocurrencia pendiente: la tarjeta no se puede aceptar
    const monday = nextMonday();
    const mondayTrip = await occurrence(series.seriesId, monday);
    await S.seedRequest(pool, mondayTrip, pedroId, 1, 2, { status: "confirmed" });
    const third = await S.seedUser(pool, "Tercero", { photoApproved: true });
    await S.seedRequest(pool, mondayTrip, third, 1, 2, { status: "confirmed" });
    const blocked = (await S.api(app, tokens.ana).get("/v1/me/driver/requests")).body.items[0];
    assert.equal(blocked.canAccept, false);
    assert.equal(blocked.blockedReason, "NO_CAPACITY_ON_SEGMENT");
  });
});
