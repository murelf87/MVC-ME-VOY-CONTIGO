/**
 * Detalle de una solicitud/reserva y de una reserva semanal: banner de estado, pasos, cuenta atrás de la plaza retenida,
 * acciones disponibles y filas de ocurrencias. Funciones puras sobre `RideRequestDetail` y `WeeklyReservation`.
 */
import type { BannerKind } from "@/ui";
import type { StepState } from "@/ui";
import type {
  RequestHold,
  RequestStepper,
  RideRequestDetail,
  RideRequestStatus,
  WeeklyOccurrence,
  WeeklyReservation,
} from "@/api/types";
import { formatDayShort } from "@/i18n";
import { profileStrings } from "../strings";
import type { CardTone } from "./tripCards";

const bookingCopy = profileStrings.booking;
const weeklyCopy = profileStrings.weekly;

// ── Solicitud / reserva ───────────────────────────────────────────────────────────────────────────────────────────────

export function bookingBannerKind(status: RideRequestStatus): BannerKind {
  switch (status) {
    case "accepted":
    case "payment_pending":
    case "confirmed":
      return "success";
    case "rejected":
      return "error";
    case "expired":
    case "payment_late":
      return "warning";
    case "pending":
    case "cancelled":
      return "info";
  }
}

export interface BannerCopy {
  kind: BannerKind;
  title: string;
  message: string;
}

export function bookingBanner(status: RideRequestStatus): BannerCopy {
  const copy = bookingCopy.statusBanner[status];
  return { kind: bookingBannerKind(status), title: copy.title, message: copy.message };
}

/** Pasos «Solicitud → Aceptada → Pago → Confirmada» listos para `StepProgress`; `null` en los finales no felices. */
export function stepperOf(stepper: RequestStepper): { labels: string[]; states: StepState[] } | null {
  if (stepper.terminal !== null) return null;
  const labels = stepper.steps.map((step) => bookingCopy.steps[step.key]);
  const states = stepper.steps.map<StepState>((step) => {
    switch (step.state) {
      case "done":
        return "reached";
      case "current":
        return "complete";
      case "pending":
      case "failed":
        return "upcoming";
    }
  });
  return { labels, states };
}

/** Segundos que quedan de la plaza retenida, calculados contra «ahora» (el servidor solo da un instante de caducidad). */
export function holdRemainingSeconds(hold: RequestHold | null, nowMs: number): number | null {
  if (hold === null || !hold.active) return null;
  const expires = Date.parse(hold.expiresAt);
  if (!Number.isFinite(expires)) return null;
  return Math.max(0, Math.floor((expires - nowMs) / 1000));
}

export type BookingActionId = "pay" | "withdraw" | "chat" | "follow" | "share" | "cancel" | "weekly" | "searchAgain";

/**
 * Acciones de la persona que pidió la plaza, según el estado real:
 *  - pendiente: retirar la solicitud;
 *  - aceptada o con pago pendiente: confirmar y pagar mientras la plaza esté retenida;
 *  - confirmada: seguir el viaje, escribir al conductor, compartir el viaje y cancelar;
 *  - sin plaza (rechazada, caducada, cancelada…): buscar otro viaje.
 */
export function bookingActions(detail: Pick<RideRequestDetail, "status" | "booking" | "nextAction" | "weekly" | "hold">, nowMs: number): BookingActionId[] {
  const actions: BookingActionId[] = [];
  const holdActive = (holdRemainingSeconds(detail.hold, nowMs) ?? 0) > 0;
  switch (detail.status) {
    case "pending":
      actions.push("withdraw");
      break;
    case "accepted":
    case "payment_pending":
      if (detail.nextAction.kind === "pay" && holdActive) actions.push("pay");
      else actions.push("searchAgain");
      break;
    case "confirmed":
      if (detail.booking !== null) actions.push("follow", "chat", "share", "cancel");
      break;
    case "rejected":
    case "expired":
    case "cancelled":
    case "payment_late":
      actions.push("searchAgain");
      break;
  }
  if (detail.weekly !== null) actions.push("weekly");
  return actions;
}

