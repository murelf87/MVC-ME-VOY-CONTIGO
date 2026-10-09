import type { Pool } from "pg";
import type { AuthPrincipal } from "../../../auth/session.js";
import { DomainError } from "../../../errors.js";
import { writeAudit } from "../../../lib/audit.js";
import type { Queryable } from "../lib/db.js";
import { toIso, toIsoRequired } from "../lib/db.js";
import { withIdempotency, type IdempotentOutcome } from "../lib/idempotency.js";
import { deterministicUuid, providerIdempotencyKey } from "../lib/ids.js";
import { centsToMoney, loadPublicUsers, STOP_LABEL_JOINS, tripRef, userFrom } from "../lib/people.js";
import { callProvider } from "../provider/call.js";
import { PAYMENTS_DISABLED_MESSAGE } from "../provider/disabled.js";
import type { PaymentProvider } from "../provider/types.js";
import type {
  ChargeMethodKind,
  ChargeMethodOptionDto,
  CreatePaymentIntentResponseDto,
  PaymentBlockCode,
  PaymentBlockReasonDto,
  PaymentHoldStatus,
  PaymentHoldViewDto,
  PaymentMethodKind,
  PaymentOutcome,
  PaymentRequestStatus,
  PaymentStatus,
  PaymentViewDto,
  RequestPaymentContextDto
} from "../types.js";
import { ALL_CHARGE_METHODS, describeAvailability } from "./availability.js";
import { listMethodRows, methodMaskedLabel, toMethodDto } from "./methods-service.js";
import { loadQuote, quoteToSummary } from "./quote.js";

/* ───────────────────────── Filas y vista de un pago ───────────────────────── */

export type PaymentRow = {
  id: string;
  request_id: string;
  payer_user_id: string;
  provider: string;
  provider_payment_ref: string;
  amount_cents: number;
  collected_cents: number | null;
  status: PaymentStatus;
  outcome: PaymentOutcome;
  method_kind: PaymentMethodKind;
  payment_method_id: string | null;
  cancellation_policy_id: string | null;
  breakdown: unknown;
  booking_id: string | null;
  refunded_cents: number;
  failure_code: string | null;
  succeeded_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  mm_kind: PaymentMethodKind | null;
  mm_last4: string | null;
  mm_country: string | null;
};

export const PAYMENT_SELECT = `p.id,p.request_id,p.payer_user_id,p.provider,p.provider_payment_ref,p.amount_cents,p.collected_cents,
  p.status,p.outcome,p.method_kind,p.payment_method_id,p.cancellation_policy_id,p.breakdown,p.booking_id,p.refunded_cents,
  p.failure_code,p.succeeded_at,p.created_at,p.updated_at,
  m.kind as mm_kind, m.last4 as mm_last4, m.country as mm_country`;
export const PAYMENT_FROM = `payments p left join payment_methods m on m.id=p.payment_method_id`;

export function toPaymentView(row: PaymentRow): PaymentViewDto {
  return {
    id: row.id,
    requestId: row.request_id,
    bookingId: row.booking_id,
    status: row.status,
    outcome: row.outcome,
    amount: centsToMoney(row.amount_cents),
    refunded: centsToMoney(row.refunded_cents),
    method: {
      kind: row.method_kind,
      maskedLabel: row.mm_kind ? methodMaskedLabel(row.mm_kind, row.mm_last4, row.mm_country) : null
    },
    failureCode: row.failure_code,
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIsoRequired(row.updated_at),
    succeededAt: toIso(row.succeeded_at)
  };
}

export async function loadPaymentView(db: Queryable, paymentId: string): Promise<PaymentViewDto | null> {
  const result = await db.query<PaymentRow>(`select ${PAYMENT_SELECT} from ${PAYMENT_FROM} where p.id=$1`, [paymentId]);
  const row = result.rows[0];
  return row ? toPaymentView(row) : null;
}

/** Solo el pagador ve su pago; cualquier otro usuario recibe 404 (no se filtra la existencia). */
export async function getPaymentForUser(pool: Pool, principal: AuthPrincipal, paymentId: string): Promise<PaymentViewDto> {
  const result = await pool.query<PaymentRow>(
    `select ${PAYMENT_SELECT} from ${PAYMENT_FROM} where p.id=$1 and p.payer_user_id=$2`,
    [paymentId, principal.userId]
  );
  const row = result.rows[0];
  if (!row) throw new DomainError("PAYMENT_NOT_FOUND", "Pago no encontrado.", 404);
  return toPaymentView(row);
}

