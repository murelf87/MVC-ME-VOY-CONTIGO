/**
 * Datos de ejemplo de «Reservas y devoluciones» (SIMULACIÓN, solo vista previa): doce propuestas de devolución de personas
 * ficticias del reparto — 5 abiertas, 3 devueltas y 4 rechazadas, que son los contadores de la lámina 39 («Todas (12) ·
 * Canceladas (5) · Devueltas (3)»).
 *
 * Los importes son `illustrative` (el servidor real no emite importes inventados: la app los marca «ilustrativo») y la
 * comisión de la plataforma sigue «Por definir» porque no hay tarifa ni política de cancelación aprobadas. Todas las
 * fechas son relativas al reloj virtual: con el reloj de cada lámina quedan como en el diseño.
 */
import type { RefundDecisionBasis, RefundOrigin, RefundStatus } from "@/api/types";
import { addDaysToDate, madridDate, madridDateTimeMs, SEED_USER_IDS, stableUuid, TIME, type PreviewDb, type SeedUserKey } from "@/preview";
import { paymentLedger } from "./refunds";
import { reviewTables, type AmountRow, type LedgerLineRow, type MoneyRefundRow, type RefundMetaRow } from "./store";

/** `a` = lámina 39a (separador «-»); `b` = lámina 39b (separador «·» y otras fechas). */
export type RefundStyle = "a" | "b";

type When = readonly [dayOffset: number, hhmm: string];
type MethodKind = "card" | "apple_pay" | "google_pay";

interface RefundSpec {
  key: string;
  passenger: SeedUserKey;
  driver: SeedUserKey;
  status: RefundStatus;
  origin: RefundOrigin;
  paid: number;
  /** `null` = «Por definir». */
  proposed: number | null;
  approved?: number;
  from: string;
  to: string;
  trip: When;
  /** Cuándo se canceló (o cuándo llegó el pago tardío). */
  cancel: When;
  cancelledBy: RefundMetaRow["cancelled_by"];
  cancelReason: string | null;
  cancelNote?: string;
  decided?: When;
  note?: string;
  basis?: RefundDecisionBasis;
  refunded?: When;
  method: MethodKind;
}

