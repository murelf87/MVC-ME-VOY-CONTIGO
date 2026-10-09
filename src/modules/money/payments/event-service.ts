import type { Pool, PoolClient } from "pg";
import { DomainError } from "../../../errors.js";
import { writeAudit } from "../../../lib/audit.js";
import { notify } from "../../../lib/notify.js";
import { num, tx } from "../lib/db.js";
import { formatEuros, loadPublicUsers, userFrom } from "../lib/people.js";
import { loadRequestTripInfo, type RequestTripInfo } from "../lib/trip-info.js";
import { parseBreakdown, postCharge, postPayout, postRefundExecuted, postUnallocatedCharge } from "../ledger/ledger-service.js";
import type { NormalizedProviderEvent } from "../provider/types.js";
import { issueReceipt } from "../reports/receipt-service.js";
import type { PaymentOutcome, PaymentStatus } from "../types.js";

/**
 * Aplicación de eventos del proveedor de pagos (único origen de verdad de `payments.status`).
 *
 * Garantías (docs/contracts/money.md §10–§11):
 *  - Idempotencia: `payment_events` tiene (provider, provider_event_id) único; el evento y TODOS sus efectos se confirman en
 *    una sola transacción. Un duplicado no repite nada.
 *  - Orden: cada estado tiene un rango; un evento de rango menor se ignora. Un `succeeded` tardío SIEMPRE se procesa (el dinero se cobró).
 *  - Sin sobre-reserva: la reserva solo se crea con la solicitud en `payment_pending` y una reserva provisional ACTIVA y no caducada
 *    (comprobado en SQL con el reloj de la base de datos), bloqueando solicitud → pago → hold. Si no, compensación + devolución propuesta.
 *  - Objeto desconocido → 409 PAYMENT_UNKNOWN (no se guarda nada; el proveedor reintenta).
 */

export type PaymentEventOutcome =
  | "applied"
  | "ignored_stale"
  | "ignored_conflict"
  | "ignored_unsupported"
  | "compensation_created";

export type EventResult = { eventId: string; result: "applied" | "duplicate" | "ignored"; reason?: string };

type Applied = { outcome: PaymentEventOutcome; detail: Record<string, unknown> };

type PaymentEvent = Extract<NormalizedProviderEvent, { object: "payment" }>;
type RefundEvent = Extract<NormalizedProviderEvent, { object: "refund" }>;
type PayoutEvent = Extract<NormalizedProviderEvent, { object: "payout" }>;

/* ───────────────────────── Reglas de transición (puras, probadas por separado) ───────────────────────── */

export type TransitionDecision = "apply" | "stale" | "conflict";

/**
 * `requires_action` < `processing` < `succeeded` < `refunded`; `failed`/`expired` son ramas laterales.
 *  - `succeeded` se aplica siempre que el pago no lo estuviera ya (también tras `failed`/`expired`: el cobro es real).
 *  - Un evento de rango menor o igual al actual se ignora (`stale`).
 *  - `failed`/`expired` tras `succeeded`/`refunded` contradicen el estado: se registran como conflicto y no se aplican.
 */
export function decidePaymentTransition(current: PaymentStatus, type: PaymentEvent["type"]): TransitionDecision {
  if (current === "succeeded" || current === "refunded") {
    return type === "failed" || type === "expired" ? "conflict" : "stale";
  }
  if (type === "succeeded") return "apply";
  if (current === "failed" || current === "expired") return "stale";
  if (type === "requires_action") return "stale";
  if (type === "processing") return current === "processing" ? "stale" : "apply";
  return "apply";
}

function sanitizeCode(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.toLowerCase().replace(/[^a-z0-9_.-]/g, "_").slice(0, 80);
  return cleaned.length > 0 ? cleaned : null;
}

/* ───────────────────────── Entrada ───────────────────────── */

function bad(what: string): DomainError {
  return new DomainError("WEBHOOK_PAYLOAD_INVALID", `Evento del proveedor no válido: ${what}.`, 400);
}

const positiveSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

