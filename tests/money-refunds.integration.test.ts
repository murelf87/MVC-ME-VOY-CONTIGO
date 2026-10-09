/**
 * Módulo money · devoluciones: panel de finanzas (pantallas 39a/39b), matriz RBAC, aprobar / rechazar / ejecutar,
 * eventos firmados de devolución, límites (nunca devolver más de lo cobrado), concurrencia y asientos contables.
 *
 * Importes y reglas de política: fixtures de prueba (no son tarifas ni la política de MVC).
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { DisabledPaymentProvider } from "../src/modules/money/provider/disabled.js";
import {
  bearer,
  buildTestApp,
  createIntent,
  createTestPool,
  ensureTariff,
  insertApprovedPolicy,
  newKey,
  nextEventId,
  paidBooking,
  postWebhook,
  resetMoneyData,
  scalar,
  seedPayableRequest,
  seedTrip,
  seedWorld,
  StubPaymentProvider,
  succeededEvent,
  type Actor,
  type PaidBooking,
  type StubWebhookEvent,
  type World
} from "./money-support.js";

const pool = createTestPool();
let world: World;
let stub: StubPaymentProvider;
let stubApp: FastifyInstance;
let disabledApp: FastifyInstance;

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
  stubApp = await buildTestApp(pool, stub);
  disabledApp = await buildTestApp(pool, new DisabledPaymentProvider());
});
afterEach(async () => {
  await stubApp.close();
  await disabledApp.close();
});

async function count(table: string, where = "true", params: unknown[] = []): Promise<number> {
  return Number(await scalar<string>(pool, `select count(*)::text from ${table} where ${where}`, params));
}

async function ledgerImbalance(): Promise<number> {
  return Number(
    await scalar<string>(
      pool,
      `select coalesce(sum(abs(s)),0)::text from (select sum(amount_cents) s from ledger_entries group by transaction_id) t`
    )
  );
}

async function accountNet(account: string): Promise<number> {
  return Number(await scalar<string>(pool, `select coalesce(sum(amount_cents),0)::text from ledger_entries where account=$1`, [account]));
}

async function call(
  app: FastifyInstance,
  actor: Actor | null,
  method: "GET" | "POST" | "DELETE",
  url: string,
  payload?: Record<string, unknown>,
  key: string | null = method === "POST" ? newKey() : null
) {
  const headers: Record<string, string> = {};
  if (actor) Object.assign(headers, bearer(actor));
  if (key) headers["idempotency-key"] = key;
  const response = await app.inject({ method, url, headers, ...(payload !== undefined ? { payload } : {}) });
  return { response, json: response.json() as Record<string, any>, key };
}

type Pending = { booking: PaidBooking; refundId: string };

/** Reserva pagada y cancelada por el pasajero → propuesta `pending_review`. */
async function pendingRefund(passenger: Actor = world.miguel, options: { departureInterval?: string } = {}): Promise<Pending> {
  const booking = await paidBooking(pool, stubApp, world, {
    passenger,
    ...(options.departureInterval ? { departureInterval: options.departureInterval } : {})
  });
  const cancelled = await call(stubApp, passenger, "POST", `/v1/bookings/${booking.bookingId}/cancel`, { reason: "schedule_change" });
  assert.equal(cancelled.response.statusCode, 200, cancelled.response.body);
  return { booking, refundId: cancelled.json.refund.id as string };
}

const approve = (app: FastifyInstance, actor: Actor | null, refundId: string, body: Record<string, unknown> = {}, key?: string) =>
  call(app, actor, "POST", `/v1/admin/refund-proposals/${refundId}/approve`, body, key ?? newKey());

const reject = (app: FastifyInstance, actor: Actor | null, refundId: string, body: Record<string, unknown>, key?: string) =>
  call(app, actor, "POST", `/v1/admin/refund-proposals/${refundId}/reject`, body, key ?? newKey());

const execute = (app: FastifyInstance, actor: Actor | null, refundId: string, key?: string) =>
  call(app, actor, "POST", `/v1/admin/refund-proposals/${refundId}/execute`, undefined, key ?? newKey());

async function refundRef(refundId: string): Promise<string> {
  return scalar<string>(pool, `select provider_refund_ref from refund_requests where id=$1`, [refundId]);
}

function refundEvent(
  type: "succeeded" | "failed",
  ref: string,
  paymentRef: string,
  amountCents: number,
  extra: Partial<StubWebhookEvent> = {}
): StubWebhookEvent {
  return { id: nextEventId("evt_re"), object: "refund", type, ref, paymentRef, amountCents, ...extra };
}

/* ═════════════════════════ Matriz RBAC del panel de finanzas ═════════════════════════ */

