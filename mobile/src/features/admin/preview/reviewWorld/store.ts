/**
 * Tablas del backend en memoria de «admin-review» (SIMULACIÓN, solo vista previa).
 *
 *   trust_review_items       un elemento entregado a revisión (identidad, permiso, foto, comprobación privada) con sus
 *                            evidencias (pruebas privadas: solo se abren con la URL firmada de 120 s)
 *   money_refunds            COMPARTIDA con «pagos y cobros» y «mensajes» (misma forma que `RefundRow` de
 *                            `features/account/preview/moneyRows.ts`): las propuestas de devolución
 *   admin_refund_meta        lo que el panel de finanzas añade a cada devolución (cancelación, viaje, pago, decisión, libro)
 *   admin_summary_seed       cifras de ejemplo del resumen (37) cuando la vista previa no puede derivarlas del mundo
 *
 * Convención del núcleo: columnas en snake_case, instantes en milisegundos.
 */
import type { AdminEvidenceKind, AdminPeriod, AdminReviewItemKey, RefundDecisionBasis, ReviewState } from "@/api/types";
import type { Collection, PreviewDb } from "@/preview";

// ── Revisión de personas ──────────────────────────────────────────────────────────────────────────────────────────

/** Estado guardado: lo «sin entregar» no tiene fila. */
export type StoredItemState = Exclude<ReviewState, "none">;

export interface EvidenceRow {
  id: string;
  kind: AdminEvidenceKind;
  label: string;
  content_type: string;
  size_bytes: number;
  submitted_at: number;
  /** `in_review` · `approved` · `rejected` · `needs_retry` · `accepted`. */
  status: string;
  /** Clave del objeto en el almacén privado simulado. */
  storage_key: string;
}

export interface ReviewItemRow {
  /** `${user_id}:${key}` */
  id: string;
  user_id: string;
  key: AdminReviewItemKey;
  state: StoredItemState;
  submitted_at: number;
  decided_at: number | null;
  decided_by: string | null;
  reason: string | null;
  reason_code: string | null;
  evidence: EvidenceRow[];
}

// ── Devoluciones ──────────────────────────────────────────────────────────────────────────────────────────────────

export type AmountStatus = "defined" | "pending_definition" | "illustrative";

/** Importe guardado: céntimos enteros o `null` mientras no exista tarifa. */
export interface AmountRow {
  cents: number | null;
  status: AmountStatus;
}

export type RefundStatusRow = "pending_review" | "approved" | "executing" | "refunded" | "rejected" | "failed" | "not_applicable";
export type RefundOriginRow = "passenger_cancellation" | "driver_cancellation" | "platform_cancellation" | "force_majeure" | "no_show" | "late_payment" | "other";
export type RefundExecutionRow = "not_started" | "awaiting_provider" | "submitted" | "succeeded" | "failed";

/** Devolución (tabla `money_refunds`, compartida): misma forma que `RefundRow` de «pagos y cobros». */
export interface MoneyRefundRow {
  id: string;
  /** Quien pagó (el pasajero). */
  user_id: string;
  status: RefundStatusRow;
  origin: RefundOriginRow;
  booking_id: string | null;
  request_id: string;
  payment_id: string | null;
  paid: AmountRow;
  proposed: AmountRow;
  approved: AmountRow;
  platform_fee: AmountRow;
  final_cost: AmountRow;
  execution_status: RefundExecutionRow;
  policy_status: "pending_review" | "approved";
  policy_version: number | null;
  created_at: number;
  decided_at: number | null;
  refunded_at: number | null;
}

export interface TripFacts {
  trip_id: string;
  departure_at: number | null;
  origin_label: string | null;
  destination_label: string | null;
}

export interface LedgerLineRow {
  id: number;
  created_at: number;
  transaction_kind: string;
  account: string;
  amount_cents: number;
}

export interface PaymentFacts {
  id: string;
  created_at: number;
  succeeded_at: number | null;
  method_kind: "card" | "apple_pay" | "google_pay" | "bank_account";
  method_label: string | null;
}

