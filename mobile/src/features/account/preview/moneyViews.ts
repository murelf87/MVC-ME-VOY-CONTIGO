/**
 * Vistas del contrato `money` (SIMULACIÓN): convierten las filas `money_*` en las respuestas de
 * `mobile/src/api/types/money.ts` y calculan los resúmenes de la pantalla 33.
 *
 * Reglas de honestidad que cumple también la simulación (docs/contracts/money.md §15):
 *  - un importe sin tarifa es `pending_definition` (`cents: null`); los importes de ejemplo se emiten como `illustrative`,
 *    nunca como `defined` (el backend real jamás emite `illustrative`);
 *  - «Devuelta» solo si hay `refunded_at`, «Abonada» solo con `paid_at`: ninguna fila lo afirma sin la confirmación.
 *
 * Desviaciones DECLARADAS respecto al backend real (para reproducir las láminas 33a, 33b y 34b con datos coherentes):
 *  - `pendingThisMonth` suma los viajes PRÓXIMOS del mes (pagados o por pagar); el backend real solo suma los no pagados (§5.1).
 *  - `toCollectThisMonth` suma el neto de los viajes completados en el mes sea cual sea su estado de abono; el backend real
 *    excluye lo ya abonado (§5.3).
 *  - `recent` devuelve hasta 4 filas (el contrato dice 3; la lámina 34b muestra 4).
 */
import type { Money } from "@/api/types/common";
import type {
  CommissionInfo,
  DriverEarningDetail,
  DriverEarningItem,
  DriverPaymentsSummary,
  MoneyTripRef,
  MyPayoutsResponse,
  NextPayout,
  PassengerPaymentItem,
  PassengerPaymentsSummary,
  PaymentMethod,
  PaymentsAvailability,
  PayoutDetail,
  PayoutView,
  Receipt,
  ReceiptSummary,
  RefundView,
} from "@/api/types/money";
import { addDaysToDate, fail, formatEuros, iso, isoReq, madridDate, madridLocalToMs, madridParts, moneyDefined, moneyIllustrative, moneyPending, publicUser, type PreviewDb } from "@/preview";
import {
  moneyTables,
  readConfig,
  type AmountRow,
  type ConfigRow,
  type EarningRow,
  type MethodRow,
  type PaymentRow,
  type PayoutRow,
  type ReceiptRow,
  type RefundRow,
  type TripRefRow,
} from "./moneyRows";

/** Filas de `recent` en los resúmenes (el contrato dice 3; la lámina 34b muestra 4). */
export const RECENT_LIMIT = 4;

// ── Importes ────────────────────────────────────────────────────────────────────────────────────────────────────

export function amountDto(amount: AmountRow): Money {
  if (amount.status === "pending_definition" || amount.cents === null) return moneyPending();
  return amount.status === "illustrative" ? moneyIllustrative(amount.cents) : moneyDefined(amount.cents);
}

/** Suma honesta: vacío = 0 definido; algún «Por definir» = «Por definir»; algún ilustrativo = ilustrativo. */
export function sumAmounts(list: readonly AmountRow[]): Money {
  if (list.length === 0) return moneyDefined(0);
  let total = 0;
  let illustrative = false;
  for (const amount of list) {
    if (amount.status === "pending_definition" || amount.cents === null) return moneyPending();
    if (amount.status === "illustrative") illustrative = true;
    total += amount.cents;
  }
  return illustrative ? moneyIllustrative(total) : moneyDefined(total);
}

export function tripDto(trip: TripRefRow): MoneyTripRef {
  return { tripId: trip.trip_id, departureAt: iso(trip.departure_at), originLabel: trip.origin_label, destinationLabel: trip.destination_label };
}

// ── Disponibilidad, comisión y métodos ──────────────────────────────────────────────────────────────────────────

export function availabilityDto(config: Readonly<ConfigRow>): PaymentsAvailability {
  if (config.provider_enabled) {
    return { enabled: true, status: "enabled", message: null, chargeMethods: ["apple_pay", "card"], payoutsEnabled: true, refundsEnabled: true };
  }
  return { enabled: false, status: "provider_disabled", message: "Pagos aún no disponibles", chargeMethods: [], payoutsEnabled: false, refundsEnabled: false };
}

export function commissionDto(config: Readonly<ConfigRow>): CommissionInfo {
  return { status: config.commission_status, passengerRateBps: config.passenger_bps, driverRateBps: config.driver_bps };
}

export function methodDto(row: Readonly<MethodRow>): PaymentMethod {
  return {
    id: row.id,
    purpose: row.purpose,
    kind: row.kind,
    brand: row.brand,
    last4: row.last4,
    country: row.country,
    expMonth: row.exp_month,
    expYear: row.exp_year,
    title: row.title,
    maskedLabel: row.masked_label,
    isDefault: row.is_default,
    status: row.status,
    createdAt: isoReq(row.created_at),
  };
}

