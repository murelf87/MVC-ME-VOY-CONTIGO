/**
 * Contrato del módulo «money»: pagos, métodos de pago, cobros del conductor, recibos, liquidaciones,
 * cancelaciones, devoluciones (cara de la app y del panel de finanzas) y planes.
 *
 * Fuente de verdad del formato en el cable: los schemas Fastify de `src/modules/money/**` producen exactamente
 * estos tipos. Detalle de endpoints, errores y máquinas de estado: `docs/contracts/money.md`.
 *
 * Reglas que la UI debe respetar (PROMPT_MAESTRO §8–§10, BUILD_BRIEF §2):
 *  - Todo importe es `Money`. Mientras no exista tarifa/política aprobada llega `{cents:null,status:"pending_definition"}`
 *    y la UI escribe «Por definir». `illustrative` NO lo emite el backend real.
 *  - Un pago solo está `succeeded` cuando el SERVIDOR lo confirmó con un evento firmado del proveedor. El resultado del SDK
 *    del proveedor en el móvil NO es una prueba de pago: la app consulta `GET /v1/payments/{paymentId}` hasta ver un estado final.
 *  - Con `PAYMENTS_PROVIDER=disabled` (estado actual) `availability.enabled=false` y la UI muestra «Pagos aún no disponibles».
 *  - Para evitar colisiones en `export *` de `index.ts`, los nombres genéricos llevan prefijo del dominio (Payment…, Refund…).
 */
import type { Cents, IsoDate, IsoDateTime, Money, Page, PublicUser, Uuid } from "./common";

/* ───────────────────────── Disponibilidad del proveedor de pagos ───────────────────────── */

export type PaymentsAvailabilityStatus = "enabled" | "provider_disabled";

export interface PaymentsAvailability {
  enabled: boolean;
  status: PaymentsAvailabilityStatus;
  /** «Pagos aún no disponibles» cuando enabled=false; null cuando hay proveedor activo. */
  message: string | null;
  /** Métodos que el proveedor activo puede cobrar ahora. [] mientras esté desactivado. */
  chargeMethods: ChargeMethodKind[];
  payoutsEnabled: boolean;
  refundsEnabled: boolean;
}

/* ───────────────────────── Métodos de pago (solo referencias tokenizadas) ───────────────────────── */

/** Métodos con los que se puede pagar una reserva (confirmación inmediata). */
export type ChargeMethodKind = "apple_pay" | "google_pay" | "card";
export type PaymentMethodKind = ChargeMethodKind | "sepa_debit" | "bank_account";
/** `charge` = método del pasajero; `payout` = cuenta de cobro del conductor. */
export type PaymentMethodPurpose = "charge" | "payout";
export type PaymentMethodStatus = "active" | "requires_action" | "expired";

/** Nunca contiene PAN, CVV ni IBAN completo: solo la referencia tokenizada del proveedor (que no se expone) y datos de visualización. */
export interface PaymentMethod {
  id: Uuid;
  purpose: PaymentMethodPurpose;
  kind: PaymentMethodKind;
  /** Visa, Mastercard… (null para cuentas bancarias). */
  brand: string | null;
  last4: string | null;
  /** ISO-3166-1 alpha-2 (p. ej. «ES»). */
  country: string | null;
  expMonth: number | null;
  expYear: number | null;
  /** «Cuenta bancaria» · «Tarjeta Visa». */
  title: string;
  /** «ES** **** **** 4589» · «•••• 4242». */
  maskedLabel: string;
  isDefault: boolean;
  status: PaymentMethodStatus;
  createdAt: IsoDateTime;
}

/** GET /v1/me/payment-methods?purpose= */
export interface PaymentMethodsResponse {
  items: PaymentMethod[];
  availability: PaymentsAvailability;
}

/** POST /v1/me/payment-methods — 409 PAYMENTS_PROVIDER_DISABLED mientras no haya proveedor. */
export interface AddPaymentMethodRequest {
  purpose: PaymentMethodPurpose;
  /** Token/identificador que devuelve el SDK del proveedor en el móvil. NUNCA un número de tarjeta (400 RAW_CARD_DATA_REJECTED). */
  providerToken: string;
  setAsDefault?: boolean;
}

/** DELETE /v1/me/payment-methods/{methodId} */
export interface RemovePaymentMethodResponse {
  removed: true;
}

