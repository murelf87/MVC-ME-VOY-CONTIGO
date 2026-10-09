/**
 * Módulo money · cancelación: vista previa (pantalla 28), cancelación del pasajero y del conductor, política versionada
 * (hoy NO existe ninguna aprobada → «pending_review», importes «Por definir»), idempotencia y consecuencias de otros módulos.
 *
 * Las reglas de política que se usan aquí son un FIXTURE de pruebas (`TEST_POLICY_RULES`), no la política de MVC.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import {
  approveTariff,
  bearer,
  buildTestApp,
  createTestPool,
  ensureTariff,
  insertApprovedPolicy,
  newKey,
  paidBooking,
  resetMoneyData,
  retireApprovedPolicy,
  scalar,
  seedPayableRequest,
  seedTrip,
  seedWorld,
  startTrip,
  StubPaymentProvider,
  type Actor,
  type World
} from "./money-support.js";

const pool = createTestPool();
let world: World;
let stub: StubPaymentProvider;
let app: FastifyInstance;

before(async () => {
  await pool.query("select 1 from refund_requests limit 1");
});
after(async () => {
  await pool.end();
});
beforeEach(async () => {
  await resetMoneyData(pool);
  world = await seedWorld(pool);
  stub = new StubPaymentProvider();
  app = await buildTestApp(pool, stub);
});
afterEach(async () => {
  await app.close();
});

async function count(table: string, where = "true", params: unknown[] = []): Promise<number> {
  return Number(await scalar<string>(pool, `select count(*)::text from ${table} where ${where}`, params));
}

async function preview(actor: Actor, bookingId: string) {
  const response = await app.inject({ method: "GET", url: `/v1/bookings/${bookingId}/cancellation-preview`, headers: bearer(actor) });
  return { response, json: response.json() as Record<string, any> };
}

async function cancel(
  actor: Actor,
  bookingId: string,
  body: Record<string, unknown> = { reason: "schedule_change" },
  key: string = newKey(),
  path: "cancel" | "driver-cancel" = "cancel"
) {
  const response = await app.inject({
    method: "POST",
    url: `/v1/bookings/${bookingId}/${path}`,
    headers: { ...bearer(actor), "idempotency-key": key },
    payload: body
  });
  return { response, json: response.json() as Record<string, any>, key };
}

async function ledgerNet(account: string, userId?: string): Promise<number> {
  return Number(
    await scalar<string>(
      pool,
      `select coalesce(sum(amount_cents),0)::text from ledger_entries where account=$1 and ($2::uuid is null or user_id=$2::uuid)`,
      [account, userId ?? null]
    )
  );
}

/* ═════════════════════════ Vista previa ═════════════════════════ */