/* ───────────────────────── Estado de la solicitud y de la reserva provisional ───────────────────────── */

type HeadRow = {
  request_id: string;
  request_status: PaymentRequestStatus;
  passenger_user_id: string;
  trip_id: string;
  driver_user_id: string;
  departure_at: Date | string | null;
  origin_label: string | null;
  destination_label: string | null;
  hold_id: string | null;
  hold_status: "active" | "released" | "consumed" | null;
  hold_expires_at: Date | string | null;
  hold_expired: boolean | null;
  hold_seconds: number | null;
  booking_id: string | null;
};

export type RequestHead = {
  requestId: string;
  requestStatus: PaymentRequestStatus;
  tripId: string;
  driverUserId: string;
  trip: ReturnType<typeof tripRef>;
  hold: PaymentHoldViewDto;
  holdId: string | null;
  bookingId: string | null;
};

function effectiveHold(row: HeadRow): PaymentHoldViewDto {
  if (!row.hold_id || !row.hold_status) return { status: "none", expiresAt: null, secondsRemaining: null };
  const expiresAt = toIso(row.hold_expires_at);
  if (row.hold_status === "active") {
    // Un hold «activo» cuyo plazo ya venció no reserva nada (la disponibilidad solo cuenta holds con `expires_at > now()`).
    if (row.hold_expired) return { status: "released", expiresAt, secondsRemaining: 0 };
    return { status: "active", expiresAt, secondsRemaining: row.hold_seconds ?? 0 };
  }
  const status: PaymentHoldStatus = row.hold_status;
  return { status, expiresAt, secondsRemaining: null };
}

/** La solicitud debe ser del pasajero que consulta; si no existe o es de otra persona → 404 REQUEST_NOT_FOUND. */
export async function loadRequestHead(db: Queryable, requestId: string, passengerUserId: string): Promise<RequestHead> {
  const result = await db.query<HeadRow>(
    `select r.id as request_id, r.status::text as request_status, r.passenger_user_id,
            t.id as trip_id, t.driver_user_id, t.departure_at,
            so.label as origin_label, sd.label as destination_label,
            h.id as hold_id, h.status::text as hold_status, h.expires_at as hold_expires_at,
            (h.expires_at <= now()) as hold_expired,
            greatest(0, floor(extract(epoch from (h.expires_at - now()))))::int as hold_seconds,
            b.id as booking_id
       from ride_requests r
       join trips t on t.id=r.trip_id
       ${STOP_LABEL_JOINS}
       left join seat_holds h on h.request_id=r.id
       left join bookings b on b.request_id=r.id
      where r.id=$1 and r.passenger_user_id=$2`,
    [requestId, passengerUserId]
  );
  const row = result.rows[0];
  if (!row) throw new DomainError("REQUEST_NOT_FOUND", "Solicitud no encontrada.", 404);
  return {
    requestId: row.request_id,
    requestStatus: row.request_status,
    tripId: row.trip_id,
    driverUserId: row.driver_user_id,
    trip: tripRef({
      trip_id: row.trip_id,
      departure_at: row.departure_at,
      origin_label: row.origin_label,
      destination_label: row.destination_label
    }),
    hold: effectiveHold(row),
    holdId: row.hold_id,
    bookingId: row.booking_id
  };
}

/* ───────────────────────── Reglas de «¿se puede pagar ahora?» ───────────────────────── */

export const BLOCK_MESSAGES: Record<PaymentBlockCode, string> = {
  REQUEST_ALREADY_PAID: "Esta solicitud ya está pagada y la plaza reservada.",
  REQUEST_NOT_PAYABLE: "Esta solicitud no se puede pagar en su estado actual.",
  HOLD_EXPIRED: "La reserva provisional de la plaza ha caducado.",
  PAYMENT_ALREADY_OPEN: "Ya hay un pago en curso para esta solicitud.",
  PAYMENTS_PROVIDER_DISABLED: PAYMENTS_DISABLED_MESSAGE,
  PAYMENT_AMOUNT_NOT_DEFINED: "El importe todavía no está definido: la tarifa está pendiente de aprobación."
};

export type PayabilityInput = {
  requestStatus: PaymentRequestStatus;
  hasBooking: boolean;
  hold: PaymentHoldViewDto;
  openPaymentId: string | null;
  providerEnabled: boolean;
  quoteDefined: boolean;
};