function assertWellFormed(event: NormalizedProviderEvent, expectedProvider: string): void {
  if (event.provider !== expectedProvider) throw bad("proveedor inesperado");
  if (!event.eventId || event.eventId.length > 200) throw bad("eventId");
  if (!(event.occurredAt instanceof Date) || Number.isNaN(event.occurredAt.getTime())) throw bad("occurredAt");
  if (event.object === "payment") {
    if (event.providerPaymentRef.length < 3 || event.providerPaymentRef.length > 200) throw bad("referencia del pago");
    if (event.type === "succeeded" && !positiveSafeInteger(event.amountCents)) throw bad("importe cobrado (céntimos enteros)");
  } else if (event.object === "refund") {
    if (event.providerRefundRef.length < 3 || event.providerRefundRef.length > 200) throw bad("referencia de la devolución");
    if (event.providerPaymentRef.length < 3 || event.providerPaymentRef.length > 200) throw bad("referencia del pago");
    if (!positiveSafeInteger(event.amountCents)) throw bad("importe devuelto (céntimos enteros)");
  } else {
    if (event.providerPayoutRef.length < 3 || event.providerPayoutRef.length > 200) throw bad("referencia del abono");
    if (!positiveSafeInteger(event.amountCents)) throw bad("importe abonado (céntimos enteros)");
  }
}

function objectRef(event: NormalizedProviderEvent): string {
  return event.object === "payment"
    ? event.providerPaymentRef
    : event.object === "refund"
      ? event.providerRefundRef
      : event.providerPayoutRef;
}

function toResult(eventId: string, applied: Applied): EventResult {
  switch (applied.outcome) {
    case "applied":
      return { eventId, result: "applied" };
    case "compensation_created":
      return { eventId, result: "applied", reason: "compensation_created" };
    case "ignored_stale":
      return { eventId, result: "ignored", reason: "stale" };
    case "ignored_conflict":
      return { eventId, result: "ignored", reason: "conflict" };
    case "ignored_unsupported":
      return { eventId, result: "ignored", reason: "unsupported" };
  }
}

/** Procesa los eventos en orden; cada uno en su propia transacción. Un objeto desconocido corta con 409 (el proveedor reintenta). */
export async function ingestProviderEvents(
  pool: Pool,
  expectedProvider: string,
  events: NormalizedProviderEvent[]
): Promise<EventResult[]> {
  for (const event of events) assertWellFormed(event, expectedProvider);
  const results: EventResult[] = [];
  for (const event of events) results.push(await ingestProviderEvent(pool, event));
  return results;
}

export async function ingestProviderEvent(pool: Pool, event: NormalizedProviderEvent): Promise<EventResult> {
  return tx(pool, async client => {
    const claimed = await client.query<{ id: string }>(
      `insert into payment_events(provider,provider_event_id,object_kind,event_type,provider_object_ref,occurred_at,outcome)
       values($1,$2,$3,$4,$5,$6,'applied')
       on conflict (provider,provider_event_id) do nothing
       returning id`,
      [event.provider, event.eventId, event.object, event.type, objectRef(event), event.occurredAt]
    );
    const row = claimed.rows[0];
    // Si otra transacción reclamó el mismo evento a la vez, el INSERT esperó a su confirmación y llega aquí como duplicado.
    if (!row) return { eventId: event.eventId, result: "duplicate" as const };

    const applied =
      event.object === "payment"
        ? await applyPaymentEvent(client, event)
        : event.object === "refund"
          ? await applyRefundEvent(client, event)
          : await applyPayoutEvent(client, event);

    await client.query(`update payment_events set outcome=$2, detail=$3::jsonb where id=$1`, [
      row.id,
      applied.outcome,
      JSON.stringify(applied.detail)
    ]);
    return toResult(event.eventId, applied);
  });
}

/* ───────────────────────── Pagos ───────────────────────── */

type LockedPayment = {
  id: string;
  request_id: string;
  payer_user_id: string;
  provider: string;
  provider_payment_ref: string;
  amount_cents: number;
  collected_cents: number | null;
  status: PaymentStatus;
  outcome: PaymentOutcome;
  breakdown: unknown;
  booking_id: string | null;
  refunded_cents: number;
};

const LOCKED_PAYMENT_COLUMNS = `id,request_id,payer_user_id,provider,provider_payment_ref,amount_cents,collected_cents,status,outcome,
  breakdown,booking_id,refunded_cents`;

