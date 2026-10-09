/**
 * Reservas y devoluciones (pantalla 39 y detalle de devolución): modelos de tarjeta y máquina de estados de una
 * devolución tal y como la ve el personal (docs/contracts/money.md §8.5 y §10.3).
 *
 *   pending_review ──aprobar──► approved ──(proveedor activo)──► executing ──refund.succeeded──► refunded
 *         │                       │ (proveedor desactivado: executionStatus = awaiting_provider → «Bloqueado»)
 *         └──rechazar──► rejected                                  └─refund.failed─► failed ─(ejecutar)─► executing
 *
 * Regla de producto: NADA se marca «devuelto» sin la confirmación firmada del proveedor (`status = refunded`).
 * Funciones puras: se prueban en Node.
 */
import type {
  AdminBookingRow,
  AdminBookingStatus,
  AdminRefundItem,
  Money,
  RefundCancelledBy,
  RefundExecutionStatus,
  RefundOrigin,
  RefundStatus,
} from "@/api/types";
import { formatDateTime, formatTime, moneyParts } from "@/i18n";
import type { BannerKind, StatusTone } from "@/ui";
import { reviewStrings } from "../strings";
import { isPendingMoney } from "./money";
import { resolvePublicPhoto } from "./photo";

const t = reviewStrings.bookings;

// ── Tarjeta de la lista ───────────────────────────────────────────────────────────────────────────────────────────

export interface MoneyRowView {
  key: "paid" | "proposed" | "approved" | "fee" | "final";
  label: string;
  text: string;
  /** «Por definir»: se pinta en el color de aviso de la lámina. */
  pending: boolean;
  /** Importe de ejemplo (solo la vista previa lo emite): la etiqueta «ilustrativo» va tras el valor. */
  illustrative: boolean;
  emphasis: boolean;
}

export type RefundLineTone = "info" | "success" | "warning" | "error" | "muted";

export interface RefundLineView {
  text: string;
  tone: RefundLineTone;
}

export interface BillingCardView {
  /** Identificador estable para la lista (la devolución o la reserva). */
  key: string;
  /** Solo si el rol puede abrir la devolución (Finanzas / Administración). */
  refundId: string | null;
  name: string;
  photoUrl: string | null;
  whenText: string;
  statusLabel: string;
  statusTone: StatusTone;
  origin: string;
  destination: string;
  rows: MoneyRowView[];
  /** «Cancelada por el pasajero · 08:26». */
  cancellation: string | null;
  refundLine: RefundLineView | null;
  a11y: string;
}

function moneyRow(key: MoneyRowView["key"], label: string, money: Money, emphasis = false): MoneyRowView {
  const parts = moneyParts(money);
  return { key, label, text: parts.text, pending: parts.pending, illustrative: parts.illustrative, emphasis };
}

/** «Cancelada por el pasajero · 08:26». Sin hora, solo la frase. */
export function cancellationLine(
  origin: RefundOrigin | null,
  cancelledBy: RefundCancelledBy | "passenger" | "driver" | null,
  cancelledAt: string | null,
): string | null {
  let base: string | null = null;
  if (cancelledBy !== null) base = t.cancelledBy[cancelledBy];
  else if (origin === "no_show") base = t.noShowLine;
  else if (origin === "late_payment") base = t.latePaymentLine;
  else if (origin === "other") base = t.otherLine;
  if (base === null) return null;
  return cancelledAt !== null ? t.atTime(base, formatTime(cancelledAt)) : base;
}

const ORIGIN_TONE: Record<RefundOrigin, StatusTone> = {
  passenger_cancellation: "red",
  driver_cancellation: "red",
  platform_cancellation: "red",
  force_majeure: "blue",
  no_show: "orange",
  late_payment: "amber",
  other: "gray",
};

const BOOKING_TONE: Record<AdminBookingStatus, StatusTone> = {
  confirmed: "blue",
  completed: "green",
  cancelled: "red",
  driver_cancelled: "red",
  no_show: "orange",
};

/** Línea de estado de la devolución bajo la tabla (solo cuando ya no es una propuesta sin decidir). */
export function refundStateLine(status: RefundStatus, execution: RefundExecutionStatus): RefundLineView | null {
  const s = t.refundLine;
  switch (status) {
    case "pending_review":
    case "not_applicable":
      return null;
    case "approved":
      return execution === "awaiting_provider" ? { text: s.blocked, tone: "warning" } : { text: s.approved, tone: "info" };
    case "executing":
      return { text: s.executing, tone: "info" };
    case "refunded":
      return { text: s.refunded, tone: "success" };
    case "rejected":
      return { text: s.rejected, tone: "muted" };
    case "failed":
      return { text: s.failed, tone: "error" };
  }
}