/** Prioridad documentada en docs/contracts/money.md §4.1. */
export function evaluatePayability(input: PayabilityInput): PaymentBlockReasonDto | null {
  const block = (code: PaymentBlockCode): PaymentBlockReasonDto => ({ code, message: BLOCK_MESSAGES[code] });
  if (input.hasBooking || input.requestStatus === "confirmed") return block("REQUEST_ALREADY_PAID");
  if (input.requestStatus !== "payment_pending") return block("REQUEST_NOT_PAYABLE");
  if (input.hold.status !== "active") return block("HOLD_EXPIRED");
  if (input.openPaymentId) return block("PAYMENT_ALREADY_OPEN");
  if (!input.providerEnabled) return block("PAYMENTS_PROVIDER_DISABLED");
  if (!input.quoteDefined) return block("PAYMENT_AMOUNT_NOT_DEFINED");
  return null;
}

function blockToError(block: PaymentBlockReasonDto, openPaymentId: string | null): DomainError {
  if (block.code === "PAYMENTS_PROVIDER_DISABLED") {
    return new DomainError(
      block.code,
      "Pagos aún no disponibles. Tu plaza sigue reservada provisionalmente, pero todavía no se puede cobrar.",
      409
    );
  }
  return new DomainError(block.code, block.message, 409, block.code === "PAYMENT_ALREADY_OPEN" ? { paymentId: openPaymentId } : undefined);
}

async function findOpenPaymentId(db: Queryable, requestId: string): Promise<string | null> {
  const result = await db.query<{ id: string }>(
    `select id from payments where request_id=$1 and status in ('requires_action','processing') limit 1`,
    [requestId]
  );
  return result.rows[0]?.id ?? null;
}

/* ───────────────────────── Pantalla «Estado y pago» ───────────────────────── */

export async function getRequestPaymentContext(
  pool: Pool,
  provider: PaymentProvider,
  principal: AuthPrincipal,
  requestId: string
): Promise<RequestPaymentContextDto> {
  const head = await loadRequestHead(pool, requestId, principal.userId);
  const [quote, openPaymentId, latest, users, savedRows] = await Promise.all([
    loadQuote(pool, requestId),
    findOpenPaymentId(pool, requestId),
    pool.query<PaymentRow>(
      `select ${PAYMENT_SELECT} from ${PAYMENT_FROM} where p.request_id=$1 order by p.created_at desc, p.id desc limit 1`,
      [requestId]
    ),
    loadPublicUsers(pool, [head.driverUserId]),
    provider.enabled ? listMethodRows(pool, principal.userId, "charge") : Promise.resolve([])
  ]);

  const block = evaluatePayability({
    requestStatus: head.requestStatus,
    hasBooking: head.bookingId !== null,
    hold: head.hold,
    openPaymentId,
    providerEnabled: provider.enabled,
    quoteDefined: quote.defined
  });
  const methods: ChargeMethodOptionDto[] = ALL_CHARGE_METHODS.map(kind => ({
    kind,
    available: provider.enabled && provider.capabilities.chargeMethods.includes(kind)
  }));
  const latestRow = latest.rows[0];
  return {
    requestId: head.requestId,
    requestStatus: head.requestStatus,
    driver: userFrom(users, head.driverUserId),
    trip: head.trip,
    hold: head.hold,
    availability: describeAvailability(provider),
    methods,
    savedMethods: savedRows.filter(row => row.status === "active" || row.status === "requires_action").map(toMethodDto),
    summary: quoteToSummary(quote),
    canPay: block === null,
    cannotPayReason: block,
    payment: latestRow ? toPaymentView(latestRow) : null,
    bookingId: head.bookingId
  };
}

/* ───────────────────────── Crear intento de pago ───────────────────────── */

export type CreatePaymentIntentBody = { method: { kind: ChargeMethodKind; paymentMethodId?: string | undefined } };

/**
 * Crea (o reproduce) el intento de pago de una solicitud. El importe sale SIEMPRE de la cotización congelada del servidor.
 * Nada queda «pagado»: el intento nace en `requires_action`/`processing` y solo un evento firmado del proveedor lo mueve.
 */