/* ───────────────────────── Pago de una solicitud aceptada (pantalla 16a/16b «Estado y pago») ───────────────────────── */

export type PaymentStatus = "requires_action" | "processing" | "succeeded" | "failed" | "expired" | "refunded";

/**
 * Resultado de negocio del pago (derivado en el servidor):
 *  awaiting_payment  · booking_confirmed (plaza reservada) · late_payment (el pago llegó con la reserva provisional caducada:
 *  NO hay reserva, se tramita devolución) · amount_mismatch / duplicate_payment (revisión manual) · request_not_payable ·
 *  failed · expired · refunded.
 */
export type PaymentOutcome =
  | "awaiting_payment"
  | "booking_confirmed"
  | "late_payment"
  | "amount_mismatch"
  | "duplicate_payment"
  | "request_not_payable"
  | "failed"
  | "expired"
  | "refunded";

/** GET /v1/payments/{paymentId} (sondeo del estado: lo decide solo el servidor; también es el objeto de `CreatePaymentIntentResponse.payment`). */
export interface PaymentView {
  id: Uuid;
  requestId: Uuid;
  /** Solo existe cuando el servidor confirmó el pago Y la plaza seguía retenida. */
  bookingId: Uuid | null;
  status: PaymentStatus;
  outcome: PaymentOutcome;
  /** Importe cobrado/por cobrar (siempre `defined`: no se crea intento sin importe aprobado). */
  amount: Money;
  /** Importe ya devuelto con confirmación del proveedor. */
  refunded: Money;
  method: { kind: PaymentMethodKind; maskedLabel: string | null };
  /** Código normalizado del motivo de fallo (p. ej. «card_declined»); null si no aplica. */
  failureCode: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  succeededAt: IsoDateTime | null;
}

/** Estados de la solicitud tal y como los ve el flujo de pago (espejo de `ride_requests.status`). */
export type PaymentRequestStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "payment_pending"
  | "confirmed"
  | "expired"
  | "cancelled"
  | "payment_late";

export type PaymentHoldStatus = "active" | "released" | "consumed" | "none";

/** Reserva provisional de plaza (cuenta atrás «14:52» de la pantalla 16). */
export interface PaymentHoldView {
  status: PaymentHoldStatus;
  expiresAt: IsoDateTime | null;
  /** Segundos que faltan según el reloj del servidor (0 si caducó); null si no hay hold activo. */
  secondsRemaining: number | null;
}

/** Referencia mínima del viaje para pantallas de dinero. */
export interface MoneyTripRef {
  tripId: Uuid;
  departureAt: IsoDateTime | null;
  /** Etiqueta del punto de recogida/origen («Sevilla Centro»); null si el viaje no la tiene. */
  originLabel: string | null;
  /** Etiqueta del punto de bajada/destino («Isla Mágica»). */
  destinationLabel: string | null;
}

/** «Resumen del pago»: aportación + gestión MVC + total. Todo `pending_definition` mientras no exista tarifa aprobada. */
export interface PaymentSummary {
  contribution: Money;
  /** «Gestión MVC»: comisión al pasajero. */
  platformFee: Money;
  processing: Money;
  taxes: Money;
  total: Money;
  /** Versión de tarifa usada por la cotización congelada; null mientras no haya tarifa aprobada. */
  tariffVersion: number | null;
  quoteSnapshotId: Uuid | null;
}

export type PaymentBlockCode =
  | "PAYMENTS_PROVIDER_DISABLED"
  | "REQUEST_NOT_PAYABLE"
  | "HOLD_EXPIRED"
  | "PAYMENT_AMOUNT_NOT_DEFINED"
  | "PAYMENT_ALREADY_OPEN"
  | "REQUEST_ALREADY_PAID";

export interface PaymentBlockReason {
  code: PaymentBlockCode;
  message: string;
}

export interface ChargeMethodOption {
  kind: ChargeMethodKind;
  /** false si el proveedor no lo ofrece (siempre false con el proveedor desactivado). */
  available: boolean;
}

