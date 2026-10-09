/**
 * Cliente de red del paquete «solicitar plaza y pagar». Contratos: docs/contracts/trips.md §5–§8 y
 * docs/contracts/money.md §3–§4.
 *
 *   GET  /v1/trips/:tripId                              → TripDetail (cabecera «Sevilla Centro → Universidad», conductor, recurrencia)
 *   GET  /v1/trips/:tripId/pickup-points?lat&lng&…      → PickupPointsResponse (propuestas A/B)
 *   POST /v1/trips/:tripId/quote                        → TripQuoteResponse (aportación; sin efectos)
 *   POST /v1/trips/:tripId/requests                     → RideRequestDetail   (Idempotency-Key)
 *   GET  /v1/ride-requests/:id                          → RideRequestDetail
 *   POST /v1/ride-requests/:id/withdraw                 → RideRequestDetail (solo si está `pending`)
 *   POST /v1/trips/:tripId/weekly-requests/preview      → WeeklyRequestPreview (días y plazas ANTES de crear)
 *   POST /v1/trips/:tripId/weekly-requests              → WeeklyReservation   (Idempotency-Key; una solicitud por día)
 *   GET  /v1/weekly-reservations/:id                    → WeeklyReservation
 *   POST /v1/weekly-reservations/:id/withdraw           → WeeklyReservation
 *   GET  /v1/ride-requests/:id/payment                  → RequestPaymentContext (pantalla 16)
 *   POST /v1/ride-requests/:id/payment-intents          → CreatePaymentIntentResponse (Idempotency-Key OBLIGATORIA)
 *   GET  /v1/payments/:id                               → PaymentView (sondeo: lo decide solo el servidor)
 *
 * Las pantallas NO importan este fichero: pasan por los hooks de `./hooks`. Nada aquí guarda estado ni decide importes.
 */
import { apiRequest, registerErrorMessages, type CallOptions } from "@/api";
import type {
  CreatePaymentIntentRequest,
  CreatePaymentIntentResponse,
  CreateRideRequestBody,
  PaymentView,
  PickupPointsQuery,
  PickupPointsResponse,
  RequestPaymentContext,
  RideRequestDetail,
  TripDetail,
  TripDetailQuery,
  TripQuoteRequest,
  TripQuoteResponse,
  WeeklyRequestBody,
  WeeklyRequestPreview,
  WeeklyReservation,
} from "@/api/types";
import { requestStrings } from "./strings";

/** Opciones de una llamada que crea algo: añade la cabecera `Idempotency-Key`. */
export type MutatingCallOptions = CallOptions & { idempotencyKey?: string };

/**
 * Códigos propios de este paquete (los compartidos con otros paquetes —proveedor de pagos, idempotencia— no se
 * registran aquí: las pantallas del paquete usan `describeRequestError`, que lleva su propio texto).
 */
const e = requestStrings.errors;
registerErrorMessages({
  PICKUP_POINT_INVALID: e.PICKUP_POINT_INVALID,
  PICKUP_POINT_OUTSIDE_PROVINCE: e.PICKUP_POINT_OUTSIDE_PROVINCE,
  PICKUP_NOT_ON_ROUTE: e.PICKUP_NOT_ON_ROUTE,
  PICKUP_DETOUR_TOO_LARGE: e.PICKUP_DETOUR_TOO_LARGE,
  DROPOFF_STOP_INVALID: e.DROPOFF_STOP_INVALID,
  DROPOFF_BEFORE_PICKUP: e.DROPOFF_BEFORE_PICKUP,
  INVALID_REQUEST_SHAPE: e.INVALID_REQUEST_SHAPE,
  INVALID_SEGMENT_RANGE: e.INVALID_SEGMENT_RANGE,
  DRIVER_CANNOT_REQUEST_OWN_TRIP: e.DRIVER_CANNOT_REQUEST_OWN_TRIP,
  DUPLICATE_OPEN_REQUEST: e.DUPLICATE_OPEN_REQUEST,
  REQUEST_NOT_FOUND: e.REQUEST_NOT_FOUND,
  REQUEST_NOT_WITHDRAWABLE: e.REQUEST_NOT_WITHDRAWABLE,
  WEEKLY_START_DATE_IN_PAST: e.WEEKLY_START_DATE_IN_PAST,
  WEEKLY_WEEKDAY_NOT_OFFERED: e.WEEKLY_WEEKDAY_NOT_OFFERED,
  WEEKLY_NO_OCCURRENCES: e.WEEKLY_NO_OCCURRENCES,
  WEEKLY_OCCURRENCE_UNAVAILABLE: e.WEEKLY_OCCURRENCE_UNAVAILABLE,
  SERIES_HAS_NO_RETURN: e.SERIES_HAS_NO_RETURN,
  TRIP_NOT_RECURRING: e.TRIP_NOT_RECURRING,
  INVALID_CANCELLATION_POLICY_VERSION: e.INVALID_CANCELLATION_POLICY_VERSION,
  REQUEST_NOT_PAYABLE: e.REQUEST_NOT_PAYABLE,
  REQUEST_ALREADY_PAID: e.REQUEST_ALREADY_PAID,
  HOLD_EXPIRED: e.HOLD_EXPIRED,
  PAYMENT_AMOUNT_NOT_DEFINED: e.PAYMENT_AMOUNT_NOT_DEFINED,
  PAYMENT_ALREADY_OPEN: e.PAYMENT_ALREADY_OPEN,
  PAYMENT_NOT_FOUND: e.PAYMENT_NOT_FOUND,
});