/** Método vigente (no retirado), predeterminado primero y después el más reciente. */
export function activeMethods(db: PreviewDb, userId: string, purpose: "charge" | "payout" | null): Array<Readonly<MethodRow>> {
  return moneyTables(db)
    .methods.filter((m) => m.user_id === userId && m.removed_at === null && (purpose === null || m.purpose === purpose))
    .sort((a, b) => (a.is_default !== b.is_default ? (a.is_default ? -1 : 1) : b.created_at - a.created_at));
}

export function defaultMethod(db: PreviewDb, userId: string, purpose: "charge" | "payout"): PaymentMethod | null {
  const first = activeMethods(db, userId, purpose)[0];
  return first === undefined ? null : methodDto(first);
}

// ── Pagos del pasajero y cobros del conductor ───────────────────────────────────────────────────────────────────

export function paymentItemDto(db: PreviewDb, row: Readonly<PaymentRow>): PassengerPaymentItem {
  return {
    key: row.id,
    kind: row.kind,
    requestId: row.request_id,
    bookingId: row.booking_id,
    paymentId: row.payment_id,
    driver: publicUser(db, row.driver_user_id),
    trip: tripDto(row.trip),
    amount: amountDto(row.amount),
    state: row.state,
    occurredAt: isoReq(row.occurred_at),
  };
}

export function earningItemDto(db: PreviewDb, row: Readonly<EarningRow>): DriverEarningItem {
  return {
    bookingId: row.id,
    passenger: publicUser(db, row.passenger_user_id),
    trip: tripDto(row.trip),
    net: amountDto(row.net),
    state: row.state,
    occurredAt: isoReq(row.occurred_at),
  };
}

export function earningDetailDto(db: PreviewDb, row: Readonly<EarningRow>): DriverEarningDetail {
  return {
    ...earningItemDto(db, row),
    lines: {
      contribution: amountDto(row.contribution),
      driverCommission: amountDto(row.driver_commission),
      refundAdjustments: amountDto(row.refund_adjustments),
      net: amountDto(row.net),
    },
    payoutId: row.payout_id,
  };
}

export function paymentsOf(db: PreviewDb, userId: string): Array<Readonly<PaymentRow>> {
  return moneyTables(db)
    .payments.filter((p) => p.user_id === userId)
    .sort((a, b) => b.occurred_at - a.occurred_at);
}

export function earningsOf(db: PreviewDb, userId: string): Array<Readonly<EarningRow>> {
  return moneyTables(db)
    .earnings.filter((e) => e.user_id === userId)
    .sort((a, b) => b.occurred_at - a.occurred_at);
}

// ── Meses (Europe/Madrid) ───────────────────────────────────────────────────────────────────────────────────────

export const MONTH_PATTERN = "^[0-9]{4}-(0[1-9]|1[0-2])$";