describe("vista previa de la cancelación (sin política aprobada)", () => {
  it("mientras no exista política aprobada: policy «pending_review», importes derivados «Por definir», nada prometido", async () => {
    const booking = await paidBooking(pool, app, world);
    const { response, json } = await preview(world.miguel, booking.bookingId);
    assert.equal(response.statusCode, 200);
    assert.equal(json.canCancel, true);
    assert.equal(json.blocked, null);
    assert.equal(json.scenario, "passenger_cancellation");
    assert.equal(json.decisionMode, "admin_review");
    assert.deepEqual(json.reasons, ["no_longer_needed", "schedule_change", "found_other_option", "other"]);
    assert.deepEqual(json.policy, { status: "pending_review", version: null, effectiveFrom: null, summary: null });
    assert.equal(json.proposedRefund.status, "pending_definition");
    assert.equal(json.proposedRefund.cents, null);
    const lines = Object.fromEntries(json.lines.map((l: { key: string }) => [l.key, l]));
    assert.equal(lines.trip_contribution.noteCode, "subject_to_conditions");
    assert.equal(lines.trip_contribution.amount.cents, 1000, "la aportación pagada es un dato conocido, pero sujeta a condiciones");
    assert.equal(lines.platform_fee.amount.status, "pending_definition");
    assert.equal(lines.platform_fee.noteCode, "policy_pending_review");
    assert.equal(json.booking.paid.cents, 1100);
    assert.equal(json.booking.status, "confirmed");
    assert.equal(json.booking.driver.id, world.ana.id);
    assert.equal(json.booking.trip.originLabel, "Sevilla Centro");
    assert.match(json.legalNotice, /normativa vigente/);
    // Nunca se afirma como regla absoluta que MVC retenga su comisión
    assert.ok(!/se queda|retiene|no reembols|sin devoluci/i.test(response.body), response.body);
  });

  it("solo el pasajero de la reserva puede verla (404 para conductor y terceros), y exige sesión", async () => {
    const booking = await paidBooking(pool, app, world);
    for (const actor of [world.ana, world.lucia, world.finance]) {
      const { response, json } = await preview(actor, booking.bookingId);
      assert.equal(response.statusCode, 404, actor.name);
      assert.equal(json.error.code, "BOOKING_NOT_FOUND");
    }
    const noAuth = await app.inject({ method: "GET", url: `/v1/bookings/${booking.bookingId}/cancellation-preview` });
    assert.equal(noAuth.statusCode, 401);
    const malformed = await app.inject({ method: "GET", url: "/v1/bookings/xxx/cancellation-preview", headers: bearer(world.miguel) });
    assert.equal(malformed.statusCode, 400);
  });

  it("viaje ya empezado → canCancel=false con TRIP_ALREADY_STARTED", async () => {
    const booking = await paidBooking(pool, app, world);
    await startTrip(pool, booking.tripId);
    const { json } = await preview(world.miguel, booking.bookingId);
    assert.equal(json.canCancel, false);
    assert.equal(json.blocked.code, "TRIP_ALREADY_STARTED");
  });

  it("reserva ya cancelada o no cancelable → bloqueada con su motivo", async () => {
    const booking = await paidBooking(pool, app, world);
    await pool.query(`update bookings set status='cancelled' where id=$1`, [booking.bookingId]);
    assert.equal((await preview(world.miguel, booking.bookingId)).json.blocked.code, "BOOKING_ALREADY_CANCELLED");
    await pool.query(`update bookings set status='completed' where id=$1`, [booking.bookingId]);
    const completed = await preview(world.miguel, booking.bookingId);
    assert.equal(completed.json.canCancel, false);
    assert.equal(completed.json.blocked.code, "BOOKING_NOT_CANCELLABLE");
  });
});

describe("vista previa con una política aprobada ACEPTADA al pagar (fixture)", () => {
  it("lejos de la salida (≥ 48 h): aplica la regla de mayor umbral y detalla los importes", async () => {
    const policy = await insertApprovedPolicy(pool, world.admin);
    const booking = await paidBooking(pool, app, world); // sale en 72 h
    const { json } = await preview(world.miguel, booking.bookingId);
    assert.equal(json.policy.status, "approved");
    assert.equal(json.policy.version, policy.version);
    assert.equal(json.policy.summary, "Fixture de pruebas, no es la política de MVC");
    assert.equal(json.proposedRefund.cents, 1100);
    assert.deepEqual(
      json.lines.map((l: { key: string; amount: { cents: number }; noteCode: string }) => [l.key, l.amount.cents, l.noteCode]),
      [["trip_contribution", 1000, "per_policy"], ["platform_fee", 100, "per_policy"]]
    );
    assert.equal(json.decisionMode, "admin_review", "aun con política, la devolución la aprueba Administración");
  });

  it("cerca de la salida (< 48 h): la regla del fixture devuelve el 50 % de la aportación y MVC retiene su comisión SOLO porque lo dice el dato de la política", async () => {
    await insertApprovedPolicy(pool, world.admin);
    const booking = await paidBooking(pool, app, world, { departureInterval: "10 hours" });
    const { json } = await preview(world.miguel, booking.bookingId);
    assert.equal(json.proposedRefund.cents, 500);
    const lines = Object.fromEntries(json.lines.map((l: { key: string }) => [l.key, l]));
    assert.equal(lines.trip_contribution.amount.cents, 500);
    assert.equal(lines.platform_fee.amount.cents, 0);
  });

  it("una política aprobada DESPUÉS del pago no se aplica a ese pago (no la aceptó): sigue «pending_review»", async () => {
    const booking = await paidBooking(pool, app, world);
    await insertApprovedPolicy(pool, world.admin);
    const { json } = await preview(world.miguel, booking.bookingId);
    assert.equal(json.policy.status, "pending_review");
    assert.equal(json.proposedRefund.status, "pending_definition");
  });

  it("una política retirada después sigue aplicando a quien la aceptó al pagar", async () => {
    const policy = await insertApprovedPolicy(pool, world.admin);
    const booking = await paidBooking(pool, app, world);
    await retireApprovedPolicy(pool);
    await insertApprovedPolicy(pool, world.admin, { summary: "Segunda versión" });
    const { json } = await preview(world.miguel, booking.bookingId);
    assert.equal(json.policy.status, "approved");
    assert.equal(json.policy.version, policy.version);
    assert.equal(json.proposedRefund.cents, 1100);
  });

  it("una política que no cubre el caso (sin regla aplicable) no decide nada", async () => {
    await insertApprovedPolicy(pool, world.admin, {
      rules: [{ ...{ scenario: "passenger_cancellation", refundContributionBps: 10_000, refundCommissionBps: 10_000, refundProcessingBps: 10_000, refundTaxesBps: 10_000 }, minHoursBeforeDeparture: 200 }]
    });
    const booking = await paidBooking(pool, app, world); // 72 h < 200 h
    const { json } = await preview(world.miguel, booking.bookingId);
    assert.equal(json.policy.status, "pending_review");
    assert.equal(json.proposedRefund.cents, null);
  });
});

