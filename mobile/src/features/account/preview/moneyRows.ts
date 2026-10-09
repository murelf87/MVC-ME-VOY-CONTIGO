/**
 * Filas del backend en memoria del paquete «pagos y cobros» (SIMULACIÓN, solo vista previa).
 *
 * Todo vive en colecciones propias `money_*` (el núcleo no tiene tablas de dinero) con la convención del núcleo: columnas
 * en snake_case, instantes en milisegundos y fechas de calendario `YYYY-MM-DD`. Las respuestas del contrato
 * (`mobile/src/api/types/money.ts`) se construyen en `moneyViews.ts`; aquí solo están los tipos y los accesos.
 *
 * Esta forma de filas es la que usa el resto de equipos si necesitan sembrar dinero: `money_payments`, `money_earnings`,
 * `money_methods`, `money_receipts`, `money_payouts`, `money_refunds` y la fila única `money_config`.
 */
import type {
  DriverEarningState,
  PassengerPaymentState,
  PaymentMethodKind,
  PaymentMethodPurpose,
  PaymentMethodStatus,
  PayoutStatus,
  ReceiptKind,
  ReceiptLineKey,
  RefundExecutionStatus,
  RefundOrigin,
  RefundStatus,
} from "@/api/types/money";
import type { Collection, PreviewDb } from "@/preview";

export type AmountStatus = "defined" | "pending_definition" | "illustrative";

/** Importe guardado: céntimos enteros o `null` mientras no exista tarifa. */
export interface AmountRow {
  cents: number | null;
  status: AmountStatus;
}

export interface TripRefRow {
  trip_id: string;
  departure_at: number | null;
  origin_label: string | null;
  destination_label: string | null;
}

/** Pago del pasajero (o solicitud aceptada pendiente de pago) → `PassengerPaymentItem`. */
export interface PaymentRow {
  /** `payment:<uuid>` o `request:<uuid>` (es la clave `key` del contrato). */
  id: string;
  user_id: string;
  kind: "payment" | "pending_request";
  request_id: string;
  booking_id: string | null;
  payment_id: string | null;
  driver_user_id: string;
  trip: TripRefRow;
  amount: AmountRow;
  state: PassengerPaymentState;
  occurred_at: number;
}

/** Cobro del conductor por reserva completada → `DriverEarningItem` / `DriverEarningDetail`. */
export interface EarningRow {
  /** = `bookingId`. */
  id: string;
  user_id: string;
  passenger_user_id: string;
  trip: TripRefRow;
  contribution: AmountRow;
  driver_commission: AmountRow;
  refund_adjustments: AmountRow;
  net: AmountRow;
  state: DriverEarningState;
  occurred_at: number;
  payout_id: string | null;
}

/** Método de pago tokenizado (nunca PAN, CVV ni IBAN completo). */
export interface MethodRow {
  id: string;
  user_id: string;
  purpose: PaymentMethodPurpose;
  kind: PaymentMethodKind;
  brand: string | null;
  last4: string | null;
  country: string | null;
  exp_month: number | null;
  exp_year: number | null;
  title: string;
  masked_label: string;
  is_default: boolean;
  status: PaymentMethodStatus;
  created_at: number;
  /** Retirado: se conserva la fila pero no se muestra (contrato §6.3). */
  removed_at: number | null;
}

export interface ReceiptLineRow {
  key: ReceiptLineKey;
  amount: AmountRow;
}

/** Justificante NO fiscal. */
export interface ReceiptRow {
  id: string;
  user_id: string;
  number: string;
  kind: ReceiptKind;
  issued_at: number;
  total: AmountRow;
  trip: TripRefRow | null;
  counterpart_user_id: string | null;
  booking_id: string | null;
  payment_id: string | null;
  lines: ReceiptLineRow[];
  notice: string;
}

export interface PayoutRow {
  id: string;
  user_id: string;
  /** `YYYY-MM`. */
  period: string;
  status: PayoutStatus;
  net: AmountRow;
  bookings_count: number;
  scheduled_for: string | null;
  paid_at: number | null;
  failure_code: string | null;
  created_at: number;
}

/** Devolución del pasajero → `RefundView`. */
export interface RefundRow {
  id: string;
  user_id: string;
  status: RefundStatus;
  origin: RefundOrigin;
  booking_id: string | null;
  request_id: string;
  payment_id: string | null;
  paid: AmountRow;
  proposed: AmountRow;
  approved: AmountRow;
  platform_fee: AmountRow;
  final_cost: AmountRow;
  execution_status: RefundExecutionStatus;
  policy_status: "pending_review" | "approved";
  policy_version: number | null;
  created_at: number;
  decided_at: number | null;
  refunded_at: number | null;
}

/** Configuración global del módulo (una sola fila). */
export interface ConfigRow {
  id: "config";
  /** `true` = hay proveedor (SIMULADO en la vista previa). `false` = «Pagos aún no disponibles». */
  provider_enabled: boolean;
  commission_status: "pending_definition" | "defined";
  passenger_bps: number | null;
  driver_bps: number | null;
  /** Día del mes de los abonos; `null` = «Por definir». */
  payout_day: number | null;
}

export const CONFIG_ID = "config" as const;

export const DEFAULT_CONFIG: ConfigRow = {
  id: CONFIG_ID,
  provider_enabled: false,
  commission_status: "pending_definition",
  passenger_bps: null,
  driver_bps: null,
  payout_day: null,
};

export interface MoneyTables {
  payments: Collection<PaymentRow>;
  earnings: Collection<EarningRow>;
  methods: Collection<MethodRow>;
  receipts: Collection<ReceiptRow>;
  payouts: Collection<PayoutRow>;
  refunds: Collection<RefundRow>;
  config: Collection<ConfigRow>;
}

export function moneyTables(db: PreviewDb): MoneyTables {
  return {
    payments: db.collection<PaymentRow>("money_payments"),
    earnings: db.collection<EarningRow>("money_earnings"),
    methods: db.collection<MethodRow>("money_methods"),
    receipts: db.collection<ReceiptRow>("money_receipts"),
    payouts: db.collection<PayoutRow>("money_payouts"),
    refunds: db.collection<RefundRow>("money_refunds"),
    config: db.collection<ConfigRow>("money_config"),
  };
}

/** Configuración vigente (si no se sembró, la del estado honesto actual: sin proveedor ni economía). */
export function readConfig(db: PreviewDb): Readonly<ConfigRow> {
  return db.collection<ConfigRow>("money_config").get(CONFIG_ID) ?? DEFAULT_CONFIG;
}

export function writeConfig(db: PreviewDb, patch: Partial<Omit<ConfigRow, "id">>): void {
  const table = db.collection<ConfigRow>("money_config");
  const current = table.get(CONFIG_ID);
  if (current === undefined) table.insert({ ...DEFAULT_CONFIG, ...patch });
  else table.update(CONFIG_ID, patch);
}
