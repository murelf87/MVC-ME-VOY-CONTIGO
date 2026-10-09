/**
 * Pago de una solicitud aceptada (pantalla 16): contexto, creación del intento y sondeo del estado.
 * Porta `src/modules/money/{payments,request-payment}.ts` sobre el proveedor SIMULADO de la vista previa.
 *
 *   GET  /v1/ride-requests/:id/payment          → RequestPaymentContext (resumen, cuenta atrás del hold, ¿se puede pagar?)
 *   POST /v1/ride-requests/:id/payment-intents  → intento de pago (Idempotency-Key OBLIGATORIA: nunca cobra dos veces)
 *   GET  /v1/payments/:id                       → PaymentView (sondeo; lo decide solo el «servidor»)
 *
 * Reglas del contrato: aceptada ≠ confirmada — la reserva solo existe cuando el servidor confirma el pago Y el hold seguía
 * activo; si el pago llega tarde NO hay reserva (`late_payment`) y se tramita la devolución; con el proveedor desactivado
 * (estado real hoy) todo responde «Pagos aún no disponibles» y no se cobra nada. El «proveedor» confirma ~2 s después de
 * crear el intento; una tarjeta guardada acabada en 0002 es rechazada (`card_declined`).
 *
 * SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`). Nada de esto existe en producción.
 */
import type {
  ChargeMethodOption,
  CreatePaymentIntentRequest,
  CreatePaymentIntentResponse,
  Money,
  PaymentBlockReason,
  PaymentHoldView,
  PaymentOutcome,
  PaymentRequestStatus,
  PaymentStatus,
  PaymentSummary,
  PaymentView,
  RequestPaymentContext,
} from "@/api/types";
import { activeMethods, availabilityDto, methodDto } from "@/features/account/preview/moneyViews";
import { moneyTables, readConfig } from "@/features/account/preview/moneyRows";
import { confirmProviderPayment, expireStaleHolds, fail, isoReq, moneyIllustrative, moneyPending, publicUser, type PreviewDb } from "@/preview";
import { loadTripGeometry } from "./browseGeometry";
import { metaFor } from "./browseMeta";
import { quoteOfRequest } from "./requestDetail";

/** Los intentos de pago de la vista previa. */
export interface PaymentAttemptRow {
  id: string;
  request_id: string;
  user_id: string;
  amount_cents: number;
  method_kind: "apple_pay" | "google_pay" | "card";
  method_id: string | null;
  masked_label: string | null;
  status: PaymentStatus;
  outcome: PaymentOutcome;
  failure_code: string | null;
  booking_id: string | null;
  created_at: number;
  updated_at: number;
  succeeded_at: number | null;
}

export const paymentAttempts = (db: PreviewDb) => db.collection<PaymentAttemptRow>("request_payment_attempts");

/** Segundos que tarda el «proveedor» simulado en confirmar el pago. */
const PROVIDER_LATENCY_MS = 2000;
const DECLINED_LAST4 = "0002";

/** En la vista previa no hay tarifa aprobada por administración: los importes definidos salen siempre «ilustrativos». */
function moneyOf(cents: number | null): Money {
  return cents === null ? moneyPending() : moneyIllustrative(cents);
}

function loadOwnRequest(db: PreviewDb, requestId: string, userId: string) {
  expireStaleHolds(db);
  const row = db.rideRequests.get(requestId);
  const trip = row ? db.trips.get(row.trip_id) : undefined;
  if (!row || !trip || row.passenger_user_id !== userId) return fail("REQUEST_NOT_FOUND", "La solicitud no existe.", 404);
  return { row, trip };
}

function paymentView(attempt: Readonly<PaymentAttemptRow>, db: PreviewDb): PaymentView {
  const saved = attempt.method_id ? moneyTables(db).methods.get(attempt.method_id) : undefined;
  return {
    id: attempt.id,
    requestId: attempt.request_id,
    bookingId: attempt.booking_id,
    status: attempt.status,
    outcome: attempt.outcome,
    amount: moneyIllustrative(attempt.amount_cents),
    refunded: moneyIllustrative(0),
    method: { kind: attempt.method_kind, maskedLabel: saved?.masked_label ?? attempt.masked_label },
    failureCode: attempt.failure_code,
    createdAt: isoReq(attempt.created_at),
    updatedAt: isoReq(attempt.updated_at),
    succeededAt: attempt.succeeded_at === null ? null : isoReq(attempt.succeeded_at),
  };
}

