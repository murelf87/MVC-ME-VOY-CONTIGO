/**
 * Cliente de red del paquete «pagos y cobros» (docs/contracts/money.md §5–§8.4).
 *
 *   GET    /v1/me/payments/passenger-summary?month=   → PassengerPaymentsSummary   (33 · «Soy pasajero»)
 *   GET    /v1/me/payments/driver-summary?month=      → DriverPaymentsSummary      (33 · «Soy conductor»)
 *   GET    /v1/me/payments?state=&cursor=&limit=      → Page<PassengerPaymentItem> («Ver todos»)
 *   GET    /v1/me/earnings?state=&cursor=&limit=      → Page<DriverEarningItem>
 *   GET    /v1/me/earnings/{bookingId}                → DriverEarningDetail
 *   GET    /v1/me/payment-methods?purpose=            → PaymentMethodsResponse
 *   POST   /v1/me/payment-methods                     → PaymentMethod (201 · Idempotency-Key)
 *   DELETE /v1/me/payment-methods/{methodId}          → { removed: true }
 *   GET    /v1/me/receipts?kind=&cursor=&limit=       → Page<ReceiptSummary>
 *   GET    /v1/me/receipts/{receiptId}                → Receipt
 *   GET    /v1/me/receipts/{receiptId}/printable      → text/html (ver ./printable)
 *   GET    /v1/me/payouts?cursor=&limit=              → MyPayoutsResponse
 *   GET    /v1/me/payouts/{payoutId}                  → PayoutDetail
 *   GET    /v1/me/refunds?cursor=&limit=              → Page<RefundView>
 *
 * Las pantallas NO importan este fichero: pasan por los hooks de `./hooks`. El importe nunca lo decide el cliente: las
 * peticiones no llevan importes y el método de pago viaja como token del proveedor (nunca un número de tarjeta).
 */
import { apiRequest, registerErrorMessages, type CallOptions } from "@/api";
import type { Page } from "@/api/types";
import type {
  AddPaymentMethodRequest,
  DriverEarningDetail,
  DriverEarningItem,
  DriverEarningState,
  DriverPaymentsSummary,
  MyPayoutsResponse,
  PassengerPaymentItem,
  PassengerPaymentState,
  PassengerPaymentsSummary,
  PaymentMethod,
  PaymentMethodPurpose,
  PaymentMethodsResponse,
  PayoutDetail,
  Receipt,
  ReceiptKind,
  ReceiptSummary,
  RefundView,
  RemovePaymentMethodResponse,
} from "@/api/types/money";
import { fetchHtmlDocument } from "./printable";

/** Opciones de las llamadas que CREAN cosas: llevan `Idempotency-Key` (reutilizada al reintentar). */
export type WriteOptions = CallOptions & { idempotencyKey?: string };

/** Códigos propios de este módulo (los compartidos con otros paquetes —proveedor desactivado, pago en curso…— se tratan en `moneyErrors.ts`). */
registerErrorMessages({
  RECEIPT_NOT_FOUND: { title: "Recibo no encontrado", message: "No encontramos este recibo. Puede que no sea tuyo o que ya no esté disponible." },
  PAYOUT_NOT_FOUND: { title: "Liquidación no encontrada", message: "No encontramos esta liquidación. Puede que no sea tuya o que ya no esté disponible." },
  REFUND_NOT_FOUND: { title: "Devolución no encontrada", message: "No encontramos esta devolución. Puede que no sea tuya o que ya no esté disponible." },
  PAYMENT_METHOD_NOT_FOUND: { title: "Método no encontrado", message: "Este método de pago ya no existe. Actualiza la lista." },
  PAYMENT_METHOD_NOT_AVAILABLE: { title: "Método no disponible", message: "El proveedor de pagos no ha aceptado este método. Prueba con otro." },
  RAW_CARD_DATA_REJECTED: {
    title: "Datos de tarjeta no admitidos",
    message: "Nunca guardamos números de tarjeta. El método se añade desde la pantalla segura del proveedor de pagos.",
  },
  PAYMENT_PROVIDER_ERROR: { title: "El proveedor de pagos no responde", message: "No se ha guardado nada. Inténtalo de nuevo en unos minutos." },
});

const enc = encodeURIComponent;

export interface PageQuery {
  cursor?: string | null;
  limit?: number;
}

const PAGE_SIZE = 20;

// ── «Mis pagos y cobros» (pantalla 33) ───────────────────────────────────────────────────────────────────────────