export function currentMonth(db: PreviewDb): string {
  const parts = madridParts(db.nowMs());
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

/** `[desde, hasta)` en ms del mes natural `YYYY-MM` en Madrid. */
export function monthBounds(month: string): [number, number] {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (match === null) return fail("VALIDATION_ERROR", "month must be YYYY-MM", 400);
  const year = Number(match[1]);
  const m = Number(match[2]);
  const nextYear = m === 12 ? year + 1 : year;
  const nextMonth = m === 12 ? 1 : m + 1;
  return [madridLocalToMs(year, m, 1), madridLocalToMs(nextYear, nextMonth, 1)];
}

function startOfToday(db: PreviewDb): number {
  const parts = madridParts(db.nowMs());
  return madridLocalToMs(parts.year, parts.month, parts.day);
}

// ── Resúmenes de la pantalla 33 ─────────────────────────────────────────────────────────────────────────────────

export function passengerSummaryDto(db: PreviewDb, userId: string, month: string): PassengerPaymentsSummary {
  const config = readConfig(db);
  const [from, to] = monthBounds(month);
  const today = startOfToday(db);
  const items = paymentsOf(db, userId);
  const upcoming = items.filter(
    (row) =>
      (row.state === "pending" || row.state === "paid") &&
      row.trip.departure_at !== null &&
      row.trip.departure_at >= Math.max(today, from) &&
      row.trip.departure_at < to,
  );
  return {
    month,
    availability: availabilityDto(config),
    pendingThisMonth: sumAmounts(upcoming.map((row) => row.amount)),
    upcomingTripsCount: upcoming.length,
    recent: items.slice(0, RECENT_LIMIT).map((row) => paymentItemDto(db, row)),
    paymentMethod: defaultMethod(db, userId, "charge"),
    platformCommission: commissionDto(config),
  };
}

export function nextPayoutDto(db: PreviewDb, userId: string): NextPayout {
  const config = readConfig(db);
  const today = madridDate(db.nowMs());
  const payouts = moneyTables(db).payouts.filter((p) => p.user_id === userId);
  const processing = payouts.filter((p) => p.status === "processing").sort((a, b) => b.created_at - a.created_at)[0];
  if (processing !== undefined) return { status: "processing", date: processing.scheduled_for, amount: amountDto(processing.net) };
  const draft = payouts
    .filter((p) => p.status === "draft" && p.scheduled_for !== null && p.scheduled_for >= today)
    .sort((a, b) => (a.scheduled_for ?? "").localeCompare(b.scheduled_for ?? ""))[0];
  if (draft !== undefined) return { status: "scheduled", date: draft.scheduled_for, amount: amountDto(draft.net) };
  if (config.payout_day !== null) {
    const parts = madridParts(db.nowMs());
    const day = String(config.payout_day).padStart(2, "0");
    const thisMonth = `${parts.year}-${String(parts.month).padStart(2, "0")}-${day}`;
    const date = thisMonth >= today ? thisMonth : addDaysToDate(thisMonth, 31).slice(0, 8) + day;
    const available = earningsOf(db, userId).filter((e) => e.state === "available");
    return { status: "scheduled", date, amount: sumAmounts(available.map((e) => e.net)) };
  }
  return { status: "pending_definition", date: null, amount: moneyPending() };
}

export function driverSummaryDto(db: PreviewDb, userId: string, month: string): DriverPaymentsSummary {
  const config = readConfig(db);
  const [from, to] = monthBounds(month);
  const items = earningsOf(db, userId);
  const completed = items.filter((row) => row.state !== "pending" && row.occurred_at >= from && row.occurred_at < to);
  return {
    month,
    availability: availabilityDto(config),
    toCollectThisMonth: sumAmounts(completed.map((row) => row.net)),
    completedTripsCount: completed.length,
    nextPayout: nextPayoutDto(db, userId),
    recent: items.slice(0, RECENT_LIMIT).map((row) => earningItemDto(db, row)),
    payoutAccount: defaultMethod(db, userId, "payout"),
    platformCommission: commissionDto(config),
  };
}

// ── Recibos ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function receiptSummaryDto(db: PreviewDb, row: Readonly<ReceiptRow>): ReceiptSummary {
  return {
    id: row.id,
    number: row.number,
    kind: row.kind,
    issuedAt: isoReq(row.issued_at),
    total: amountDto(row.total),
    trip: row.trip === null ? null : tripDto(row.trip),
    counterpart: row.counterpart_user_id === null ? null : publicUser(db, row.counterpart_user_id),
    bookingId: row.booking_id,
    paymentId: row.payment_id,
  };
}

export function receiptDto(db: PreviewDb, row: Readonly<ReceiptRow>): Receipt {
  return {
    ...receiptSummaryDto(db, row),
    fiscalInvoice: false,
    lines: row.lines.map((line) => ({ key: line.key, amount: amountDto(line.amount) })),
    notice: row.notice,
  };
}

const RECEIPT_LINE_LABEL: Readonly<Record<string, string>> = {
  contribution: "Aportación al viaje",
  platform_fee: "Gestión MVC",
  processing: "Gastos de pago",
  taxes: "Impuestos",
  refund: "Importe devuelto",
  driver_commission: "Comisión de MVC",
  refund_adjustments: "Devoluciones descontadas",
  net: "Neto",
};

const RECEIPT_KIND_LABEL: Readonly<Record<string, string>> = {
  payment: "Justificante de pago",
  refund: "Justificante de devolución",
  earning_statement: "Justificante de abono",
};

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function amountText(amount: AmountRow): string {
  if (amount.status === "pending_definition" || amount.cents === null) return "Por definir";
  return amount.status === "illustrative" ? `${formatEuros(amount.cents)} (ilustrativo)` : formatEuros(amount.cents);
}

