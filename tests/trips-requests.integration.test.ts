import test, { after, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { runTripsSweep } from "../src/modules/trips/sweeper.js";
import * as S from "./trips-support.js";

/**
 * Solicitudes (15/16), estado con cuenta atrás del hold, decisión del conductor (20), idempotencia, autorización,
 * caducidad y concurrencia de la última plaza. Base de datos propia: mvc_trips.
 */
let pool: pg.Pool;
let app: FastifyInstance;
let w: S.World;
let tripA: S.SeededTrip;
let tokens: { ana: string; miguel: string; laura: string; otherDriver: string; otherDriverId: string };

before(async () => {
  pool = S.createPool();
  app = await S.buildTripsApp(pool);
});

beforeEach(async () => {
  await S.truncateAll(pool);
  w = await S.seedWorld(pool);
  const otherDriverId = await S.seedUser(pool, "Pedro Ruiz", { roles: ["driver", "passenger"], photoApproved: true });
  tokens = {
    ana: await S.sessionTokenFor(pool, w.ana),
    miguel: await S.sessionTokenFor(pool, w.miguel),
    laura: await S.sessionTokenFor(pool, w.laura),
    otherDriver: await S.sessionTokenFor(pool, otherDriverId),
    otherDriverId
  };
  tripA = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { departureAt: S.hoursAfter(new Date(), 4) });
});

after(async () => {
  await app.close();
  await pool.end();
});