const SPECS: readonly RefundSpec[] = [
  // ── Abiertas (pestaña «Canceladas») ──
  {
    key: "miguel",
    passenger: "miguel",
    driver: "ana",
    status: "pending_review",
    origin: "passenger_cancellation",
    paid: 500,
    proposed: 500,
    from: "Los Bermejales",
    to: "Cartuja (Universidad)",
    trip: [-2, "08:12"],
    cancel: [-2, "08:26"],
    cancelledBy: "passenger",
    cancelReason: "schedule_change",
    method: "card",
  },
  {
    key: "ana",
    passenger: "ana",
    driver: "marta",
    status: "pending_review",
    origin: "driver_cancellation",
    paid: 450,
    proposed: 450,
    from: "Nervión (Trabajo)",
    to: "Montequinto",
    trip: [-1, "17:40"],
    cancel: [-3, "17:55"],
    cancelledBy: "driver",
    cancelReason: "vehicle_issue",
    method: "apple_pay",
  },
  {
    key: "javier",
    passenger: "javier",
    driver: "miguelAngel",
    status: "pending_review",
    origin: "passenger_cancellation",
    paid: 600,
    proposed: null,
    from: "San Pablo",
    to: "Hospital Virgen del Rocío",
    trip: [-3, "19:30"],
    cancel: [-4, "10:05"],
    cancelledBy: "passenger",
    cancelReason: "found_other_option",
    cancelNote: "Voy a ir con un compañero de trabajo.",
    method: "card",
  },
  {
    key: "laura",
    passenger: "laura",
    driver: "carlos",
    status: "approved",
    origin: "passenger_cancellation",
    paid: 400,
    proposed: 400,
    approved: 400,
    from: "Triana",
    to: "Cartuja (Universidad)",
    trip: [-4, "08:05"],
    cancel: [-5, "18:10"],
    cancelledBy: "passenger",
    cancelReason: "no_longer_needed",
    decided: [-4, "09:30"],
    note: "Cancelación con antelación; criterio caso a caso.",
    basis: "manual_without_policy",
    method: "google_pay",
  },
  {
    key: "daniel",
    passenger: "daniel",
    driver: "carmen",
    status: "failed",
    origin: "passenger_cancellation",
    paid: 500,
    proposed: 500,
    approved: 500,
    from: "Alcalá de Guadaíra",
    to: "Cartuja (Universidad)",
    trip: [-8, "07:50"],
    cancel: [-9, "20:15"],
    cancelledBy: "passenger",
    cancelReason: "schedule_change",
    decided: [-8, "10:00"],
    note: "Cancelación con antelación; criterio caso a caso.",
    basis: "manual_without_policy",
    method: "card",
  },
  // ── Devueltas ──
  {
    key: "elena",
    passenger: "elena",
    driver: "carmen",
    status: "refunded",
    origin: "passenger_cancellation",
    paid: 350,
    proposed: 350,
    approved: 350,
    from: "Camas",
    to: "Hospital Virgen Macarena",
    trip: [-11, "07:35"],
    cancel: [-12, "21:00"],
    cancelledBy: "passenger",
    cancelReason: "no_longer_needed",
    decided: [-11, "09:10"],
    note: "Cancelación con antelación; criterio caso a caso.",
    basis: "manual_without_policy",
    refunded: [-10, "12:30"],
    method: "card",
  },
  {
    key: "irene",
    passenger: "irene",
    driver: "carlos",
    status: "refunded",
    origin: "driver_cancellation",
    paid: 500,
    proposed: 500,
    approved: 500,
    from: "Mairena del Aljarafe",
    to: "Nervión (Trabajo)",
    trip: [-14, "07:40"],
    cancel: [-14, "06:55"],
    cancelledBy: "driver",
    cancelReason: "emergency",
    decided: [-14, "09:20"],
    note: "Cancelación de la persona conductora: devolución completa.",
    basis: "manual_without_policy",
    refunded: [-13, "10:15"],
    method: "apple_pay",
  },
  {
    key: "nuria",
    passenger: "nuria",
    driver: "daniel",
    status: "refunded",
    origin: "late_payment",
    paid: 400,
    proposed: 400,
    approved: 400,
    from: "San Juan de Aznalfarache",
    to: "Nervión (Trabajo)",
    trip: [-17, "08:30"],
    cancel: [-18, "18:02"],
    cancelledBy: null,
    cancelReason: null,
    decided: [-17, "09:00"],
    note: "Pago recibido con la plaza ya liberada: devolución íntegra.",
    basis: "late_payment_full_refund",
    refunded: [-16, "11:45"],
    method: "google_pay",
  },
  // ── Rechazadas ──
  {
    key: "lucia",
    passenger: "lucia",
    driver: "marta",
    status: "rejected",
    origin: "passenger_cancellation",
    paid: 450,
    proposed: 450,
    from: "Bellavista",
    to: "Cartuja (Universidad)",
    trip: [-11, "08:10"],
    cancel: [-11, "08:02"],
    cancelledBy: "passenger",
    cancelReason: "other",
    cancelNote: "Me ha surgido un imprevisto.",
    decided: [-10, "10:20"],
    note: "Cancelada con el viaje ya en marcha: fuera de las condiciones.",
    method: "card",
  },
  {
    key: "pablo",
    passenger: "pablo",
    driver: "carlos",
    status: "rejected",
    origin: "no_show",
    paid: 300,
    proposed: 300,
    from: "Dos Hermanas",
    to: "Sevilla Este",
    trip: [-15, "07:45"],
    cancel: [-15, "08:02"],
    cancelledBy: null,
    cancelReason: null,
    decided: [-14, "11:00"],
    note: "No se presentó en el punto de recogida.",
    method: "apple_pay",
  },
  {
    key: "alvaro",
    passenger: "alvaro",
    driver: "miguelAngel",
    status: "rejected",
    origin: "passenger_cancellation",
    paid: 400,
    proposed: 400,
    from: "Los Remedios",
    to: "Cartuja (Universidad)",
    trip: [-20, "08:00"],
    cancel: [-20, "07:41"],
    cancelledBy: "passenger",
    cancelReason: "found_other_option",
    decided: [-19, "09:40"],
    note: "Cancelada a menos de 30 minutos de la salida.",
    method: "card",
  },
  {
    key: "carmen",
    passenger: "carmen",
    driver: "marta",
    status: "rejected",
    origin: "passenger_cancellation",
    paid: 550,
    proposed: 550,
    from: "Tomares",
    to: "Estadio Benito Villamarín",
    trip: [-27, "19:45"],
    cancel: [-27, "19:20"],
    cancelledBy: "passenger",
    cancelReason: "schedule_change",
    decided: [-26, "10:05"],
    note: "Fuera de plazo de cancelación.",
    method: "google_pay",
  },
];