// ── Reserva semanal ───────────────────────────────────────────────────────────────────────────────────────────────────

export function weeklyBanner(status: WeeklyReservation["status"]): BannerCopy {
  const copy = weeklyCopy.statusBanner[status];
  const kind: BannerKind =
    status === "confirmed" || status === "payment_pending"
      ? "success"
      : status === "rejected"
        ? "error"
        : status === "expired"
          ? "warning"
          : "info";
  return { kind, title: copy.title, message: copy.message };
}

export interface OccurrenceRow {
  key: string;
  dateLabel: string;
  legLabel: string;
  timeLabel: string;
  statusLabel: string;
  tone: CardTone;
  requestId: string | null;
}

function occurrenceStatus(occurrence: WeeklyOccurrence): { label: string; tone: CardTone } {
  if (occurrence.requestStatus !== null) {
    const label = weeklyCopy.requestStates[occurrence.requestStatus];
    const tone: CardTone =
      occurrence.requestStatus === "confirmed"
        ? "green"
        : occurrence.requestStatus === "pending"
          ? "amber"
          : occurrence.requestStatus === "payment_pending" || occurrence.requestStatus === "accepted"
            ? "orange"
            : occurrence.requestStatus === "rejected"
              ? "red"
              : "gray";
    return { label, tone };
  }
  const label = weeklyCopy.occurrenceStates[occurrence.state];
  return { label, tone: occurrence.state === "available" || occurrence.state === "requested" ? "blue" : "gray" };
}

/** Filas de «Viajes de la reserva»: día, trayecto, horas y estado de cada solicitud. */
export function buildOccurrenceRows(occurrences: readonly WeeklyOccurrence[]): OccurrenceRow[] {
  return [...occurrences]
    .sort((a, b) => (a.date === b.date ? (a.leg === b.leg ? 0 : a.leg === "outbound" ? -1 : 1) : a.date.localeCompare(b.date)))
    .map((occurrence) => {
      const status = occurrenceStatus(occurrence);
      const times =
        occurrence.boardsAtLocal !== null && occurrence.arrivesAtLocal !== null
          ? weeklyCopy.occurrenceTime(occurrence.boardsAtLocal, occurrence.arrivesAtLocal)
          : (occurrence.boardsAtLocal ?? occurrence.arrivesAtLocal ?? "");
      return {
        key: `${occurrence.date}-${occurrence.leg}-${occurrence.requestId ?? occurrence.tripId ?? "x"}`,
        dateLabel: formatDayShort(occurrence.date),
        legLabel: weeklyCopy.occurrenceLeg[occurrence.leg],
        timeLabel: times,
        statusLabel: status.label,
        tone: status.tone,
        requestId: occurrence.requestId,
      };
    });
}

/** Hay solicitudes que aún esperan respuesta del conductor y se pueden retirar. */
export function canWithdrawWeekly(reservation: Pick<WeeklyReservation, "occurrences" | "status">): boolean {
  if (reservation.status === "cancelled" || reservation.status === "rejected" || reservation.status === "expired") return false;
  return reservation.occurrences.some((occurrence) => occurrence.requestStatus === "pending");
}

/** Solicitud a la que llevar «Confirmar y pagar» de una reserva semanal: la primera con el pago pendiente. */
export function weeklyPayRequestId(reservation: Pick<WeeklyReservation, "occurrences" | "status" | "nextAction" | "hold">, nowMs: number): string | null {
  if (reservation.status !== "payment_pending" && reservation.status !== "partially_confirmed") return null;
  if (reservation.nextAction.kind !== "pay") return null;
  if ((holdRemainingSeconds(reservation.hold, nowMs) ?? 0) <= 0) return null;
  const open = reservation.occurrences.find(
    (occurrence) => occurrence.requestId !== null && (occurrence.requestStatus === "payment_pending" || occurrence.requestStatus === "accepted"),
  );
  return open?.requestId ?? null;
}