/** GET /v1/ride-requests/{requestId}/payment */
export interface RequestPaymentContext {
  requestId: Uuid;
  requestStatus: PaymentRequestStatus;
  driver: PublicUser;
  trip: MoneyTripRef;
  hold: PaymentHoldView;
  availability: PaymentsAvailability;
  /** Siempre las tres opciones; `available` indica si se pueden usar ahora. */
  methods: ChargeMethodOption[];
  /** Tarjetas guardadas del pasajero (vacío con el proveedor desactivado). */
  savedMethods: PaymentMethod[];
  summary: PaymentSummary;
  /** true solo si «Pagar reserva» puede crear un intento ahora mismo. */
  canPay: boolean;
  cannotPayReason: PaymentBlockReason | null;
  /** Último intento de pago de esta solicitud, si lo hay. */
  payment: PaymentView | null;
  bookingId: Uuid | null;
}

/** POST /v1/ride-requests/{requestId}/payment-intents (cabecera Idempotency-Key obligatoria). */
export interface CreatePaymentIntentRequest {
  method: { kind: ChargeMethodKind; paymentMethodId?: Uuid };
}

export type PaymentClientActionType = "none" | "sdk_payment_sheet" | "redirect";

/** Lo que el SDK del proveedor necesita para completar el pago. Opaco: la app no lo interpreta ni lo persiste. */
export interface PaymentClientAction {
  type: PaymentClientActionType;
  clientSecret: string | null;
  redirectUrl: string | null;
}

export interface CreatePaymentIntentResponse {
  payment: PaymentView;
  clientAction: PaymentClientAction;
}

/* ───────────────────────── «Mis pagos y cobros» (pantallas 33a/33b) ───────────────────────── */

/**
 * Chip de cada fila: pending=«Pendiente», paid=«Pagado»; el resto son estados añadidos para producción.
 * `under_review` = el pasajero ya pagó pero Administración debe revisar el caso (pago tardío sin plaza, importe distinto,
 * pago duplicado o devolución en trámite): la UI no promete ni plaza ni devolución.
 */
export type PassengerPaymentState = "pending" | "under_review" | "paid" | "partially_refunded" | "refunded" | "failed" | "expired";

export interface PassengerPaymentItem {
  /** «payment:<uuid>» o «request:<uuid>» (estable para listas). */
  key: string;
  /** `pending_request` = solicitud aceptada que aún no tiene intento de pago. */
  kind: "payment" | "pending_request";
  requestId: Uuid;
  bookingId: Uuid | null;
  paymentId: Uuid | null;
  /** «Con Ana». */
  driver: PublicUser;
  trip: MoneyTripRef;
  /** `pending_definition` si no hay importe aprobado todavía. */
  amount: Money;
  state: PassengerPaymentState;
  occurredAt: IsoDateTime;
}

export interface CommissionInfo {
  status: "pending_definition" | "defined";
  passengerRateBps: number | null;
  driverRateBps: number | null;
}

/** GET /v1/me/payments/passenger-summary?month=YYYY-MM */
export interface PassengerPaymentsSummary {
  /** Mes natural Europe/Madrid, «2026-10». */
  month: string;
  availability: PaymentsAvailability;
  /** «Pendiente este mes»: `pending_definition` («--,-- €») si algún pendiente no tiene importe; 0 definido si no hay pendientes. */
  pendingThisMonth: Money;
  /** «2 próximos viajes». */
  upcomingTripsCount: number;
  /** «Mis pagos» / «Mis movimientos»: los 3 más recientes. */
  recent: PassengerPaymentItem[];
  /** «Método de pago»: el método por defecto del pasajero (null = ninguno). */
  paymentMethod: PaymentMethod | null;
  /** «Comisión de la plataforma · Por definir». */
  platformCommission: CommissionInfo;
}

/** GET /v1/me/payments?state=&cursor=&limit= */
export type PassengerPaymentsPage = Page<PassengerPaymentItem>;

/** pending=Pendiente (viaje no completado) · available=Por cobrar · in_payout=En liquidación · paid_out=«Cobrado». */
export type DriverEarningState = "pending" | "available" | "in_payout" | "paid_out";

export interface DriverEarningItem {
  bookingId: Uuid;
  /** «Con Miguel». */
  passenger: PublicUser;
  trip: MoneyTripRef;
  /** Neto del conductor (aportación − comisión conductor − devoluciones). */
  net: Money;
  state: DriverEarningState;
  occurredAt: IsoDateTime;
}

export type NextPayoutStatus = "pending_definition" | "scheduled" | "processing";

export interface NextPayout {
  status: NextPayoutStatus;
  /** null = «Por definir». */
  date: IsoDate | null;
  amount: Money;
}