export interface DecisionFacts {
  by_user_id: string | null;
  at: number;
  note: string | null;
  basis: RefundDecisionBasis | null;
}

export interface RefundMetaRow {
  /** = id de la devolución */
  id: string;
  province_code: string;
  driver_user_id: string | null;
  trip: TripFacts;
  cancelled_by: "passenger" | "driver" | "platform" | "system" | null;
  cancelled_at: number | null;
  cancel_reason: string | null;
  cancel_note: string | null;
  decision: DecisionFacts | null;
  /** Pago original (null = «no hay un pago registrado en MVC»). */
  payment: PaymentFacts | null;
  ledger: LedgerLineRow[];
  /** Instante (reloj virtual) en el que el proveedor SIMULADO confirma la devolución; solo con `executing`. */
  provider_confirms_at: number | null;
}

// ── Resumen (37) ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface KpiSeed {
  value: number;
  previous: number;
  /** Variación fijada a mano (las láminas dicen «+12 %» y «−8 %», que ningún par de enteros produce); `null` = se calcula. */
  delta_percent: number | null;
}

export interface FinanceSeed {
  gross_cents: number;
  costs_cents: number;
  result_cents: number;
}

export interface PeriodSeed {
  trips: KpiSeed;
  requests: KpiSeed;
  incidents: KpiSeed | null;
  live_now: number;
  finance: FinanceSeed | null;
}

export interface VehicleCellSeed {
  id: string;
  count: number;
  lat: number;
  lng: number;
}

export interface SummarySeedRow {
  id: "summary";
  periods: Record<AdminPeriod, PeriodSeed>;
  vehicles: VehicleCellSeed[];
}

export interface ReviewTables {
  items: Collection<ReviewItemRow>;
  refunds: Collection<MoneyRefundRow>;
  refundMeta: Collection<RefundMetaRow>;
  summarySeed: Collection<SummarySeedRow>;
}

export function reviewTables(db: PreviewDb): ReviewTables {
  return {
    items: db.collection<ReviewItemRow>("trust_review_items"),
    refunds: db.collection<MoneyRefundRow>("money_refunds"),
    refundMeta: db.collection<RefundMetaRow>("admin_refund_meta"),
    summarySeed: db.collection<SummarySeedRow>("admin_summary_seed"),
  };
}

/** Ajustes sueltos del mundo (variantes de datos): claves de `db.getSetting`. */
export const SETTING_STORAGE_DISABLED = "admin.review.storageDisabled";
/** Mundo sin ninguna entrega a revisión (pestañas vacías con sus contadores a cero). */
export const SETTING_QUEUE_EMPTY = "admin.review.queueEmpty";
export const SETTING_PROVIDER_ENABLED = "admin.review.providerEnabled";
/** Qué responde el proveedor SIMULADO a una devolución pedida: `succeeded` (por defecto) o `failed`. */
export const SETTING_PROVIDER_OUTCOME = "admin.review.providerOutcome";

/** Segundos (del reloj virtual) que tarda el proveedor SIMULADO en confirmar o rechazar una devolución. */
export const PROVIDER_DELAY_MS = 20_000;

/** ¿Existe ya la colección? (`db.collection(...)` la crearía al preguntar; para saber si el módulo existe no hay que crearla.) */
export function hasCollection(db: PreviewDb, name: string): boolean {
  return db.collectionNames().includes(name);
}

/** ¿Hay proveedor de pagos? Por defecto no (es el estado real hoy: «Pagos aún no disponibles»). */
export function providerEnabled(db: PreviewDb): boolean {
  if (hasCollection(db, "money_config")) {
    const moneyConfig = db.collection<{ id: string; provider_enabled: boolean }>("money_config").get("config");
    if (moneyConfig !== undefined) return moneyConfig.provider_enabled;
  }
  return db.getSetting<boolean>(SETTING_PROVIDER_ENABLED) === true;
}
