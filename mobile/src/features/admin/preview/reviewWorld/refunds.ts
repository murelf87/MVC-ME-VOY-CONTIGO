/**
 * Panel de finanzas del backend en memoria (SIMULACIÓN): propuestas de devolución (docs/contracts/money.md §8.5 y §10.3).
 *
 *   pending_review ──aprobar──► approved ──(proveedor activo)──► executing ──refund.succeeded──► refunded
 *         │                       │ (proveedor desactivado: executionStatus = awaiting_provider)
 *         └──rechazar──► rejected                                  └─refund.failed─► failed ─(ejecutar)─► executing
 *
 * Reglas que se reproducen tal cual:
 *  - solo `finance_admin` | `admin` (cualquier otro rol: 403 y auditoría de acceso denegado);
 *  - aprobar: la propuesta debe estar pendiente; hace falta un pago registrado; el importe (propuesto o `approvedCents`) va
 *    de 1 céntimo a lo que aún se puede devolver de ese pago; la nota es obligatoria sin política aprobada o si cambia el
 *    importe propuesto;
 *  - NADA pasa a `refunded` sin la confirmación del proveedor: con el proveedor desactivado la devolución queda
 *    `approved` + `awaiting_provider` («Bloqueado»); con uno activo (SIMULADO) pasa a `executing` y una tarea de fondo
 *    confirma, pasados unos segundos del reloj virtual, igual que lo haría el evento firmado `refund.succeeded`;
 *  - cada acción deja auditoría (`refund.approved`, `refund.rejected`, `refund.execute_requested`).
 */
import type {
  AdminRefundDetail,
  AdminRefundItem,
  AdminRefundList,
  AdminRefundPeriod,
  AdminRefundTab,
  CancellationPolicyRef,
  LedgerLineView,
  Money,
  PaymentView,
  RefundDecisionBasis,
  RefundOrigin,
  RefundStatus,
} from "@/api/types";
import { fail, publicUser, writeAudit, type PreviewDb, type Principal } from "@/preview";
import { iso, isoOrNull, sliceOf } from "./common";
import { refundPeriodStart } from "./periods";
import {
  hasCollection,
  PROVIDER_DELAY_MS,
  providerEnabled,
  reviewTables,
  SETTING_PROVIDER_OUTCOME,
  type AmountRow,
  type LedgerLineRow,
  type MoneyRefundRow,
  type RefundMetaRow,
} from "./store";

/** Estados que cuentan como «Canceladas» (propuestas abiertas) en la pestaña del panel. */
const OPEN_STATUSES: readonly RefundStatus[] = ["pending_review", "approved", "executing", "failed"];
/** Estados que ya comprometen dinero del pago (descuentan de lo que aún se puede devolver). */
const COMMITTED_STATUSES: readonly RefundStatus[] = ["approved", "executing", "refunded"];

const NOT_FOUND = "No existe esa propuesta de devolución.";

function money(amount: AmountRow): Money {
  return { cents: amount.cents, currency: "EUR", status: amount.status };
}

// ── Lectura de una devolución ─────────────────────────────────────────────────────────────────────────────────────

function requireRow(db: PreviewDb, refundId: string): Readonly<MoneyRefundRow> {
  const row = reviewTables(db).refunds.get(refundId);
  if (row === undefined) return fail("REFUND_NOT_FOUND", NOT_FOUND, 404);
  return row;
}

function cancelledByOrigin(origin: RefundOrigin): RefundMetaRow["cancelled_by"] {
  switch (origin) {
    case "passenger_cancellation":
      return "passenger";
    case "driver_cancellation":
      return "driver";
    case "platform_cancellation":
    case "force_majeure":
      return "platform";
    case "no_show":
    case "late_payment":
    case "other":
      return null;
  }
}