/** Las dos primeras tarjetas de 39b llevan otras fechas que las de 39a (las láminas no coinciden en el día). */
const STYLE_B_OVERRIDES: Readonly<Record<string, { trip: When; cancel: When }>> = {
  miguel: { trip: [-1, "08:12"], cancel: [-1, "08:26"] },
  ana: { trip: [-4, "17:40"], cancel: [-4, "17:55"] },
};

const defined = (cents: number): AmountRow => ({ cents, status: "illustrative" });
const PENDING: AmountRow = { cents: null, status: "pending_definition" };

function when(db: PreviewDb, [day, hhmm]: When): number {
  return madridDateTimeMs(addDaysToDate(madridDate(db.nowMs()), day), hhmm);
}

function methodLabel(kind: MethodKind): string | null {
  return kind === "card" ? "•••• 4242" : null;
}

function finalCostOf(spec: RefundSpec): AmountRow {
  const refunded = spec.approved ?? spec.proposed;
  return refunded === null ? PENDING : defined(Math.max(0, spec.paid - refunded));
}

function executionOf(status: RefundStatus): MoneyRefundRow["execution_status"] {
  switch (status) {
    case "approved":
      return "awaiting_provider";
    case "executing":
      return "submitted";
    case "refunded":
      return "succeeded";
    case "failed":
      return "failed";
    case "pending_review":
    case "rejected":
    case "not_applicable":
      return "not_started";
  }
}

function insertRefund(db: PreviewDb, spec: RefundSpec, style: RefundStyle): void {
  const tables = reviewTables(db);
  const override = style === "b" ? STYLE_B_OVERRIDES[spec.key] : undefined;
  const sep = style === "b" ? " · " : " - ";
  const tripAt = when(db, override?.trip ?? spec.trip);
  const cancelAt = when(db, override?.cancel ?? spec.cancel);
  const decidedAt = spec.decided === undefined ? null : when(db, spec.decided);
  const refundedAt = spec.refunded === undefined ? null : when(db, spec.refunded);
  const late = spec.origin === "late_payment";
  // El pago se hizo antes de cancelar (o es el instante en el que llegó el pago tardío).
  const paymentAt = late ? cancelAt : Math.min(cancelAt, tripAt) - 20 * TIME.MS_HOUR;

  const id = stableUuid(`review:refund:${spec.key}`);
  const paymentId = stableUuid(`review:payment:${spec.key}`);
  const requestId = stableUuid(`review:request:${spec.key}`);

  const ledger: LedgerLineRow[] = paymentLedger(db, spec.paid, paymentAt, late);
  if (spec.approved !== undefined && decidedAt !== null) {
    const kind = "refund_approved";
    const next = (account: string, amount: number): LedgerLineRow => ({
      id: db.ids.seq("ledger_entries"),
      created_at: decidedAt,
      transaction_kind: kind,
      account,
      amount_cents: amount,
    });
    ledger.push(next(late ? "suspense" : "driver_payable", -spec.approved), next("refund_payable", spec.approved));
  }
  if (spec.status === "refunded" && spec.approved !== undefined && refundedAt !== null) {
    const next = (account: string, amount: number): LedgerLineRow => ({
      id: db.ids.seq("ledger_entries"),
      created_at: refundedAt,
      transaction_kind: "refund_executed",
      account,
      amount_cents: amount,
    });
    ledger.push(next("refund_payable", -spec.approved), next("passenger", spec.approved));
  }

  const row: MoneyRefundRow = {
    id,
    user_id: SEED_USER_IDS[spec.passenger],
    status: spec.status,
    origin: spec.origin,
    booking_id: late ? null : stableUuid(`review:booking:${spec.key}`),
    request_id: requestId,
    payment_id: paymentId,
    paid: defined(spec.paid),
    proposed: spec.proposed === null ? PENDING : defined(spec.proposed),
    approved: spec.approved === undefined ? PENDING : defined(spec.approved),
    platform_fee: PENDING,
    final_cost: finalCostOf(spec),
    execution_status: executionOf(spec.status),
    policy_status: "pending_review",
    policy_version: null,
    created_at: cancelAt,
    decided_at: decidedAt,
    refunded_at: refundedAt,
  };
  const meta: RefundMetaRow = {
    id,
    province_code: "41",
    driver_user_id: SEED_USER_IDS[spec.driver],
    trip: {
      trip_id: stableUuid(`review:trip:${spec.key}`),
      departure_at: tripAt,
      origin_label: `Sevilla${sep}${spec.from}`,
      destination_label: `Sevilla${sep}${spec.to}`,
    },
    cancelled_by: spec.cancelledBy,
    cancelled_at: late ? null : cancelAt,
    cancel_reason: spec.cancelReason,
    cancel_note: spec.cancelNote ?? null,
    decision:
      decidedAt === null
        ? null
        : { by_user_id: SEED_USER_IDS.staff, at: decidedAt, note: spec.note ?? null, basis: spec.status === "rejected" ? null : (spec.basis ?? null) },
    payment: {
      id: paymentId,
      created_at: paymentAt,
      succeeded_at: paymentAt + 4_000,
      method_kind: spec.method,
      method_label: methodLabel(spec.method),
    },
    ledger,
    provider_confirms_at: null,
  };
  tables.refunds.put(row);
  tables.refundMeta.put(meta);
}