/* ═════════════════════════ Cancelar (pasajero) ═════════════════════════ */

describe("cancelar mi reserva (pasajero)", () => {
  it("sin política: reserva y solicitud canceladas, plaza liberada y una PROPUESTA en revisión (sin importe ni dinero movido)", async () => {
    const booking = await paidBooking(pool, app, world);
    const ledgerBefore = await count("ledger_transactions");
    const { response, json } = await cancel(world.miguel, booking.bookingId, { reason: "schedule_change", note: "Cambio de turno" });
    assert.equal(response.statusCode, 200);
    assert.equal(json.alreadyCancelled, false);
    assert.deepEqual(json.booking, { id: booking.bookingId, status: "cancelled" });
    const refund = json.refund;
    assert.equal(refund.status, "pending_review");
    assert.equal(refund.origin, "passenger_cancellation");
    assert.equal(refund.bookingId, booking.bookingId);
    assert.equal(refund.paymentId, booking.paymentId);
    assert.equal(refund.paid.cents, 1100);
    assert.equal(refund.proposedRefund.status, "pending_definition");
    assert.equal(refund.approvedRefund.cents, null);
    assert.equal(refund.executionStatus, "not_started");
    assert.equal(refund.policy.status, "pending_review");
    assert.equal(refund.refundedAt, null);
    assert.equal(refund.decidedAt, null);

    assert.equal(await scalar<string>(pool, `select status::text from bookings where id=$1`, [booking.bookingId]), "cancelled");
    assert.equal(await scalar<string>(pool, `select status::text from ride_requests where id=$1`, [booking.requestId]), "cancelled");
    assert.equal(await count("bookings", "status='confirmed'"), 0, "la plaza vuelve a estar libre");
    // Cancelar NO mueve dinero ni crea asientos: la devolución es solo una propuesta.
    assert.equal(await count("ledger_transactions"), ledgerBefore);
    assert.equal(await scalar<string>(pool, `select status::text from payments where id=$1`, [booking.paymentId]), "succeeded");
    assert.equal(await scalar<string>(pool, `select refunded_cents::text from payments where id=$1`, [booking.paymentId]), "0");
    assert.equal(stub.calls.refundPayment, 0, "no se llama al proveedor hasta que Administración apruebe");

    // Avisos y auditoría
    assert.equal(await count("notifications", "user_id=$1 and kind=$2", [world.ana.id, "booking_cancelled"]), 1);
    assert.equal(await count("notifications", "user_id=$1 and kind=$2", [world.miguel.id, "refund_proposal_created"]), 1);
    assert.equal(await count("audit_events", "action=$1 and actor_user_id=$2", ["booking.cancelled_by_passenger", world.miguel.id]), 1);
    const row = await pool.query(`select cancelled_by, cancel_reason, cancel_note, paid_cents, proposed_cents, retained_commission_cents from refund_requests`);
    assert.deepEqual(row.rows, [
      { cancelled_by: "passenger", cancel_reason: "schedule_change", cancel_note: "Cambio de turno", paid_cents: 1100, proposed_cents: null, retained_commission_cents: null }
    ]);
    // Mis devoluciones lo muestra
    const mine = await app.inject({ method: "GET", url: "/v1/me/refunds", headers: bearer(world.miguel) });
    assert.equal(mine.json().items.length, 1);
    assert.equal(mine.json().items[0].id, refund.id);
    // Y «Mis pagos» lo marca «en revisión», no «devuelto»
    const payments = await app.inject({ method: "GET", url: "/v1/me/payments", headers: bearer(world.miguel) });
    assert.equal(payments.json().items[0].state, "under_review");
  });

  it("con política aceptada al pagar: la propuesta lleva el importe de la política pero sigue en revisión", async () => {
    await insertApprovedPolicy(pool, world.admin);
    const booking = await paidBooking(pool, app, world, { departureInterval: "10 hours" });
    const { json } = await cancel(world.miguel, booking.bookingId, { reason: "no_longer_needed" });
    assert.equal(json.refund.status, "pending_review", "nunca se resuelve sola");
    assert.equal(json.refund.policy.status, "approved");
    assert.equal(json.refund.proposedRefund.cents, 500);
    assert.equal(json.refund.platformFee.cents, 100, "comisión que retendría según la regla (dato de la política)");
    assert.equal(json.refund.finalPassengerCost.cents, 600);
    const row = await pool.query(`select policy_status, policy_id is not null as has_policy, proposed_cents, retained_commission_cents from refund_requests`);
    assert.deepEqual(row.rows, [{ policy_status: "approved", has_policy: true, proposed_cents: 500, retained_commission_cents: 100 }]);
    assert.equal(stub.calls.refundPayment, 0);
  });

  it("es idempotente: misma clave → misma respuesta; otra clave sobre la reserva ya cancelada → alreadyCancelled sin duplicar propuestas", async () => {
    const booking = await paidBooking(pool, app, world);
    const key = newKey();
    const first = await cancel(world.miguel, booking.bookingId, { reason: "other", note: "x" }, key);
    const replay = await cancel(world.miguel, booking.bookingId, { reason: "other", note: "x" }, key);
    assert.equal(first.response.statusCode, 200);
    assert.equal(replay.response.statusCode, 200);
    assert.equal(replay.response.headers["idempotency-replayed"], "true");
    assert.deepEqual(replay.json, first.json);

    const again = await cancel(world.miguel, booking.bookingId, { reason: "other" });
    assert.equal(again.response.statusCode, 200);
    assert.equal(again.json.alreadyCancelled, true);
    assert.equal(again.json.refund.id, first.json.refund.id);
    assert.equal(await count("refund_requests"), 1);
    assert.equal(await count("notifications", "kind=$1", ["booking_cancelled"]), 1, "no se vuelve a avisar al conductor");

    const reused = await cancel(world.miguel, booking.bookingId, { reason: "no_longer_needed" }, key);
    assert.equal(reused.response.statusCode, 422);
    assert.equal(reused.json.error.code, "IDEMPOTENCY_KEY_REUSED");
  });

  it("cancelaciones simultáneas con claves distintas: una sola propuesta y un solo aviso", async () => {
    const booking = await paidBooking(pool, app, world);
    const results = await Promise.all(Array.from({ length: 5 }, () => cancel(world.miguel, booking.bookingId, { reason: "found_other_option" })));
    assert.ok(results.every(r => r.response.statusCode === 200), results.map(r => r.response.body).join("\n"));
    assert.equal(results.filter(r => r.json.alreadyCancelled === false).length, 1);
    assert.equal(new Set(results.map(r => r.json.refund.id)).size, 1);
    assert.equal(await count("refund_requests"), 1);
    assert.equal(await count("notifications", "kind=$1", ["booking_cancelled"]), 1);
  });

  it("valida el cuerpo y la clave: motivo desconocido, nota larga o clave ausente → 400", async () => {
    const booking = await paidBooking(pool, app, world);
    const cases: Array<Record<string, unknown>> = [{}, { reason: "porque_si" }, { reason: "other", note: "x".repeat(501) }, { reason: 5 }];
    for (const body of cases) {
      const { response, json } = await cancel(world.miguel, booking.bookingId, body);
      assert.equal(response.statusCode, 400, JSON.stringify(body).slice(0, 80));
      assert.equal(json.error.code, "VALIDATION_ERROR");
    }
    const noKey = await app.inject({
      method: "POST",
      url: `/v1/bookings/${booking.bookingId}/cancel`,
      headers: bearer(world.miguel),
      payload: { reason: "other" }
    });
    assert.equal(noKey.statusCode, 400);
    assert.equal(await scalar<string>(pool, `select status::text from bookings where id=$1`, [booking.bookingId]), "confirmed");
  });

  it("viaje ya empezado → 409 TRIP_ALREADY_STARTED y no cambia nada", async () => {
    const booking = await paidBooking(pool, app, world);
    await startTrip(pool, booking.tripId);
    const { response, json } = await cancel(world.miguel, booking.bookingId);
    assert.equal(response.statusCode, 409);
    assert.equal(json.error.code, "TRIP_ALREADY_STARTED");
    assert.equal(await scalar<string>(pool, `select status::text from bookings where id=$1`, [booking.bookingId]), "confirmed");
    assert.equal(await count("refund_requests"), 0);
  });

  it("una reserva completada o del conductor cancelada no se puede cancelar → 409 BOOKING_NOT_CANCELLABLE", async () => {
    const booking = await paidBooking(pool, app, world);
    await pool.query(`update bookings set status='completed' where id=$1`, [booking.bookingId]);
    const completed = await cancel(world.miguel, booking.bookingId);
    assert.equal(completed.response.statusCode, 409);
    assert.equal(completed.json.error.code, "BOOKING_NOT_CANCELLABLE");
    await pool.query(`update bookings set status='driver_cancelled' where id=$1`, [booking.bookingId]);
    const driverCancelled = await cancel(world.miguel, booking.bookingId);
    assert.equal(driverCancelled.response.statusCode, 409);
  });

  it("solo el pasajero: el conductor, terceros y administradores reciben 404 y no cancelan nada", async () => {
    const booking = await paidBooking(pool, app, world);
    for (const actor of [world.ana, world.lucia, world.admin, world.finance]) {
      const { response, json } = await cancel(actor, booking.bookingId);
      assert.equal(response.statusCode, 404, actor.name);
      assert.equal(json.error.code, "BOOKING_NOT_FOUND");
    }
    assert.equal(await scalar<string>(pool, `select status::text from bookings where id=$1`, [booking.bookingId]), "confirmed");
    const unknown = await cancel(world.miguel, "00000000-0000-4000-8000-000000000000");
    assert.equal(unknown.response.statusCode, 404);
    const noAuth = await app.inject({ method: "POST", url: `/v1/bookings/${booking.bookingId}/cancel`, headers: { "idempotency-key": newKey() }, payload: { reason: "other" } });
    assert.equal(noAuth.statusCode, 401);
  });

  it("reserva sin registro de pago en MVC pero con importe: la propuesta existe, sin pago asociado (no hay nada que devolver desde aquí)", async () => {
    const tariff = await ensureTariff(pool);
    const trip = await seedTrip(pool, world);
    const { requestId } = await seedPayableRequest(pool, trip, world.miguel, { tariffId: tariff });
    await pool.query(`update ride_requests set status='confirmed' where id=$1`, [requestId]);
    await pool.query(`update seat_holds set status='consumed' where request_id=$1`, [requestId]);
    const bookingId = await scalar<string>(
      pool,
      `insert into bookings(request_id,provider_payment_id,amount_cents,status) values($1,'legacy-pay-1',1100,'confirmed') returning id`,
      [requestId]
    );
    const { response, json } = await cancel(world.miguel, bookingId, { reason: "other" });
    assert.equal(response.statusCode, 200);
    assert.equal(json.refund.paymentId, null);
    assert.equal(json.refund.paid.cents, 1100);
    assert.equal(json.refund.status, "pending_review");
  });

  it("reserva sin importe pagado: se cancela sin propuesta de devolución", async () => {
    const tariff = await ensureTariff(pool);
    const trip = await seedTrip(pool, world);
    const { requestId } = await seedPayableRequest(pool, trip, world.miguel, { tariffId: tariff });
    await pool.query(`update ride_requests set status='confirmed' where id=$1`, [requestId]);
    const bookingId = await scalar<string>(
      pool,
      `insert into bookings(request_id,provider_payment_id,amount_cents,status) values($1,'legacy-free-1',0,'confirmed') returning id`,
      [requestId]
    );
    const { response, json } = await cancel(world.miguel, bookingId, { reason: "other" });
    assert.equal(response.statusCode, 200);
    assert.equal(json.refund, null);
    assert.equal(await count("refund_requests"), 0);
  });

  it("tras cancelar, el cobro del conductor deja de listarse como pendiente (importe en disputa, no ganancia)", async () => {
    const booking = await paidBooking(pool, app, world);
    const before = await app.inject({ method: "GET", url: "/v1/me/earnings", headers: bearer(world.ana) });
    assert.equal(before.json().items.length, 1);
    assert.equal(before.json().items[0].state, "pending");
    await cancel(world.miguel, booking.bookingId, { reason: "other" });
    const after = await app.inject({ method: "GET", url: "/v1/me/earnings", headers: bearer(world.ana) });
    assert.deepEqual(after.json().items, []);
    const detail = await app.inject({ method: "GET", url: `/v1/me/earnings/${booking.bookingId}`, headers: bearer(world.ana) });
    assert.equal(detail.statusCode, 404);
  });
});