/** Miguel pide plaza en la parada 1 (Mairena) con un punto A propuesto por el servidor. */
async function pickupIdFor(token: string, tripId: string): Promise<string> {
  const r = await S.api(app, token).get(`/v1/trips/${tripId}/pickup-points?lat=37.3460&lng=-6.0600`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.proposals[0].id as string;
}

async function requestSeat(token: string, tripId: string, extra: Record<string, unknown> = {}, key: string | null = null) {
  const pickupPointId = await pickupIdFor(token, tripId);
  return S.api(app, token).post(`/v1/trips/${tripId}/requests`, { pickupPointId, ...extra }, key ? { "Idempotency-Key": key } : {});
}

describe("crear solicitud", () => {
  test("201 con punto de recogida, tramo, distancia, mensaje, stepper «Solicitud», sin hold y presupuesto «Por definir»", async () => {
    const r = await requestSeat(tokens.miguel, tripA.tripId, { message: "Voy con una maleta pequeña." });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const d = r.body;
    assert.equal(d.status, "pending");
    assert.equal(d.passenger.firstName, "Miguel");
    assert.equal(d.trip.id, tripA.tripId);
    assert.equal(d.trip.driver.firstName, "Ana");
    assert.equal(d.trip.vehicle.plate, null, "un solicitante pendiente no ve la matrícula completa");
    assert.equal(d.pickup.label, "Mairena del Aljarafe");
    assert.equal(d.pickup.location.precision, "precise", "es el punto de encuentro que él mismo eligió");
    assert.ok(d.pickup.walkMinutes >= 0);
    assert.equal(d.fromSegmentSeq, 1);
    assert.equal(d.toSegmentSeq, 2);
    assert.equal(d.roadDistanceM, tripA.segments[1]!.distanceM);
    assert.equal(d.message, "Voy con una maleta pequeña.");
    assert.deepEqual(d.stepper.steps.map((s: { key: string; state: string }) => `${s.key}:${s.state}`),
      ["requested:current", "accepted:pending", "payment:pending", "confirmed:pending"]);
    assert.equal(d.stepper.current, "requested");
    assert.equal(d.stepper.terminal, null);
    assert.equal(d.hold, null);
    assert.deepEqual(d.nextAction, { kind: "wait_for_driver", deadlineAt: null });
    assert.equal(d.quote.state, "pending_definition");
    assert.equal(d.booking, null);
    assert.equal(d.weekly, null);

    const row = (await pool.query(`select status, pickup_label, pickup_source, dropoff_stop_seq, road_distance_m, message from ride_requests where id=$1`, [d.id])).rows[0];
    assert.equal(row.status, "pending");
    assert.equal(row.pickup_source, "driver_stop");
    assert.equal(row.dropoff_stop_seq, 2);
    assert.equal(row.message, "Voy con una maleta pequeña.");
    assert.equal(await S.count(pool, `select 1 from quote_snapshots`), 0, "sin tarifa aprobada no se escribe ninguna instantánea");
    assert.equal(await S.count(pool, `select 1 from seat_holds`), 0, "una solicitud pendiente NO reserva plaza");
  });

  test("notifica al conductor (`request_received`) y deja auditoría `ride_request.created`", async () => {
    const r = await requestSeat(tokens.miguel, tripA.tripId);
    const n = (await pool.query(`select category, kind, title, body, data from notifications where user_id=$1`, [w.ana])).rows;
    assert.equal(n.length, 1);
    assert.equal(n[0].category, "trip");
    assert.equal(n[0].kind, "request_received");
    assert.equal(n[0].data.requestId, r.body.id);
    assert.equal(n[0].data.tripId, tripA.tripId);
    assert.ok(n[0].body.includes("Miguel"));
    assert.ok(!JSON.stringify(n[0]).includes(w.miguel), "el aviso no lleva identificadores privados del pasajero");
    const audit = await pool.query(`select actor_user_id, entity_type, entity_id from audit_events where action='ride_request.created'`);
    assert.equal(audit.rowCount, 1);
    assert.equal(audit.rows[0].actor_user_id, w.miguel);
    assert.equal(audit.rows[0].entity_id, r.body.id);
  });

  test("el formato heredado `fromSegmentSeq/toSegmentSeq` sigue funcionando", async () => {
    const r = await S.api(app, tokens.miguel).post(`/v1/trips/${tripA.tripId}/requests`, { fromSegmentSeq: 0, toSegmentSeq: 2 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.fromSegmentSeq, 0);
    assert.equal(r.body.toSegmentSeq, 2);
    assert.equal(r.body.roadDistanceM, tripA.segments[0]!.distanceM + tripA.segments[1]!.distanceM);
  });

  test("errores de forma, rol, viaje y capacidad", async () => {
    const miguel = S.api(app, tokens.miguel);
    const url = `/v1/trips/${tripA.tripId}/requests`;
    assert.equal(S.codeOf(await miguel.post(url, {})), "INVALID_REQUEST_SHAPE");
    assert.equal(S.codeOf(await miguel.post(url, { pickupPointId: "pp1_x", fromSegmentSeq: 0, toSegmentSeq: 1 })), "INVALID_REQUEST_SHAPE");
    assert.equal(S.codeOf(await miguel.post(url, { fromSegmentSeq: 0, toSegmentSeq: 5 })), "INVALID_SEGMENT_RANGE");
    assert.equal(S.codeOf(await miguel.post(url, { pickupPointId: "pp1_basura" })), "PICKUP_POINT_INVALID");
    const tooLong = await miguel.post(url, { fromSegmentSeq: 0, toSegmentSeq: 1, message: "x".repeat(301) });
    assert.equal(tooLong.status, 400);
    assert.equal(S.codeOf(tooLong), "VALIDATION_ERROR");

    const own = await S.api(app, tokens.ana).post(url, { fromSegmentSeq: 0, toSegmentSeq: 1 });
    assert.equal(own.status, 409);
    assert.equal(S.codeOf(own), "DRIVER_CANNOT_REQUEST_OWN_TRIP");

    const driverOnly = await S.seedUser(pool, "Solo Conductor", { roles: ["driver"] });
    const forbidden = await S.api(app, await S.sessionTokenFor(pool, driverOnly)).post(url, { fromSegmentSeq: 0, toSegmentSeq: 1 });
    assert.equal(forbidden.status, 403);
    assert.equal(S.codeOf(forbidden), "AUTH_FORBIDDEN");

    assert.equal((await S.api(app).post(url, { fromSegmentSeq: 0, toSegmentSeq: 1 })).status, 401);
    assert.equal((await miguel.post(`/v1/trips/${"00000000-0000-4000-8000-000000000000"}/requests`, { fromSegmentSeq: 0, toSegmentSeq: 1 })).status, 404);
    const closed = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { status: "completed", departureAt: S.hoursAfter(new Date(), -5) });
    assert.equal(S.codeOf(await miguel.post(`/v1/trips/${closed.tripId}/requests`, { fromSegmentSeq: 0, toSegmentSeq: 1 })), "TRIP_NOT_BOOKABLE");
    const draft = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { status: "draft" });
    assert.equal(S.codeOf(await miguel.post(`/v1/trips/${draft.tripId}/requests`, { fromSegmentSeq: 0, toSegmentSeq: 1 })), "TRIP_NOT_BOOKABLE");
  });

  test("una solicitud abierta solapada del mismo pasajero se rechaza; un tramo contiguo no", async () => {
    const miguel = S.api(app, tokens.miguel);
    const url = `/v1/trips/${tripA.tripId}/requests`;
    assert.equal((await miguel.post(url, { fromSegmentSeq: 0, toSegmentSeq: 1 })).status, 201);
    const overlap = await miguel.post(url, { fromSegmentSeq: 0, toSegmentSeq: 2 });
    assert.equal(overlap.status, 409);
    assert.equal(S.codeOf(overlap), "DUPLICATE_OPEN_REQUEST");
    assert.equal((await miguel.post(url, { fromSegmentSeq: 1, toSegmentSeq: 2 })).status, 201, "contiguo, sin solape");
  });

  test("capacidad por tramo: las pendientes no reservan; las confirmadas y los holds activos sí", async () => {
    const small = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { capacity: 1, departureAt: S.hoursAfter(new Date(), 4) });
    const url = `/v1/trips/${small.tripId}/requests`;
    // dos pendientes para una sola plaza: permitido
    assert.equal((await S.api(app, tokens.miguel).post(url, { fromSegmentSeq: 1, toSegmentSeq: 2 })).status, 201);
    assert.equal((await S.api(app, tokens.laura).post(url, { fromSegmentSeq: 1, toSegmentSeq: 2 })).status, 201);
    // una confirmada en el tramo 1 → ya no hay plaza ahí, pero sí en el tramo 0
    await S.seedRequest(pool, small.tripId, tokens.otherDriverId, 1, 2, { status: "confirmed" });
    const third = await S.seedUser(pool, "Tercero", { photoApproved: true });
    const t3 = await S.sessionTokenFor(pool, third);
    const full = await S.api(app, t3).post(url, { fromSegmentSeq: 1, toSegmentSeq: 2 });
    assert.equal(full.status, 409);
    assert.equal(S.codeOf(full), "NO_CAPACITY_ON_SEGMENT");
    assert.equal((await S.api(app, t3).post(url, { fromSegmentSeq: 0, toSegmentSeq: 1 })).status, 201);
  });
});