/** Las doce devoluciones de las láminas 39a (`a`) y 39b (`b`). */
export function seedRefunds(db: PreviewDb, style: RefundStyle): void {
  for (const spec of SPECS) insertRefund(db, spec, style);
}

/**
 * Variante «lista larga»: `count` propuestas abiertas más, de ejemplo, repartidas por los últimos 25 días (para probar la
 * paginación y «Cargar más»).
 */
export function seedBulkRefunds(db: PreviewDb, count: number): void {
  const passengers: readonly SeedUserKey[] = ["laura", "javier", "elena", "lucia", "pablo", "irene", "alvaro", "nuria", "hugo", "miguel"];
  const drivers: readonly SeedUserKey[] = ["carlos", "marta", "miguelAngel", "daniel", "carmen", "ana"];
  for (let index = 0; index < count; index += 1) {
    const passenger = passengers[index % passengers.length] ?? "laura";
    const driver = drivers[index % drivers.length] ?? "carlos";
    const day = -1 - Math.floor((index * 24) / Math.max(1, count));
    const cents = 300 + (index % 6) * 50;
    insertRefund(
      db,
      {
        key: `bulk-${index}`,
        passenger,
        driver,
        status: "pending_review",
        origin: index % 5 === 0 ? "driver_cancellation" : "passenger_cancellation",
        paid: cents,
        proposed: index % 4 === 0 ? null : cents,
        from: ["Nervión", "Triana", "Los Remedios", "Bellavista", "San Pablo", "Sevilla Este"][index % 6] ?? "Nervión",
        to: ["Cartuja (Universidad)", "Hospital Virgen del Rocío", "Palacio de Congresos", "Estación de Santa Justa"][index % 4] ?? "Cartuja (Universidad)",
        trip: [day, `${String(7 + (index % 10)).padStart(2, "0")}:${index % 2 === 0 ? "00" : "30"}`],
        cancel: [day - 1, `${String(8 + (index % 12)).padStart(2, "0")}:${index % 3 === 0 ? "10" : "40"}`],
        cancelledBy: index % 5 === 0 ? "driver" : "passenger",
        cancelReason: index % 5 === 0 ? "vehicle_issue" : "schedule_change",
        method: index % 3 === 0 ? "apple_pay" : "card",
      },
      "a",
    );
  }
}