/** Lo que el panel añade a la devolución. Si otro paquete creó la fila (sin ficha propia), se deduce de la reserva. */
function metaOf(db: PreviewDb, row: Readonly<MoneyRefundRow>): Readonly<RefundMetaRow> {
  const stored = reviewTables(db).refundMeta.get(row.id);
  if (stored !== undefined) return stored;
  const request = db.rideRequests.get(row.request_id);
  const trip = request === undefined ? undefined : db.trips.get(request.trip_id);
  const stops = trip === undefined ? [] : db.tripStops.filter((stop) => stop.trip_id === trip.id).sort((a, b) => a.seq - b.seq);
  const province = trip === undefined ? undefined : db.provinces.get(trip.province_id);
  return {
    id: row.id,
    province_code: province?.code ?? "41",
    driver_user_id: trip?.driver_user_id ?? null,
    trip: {
      trip_id: trip?.id ?? row.request_id,
      departure_at: trip?.departure_at ?? null,
      origin_label: stops[0]?.label ?? null,
      destination_label: stops[stops.length - 1]?.label ?? null,
    },
    cancelled_by: cancelledByOrigin(row.origin),
    cancelled_at: row.origin === "late_payment" ? null : row.created_at,
    cancel_reason: null,
    cancel_note: null,
    decision: null,
    payment: null,
    ledger: [],
    provider_confirms_at: null,
  };
}

function policyOf(row: Readonly<MoneyRefundRow>): CancellationPolicyRef {
  return row.policy_status === "approved"
    ? { status: "approved", version: row.policy_version, effectiveFrom: null, summary: null }
    : { status: "pending_review", version: null, effectiveFrom: null, summary: null };
}

export function refundItem(db: PreviewDb, row: Readonly<MoneyRefundRow>): AdminRefundItem {
  const meta = metaOf(db, row);
  return {
    id: row.id,
    status: row.status,
    origin: row.origin,
    bookingId: row.booking_id,
    requestId: row.request_id,
    paymentId: row.payment_id,
    paid: money(row.paid),
    proposedRefund: money(row.proposed),
    approvedRefund: money(row.approved),
    platformFee: money(row.platform_fee),
    finalPassengerCost: money(row.final_cost),
    executionStatus: row.execution_status,
    policy: policyOf(row),
    createdAt: iso(row.created_at),
    decidedAt: isoOrNull(row.decided_at),
    refundedAt: isoOrNull(row.refunded_at),
    passenger: publicUser(db, row.user_id),
    driver: meta.driver_user_id === null ? null : publicUser(db, meta.driver_user_id),
    trip: {
      tripId: meta.trip.trip_id,
      departureAt: isoOrNull(meta.trip.departure_at),
      originLabel: meta.trip.origin_label,
      destinationLabel: meta.trip.destination_label,
    },
    cancelledBy: meta.cancelled_by,
    cancelledAt: isoOrNull(meta.cancelled_at),
    cancelReason: meta.cancel_reason,
    cancelNote: meta.cancel_note,
    decision:
      meta.decision === null
        ? null
        : {
            by: meta.decision.by_user_id === null ? null : publicUser(db, meta.decision.by_user_id),
            at: iso(meta.decision.at),
            note: meta.decision.note,
            basis: meta.decision.basis,
          },
  };
}

// ── Lista ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RefundListQuery {
  tab: AdminRefundTab;
  status?: RefundStatus;
  origin?: RefundOrigin;
  period: AdminRefundPeriod;
  provinceCode?: string;
  cursor?: string;
  limit?: number;
}