describe("RBAC del panel «Reservas y devoluciones» y «Liquidaciones»", () => {
  type Probe = { name: string; run: (app: FastifyInstance, actor: Actor | null, ids: { refundId: string; payoutId: string }) => ReturnType<typeof call> };
  const probes: Probe[] = [
    { name: "GET lista de devoluciones", run: (app, actor) => call(app, actor, "GET", "/v1/admin/refund-proposals") },
    { name: "GET detalle de devolución", run: (app, actor, ids) => call(app, actor, "GET", `/v1/admin/refund-proposals/${ids.refundId}`) },
    { name: "POST aprobar", run: (app, actor, ids) => approve(app, actor, ids.refundId, { approvedCents: 300, note: "RBAC" }) },
    { name: "POST rechazar", run: (app, actor, ids) => reject(app, actor, ids.refundId, { note: "RBAC" }) },
    { name: "POST ejecutar", run: (app, actor, ids) => execute(app, actor, ids.refundId) },
    { name: "GET liquidaciones", run: (app, actor) => call(app, actor, "GET", "/v1/admin/payout-runs") },
    { name: "POST generar liquidaciones", run: (app, actor) => call(app, actor, "POST", "/v1/admin/payout-runs", { period: "2026-07" }) },
    { name: "POST ejecutar liquidación", run: (app, actor, ids) => call(app, actor, "POST", `/v1/admin/payout-runs/${ids.payoutId}/execute`) }
  ];
  const FAKE_PAYOUT = "00000000-0000-4000-8000-0000000000aa";

  it("sin sesión → 401 AUTH_REQUIRED y token inválido → 401, en TODOS los endpoints, sin efectos", async () => {
    const { refundId } = await pendingRefund();
    for (const probe of probes) {
      const anon = await probe.run(stubApp, null, { refundId, payoutId: FAKE_PAYOUT });
      assert.equal(anon.response.statusCode, 401, probe.name);
      assert.equal(anon.json.error.code, "AUTH_REQUIRED", probe.name);
      const bogus = await probe.run(stubApp, { id: world.admin.id, token: "mvc_sess_no_existe", name: "x" }, { refundId, payoutId: FAKE_PAYOUT });
      assert.equal(bogus.response.statusCode, 401, probe.name);
    }
    assert.equal(await scalar<string>(pool, `select status from refund_requests where id=$1`, [refundId]), "pending_review");
    assert.equal(await count("audit_events", "action=$1", ["admin.access_denied"]), 0, "sin sesión no hay actor que auditar");
  });

  it("pasajero, conductor, soporte y verificación → 403 AUTH_FORBIDDEN en TODOS los endpoints; nada cambia y cada intento queda auditado", async () => {
    const { refundId } = await pendingRefund();
    const ledgerBefore = await count("ledger_transactions");
    const denied: Actor[] = [world.miguel, world.ana, world.support, world.verification];
    for (const actor of denied) {
      for (const probe of probes) {
        const result = await probe.run(stubApp, actor, { refundId, payoutId: FAKE_PAYOUT });
        assert.equal(result.response.statusCode, 403, `${actor.name} · ${probe.name}: ${result.response.body}`);
        assert.equal(result.json.error.code, "AUTH_FORBIDDEN", `${actor.name} · ${probe.name}`);
      }
    }
    assert.equal(await scalar<string>(pool, `select status from refund_requests where id=$1`, [refundId]), "pending_review");
    assert.equal(await count("ledger_transactions"), ledgerBefore);
    assert.equal(await count("payout_runs"), 0);
    assert.equal(stub.calls.refundPayment, 0);
    assert.equal(await count("audit_events", "action=$1", ["admin.access_denied"]), denied.length * probes.length);
    assert.equal(await count("audit_events", "action=$1", ["refund.approved"]), 0);
    // La denegación no deja claves de idempotencia ni avisos al pasajero
    assert.equal(await count("idempotency_keys", "scope like 'refund_%' or scope like 'payout_%'"), 0, "una denegación no guarda claves de idempotencia");
    assert.equal(await count("notifications", "kind in ('refund_approved','refund_rejected')"), 0);
  });

  it("finance_admin y admin SÍ pasan la guardia (ningún 401/403) en todos los endpoints", async () => {
    for (const actor of [world.finance, world.admin]) {
      const { refundId } = await pendingRefund(actor === world.finance ? world.miguel : world.lucia);
      for (const probe of probes) {
        const result = await probe.run(stubApp, actor, { refundId, payoutId: FAKE_PAYOUT });
        assert.ok(![401, 403].includes(result.response.statusCode), `${actor.name} · ${probe.name}: ${result.response.statusCode} ${result.response.body}`);
        assert.ok(result.response.statusCode < 500, `${actor.name} · ${probe.name}: ${result.response.statusCode} ${result.response.body}`);
      }
    }
  });

  it("un usuario con VARIOS roles (conductor + finanzas) tiene acceso; con roles desconocidos o vacíos no", async () => {
    const hybrid = world.ana;
    await pool.query(`insert into user_roles(user_id,role) values($1,'finance_admin')`, [hybrid.id]);
    const ok = await call(stubApp, hybrid, "GET", "/v1/admin/refund-proposals");
    assert.equal(ok.response.statusCode, 200);
    await pool.query(`delete from user_roles where user_id=$1 and role='finance_admin'`, [hybrid.id]);
    const revoked = await call(stubApp, hybrid, "GET", "/v1/admin/refund-proposals");
    assert.equal(revoked.response.statusCode, 403, "revocar el rol surte efecto de inmediato");
    await pool.query(`delete from user_roles where user_id=$1`, [world.miguel.id]);
    const roleless = await call(stubApp, world.miguel, "GET", "/v1/admin/refund-proposals");
    assert.equal(roleless.response.statusCode, 403);
  });

  it("una cuenta suspendida no accede aunque conserve el rol", async () => {
    await pool.query(`update app_users set status='suspended' where id=$1`, [world.finance.id]);
    const result = await call(stubApp, world.finance, "GET", "/v1/admin/refund-proposals");
    assert.equal(result.response.statusCode, 403);
    assert.equal(result.json.error.code, "ACCOUNT_NOT_ACTIVE");
  });
});

/* ═════════════════════════ Aprobar, rechazar, ejecutar ═════════════════════════ */