/* ═════════════════════════ Cancelar (conductor) ═════════════════════════ */

describe("cancelar una reserva como conductor", () => {
  it("reserva «driver_cancelled», solicitud cancelada, aviso al pasajero y propuesta en revisión SIN importe (consecuencias no definidas)", async () => {
    await insertApprovedPolicy(pool, world.admin); // aunque exista política de pasajero, la del conductor NO está definida
    const booking = await paidBooking(pool, app, world);
    const { response, json } = await cancel(world.ana, booking.bookingId, { reason: "vehicle_issue", note: "Avería" }, newKey(), "driver-cancel");
    assert.equal(response.statusCode, 200);
    assert.deepEqual(json.booking, { id: booking.bookingId, status: "driver_cancelled" });
    assert.equal(json.alreadyCancelled, false);
    assert.equal(json.refund.origin, "driver_cancellation");
    assert.equal(json.refund.status, "pending_review");
    assert.equal(json.refund.proposedRefund.status, "pending_definition");
    assert.equal(json.refund.policy.status, "pending_review");
    assert.equal(await scalar<string>(pool, `select status::text from ride_requests where id=$1`, [booking.requestId]), "cancelled");
    assert.equal(await count("notifications", "user_id=$1 and kind=$2", [world.miguel.id, "booking_cancelled_by_driver"]), 1);
    assert.equal(await count("audit_events", "action=$1 and actor_user_id=$2", ["booking.cancelled_by_driver", world.ana.id]), 1);
    const mine = await app.inject({ method: "GET", url: "/v1/me/refunds", headers: bearer(world.miguel) });
    assert.equal(mine.json().items[0].origin, "driver_cancellation");
    assert.equal(stub.calls.refundPayment, 0);
  });

  it("idempotente y sin duplicados; el pasajero y terceros no pueden usarlo; tampoco con el viaje empezado", async () => {
    const booking = await paidBooking(pool, app, world);
    for (const actor of [world.miguel, world.lucia, world.finance]) {
      const denied = await cancel(actor, booking.bookingId, { reason: "other" }, newKey(), "driver-cancel");
      assert.equal(denied.response.statusCode, 404, actor.name);
    }
    const key = newKey();
    const first = await cancel(world.ana, booking.bookingId, { reason: "emergency" }, key, "driver-cancel");
    const replay = await cancel(world.ana, booking.bookingId, { reason: "emergency" }, key, "driver-cancel");
    assert.equal(replay.response.headers["idempotency-replayed"], "true");
    assert.deepEqual(replay.json, first.json);
    const again = await cancel(world.ana, booking.bookingId, { reason: "other" }, newKey(), "driver-cancel");
    assert.equal(again.json.alreadyCancelled, true);
    assert.equal(await count("refund_requests"), 1);
    assert.equal(await count("notifications", "kind=$1", ["booking_cancelled_by_driver"]), 1);

    const second = await paidBooking(pool, app, world, { passenger: world.lucia });
    await startTrip(pool, second.tripId);
    const started = await cancel(world.ana, second.bookingId, { reason: "other" }, newKey(), "driver-cancel");
    assert.equal(started.response.statusCode, 409);
    assert.equal(started.json.error.code, "TRIP_ALREADY_STARTED");
  });

  it("motivos propios del conductor: los del pasajero no valen (400)", async () => {
    const booking = await paidBooking(pool, app, world);
    const wrong = await cancel(world.ana, booking.bookingId, { reason: "no_longer_needed" }, newKey(), "driver-cancel");
    assert.equal(wrong.response.statusCode, 400);
    const wrongForPassenger = await cancel(world.miguel, booking.bookingId, { reason: "vehicle_issue" });
    assert.equal(wrongForPassenger.response.statusCode, 400);
  });
});