describe("idempotencia (`Idempotency-Key`)", () => {
  test("misma clave y mismo cuerpo repite la respuesta y no crea otra solicitud", async () => {
    const key = S.idemKey();
    const body = { fromSegmentSeq: 0, toSegmentSeq: 2, message: "Hola" };
    const a = await S.api(app, tokens.miguel).post(`/v1/trips/${tripA.tripId}/requests`, body, { "Idempotency-Key": key });
    const b = await S.api(app, tokens.miguel).post(`/v1/trips/${tripA.tripId}/requests`, body, { "Idempotency-Key": key });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(b.headers["idempotency-replayed"], "true");
    assert.equal(a.headers["idempotency-replayed"], undefined);
    assert.equal(b.body.id, a.body.id);
    assert.equal(await S.count(pool, `select 1 from ride_requests`), 1);
    assert.equal(await S.count(pool, `select 1 from notifications where kind='request_received'`), 1, "un solo aviso");
  });

  test("misma clave con cuerpo distinto → 422 IDEMPOTENCY_KEY_REUSED; clave corta → 400", async () => {
    const key = S.idemKey();
    const url = `/v1/trips/${tripA.tripId}/requests`;
    assert.equal((await S.api(app, tokens.miguel).post(url, { fromSegmentSeq: 0, toSegmentSeq: 1 }, { "Idempotency-Key": key })).status, 201);
    const reused = await S.api(app, tokens.miguel).post(url, { fromSegmentSeq: 1, toSegmentSeq: 2 }, { "Idempotency-Key": key });
    assert.equal(reused.status, 422);
    assert.equal(S.codeOf(reused), "IDEMPOTENCY_KEY_REUSED");
    const short = await S.api(app, tokens.miguel).post(url, { fromSegmentSeq: 1, toSegmentSeq: 2 }, { "Idempotency-Key": "corta" });
    assert.equal(short.status, 400);
  });

  test("la clave es por usuario: otro pasajero con la misma clave crea su propia solicitud", async () => {
    const key = S.idemKey();
    const url = `/v1/trips/${tripA.tripId}/requests`;
    const a = await S.api(app, tokens.miguel).post(url, { fromSegmentSeq: 0, toSegmentSeq: 2 }, { "Idempotency-Key": key });
    const b = await S.api(app, tokens.laura).post(url, { fromSegmentSeq: 0, toSegmentSeq: 2 }, { "Idempotency-Key": key });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.notEqual(a.body.id, b.body.id);
  });

  test("dos envíos concurrentes con la misma clave crean UNA sola solicitud", async () => {
    const key = S.idemKey();
    const url = `/v1/trips/${tripA.tripId}/requests`;
    const results = await Promise.all([1, 2, 3].map(() =>
      S.api(app, tokens.miguel).post(url, { fromSegmentSeq: 0, toSegmentSeq: 2 }, { "Idempotency-Key": key })));
    assert.ok(results.every(r => r.status === 201), results.map(r => r.status).join());
    assert.equal(new Set(results.map(r => r.body.id)).size, 1);
    assert.equal(await S.count(pool, `select 1 from ride_requests`), 1);
  });

  test("sin clave, dos envíos concurrentes solapados: uno se crea y el otro es DUPLICATE_OPEN_REQUEST", async () => {
    const url = `/v1/trips/${tripA.tripId}/requests`;
    const results = await Promise.all([1, 2].map(() => S.api(app, tokens.miguel).post(url, { fromSegmentSeq: 0, toSegmentSeq: 2 })));
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    assert.equal(await S.count(pool, `select 1 from ride_requests`), 1);
  });
});