function byNewest(a: Readonly<MoneyRefundRow>, b: Readonly<MoneyRefundRow>): number {
  if (a.created_at !== b.created_at) return b.created_at - a.created_at;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** `GET /v1/admin/refund-proposals`: los contadores respetan periodo y provincia, no la pestaña. */
export function listRefunds(db: PreviewDb, query: RefundListQuery): AdminRefundList {
  const start = refundPeriodStart(db.nowMs(), query.period);
  const scoped = reviewTables(db).refunds.filter((row) => {
    if (start !== null && row.created_at < start) return false;
    return query.provinceCode === undefined || metaOf(db, row).province_code === query.provinceCode;
  });
  const counts = {
    all: scoped.length,
    cancelled: scoped.filter((row) => OPEN_STATUSES.includes(row.status)).length,
    refunded: scoped.filter((row) => row.status === "refunded").length,
  };
  const rows = scoped
    .filter((row) => {
      if (query.tab === "cancelled" && !OPEN_STATUSES.includes(row.status)) return false;
      if (query.tab === "refunded" && row.status !== "refunded") return false;
      if (query.status !== undefined && row.status !== query.status) return false;
      return query.origin === undefined || row.origin === query.origin;
    })
    .sort(byNewest);
  const page = sliceOf(rows, query.cursor, query.limit);
  return { items: page.items.map((row) => refundItem(db, row)), nextCursor: page.nextCursor, counts };
}

// ── Detalle ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Cuánto del pago aún se puede devolver: pagado − lo aprobado/ejecutado en OTRAS devoluciones del mismo pago. */
function maxRefundableCents(db: PreviewDb, row: Readonly<MoneyRefundRow>): number {
  const paid = row.paid.cents;
  if (paid === null || row.payment_id === null) return 0;
  const committed = reviewTables(db)
    .refunds.filter((other) => other.id !== row.id && other.payment_id === row.payment_id && COMMITTED_STATUSES.includes(other.status))
    .reduce((sum, other) => sum + (other.approved.cents ?? 0), 0);
  return Math.max(0, paid - committed);
}

function maxRefundableMoney(db: PreviewDb, row: Readonly<MoneyRefundRow>): Money {
  if (row.paid.cents === null) return { cents: null, currency: "EUR", status: "pending_definition" };
  return { cents: maxRefundableCents(db, row), currency: "EUR", status: row.paid.status };
}

function paymentView(db: PreviewDb, row: Readonly<MoneyRefundRow>, meta: Readonly<RefundMetaRow>): PaymentView | null {
  const payment = meta.payment;
  if (payment === null || row.payment_id === null) return null;
  const refundedCents = reviewTables(db)
    .refunds.filter((other) => other.payment_id === row.payment_id && other.status === "refunded")
    .reduce((sum, other) => sum + (other.approved.cents ?? 0), 0);
  const fullyRefunded = row.paid.cents !== null && refundedCents >= row.paid.cents && refundedCents > 0;
  const updatedAt = Math.max(payment.created_at, payment.succeeded_at ?? 0, row.refunded_at ?? 0);
  return {
    id: payment.id,
    requestId: row.request_id,
    bookingId: row.origin === "late_payment" ? null : row.booking_id,
    status: fullyRefunded ? "refunded" : "succeeded",
    outcome: fullyRefunded ? "refunded" : row.origin === "late_payment" ? "late_payment" : "booking_confirmed",
    amount: money(row.paid),
    refunded: { cents: row.paid.cents === null ? null : refundedCents, currency: "EUR", status: row.paid.status },
    method: { kind: payment.method_kind, maskedLabel: payment.method_label },
    failureCode: null,
    createdAt: iso(payment.created_at),
    updatedAt: iso(updatedAt),
    succeededAt: isoOrNull(payment.succeeded_at),
  };
}

function ledgerView(line: LedgerLineRow): LedgerLineView {
  return { id: line.id, createdAt: iso(line.created_at), transactionKind: line.transaction_kind, account: line.account, amountCents: line.amount_cents };
}

/** `GET /v1/admin/refund-proposals/{refundId}`. */
export function getRefund(db: PreviewDb, refundId: string): AdminRefundDetail {
  const row = requireRow(db, refundId);
  const meta = metaOf(db, row);
  return {
    ...refundItem(db, row),
    payment: paymentView(db, row, meta),
    maxRefundable: maxRefundableMoney(db, row),
    ledger: [...meta.ledger].sort((a, b) => a.created_at - b.created_at || a.id - b.id).map(ledgerView),
  };
}

// ── Libro mayor ───────────────────────────────────────────────────────────────────────────────────────────────────

function ledgerLine(db: PreviewDb, at: number, kind: string, account: string, amountCents: number): LedgerLineRow {
  return { id: db.ids.seq("ledger_entries"), created_at: at, transaction_kind: kind, account, amount_cents: amountCents };
}

/**
 * Asientos del cobro original (suman 0): sin tarifa no hay comisiones, así que todo lo cobrado va a la persona
 * conductora, o a la cuenta de suspenso si el pago llegó tarde y no hay reserva.
 */
export function paymentLedger(db: PreviewDb, amountCents: number, at: number, late: boolean): LedgerLineRow[] {
  const kind = late ? "payment_late" : "payment_confirmed";
  return [ledgerLine(db, at, kind, "passenger", -amountCents), ledgerLine(db, at, kind, late ? "suspense" : "driver_payable", amountCents)];
}

// ── Decisiones ────────────────────────────────────────────────────────────────────────────────────────────────────

function finalCost(paid: AmountRow, refunded: AmountRow, proposed: AmountRow): AmountRow {
  const refundCents = refunded.cents ?? proposed.cents;
  if (paid.cents === null || refundCents === null) return { cents: null, status: "pending_definition" };
  return { cents: Math.max(0, paid.cents - refundCents), status: paid.status };
}

export interface ApproveInput {
  approvedCents?: number;
  note?: string;
}

function basisFor(row: Readonly<MoneyRefundRow>, amount: number): RefundDecisionBasis {
  const proposed = row.proposed.cents;
  if (proposed !== null && amount !== proposed) return "manual_override";
  if (proposed !== null && row.origin === "late_payment") return "late_payment_full_refund";
  if (proposed !== null && row.policy_status === "approved" && row.policy_version !== null) return "policy";
  return "manual_without_policy";
}

/** `POST …/approve` (Idempotency-Key obligatoria, la comprueba el router). */
export function approveRefund(db: PreviewDb, principal: Principal, refundId: string, input: ApproveInput, requestId: string): AdminRefundItem {
  return db.tx(() => {
    const row = requireRow(db, refundId);
    if (row.status !== "pending_review") return fail("REFUND_NOT_PENDING", "La propuesta ya no está pendiente de revisión.", 409);
    const meta = metaOf(db, row);
    if (meta.payment === null || row.payment_id === null || row.paid.cents === null) {
      return fail("REFUND_NO_PAYMENT_RECORD", "No hay un pago registrado en MVC que devolver.", 409);
    }
    const amount = input.approvedCents ?? row.proposed.cents;
    if (amount === null || amount === undefined) return fail("REFUND_AMOUNT_REQUIRED", "Indica el importe que se devuelve.", 400);
    const max = maxRefundableCents(db, row);
    if (!Number.isInteger(amount) || amount < 1 || amount > max) {
      return fail("REFUND_AMOUNT_EXCEEDS_PAID", "El importe supera lo cobrado que aún se puede devolver.", 400, { maxRefundableCents: max });
    }
    const note = input.note?.trim() ?? "";
    const noteRequired = row.policy_status !== "approved" || row.proposed.cents === null || amount !== row.proposed.cents;
    if (noteRequired && note.length < 3) return fail("REFUND_NOTE_REQUIRED", "Indica el motivo de la decisión (al menos 3 caracteres).", 400);

    const now = db.nowMs();
    const basis = basisFor(row, amount);
    const withProvider = providerEnabled(db);
    const approved: AmountRow = { cents: amount, status: row.paid.status };
    const late = row.origin === "late_payment";
    const ledger = [
      ...meta.ledger,
      ledgerLine(db, now, "refund_approved", late ? "suspense" : "driver_payable", -amount),
      ledgerLine(db, now, "refund_approved", "refund_payable", amount),
    ];
    const tables = reviewTables(db);
    const updated = tables.refunds.update(row.id, {
      status: withProvider ? "executing" : "approved",
      execution_status: withProvider ? "submitted" : "awaiting_provider",
      approved,
      final_cost: finalCost(row.paid, approved, row.proposed),
      decided_at: now,
    });
    tables.refundMeta.put({
      ...meta,
      decision: { by_user_id: principal.userId, at: now, note: note === "" ? null : note, basis },
      ledger,
      provider_confirms_at: withProvider ? now + PROVIDER_DELAY_MS : null,
    });
    writeAudit(db, {
      actorUserId: principal.userId,
      action: "refund.approved",
      entityType: "refund_request",
      entityId: row.id,
      requestId,
      metadata: { approvedCents: amount, basis, hasNote: note !== "", providerRequested: withProvider },
    });
    return refundItem(db, updated);
  });
}

/** `POST …/reject`: la nota es obligatoria. */
export function rejectRefund(db: PreviewDb, principal: Principal, refundId: string, input: { note: string }, requestId: string): AdminRefundItem {
  return db.tx(() => {
    const row = requireRow(db, refundId);
    if (row.status !== "pending_review") return fail("REFUND_NOT_PENDING", "La propuesta ya no está pendiente de revisión.", 409);
    const note = input.note.trim();
    if (note.length < 3) return fail("REFUND_NOTE_REQUIRED", "Indica el motivo del rechazo (al menos 3 caracteres).", 400);
    const now = db.nowMs();
    const meta = metaOf(db, row);
    const tables = reviewTables(db);
    const updated = tables.refunds.update(row.id, { status: "rejected", execution_status: "not_started", decided_at: now });
    tables.refundMeta.put({ ...meta, decision: { by_user_id: principal.userId, at: now, note, basis: null }, provider_confirms_at: null });
    writeAudit(db, {
      actorUserId: principal.userId,
      action: "refund.rejected",
      entityType: "refund_request",
      entityId: row.id,
      requestId,
      metadata: { hasNote: true },
    });
    return refundItem(db, updated);
  });
}

/** `POST …/execute`: pide al proveedor la devolución aprobada. «No ejecutable» se evalúa primero. */
export function executeRefund(db: PreviewDb, principal: Principal, refundId: string, requestId: string): AdminRefundItem {
  return db.tx(() => {
    const row = requireRow(db, refundId);
    const executable = (row.status === "approved" && row.execution_status === "awaiting_provider") || row.status === "failed";
    if (!executable) return fail("REFUND_NOT_EXECUTABLE", "Esta devolución no se puede pedir al proveedor en su estado actual.", 409);
    if (!providerEnabled(db)) return fail("PAYMENTS_PROVIDER_DISABLED", "Pagos aún no disponibles", 409);
    const now = db.nowMs();
    const meta = metaOf(db, row);
    const tables = reviewTables(db);
    const updated = tables.refunds.update(row.id, { status: "executing", execution_status: "submitted" });
    tables.refundMeta.put({ ...meta, provider_confirms_at: now + PROVIDER_DELAY_MS });
    writeAudit(db, {
      actorUserId: principal.userId,
      action: "refund.execute_requested",
      entityType: "refund_request",
      entityId: row.id,
      requestId,
      metadata: { retry: row.status === "failed" },
    });
    return refundItem(db, updated);
  });
}

// ── Proveedor de pagos SIMULADO ───────────────────────────────────────────────────────────────────────────────────

/**
 * Tarea de fondo: el proveedor SIMULADO responde a las devoluciones pedidas cuando vence su plazo del reloj virtual. En
 * el servidor real esto es el evento firmado `refund.succeeded` / `refund.failed` del webhook; aquí no hay red, pero la
 * regla es la misma: una devolución solo pasa a `refunded` (o `failed`) cuando «el proveedor» lo confirma.
 */
export function settleRefunds(db: PreviewDb): void {
  if (!hasCollection(db, "admin_refund_meta") || !hasCollection(db, "money_refunds")) return;
  const tables = reviewTables(db);
  const now = db.nowMs();
  const due = tables.refunds.filter((row) => {
    if (row.status !== "executing") return false;
    const at = tables.refundMeta.get(row.id)?.provider_confirms_at ?? null;
    return at !== null && at <= now;
  });
  if (due.length === 0) return;
  const outcome = db.getSetting<string>(SETTING_PROVIDER_OUTCOME) === "failed" ? "failed" : "succeeded";
  db.tx(() => {
    for (const row of due) {
      const meta = tables.refundMeta.get(row.id);
      if (meta === undefined) continue;
      const at = meta.provider_confirms_at ?? now;
      if (outcome === "failed") {
        tables.refunds.update(row.id, { status: "failed", execution_status: "failed" });
        tables.refundMeta.put({ ...meta, provider_confirms_at: null });
        continue;
      }
      const amount = row.approved.cents ?? 0;
      tables.refunds.update(row.id, { status: "refunded", execution_status: "succeeded", refunded_at: at });
      tables.refundMeta.put({
        ...meta,
        provider_confirms_at: null,
        ledger: [...meta.ledger, ledgerLine(db, at, "refund_executed", "refund_payable", -amount), ledgerLine(db, at, "refund_executed", "passenger", amount)],
      });
    }
  });
}