/** GET /v1/me/payments/driver-summary?month=YYYY-MM */
export interface DriverPaymentsSummary {
  month: string;
  availability: PaymentsAvailability;
  /** «A cobrar este mes». */
  toCollectThisMonth: Money;
  /** «4 viajes realizados». */
  completedTripsCount: number;
  /** «Próximo abono · Por definir». */
  nextPayout: NextPayout;
  /** «Últimos cobros»: los 3 más recientes. */
  recent: DriverEarningItem[];
  /** «Método de pago» del conductor: su cuenta de cobro (purpose=payout). */
  payoutAccount: PaymentMethod | null;
  platformCommission: CommissionInfo;
}

/** GET /v1/me/earnings?state=&cursor=&limit= */
export type DriverEarningsPage = Page<DriverEarningItem>;

/** GET /v1/me/earnings/{bookingId} */
export interface DriverEarningDetail extends DriverEarningItem {
  lines: {
    contribution: Money;
    driverCommission: Money;
    /** Devoluciones aprobadas que reducen lo que cobra el conductor (0 si no hay). */
    refundAdjustments: Money;
    net: Money;
  };
  payoutId: Uuid | null;
}

/* ───────────────────────── Recibos y justificantes («Historial de pagos y recibos», «Facturas y justificantes») ───────────────────────── */

/**
 * Los recibos son JUSTIFICANTES NO FISCALES generados por MVC a partir del libro mayor tras un evento confirmado por el servidor.
 * No son facturas (la facturación y su numeración dependen de una decisión fiscal pendiente; ver docs/contracts/money.md §Decisiones).
 */
export type ReceiptKind = "payment" | "refund" | "earning_statement";

export interface ReceiptSummary {
  id: Uuid;
  /** «MVC-J-2026-000012» (justificante no fiscal; numeración correlativa anual). */
  number: string;
  kind: ReceiptKind;
  issuedAt: IsoDateTime;
  total: Money;
  trip: MoneyTripRef | null;
  counterpart: PublicUser | null;
  bookingId: Uuid | null;
  paymentId: Uuid | null;
}

export type ReceiptLineKey =
  | "contribution"
  | "platform_fee"
  | "processing"
  | "taxes"
  | "refund"
  | "driver_commission"
  | "refund_adjustments"
  | "net";

export interface ReceiptLine {
  key: ReceiptLineKey;
  amount: Money;
}

/** GET /v1/me/receipts/{receiptId} */
export interface Receipt extends ReceiptSummary {
  fiscalInvoice: false;
  lines: ReceiptLine[];
  /** Aviso legal visible en el justificante. */
  notice: string;
}

/** GET /v1/me/receipts?kind=&cursor=&limit= */
export type ReceiptsPage = Page<ReceiptSummary>;

/**
 * GET /v1/me/receipts/{receiptId}/printable → documento HTML autocontenido (no JSON) para imprimir o compartir; se abre en un visor web.
 * Cabeceras: `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` y CSP `default-src 'none'`.
 */
export type ReceiptPrintableContentType = "text/html; charset=utf-8";

/* ───────────────────────── Liquidaciones al conductor («Liquidación mensual») ───────────────────────── */

export type PayoutStatus = "draft" | "processing" | "paid" | "failed" | "cancelled";

export interface PayoutView {
  id: Uuid;
  /** Mes liquidado «2026-10». */
  period: string;
  status: PayoutStatus;
  net: Money;
  bookingsCount: number;
  /** null = «Por definir» (el calendario de abonos no está aprobado). */
  scheduledFor: IsoDate | null;
  paidAt: IsoDateTime | null;
  failureCode: string | null;
  createdAt: IsoDateTime;
}

export interface PayoutSchedule {
  frequency: "monthly";
  dayStatus: "pending_definition" | "defined";
  dayOfMonth: number | null;
}

/** GET /v1/me/payouts */
export interface MyPayoutsResponse extends Page<PayoutView> {
  availability: PaymentsAvailability;
  schedule: PayoutSchedule;
  nextPayout: NextPayout;
  payoutAccount: PaymentMethod | null;
}

/** GET /v1/me/payouts/{payoutId} */
export interface PayoutDetail extends PayoutView {
  items: DriverEarningItem[];
}

/* ───────────────────────── Cancelación y devoluciones (pantalla 28 «Cancelar reserva») ───────────────────────── */