describe("estado de la solicitud, hold y cuenta atrás (pantalla 16)", () => {
  test("aceptada → `payment_pending`, stepper «Aceptada», hold de 15 min con cuenta atrás y próxima acción «pay»", async () => {
    const created = await requestSeat(tokens.miguel, tripA.tripId);
    const before = Date.now();
    const decided = await S.api(app, tokens.ana).post(`/v1/ride-requests/${created.body.id}/decision`, { decision: "accept" });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    assert.equal(decided.body.kind, "single");
    assert.equal(decided.body.status, "payment_pending");
    assert.deepEqual(decided.body.requestIds, [created.body.id]);
    const expiresAt = new Date(decided.body.hold.expiresAt).getTime();
    assert.ok(Math.abs(expiresAt - (before + 900_000)) < 10_000, "el hold dura 15 min por defecto");

    const view = await S.api(app, tokens.miguel).get(`/v1/ride-requests/${created.body.id}`);
    assert.equal(view.status, 200);
    assert.equal(view.body.status, "payment_pending");
    assert.deepEqual(view.body.stepper.steps.map((s: { key: string; state: string }) => `${s.key}:${s.state}`),
      ["requested:done", "accepted:current", "payment:pending", "confirmed:pending"]);
    assert.equal(view.body.stepper.current, "accepted");
    assert.equal(view.body.hold.active, true);
    assert.ok(view.body.hold.remainingSeconds > 880 && view.body.hold.remainingSeconds <= 900, String(view.body.hold.remainingSeconds));
    assert.equal(view.body.hold.expiresAt, decided.body.hold.expiresAt);
    assert.deepEqual(view.body.nextAction, { kind: "pay", deadlineAt: decided.body.hold.expiresAt });
    assert.equal(view.body.trip.vehicle.plate, null, "aceptada no es confirmada: aún sin matrícula completa");
    assert.equal(view.body.pickup.location.precision, "precise");
  });

  test("la cuenta atrás se calcula en el servidor en cada lectura", async () => {
    const created = await requestSeat(tokens.miguel, tripA.tripId);
    await S.api(app, tokens.ana).post(`/v1/ride-requests/${created.body.id}/decision`, { decision: "accept" });
    await pool.query(`update seat_holds set expires_at = now() + interval '120 seconds' where request_id=$1`, [created.body.id]);
    const view = await S.api(app, tokens.miguel).get(`/v1/ride-requests/${created.body.id}`);
    assert.ok(view.body.hold.remainingSeconds > 100 && view.body.hold.remainingSeconds <= 120, String(view.body.hold.remainingSeconds));
    await new Promise(resolve => setTimeout(resolve, 1100));
    const later = await S.api(app, tokens.miguel).get(`/v1/ride-requests/${created.body.id}`);
    assert.ok(later.body.hold.remainingSeconds < view.body.hold.remainingSeconds, "decrece con el tiempo");
  });

  test("hold caducado: la lectura pasa la solicitud a `expired`, libera el hold, avisa y devuelve la plaza", async () => {
    const created = await requestSeat(tokens.miguel, tripA.tripId);
    await S.api(app, tokens.ana).post(`/v1/ride-requests/${created.body.id}/decision`, { decision: "accept" });
    await pool.query(`update seat_holds set expires_at = now() - interval '5 seconds' where request_id=$1`, [created.body.id]);
    const view = await S.api(app, tokens.miguel).get(`/v1/ride-requests/${created.body.id}`);
    assert.equal(view.status, 200);
    assert.equal(view.body.status, "expired");
    assert.equal(view.body.hold.active, false, "el hold sigue informado pero ya no está activo");
    assert.equal(view.body.hold.remainingSeconds, 0);
    assert.equal(view.body.stepper.terminal, "expired");
    assert.equal(view.body.stepper.steps.find((s: { key: string }) => s.key === "payment").state, "failed");
    assert.equal(view.body.nextAction.kind, "search_again");
    const hold = (await pool.query(`select status, released_at from seat_holds where request_id=$1`, [created.body.id])).rows[0];
    assert.equal(hold.status, "released");
    assert.ok(hold.released_at);
    const notice = await pool.query(`select user_id, kind from notifications where kind='request_expired'`);
    assert.equal(notice.rowCount, 1);
    assert.equal(notice.rows[0].user_id, w.miguel);
    const detail = await S.api(app).get(`/v1/trips/${tripA.tripId}`);
    assert.equal(detail.body.seats.available, 3, "la plaza vuelve a estar libre");
    // y la lectura repetida no duplica avisos
    await S.api(app, tokens.miguel).get(`/v1/ride-requests/${created.body.id}`);
    assert.equal(await S.count(pool, `select 1 from notifications where kind='request_expired'`), 1);
  });

  test("el barrido periódico caduca holds aunque nadie abra la app", async () => {
    const created = await requestSeat(tokens.miguel, tripA.tripId);
    await S.api(app, tokens.ana).post(`/v1/ride-requests/${created.body.id}/decision`, { decision: "accept" });
    await pool.query(`update seat_holds set expires_at = now() - interval '5 seconds' where request_id=$1`, [created.body.id]);
    const result = await runTripsSweep(pool);
    assert.equal(result.expired, 1);
    assert.equal((await pool.query(`select status from ride_requests where id=$1`, [created.body.id])).rows[0].status, "expired");
    assert.equal(await S.count(pool, `select 1 from notifications where kind='request_expired'`), 1);
    const again = await runTripsSweep(pool);
    assert.equal(again.expired, 0, "idempotente");
  });

  test("tras caducar, el conductor ya no puede aceptar y la plaza puede ocuparla otro", async () => {
    const small = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { capacity: 1, departureAt: S.hoursAfter(new Date(), 4) });
    const first = await S.api(app, tokens.miguel).post(`/v1/trips/${small.tripId}/requests`, { fromSegmentSeq: 0, toSegmentSeq: 2 });
    const second = await S.api(app, tokens.laura).post(`/v1/trips/${small.tripId}/requests`, { fromSegmentSeq: 0, toSegmentSeq: 2 });
    assert.equal((await S.api(app, tokens.ana).post(`/v1/ride-requests/${first.body.id}/decision`, { decision: "accept" })).status, 200);
    const blocked = await S.api(app, tokens.ana).post(`/v1/ride-requests/${second.body.id}/decision`, { decision: "accept" });
    assert.equal(blocked.status, 409);
    assert.equal(S.codeOf(blocked), "NO_CAPACITY_ON_SEGMENT");
    await pool.query(`update seat_holds set expires_at = now() - interval '5 seconds' where request_id=$1`, [first.body.id]);
    const lateAccept = await S.api(app, tokens.ana).post(`/v1/ride-requests/${first.body.id}/decision`, { decision: "accept" });
    assert.equal(lateAccept.status, 409);
    assert.equal(S.codeOf(lateAccept), "REQUEST_NOT_PENDING");
    const ok = await S.api(app, tokens.ana).post(`/v1/ride-requests/${second.body.id}/decision`, { decision: "accept" });
    assert.equal(ok.status, 200, "con el hold caducado, la plaza vuelve a poder aceptarse");
  });

  test("confirmada (reserva creada por `money`): stepper completo, próxima acción «ver reserva» y matrícula completa", async () => {
    const seeded = await S.seedRequest(pool, tripA.tripId, w.miguel, 1, 2, { status: "confirmed" });
    const view = await S.api(app, tokens.miguel).get(`/v1/ride-requests/${seeded.requestId}`);
    assert.equal(view.status, 200);
    assert.equal(view.body.status, "confirmed");
    assert.ok(view.body.stepper.steps.every((s: { state: string }) => s.state === "done"));
    assert.equal(view.body.stepper.current, "confirmed");
    assert.equal(view.body.nextAction.kind, "view_booking");
    assert.equal(view.body.booking.id, seeded.bookingId);
    assert.equal(view.body.trip.vehicle.plate, w.plate, "reserva confirmada: matrícula completa");
  });

  test("rechazada: stepper fallido en «Aceptada», `search_again` y aviso al pasajero", async () => {
    const created = await requestSeat(tokens.miguel, tripA.tripId);
    const rejected = await S.api(app, tokens.ana).post(`/v1/ride-requests/${created.body.id}/decision`, { decision: "reject" });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.status, "rejected");
    assert.equal(rejected.body.hold, null);
    const view = await S.api(app, tokens.miguel).get(`/v1/ride-requests/${created.body.id}`);
    assert.equal(view.body.status, "rejected");
    assert.equal(view.body.stepper.terminal, "rejected");
    assert.equal(view.body.stepper.steps[1].state, "failed");
    assert.equal(view.body.nextAction.kind, "search_again");
    const n = await pool.query(`select kind from notifications where user_id=$1 and kind like 'request_%'`, [w.miguel]);
    assert.deepEqual(n.rows.map(r => r.kind), ["request_rejected"]);
    assert.equal(await S.count(pool, `select 1 from audit_events where action='ride_request.rejected'`), 1);
  });
});