async function applyPaymentEvent(client: PoolClient, event: PaymentEvent): Promise<Applied> {
  const found = await client.query<{ id: string; request_id: string }>(
    `select id, request_id from payments where provider=$1 and provider_payment_ref=$2`,
    [event.provider, event.providerPaymentRef]
  );
  const ref = found.rows[0];
  if (!ref) {
    throw new DomainError(
      "PAYMENT_UNKNOWN",
      "El evento se refiere a un pago que este servidor no conoce (todavía): reinténtalo más tarde.",
      409
    );
  }
  // Orden de bloqueos: solicitud → pago (→ hold → reserva).
  await client.query(`select 1 from ride_requests where id=$1 for update`, [ref.request_id]);
  const locked = await client.query<LockedPayment>(`select ${LOCKED_PAYMENT_COLUMNS} from payments where id=$1 for update`, [ref.id]);
  const payment = locked.rows[0]!;

  const decision = decidePaymentTransition(payment.status, event.type);
  const baseDetail = { paymentId: payment.id, current: payment.status, eventType: event.type };
  if (decision === "stale") return { outcome: "ignored_stale", detail: baseDetail };
  if (decision === "conflict") return { outcome: "ignored_conflict", detail: baseDetail };

  switch (event.type) {
    case "requires_action":
      return { outcome: "ignored_stale", detail: baseDetail };
    case "processing": {
      await client.query(
        `update payments set status='processing', last_event_at=greatest(coalesce(last_event_at,$2),$2), updated_at=now() where id=$1`,
        [payment.id, event.occurredAt]
      );
      return { outcome: "applied", detail: { ...baseDetail, to: "processing" } };
    }
    case "failed": {
      await client.query(
        `update payments set status='failed', outcome='failed', failure_code=$2,
                last_event_at=greatest(coalesce(last_event_at,$3),$3), updated_at=now()
          where id=$1`,
        [payment.id, sanitizeCode(event.failureCode), event.occurredAt]
      );
      const info = await loadRequestTripInfo(client, payment.request_id);
      const stillPayable = info !== null && info.requestStatus === "payment_pending" && (await holdIsValid(client, payment.request_id));
      if (stillPayable) {
        await notify(client, {
          userId: payment.payer_user_id,
          category: "payment",
          kind: "payment_failed",
          title: "Pago no completado",
          body: "El pago no se ha podido completar. Puedes volver a intentarlo mientras tu plaza siga reservada provisionalmente.",
          data: { paymentId: payment.id, requestId: payment.request_id }
        });
      }
      return { outcome: "applied", detail: { ...baseDetail, to: "failed", notified: stillPayable } };
    }
    case "expired": {
      await client.query(
        `update payments set status='expired', outcome='expired', last_event_at=greatest(coalesce(last_event_at,$2),$2), updated_at=now() where id=$1`,
        [payment.id, event.occurredAt]
      );
      return { outcome: "applied", detail: { ...baseDetail, to: "expired" } };
    }
    case "succeeded":
      return settleSucceeded(client, payment, event);
  }
}

async function holdIsValid(client: PoolClient, requestId: string): Promise<boolean> {
  const result = await client.query<{ valid: boolean }>(
    `select exists(select 1 from seat_holds where request_id=$1 and status='active' and expires_at > now()) as valid`,
    [requestId]
  );
  return result.rows[0]!.valid;
}

type UnallocatedCase = {
  outcome: Extract<PaymentOutcome, "amount_mismatch" | "duplicate_payment" | "late_payment" | "request_not_payable">;
  reason: "hold_expired" | "duplicate_payment" | "other";
  action: "refund_required" | "manual_review";
  origin: "late_payment" | "other";
  proposeFull: boolean;
};