function routeText(from: string | null, to: string | null): { origin: string; destination: string } {
  return { origin: from ?? t.unknownPlace, destination: to ?? t.unknownPlace };
}

/** Tarjeta de una propuesta de devolución (`GET /v1/admin/refund-proposals`). */
export function refundCardView(item: AdminRefundItem): BillingCardView {
  const { origin, destination } = routeText(item.trip.originLabel, item.trip.destinationLabel);
  const rows: MoneyRowView[] = [moneyRow("paid", t.labels.paid, item.paid), moneyRow("proposed", t.labels.proposed, item.proposedRefund)];
  if (item.status !== "pending_review" && !isPendingMoney(item.approvedRefund)) {
    rows.push(moneyRow("approved", t.labels.approved, item.approvedRefund));
  }
  rows.push(moneyRow("fee", t.labels.fee, item.platformFee), moneyRow("final", t.labels.final, item.finalPassengerCost, true));
  const statusLabel = t.originStatus[item.origin];
  return {
    key: item.id,
    refundId: item.id,
    name: item.passenger.displayName,
    photoUrl: resolvePublicPhoto(item.passenger.photoUrl),
    whenText: item.trip.departureAt !== null ? formatDateTime(item.trip.departureAt) : t.unknownTrip,
    statusLabel,
    statusTone: ORIGIN_TONE[item.origin],
    origin,
    destination,
    rows,
    cancellation: cancellationLine(item.origin, item.cancelledBy, item.cancelledAt),
    refundLine: refundStateLine(item.status, item.executionStatus),
    a11y: t.cardA11y(item.passenger.displayName, statusLabel, t.routeA11y(origin, destination)),
  };
}

function bookingRefundLine(status: AdminBookingRow["refund"]["status"]): RefundLineView | null {
  switch (status) {
    case "refunded":
      return { text: t.refundStates.refunded, tone: "success" };
    case "proposed":
      return { text: t.refundStates.proposed, tone: "info" };
    case "pending_definition":
      return { text: t.refundStates.pending_definition, tone: "muted" };
    case "not_applicable":
      return null;
  }
}

/** Tarjeta de una reserva (`GET /v1/admin/bookings`): para Atención al cliente, sin acciones de devolución. */
export function bookingCardView(row: AdminBookingRow): BillingCardView {
  const { origin, destination } = routeText(row.route.originLabel, row.route.destinationLabel);
  const statusLabel = row.statusLabel !== "" ? row.statusLabel : t.bookingStatus[row.status];
  return {
    key: row.bookingId,
    refundId: null,
    name: row.passenger.displayName,
    photoUrl: resolvePublicPhoto(row.passenger.photoUrl),
    whenText: row.tripDepartureAt !== null ? formatDateTime(row.tripDepartureAt) : t.unknownTrip,
    statusLabel,
    statusTone: BOOKING_TONE[row.status],
    origin,
    destination,
    rows: [
      moneyRow("paid", t.labels.paid, row.money.amountPaid),
      moneyRow("proposed", t.labels.proposed, row.money.proposedRefund),
      moneyRow("fee", t.labels.fee, row.money.platformCommission),
      moneyRow("final", t.labels.final, row.money.finalPassengerCost, true),
    ],
    cancellation: cancellationLine(null, row.cancelledBy, row.cancelledAt),
    refundLine: bookingRefundLine(row.refund.status),
    a11y: t.cardA11y(row.passenger.displayName, statusLabel, t.routeA11y(origin, destination)),
  };
}

// ── Máquina de estados (detalle) ──────────────────────────────────────────────────────────────────────────────────

export type RefundStage = "pending_review" | "approved_blocked" | "approved" | "executing" | "refunded" | "rejected" | "failed" | "not_applicable";

export function refundStage(status: RefundStatus, execution: RefundExecutionStatus): RefundStage {
  if (status === "approved") return execution === "awaiting_provider" ? "approved_blocked" : "approved";
  return status;
}

export type StepState = "done" | "current" | "pending" | "blocked" | "failed" | "rejected";

export interface RefundStep {
  key: "proposal" | "decision" | "provider" | "confirmation";
  label: string;
  state: StepState;
  caption: string | null;
}

