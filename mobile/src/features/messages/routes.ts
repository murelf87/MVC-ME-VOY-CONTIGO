/**
 * Rutas del slice `messages` (lámina 07: mensajes, chat de reserva, notificaciones y cancelación).
 *
 * ANDAMIAJE: cada ruta apunta a `PendingScreen` hasta que el agente del slice escribe la pantalla real. Este fichero
 * es suyo desde ese momento: cambia `component`, ajusta los tipos de `MessagesParams` y añade las rutas nuevas
 * (legal, permisos, recibos…) que necesite. Reglas:
 *  - `MessagesParams` es un `type` (no `interface`) y SOLO lleva datos serializables (ids, textos, números).
 *  - Los nombres de ruta son únicos en TODA la app (el registro falla al arrancar si se repiten).
 *  - `access`: "public" (también invitados) · "auth" (por defecto) · "staff".
 *  - Pantalla = componente que recibe `AppScreenProps<"Nombre">`; navega con `useAppNavigation()` y lee los
 *    parámetros con `useAppRoute("Nombre")`.
 */
import { defineRoute, type RouteDef } from "@/navigation/routeDef";
import { BookingChatScreen } from "./screens/BookingChatScreen";
import { NotificationsScreen } from "./screens/NotificationsScreen";
import { CancelBookingScreen } from "./screens/CancelBookingScreen";
import { CancelBookingResultScreen } from "./screens/CancelBookingResultScreen";
import { NotificationSettingsScreen } from "./screens/NotificationSettingsScreen";
import { BlockedUsersScreen } from "./screens/BlockedUsersScreen";
import { ReportUserScreen } from "./screens/ReportUserScreen";
import { ConversationInfoScreen } from "./screens/ConversationInfoScreen";
import { InboxScreen } from "./screens/InboxScreen";

export type MessagesParams = {
  Inbox: { filter?: "all" | "bookings" | "groups" } | undefined;
  BookingChat: { conversationId: string };
  Notifications: { category?: "trip" | "message" | "payment" } | undefined;
  CancelBooking: { bookingId: string };
  // ── Páginas adicionales de producción (catálogo de docs/BUILD_BRIEF.md §10.3). Contrato entre equipos: añade parámetros opcionales, no renombres ni quites.
  NotificationSettings: undefined;
  BlockedUsers: undefined;
  ReportUser: { userId: string; conversationId?: string; messageId?: string };
  CancelBookingResult: { bookingId: string };
  ConversationInfo: { conversationId: string };
};

export const messagesRoutes: RouteDef[] = [
  defineRoute({ name: "Inbox", component: InboxScreen, access: "auth", screen: "25", title: "Mensajes" }),
  defineRoute({
    name: "BookingChat",
    component: BookingChatScreen,
    access: "auth",
    screen: "26",
    title: "Chat de reserva",
    previewParams: { conversationId: { $ref: "conversation.mine" } },
  }),
  defineRoute({ name: "Notifications", component: NotificationsScreen, access: "auth", screen: "27", title: "Notificaciones" }),
  defineRoute({ name: "CancelBooking", component: CancelBookingScreen, access: "auth", screen: "28", title: "Cancelar reserva" }),
  // ── Páginas adicionales de producción (sin lámina: se diseñan en el mismo lenguaje visual)
  defineRoute({ name: "NotificationSettings", component: NotificationSettingsScreen, access: "auth", title: "Ajustes de notificaciones" }),
  defineRoute({ name: "BlockedUsers", component: BlockedUsersScreen, access: "auth", title: "Personas bloqueadas" }),
  defineRoute({ name: "ReportUser", component: ReportUserScreen, access: "auth", title: "Denunciar" }),
  defineRoute({ name: "CancelBookingResult", component: CancelBookingResultScreen, access: "auth", title: "Reserva cancelada", previewParams: { bookingId: { $ref: "booking.mine" } } }),
  defineRoute({ name: "ConversationInfo", component: ConversationInfoScreen, previewParams: { conversationId: { $ref: "conversation.mine" } }, access: "auth", title: "Información del chat" }),
];