async function settleSucceeded(client: PoolClient, payment: LockedPayment, event: PaymentEvent): Promise<Applied> {
  const collected = event.amountCents;
  if (!positiveSafeInteger(collected)) throw bad("importe cobrado (céntimos enteros)"); // ya validado; sirve de estrechamiento
  const info = await loadRequestTripInfo(client, payment.request_id);
  if (!info) throw new Error(`payment ${payment.id} references a missing request`);

  const holdResult = await client.query<{ id: string; status: string; valid: boolean }>(
    `select id, status::text as status, (expires_at > now()) as valid from seat_holds where request_id=$1 for update`,
    [payment.request_id]
  );
  const hold = holdResult.rows[0] ?? null;
  const bookingResult = await client.query<{ id: string }>(`select id from bookings where request_id=$1`, [payment.request_id]);
  const existingBooking = bookingResult.rows[0] ?? null;

  const currencyOk = event.currency === null || event.currency.toUpperCase() === "EUR";
  if (collected !== payment.amount_cents || !currencyOk) {
    return settleUnallocated(client, payment, info, collected, event.occurredAt, {
      outcome: "amount_mismatch",
      reason: "other",
      action: "manual_review",
      origin: "other",
      proposeFull: false
    });
  }
  if (existingBooking) {
    return settleUnallocated(client, payment, info, collected, event.occurredAt, {
      outcome: "duplicate_payment",
      reason: "duplicate_payment",
      action: "refund_required",
      origin: "other",
      proposeFull: true
    });
  }

  const payable = info.requestStatus === "payment_pending" && hold !== null && hold.status === "active" && hold.valid;
  if (!payable || hold === null) {
    // Pago tardío: la plaza ya no está retenida para esta solicitud. NO se crea reserva (sin sobre-reserva).
    if (hold && hold.status === "active") {
      await client.query(`update seat_holds set status='released', released_at=now() where id=$1`, [hold.id]);
    }
    const lateStatuses = ["payment_pending", "accepted", "expired"];
    if (lateStatuses.includes(info.requestStatus)) {
      await client.query(`update ride_requests set status='payment_late', updated_at=now() where id=$1`, [payment.request_id]);
    }
    const late = lateStatuses.includes(info.requestStatus) || info.requestStatus === "payment_late";
    return settleUnallocated(client, payment, info, collected, event.occurredAt, {
      outcome: late ? "late_payment" : "request_not_payable",
      reason: late ? "hold_expired" : "other",
      action: "refund_required",
      origin: "late_payment",
      proposeFull: true
    });
  }

  // ── Reserva confirmada ──
  const breakdown = parseBreakdown(payment.breakdown);
  const inserted = await client.query<{ id: string }>(
    `insert into bookings(request_id,provider_payment_id,amount_cents,status)
     values($1,$2,$3,'confirmed')
     returning id`,
    [payment.request_id, payment.provider_payment_ref, collected]
  );
  const bookingId = inserted.rows[0]!.id;
  await client.query(`update seat_holds set status='consumed', consumed_at=now() where id=$1`, [hold.id]);
  await client.query(`update ride_requests set status='confirmed', updated_at=now() where id=$1`, [payment.request_id]);
  await client.query(
    `update payments
        set status='succeeded', outcome='booking_confirmed', booking_id=$2, collected_cents=$3, succeeded_at=now(),
            last_event_at=greatest(coalesce(last_event_at,$4),$4), updated_at=now()
      where id=$1`,
    [payment.id, bookingId, collected, event.occurredAt]
  );
  await postCharge(client, {
    paymentId: payment.id,
    bookingId,
    passengerUserId: payment.payer_user_id,
    driverUserId: info.driverUserId,
    breakdown
  });
  const lines: Array<{ key: "contribution" | "platform_fee" | "processing" | "taxes"; cents: number }> = [
    { key: "contribution", cents: breakdown.contributionCents },
    { key: "platform_fee", cents: breakdown.passengerCommissionCents }
  ];
  if (breakdown.processingCents > 0) lines.push({ key: "processing", cents: breakdown.processingCents });
  if (breakdown.taxesCents > 0) lines.push({ key: "taxes", cents: breakdown.taxesCents });
  await issueReceipt(client, {
    userId: payment.payer_user_id,
    kind: "payment",
    paymentId: payment.id,
    bookingId,
    counterpartUserId: info.driverUserId,
    totalCents: collected,
    lines,
    trip: info.trip
  });

  const users = await loadPublicUsers(client, [payment.payer_user_id, info.driverUserId]);
  const driver = userFrom(users, info.driverUserId);
  const passenger = userFrom(users, payment.payer_user_id);
  const route = `${info.trip.originLabel ?? "el origen"} → ${info.trip.destinationLabel ?? "el destino"}`;
  await notify(client, {
    userId: payment.payer_user_id,
    category: "payment",
    kind: "payment_confirmed",
    title: "Pago confirmado",
    body: `Hemos confirmado tu pago de ${formatEuros(collected)}. Tu plaza con ${driver.firstName} (${route}) está reservada.`,
    data: { paymentId: payment.id, bookingId, tripId: info.trip.tripId, requestId: payment.request_id }
  });
  await notify(client, {
    userId: info.driverUserId,
    category: "trip",
    kind: "booking_confirmed",
    title: "Nueva reserva confirmada",
    body: `${passenger.firstName} ha confirmado su plaza en tu viaje (${route}).`,
    data: { bookingId, tripId: info.trip.tripId, requestId: payment.request_id }
  });
  await writeAudit(client, {
    actorUserId: null,
    action: "payment.succeeded",
    entityType: "payment",
    entityId: payment.id,
    metadata: { outcome: "booking_confirmed", bookingId, amountCents: collected }
  });
  return { outcome: "applied", detail: { paymentId: payment.id, to: "succeeded", outcome: "booking_confirmed", bookingId } };
}