describe("decisión del conductor", () => {
  test("aceptar crea el hold en la misma transacción, avisa al pasajero y deja auditoría", async () => {
    const created = await requestSeat(tokens.miguel, tripA.tripId);
    const decided = await S.api(app, tokens.ana).post(`/v1/ride-requests/${created.body.id}/decision`, { decision: "accept" });
    assert.equal(decided.status, 200);
    assert.ok(decided.body.hold.id);
    const hold = (await pool.query(`select status from seat_holds where request_id=$1`, [created.body.id])).rows[0];
    assert.equal(hold.status, "active");
    assert.equal(await S.count(pool, `select 1 from ride_requests where id='${created.body.id}' and status='payment_pending'`), 1);
    const n = (await pool.query(`select kind, data from notifications where user_id=$1 and kind='request_accepted'`, [w.miguel])).rows;
    assert.equal(n.length, 1);
    assert.equal(n[0].data.requestId, created.body.id);
    assert.ok(n[0].data.holdExpiresAt);
    assert.equal(await S.count(pool, `select 1 from audit_events where action='ride_request.accepted_with_hold'`), 1);
    // aceptar dos veces
    const twice = await S.api(app, tokens.ana).post(`/v1/ride-requests/${created.body.id}/decision`, { decision: "accept" });
    assert.equal(twice.status, 409);
    assert.equal(S.codeOf(twice), "REQUEST_NOT_PENDING");
  });

  test("solo decide el conductor del viaje: otro conductor y el propio pasajero reciben 403 sin conocer el estado", async () => {
    const created = await requestSeat(tokens.miguel, tripA.tripId);
    const other = await S.api(app, tokens.otherDriver).post(`/v1/ride-requests/${created.body.id}/decision`, { decision: "accept" });
    assert.equal(other.status, 403);
    assert.equal(S.codeOf(other), "TRIP_NOT_OWNED");
    const passenger = await S.api(app, tokens.miguel).post(`/v1/ride-requests/${created.body.id}/decision`, { decision: "accept" });
    assert.equal(passenger.status, 403);
    assert.equal(S.codeOf(passenger), "AUTH_FORBIDDEN");
    // incluso con la solicitud ya rechazada, un extraño recibe el mismo 403 (no averigua el estado)
    await S.api(app, tokens.ana).post(`/v1/ride-requests/${created.body.id}/decision`, { decision: "reject" });
    const stranger = await S.api(app, tokens.otherDriver).post(`/v1/ride-requests/${created.body.id}/decision`, { decision: "accept" });
    assert.equal(stranger.status, 403);
    assert.equal(S.codeOf(stranger), "TRIP_NOT_OWNED");
    assert.equal(await S.count(pool, `select 1 from seat_holds`), 0);
    const missing = await S.api(app, tokens.ana).post(`/v1/ride-requests/${"00000000-0000-4000-8000-000000000000"}/decision`, { decision: "accept" });
    assert.equal(missing.status, 404);
    assert.equal(S.codeOf(missing), "REQUEST_NOT_FOUND");
    const bad = await S.api(app, tokens.ana).post(`/v1/ride-requests/${created.body.id}/decision`, { decision: "quizá" });
    assert.equal(bad.status, 400);
  });

  test("viaje cancelado: no se puede aceptar (TRIP_NOT_BOOKABLE)", async () => {
    const created = await requestSeat(tokens.miguel, tripA.tripId);
    await pool.query(`update trips set status='cancelled' where id=$1`, [tripA.tripId]);
    const r = await S.api(app, tokens.ana).post(`/v1/ride-requests/${created.body.id}/decision`, { decision: "accept" });
    assert.equal(r.status, 409);
    assert.equal(S.codeOf(r), "TRIP_NOT_BOOKABLE");
  });

  test("última plaza: dos aceptaciones simultáneas → solo una prospera (sin sobreventa)", async () => {
    const one = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { capacity: 1, departureAt: S.hoursAfter(new Date(), 4) });
    const a = await S.api(app, tokens.miguel).post(`/v1/trips/${one.tripId}/requests`, { fromSegmentSeq: 0, toSegmentSeq: 2 });
    const b = await S.api(app, tokens.laura).post(`/v1/trips/${one.tripId}/requests`, { fromSegmentSeq: 0, toSegmentSeq: 2 });
    const results = await Promise.all([
      S.api(app, tokens.ana).post(`/v1/ride-requests/${a.body.id}/decision`, { decision: "accept" }),
      S.api(app, tokens.ana).post(`/v1/ride-requests/${b.body.id}/decision`, { decision: "accept" })
    ]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const failed = results.find(r => r.status === 409)!;
    assert.equal(S.codeOf(failed), "NO_CAPACITY_ON_SEGMENT");
    assert.equal(await S.count(pool, `select 1 from seat_holds where status='active'`), 1);
    assert.equal(await S.count(pool, `select 1 from ride_requests where status='payment_pending'`), 1);
    assert.equal(await S.count(pool, `select 1 from ride_requests where status='pending'`), 1);
  });

  test("capacidad por tramo con rangos que se solapan solo en parte (última plaza del tramo compartido)", async () => {
    const one = await S.seedTrip(pool, w.ana, w.vehicleId, w.provinceId, { capacity: 1, departureAt: S.hoursAfter(new Date(), 4) });
    const wholeTrip = await S.api(app, tokens.miguel).post(`/v1/trips/${one.tripId}/requests`, { fromSegmentSeq: 0, toSegmentSeq: 2 });
    const lastLeg = await S.api(app, tokens.laura).post(`/v1/trips/${one.tripId}/requests`, { fromSegmentSeq: 1, toSegmentSeq: 2 });
    const firstLegOnly = await S.api(app, tokens.otherDriver).post(`/v1/trips/${one.tripId}/requests`, { fromSegmentSeq: 0, toSegmentSeq: 1 });
    assert.equal(wholeTrip.status, 201);
    assert.equal(lastLeg.status, 201);
    assert.equal(firstLegOnly.status, 201);
    assert.equal((await S.api(app, tokens.ana).post(`/v1/ride-requests/${wholeTrip.body.id}/decision`, { decision: "accept" })).status, 200);
    // el trayecto completo ocupa los dos tramos: ni el último tramo ni el primero tienen plaza
    assert.equal(S.codeOf(await S.api(app, tokens.ana).post(`/v1/ride-requests/${lastLeg.body.id}/decision`, { decision: "accept" })), "NO_CAPACITY_ON_SEGMENT");
    assert.equal(S.codeOf(await S.api(app, tokens.ana).post(`/v1/ride-requests/${firstLegOnly.body.id}/decision`, { decision: "accept" })), "NO_CAPACITY_ON_SEGMENT");
    // rechazar sí es posible
    assert.equal((await S.api(app, tokens.ana).post(`/v1/ride-requests/${lastLeg.body.id}/decision`, { decision: "reject" })).status, 200);
  });
});

