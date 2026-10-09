import type { Pool, PoolClient } from "pg";
import type { AuthPrincipal } from "../../../auth/session.js";
import { DomainError } from "../../../errors.js";
import { writeAudit } from "../../../lib/audit.js";
import { moneyPending, type MoneyDto } from "../../../lib/dto.js";
import { notify } from "../../../lib/notify.js";
import type { Queryable } from "../lib/db.js";
import { clampLimit, decodeCursor, encodeCursor, num, toIsoRequired } from "../lib/db.js";
import { withIdempotency, type IdempotentOutcome } from "../lib/idempotency.js";
import { providerIdempotencyKey } from "../lib/ids.js";
import { centsToMoney, formatEuros } from "../lib/people.js";
import { postRefundApproved } from "../ledger/ledger-service.js";
import { loadPaymentView } from "../payments/payment-service.js";
import { callProvider } from "../provider/call.js";
import { PAYMENTS_DISABLED_MESSAGE } from "../provider/disabled.js";
import type { PaymentProvider } from "../provider/types.js";
import type { Page, PaymentViewDto, RefundDecisionBasis, RefundOrigin, RefundStatus, RefundViewDto } from "../types.js";
import {
  loadRefundRow,
  REFUND_FROM,
  REFUND_SELECT,
  toAdminRefundItems,
  toRefundView,
  type AdminRefundItemDto,
  type RefundRow
} from "./refund-view.js";

export type AdminRefundTab = "all" | "cancelled" | "refunded";
export type AdminRefundPeriod = "7d" | "30d" | "90d" | "365d" | "all";
export const OPEN_REFUND_STATUSES: readonly RefundStatus[] = ["pending_review", "approved", "executing", "failed"];

export interface AdminRefundListDto extends Page<AdminRefundItemDto> {
  counts: { all: number; cancelled: number; refunded: number };
}

export interface LedgerLineViewDto {
  id: number;
  createdAt: string;
  transactionKind: string;
  account: string;
  amountCents: number;
}

export interface AdminRefundDetailDto extends AdminRefundItemDto {
  payment: PaymentViewDto | null;
  maxRefundable: MoneyDto;
  ledger: LedgerLineViewDto[];
}

/* ───────────────────────── Consecuencias pendientes de otros módulos ───────────────────────── */

/**
 * Las reservas pueden cancelarse (o marcarse no-show) en otros módulos sin pasar por aquí. Para que ninguna consecuencia
 * económica quede sin revisar, cada consulta del panel materializa —de forma idempotente— un registro por reserva y origen.
 * La cancelación del conductor y el no-show NO tienen consecuencias definidas: quedan siempre en `pending_review` sin importe propuesto.
 */
export async function ensureConsequenceRecords(db: Queryable): Promise<number> {
  const result = await db.query(
    `insert into refund_requests(origin,status,request_id,booking_id,payment_id,trip_id,passenger_user_id,driver_user_id,
                                 cancelled_by,cancelled_at,paid_cents,policy_status)
     select m.origin,
            case when paid.cents > 0 then 'pending_review' else 'not_applicable' end,
            b.request_id, b.id, pay.id, r.trip_id, r.passenger_user_id, t.driver_user_id,
            m.cancelled_by, b.updated_at, coalesce(paid.cents, 0), 'pending_review'
       from bookings b
       join ride_requests r on r.id = b.request_id
       join trips t on t.id = r.trip_id
       cross join lateral (
         select case b.status::text when 'cancelled' then 'passenger_cancellation'
                                    when 'driver_cancelled' then 'driver_cancellation'
                                    else 'no_show' end as origin,
                case b.status::text when 'cancelled' then 'passenger'
                                    when 'driver_cancelled' then 'driver'
                                    else 'system' end as cancelled_by
       ) m
       left join payments pay on pay.booking_id = b.id
       cross join lateral (select coalesce(pay.collected_cents, pay.amount_cents, b.amount_cents) as cents) paid
      where b.status::text in ('cancelled','driver_cancelled','no_show')
        and not exists (select 1 from refund_requests rr where rr.booking_id = b.id and rr.origin = m.origin)
     on conflict (booking_id, origin) where booking_id is not null do nothing`
  );
  return result.rowCount ?? 0;
}

/* ───────────────────────── Panel de finanzas: lista y detalle ───────────────────────── */

const PERIOD_DAYS: Record<Exclude<AdminRefundPeriod, "all">, number> = { "7d": 7, "30d": 30, "90d": 90, "365d": 365 };

