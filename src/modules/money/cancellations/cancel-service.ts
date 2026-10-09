import type { Pool, PoolClient } from "pg";
import type { AuthPrincipal } from "../../../auth/session.js";
import { DomainError } from "../../../errors.js";
import { writeAudit } from "../../../lib/audit.js";
import { moneyPending, type MoneyDto } from "../../../lib/dto.js";
import { notify } from "../../../lib/notify.js";
import type { Queryable } from "../lib/db.js";
import { withIdempotency, type IdempotentOutcome } from "../lib/idempotency.js";
import { centsToMoney, loadPublicUsers, STOP_LABEL_JOINS, tripRef, userFrom } from "../lib/people.js";
import { parseBreakdown, type PaymentBreakdown } from "../ledger/ledger-service.js";
import { loadRefundViewByBooking } from "../refunds/refund-view.js";
import type { CancellationPolicyRefDto, MoneyTripRefDto, RefundOrigin, RefundViewDto } from "../types.js";
import type { PublicUserDto } from "../../../lib/dto.js";
import { evaluatePolicy, loadAcceptedPolicy, policyRef, type PolicyOutcome } from "./policy-engine.js";

export type PassengerCancellationReason = "no_longer_needed" | "schedule_change" | "found_other_option" | "other";
export type DriverCancellationReason = "schedule_change" | "vehicle_issue" | "emergency" | "passenger_issue" | "other";
export const PASSENGER_CANCELLATION_REASONS: readonly PassengerCancellationReason[] = [
  "no_longer_needed",
  "schedule_change",
  "found_other_option",
  "other"
];
export const DRIVER_CANCELLATION_REASONS: readonly DriverCancellationReason[] = [
  "schedule_change",
  "vehicle_issue",
  "emergency",
  "passenger_issue",
  "other"
];

export type PaymentBookingStatus = "confirmed" | "completed" | "cancelled" | "driver_cancelled" | "no_show";
export type CancellationBlockCode = "BOOKING_ALREADY_CANCELLED" | "BOOKING_NOT_CANCELLABLE" | "TRIP_ALREADY_STARTED";

export interface CancellationPreviewDto {
  booking: {
    id: string;
    status: PaymentBookingStatus;
    seats: number;
    trip: MoneyTripRefDto;
    driver: PublicUserDto;
    paid: MoneyDto;
  };
  canCancel: boolean;
  blocked: { code: CancellationBlockCode; message: string } | null;
  scenario: "passenger_cancellation";
  reasons: PassengerCancellationReason[];
  policy: CancellationPolicyRefDto;
  lines: Array<{
    key: "trip_contribution" | "platform_fee";
    amount: MoneyDto;
    noteCode: "subject_to_conditions" | "policy_pending_review" | "per_policy";
  }>;
  proposedRefund: MoneyDto;
  decisionMode: "admin_review";
  legalNotice: string;
}

export interface CancelBookingResponseDto {
  booking: { id: string; status: PaymentBookingStatus };
  refund: RefundViewDto | null;
  alreadyCancelled: boolean;
}

export const LEGAL_NOTICE = "Si corresponde, los reembolsos obligatorios por ley se realizarán según la normativa vigente.";

/* ───────────────────────── Carga ───────────────────────── */

type BookingCtx = {
  booking_id: string;
  booking_status: PaymentBookingStatus;
  booking_amount_cents: number;
  request_id: string;
  passenger_user_id: string;
  trip_id: string;
  driver_user_id: string;
  trip_started: boolean;
  departure_at: Date | string | null;
  hours_before: number | null;
  origin_label: string | null;
  destination_label: string | null;
};

async function loadBookingContext(db: Queryable, bookingId: string): Promise<BookingCtx | null> {
  const result = await db.query<BookingCtx>(
    `select b.id as booking_id, b.status::text as booking_status, b.amount_cents as booking_amount_cents,
            r.id as request_id, r.passenger_user_id, t.id as trip_id, t.driver_user_id,
            (t.status::text = 'active' or t.started_at is not null or b.picked_up_at is not null) as trip_started,
            t.departure_at,
            (extract(epoch from (t.departure_at - now())) / 3600.0)::float8 as hours_before,
            so.label as origin_label, sd.label as destination_label
       from bookings b
       join ride_requests r on r.id = b.request_id
       join trips t on t.id = r.trip_id
       ${STOP_LABEL_JOINS}
      where b.id = $1`,
    [bookingId]
  );
  return result.rows[0] ?? null;
}