/** Motivos de la pantalla 28 (textos literales en `PASSENGER_CANCELLATION_REASON_LABELS`). */
export type PassengerCancellationReason = "no_longer_needed" | "schedule_change" | "found_other_option" | "other";
export type DriverCancellationReason = "schedule_change" | "vehicle_issue" | "emergency" | "passenger_issue" | "other";

export const PASSENGER_CANCELLATION_REASON_LABELS: Record<PassengerCancellationReason, string> = {
  no_longer_needed: "Ya no lo necesito",
  schedule_change: "Cambio en mi horario",
  found_other_option: "He encontrado otra opción",
  other: "Otro motivo",
};

/** pending_review = NO hay política de cancelación aprobada (estado actual): los importes derivados son «Por definir». */
export type CancellationPolicyStatus = "pending_review" | "approved";

export interface CancellationPolicyRef {
  status: CancellationPolicyStatus;
  /** Versión aceptada por el usuario al pagar; null si cuando pagó no había política aprobada. */
  version: number | null;
  effectiveFrom: IsoDateTime | null;
  summary: string | null;
}

export type PaymentBookingStatus = "confirmed" | "completed" | "cancelled" | "driver_cancelled" | "no_show";

export interface CancellationBookingSummary {
  id: Uuid;
  status: PaymentBookingStatus;
  seats: number;
  trip: MoneyTripRef;
  driver: PublicUser;
  /** Lo que pagó el pasajero (confirmado por el servidor). */
  paid: Money;
}

export type CancellationBlockCode = "BOOKING_ALREADY_CANCELLED" | "BOOKING_NOT_CANCELLABLE" | "TRIP_ALREADY_STARTED";

/** «Aporte del viaje · Según condiciones» y «Gestión de la plataforma · Política pendiente de revisión». */
export interface CancellationPreviewLine {
  key: "trip_contribution" | "platform_fee";
  amount: Money;
  noteCode: "subject_to_conditions" | "policy_pending_review" | "per_policy";
}

/** GET /v1/bookings/{bookingId}/cancellation-preview */
export interface CancellationPreview {
  booking: CancellationBookingSummary;
  canCancel: boolean;
  blocked: { code: CancellationBlockCode; message: string } | null;
  scenario: "passenger_cancellation";
  reasons: PassengerCancellationReason[];
  policy: CancellationPolicyRef;
  lines: CancellationPreviewLine[];
  /** «Detalle del reembolso (propuesta)»: `pending_definition` mientras no haya política aprobada aceptada por el usuario. */
  proposedRefund: Money;
  /** Hoy toda propuesta la revisa Administración (finanzas). */
  decisionMode: "admin_review";
  /** «Si corresponde, los reembolsos obligatorios por ley se realizarán según la normativa vigente.» */
  legalNotice: string;
}

/** POST /v1/bookings/{bookingId}/cancel (Idempotency-Key obligatoria). */
export interface CancelBookingRequest {
  reason: PassengerCancellationReason;
  note?: string;
}

/** POST /v1/bookings/{bookingId}/driver-cancel (el conductor del viaje; Idempotency-Key obligatoria). */
export interface DriverCancelBookingRequest {
  reason: DriverCancellationReason;
  note?: string;
}

export type RefundStatus = "pending_review" | "approved" | "executing" | "refunded" | "rejected" | "failed" | "not_applicable";
export type RefundOrigin =
  | "passenger_cancellation"
  | "driver_cancellation"
  | "platform_cancellation"
  | "force_majeure"
  | "no_show"
  | "late_payment"
  | "other";
export type RefundExecutionStatus = "not_started" | "awaiting_provider" | "submitted" | "succeeded" | "failed";
export type RefundDecisionBasis = "policy" | "manual_override" | "manual_without_policy" | "late_payment_full_refund";