const enc = encodeURIComponent;

// ── Viaje, puntos de recogida y presupuesto ──────────────────────────────────────────────────────────────────────

export async function fetchTrip(tripId: string, query: TripDetailQuery = {}, options: CallOptions = {}): Promise<TripDetail> {
  return apiRequest<TripDetail>(`/v1/trips/${enc(tripId)}`, { query: { ...query }, ...options });
}

export async function fetchPickupPoints(tripId: string, query: PickupPointsQuery, options: CallOptions = {}): Promise<PickupPointsResponse> {
  return apiRequest<PickupPointsResponse>(`/v1/trips/${enc(tripId)}/pickup-points`, { query: { ...query }, ...options });
}

/** Aportación del tramo elegido (sin efectos): alimenta «Detalle de la aportación» de la pantalla 15. */
export async function fetchQuote(tripId: string, body: TripQuoteRequest, options: CallOptions = {}): Promise<TripQuoteResponse> {
  return apiRequest<TripQuoteResponse>(`/v1/trips/${enc(tripId)}/quote`, { method: "POST", body, ...options });
}

// ── Solicitud de plaza ───────────────────────────────────────────────────────────────────────────────────────────

export async function postRideRequest(tripId: string, body: CreateRideRequestBody, options: MutatingCallOptions = {}): Promise<RideRequestDetail> {
  return apiRequest<RideRequestDetail>(`/v1/trips/${enc(tripId)}/requests`, { method: "POST", body, ...options });
}

export async function fetchRideRequest(requestId: string, options: CallOptions = {}): Promise<RideRequestDetail> {
  return apiRequest<RideRequestDetail>(`/v1/ride-requests/${enc(requestId)}`, options);
}

export async function postWithdrawRideRequest(requestId: string, options: CallOptions = {}): Promise<RideRequestDetail> {
  return apiRequest<RideRequestDetail>(`/v1/ride-requests/${enc(requestId)}/withdraw`, { method: "POST", ...options });
}

// ── Reserva semanal ──────────────────────────────────────────────────────────────────────────────────────────────

export async function postWeeklyPreview(tripId: string, body: WeeklyRequestBody, options: CallOptions = {}): Promise<WeeklyRequestPreview> {
  return apiRequest<WeeklyRequestPreview>(`/v1/trips/${enc(tripId)}/weekly-requests/preview`, { method: "POST", body, ...options });
}

export async function postWeeklyRequest(tripId: string, body: WeeklyRequestBody, options: MutatingCallOptions = {}): Promise<WeeklyReservation> {
  return apiRequest<WeeklyReservation>(`/v1/trips/${enc(tripId)}/weekly-requests`, { method: "POST", body, ...options });
}

export async function fetchWeeklyReservation(reservationId: string, options: CallOptions = {}): Promise<WeeklyReservation> {
  return apiRequest<WeeklyReservation>(`/v1/weekly-reservations/${enc(reservationId)}`, options);
}

export async function postWithdrawWeeklyReservation(reservationId: string, options: CallOptions = {}): Promise<WeeklyReservation> {
  return apiRequest<WeeklyReservation>(`/v1/weekly-reservations/${enc(reservationId)}/withdraw`, { method: "POST", ...options });
}

// ── Pago (módulo money) ──────────────────────────────────────────────────────────────────────────────────────────

export async function fetchRequestPayment(requestId: string, options: CallOptions = {}): Promise<RequestPaymentContext> {
  return apiRequest<RequestPaymentContext>(`/v1/ride-requests/${enc(requestId)}/payment`, options);
}

/** `Idempotency-Key` OBLIGATORIA: la misma clave devuelve el mismo intento, nunca cobra dos veces. */
export async function postPaymentIntent(
  requestId: string,
  body: CreatePaymentIntentRequest,
  options: CallOptions & { idempotencyKey: string },
): Promise<CreatePaymentIntentResponse> {
  return apiRequest<CreatePaymentIntentResponse>(`/v1/ride-requests/${enc(requestId)}/payment-intents`, { method: "POST", body, ...options });
}

/** Estado del pago. Solo el servidor decide: un pago está `succeeded` cuando llegó la confirmación firmada del proveedor. */
export async function fetchPayment(paymentId: string, options: CallOptions = {}): Promise<PaymentView> {
  return apiRequest<PaymentView>(`/v1/payments/${enc(paymentId)}`, options);
}