type BookingPayment = { id: string; cancellation_policy_id: string | null; breakdown: unknown; paid_cents: number };

async function loadBookingPayment(db: Queryable, bookingId: string): Promise<BookingPayment | null> {
  const result = await db.query<BookingPayment>(
    `select id, cancellation_policy_id, breakdown, coalesce(collected_cents, amount_cents) as paid_cents
       from payments where booking_id = $1 and status in ('succeeded','refunded')`,
    [bookingId]
  );
  return result.rows[0] ?? null;
}

function safeBreakdown(value: unknown): PaymentBreakdown | null {
  try {
    return parseBreakdown(value);
  } catch {
    return null;
  }
}

function blockedFor(ctx: BookingCtx): CancellationPreviewDto["blocked"] {
  if (ctx.booking_status === "cancelled") {
    return { code: "BOOKING_ALREADY_CANCELLED", message: "Esta reserva ya está cancelada." };
  }
  if (ctx.booking_status !== "confirmed") {
    return { code: "BOOKING_NOT_CANCELLABLE", message: "Esta reserva ya no se puede cancelar." };
  }
  if (ctx.trip_started) {
    return {
      code: "TRIP_ALREADY_STARTED",
      message:
        "El viaje ya ha empezado y no se puede cancelar desde aquí. Si hay un problema, usa «Incidencias» o escribe a soporte."
    };
  }
  return null;
}

/* ───────────────────────── Vista previa (pantalla 28) ───────────────────────── */

export async function getCancellationPreview(pool: Pool, principal: AuthPrincipal, bookingId: string): Promise<CancellationPreviewDto> {
  const ctx = await loadBookingContext(pool, bookingId);
  if (!ctx || ctx.passenger_user_id !== principal.userId) {
    throw new DomainError("BOOKING_NOT_FOUND", "Reserva no encontrada.", 404);
  }
  const payment = await loadBookingPayment(pool, bookingId);
  const breakdown = payment ? safeBreakdown(payment.breakdown) : null;
  const policy = await loadAcceptedPolicy(pool, payment?.cancellation_policy_id ?? null);
  const outcome = evaluatePolicy(policy, breakdown, ctx.hours_before, "passenger_cancellation");
  const users = await loadPublicUsers(pool, [ctx.driver_user_id]);
  const blocked = blockedFor(ctx);
  const paidCents = payment ? payment.paid_cents : ctx.booking_amount_cents;

  let lines: CancellationPreviewDto["lines"];
  let proposedRefund: MoneyDto;
  if (outcome.kind === "applied") {
    lines = [
      { key: "trip_contribution", amount: centsToMoney(outcome.refund.contributionCents), noteCode: "per_policy" },
      {
        key: "platform_fee",
        amount: centsToMoney(outcome.refund.commissionCents + outcome.refund.processingCents + outcome.refund.taxesCents),
        noteCode: "per_policy"
      }
    ];
    proposedRefund = centsToMoney(outcome.refund.totalCents);
  } else {
    lines = [
      {
        key: "trip_contribution",
        amount: breakdown ? centsToMoney(breakdown.contributionCents) : moneyPending(),
        noteCode: "subject_to_conditions"
      },
      { key: "platform_fee", amount: moneyPending(), noteCode: "policy_pending_review" }
    ];
    proposedRefund = moneyPending();
  }

  return {
    booking: {
      id: ctx.booking_id,
      status: ctx.booking_status,
      seats: 1,
      trip: tripRef({
        trip_id: ctx.trip_id,
        departure_at: ctx.departure_at,
        origin_label: ctx.origin_label,
        destination_label: ctx.destination_label
      }),
      driver: userFrom(users, ctx.driver_user_id),
      paid: centsToMoney(paidCents)
    },
    canCancel: blocked === null,
    blocked,
    scenario: "passenger_cancellation",
    reasons: [...PASSENGER_CANCELLATION_REASONS],
    policy: policyRef(outcome),
    lines,
    proposedRefund,
    decisionMode: "admin_review",
    legalNotice: LEGAL_NOTICE
  };
}