/**
 * Dinero cobrado SIN reserva (pago tardío, duplicado, importe distinto): queda en cuenta de suspenso, se registra la
 * compensación de la capa base y se abre una propuesta de devolución para Administración. Nunca se crea reserva.
 */
async function settleUnallocated(
  client: PoolClient,
  payment: LockedPayment,
  info: RequestTripInfo,
  collected: number,
  occurredAt: Date,
  unallocated: UnallocatedCase
): Promise<Applied> {
  const inserted = await client.query<{ id: string }>(
    `insert into payment_compensations(request_id,provider_payment_id,amount_cents,reason,action,status)
     values($1,$2,$3,$4,$5,'pending')
     on conflict (provider_payment_id) do nothing
     returning id`,
    [payment.request_id, payment.provider_payment_ref, collected, unallocated.reason, unallocated.action]
  );
  let compensationId = inserted.rows[0]?.id;
  if (!compensationId) {
    const existing = await client.query<{ id: string }>(`select id from payment_compensations where provider_payment_id=$1`, [
      payment.provider_payment_ref
    ]);
    compensationId = existing.rows[0]!.id;
  }
  await client.query(
    `update payments
        set status='succeeded', outcome=$2, collected_cents=$3, succeeded_at=now(),
            last_event_at=greatest(coalesce(last_event_at,$4),$4), updated_at=now()
      where id=$1`,
    [payment.id, unallocated.outcome, collected, occurredAt]
  );
  await postUnallocatedCharge(client, { paymentId: payment.id, passengerUserId: payment.payer_user_id, amountCents: collected });

  await client.query(
    `insert into refund_requests(origin,status,request_id,payment_id,compensation_id,trip_id,passenger_user_id,driver_user_id,
                                 cancelled_by,paid_cents,proposed_cents,retained_commission_cents,policy_status)
     values($1,'pending_review',$2,$3,$4,$5,$6,$7,'system',$8,$9,$10,'pending_review')
     on conflict (compensation_id) where compensation_id is not null do nothing`,
    [
      unallocated.origin,
      payment.request_id,
      payment.id,
      compensationId,
      info.trip.tripId,
      payment.payer_user_id,
      info.driverUserId,
      collected,
      unallocated.proposeFull ? collected : null,
      unallocated.proposeFull ? 0 : null
    ]
  );

  const underReview = unallocated.outcome === "amount_mismatch" || unallocated.outcome === "duplicate_payment";
  await notify(client, {
    userId: payment.payer_user_id,
    category: "payment",
    kind: underReview ? "payment_under_review" : "payment_late_refund_pending",
    title: underReview ? "Pago en revisión" : "Pago recibido sin plaza",
    body: underReview
      ? "Hemos recibido tu pago, pero necesita una revisión manual de Administración. Te avisaremos del resultado."
      : "Hemos recibido tu pago, pero la reserva provisional de la plaza había caducado y no hemos podido confirmarla. Administración revisará la devolución; no tienes que hacer nada.",
    data: { paymentId: payment.id, requestId: payment.request_id, tripId: info.trip.tripId }
  });
  await writeAudit(client, {
    actorUserId: null,
    action: "payment.succeeded_without_booking",
    entityType: "payment",
    entityId: payment.id,
    metadata: { outcome: unallocated.outcome, collectedCents: collected, compensationId }
  });
  return {
    outcome: "compensation_created",
    detail: { paymentId: payment.id, to: "succeeded", outcome: unallocated.outcome, compensationId, collectedCents: collected }
  };
}

/* ───────────────────────── Devoluciones ───────────────────────── */

type RefundLocked = {
  id: string;
  status: string;
  payment_id: string | null;
  booking_id: string | null;
  request_id: string;
  compensation_id: string | null;
  passenger_user_id: string;
  driver_user_id: string | null;
  approved_cents: number | null;
};

