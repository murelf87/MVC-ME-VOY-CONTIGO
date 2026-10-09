/**
 * Lógica pura del paquete «pagos y cobros» (sin React, sin red): meses, importes, estados, movimientos, devoluciones,
 * justificantes y su texto compartible. Todo lo que decide qué se ve y con qué palabras vive aquí para poder probarlo.
 *
 * Reglas (docs/contracts/money.md §15):
 *  - Un importe sin definir se pinta «Por definir» (o `--,-- €` en los huecos grandes de la lámina 33); un importe
 *    `illustrative` se marca siempre como ilustrativo. El código NUNCA inventa un importe.
 *  - Una etiqueta de estado sale del estado que devuelve el servidor, con una salvaguarda: «Devuelta» solo con
 *    `refundedAt` (confirmación del proveedor) y «Abonada» solo con el estado `paid`.
 */
import type { Money, PublicUser } from "@/api/types/common";
import type {
  CommissionInfo,
  DriverEarningItem,
  DriverEarningState,
  MoneyTripRef,
  NextPayout,
  PassengerPaymentItem,
  PassengerPaymentState,
  PaymentMethod,
  PaymentMethodKind,
  PaymentsAvailability,
  PayoutStatus,
  Receipt,
  ReceiptKind,
  ReceiptLineKey,
  RefundOrigin,
  RefundView,
} from "@/api/types/money";
import { NBSP, formatDateShort, formatDateTime, formatDayRelative, formatDayShort, formatDecimal, formatTime, moneyParts, toCivilParts, type DateInput } from "@/i18n";
import type { IconName } from "@/icons";
import type { StatusTone } from "@/ui";
import { moneyStrings as t } from "./strings";

// ── Meses (Europe/Madrid) ───────────────────────────────────────────────────────────────────────────────────────

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MONTHS_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"] as const;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function isMonthKey(value: string): boolean {
  return MONTH_KEY.test(value);
}

/** Mes natural de un instante en hora de Madrid: `2026-10`. */
export function monthKeyOf(input: DateInput): string {
  const parts = toCivilParts(input);
  if (parts === null) return "";
  return `${parts.year}-${pad2(parts.month)}`;
}