function formatMadrid(ms: number): string {
  const p = madridParts(ms);
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${two(p.day)}/${two(p.month)}/${p.year} ${two(p.hour)}:${two(p.minute)}`;
}

/** Documento HTML autocontenido (sin scripts, texto escapado) del justificante: lo que el backend real devuelve en `/printable`. */
export function receiptPrintableHtml(db: PreviewDb, row: Readonly<ReceiptRow>): string {
  const counterpart = row.counterpart_user_id === null ? null : publicUser(db, row.counterpart_user_id);
  const tripLine =
    row.trip === null
      ? ""
      : `<p><strong>Viaje</strong><br>${escapeHtml(row.trip.origin_label ?? "Viaje")}${
          row.trip.destination_label !== null ? ` → ${escapeHtml(row.trip.destination_label)}` : ""
        }${row.trip.departure_at !== null ? `<br>${escapeHtml(formatMadrid(row.trip.departure_at))}` : ""}${
          counterpart !== null ? `<br>Con ${escapeHtml(counterpart.firstName)}` : ""
        }</p>`;
  const lines = row.lines.map((line) => `<tr><td>${escapeHtml(RECEIPT_LINE_LABEL[line.key] ?? line.key)}</td><td class="r">${escapeHtml(amountText(line.amount))}</td></tr>`).join("");
  return [
    "<!doctype html>",
    '<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(row.number)}</title>`,
    "<style>body{font-family:Helvetica,Arial,sans-serif;color:#00003c;margin:24px;max-width:560px}h1{font-size:22px;margin:0 0 4px}",
    "h2{font-size:15px;margin:18px 0 6px}table{width:100%;border-collapse:collapse}td{padding:6px 0;border-bottom:1px solid #d3e3f8}",
    ".r{text-align:right}.total td{font-weight:700;border-bottom:2px solid #00003c}.notice{margin-top:20px;padding:10px;background:#eaf4fe;border-radius:8px;font-size:13px}</style></head><body>",
    "<h1>MVC · Me voy contigo</h1>",
    `<p>${escapeHtml(RECEIPT_KIND_LABEL[row.kind] ?? "Justificante")} · ${escapeHtml(row.number)}<br>Emitido el ${escapeHtml(formatMadrid(row.issued_at))}</p>`,
    tripLine,
    "<h2>Desglose</h2>",
    `<table>${lines}<tr class="total"><td>Total</td><td class="r">${escapeHtml(amountText(row.total))}</td></tr></table>`,
    `<p class="notice">${escapeHtml(row.notice)}</p>`,
    "</body></html>",
  ].join("");
}

// ── Liquidaciones y devoluciones ────────────────────────────────────────────────────────────────────────────────

export function payoutViewDto(row: Readonly<PayoutRow>): PayoutView {
  return {
    id: row.id,
    period: row.period,
    status: row.status,
    net: amountDto(row.net),
    bookingsCount: row.bookings_count,
    scheduledFor: row.scheduled_for,
    paidAt: iso(row.paid_at),
    failureCode: row.failure_code,
    createdAt: isoReq(row.created_at),
  };
}

export function payoutDetailDto(db: PreviewDb, row: Readonly<PayoutRow>): PayoutDetail {
  const items = moneyTables(db)
    .earnings.filter((e) => e.payout_id === row.id)
    .sort((a, b) => b.occurred_at - a.occurred_at)
    .map((e) => earningItemDto(db, e));
  return { ...payoutViewDto(row), items };
}

export function payoutsResponse(db: PreviewDb, userId: string, page: { items: PayoutView[]; nextCursor: string | null }): MyPayoutsResponse {
  const config = readConfig(db);
  return {
    ...page,
    availability: availabilityDto(config),
    schedule: { frequency: "monthly", dayStatus: config.payout_day === null ? "pending_definition" : "defined", dayOfMonth: config.payout_day },
    nextPayout: nextPayoutDto(db, userId),
    payoutAccount: defaultMethod(db, userId, "payout"),
  };
}

export function refundDto(row: Readonly<RefundRow>): RefundView {
  return {
    id: row.id,
    status: row.status,
    origin: row.origin,
    bookingId: row.booking_id,
    requestId: row.request_id,
    paymentId: row.payment_id,
    paid: amountDto(row.paid),
    proposedRefund: amountDto(row.proposed),
    approvedRefund: amountDto(row.approved),
    platformFee: amountDto(row.platform_fee),
    finalPassengerCost: amountDto(row.final_cost),
    executionStatus: row.execution_status,
    policy: {
      status: row.policy_status,
      version: row.policy_version,
      effectiveFrom: null,
      summary: null,
    },
    createdAt: isoReq(row.created_at),
    decidedAt: iso(row.decided_at),
    refundedAt: iso(row.refunded_at),
  };
}

// ── Paginación por cursor opaco ─────────────────────────────────────────────────────────────────────────────────

const CURSOR_PATTERN = /^c\.(\d{1,6})$/;

export function paginate<T, R>(rows: readonly T[], cursor: string | undefined, limit: number, map: (row: T) => R): { items: R[]; nextCursor: string | null } {
  let offset = 0;
  if (cursor !== undefined && cursor !== "") {
    const match = CURSOR_PATTERN.exec(cursor);
    if (match === null) return fail("VALIDATION_ERROR", "cursor is not valid", 400, [{ path: "/cursor", message: "cursor is not valid" }]);
    offset = Number(match[1]);
  }
  const slice = rows.slice(offset, offset + limit);
  const next = offset + limit < rows.length ? `c.${offset + limit}` : null;
  return { items: slice.map(map), nextCursor: next };
}