export async function listAdminRefunds(
  pool: Pool,
  query: {
    tab: AdminRefundTab;
    status?: RefundStatus;
    origin?: RefundOrigin;
    period: AdminRefundPeriod;
    provinceCode?: string;
    cursor?: string;
    limit?: number;
  }
): Promise<AdminRefundListDto> {
  await ensureConsequenceRecords(pool);

  const baseParams: unknown[] = [];
  const baseWhere: string[] = [];
  let provinceJoin = "";
  if (query.period !== "all") {
    baseParams.push(PERIOD_DAYS[query.period]);
    baseWhere.push(`rr.created_at >= now() - ($${baseParams.length}::int * interval '1 day')`);
  }
  if (query.provinceCode) {
    baseParams.push(query.provinceCode.toUpperCase());
    provinceJoin = `join provinces pv on pv.id = t.province_id and upper(pv.code) = $${baseParams.length}`;
  }

  const counts = await pool.query<{ total: number; cancelled: number; refunded: number }>(
    `select count(*)::int as total,
            (count(*) filter (where rr.status in ('pending_review','approved','executing','failed')))::int as cancelled,
            (count(*) filter (where rr.status = 'refunded'))::int as refunded
       from refund_requests rr
       join trips t on t.id = rr.trip_id
       ${provinceJoin}
      ${baseWhere.length ? `where ${baseWhere.join(" and ")}` : ""}`,
    baseParams
  );

  const params = [...baseParams];
  const where = [...baseWhere];
  if (query.tab === "cancelled") where.push(`rr.status in ('pending_review','approved','executing','failed')`);
  if (query.tab === "refunded") where.push(`rr.status = 'refunded'`);
  if (query.status) {
    params.push(query.status);
    where.push(`rr.status = $${params.length}`);
  }
  if (query.origin) {
    params.push(query.origin);
    where.push(`rr.origin = $${params.length}`);
  }
  const cursor = decodeCursor(query.cursor);
  if (cursor) {
    params.push(cursor.t, cursor.k);
    where.push(`(rr.created_at, rr.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  const limit = clampLimit(query.limit);
  params.push(limit + 1);
  const result = await pool.query<RefundRow>(
    `select ${REFUND_SELECT}
       from ${REFUND_FROM}
       ${provinceJoin}
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by rr.created_at desc, rr.id desc
      limit $${params.length}`,
    params
  );
  const rows = result.rows.slice(0, limit);
  const last = rows[rows.length - 1];
  const countRow = counts.rows[0]!;
  return {
    items: await toAdminRefundItems(pool, rows),
    nextCursor: result.rows.length > limit && last ? encodeCursor({ t: toIsoRequired(last.created_at), k: last.id }) : null,
    counts: { all: countRow.total, cancelled: countRow.cancelled, refunded: countRow.refunded }
  };
}

type PaymentLimits = {
  id: string;
  provider: string;
  provider_payment_ref: string;
  collected: number;
  refunded_cents: number;
};

/** Bloquea el pago y calcula cuánto queda por devolver: cobrado − devuelto − aprobado y aún no ejecutado por OTRAS propuestas. */
async function lockPaymentLimits(client: PoolClient, paymentId: string, excludeRefundId: string): Promise<PaymentLimits & { committed: number }> {
  const payment = await client.query<{
    id: string;
    provider: string;
    provider_payment_ref: string;
    collected: number;
    refunded_cents: number;
  }>(
    `select id, provider, provider_payment_ref, coalesce(collected_cents, amount_cents) as collected, refunded_cents
       from payments where id=$1 for update`,
    [paymentId]
  );
  const row = payment.rows[0]!;
  const committed = await client.query<{ committed: number }>(
    `select coalesce(sum(approved_cents), 0)::int as committed
       from refund_requests
      where payment_id=$1 and id<>$2 and status in ('approved','executing','failed')`,
    [paymentId, excludeRefundId]
  );
  return { ...row, committed: committed.rows[0]!.committed };
}

export async function getAdminRefund(pool: Pool, refundId: string): Promise<AdminRefundDetailDto> {
  const row = await loadRefundRow(pool, refundId);
  if (!row) throw new DomainError("REFUND_NOT_FOUND", "Devolución no encontrada.", 404);
  const [item] = await toAdminRefundItems(pool, [row]);

  let payment: PaymentViewDto | null = null;
  let maxRefundable: MoneyDto = moneyPending();
  if (row.payment_id) {
    payment = await loadPaymentView(pool, row.payment_id);
    const limits = await pool.query<{ collected: number; refunded_cents: number; committed: number }>(
      `select coalesce(p.collected_cents, p.amount_cents) as collected, p.refunded_cents,
              (select coalesce(sum(rr.approved_cents), 0)::int from refund_requests rr
                where rr.payment_id = p.id and rr.id <> $2 and rr.status in ('approved','executing','failed')) as committed
         from payments p where p.id = $1`,
      [row.payment_id, refundId]
    );
    const l = limits.rows[0]!;
    maxRefundable = centsToMoney(Math.max(0, l.collected - l.refunded_cents - l.committed));
  }
  const ledger = await pool.query<{ id: string; created_at: Date | string; kind: string; account: string; amount_cents: string }>(
    `select e.id::text as id, e.created_at, t.kind, e.account, e.amount_cents::text as amount_cents
       from ledger_entries e
       join ledger_transactions t on t.id = e.transaction_id
      where t.refund_request_id = $1 or ($2::uuid is not null and t.payment_id = $2::uuid)
      order by e.id`,
    [refundId, row.payment_id]
  );
  return {
    ...item!,
    payment,
    maxRefundable,
    ledger: ledger.rows.map(entry => ({
      id: num(entry.id),
      createdAt: toIsoRequired(entry.created_at),
      transactionKind: entry.kind,
      account: entry.account,
      amountCents: num(entry.amount_cents)
    }))
  };
}

/* ───────────────────────── Decisiones ───────────────────────── */

type RefundLock = {
  id: string;
  status: RefundStatus;
  origin: RefundOrigin;
  request_id: string;
  booking_id: string | null;
  payment_id: string | null;
  passenger_user_id: string;
  proposed_cents: number | null;
  approved_cents: number | null;
  policy_status: "pending_review" | "approved";
  execution_status: string;
  execution_attempts: number;
};

async function lockRefund(client: PoolClient, refundId: string): Promise<RefundLock> {
  const result = await client.query<RefundLock>(
    `select id,status,origin,request_id,booking_id,payment_id,passenger_user_id,proposed_cents,approved_cents,policy_status,
            execution_status,execution_attempts
       from refund_requests where id=$1 for update`,
    [refundId]
  );
  const row = result.rows[0];
  if (!row) throw new DomainError("REFUND_NOT_FOUND", "Devolución no encontrada.", 404);
  return row;
}

async function adminItem(client: Queryable, refundId: string): Promise<AdminRefundItemDto> {
  const row = await loadRefundRow(client, refundId);
  const [item] = await toAdminRefundItems(client, [row!]);
  return item!;
}

export type ApproveRefundBody = { approvedCents?: number | undefined; note?: string | undefined };

function trimmedNote(note: string | undefined): string | null {
  const value = note?.trim();
  return value ? value : null;
}

export async function approveRefund(
  pool: Pool,
  provider: PaymentProvider,
  principal: AuthPrincipal,
  idempotencyKey: string,
  refundId: string,
  body: ApproveRefundBody
): Promise<IdempotentOutcome<AdminRefundItemDto>> {
  return withIdempotency(
    pool,
    {
      userId: principal.userId,
      key: idempotencyKey,
      scope: `refund_approve:${refundId}`,
      fingerprint: { refundId, approvedCents: body.approvedCents ?? null, note: trimmedNote(body.note) },
      successStatus: 200
    },
    async client => {
      const refund = await lockRefund(client, refundId);
      if (refund.status !== "pending_review") {
        throw new DomainError("REFUND_NOT_PENDING", "Esta devolución ya no está pendiente de revisión.", 409);
      }
      if (!refund.payment_id) {
        throw new DomainError(
          "REFUND_NO_PAYMENT_RECORD",
          "No hay un pago registrado en MVC asociado a esta reserva: no hay nada que devolver desde aquí.",
          409
        );
      }
      const approved = body.approvedCents ?? refund.proposed_cents;
      if (approved === null || approved === undefined) {
        throw new DomainError(
          "REFUND_AMOUNT_REQUIRED",
          "La propuesta no tiene importe definido: indica el importe a devolver (approvedCents).",
          400
        );
      }
      if (!Number.isInteger(approved) || approved < 1) {
        throw new DomainError("REFUND_AMOUNT_REQUIRED", "El importe a devolver debe ser un entero de céntimos mayor que 0.", 400);
      }

      const limits = await lockPaymentLimits(client, refund.payment_id, refund.id);
      const maxRefundable = Math.max(0, limits.collected - limits.refunded_cents - limits.committed);
      if (approved > maxRefundable) {
        throw new DomainError(
          "REFUND_AMOUNT_EXCEEDS_PAID",
          "El importe a devolver supera lo que queda por devolver de este pago.",
          400,
          { maxRefundableCents: maxRefundable }
        );
      }

      const changedAmount = refund.proposed_cents !== null && approved !== refund.proposed_cents;
      const policyApplies = refund.policy_status === "approved";
      const lateFullRefund = refund.origin === "late_payment" && approved === refund.proposed_cents;
      const note = trimmedNote(body.note);
      if ((!policyApplies || changedAmount) && !lateFullRefund && !note) {
        throw new DomainError(
          "REFUND_NOTE_REQUIRED",
          "Indica el motivo de la decisión: no hay política aplicable o se cambia el importe propuesto.",
          400
        );
      }
      const basis: RefundDecisionBasis = lateFullRefund
        ? "late_payment_full_refund"
        : policyApplies
          ? changedAmount
            ? "manual_override"
            : "policy"
          : "manual_without_policy";

      await postRefundApproved(client, {
        refundId: refund.id,
        paymentId: refund.payment_id,
        bookingId: refund.booking_id,
        passengerUserId: refund.passenger_user_id,
        amountCents: approved
      });

      // Solicitud al proveedor (si lo hay). Si falla, se revierte TODO (incluida la aprobación): finanzas puede reintentar con la misma clave.
      let status: RefundStatus = "approved";
      let executionStatus = "awaiting_provider";
      let providerRefundRef: string | null = null;
      const canSubmit = provider.enabled && provider.capabilities.refunds && limits.provider === provider.name;
      if (canSubmit) {
        const attempt = refund.execution_attempts + 1;
        const submitted = await callProvider(() =>
          provider.refundPayment({
            idempotencyKey: providerIdempotencyKey("refund", refund.id, String(attempt)),
            providerPaymentRef: limits.provider_payment_ref,
            amountCents: approved,
            metadata: { refundRequestId: refund.id }
          })
        );
        status = "executing";
        executionStatus = "submitted";
        providerRefundRef = submitted.providerRefundRef;
      }
      await client.query(
        `update refund_requests
            set status=$2, approved_cents=$3, decision_basis=$4, decided_by_user_id=$5, decided_at=now(), decision_note=$6,
                execution_status=$7, provider_refund_ref=$8,
                execution_attempts=execution_attempts + $9::int, updated_at=now()
          where id=$1`,
        [refund.id, status, approved, basis, principal.userId, note, executionStatus, providerRefundRef, canSubmit ? 1 : 0]
      );
      await writeAudit(client, {
        actorUserId: principal.userId,
        action: "refund.approved",
        entityType: "refund_request",
        entityId: refund.id,
        metadata: { approvedCents: approved, proposedCents: refund.proposed_cents, basis, executionStatus }
      });
      await notify(client, {
        userId: refund.passenger_user_id,
        category: "payment",
        kind: "refund_approved",
        title: "Devolución aprobada",
        body: `Administración ha aprobado la devolución de ${formatEuros(approved)}. Se tramitará con el proveedor de pagos y te avisaremos cuando se complete.`,
        data: { refundId: refund.id, bookingId: refund.booking_id }
      });
      return adminItem(client, refund.id);
    }
  );
}

export async function rejectRefund(
  pool: Pool,
  principal: AuthPrincipal,
  idempotencyKey: string,
  refundId: string,
  body: { note: string }
): Promise<IdempotentOutcome<AdminRefundItemDto>> {
  return withIdempotency(
    pool,
    {
      userId: principal.userId,
      key: idempotencyKey,
      scope: `refund_reject:${refundId}`,
      fingerprint: { refundId, note: trimmedNote(body.note) },
      successStatus: 200
    },
    async client => {
      const refund = await lockRefund(client, refundId);
      if (refund.status !== "pending_review") {
        throw new DomainError("REFUND_NOT_PENDING", "Esta devolución ya no está pendiente de revisión.", 409);
      }
      const note = trimmedNote(body.note);
      if (!note) throw new DomainError("REFUND_NOTE_REQUIRED", "Indica el motivo del rechazo.", 400);
      await client.query(
        `update refund_requests
            set status='rejected', decided_by_user_id=$2, decided_at=now(), decision_note=$3, updated_at=now()
          where id=$1`,
        [refund.id, principal.userId, note]
      );
      await writeAudit(client, {
        actorUserId: principal.userId,
        action: "refund.rejected",
        entityType: "refund_request",
        entityId: refund.id,
        metadata: { origin: refund.origin }
      });
      // El texto de la nota es interno: no se incluye en el aviso.
      await notify(client, {
        userId: refund.passenger_user_id,
        category: "payment",
        kind: "refund_rejected",
        title: "Devolución no aprobada",
        body: "Administración no ha aprobado la devolución. Puedes consultar el estado en «Mis pagos» o escribir a soporte.",
        data: { refundId: refund.id, bookingId: refund.booking_id }
      });
      return adminItem(client, refund.id);
    }
  );
}

/** Reintenta pedir al proveedor una devolución YA aprobada (`approved` en espera del proveedor, o `failed`). */
export async function executeRefund(
  pool: Pool,
  provider: PaymentProvider,
  principal: AuthPrincipal,
  idempotencyKey: string,
  refundId: string
): Promise<IdempotentOutcome<AdminRefundItemDto>> {
  return withIdempotency(
    pool,
    {
      userId: principal.userId,
      key: idempotencyKey,
      scope: `refund_execute:${refundId}`,
      fingerprint: { refundId },
      successStatus: 200
    },
    async client => {
      const refund = await lockRefund(client, refundId);
      const executable =
        refund.status === "failed" || (refund.status === "approved" && refund.execution_status === "awaiting_provider");
      if (!executable || !refund.payment_id || refund.approved_cents === null) {
        throw new DomainError("REFUND_NOT_EXECUTABLE", "Esta devolución no está en un estado en el que se pueda pedir al proveedor.", 409);
      }
      if (!provider.enabled || !provider.capabilities.refunds) {
        throw new DomainError("PAYMENTS_PROVIDER_DISABLED", PAYMENTS_DISABLED_MESSAGE, 409);
      }
      const limits = await lockPaymentLimits(client, refund.payment_id, refund.id);
      if (limits.provider !== provider.name) {
        throw new DomainError("PAYMENTS_PROVIDER_DISABLED", "El pago original no pertenece al proveedor activo.", 409);
      }
      const attempt = refund.execution_attempts + 1;
      const submitted = await callProvider(() =>
        provider.refundPayment({
          idempotencyKey: providerIdempotencyKey("refund", refund.id, String(attempt)),
          providerPaymentRef: limits.provider_payment_ref,
          amountCents: refund.approved_cents!,
          metadata: { refundRequestId: refund.id }
        })
      );
      await client.query(
        `update refund_requests
            set status='executing', execution_status='submitted', provider_refund_ref=$2, failure_code=null,
                execution_attempts=execution_attempts + 1, updated_at=now()
          where id=$1`,
        [refund.id, submitted.providerRefundRef]
      );
      await writeAudit(client, {
        actorUserId: principal.userId,
        action: "refund.execute_requested",
        entityType: "refund_request",
        entityId: refund.id,
        metadata: { attempt }
      });
      return adminItem(client, refund.id);
    }
  );
}

/* ───────────────────────── Pasajero ───────────────────────── */

export async function listMyRefunds(
  pool: Pool,
  principal: AuthPrincipal,
  query: { cursor?: string; limit?: number }
): Promise<Page<RefundViewDto>> {
  const params: unknown[] = [principal.userId];
  const where = [`rr.passenger_user_id = $1`, `rr.status <> 'not_applicable'`];
  const cursor = decodeCursor(query.cursor);
  if (cursor) {
    params.push(cursor.t, cursor.k);
    where.push(`(rr.created_at, rr.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  const limit = clampLimit(query.limit);
  params.push(limit + 1);
  const result = await pool.query<RefundRow>(
    `select ${REFUND_SELECT} from ${REFUND_FROM}
      where ${where.join(" and ")}
      order by rr.created_at desc, rr.id desc
      limit $${params.length}`,
    params
  );
  const rows = result.rows.slice(0, limit);
  const last = rows[rows.length - 1];
  return {
    items: rows.map(toRefundView),
    nextCursor: result.rows.length > limit && last ? encodeCursor({ t: toIsoRequired(last.created_at), k: last.id }) : null
  };
}