function splitMonth(key: string): { year: number; month: number } | null {
  const match = MONTH_KEY.exec(key);
  if (match === null) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

/** Desplaza un mes `YYYY-MM` (positivo = futuro). Una clave inválida se devuelve igual. */
export function shiftMonth(key: string, delta: number): string {
  const parts = splitMonth(key);
  if (parts === null) return key;
  const index = parts.year * 12 + (parts.month - 1) + delta;
  return `${Math.floor(index / 12)}-${pad2((index % 12) + 1)}`;
}

/** Los últimos `count` meses, del más reciente (el de `now`) al más antiguo. */
export function recentMonthKeys(now: DateInput, count = 12): string[] {
  const current = monthKeyOf(now);
  if (!isMonthKey(current)) return [];
  return Array.from({ length: count }, (_, index) => shiftMonth(current, -index));
}

/** `septiembre` (mismo año que `now`) o `septiembre de 2025`. Cadena vacía si la clave no es válida. */
export function monthName(key: string, now: DateInput): string {
  const parts = splitMonth(key);
  const current = splitMonth(monthKeyOf(now));
  if (parts === null) return "";
  const name = MONTHS_LONG[parts.month - 1] ?? "";
  return current !== null && current.year === parts.year ? name : `${name} de ${parts.year}`;
}

/** `Septiembre de 2026` (siempre con año; para títulos de listas y hojas). */
export function monthLongLabel(key: string): string {
  const parts = splitMonth(key);
  if (parts === null) return "";
  const name = MONTHS_LONG[parts.month - 1] ?? "";
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${parts.year}`;
}

export function isCurrentMonth(key: string, now: DateInput): boolean {
  return key === monthKeyOf(now);
}

export function pendingTitle(month: string, now: DateInput): string {
  return isCurrentMonth(month, now) ? t.overview.pendingTitle : t.overview.pendingTitleFor(monthName(month, now));
}

export function toCollectTitle(month: string, now: DateInput): string {
  return isCurrentMonth(month, now) ? t.overview.toCollectTitle : t.overview.toCollectTitleFor(monthName(month, now));
}

// ── Importes ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface AmountView {
  /** Texto de importe en filas y desgloses: `12,00 €` o `Por definir`. */
  text: string;
  /** Texto para los huecos grandes de la lámina: `12,00 €` o `--,-- €`. */
  hero: string;
  pending: boolean;
  illustrative: boolean;
  /** Frase para lectores de pantalla (nunca lee los guiones). */
  spoken: string;
}

export const HERO_PENDING_TEXT = `--,--${NBSP}€`;

export function amountView(money: Money): AmountView {
  const parts = moneyParts(money);
  return {
    text: parts.text,
    hero: parts.pending ? HERO_PENDING_TEXT : parts.text,
    pending: parts.pending,
    illustrative: parts.illustrative,
    spoken: parts.pending ? t.a11y.amountPending : parts.illustrative ? `${parts.text}, ${t.a11y.amountIllustrative}` : parts.text,
  };
}

/** ¿Alguno de estos importes es ilustrativo? (la pantalla añade entonces la nota «Importes ilustrativos…»). */
export function anyIllustrative(amounts: ReadonlyArray<Money | null | undefined>): boolean {
  return amounts.some((amount) => amount !== null && amount !== undefined && amount.status === "illustrative");
}

/** `true` si lo que se muestra de dinero puede ser ilustrativo en una lista de filas. */
export function movementsIllustrative(movements: readonly Movement[]): boolean {
  return anyIllustrative(movements.map((movement) => movement.amount));
}

// ── Disponibilidad del proveedor ────────────────────────────────────────────────────────────────────────────────

export function paymentsBlocked(availability: PaymentsAvailability | undefined): boolean {
  return availability !== undefined && !availability.enabled;
}

// ── Personas y viajes ───────────────────────────────────────────────────────────────────────────────────────────

/** «Con Ana». */
export function withPerson(person: PublicUser): string {
  const first = person.firstName.trim() !== "" ? person.firstName.trim() : person.displayName.trim().split(/\s+/)[0] ?? "";
  return first === "" ? "Con otra persona" : `Con ${first}`;
}

/** `Sevilla → Camas`; con una sola etiqueta se muestra sola; sin ninguna, «Viaje». */
export function tripRouteText(trip: MoneyTripRef | null): string {
  if (trip === null) return "Viaje";
  const origin = trip.originLabel?.trim() ?? "";
  const destination = trip.destinationLabel?.trim() ?? "";
  if (origin !== "" && destination !== "") return `${origin} → ${destination}`;
  return origin !== "" ? origin : destination !== "" ? destination : "Viaje";
}

export interface DateLineOptions {
  /** Añade el año cuando no es el actual (`Vie, 16 may 2025`). La lámina 33 lo omite. */
  withYear?: boolean;
}

/**
 * Fecha de una fila. Hoy y mañana llevan la hora (`Mañana, 07:25`); cualquier otro día, pasado o futuro, se escribe como
 * fecha corta sin hora (`Vie, 16 may`), con el año si se pide y no es el actual. Sin salida del viaje se usa la fecha del
 * movimiento.
 */
export function tripDateText(trip: MoneyTripRef | null, occurredAt: string, now: DateInput, options: DateLineOptions = {}): string {
  const base = trip?.departureAt ?? occurredAt;
  const parts = toCivilParts(base);
  const today = toCivilParts(now);
  if (parts === null || today === null) return "";
  const dayDelta = Math.round(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000) - Math.round(Date.UTC(today.year, today.month - 1, today.day) / 86_400_000);
  if (dayDelta === 0 || dayDelta === 1) return `${formatDayRelative(base, now)}, ${formatTime(base)}`;
  const short = formatDayShort(base);
  return options.withYear === true && parts.year !== today.year ? `${short} ${parts.year}` : short;
}

// ── Estados: etiqueta y tono ────────────────────────────────────────────────────────────────────────────────────

export interface Chip {
  label: string;
  tone: StatusTone;
}

/**
 * Pasajero. Tonos de la lámina 33b: «Pendiente» en verde menta y «Pagado» en azul claro; el resto de estados que añade
 * producción usan ámbar (revisión), rojo (fallo) y gris (caducado / devuelto).
 */
export function paymentStateChip(state: PassengerPaymentState): Chip {
  const label = t.paymentState[state];
  switch (state) {
    case "pending":
      return { label, tone: "green" };
    case "paid":
      return { label, tone: "blue" };
    case "partially_refunded":
      return { label, tone: "blue" };
    case "under_review":
      return { label, tone: "amber" };
    case "failed":
      return { label, tone: "red" };
    case "refunded":
    case "expired":
      return { label, tone: "gray" };
  }
}

/** Conductor. «Cobrado» en verde (lámina 34b). */
export function earningStateChip(state: DriverEarningState): Chip {
  const label = t.earningState[state];
  switch (state) {
    case "paid_out":
      return { label, tone: "green" };
    case "available":
      return { label, tone: "blue" };
    case "in_payout":
      return { label, tone: "amber" };
    case "pending":
      return { label, tone: "gray" };
  }
}

export function payoutStatusChip(status: PayoutStatus): Chip {
  const label = t.payoutStatus[status];
  switch (status) {
    case "paid":
      return { label, tone: "green" };
    case "processing":
      return { label, tone: "amber" };
    case "draft":
      return { label, tone: "blue" };
    case "failed":
      return { label, tone: "red" };
    case "cancelled":
      return { label, tone: "gray" };
  }
}

/** «Devuelta» exige la confirmación del proveedor (`refundedAt`); si no llegó, sigue «En trámite». */
export function refundChip(refund: Pick<RefundView, "status" | "refundedAt" | "executionStatus">): Chip {
  switch (refund.status) {
    case "refunded":
      return refund.refundedAt !== null ? { label: t.refundStatus.refunded, tone: "green" } : { label: t.refundStatus.executing, tone: "amber" };
    case "approved":
      return { label: t.refundStatus.approved, tone: "blue" };
    case "executing":
      return { label: t.refundStatus.executing, tone: "amber" };
    case "pending_review":
      return { label: t.refundStatus.pending_review, tone: "amber" };
    case "rejected":
      return { label: t.refundStatus.rejected, tone: "red" };
    case "failed":
      return { label: t.refundStatus.failed, tone: "red" };
    case "not_applicable":
      return { label: t.refundStatus.not_applicable, tone: "gray" };
  }
}

export function receiptKindLabel(kind: ReceiptKind): string {
  switch (kind) {
    case "payment":
      return t.receipts.kindPayment;
    case "refund":
      return t.receipts.kindRefund;
    case "earning_statement":
      return t.receipts.kindEarning;
  }
}

export function receiptKindIcon(kind: ReceiptKind): IconName {
  switch (kind) {
    case "payment":
      return "receipt";
    case "refund":
      return "turn";
    case "earning_statement":
      return "coins";
  }
}

export function receiptTotalLabel(kind: ReceiptKind): string {
  switch (kind) {
    case "payment":
      return t.receipt.totalPayment;
    case "refund":
      return t.receipt.totalRefund;
    case "earning_statement":
      return t.receipt.totalEarning;
  }
}

export function receiptLineLabel(key: ReceiptLineKey): string {
  return t.receipt.lineLabels[key];
}

export function refundOriginLabel(origin: RefundOrigin): string {
  return t.refunds.origin[origin];
}

// ── Movimientos (filas de «Mis pagos» / «Últimos cobros» / «Mis movimientos») ───────────────────────────────────

export type MovementTarget =
  | { kind: "request_payment"; requestId: string }
  | { kind: "booking"; bookingId: string }
  | { kind: "earning"; bookingId: string };

export interface Movement {
  /** Estable para listas (`payment:<id>`, `request:<id>`, `earning:<bookingId>`). */
  key: string;
  role: "passenger" | "driver";
  person: PublicUser;
  trip: MoneyTripRef;
  amount: Money;
  occurredAt: string;
  /** Píldora de estado (listas de un solo rol). */
  chip: Chip;
  /** Pantalla a la que lleva la fila. */
  target: MovementTarget;
}

export function passengerMovement(item: PassengerPaymentItem): Movement {
  const target: MovementTarget =
    item.bookingId !== null ? { kind: "booking", bookingId: item.bookingId } : { kind: "request_payment", requestId: item.requestId };
  return {
    key: item.key,
    role: "passenger",
    person: item.driver,
    trip: item.trip,
    amount: item.amount,
    occurredAt: item.occurredAt,
    chip: paymentStateChip(item.state),
    target,
  };
}

export function driverMovement(item: DriverEarningItem): Movement {
  return {
    key: `earning:${item.bookingId}`,
    role: "driver",
    person: item.passenger,
    trip: item.trip,
    amount: item.net,
    occurredAt: item.occurredAt,
    chip: earningStateChip(item.state),
    target: { kind: "earning", bookingId: item.bookingId },
  };
}

function instant(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * «Mis movimientos» de la lámina 33a (cuenta con los dos roles): lo último de cada tipo, el viaje que paga como pasajero y
 * el último cobro como conductor, del más reciente al más antiguo. Es un resumen; el historial completo está en «Ver todos».
 */
export function overviewMovements(passenger: readonly PassengerPaymentItem[], driver: readonly DriverEarningItem[]): Movement[] {
  const latestPassenger = [...passenger].sort((a, b) => instant(b.occurredAt) - instant(a.occurredAt))[0];
  const latestDriver = [...driver].sort((a, b) => instant(b.occurredAt) - instant(a.occurredAt))[0];
  const rows: Movement[] = [];
  if (latestPassenger !== undefined) rows.push(passengerMovement(latestPassenger));
  if (latestDriver !== undefined) rows.push(driverMovement(latestDriver));
  return rows.sort((a, b) => instant(b.occurredAt) - instant(a.occurredAt));
}

// ── Comisión y próximo abono ────────────────────────────────────────────────────────────────────────────────────

/** `1000` → `10 %`; `750` → `7,5 %`. */
export function percentFromBps(bps: number): string {
  const digits = bps % 100 === 0 ? 0 : bps % 10 === 0 ? 1 : 2;
  return `${formatDecimal(bps / 100, digits)}${NBSP}%`;
}

/** Valor corto de la fila «Comisión de la plataforma». */
export function commissionValue(info: CommissionInfo, role: "passenger" | "driver" | "both"): string {
  if (info.status !== "defined") return t.pending;
  const passenger = info.passengerRateBps;
  const driver = info.driverRateBps;
  if (role === "passenger") return passenger === null ? t.pending : percentFromBps(passenger);
  if (role === "driver") return driver === null ? t.pending : percentFromBps(driver);
  if (passenger === null && driver === null) return t.pending;
  if (passenger !== null && driver !== null) return passenger === driver ? percentFromBps(passenger) : `${percentFromBps(passenger)} · ${percentFromBps(driver)}`;
  return percentFromBps((passenger ?? driver) as number);
}

/**
 * Párrafos de la hoja «Comisión de la plataforma». Sin comisión aprobada solo se dice que está por definir (nunca un
 * porcentaje de ejemplo); con ella se enseña la de cada rol que el servidor haya fijado.
 */
export function commissionParagraphs(info: CommissionInfo, role: "passenger" | "driver" | "both"): string[] {
  const sheet = t.commissionSheet;
  if (info.status !== "defined") return [sheet.pending];
  const rows: string[] = [];
  if ((role === "passenger" || role === "both") && info.passengerRateBps !== null) rows.push(sheet.passengerRate(percentFromBps(info.passengerRateBps)));
  if ((role === "driver" || role === "both") && info.driverRateBps !== null) rows.push(sheet.driverRate(percentFromBps(info.driverRateBps)));
  return rows.length === 0 ? [sheet.pending] : [...rows, sheet.defined];
}

export interface NextPayoutView {
  kind: NextPayout["status"];
  /** «Por definir» · `10 nov 2026` · «En proceso». */
  value: string;
  amount: Money;
  /** Texto de la hoja de información. */
  explanation: string;
}

export function nextPayoutView(next: NextPayout): NextPayoutView {
  const strings = t.nextPayoutSheet;
  switch (next.status) {
    case "scheduled": {
      const date = next.date !== null ? formatDateShort(next.date) : "";
      return {
        kind: "scheduled",
        value: date !== "" ? date : t.pending,
        amount: next.amount,
        explanation: date !== "" ? strings.scheduled(date) : strings.pending,
      };
    }
    case "processing":
      return { kind: "processing", value: t.overview.nextPayoutProcessing, amount: next.amount, explanation: strings.processing };
    case "pending_definition":
      return { kind: "pending_definition", value: t.pending, amount: next.amount, explanation: strings.pending };
  }
}

// ── Métodos de pago ─────────────────────────────────────────────────────────────────────────────────────────────

export function methodIcon(kind: PaymentMethodKind): IconName {
  switch (kind) {
    case "apple_pay":
      return "apple";
    case "bank_account":
    case "sepa_debit":
      return "euro";
    case "google_pay":
    case "card":
      return "card";
  }
}

/** `ES** **** **** 4589` + `· Caduca 08/28` en tarjetas. */
export function methodSubtitle(method: PaymentMethod): string {
  const expiry = method.expMonth !== null && method.expYear !== null ? t.methods.expires(method.expMonth, method.expYear) : null;
  return expiry === null ? method.maskedLabel : `${method.maskedLabel} · ${expiry}`;
}

export function methodStatusChip(status: PaymentMethod["status"]): Chip | null {
  switch (status) {
    case "active":
      return null;
    case "requires_action":
      return { label: t.methodStatus.requires_action, tone: "amber" };
    case "expired":
      return { label: t.methodStatus.expired, tone: "red" };
  }
}

/** Método predeterminado primero; después, el más reciente. */
export function sortMethods(methods: readonly PaymentMethod[]): PaymentMethod[] {
  return [...methods].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return instant(b.createdAt) - instant(a.createdAt);
  });
}

// ── Devoluciones: seguimiento ───────────────────────────────────────────────────────────────────────────────────

export type TrackingState = "done" | "current" | "upcoming" | "failed" | "skipped";

export interface TrackingStep {
  key: "requested" | "review" | "decision" | "refund";
  title: string;
  detail: string;
  state: TrackingState;
}

/**
 * Línea de seguimiento de una devolución. Solo afirma lo que el servidor dice: «Confirmada por el proveedor» exige
 * `executionStatus: "succeeded"` y `refundedAt`; hasta entonces el último paso queda pendiente.
 */
export function refundTracking(refund: RefundView): TrackingStep[] {
  const s = t.refunds;
  const steps: TrackingStep[] = [];
  steps.push({ key: "requested", title: s.steps.requested, detail: formatDateTime(refund.createdAt), state: "done" });

  const decidedOn = refund.decidedAt !== null ? formatDateShort(refund.decidedAt) : "";
  const decided = refund.status !== "pending_review";
  steps.push({
    key: "review",
    title: s.steps.review,
    detail: decided ? s.stepDetail.reviewDone : s.stepDetail.reviewPending,
    state: decided ? "done" : "current",
  });

  switch (refund.status) {
    case "pending_review":
      steps.push({ key: "decision", title: s.steps.decision, detail: s.stepDetail.decisionWaiting, state: "upcoming" });
      steps.push({ key: "refund", title: s.steps.refund, detail: s.stepDetail.refundWaiting, state: "upcoming" });
      break;
    case "rejected":
      steps.push({
        key: "decision",
        title: s.steps.decision,
        detail: decidedOn !== "" ? s.stepDetail.decisionRejected(decidedOn) : s.stepDetail.decisionRejected(formatDateShort(refund.createdAt)),
        state: "failed",
      });
      steps.push({ key: "refund", title: s.steps.refund, detail: s.stepDetail.refundNone, state: "skipped" });
      break;
    case "not_applicable":
      steps.push({ key: "decision", title: s.steps.decision, detail: s.stepDetail.decisionNotApplicable, state: "skipped" });
      steps.push({ key: "refund", title: s.steps.refund, detail: s.stepDetail.refundNone, state: "skipped" });
      break;
    default: {
      steps.push({
        key: "decision",
        title: s.steps.decision,
        detail: s.stepDetail.decisionApproved(decidedOn !== "" ? decidedOn : formatDateShort(refund.createdAt)),
        state: "done",
      });
      steps.push(refundExecutionStep(refund));
    }
  }
  return steps;
}

function refundExecutionStep(refund: RefundView): TrackingStep {
  const s = t.refunds;
  const title = s.steps.refund;
  if (refund.status === "refunded" && refund.refundedAt !== null && refund.executionStatus === "succeeded") {
    return { key: "refund", title, detail: s.stepDetail.refundSucceeded(formatDateShort(refund.refundedAt)), state: "done" };
  }
  if (refund.status === "failed" || refund.executionStatus === "failed") {
    return { key: "refund", title, detail: s.stepDetail.refundFailed, state: "failed" };
  }
  if (refund.executionStatus === "submitted" || refund.status === "executing" || refund.status === "refunded") {
    return { key: "refund", title, detail: s.stepDetail.refundSubmitted, state: "current" };
  }
  return { key: "refund", title, detail: s.stepDetail.refundAwaitingProvider, state: "current" };
}

/** Una devolución todavía puede cambiar de estado (la pantalla la refresca con más frecuencia). */
export function refundIsOpen(refund: Pick<RefundView, "status">): boolean {
  return refund.status === "pending_review" || refund.status === "approved" || refund.status === "executing";
}

// ── Justificantes ───────────────────────────────────────────────────────────────────────────────────────────────

/** Importe que se muestra en la fila de un justificante. */
export function receiptTotalText(total: Money): string {
  const view = amountView(total);
  return view.illustrative ? `${view.text} (${t.illustrativeTag})` : view.text;
}

/**
 * Texto plano del justificante para compartir o copiar. Usa el aviso legal que dicta el servidor (`notice`); no añade
 * nada que no esté en el justificante.
 */
export function receiptShareText(receipt: Receipt): string {
  const lines: string[] = [t.receipt.shareHeader, `${t.receipt.numberLabel}: ${receipt.number}`, `${t.receipt.typeLabel}: ${receiptKindLabel(receipt.kind)}`, `${t.receipt.issuedLabel}: ${formatDateTime(receipt.issuedAt)}`];
  if (receipt.trip !== null) {
    const who = receipt.counterpart !== null ? `${withPerson(receipt.counterpart)} · ` : "";
    lines.push(`${t.receipt.tripSection}: ${who}${tripRouteText(receipt.trip)}${receipt.trip.departureAt !== null ? ` · ${formatDateTime(receipt.trip.departureAt)}` : ""}`);
  }
  for (const line of receipt.lines) lines.push(`${receiptLineLabel(line.key)}: ${receiptTotalText(line.amount)}`);
  lines.push(`${receiptTotalLabel(receipt.kind)}: ${receiptTotalText(receipt.total)}`);
  lines.push(receipt.notice);
  return lines.join("\n");
}

/** Texto de la fila de un justificante: `MVC-J-2026-000012 · 9 oct 2026`. */
export function receiptRowSubtitle(number: string, issuedAt: string): string {
  return `${number} · ${formatDateShort(issuedAt)}`;
}

// ── Liquidaciones ───────────────────────────────────────────────────────────────────────────────────────────────

/** Segunda línea de una fila de liquidación: `4 viajes · Fecha por definir` / `· Prevista 10 nov 2026` / `· Abonada el …`. */
export function payoutRowSubtitle(trips: number, status: PayoutStatus, scheduledFor: string | null, paidAt: string | null): string {
  const tripsText = t.history.payoutTrips(trips);
  if (status === "paid" && paidAt !== null) return `${tripsText} · ${t.history.payoutPaidOn(formatDateShort(paidAt))}`;
  if (status === "cancelled") return tripsText;
  return `${tripsText} · ${scheduledFor !== null ? t.history.payoutScheduled(formatDateShort(scheduledFor)) : t.history.payoutScheduledPending}`;
}

/** Día del mes del calendario de abonos. */
export function scheduleText(schedule: { dayStatus: "pending_definition" | "defined"; dayOfMonth: number | null }): string {
  if (schedule.dayStatus === "defined" && schedule.dayOfMonth !== null) return t.history.scheduleDay(schedule.dayOfMonth);
  return t.history.scheduleDayPending;
}