/** Cuatro pasos: propuesta → decisión → envío al proveedor → confirmación del proveedor. */
export function refundSteps(item: Pick<AdminRefundItem, "status" | "executionStatus" | "createdAt" | "decidedAt" | "refundedAt" | "decision">): RefundStep[] {
  const r = reviewStrings.refund;
  const proposal: RefundStep = { key: "proposal", label: r.steps.proposal, state: "done", caption: formatDateTime(item.createdAt) };
  const decidedCaption = item.decidedAt !== null ? formatDateTime(item.decidedAt) : null;
  const pending = (key: RefundStep["key"], label: string): RefundStep => ({ key, label, state: "pending", caption: r.stepPending });
  const stage = refundStage(item.status, item.executionStatus);

  switch (stage) {
    case "pending_review":
      return [
        proposal,
        { key: "decision", label: r.steps.decision, state: "current", caption: r.stepPending },
        pending("provider", r.steps.provider),
        pending("confirmation", r.steps.confirmation),
      ];
    case "rejected":
      return [
        proposal,
        { key: "decision", label: r.steps.decision, state: "rejected", caption: decidedCaption ?? r.stepRejected },
        { key: "provider", label: r.steps.provider, state: "pending", caption: null },
        { key: "confirmation", label: r.steps.confirmation, state: "pending", caption: null },
      ];
    case "approved_blocked":
      return [
        proposal,
        { key: "decision", label: r.steps.decision, state: "done", caption: decidedCaption },
        { key: "provider", label: r.steps.provider, state: "blocked", caption: r.stepBlocked },
        pending("confirmation", r.steps.confirmation),
      ];
    case "approved":
      return [
        proposal,
        { key: "decision", label: r.steps.decision, state: "done", caption: decidedCaption },
        { key: "provider", label: r.steps.provider, state: "current", caption: r.stepPending },
        pending("confirmation", r.steps.confirmation),
      ];
    case "executing":
      return [
        proposal,
        { key: "decision", label: r.steps.decision, state: "done", caption: decidedCaption },
        { key: "provider", label: r.steps.provider, state: "done", caption: r.stepDone },
        { key: "confirmation", label: r.steps.confirmation, state: "current", caption: r.stepPending },
      ];
    case "refunded":
      return [
        proposal,
        { key: "decision", label: r.steps.decision, state: "done", caption: decidedCaption },
        { key: "provider", label: r.steps.provider, state: "done", caption: r.stepDone },
        { key: "confirmation", label: r.steps.confirmation, state: "done", caption: item.refundedAt !== null ? formatDateTime(item.refundedAt) : r.stepDone },
      ];
    case "failed":
      return [
        proposal,
        { key: "decision", label: r.steps.decision, state: "done", caption: decidedCaption },
        { key: "provider", label: r.steps.provider, state: "failed", caption: r.stepFailed },
        pending("confirmation", r.steps.confirmation),
      ];
    case "not_applicable":
      return [proposal];
  }
}

export interface RefundActions {
  approve: boolean;
  reject: boolean;
  execute: boolean;
  /** «Enviar al proveedor de pago» la primera vez; «Volver a pedirlo al proveedor» si ya falló. */
  executeLabel: string;
}

/** Qué acciones ofrece la pantalla en cada estado (y solo si el rol escribe). El servidor vuelve a comprobarlo. */
export function refundActions(item: Pick<AdminRefundItem, "status" | "executionStatus">, canAct: boolean): RefundActions {
  const r = reviewStrings.refund;
  const none: RefundActions = { approve: false, reject: false, execute: false, executeLabel: r.execute };
  if (!canAct) return none;
  if (item.status === "pending_review") return { ...none, approve: true, reject: true };
  if (item.status === "approved" && item.executionStatus === "awaiting_provider") return { ...none, execute: true, executeLabel: r.execute };
  if (item.status === "failed") return { ...none, execute: true, executeLabel: r.retryExecute };
  return none;
}

export interface RefundBannerView {
  kind: BannerKind;
  title: string;
  message: string;
}

/** Aviso principal del detalle: bloqueada, en curso, devuelta, fallida o rechazada. */
export function refundBanner(item: Pick<AdminRefundItem, "status" | "executionStatus" | "refundedAt">): RefundBannerView | null {
  const r = reviewStrings.refund;
  switch (refundStage(item.status, item.executionStatus)) {
    case "approved_blocked":
      return { kind: "notice", title: r.blockedTitle, message: r.blockedMessage };
    case "executing":
    case "approved":
      return { kind: "info", title: r.executingTitle, message: r.executingMessage };
    case "refunded":
      return { kind: "success", title: r.refundedTitle, message: r.refundedMessage(item.refundedAt !== null ? formatDateTime(item.refundedAt) : "—") };
    case "failed":
      return { kind: "error", title: r.failedTitle, message: r.failedMessage };
    case "rejected":
      return { kind: "info", title: r.rejectedTitle, message: r.rejectedMessage };
    case "pending_review":
    case "not_applicable":
      return null;
  }
}