describe("retirar solicitud y autorización de lectura", () => {
  test("el pasajero retira una pendiente: `cancelled`, aviso al conductor y auditoría", async () => {
    const created = await requestSeat(tokens.miguel, tripA.tripId);
    const r = await S.api(app, tokens.miguel).post(`/v1/ride-requests/${created.body.id}/withdraw`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, "cancelled");
    const n = await pool.query(`select kind from notifications where user_id=$1 and kind='request_withdrawn'`, [w.ana]);
    assert.equal(n.rowCount, 1);
    assert.equal(await S.count(pool, `select 1 from audit_events where action='ride_request.withdrawn'`), 1);
    // ya no se puede aceptar
    const late = await S.api(app, tokens.ana).post(`/v1/ride-requests/${created.body.id}/decision`, { decision: "accept" });
    assert.equal(S.codeOf(late), "REQUEST_NOT_PENDING");
  });

  test("no se retira una solicitud aceptada (la cancelación es de `money`) ni la de otro", async () => {
    const created = await requestSeat(tokens.miguel, tripA.tripId);
    await S.api(app, tokens.ana).post(`/v1/ride-requests/${created.body.id}/decision`, { decision: "accept" });
    const r = await S.api(app, tokens.miguel).post(`/v1/ride-requests/${created.body.id}/withdraw`);
    assert.equal(r.status, 409);
    assert.equal(S.codeOf(r), "REQUEST_NOT_WITHDRAWABLE");
    assert.equal(r.body.error.details.status, "payment_pending");
    for (const token of [tokens.laura, tokens.ana, tokens.otherDriver]) {
      const other = await S.api(app, token).post(`/v1/ride-requests/${created.body.id}/withdraw`);
      assert.equal(other.status, 404);
      assert.equal(S.codeOf(other), "REQUEST_NOT_FOUND");
    }
  });

  test("lectura por recurso: el pasajero y el conductor del viaje sí; cualquier otro, 404; sin sesión, 401", async () => {
    const created = await requestSeat(tokens.miguel, tripA.tripId);
    const id = created.body.id as string;
    assert.equal((await S.api(app, tokens.miguel).get(`/v1/ride-requests/${id}`)).status, 200);
    const asDriver = await S.api(app, tokens.ana).get(`/v1/ride-requests/${id}`);
    assert.equal(asDriver.status, 200);
    assert.equal(asDriver.body.trip.vehicle.plate, w.plate, "el conductor ve su propia matrícula");
    for (const token of [tokens.laura, tokens.otherDriver]) {
      const r = await S.api(app, token).get(`/v1/ride-requests/${id}`);
      assert.equal(r.status, 404);
      assert.equal(S.codeOf(r), "REQUEST_NOT_FOUND");
    }
    assert.equal((await S.api(app).get(`/v1/ride-requests/${id}`)).status, 401);
    assert.equal((await S.api(app, tokens.miguel).get(`/v1/ride-requests/no-es-uuid`)).status, 400);
  });

  test("el conductor ve al pasajero solo como PublicUser (sin teléfono ni identidad)", async () => {
    const created = await requestSeat(tokens.miguel, tripA.tripId);
    const view = await S.api(app, tokens.ana).get(`/v1/ride-requests/${created.body.id}`);
    assert.deepEqual(Object.keys(view.body.passenger).sort(), ["displayName", "firstName", "id", "photoUrl", "ratingAverage", "ratingCount"]);
  });
});