/* ═════════════════════════ Consecuencias creadas por otros módulos ═════════════════════════ */

describe("consecuencias de cancelaciones y no-show hechos por otros módulos", () => {
  async function adminList(query = "") {
    const response = await app.inject({ method: "GET", url: `/v1/admin/refund-proposals?period=all${query}`, headers: bearer(world.finance) });
    return { response, json: response.json() as Record<string, any> };
  }

  it("el panel materializa, de forma idempotente, un registro en revisión por reserva y origen (sin importe propuesto)", async () => {
    const a = await paidBooking(pool, app, world, { passenger: world.miguel });
    const b = await paidBooking(pool, app, world, { passenger: world.lucia });
    const c = await paidBooking(pool, app, world, { passenger: world.miguel });
    await pool.query(`update bookings set status='cancelled' where id=$1`, [a.bookingId]);
    await pool.query(`update bookings set status='driver_cancelled' where id=$1`, [b.bookingId]);
    await pool.query(`update bookings set status='no_show' where id=$1`, [c.bookingId]);

    const first = await adminList();
    assert.equal(first.response.statusCode, 200);
    assert.equal(first.json.items.length, 3);
    const byBooking = Object.fromEntries(first.json.items.map((i: { bookingId: string }) => [i.bookingId, i]));
    assert.equal(byBooking[a.bookingId].origin, "passenger_cancellation");
    assert.equal(byBooking[b.bookingId].origin, "driver_cancellation");
    assert.equal(byBooking[c.bookingId].origin, "no_show");
    for (const item of first.json.items) {
      assert.equal(item.status, "pending_review");
      assert.equal(item.proposedRefund.status, "pending_definition");
      assert.equal(item.paid.cents, 1100);
      assert.equal(item.policy.status, "pending_review");
    }
    assert.deepEqual(first.json.counts, { all: 3, cancelled: 3, refunded: 0 });

    const second = await adminList();
    assert.equal(second.json.items.length, 3);
    assert.equal(await count("refund_requests"), 3, "consultar de nuevo no duplica registros");
  });

  it("una reserva cancelada sin importe pagado queda «not_applicable» y no sale en Mis devoluciones", async () => {
    const tariff = await ensureTariff(pool);
    const trip = await seedTrip(pool, world);
    const { requestId } = await seedPayableRequest(pool, trip, world.miguel, { tariffId: tariff });
    const bookingId = await scalar<string>(
      pool,
      `insert into bookings(request_id,provider_payment_id,amount_cents,status) values($1,'legacy-free-2',0,'cancelled') returning id`,
      [requestId]
    );
    const { json } = await adminList();
    const item = json.items.find((i: { bookingId: string }) => i.bookingId === bookingId);
    assert.equal(item.status, "not_applicable");
    const mine = await app.inject({ method: "GET", url: "/v1/me/refunds", headers: bearer(world.miguel) });
    assert.deepEqual(mine.json().items, []);
  });

  it("lo cancelado por la vía de este módulo no se duplica al materializar", async () => {
    const booking = await paidBooking(pool, app, world);
    await cancel(world.miguel, booking.bookingId, { reason: "other" });
    const { json } = await adminList();
    assert.equal(json.items.length, 1);
    assert.equal(await count("refund_requests"), 1);
  });
});

// Se importa para mantener la tarifa de pruebas disponible a quien amplíe este fichero.
void approveTariff;