/* ───────────────────────── Cancelar ───────────────────────── */

type CancelActor = "passenger" | "driver";

type CancelInput = {
  actor: CancelActor;
  bookingId: string;
  reason: string;
  note: string | undefined;
};

async function createCancellationRefund(
  client: PoolClient,
  ctx: BookingCtx,
  payment: BookingPayment | null,
  input: {
    origin: RefundOrigin;
    cancelledBy: "passenger" | "driver";
    cancelledByUserId: string;
    reason: string;
    note: string | undefined;
    outcome: PolicyOutcome;
  }
): Promise<void> {
  const paid = payment ? payment.paid_cents : ctx.booking_amount_cents;
  if (paid <= 0) return; // nada pagado: no hay devolución que revisar
  const applied = input.outcome.kind === "applied" ? input.outcome : null;
  await client.query(
    `insert into refund_requests(origin,status,request_id,booking_id,payment_id,trip_id,passenger_user_id,driver_user_id,
                                 cancelled_by,cancelled_by_user_id,cancel_reason,cancel_note,cancelled_at,
                                 paid_cents,proposed_cents,retained_commission_cents,policy_id,policy_status)
     values($1,'pending_review',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),$12,$13,$14,$15,$16)
     on conflict (booking_id, origin) where booking_id is not null do nothing`,
    [
      input.origin,
      ctx.request_id,
      ctx.booking_id,
      payment?.id ?? null,
      ctx.trip_id,
      ctx.passenger_user_id,
      ctx.driver_user_id,
      input.cancelledBy,
      input.cancelledByUserId,
      input.reason,
      input.note ?? null,
      paid,
      applied ? applied.refund.totalCents : null,
      applied ? applied.retainedCommissionCents : null,
      applied ? applied.policy.id : null,
      applied ? "approved" : "pending_review"
    ]
  );
}

