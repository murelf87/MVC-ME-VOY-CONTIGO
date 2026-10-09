import type { MoneyDto, PublicUserDto } from "../../../lib/dto.js";
import { moneyPending } from "../../../lib/dto.js";
import type { Queryable } from "../lib/db.js";
import { toIso, toIsoRequired } from "../lib/db.js";
import { centsToMoney, loadPublicUsers, STOP_LABEL_JOINS, tripRef, unknownUser, userFrom } from "../lib/people.js";
import type {
  CancellationPolicyRefDto,
  MoneyTripRefDto,
  RefundDecisionBasis,
  RefundExecutionStatus,
  RefundOrigin,
  RefundStatus,
  RefundViewDto
} from "../types.js";

export type RefundCancelledBy = "passenger" | "driver" | "platform" | "system";

export type RefundRow = {
  id: string;
  origin: RefundOrigin;
  status: RefundStatus;
  request_id: string;
  booking_id: string | null;
  payment_id: string | null;
  compensation_id: string | null;
  trip_id: string;
  passenger_user_id: string;
  driver_user_id: string | null;
  cancelled_by: RefundCancelledBy | null;
  cancel_reason: string | null;
  cancel_note: string | null;
  cancelled_at: Date | string | null;
  paid_cents: number;
  proposed_cents: number | null;
  approved_cents: number | null;
  retained_commission_cents: number | null;
  policy_id: string | null;
  policy_status: "pending_review" | "approved";
  decision_basis: RefundDecisionBasis | null;
  decided_by_user_id: string | null;
  decided_at: Date | string | null;
  decision_note: string | null;
  execution_status: RefundExecutionStatus;
  provider_refund_ref: string | null;
  failure_code: string | null;
  refunded_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  policy_version: number | null;
  policy_effective_from: Date | string | null;
  policy_summary: string | null;
  departure_at: Date | string | null;
  origin_label: string | null;
  destination_label: string | null;
};

/** Columnas + etiquetas del viaje. Alias: `rr` = refund_requests, `cp` = política, `r`/`so`/`sd` = solicitud y paradas. */
export const REFUND_SELECT = `rr.id,rr.origin,rr.status,rr.request_id,rr.booking_id,rr.payment_id,rr.compensation_id,rr.trip_id,
  rr.passenger_user_id,rr.driver_user_id,rr.cancelled_by,rr.cancel_reason,rr.cancel_note,rr.cancelled_at,
  rr.paid_cents,rr.proposed_cents,rr.approved_cents,rr.retained_commission_cents,rr.policy_id,rr.policy_status,rr.decision_basis,
  rr.decided_by_user_id,rr.decided_at,rr.decision_note,rr.execution_status,rr.provider_refund_ref,rr.failure_code,rr.refunded_at,
  rr.created_at,rr.updated_at,
  cp.version as policy_version, cp.effective_from as policy_effective_from, cp.summary as policy_summary,
  t.departure_at, so.label as origin_label, sd.label as destination_label`;

export const REFUND_FROM = `refund_requests rr
  join ride_requests r on r.id = rr.request_id
  join trips t on t.id = rr.trip_id
  ${STOP_LABEL_JOINS}
  left join cancellation_policies cp on cp.id = rr.policy_id`;

export function policyRefFromRow(row: RefundRow): CancellationPolicyRefDto {
  if (row.policy_status === "approved" && row.policy_version !== null) {
    return {
      status: "approved",
      version: row.policy_version,
      effectiveFrom: toIso(row.policy_effective_from),
      summary: row.policy_summary
    };
  }
  return { status: "pending_review", version: null, effectiveFrom: null, summary: null };
}

function finalPassengerCost(row: RefundRow): MoneyDto {
  if (row.status === "rejected") return centsToMoney(row.paid_cents);
  const effective = row.approved_cents ?? row.proposed_cents;
  return effective === null ? moneyPending() : centsToMoney(Math.max(0, row.paid_cents - effective));
}

export function toRefundView(row: RefundRow): RefundViewDto {
  return {
    id: row.id,
    status: row.status,
    origin: row.origin,
    bookingId: row.booking_id,
    requestId: row.request_id,
    paymentId: row.payment_id,
    paid: centsToMoney(row.paid_cents),
    proposedRefund: row.proposed_cents === null ? moneyPending() : centsToMoney(row.proposed_cents),
    approvedRefund: row.approved_cents === null ? moneyPending() : centsToMoney(row.approved_cents),
    platformFee: row.retained_commission_cents === null ? moneyPending() : centsToMoney(row.retained_commission_cents),
    finalPassengerCost: finalPassengerCost(row),
    executionStatus: row.execution_status,
    policy: policyRefFromRow(row),
    createdAt: toIsoRequired(row.created_at),
    decidedAt: toIso(row.decided_at),
    refundedAt: toIso(row.refunded_at)
  };
}

export async function loadRefundRow(db: Queryable, refundId: string): Promise<RefundRow | null> {
  const result = await db.query<RefundRow>(`select ${REFUND_SELECT} from ${REFUND_FROM} where rr.id=$1`, [refundId]);
  return result.rows[0] ?? null;
}

export async function loadRefundViewByBooking(
  db: Queryable,
  bookingId: string,
  origin: RefundOrigin
): Promise<RefundViewDto | null> {
  const result = await db.query<RefundRow>(
    `select ${REFUND_SELECT} from ${REFUND_FROM} where rr.booking_id=$1 and rr.origin=$2`,
    [bookingId, origin]
  );
  const row = result.rows[0];
  return row ? toRefundView(row) : null;
}

/* ───────────────────────── Vista ampliada del panel de finanzas ───────────────────────── */

export interface AdminRefundItemDto extends RefundViewDto {
  passenger: PublicUserDto;
  driver: PublicUserDto | null;
  trip: MoneyTripRefDto;
  cancelledBy: RefundCancelledBy | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelNote: string | null;
  decision: { by: PublicUserDto | null; at: string; note: string | null; basis: RefundDecisionBasis | null } | null;
}

export async function toAdminRefundItems(db: Queryable, rows: RefundRow[]): Promise<AdminRefundItemDto[]> {
  const users = await loadPublicUsers(
    db,
    rows.flatMap(row => [row.passenger_user_id, row.driver_user_id, row.decided_by_user_id])
  );
  return rows.map(row => ({
    ...toRefundView(row),
    passenger: userFrom(users, row.passenger_user_id),
    driver: row.driver_user_id ? userFrom(users, row.driver_user_id) : null,
    trip: tripRef({
      trip_id: row.trip_id,
      departure_at: row.departure_at,
      origin_label: row.origin_label,
      destination_label: row.destination_label
    }),
    cancelledBy: row.cancelled_by,
    cancelledAt: toIso(row.cancelled_at),
    cancelReason: row.cancel_reason,
    cancelNote: row.cancel_note,
    decision: row.decided_at
      ? {
          by: row.decided_by_user_id ? (users.get(row.decided_by_user_id) ?? unknownUser(row.decided_by_user_id)) : null,
          at: toIsoRequired(row.decided_at),
          note: row.decision_note,
          basis: row.decision_basis
        }
      : null
  }));
}