/** Devolución (propuesta o decidida) tal y como la ve el pasajero y, ampliada, el panel de finanzas. */
export interface RefundView {
  id: Uuid;
  status: RefundStatus;
  origin: RefundOrigin;
  bookingId: Uuid | null;
  requestId: Uuid;
  paymentId: Uuid | null;
  /** «Importe pagado (pasajero)». */
  paid: Money;
  /** «Devolución propuesta»: `pending_definition` mientras no haya política aprobada (salvo pagos tardíos: devolución íntegra). */
  proposedRefund: Money;
  /** Importe aprobado por Administración; `pending_definition` hasta que se decide. */
  approvedRefund: Money;
  /** «Comisión plataforma (propuesta)»: `pending_definition` sin política. */
  platformFee: Money;
  /** «Coste final pasajero»: pagado − devolución (aprobada si existe, si no propuesta); `pending_definition` si se desconoce. */
  finalPassengerCost: Money;
  executionStatus: RefundExecutionStatus;
  policy: CancellationPolicyRef;
  createdAt: IsoDateTime;
  decidedAt: IsoDateTime | null;
  /** Solo cuando el proveedor confirmó la devolución (evento firmado). */
  refundedAt: IsoDateTime | null;
}

export interface CancelBookingResponse {
  booking: { id: Uuid; status: PaymentBookingStatus };
  /** null si no había nada pagado que devolver. */
  refund: RefundView | null;
  /** true si la reserva ya estaba cancelada (reintento): se devuelve el resultado previo. */
  alreadyCancelled: boolean;
}

/** GET /v1/me/refunds */
export type MyRefundsPage = Page<RefundView>;

/* ───────────────────────── Panel de finanzas: «Reservas y devoluciones» (pantallas 39a/39b) ───────────────────────── */

export type RefundCancelledBy = "passenger" | "driver" | "platform" | "system";

export interface AdminRefundItem extends RefundView {
  passenger: PublicUser;
  driver: PublicUser | null;
  trip: MoneyTripRef;
  /** «Cancelada por el pasajero · 08:26». */
  cancelledBy: RefundCancelledBy | null;
  cancelledAt: IsoDateTime | null;
  cancelReason: string | null;
  cancelNote: string | null;
  decision: { by: PublicUser | null; at: IsoDateTime; note: string | null; basis: RefundDecisionBasis | null } | null;
}

export type AdminRefundTab = "all" | "cancelled" | "refunded";
export type AdminRefundPeriod = "7d" | "30d" | "90d" | "365d" | "all";

/** GET /v1/admin/refund-proposals?tab=&status=&origin=&period=&provinceCode=&cursor=&limit=  (finance_admin | admin) */
export interface AdminRefundList extends Page<AdminRefundItem> {
  /** Contadores de las pestañas «Todas (12) · Canceladas (5) · Devueltas (3)» para el periodo/provincia filtrados. */
  counts: { all: number; cancelled: number; refunded: number };
}

export interface LedgerLineView {
  id: number;
  createdAt: IsoDateTime;
  transactionKind: string;
  account: string;
  /** Con signo; nunca float. */
  amountCents: Cents;
}

/** GET /v1/admin/refund-proposals/{refundId} */
export interface AdminRefundDetail extends AdminRefundItem {
  payment: PaymentView | null;
  /** Máximo que aún se puede devolver de ese pago (pagado − devoluciones aprobadas/ejecutadas). */
  maxRefundable: Money;
  ledger: LedgerLineView[];
}

/** POST /v1/admin/refund-proposals/{refundId}/approve (Idempotency-Key obligatoria). */
export interface ApproveRefundRequest {
  /** Obligatorio si la propuesta es `pending_definition`; si se omite se aprueba el importe propuesto. */
  approvedCents?: Cents;
  /** Obligatoria si no hay política aplicable o si se cambia el importe propuesto. */
  note?: string;
}

/** POST /v1/admin/refund-proposals/{refundId}/reject (Idempotency-Key obligatoria). */
export interface RejectRefundRequest {
  note: string;
}

/**
 * POST /v1/admin/refund-proposals/{refundId}/execute (Idempotency-Key obligatoria; sin cuerpo): pide al proveedor la devolución ya
 * aprobada. 409 PAYMENTS_PROVIDER_DISABLED mientras no haya proveedor; 409 REFUND_NOT_EXECUTABLE si no está aprobada o ya se pidió.
 * `refunded` solo llega después, con el evento firmado `refund.succeeded`.
 */
export type ExecuteRefundResponse = AdminRefundItem;

/* ───────────────────────── Liquidaciones: panel de finanzas ───────────────────────── */

export interface AdminPayoutRun extends PayoutView {
  driver: PublicUser;
}

/** GET /v1/admin/payout-runs?period=YYYY-MM&status= */
export type AdminPayoutRunList = Page<AdminPayoutRun>;