export async function createPaymentIntent(
  pool: Pool,
  provider: PaymentProvider,
  principal: AuthPrincipal,
  idempotencyKey: string,
  requestId: string,
  body: CreatePaymentIntentBody
): Promise<IdempotentOutcome<CreatePaymentIntentResponseDto>> {
  return withIdempotency(
    pool,
    {
      userId: principal.userId,
      key: idempotencyKey,
      scope: `payment_intent:${requestId}`,
      fingerprint: { requestId, method: body.method },
      successStatus: 201
    },
    async client => {
      // Orden de bloqueos global del módulo: solicitud → pago → reserva provisional → reserva.
      const locked = await client.query<{ id: string }>(
        `select id from ride_requests where id=$1 and passenger_user_id=$2 for update`,
        [requestId, principal.userId]
      );
      if (!locked.rows[0]) throw new DomainError("REQUEST_NOT_FOUND", "Solicitud no encontrada.", 404);

      const head = await loadRequestHead(client, requestId, principal.userId);
      const [quote, openPaymentId] = await Promise.all([loadQuote(client, requestId), findOpenPaymentId(client, requestId)]);
      const block = evaluatePayability({
        requestStatus: head.requestStatus,
        hasBooking: head.bookingId !== null,
        hold: head.hold,
        openPaymentId,
        providerEnabled: provider.enabled,
        quoteDefined: quote.defined
      });
      if (block) throw blockToError(block, openPaymentId);
      if (!quote.defined) throw blockToError({ code: "PAYMENT_AMOUNT_NOT_DEFINED", message: BLOCK_MESSAGES.PAYMENT_AMOUNT_NOT_DEFINED }, null);

      const kind = body.method.kind;
      if (!provider.capabilities.chargeMethods.includes(kind)) {
        throw new DomainError("PAYMENT_METHOD_NOT_AVAILABLE", "Ese método de pago no está disponible ahora mismo.", 409);
      }
      let savedMethod: { id: string; provider_method_ref: string } | null = null;
      if (body.method.paymentMethodId) {
        const found = await client.query<{ id: string; kind: PaymentMethodKind; provider_method_ref: string }>(
          `select id,kind,provider_method_ref from payment_methods
            where id=$1 and user_id=$2 and purpose='charge' and status='active'`,
          [body.method.paymentMethodId, principal.userId]
        );
        const method = found.rows[0];
        if (!method || method.kind !== kind) {
          throw new DomainError("PAYMENT_METHOD_NOT_AVAILABLE", "El método de pago guardado no está disponible.", 409);
        }
        savedMethod = { id: method.id, provider_method_ref: method.provider_method_ref };
      }

      const paymentId = deterministicUuid(`payment:${principal.userId}:${idempotencyKey}`);
      const created = await callProvider(() =>
        provider.createPaymentIntent({
          idempotencyKey: providerIdempotencyKey("pi", principal.userId, idempotencyKey),
          paymentId,
          amountCents: quote.breakdown.totalCents,
          currency: "EUR",
          method: { kind, providerMethodRef: savedMethod?.provider_method_ref ?? null },
          metadata: { requestId, passengerUserId: principal.userId }
        })
      );

      try {
        await client.query(
          `insert into payments(id,request_id,payer_user_id,provider,provider_payment_ref,amount_cents,status,outcome,method_kind,
                                payment_method_id,quote_snapshot_id,tariff_version_id,cancellation_policy_id,breakdown,hold_id)
           values($1,$2,$3,$4,$5,$6,$7,'awaiting_payment',$8,$9,$10,$11,
                  (select id from cancellation_policies where status='approved' limit 1),$12::jsonb,$13)`,
          [
            paymentId,
            requestId,
            principal.userId,
            provider.name,
            created.providerPaymentRef,
            quote.breakdown.totalCents,
            created.status,
            kind,
            savedMethod?.id ?? null,
            quote.snapshotId,
            quote.tariffVersionId,
            JSON.stringify(quote.breakdown),
            head.holdId
          ]
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new DomainError("PAYMENT_ALREADY_OPEN", BLOCK_MESSAGES.PAYMENT_ALREADY_OPEN, 409);
        }
        throw error;
      }
      await writeAudit(client, {
        actorUserId: principal.userId,
        action: "payment.intent_created",
        entityType: "payment",
        entityId: paymentId,
        metadata: { requestId, amountCents: quote.breakdown.totalCents, methodKind: kind, provider: provider.name }
      });
      const view = await loadPaymentView(client, paymentId);
      return {
        payment: view!,
        clientAction: {
          type: created.clientAction.type,
          clientSecret: created.clientAction.clientSecret,
          redirectUrl: created.clientAction.redirectUrl
        }
      };
    }
  );
}