/** El «webhook firmado» del proveedor: se aplica la primera vez que alguien consulta el pago pasado su plazo. */
function settle(db: PreviewDb, attempt: Readonly<PaymentAttemptRow>): Readonly<PaymentAttemptRow> {
  if (attempt.status !== "processing" || db.nowMs() - attempt.created_at < PROVIDER_LATENCY_MS) return attempt;
  const now = db.nowMs();
  const saved = attempt.method_id ? moneyTables(db).methods.get(attempt.method_id) : undefined;
  if (saved && saved.last4 === DECLINED_LAST4) {
    return paymentAttempts(db).update(attempt.id, { status: "failed", outcome: "failed", failure_code: "card_declined", updated_at: now });
  }
  const confirmation = confirmProviderPayment(db, { requestId: attempt.request_id, providerPaymentId: attempt.id, amountCents: attempt.amount_cents });
  if (confirmation.status === "confirmed") {
    return paymentAttempts(db).update(attempt.id, {
      status: "succeeded",
      outcome: "booking_confirmed",
      booking_id: confirmation.bookingId,
      succeeded_at: now,
      updated_at: now,
    });
  }
  // Pagó con el hold caducado: no hay reserva; Administración tramita la devolución.
  return paymentAttempts(db).update(attempt.id, { status: "succeeded", outcome: "late_payment", succeeded_at: now, updated_at: now });
}

function blockReason(db: PreviewDb, requestStatus: PaymentRequestStatus, holdActive: boolean, hasOpenAttempt: boolean, amountDefined: boolean): PaymentBlockReason | null {
  if (requestStatus === "confirmed") return { code: "REQUEST_ALREADY_PAID", message: "Esta reserva ya está pagada." };
  if (requestStatus !== "payment_pending" && requestStatus !== "accepted") {
    return { code: "REQUEST_NOT_PAYABLE", message: "Esta solicitud no se puede pagar ahora mismo." };
  }
  if (!holdActive) return { code: "HOLD_EXPIRED", message: "La plaza reservada ha caducado. Vuelve a solicitarla." };
  if (hasOpenAttempt) return { code: "PAYMENT_ALREADY_OPEN", message: "Ya hay un pago en curso para esta solicitud." };
  if (!readConfig(db).provider_enabled) return { code: "PAYMENTS_PROVIDER_DISABLED", message: "Pagos aún no disponibles" };
  if (!amountDefined) return { code: "PAYMENT_AMOUNT_NOT_DEFINED", message: "El importe todavía no está definido." };
  return null;
}