async function applyRefundEvent(client: PoolClient, event: RefundEvent): Promise<Applied> {
  const found = await client.query<RefundLocked>(
    `select id,status,payment_id,booking_id,request_id,compensation_id,passenger_user_id,driver_user_id,approved_cents
       from refund_requests where provider_refund_ref=$1 for update`,
    [event.providerRefundRef]
  );
  const refund = found.rows[0];
  if (!refund) {
    throw new DomainError("PAYMENT_UNKNOWN", "El evento se refiere a una devolución que este servidor no conoce (todavía).", 409);
  }
  const baseDetail = { refundId: refund.id, current: refund.status, eventType: event.type };
  if (!refund.payment_id) return { outcome: "ignored_conflict", detail: { ...baseDetail, reason: "refund_without_payment" } };

  const lockedPayment = await client.query<LockedPayment>(
    `select ${LOCKED_PAYMENT_COLUMNS} from payments where id=$1 for update`,
    [refund.payment_id]
  );
  const payment = lockedPayment.rows[0]!;
  if (payment.provider_payment_ref !== event.providerPaymentRef) {
    return { outcome: "ignored_conflict", detail: { ...baseDetail, reason: "payment_reference_mismatch" } };
  }

  if (event.type === "failed") {
    if (refund.status === "failed") return { outcome: "ignored_stale", detail: baseDetail };
    if (refund.status !== "executing" && refund.status !== "approved") return { outcome: "ignored_conflict", detail: baseDetail };
    await client.query(
      `update refund_requests set status='failed', execution_status='failed', failure_code=$2, updated_at=now() where id=$1`,
      [refund.id, sanitizeCode(event.failureCode) ?? "refund_failed"]
    );
    await writeAudit(client, {
      actorUserId: null,
      action: "refund.failed",
      entityType: "refund_request",
      entityId: refund.id,
      metadata: { failureCode: sanitizeCode(event.failureCode) }
    });
    return { outcome: "applied", detail: { ...baseDetail, to: "failed" } };
  }

  // succeeded
  if (refund.status === "refunded") return { outcome: "ignored_stale", detail: baseDetail };
  if (refund.status !== "approved" && refund.status !== "executing" && refund.status !== "failed") {
    return { outcome: "ignored_conflict", detail: { ...baseDetail, reason: "refund_not_approved" } };
  }
  const approved = refund.approved_cents;
  if (approved === null || approved !== event.amountCents) {
    return { outcome: "ignored_conflict", detail: { ...baseDetail, reason: "amount_mismatch", eventCents: event.amountCents } };
  }
  const newRefunded = payment.refunded_cents + approved;
  if (newRefunded > (payment.collected_cents ?? payment.amount_cents)) {
    return { outcome: "ignored_conflict", detail: { ...baseDetail, reason: "exceeds_collected" } };
  }
  await client.query(
    `update refund_requests
        set status='refunded', execution_status='succeeded', refunded_at=now(), failure_code=null, updated_at=now()
      where id=$1`,
    [refund.id]
  );
  await client.query(
    `update payments
        set refunded_cents=$2::integer,
            status=case when $2::integer = coalesce(collected_cents, amount_cents) then 'refunded' else status end,
            outcome=case when $2::integer = coalesce(collected_cents, amount_cents) then 'refunded' else outcome end,
            updated_at=now()
      where id=$1`,
    [payment.id, newRefunded]
  );
  if (refund.compensation_id) {
    await client.query(`update payment_compensations set status='completed' where id=$1`, [refund.compensation_id]);
  }
  await postRefundExecuted(client, {
    refundId: refund.id,
    paymentId: payment.id,
    bookingId: refund.booking_id,
    passengerUserId: refund.passenger_user_id,
    amountCents: approved
  });
  const info = await loadRequestTripInfo(client, refund.request_id);
  await issueReceipt(client, {
    userId: refund.passenger_user_id,
    kind: "refund",
    paymentId: payment.id,
    bookingId: refund.booking_id,
    refundRequestId: refund.id,
    counterpartUserId: refund.driver_user_id,
    totalCents: approved,
    lines: [{ key: "refund", cents: approved }],
    trip: info?.trip ?? null
  });
  await notify(client, {
    userId: refund.passenger_user_id,
    category: "payment",
    kind: "refund_completed",
    title: "Devolución completada",
    body: `El proveedor de pagos ha confirmado la devolución de ${formatEuros(approved)}. El plazo en que la verás en tu cuenta depende de tu banco.`,
    data: { refundId: refund.id, paymentId: payment.id }
  });
  await writeAudit(client, {
    actorUserId: null,
    action: "refund.succeeded",
    entityType: "refund_request",
    entityId: refund.id,
    metadata: { amountCents: approved, paymentId: payment.id }
  });
  return { outcome: "applied", detail: { ...baseDetail, to: "refunded", amountCents: approved } };
}