async function cancelCore(
  client: PoolClient,
  principal: AuthPrincipal,
  input: CancelInput
): Promise<CancelBookingResponseDto> {
  const origin: RefundOrigin = input.actor === "passenger" ? "passenger_cancellation" : "driver_cancellation";
  const targetStatus: PaymentBookingStatus = input.actor === "passenger" ? "cancelled" : "driver_cancelled";

  // Orden de bloqueos global: solicitud → (pago) → reserva provisional → reserva.
  const first = await client.query<{ request_id: string }>(`select request_id from bookings where id=$1`, [input.bookingId]);
  const requestId = first.rows[0]?.request_id;
  if (!requestId) throw new DomainError("BOOKING_NOT_FOUND", "Reserva no encontrada.", 404);
  await client.query(`select 1 from ride_requests where id=$1 for update`, [requestId]);
  await client.query(`select 1 from bookings where id=$1 for update`, [input.bookingId]);

  const ctx = await loadBookingContext(client, input.bookingId);
  const owner = input.actor === "passenger" ? ctx?.passenger_user_id : ctx?.driver_user_id;
  if (!ctx || owner !== principal.userId) throw new DomainError("BOOKING_NOT_FOUND", "Reserva no encontrada.", 404);

  if (ctx.booking_status === targetStatus) {
    return {
      booking: { id: ctx.booking_id, status: ctx.booking_status },
      refund: await loadRefundViewByBooking(client, ctx.booking_id, origin),
      alreadyCancelled: true
    };
  }
  if (ctx.booking_status !== "confirmed") {
    throw new DomainError("BOOKING_NOT_CANCELLABLE", "Esta reserva ya no se puede cancelar.", 409);
  }
  if (ctx.trip_started) {
    throw new DomainError(
      "TRIP_ALREADY_STARTED",
      "El viaje ya ha empezado y no se puede cancelar desde aquí. Usa «Incidencias» o escribe a soporte.",
      409
    );
  }

  await client.query(`update bookings set status=$2::booking_status, updated_at=now() where id=$1`, [ctx.booking_id, targetStatus]);
  await client.query(`update ride_requests set status='cancelled', updated_at=now() where id=$1`, [ctx.request_id]);
  await client.query(`update seat_holds set status='released', released_at=now() where request_id=$1 and status='active'`, [
    ctx.request_id
  ]);

  const payment = await loadBookingPayment(client, ctx.booking_id);
  let outcome: PolicyOutcome = { kind: "pending_review" };
  if (input.actor === "passenger" && payment) {
    const policy = await loadAcceptedPolicy(client, payment.cancellation_policy_id);
    outcome = evaluatePolicy(policy, safeBreakdown(payment.breakdown), ctx.hours_before, "passenger_cancellation");
  }
  await createCancellationRefund(client, ctx, payment, {
    origin,
    cancelledBy: input.actor,
    cancelledByUserId: principal.userId,
    reason: input.reason,
    note: input.note,
    outcome
  });
  const refund = await loadRefundViewByBooking(client, ctx.booking_id, origin);

  await writeAudit(client, {
    actorUserId: principal.userId,
    action: input.actor === "passenger" ? "booking.cancelled_by_passenger" : "booking.cancelled_by_driver",
    entityType: "booking",
    entityId: ctx.booking_id,
    metadata: { requestId: ctx.request_id, reason: input.reason, refundId: refund?.id ?? null, paidCents: payment?.paid_cents ?? null }
  });

  const users = await loadPublicUsers(client, [ctx.passenger_user_id, ctx.driver_user_id]);
  const route = `${ctx.origin_label ?? "el origen"} → ${ctx.destination_label ?? "el destino"}`;
  if (input.actor === "passenger") {
    await notify(client, {
      userId: ctx.driver_user_id,
      category: "trip",
      kind: "booking_cancelled",
      title: "Reserva cancelada",
      body: `${userFrom(users, ctx.passenger_user_id).firstName} ha cancelado su plaza en tu viaje (${route}).`,
      data: { bookingId: ctx.booking_id, tripId: ctx.trip_id }
    });
    if (refund) {
      await notify(client, {
        userId: ctx.passenger_user_id,
        category: "payment",
        kind: "refund_proposal_created",
        title: "Cancelación registrada",
        body: "Hemos registrado tu cancelación. Administración revisará la devolución y te avisaremos de la decisión.",
        data: { refundId: refund.id, bookingId: ctx.booking_id }
      });
    }
  } else {
    await notify(client, {
      userId: ctx.passenger_user_id,
      category: "trip",
      kind: "booking_cancelled_by_driver",
      title: "Tu viaje se ha cancelado",
      body: `${userFrom(users, ctx.driver_user_id).firstName} ha cancelado el viaje (${route}). Hemos abierto una revisión para tramitar lo que corresponda.`,
      data: { bookingId: ctx.booking_id, tripId: ctx.trip_id, ...(refund ? { refundId: refund.id } : {}) }
    });
  }

  return { booking: { id: ctx.booking_id, status: targetStatus }, refund, alreadyCancelled: false };
}

export async function cancelBookingAsPassenger(
  pool: Pool,
  principal: AuthPrincipal,
  idempotencyKey: string,
  bookingId: string,
  body: { reason: PassengerCancellationReason; note?: string | undefined }
): Promise<IdempotentOutcome<CancelBookingResponseDto>> {
  return withIdempotency(
    pool,
    {
      userId: principal.userId,
      key: idempotencyKey,
      scope: `booking_cancel:${bookingId}`,
      fingerprint: { bookingId, reason: body.reason, note: body.note ?? null },
      successStatus: 200
    },
    client => cancelCore(client, principal, { actor: "passenger", bookingId, reason: body.reason, note: body.note })
  );
}

export async function cancelBookingAsDriver(
  pool: Pool,
  principal: AuthPrincipal,
  idempotencyKey: string,
  bookingId: string,
  body: { reason: DriverCancellationReason; note?: string | undefined }
): Promise<IdempotentOutcome<CancelBookingResponseDto>> {
  return withIdempotency(
    pool,
    {
      userId: principal.userId,
      key: idempotencyKey,
      scope: `booking_driver_cancel:${bookingId}`,
      fingerprint: { bookingId, reason: body.reason, note: body.note ?? null },
      successStatus: 200
    },
    client => cancelCore(client, principal, { actor: "driver", bookingId, reason: body.reason, note: body.note })
  );
}