export function requestPaymentContext(db: PreviewDb, userId: string, requestId: string): RequestPaymentContext {
  const { row, trip } = loadOwnRequest(db, requestId, userId);
  const config = readConfig(db);
  const availability = availabilityDto(config);
  const requestStatus: PaymentRequestStatus = row.status;
  const hold = db.seatHolds.find((h) => h.request_id === row.id);
  const now = db.nowMs();
  const holdActive = hold !== undefined && hold.status === "active" && hold.expires_at > now;
  const holdView: PaymentHoldView = hold
    ? {
        status: hold.status === "active" && !holdActive ? "released" : hold.status,
        expiresAt: isoReq(hold.expires_at),
        secondsRemaining: holdActive ? Math.max(0, Math.floor((hold.expires_at - now) / 1000)) : null,
      }
    : { status: "none", expiresAt: null, secondsRemaining: null };

  const quote = quoteOfRequest(db, row);
  const amountDefined = quote.total.cents !== null;
  const attempts = paymentAttempts(db)
    .filter((a) => a.request_id === row.id)
    .sort((a, b) => b.created_at - a.created_at)
    .map((a) => settle(db, a));
  const last = attempts[0];
  const open = last !== undefined && (last.status === "processing" || last.status === "requires_action");
  const reason = blockReason(db, requestStatus, holdActive, open, amountDefined);

  const meta = metaFor(db, trip.id);
  const geo = loadTripGeometry(db, trip, meta);
  const booking = db.bookings.find((b) => b.request_id === row.id);
  const methods: ChargeMethodOption[] = (["apple_pay", "google_pay", "card"] as const).map((kind) => ({
    kind,
    available: availability.chargeMethods.includes(kind),
  }));
  const summary: PaymentSummary = {
    contribution: moneyOf(quote.contribution.cents),
    platformFee: moneyOf(quote.managementFee.cents),
    processing: moneyPending(),
    taxes: moneyPending(),
    total: moneyOf(quote.total.cents),
    tariffVersion: quote.tariff.version,
    quoteSnapshotId: null,
  };
  return {
    requestId: row.id,
    requestStatus,
    driver: publicUser(db, trip.driver_user_id),
    trip: {
      tripId: trip.id,
      departureAt: trip.departure_at === null ? null : isoReq(trip.departure_at),
      originLabel: row.pickup_label ?? geo.stops[0]?.label ?? null,
      destinationLabel: geo.stops[row.dropoff_stop_seq ?? row.to_segment_seq]?.label ?? null,
    },
    hold: holdView,
    availability,
    methods,
    savedMethods: config.provider_enabled ? activeMethods(db, userId, "charge").map(methodDto) : [],
    summary,
    canPay: reason === null,
    cannotPayReason: reason,
    payment: last ? paymentView(last, db) : null,
    bookingId: booking?.id ?? null,
  };
}

export function createPaymentIntent(db: PreviewDb, userId: string, requestId: string, body: CreatePaymentIntentRequest): CreatePaymentIntentResponse {
  const context = requestPaymentContext(db, userId, requestId);
  if (context.cannotPayReason) {
    const details = context.cannotPayReason.code === "PAYMENT_ALREADY_OPEN" && context.payment ? { paymentId: context.payment.id } : undefined;
    return fail(context.cannotPayReason.code, context.cannotPayReason.message, 409, details);
  }
  const kind = body.method.kind;
  const option = context.methods.find((m) => m.kind === kind);
  if (!option || !option.available) return fail("PAYMENT_METHOD_NOT_AVAILABLE", "Este método de pago no está disponible.", 409);
  let masked: string | null = null;
  if (body.method.paymentMethodId !== undefined) {
    const saved = moneyTables(db).methods.get(body.method.paymentMethodId);
    if (!saved || saved.user_id !== userId || saved.removed_at !== null || saved.purpose !== "charge") {
      return fail("PAYMENT_METHOD_NOT_FOUND", "La tarjeta elegida no existe.", 404);
    }
    masked = saved.masked_label;
  }
  const row = db.rideRequests.get(requestId);
  const quote = row ? quoteOfRequest(db, row) : null;
  const cents = quote?.total.cents ?? null;
  if (cents === null) return fail("PAYMENT_AMOUNT_NOT_DEFINED", "El importe todavía no está definido.", 409);
  const now = db.nowMs();
  const attempt = paymentAttempts(db).insert({
    id: db.ids.uuid(),
    request_id: requestId,
    user_id: userId,
    amount_cents: cents,
    method_kind: kind,
    method_id: body.method.paymentMethodId ?? null,
    masked_label: masked,
    status: "processing",
    outcome: "awaiting_payment",
    failure_code: null,
    booking_id: null,
    created_at: now,
    updated_at: now,
    succeeded_at: null,
  });
  return {
    payment: paymentView(attempt, db),
    clientAction: { type: "sdk_payment_sheet", clientSecret: `pi_sim_${attempt.id}_secret`, redirectUrl: null },
  };
}

export function getPayment(db: PreviewDb, userId: string, paymentId: string): PaymentView {
  const attempt = paymentAttempts(db).get(paymentId);
  if (!attempt || attempt.user_id !== userId) return fail("PAYMENT_NOT_FOUND", "El pago no existe.", 404);
  expireStaleHolds(db);
  return paymentView(settle(db, attempt), db);
}
