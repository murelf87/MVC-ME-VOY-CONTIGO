/**
 * Lógica pura de los avisos (pantalla 27): icono por tipo, destino al tocarlos y textos de vacío por filtro. El servidor
 * puede enviar tipos (`kind`) que la app no conoce: se muestran `title` y `body` tal cual con el icono de su categoría.
 */
import type { AppNotification, NotificationCategory } from "@/api/types";
import type { IconName } from "@/icons";
import type { IconTileTone } from "@/icons/IconTile";
import { messagesStrings } from "../strings";

const copy = messagesStrings.notifications;

export interface NotificationLook {
  icon: IconName;
  tone: IconTileTone;
}

export function lookOf(n: Pick<AppNotification, "kind" | "category">): NotificationLook {
  const { kind, category } = n;
  if (kind === "request_accepted" || kind === "booking_confirmed" || kind === "payment_confirmed" || kind === "payment_completed" || kind === "refund_completed") {
    return kind.startsWith("payment") || kind.startsWith("refund") ? { icon: "coins", tone: "amber" } : { icon: "check", tone: "solidGreen" };
  }
  if (kind === "pickup_soon" || kind.startsWith("arrival_")) return { icon: "car", tone: "green" };
  if (kind === "eta_changed" || kind === "pickup_changed" || kind.startsWith("route_change_")) return { icon: "clock", tone: "solidBlue" };
  if (kind.endsWith("_failed") || kind.endsWith("_rejected") || kind.includes("cancelled")) return { icon: "exclaim", tone: "red" };
  switch (category) {
    case "trip":
      return { icon: "car", tone: "green" };
    case "message":
      return { icon: "chat", tone: "blue" };
    case "payment":
      return { icon: "coins", tone: "amber" };
    case "system":
      return { icon: "bell", tone: "blue" };
  }
}

export type NotificationTarget =
  | { name: "RouteChange"; params: { proposalId: string; bookingId?: string } }
  | { name: "BookingChat"; params: { conversationId: string } }
  | { name: "WaitingForCar"; params: { bookingId: string } }
  | { name: "RequestStatusPayment"; params: { requestId: string } }
  | { name: "DriverRequestDetail"; params: { requestId: string } }
  | { name: "Refunds"; params: undefined }
  | { name: "PaymentHistory"; params: undefined }
  | { name: "SupportTicketDetail"; params: { ticketId: string } }
  | { name: "IncidentReports"; params: undefined };

const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** A dónde lleva un aviso; `null` si no hay nada que abrir (el aviso solo informa). */
export function targetOf(n: AppNotification): NotificationTarget | null {
  const data = n.data;
  const proposalId = str(data.proposalId);
  const conversationId = str(data.conversationId);
  const bookingId = str(data.bookingId);
  const requestId = str(data.requestId);
  const ticketId = str(data.ticketId);
  if (n.kind.startsWith("route_change_") && proposalId !== null) return { name: "RouteChange", params: { proposalId, ...(bookingId !== null ? { bookingId } : {}) } };
  if (n.category === "message" && conversationId !== null) return { name: "BookingChat", params: { conversationId } };
  if (n.kind.startsWith("refund_")) return { name: "Refunds", params: undefined };
  if (n.category === "payment") return { name: "PaymentHistory", params: undefined };
  if (n.kind === "support_reply" && ticketId !== null) return { name: "SupportTicketDetail", params: { ticketId } };
  if (n.kind === "report_update") return { name: "IncidentReports", params: undefined };
  if (n.kind === "request_received" || n.kind === "weekly_request_received") return requestId !== null ? { name: "DriverRequestDetail", params: { requestId } } : null;
  if (n.kind.startsWith("request_") && requestId !== null) return { name: "RequestStatusPayment", params: { requestId } };
  if (n.category === "trip" && bookingId !== null && !n.kind.includes("cancelled")) return { name: "WaitingForCar", params: { bookingId } };
  if (conversationId !== null) return { name: "BookingChat", params: { conversationId } };
  return null;
}

export function emptyCopyFor(category: NotificationCategory | null): { title: string; message: string } {
  switch (category) {
    case "trip":
      return { title: copy.emptyTripTitle, message: copy.emptyTripMessage };
    case "message":
      return { title: copy.emptyMessageTitle, message: copy.emptyMessageMessage };
    case "payment":
      return { title: copy.emptyPaymentTitle, message: copy.emptyPaymentMessage };
    default:
      return { title: copy.emptyAllTitle, message: copy.emptyAllMessage };
  }
}