describe("aprobar una devolución con el proveedor DESACTIVADO", () => {
  it("valida el importe y la nota antes de tocar nada", async () => {
    const { refundId } = await pendingRefund();
    const noAmount = await approve(disabledApp, world.finance, refundId, {});
    assert.equal(noAmount.response.statusCode, 400);
    assert.equal(noAmount.json.error.code, "REFUND_AMOUNT_REQUIRED");

    const tooMuch = await approve(disabledApp, world.finance, refundId, { approvedCents: 1101, note: "x" });
    assert.equal(tooMuch.response.statusCode, 400);
    assert.equal(tooMuch.json.error.code, "REFUND_AMOUNT_EXCEEDS_PAID");
    assert.equal(tooMuch.json.error.details.maxRefundableCents, 1100);

    for (const bad of [0, -5, 10.5, 100_000_01, "abc", null]) {
      const invalid = await approve(disabledApp, world.finance, refundId, { approvedCents: bad, note: "x" });
      assert.equal(invalid.response.statusCode, 400, String(bad));
    }

    const noNote = await approve(disabledApp, world.finance, refundId, { approvedCents: 500 });
    assert.equal(noNote.response.statusCode, 400);
    assert.equal(noNote.json.error.code, "REFUND_NOTE_REQUIRED");
    const blankNote = await approve(disabledApp, world.finance, refundId, { approvedCents: 500, note: "   " });
    assert.equal(blankNote.json.error.code, "REFUND_NOTE_REQUIRED");

    assert.equal(await scalar<string>(pool, `select status from refund_requests where id=$1`, [refundId]), "pending_review");
    assert.equal(await count("ledger_transactions", "kind=$1", ["refund_approved"]), 0);
  });

  it("aprobada: queda «approved» + «awaiting_provider», con asiento contable, auditoría y aviso; NUNCA «refunded»", async () => {
    const { booking, refundId } = await pendingRefund();
    const { response, json } = await approve(disabledApp, world.finance, refundId, { approvedCents: 500, note: "Acuerdo con soporte" });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(json.status, "approved");
    assert.equal(json.executionStatus, "awaiting_provider");
    assert.equal(json.approvedRefund.cents, 500);
    assert.equal(json.finalPassengerCost.cents, 600);
    assert.equal(json.refundedAt, null, "no se afirma devolución sin evento firmado del proveedor");
    assert.equal(json.decision.by.id, world.finance.id);
    assert.equal(json.decision.note, "Acuerdo con soporte");
    assert.equal(json.decision.basis, "manual_without_policy");
    assert.ok(json.decidedAt);

    // Pago intacto: nada se ha devuelto de verdad
    const payment = (await pool.query(`select status::text, refunded_cents from payments where id=$1`, [booking.paymentId])).rows[0];
    assert.deepEqual(payment, { status: "succeeded", refunded_cents: 0 });
    assert.equal(await count("receipts", "kind=$1", ["refund"]), 0, "sin devolución ejecutada no hay justificante de devolución");

    // Libro mayor (reparto proporcional provisional): suma cero y deuda con el pasajero = importe aprobado
    assert.equal(await ledgerImbalance(), 0);
    assert.equal(await accountNet("refund_payable"), 500);
    assert.equal(await accountNet("driver_payable"), 950 - 432);
    assert.equal(await accountNet("platform_revenue"), 150 - 68);
    assert.equal(await accountNet("passenger"), -1100);

    // Auditoría y aviso (la nota es interna pero sí queda en el registro de la decisión)
    const audit = await pool.query(`select actor_user_id, metadata from audit_events where action='refund.approved'`);
    assert.equal(audit.rowCount, 1);
    assert.equal(audit.rows[0].actor_user_id, world.finance.id);
    assert.equal(audit.rows[0].metadata.approvedCents, 500);
    const notice = await pool.query(`select body from notifications where user_id=$1 and kind='refund_approved'`, [world.miguel.id]);
    assert.equal(notice.rowCount, 1);
    assert.match(notice.rows[0].body, /5,00/);

    // El pasajero la ve aprobada pero NO devuelta
    const mine = await call(disabledApp, world.miguel, "GET", "/v1/me/refunds");
    assert.equal(mine.json.items[0].status, "approved");
    assert.equal(mine.json.items[0].executionStatus, "awaiting_provider");
    assert.equal(mine.json.items[0].refundedAt, null);
    const payments = await call(disabledApp, world.miguel, "GET", "/v1/me/payments");
    assert.equal(payments.json.items[0].state, "under_review");
  });

  it("es idempotente (misma clave → misma respuesta) y no se puede decidir dos veces", async () => {
    const { refundId } = await pendingRefund();
    const key = newKey();
    const first = await approve(disabledApp, world.finance, refundId, { approvedCents: 400, note: "ok" }, key);
    const replay = await approve(disabledApp, world.finance, refundId, { approvedCents: 400, note: "ok" }, key);
    assert.equal(first.response.statusCode, 200);
    assert.equal(replay.response.headers["idempotency-replayed"], "true");
    assert.deepEqual(replay.json, first.json);
    const other = await approve(disabledApp, world.admin, refundId, { approvedCents: 400, note: "ok" });
    assert.equal(other.response.statusCode, 409);
    assert.equal(other.json.error.code, "REFUND_NOT_PENDING");
    const rejected = await reject(disabledApp, world.finance, refundId, { note: "tarde" });
    assert.equal(rejected.response.statusCode, 409);
    assert.equal(rejected.json.error.code, "REFUND_NOT_PENDING");
    const reused = await approve(disabledApp, world.finance, refundId, { approvedCents: 300, note: "ok" }, key);
    assert.equal(reused.response.statusCode, 422);
    assert.equal(reused.json.error.code, "IDEMPOTENCY_KEY_REUSED");
    assert.equal(await count("ledger_transactions", "kind=$1", ["refund_approved"]), 1);
    assert.equal(await count("audit_events", "action=$1", ["refund.approved"]), 1);
  });

  it("«ejecutar» con el proveedor desactivado → 409 PAYMENTS_PROVIDER_DISABLED; en otro estado → 409 REFUND_NOT_EXECUTABLE", async () => {
    const { refundId } = await pendingRefund();
    const premature = await execute(disabledApp, world.finance, refundId);
    assert.equal(premature.response.statusCode, 409);
    assert.equal(premature.json.error.code, "REFUND_NOT_EXECUTABLE");
    await approve(disabledApp, world.finance, refundId, { approvedCents: 500, note: "ok" });
    const blocked = await execute(disabledApp, world.finance, refundId);
    assert.equal(blocked.response.statusCode, 409);
    assert.equal(blocked.json.error.code, "PAYMENTS_PROVIDER_DISABLED");
    assert.equal(await scalar<string>(pool, `select status from refund_requests where id=$1`, [refundId]), "approved");
    assert.equal(await scalar<string>(pool, `select execution_status from refund_requests where id=$1`, [refundId]), "awaiting_provider");
    assert.equal(stub.calls.refundPayment, 0);
  });

  it("detalle: pago, máximo devolvible y asientos del libro mayor", async () => {
    const { booking, refundId } = await pendingRefund();
    await approve(disabledApp, world.finance, refundId, { approvedCents: 500, note: "ok" });
    const detail = await call(disabledApp, world.finance, "GET", `/v1/admin/refund-proposals/${refundId}`);
    assert.equal(detail.response.statusCode, 200);
    assert.equal(detail.json.id, refundId);
    assert.equal(detail.json.payment.id, booking.paymentId);
    assert.equal(detail.json.payment.status, "succeeded");
    assert.equal(detail.json.maxRefundable.cents, 1100, "el máximo excluye esta misma propuesta");
    const kinds = new Set(detail.json.ledger.map((l: { transactionKind: string }) => l.transactionKind));
    assert.deepEqual([...kinds].sort(), ["charge", "refund_approved"]);
    assert.equal(detail.json.ledger.reduce((a: number, l: { amountCents: number }) => a + l.amountCents, 0), 0);
    assert.equal(detail.json.passenger.id, world.miguel.id);
    assert.equal(detail.json.driver.id, world.ana.id);
    const missing = await call(disabledApp, world.finance, "GET", "/v1/admin/refund-proposals/00000000-0000-4000-8000-000000000000");
    assert.equal(missing.response.statusCode, 404);
    assert.equal(missing.json.error.code, "REFUND_NOT_FOUND");
    const malformed = await call(disabledApp, world.finance, "GET", "/v1/admin/refund-proposals/no-uuid");
    assert.equal(malformed.response.statusCode, 400);
  });

  it("aprobar sin cuerpo (sin content-type) se trata como cuerpo vacío cuando la propuesta ya trae importe", async () => {
    await insertApprovedPolicy(pool, world.admin);
    const { refundId } = await pendingRefund();
    const response = await disabledApp.inject({
      method: "POST",
      url: `/v1/admin/refund-proposals/${refundId}/approve`,
      headers: { ...bearer(world.finance), "idempotency-key": newKey() }
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().status, "approved");
    assert.equal(response.json().approvedRefund.cents, 1100);
  });
});

describe("aprobar con una política aplicable (fixture)", () => {
  it("importe de la política sin cambios → sin nota, base «policy»", async () => {
    await insertApprovedPolicy(pool, world.admin);
    const { refundId } = await pendingRefund(); // sale en 72 h → 1100
    const { response, json } = await approve(disabledApp, world.finance, refundId, {});
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(json.approvedRefund.cents, 1100);
    assert.equal(json.decision.basis, "policy");
    assert.equal(json.decision.note, null);
  });

  it("cambiar el importe propuesto exige nota y queda como «manual_override»", async () => {
    await insertApprovedPolicy(pool, world.admin);
    const { refundId } = await pendingRefund();
    const noNote = await approve(disabledApp, world.finance, refundId, { approvedCents: 900 });
    assert.equal(noNote.response.statusCode, 400);
    assert.equal(noNote.json.error.code, "REFUND_NOTE_REQUIRED");
    const withNote = await approve(disabledApp, world.finance, refundId, { approvedCents: 900, note: "Gesto comercial acordado" });
    assert.equal(withNote.response.statusCode, 200);
    assert.equal(withNote.json.decision.basis, "manual_override");
  });
});

describe("rechazar una devolución", () => {
  it("exige motivo; no cambia el libro mayor; el aviso al pasajero no incluye la nota interna", async () => {
    const { booking, refundId } = await pendingRefund();
    const missing = await reject(disabledApp, world.finance, refundId, {});
    assert.equal(missing.response.statusCode, 400);
    const empty = await reject(disabledApp, world.finance, refundId, { note: "" });
    assert.equal(empty.response.statusCode, 400);
    const blank = await reject(disabledApp, world.finance, refundId, { note: "    " });
    assert.equal(blank.response.statusCode, 400);
    assert.equal(blank.json.error.code, "REFUND_NOTE_REQUIRED");

    const ledgerBefore = await count("ledger_transactions");
    const secret = "NOTA-INTERNA-CONFIDENCIAL";
    const key = newKey();
    const done = await reject(disabledApp, world.finance, refundId, { note: secret }, key);
    assert.equal(done.response.statusCode, 200);
    assert.equal(done.json.status, "rejected");
    assert.equal(done.json.decision.note, secret);
    assert.equal(done.json.finalPassengerCost.cents, 1100);
    assert.equal(await count("ledger_transactions"), ledgerBefore);
    assert.equal(await scalar<string>(pool, `select status::text from payments where id=$1`, [booking.paymentId]), "succeeded");
    const notice = await pool.query(`select title, body, data from notifications where user_id=$1 and kind='refund_rejected'`, [world.miguel.id]);
    assert.equal(notice.rowCount, 1);
    assert.ok(!JSON.stringify(notice.rows[0]).includes(secret), "la nota interna no se envía al pasajero");
    assert.equal(await count("audit_events", "action=$1", ["refund.rejected"]), 1);

    const replay = await reject(disabledApp, world.finance, refundId, { note: secret }, key);
    assert.equal(replay.response.headers["idempotency-replayed"], "true");
    const again = await reject(disabledApp, world.admin, refundId, { note: "otra" });
    assert.equal(again.response.statusCode, 409);
    assert.equal(again.json.error.code, "REFUND_NOT_PENDING");
    const approveAfter = await approve(disabledApp, world.finance, refundId, { approvedCents: 100, note: "x" });
    assert.equal(approveAfter.response.statusCode, 409);
    const mine = await call(disabledApp, world.miguel, "GET", "/v1/me/refunds");
    assert.equal(mine.json.items[0].status, "rejected");
  });

  it("propuesta inexistente → 404", async () => {
    const result = await reject(disabledApp, world.finance, "00000000-0000-4000-8000-000000000000", { note: "x" });
    assert.equal(result.response.statusCode, 404);
    assert.equal(result.json.error.code, "REFUND_NOT_FOUND");
  });
});

describe("pago tardío: devolución íntegra propuesta", () => {
  it("se puede aprobar el importe íntegro sin nota (base «late_payment_full_refund») y la cuenta de suspenso se salda", async () => {
    // Pago cuya reserva provisional caducó antes de llegar el cobro
    const tariff = await ensureTariff(pool);
    const trip = await seedTrip(pool, world);
    const seeded = await seedPayableRequest(pool, trip, world.miguel, { tariffId: tariff });
    const { json } = await createIntent(stubApp, world.miguel, seeded.requestId);
    const paymentId = json.payment.id as string;
    const ref = await scalar<string>(pool, `select provider_payment_ref from payments where id=$1`, [paymentId]);
    await pool.query(`update seat_holds set expires_at = now() - interval '1 minute' where id=$1`, [seeded.holdId]);
    await postWebhook(stubApp, [succeededEvent(ref, 1100)]);
    const refundId = await scalar<string>(pool, `select id from refund_requests where payment_id=$1`, [paymentId]);

    const { response, json: item } = await approve(disabledApp, world.finance, refundId, {});
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(item.origin, "late_payment");
    assert.equal(item.approvedRefund.cents, 1100);
    assert.equal(item.decision.basis, "late_payment_full_refund");
    assert.equal(await ledgerImbalance(), 0);
    const suspense = Number(
      await scalar<string>(
        pool,
        `select coalesce(sum(e.amount_cents),0)::text from ledger_entries e join ledger_transactions t on t.id=e.transaction_id
          where e.account='suspense' and t.payment_id=$1`,
        [paymentId]
      )
    );
    assert.equal(suspense, 0, "el dinero en suspenso de este pago queda saldado (pasa a deuda con el pasajero)");
    assert.equal(await accountNet("refund_payable"), 1100);
  });

  it("con un importe distinto del íntegro SÍ hace falta nota", async () => {
    const tariff = await ensureTariff(pool);
    const trip = await seedTrip(pool, world);
    const seeded = await seedPayableRequest(pool, trip, world.miguel, { tariffId: tariff });
    const { json } = await createIntent(stubApp, world.miguel, seeded.requestId);
    const ref = await scalar<string>(pool, `select provider_payment_ref from payments where id=$1`, [json.payment.id]);
    await pool.query(`update seat_holds set expires_at = now() - interval '1 minute' where id=$1`, [seeded.holdId]);
    await postWebhook(stubApp, [succeededEvent(ref, 1100)]);
    const refundId = await scalar<string>(pool, `select id from refund_requests where payment_id=$1`, [json.payment.id]);
    const partial = await approve(disabledApp, world.finance, refundId, { approvedCents: 800 });
    assert.equal(partial.response.statusCode, 400);
    assert.equal(partial.json.error.code, "REFUND_NOTE_REQUIRED");
  });
});

/* ═════════════════════════ Con proveedor activo y eventos firmados ═════════════════════════ */

describe("devolución con un proveedor activo", () => {
  it("aprobar la envía al proveedor con clave derivada → «executing»; solo el evento firmado la marca «refunded»", async () => {
    const { booking, refundId } = await pendingRefund();
    const { response, json } = await approve(stubApp, world.finance, refundId, { approvedCents: 500, note: "ok" });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(json.status, "executing");
    assert.equal(json.executionStatus, "submitted");
    assert.equal(json.refundedAt, null);
    assert.equal(stub.calls.refundPayment, 1);
    const sent = [...stub.refunds.values()][0]!.input;
    assert.equal(sent.amountCents, 500);
    assert.equal(sent.providerPaymentRef, booking.providerRef);
    assert.equal(sent.metadata.refundRequestId, refundId);
    assert.match(sent.idempotencyKey, /^mvc-refund-[0-9a-f]{40}$/);
    // Todavía NO devuelto
    assert.equal(await scalar<string>(pool, `select refunded_cents::text from payments where id=$1`, [booking.paymentId]), "0");
    assert.equal(await count("receipts", "kind=$1", ["refund"]), 0);

    const ref = await refundRef(refundId);
    const event = refundEvent("succeeded", ref, booking.providerRef, 500);
    const hook = await postWebhook(stubApp, [event]);
    assert.equal(hook.statusCode, 200);
    assert.equal(hook.json().results[0].result, "applied");

    const mine = await call(stubApp, world.miguel, "GET", "/v1/me/refunds");
    assert.equal(mine.json.items[0].status, "refunded");
    assert.equal(mine.json.items[0].executionStatus, "succeeded");
    assert.ok(mine.json.items[0].refundedAt);
    const payment = (await pool.query(`select status::text, refunded_cents from payments where id=$1`, [booking.paymentId])).rows[0];
    assert.deepEqual(payment, { status: "succeeded", refunded_cents: 500 }, "devolución parcial: el pago sigue «succeeded»");
    // Asientos: la deuda con el pasajero se salda y su cuenta queda en −(pagado − devuelto)
    assert.equal(await ledgerImbalance(), 0);
    assert.equal(await accountNet("refund_payable"), 0);
    assert.equal(await accountNet("passenger"), -600);
    // Justificante de devolución, aviso y auditoría
    const receipt = await pool.query(`select kind::text, user_id, total_cents::text, number from receipts where kind='refund'`);
    assert.equal(receipt.rowCount, 1);
    assert.equal(receipt.rows[0].user_id, world.miguel.id);
    assert.equal(receipt.rows[0].total_cents, "500");
    assert.match(receipt.rows[0].number, /^MVC-J-\d{4}-\d{6}$/);
    assert.equal(await count("notifications", "user_id=$1 and kind=$2", [world.miguel.id, "refund_completed"]), 1);
    assert.equal(await count("audit_events", "action=$1", ["refund.succeeded"]), 1);
    // Contadores del panel
    const list = await call(stubApp, world.finance, "GET", "/v1/admin/refund-proposals?period=all");
    assert.deepEqual(list.json.counts, { all: 1, cancelled: 0, refunded: 1 });
  });

  it("eventos duplicados, repetidos o contradictorios no repiten efectos", async () => {
    const { booking, refundId } = await pendingRefund();
    await approve(stubApp, world.finance, refundId, { approvedCents: 500, note: "ok" });
    const ref = await refundRef(refundId);

    // Importe distinto al aprobado → conflicto, no se aplica
    const wrongAmount = await postWebhook(stubApp, [refundEvent("succeeded", ref, booking.providerRef, 400)]);
    assert.deepEqual([wrongAmount.json().results[0].result, wrongAmount.json().results[0].reason], ["ignored", "conflict"]);
    // Referencia de pago distinta → conflicto
    const wrongPayment = await postWebhook(stubApp, [refundEvent("succeeded", ref, "pi_otro_pago", 500)]);
    assert.deepEqual([wrongPayment.json().results[0].result, wrongPayment.json().results[0].reason], ["ignored", "conflict"]);
    assert.equal(await scalar<string>(pool, `select status from refund_requests where id=$1`, [refundId]), "executing");

    const good = refundEvent("succeeded", ref, booking.providerRef, 500);
    const [a, b] = await Promise.all([postWebhook(stubApp, [good]), postWebhook(stubApp, [good])]);
    const results = [a.json().results[0].result, b.json().results[0].result].sort();
    assert.deepEqual(results, ["applied", "duplicate"]);
    const repeat = await postWebhook(stubApp, [refundEvent("succeeded", ref, booking.providerRef, 500)]);
    assert.deepEqual([repeat.json().results[0].result, repeat.json().results[0].reason], ["ignored", "stale"]);
    // Un `failed` tardío no deshace una devolución ya ejecutada
    const lateFail = await postWebhook(stubApp, [refundEvent("failed", ref, booking.providerRef, 500, { failureCode: "late" })]);
    assert.equal(lateFail.json().results[0].result, "ignored");
    assert.equal(await scalar<string>(pool, `select status from refund_requests where id=$1`, [refundId]), "refunded");
    assert.equal(await scalar<string>(pool, `select refunded_cents::text from payments where id=$1`, [booking.paymentId]), "500");
    assert.equal(await count("ledger_transactions", "kind=$1", ["refund_executed"]), 1);
    assert.equal(await count("receipts", "kind=$1", ["refund"]), 1);
    assert.equal(await ledgerImbalance(), 0);
  });

  it("devolución desconocida o sin aprobar → 409 PAYMENT_UNKNOWN / ignorada", async () => {
    const { booking, refundId } = await pendingRefund();
    const unknown = await postWebhook(stubApp, [refundEvent("succeeded", "re_no_existe", booking.providerRef, 500)]);
    assert.equal(unknown.statusCode, 409);
    assert.equal(unknown.json().error.code, "PAYMENT_UNKNOWN");
    assert.equal(await count("payment_events", "object_kind=$1", ["refund"]), 0);
    // Una propuesta sin aprobar no tiene referencia del proveedor: ningún evento puede resolverla
    assert.equal(await refundRef(refundId).catch(() => null), null);
  });

  it("devolución íntegra: el pago pasa a «refunded» y no queda nada por devolver", async () => {
    const { booking, refundId } = await pendingRefund();
    await approve(stubApp, world.finance, refundId, { approvedCents: 1100, note: "ok" });
    const ref = await refundRef(refundId);
    await postWebhook(stubApp, [refundEvent("succeeded", ref, booking.providerRef, 1100)]);
    const payment = (await pool.query(`select status::text, outcome::text, refunded_cents from payments where id=$1`, [booking.paymentId])).rows[0];
    assert.deepEqual(payment, { status: "refunded", outcome: "refunded", refunded_cents: 1100 });
    const view = await call(stubApp, world.miguel, "GET", `/v1/payments/${booking.paymentId}`);
    assert.equal(view.json.status, "refunded");
    assert.equal(view.json.refunded.cents, 1100);
    const payments = await call(stubApp, world.miguel, "GET", "/v1/me/payments");
    assert.equal(payments.json.items[0].state, "refunded");
    assert.equal(await accountNet("passenger"), 0);
    assert.equal(await accountNet("refund_payable"), 0);
    assert.equal(await ledgerImbalance(), 0);
    // La suma de todo el libro mayor del pago es 0 y MVC no conserva ingresos de ese viaje
    assert.equal(await accountNet("platform_revenue"), 0);
    assert.equal(await accountNet("driver_payable"), 0);
  });

  it("devolución fallida del proveedor → «failed»; reintentar con «ejecutar» usa otra clave idempotente y puede completarse", async () => {
    const { booking, refundId } = await pendingRefund();
    await approve(stubApp, world.finance, refundId, { approvedCents: 500, note: "ok" });
    const firstRef = await refundRef(refundId);
    const failed = await postWebhook(stubApp, [refundEvent("failed", firstRef, booking.providerRef, 500, { failureCode: "Insufficient Funds" })]);
    assert.equal(failed.json().results[0].result, "applied");
    const row = (await pool.query(`select status, execution_status, failure_code from refund_requests where id=$1`, [refundId])).rows[0];
    assert.equal(row.status, "failed");
    assert.equal(row.execution_status, "failed");
    assert.match(row.failure_code, /^[a-z0-9_.-]+$/);
    // Un `failed` repetido se ignora
    const dup = await postWebhook(stubApp, [refundEvent("failed", firstRef, booking.providerRef, 500)]);
    assert.equal(dup.json().results[0].result, "ignored");

    const retry = await execute(stubApp, world.finance, refundId);
    assert.equal(retry.response.statusCode, 200, retry.response.body);
    assert.equal(retry.json.status, "executing");
    assert.equal(stub.calls.refundPayment, 2);
    const keys = [...stub.refunds.keys()];
    assert.equal(new Set(keys).size, 2, "el reintento tras un fallo es OTRA petición al proveedor");

    const secondRef = await refundRef(refundId);
    assert.notEqual(secondRef, firstRef);
    await postWebhook(stubApp, [refundEvent("succeeded", secondRef, booking.providerRef, 500)]);
    assert.equal(await scalar<string>(pool, `select status from refund_requests where id=$1`, [refundId]), "refunded");
    assert.equal(await ledgerImbalance(), 0);
    // «ejecutar» sobre una devolución ya completada no es posible
    const done = await execute(stubApp, world.finance, refundId);
    assert.equal(done.response.statusCode, 409);
    assert.equal(done.json.error.code, "REFUND_NOT_EXECUTABLE");
  });

  it("si el proveedor falla al aprobar → 502, TODO se revierte y la misma clave se puede reintentar", async () => {
    const { refundId } = await pendingRefund();
    const key = newKey();
    stub.failNext = true;
    const failed = await approve(stubApp, world.finance, refundId, { approvedCents: 500, note: "ok" }, key);
    assert.equal(failed.response.statusCode, 502);
    assert.equal(failed.json.error.code, "PAYMENT_PROVIDER_ERROR");
    assert.equal(await scalar<string>(pool, `select status from refund_requests where id=$1`, [refundId]), "pending_review");
    assert.equal(await count("ledger_transactions", "kind=$1", ["refund_approved"]), 0);
    assert.equal(await count("audit_events", "action=$1", ["refund.approved"]), 0);
    assert.equal(await count("notifications", "kind=$1", ["refund_approved"]), 0);
    const retry = await approve(stubApp, world.finance, refundId, { approvedCents: 500, note: "ok" }, key);
    assert.equal(retry.response.statusCode, 200);
    assert.equal(retry.json.status, "executing");
  });

  it("con el proveedor activo pero un pago de OTRO proveedor, queda «awaiting_provider» (no se envía a quien no cobró)", async () => {
    const { booking, refundId } = await pendingRefund();
    await pool.query(`update payments set provider='otro' where id=$1`, [booking.paymentId]);
    const { response, json } = await approve(stubApp, world.finance, refundId, { approvedCents: 500, note: "ok" });
    assert.equal(response.statusCode, 200);
    assert.equal(json.status, "approved");
    assert.equal(json.executionStatus, "awaiting_provider");
    assert.equal(stub.calls.refundPayment, 0);
    const retry = await execute(stubApp, world.finance, refundId);
    assert.equal(retry.response.statusCode, 409);
    assert.equal(retry.json.error.code, "PAYMENTS_PROVIDER_DISABLED");
  });
});

/* ═════════════════════════ Límites y concurrencia ═════════════════════════ */

describe("nunca se devuelve más de lo cobrado", () => {
  it("dos propuestas sobre el mismo pago aprobadas A LA VEZ: solo cabe una de 700 en 1.100", async () => {
    const { booking, refundId } = await pendingRefund();
    // Segunda propuesta manual sobre el mismo pago (p. ej. una consecuencia distinta de la misma reserva)
    const other = await scalar<string>(
      pool,
      `insert into refund_requests(origin,status,request_id,booking_id,payment_id,trip_id,passenger_user_id,driver_user_id,cancelled_by,paid_cents,policy_status)
       select 'other','pending_review',request_id,booking_id,payment_id,trip_id,passenger_user_id,driver_user_id,'system',paid_cents,'pending_review'
         from refund_requests where id=$1 returning id`,
      [refundId]
    );
    const results = await Promise.all([
      approve(disabledApp, world.finance, refundId, { approvedCents: 700, note: "ok" }),
      approve(disabledApp, world.admin, other, { approvedCents: 700, note: "ok" })
    ]);
    const statuses = results.map(r => r.response.statusCode).sort();
    assert.deepEqual(statuses, [200, 400], results.map(r => r.response.body).join("\n"));
    const loser = results.find(r => r.response.statusCode === 400)!;
    assert.equal(loser.json.error.code, "REFUND_AMOUNT_EXCEEDS_PAID");
    assert.equal(loser.json.error.details.maxRefundableCents, 400);
    assert.equal(await accountNet("refund_payable"), 700);
    assert.equal(await ledgerImbalance(), 0);
    // La segunda sí cabe con lo que queda
    const loserId = results[0]!.response.statusCode === 400 ? refundId : other;
    const rest = await approve(disabledApp, world.finance, loserId, { approvedCents: 400, note: "ok" });
    assert.equal(rest.response.statusCode, 200);
    assert.equal(await accountNet("refund_payable"), 1100);
    assert.equal(await accountNet("platform_revenue"), 0);
    assert.equal(await accountNet("driver_payable"), 0);
    void booking;
  });

  it("aprobaciones simultáneas de la MISMA propuesta con claves distintas: una gana, el resto 409; un solo asiento", async () => {
    const { refundId } = await pendingRefund();
    const results = await Promise.all(Array.from({ length: 5 }, () => approve(disabledApp, world.finance, refundId, { approvedCents: 500, note: "ok" })));
    assert.deepEqual(results.map(r => r.response.statusCode).sort(), [200, 409, 409, 409, 409]);
    assert.equal(await count("ledger_transactions", "kind=$1", ["refund_approved"]), 1);
    assert.equal(await count("audit_events", "action=$1", ["refund.approved"]), 1);
  });

  it("restricción de base de datos: ni el SQL directo puede dejar un pago con más devuelto que cobrado", async () => {
    const { booking } = await pendingRefund();
    await assert.rejects(
      pool.query(`update payments set refunded_cents=1101 where id=$1`, [booking.paymentId]),
      (error: { code?: string }) => error.code === "23514"
    );
    await assert.rejects(
      pool.query(`update payments set status='refunded', refunded_cents=500 where id=$1`, [booking.paymentId]),
      (error: { code?: string }) => error.code === "23514"
    );
  });

  it("un descuadre de importe cobrado limita la devolución a lo REALMENTE cobrado", async () => {
    const tariff = await ensureTariff(pool);
    const trip = await seedTrip(pool, world);
    const seeded = await seedPayableRequest(pool, trip, world.miguel, { tariffId: tariff });
    const { json } = await createIntent(stubApp, world.miguel, seeded.requestId);
    const ref = await scalar<string>(pool, `select provider_payment_ref from payments where id=$1`, [json.payment.id]);
    await postWebhook(stubApp, [succeededEvent(ref, 1000)]); // el proveedor cobró 10,00 € en vez de 11,00 €
    const refundId = await scalar<string>(pool, `select id from refund_requests where payment_id=$1`, [json.payment.id]);
    // Propuesta sin importe (revisión manual): hay que indicarlo
    const missing = await approve(disabledApp, world.finance, refundId, {});
    assert.equal(missing.json.error.code, "REFUND_AMOUNT_REQUIRED");
    const tooMuch = await approve(disabledApp, world.finance, refundId, { approvedCents: 1100, note: "x" });
    assert.equal(tooMuch.json.error.code, "REFUND_AMOUNT_EXCEEDS_PAID");
    assert.equal(tooMuch.json.error.details.maxRefundableCents, 1000);
    const ok = await approve(disabledApp, world.finance, refundId, { approvedCents: 1000, note: "Devolver lo cobrado" });
    assert.equal(ok.response.statusCode, 200);
    assert.equal(await ledgerImbalance(), 0);
  });
});

/* ═════════════════════════ Lista del panel ═════════════════════════ */

describe("lista «Reservas y devoluciones»", () => {
  async function seedMixed() {
    const r1 = await pendingRefund(world.miguel); // pendiente
    const r2 = await pendingRefund(world.lucia); // aprobada (esperando proveedor)
    await approve(disabledApp, world.finance, r2.refundId, { approvedCents: 300, note: "ok" });
    const r3 = await pendingRefund(world.miguel); // devuelta
    await approve(stubApp, world.finance, r3.refundId, { approvedCents: 200, note: "ok" });
    await postWebhook(stubApp, [refundEvent("succeeded", await refundRef(r3.refundId), r3.booking.providerRef, 200)]);
    const r4 = await pendingRefund(world.lucia); // rechazada
    await reject(disabledApp, world.finance, r4.refundId, { note: "no procede" });
    const b5 = await paidBooking(pool, stubApp, world, { passenger: world.miguel });
    const r5 = await call(stubApp, world.ana, "POST", `/v1/bookings/${b5.bookingId}/driver-cancel`, { reason: "emergency" });
    return { r1, r2, r3, r4, r5: r5.json.refund.id as string };
  }

  it("pestañas, contadores y filtros de estado/origen/periodo", async () => {
    const ids = await seedMixed();
    const all = await call(stubApp, world.finance, "GET", "/v1/admin/refund-proposals?period=all");
    assert.equal(all.response.statusCode, 200);
    assert.equal(all.json.items.length, 5);
    assert.deepEqual(all.json.counts, { all: 5, cancelled: 3, refunded: 1 });
    assert.equal(all.json.nextCursor, null);

    const cancelled = await call(stubApp, world.finance, "GET", "/v1/admin/refund-proposals?tab=cancelled&period=all");
    assert.deepEqual(new Set(cancelled.json.items.map((i: { id: string }) => i.id)), new Set([ids.r1.refundId, ids.r2.refundId, ids.r5]));
    const refunded = await call(stubApp, world.finance, "GET", "/v1/admin/refund-proposals?tab=refunded&period=all");
    assert.deepEqual(refunded.json.items.map((i: { id: string }) => i.id), [ids.r3.refundId]);
    // Los contadores no dependen de la pestaña elegida
    assert.deepEqual(refunded.json.counts, all.json.counts);

    const rejected = await call(stubApp, world.finance, "GET", "/v1/admin/refund-proposals?status=rejected&period=all");
    assert.deepEqual(rejected.json.items.map((i: { id: string }) => i.id), [ids.r4.refundId]);
    const byOrigin = await call(stubApp, world.finance, "GET", "/v1/admin/refund-proposals?origin=driver_cancellation&period=all");
    assert.deepEqual(byOrigin.json.items.map((i: { id: string }) => i.id), [ids.r5]);
    const week = await call(stubApp, world.finance, "GET", "/v1/admin/refund-proposals?period=7d");
    assert.equal(week.json.items.length, 5);
    await pool.query(`update refund_requests set created_at = now() - interval '40 days' where id=$1`, [ids.r1.refundId]);
    const thirty = await call(stubApp, world.finance, "GET", "/v1/admin/refund-proposals?period=30d");
    assert.equal(thirty.json.items.length, 4);
    assert.equal(thirty.json.counts.all, 4);
    const default30 = await call(stubApp, world.finance, "GET", "/v1/admin/refund-proposals");
    assert.equal(default30.json.items.length, 4, "el periodo por defecto es 30 días");
  });

  it("filtro por provincia", async () => {
    await seedMixed();
    const se = await call(stubApp, world.finance, "GET", "/v1/admin/refund-proposals?provinceCode=SE&period=all");
    assert.equal(se.json.items.length, 5);
    const lower = await call(stubApp, world.finance, "GET", "/v1/admin/refund-proposals?provinceCode=se&period=all");
    assert.equal(lower.json.items.length, 5);
    const other = await call(stubApp, world.finance, "GET", "/v1/admin/refund-proposals?provinceCode=MA&period=all");
    assert.equal(other.json.items.length, 0);
    assert.deepEqual(other.json.counts, { all: 0, cancelled: 0, refunded: 0 });
  });

  it("paginación por cursor: sin repetidos ni huecos; cursor manipulado → 400", async () => {
    await seedMixed();
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const q: string = `/v1/admin/refund-proposals?period=all&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const page = await call(stubApp, world.finance, "GET", q);
      assert.equal(page.response.statusCode, 200);
      assert.ok(page.json.items.length <= 2);
      seen.push(...page.json.items.map((i: { id: string }) => i.id));
      cursor = page.json.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    assert.equal(pages, 3);
    assert.equal(seen.length, 5);
    assert.equal(new Set(seen).size, 5);
    const bad = await call(stubApp, world.finance, "GET", "/v1/admin/refund-proposals?cursor=esto-no-es-un-cursor");
    assert.equal(bad.response.statusCode, 400);
    assert.equal(bad.json.error.code, "VALIDATION_ERROR");
    for (const query of ["tab=otra", "status=raro", "origin=x", "period=1y", "limit=0", "limit=51", "limit=abc"]) {
      const invalid = await call(stubApp, world.finance, "GET", `/v1/admin/refund-proposals?${query}`);
      assert.equal(invalid.response.statusCode, 400, query);
    }
  });

  it("cada elemento lleva pasajero, conductor, viaje, motivo de cancelación y decisión", async () => {
    const { refundId } = await pendingRefund();
    await approve(disabledApp, world.finance, refundId, { approvedCents: 500, note: "ok" });
    const list = await call(stubApp, world.finance, "GET", "/v1/admin/refund-proposals?period=all");
    const item = list.json.items[0];
    assert.equal(item.passenger.displayName, "Miguel Torres");
    assert.equal(item.driver.displayName, "Ana García López");
    assert.equal(item.trip.originLabel, "Sevilla Centro");
    assert.equal(item.trip.destinationLabel, "Isla Mágica");
    assert.equal(item.cancelledBy, "passenger");
    assert.equal(item.cancelReason, "schedule_change");
    assert.equal(item.decision.by.displayName, "Elena Finanzas");
    assert.equal(item.decision.basis, "manual_without_policy");
    // Nunca datos privados de las personas
    assert.ok(!JSON.stringify(list.json).match(/phone|telefono|teléfono|\+34/i));
  });
});

// `Actor` se importa solo como tipo de los helpers de arriba.
void ({} as Actor | undefined);