export function getPassengerSummary(month: string | null, options: CallOptions = {}): Promise<PassengerPaymentsSummary> {
  return apiRequest<PassengerPaymentsSummary>("/v1/me/payments/passenger-summary", { query: { month }, ...options });
}

export function getDriverSummary(month: string | null, options: CallOptions = {}): Promise<DriverPaymentsSummary> {
  return apiRequest<DriverPaymentsSummary>("/v1/me/payments/driver-summary", { query: { month }, ...options });
}

export function listPayments(
  query: PageQuery & { state?: PassengerPaymentState | null } = {},
  options: CallOptions = {},
): Promise<Page<PassengerPaymentItem>> {
  return apiRequest<Page<PassengerPaymentItem>>("/v1/me/payments", {
    query: { state: query.state ?? null, cursor: query.cursor ?? null, limit: query.limit ?? PAGE_SIZE },
    ...options,
  });
}

export function listEarnings(
  query: PageQuery & { state?: DriverEarningState | null } = {},
  options: CallOptions = {},
): Promise<Page<DriverEarningItem>> {
  return apiRequest<Page<DriverEarningItem>>("/v1/me/earnings", {
    query: { state: query.state ?? null, cursor: query.cursor ?? null, limit: query.limit ?? PAGE_SIZE },
    ...options,
  });
}

export function getEarning(bookingId: string, options: CallOptions = {}): Promise<DriverEarningDetail> {
  return apiRequest<DriverEarningDetail>(`/v1/me/earnings/${enc(bookingId)}`, options);
}

// ── Métodos de pago ──────────────────────────────────────────────────────────────────────────────────────────────

export function listPaymentMethods(purpose: PaymentMethodPurpose | null, options: CallOptions = {}): Promise<PaymentMethodsResponse> {
  return apiRequest<PaymentMethodsResponse>("/v1/me/payment-methods", { query: { purpose }, ...options });
}

/** `providerToken` es el token que devuelve el SDK del proveedor, NUNCA un número de tarjeta (400 RAW_CARD_DATA_REJECTED). */
export function addPaymentMethod(body: AddPaymentMethodRequest, options: WriteOptions = {}): Promise<PaymentMethod> {
  return apiRequest<PaymentMethod>("/v1/me/payment-methods", { method: "POST", body, ...options });
}

export function removePaymentMethod(methodId: string, options: CallOptions = {}): Promise<RemovePaymentMethodResponse> {
  return apiRequest<RemovePaymentMethodResponse>(`/v1/me/payment-methods/${enc(methodId)}`, { method: "DELETE", ...options });
}

// ── Recibos y justificantes ─────────────────────────────────────────────────────────────────────────────────────

export function listReceipts(query: PageQuery & { kind?: ReceiptKind | null } = {}, options: CallOptions = {}): Promise<Page<ReceiptSummary>> {
  return apiRequest<Page<ReceiptSummary>>("/v1/me/receipts", {
    query: { kind: query.kind ?? null, cursor: query.cursor ?? null, limit: query.limit ?? PAGE_SIZE },
    ...options,
  });
}

export function getReceipt(receiptId: string, options: CallOptions = {}): Promise<Receipt> {
  return apiRequest<Receipt>(`/v1/me/receipts/${enc(receiptId)}`, options);
}

/** Documento HTML autocontenido del justificante (para imprimir o compartir). */
export function getReceiptPrintable(receiptId: string, options: CallOptions = {}): Promise<string> {
  return fetchHtmlDocument(`/v1/me/receipts/${enc(receiptId)}/printable`, { signal: options.signal, timeoutMs: options.timeoutMs });
}

// ── Liquidaciones y devoluciones ────────────────────────────────────────────────────────────────────────────────

export function listPayouts(query: PageQuery = {}, options: CallOptions = {}): Promise<MyPayoutsResponse> {
  return apiRequest<MyPayoutsResponse>("/v1/me/payouts", {
    query: { cursor: query.cursor ?? null, limit: query.limit ?? PAGE_SIZE },
    ...options,
  });
}

export function getPayout(payoutId: string, options: CallOptions = {}): Promise<PayoutDetail> {
  return apiRequest<PayoutDetail>(`/v1/me/payouts/${enc(payoutId)}`, options);
}

export function listRefunds(query: PageQuery = {}, options: CallOptions = {}): Promise<Page<RefundView>> {
  return apiRequest<Page<RefundView>>("/v1/me/refunds", {
    query: { cursor: query.cursor ?? null, limit: query.limit ?? PAGE_SIZE },
    ...options,
  });
}