/** POST /v1/admin/payout-runs (Idempotency-Key obligatoria): genera una liquidación por conductor con saldo disponible del periodo. */
export interface GeneratePayoutRunsRequest {
  period: string;
}

export interface GeneratePayoutRunsResponse {
  period: string;
  created: AdminPayoutRun[];
  /** Conductores sin saldo positivo o con liquidación ya generada. */
  skipped: number;
}

/**
 * POST /v1/admin/payout-runs/{payoutId}/execute (Idempotency-Key obligatoria; sin cuerpo): pide el abono al proveedor (`processing`).
 * 409 PAYMENTS_PROVIDER_DISABLED · 409 PAYOUT_ACCOUNT_REQUIRED · 409 PAYOUT_NOT_EXECUTABLE. `paid` solo llega con el evento firmado `payout.paid`.
 */
export type ExecutePayoutRunResponse = AdminPayoutRun;

/* ───────────────────────── Planes (pantalla 32) ───────────────────────── */

/** active = disponible · proposal = «Propuesta» (en estudio) · unavailable = «No disponible por el momento». */
export type PlanStatus = "active" | "proposal" | "unavailable";
export type PlanCode = "free" | "premium_driver" | "membership";

export interface PlanView {
  code: PlanCode;
  name: string;
  /** «Uso ocasional», «Para rutas regulares». */
  tagline: string;
  status: PlanStatus;
  features: string[];
  /** «Cuota y comisiones por definir» / «Propuesta en fase de estudio.»; null si no aplica. */
  economicsNote: { title: string; detail: string } | null;
  /** Texto del bloque inferior de la membresía; null si no aplica. */
  availabilityNote: string | null;
  /** Cuota: `pending_definition` mientras no haya decisión. */
  price: Money;
}

/** GET /v1/plans */
export interface PlansResponse {
  items: PlanView[];
}

/** GET /v1/me/plan — no existe endpoint de compra. */
export interface MyPlanResponse {
  planCode: PlanCode;
  status: "active";
  purchasable: false;
}

/* ───────────────────────── Webhook de pagos (servidor a servidor; la app NO lo llama) ───────────────────────── */

export interface PaymentWebhookResult {
  eventId: string;
  result: "applied" | "duplicate" | "ignored";
  reason?: string;
}

/** POST /v1/webhooks/payments → 200. */
export interface PaymentWebhookResponse {
  received: true;
  results: PaymentWebhookResult[];
}

/* ───────────────────────── Errores estables (`error.code`) ───────────────────────── */

export type MoneyErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "AUTH_INVALID_OR_EXPIRED"
  | "ACCOUNT_NOT_ACTIVE"
  | "AUTH_FORBIDDEN"
  | "VALIDATION_ERROR"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_REUSED"
  | "PAYMENTS_PROVIDER_DISABLED"
  | "PAYMENT_AMOUNT_NOT_DEFINED"
  | "PAYMENT_ALREADY_OPEN"
  | "PAYMENT_METHOD_NOT_AVAILABLE"
  | "PAYMENT_NOT_FOUND"
  | "PAYMENT_METHOD_NOT_FOUND"
  | "PAYMENT_PROVIDER_ERROR"
  | "RAW_CARD_DATA_REJECTED"
  | "REQUEST_NOT_FOUND"
  | "REQUEST_NOT_PAYABLE"
  | "REQUEST_ALREADY_PAID"
  | "HOLD_EXPIRED"
  | "BOOKING_NOT_FOUND"
  | "BOOKING_NOT_CANCELLABLE"
  | "TRIP_ALREADY_STARTED"
  | "REFUND_NOT_FOUND"
  | "REFUND_NOT_PENDING"
  | "REFUND_AMOUNT_REQUIRED"
  | "REFUND_AMOUNT_EXCEEDS_PAID"
  | "REFUND_NOTE_REQUIRED"
  | "REFUND_NO_PAYMENT_RECORD"
  | "REFUND_NOT_EXECUTABLE"
  | "RECEIPT_NOT_FOUND"
  | "PAYOUT_NOT_FOUND"
  | "PAYOUT_NOT_EXECUTABLE"
  | "PAYOUT_ACCOUNT_REQUIRED"
  | "WEBHOOK_SIGNATURE_INVALID"
  | "WEBHOOK_PAYLOAD_INVALID"
  | "PAYMENTS_WEBHOOK_NOT_CONFIGURED"
  | "PAYMENT_UNKNOWN"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";