/* ───────────────────────── Abonos al conductor ───────────────────────── */

type PayoutLocked = { id: string; driver_user_id: string; status: string; net_cents: string; period_month: string };

function monthLabelEs(periodMonth: string): string {
  return new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${periodMonth.slice(0, 7)}-01T00:00:00Z`)
  );
}

async function applyPayoutEvent(client: PoolClient, event: PayoutEvent): Promise<Applied> {
  const found = await client.query<PayoutLocked>(
    `select id,driver_user_id,status,net_cents::text as net_cents,period_month::text as period_month
       from payout_runs where provider_payout_ref=$1 for update`,
    [event.providerPayoutRef]
  );
  const run = found.rows[0];
  if (!run) throw new DomainError("PAYMENT_UNKNOWN", "El evento se refiere a un abono que este servidor no conoce (todavía).", 409);
  const baseDetail = { payoutRunId: run.id, current: run.status, eventType: event.type };
  const net = num(run.net_cents);

  if (event.type === "failed") {
    if (run.status === "failed") return { outcome: "ignored_stale", detail: baseDetail };
    if (run.status !== "processing") return { outcome: "ignored_conflict", detail: baseDetail };
    await client.query(`update payout_runs set status='failed', failure_code=$2, updated_at=now() where id=$1`, [
      run.id,
      sanitizeCode(event.failureCode) ?? "payout_failed"
    ]);
    await writeAudit(client, {
      actorUserId: null,
      action: "payout.failed",
      entityType: "payout_run",
      entityId: run.id,
      metadata: { failureCode: sanitizeCode(event.failureCode) }
    });
    return { outcome: "applied", detail: { ...baseDetail, to: "failed" } };
  }

  if (run.status === "paid") return { outcome: "ignored_stale", detail: baseDetail };
  if (run.status !== "processing" && run.status !== "failed") return { outcome: "ignored_conflict", detail: baseDetail };
  if (event.amountCents !== net) {
    return { outcome: "ignored_conflict", detail: { ...baseDetail, reason: "amount_mismatch", eventCents: event.amountCents } };
  }
  await client.query(`update payout_runs set status='paid', paid_at=now(), failure_code=null, updated_at=now() where id=$1`, [run.id]);
  await postPayout(client, { payoutRunId: run.id, driverUserId: run.driver_user_id, amountCents: net });

  const totals = await client.query<{ contribution: string; commission: string }>(
    `select coalesce(sum((p.breakdown->>'contributionCents')::bigint),0)::text as contribution,
            coalesce(sum((p.breakdown->>'driverCommissionCents')::bigint),0)::text as commission
       from payout_run_items i join payments p on p.booking_id=i.booking_id
      where i.payout_run_id=$1`,
    [run.id]
  );
  const contribution = num(totals.rows[0]!.contribution);
  const commission = num(totals.rows[0]!.commission);
  const adjustments = Math.max(0, contribution - commission - net);
  await issueReceipt(client, {
    userId: run.driver_user_id,
    kind: "earning_statement",
    payoutRunId: run.id,
    totalCents: net,
    lines: [
      { key: "contribution", cents: contribution },
      { key: "driver_commission", cents: commission },
      { key: "refund_adjustments", cents: adjustments },
      { key: "net", cents: net }
    ],
    trip: null
  });
  await notify(client, {
    userId: run.driver_user_id,
    category: "payment",
    kind: "payout_paid",
    title: "Liquidación abonada",
    body: `El proveedor de pagos ha confirmado el abono de ${formatEuros(net)} correspondiente a ${monthLabelEs(run.period_month)}.`,
    data: { payoutRunId: run.id }
  });
  await writeAudit(client, {
    actorUserId: null,
    action: "payout.paid",
    entityType: "payout_run",
    entityId: run.id,
    metadata: { netCents: net }
  });
  return { outcome: "applied", detail: { ...baseDetail, to: "paid", netCents: net } };
}
