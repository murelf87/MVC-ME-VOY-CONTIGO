/**
 * Cliente de red del slice `messages`: bandeja y chat (docs/contracts/comms.md §2), notificaciones y preferencias (§1),
 * bloqueos y denuncias (§3) y cancelación de una reserva (docs/contracts/money.md §8.1–§8.2).
 *
 *   GET  /v1/conversations                                   → ConversationPage
 *   GET  /v1/conversations/unread-count                      → ConversationUnreadCount
 *   POST /v1/conversations/direct                            → ConversationDetail (201 nueva · 200 existente)
 *   GET  /v1/conversations/:id                               → ConversationDetail
 *   GET  /v1/conversations/:id/messages                      → ChatMessagePage (cursor ← antiguos · afterSeq → nuevos)
 *   POST /v1/conversations/:id/messages                      → ChatMessage (201 nuevo · 200 reintento idempotente)
 *   POST /v1/conversations/:id/read                          → MarkConversationReadResponse
 *   GET  /v1/conversations/:id/call-contact                  → PeerCallContact
 *   POST /v1/conversations/:id/messages/:messageId/report    → UserReport
 *   GET  /v1/me/blocks · PUT|DELETE /v1/me/blocks/:userId    → BlockedUsersPage · 204
 *   POST|GET /v1/me/reports                                  → UserReport · Page<UserReport>
 *   GET  /v1/notifications · unread-count · POST …/:id/read · POST …/read-all
 *   GET|PATCH /v1/me/notification-preferences
 *   GET|POST /v1/me/push-tokens · DELETE /v1/me/push-tokens/:id
 *   GET  /v1/bookings/:id/cancellation-preview · POST /v1/bookings/:id/cancel
 *
 * Las pantallas NO importan este fichero: pasan por los hooks de `./hooks`.
 */
import { apiRequest, registerErrorMessages, type CallOptions } from "@/api";
import type {
  AppNotification,
  BlockedUsersPage,
  CancelBookingRequest,
  CancelBookingResponse,
  CancellationPreview,
  ChatMessage,
  ChatMessagePage,
  ConversationDetail,
  ConversationFilter,
  ConversationPage,
  ConversationUnreadCount,
  CreateUserReportRequest,
  MarkConversationReadRequest,
  MarkConversationReadResponse,
  NotificationCategory,
  NotificationPage,
  NotificationPreferences,
  NotificationPreferencesPatch,
  NotificationReadAllRequest,
  NotificationReadAllResponse,
  NotificationUnreadCount,
  OpenDirectConversationRequest,
  Page,
  PeerCallContact,
  PushTokenInfo,
  PushTokenRegistration,
  RefundView,
  ReportMessageRequest,
  SendChatMessageRequest,
  UserReport,
} from "@/api/types";

/** Opciones de las llamadas que CREAN cosas: llevan `Idempotency-Key` (reutilizada al reintentar). */
export type WriteOptions = CallOptions & { idempotencyKey?: string };

registerErrorMessages({
  // Conversaciones y mensajes
  CONVERSATION_NOT_FOUND: { title: "Este chat no existe", message: "No encontramos este chat. Puede que la reserva se haya cancelado." },
  MESSAGE_NOT_FOUND: { title: "Mensaje no disponible", message: "No encontramos ese mensaje. Puede que ya no esté disponible." },
  CHAT_FORBIDDEN: { title: "Chat cerrado", message: "Este chat ya no está disponible porque la reserva ya no está vigente." },
  CHAT_BLOCKED: {
    title: "Chat no disponible",
    message: "Una de las dos personas ha bloqueado a la otra, así que no se pueden enviar ni ver mensajes.",
  },
  CHAT_SELF_FORBIDDEN: { message: "No puedes abrir un chat contigo mismo." },
  CHAT_IDEMPOTENCY_CONFLICT: {
    title: "Mensaje repetido",
    message: "Ya habíamos recibido otro mensaje distinto con ese identificador. Vuelve a escribirlo.",
  },
  INVALID_CHAT_MESSAGE: { title: "Mensaje no válido", message: "El mensaje debe tener entre 1 y 2.000 caracteres." },
  INVALID_LOCATION: { title: "Ubicación no válida", message: "No hemos podido compartir esa ubicación. Prueba con otra." },
  CALL_NOT_SUPPORTED_FOR_GROUPS: { message: "Las llamadas solo están disponibles en los chats de una reserva." },
  INVALID_CURSOR: { title: "La lista ha cambiado", message: "La lista ha cambiado mientras la mirabas. Actualízala e inténtalo de nuevo." },
  // Notificaciones
  NOTIFICATION_NOT_FOUND: { message: "No encontramos esa notificación." },
  ESSENTIAL_NOTICES_LOCKED: {
    title: "No se pueden apagar",
    message: "Los avisos esenciales del viaje no se pueden desactivar: te avisan de lo que afecta a tu reserva.",
  },
  PUSH_TOKEN_INVALID: { message: "No hemos podido registrar este móvil para recibir avisos." },
  PUSH_TOKEN_NOT_FOUND: { message: "Este móvil ya no estaba registrado para recibir avisos." },
  // Bloqueos y denuncias
  BLOCK_SELF_FORBIDDEN: { message: "No puedes bloquearte a ti mismo." },
  REPORT_SELF_FORBIDDEN: { title: "No es posible", message: "No puedes denunciarte a ti mismo ni denunciar tus propios mensajes." },
  REPORT_NOT_RELATED: {
    title: "No podemos tramitar esta denuncia",
    message: "Solo puedes denunciar a personas con las que has compartido una reserva o una conversación.",
  },
  REPORT_EVIDENCE_INVALID: {
    title: "Pruebas no válidas",
    message: "Alguno de los mensajes elegidos ya no está disponible o no es de esta conversación. Revisa la selección.",
  },
  REPORT_ALREADY_FILED: {
    title: "Ya la tenemos",
    message: "Ya has denunciado a esta persona por ese motivo en las últimas 24 horas. Nuestro equipo la está revisando.",
  },
  REPORT_IDEMPOTENCY_CONFLICT: { message: "Esta denuncia ya se envió con otros datos. Revisa el formulario e inténtalo de nuevo." },
  REPORT_RATE_LIMITED: {
    title: "Demasiadas denuncias",
    message: "Has enviado muchas denuncias hoy. Inténtalo de nuevo mañana o escríbenos desde el Centro de ayuda.",
  },
  // Cancelación (money)
  BOOKING_NOT_FOUND: { title: "Reserva no encontrada", message: "No encontramos esta reserva. Puede que ya no exista o que no sea tuya." },
  BOOKING_NOT_CANCELLABLE: { title: "No se puede cancelar", message: "Esta reserva ya no se puede cancelar desde la app." },
  TRIP_ALREADY_STARTED: { title: "El viaje ya ha empezado", message: "No puedes cancelar una reserva cuando el viaje ya ha empezado." },
  IDEMPOTENCY_KEY_REUSED: { message: "Esta acción ya se envió con otros datos. Vuelve a empezar." },
  IDEMPOTENCY_KEY_REQUIRED: { message: "No hemos podido enviar la acción de forma segura. Inténtalo de nuevo." },
});

const enc = encodeURIComponent;

// ── Bandeja y chat ───────────────────────────────────────────────────────────────────────────────────────────────

export interface ListConversationsQuery {
  filter?: ConversationFilter;
  /** 2–60 caracteres; `null`/vacío = sin búsqueda. */
  q?: string | null;
  limit?: number;
  cursor?: string | null;
}

export function listConversations(query: ListConversationsQuery = {}, options: CallOptions = {}): Promise<ConversationPage> {
  return apiRequest<ConversationPage>("/v1/conversations", {
    query: { filter: query.filter ?? "all", q: query.q ?? null, limit: query.limit ?? 20, cursor: query.cursor ?? null },
    ...options,
  });
}

export function getConversationUnreadCount(options: CallOptions = {}): Promise<ConversationUnreadCount> {
  return apiRequest<ConversationUnreadCount>("/v1/conversations/unread-count", options);
}

export function openDirectConversation(body: OpenDirectConversationRequest, options: CallOptions = {}): Promise<ConversationDetail> {
  return apiRequest<ConversationDetail>("/v1/conversations/direct", { method: "POST", body, ...options });
}

export function getConversation(conversationId: string, options: CallOptions = {}): Promise<ConversationDetail> {
  return apiRequest<ConversationDetail>(`/v1/conversations/${enc(conversationId)}`, options);
}

export interface ListChatMessagesQuery {
  limit?: number;
  /** Hacia atrás: mensajes más antiguos que el cursor. Excluyente con `afterSeq`. */
  cursor?: string | null;
  /** Sondeo: mensajes posteriores a este `seq`. Excluyente con `cursor`. */
  afterSeq?: number | null;
}

export function listChatMessages(conversationId: string, query: ListChatMessagesQuery = {}, options: CallOptions = {}): Promise<ChatMessagePage> {
  return apiRequest<ChatMessagePage>(`/v1/conversations/${enc(conversationId)}/messages`, {
    query: { limit: query.limit ?? 30, cursor: query.cursor ?? null, afterSeq: query.afterSeq ?? null },
    ...options,
  });
}

/** Un reintento con el mismo `clientMessageId` y el mismo contenido devuelve el mismo mensaje (200): nunca duplica. */
export function sendChatMessage(conversationId: string, body: SendChatMessageRequest, options: CallOptions = {}): Promise<ChatMessage> {
  return apiRequest<ChatMessage>(`/v1/conversations/${enc(conversationId)}/messages`, { method: "POST", body, ...options });
}

export function markConversationRead(
  conversationId: string,
  body: MarkConversationReadRequest = {},
  options: CallOptions = {},
): Promise<MarkConversationReadResponse> {
  return apiRequest<MarkConversationReadResponse>(`/v1/conversations/${enc(conversationId)}/read`, { method: "POST", body, ...options });
}

export function getPeerCallContact(conversationId: string, options: CallOptions = {}): Promise<PeerCallContact> {
  return apiRequest<PeerCallContact>(`/v1/conversations/${enc(conversationId)}/call-contact`, options);
}

export function reportChatMessage(
  conversationId: string,
  messageId: string,
  body: ReportMessageRequest,
  options: WriteOptions = {},
): Promise<UserReport> {
  return apiRequest<UserReport>(`/v1/conversations/${enc(conversationId)}/messages/${enc(messageId)}/report`, { method: "POST", body, ...options });
}

// ── Bloqueos y denuncias ─────────────────────────────────────────────────────────────────────────────────────────

export function listBlockedUsers(query: { limit?: number; cursor?: string | null } = {}, options: CallOptions = {}): Promise<BlockedUsersPage> {
  return apiRequest<BlockedUsersPage>("/v1/me/blocks", { query: { limit: query.limit ?? 20, cursor: query.cursor ?? null }, ...options });
}

/** Núcleo 0.14 (`PUT /v1/me/blocks/:userId`): 204. */
export function blockUser(userId: string, options: CallOptions = {}): Promise<void> {
  return apiRequest<void>(`/v1/me/blocks/${enc(userId)}`, { method: "PUT", ...options });
}

/** Núcleo 0.14 (`DELETE /v1/me/blocks/:userId`): 204. */
export function unblockUser(userId: string, options: CallOptions = {}): Promise<void> {
  return apiRequest<void>(`/v1/me/blocks/${enc(userId)}`, { method: "DELETE", ...options });
}

export function createUserReport(body: CreateUserReportRequest, options: WriteOptions = {}): Promise<UserReport> {
  return apiRequest<UserReport>("/v1/me/reports", { method: "POST", body, ...options });
}

export function listMyReports(query: { limit?: number; cursor?: string | null } = {}, options: CallOptions = {}): Promise<Page<UserReport>> {
  return apiRequest<Page<UserReport>>("/v1/me/reports", { query: { limit: query.limit ?? 20, cursor: query.cursor ?? null }, ...options });
}

// ── Notificaciones ───────────────────────────────────────────────────────────────────────────────────────────────

export interface ListNotificationsQuery {
  /** Sin categoría = «Todas». */
  category?: NotificationCategory | null;
  unread?: boolean;
  limit?: number;
  cursor?: string | null;
}

export function listNotifications(query: ListNotificationsQuery = {}, options: CallOptions = {}): Promise<NotificationPage> {
  return apiRequest<NotificationPage>("/v1/notifications", {
    query: { category: query.category ?? null, unread: query.unread === true ? true : null, limit: query.limit ?? 20, cursor: query.cursor ?? null },
    ...options,
  });
}

export function getNotificationUnreadCount(options: CallOptions = {}): Promise<NotificationUnreadCount> {
  return apiRequest<NotificationUnreadCount>("/v1/notifications/unread-count", options);
}

export function markNotificationRead(notificationId: string, options: CallOptions = {}): Promise<AppNotification> {
  return apiRequest<AppNotification>(`/v1/notifications/${enc(notificationId)}/read`, { method: "POST", ...options });
}

export function markAllNotificationsRead(body: NotificationReadAllRequest = {}, options: CallOptions = {}): Promise<NotificationReadAllResponse> {
  return apiRequest<NotificationReadAllResponse>("/v1/notifications/read-all", { method: "POST", body, ...options });
}

export function getNotificationPreferences(options: CallOptions = {}): Promise<NotificationPreferences> {
  return apiRequest<NotificationPreferences>("/v1/me/notification-preferences", options);
}

export function patchNotificationPreferences(patch: NotificationPreferencesPatch, options: CallOptions = {}): Promise<NotificationPreferences> {
  return apiRequest<NotificationPreferences>("/v1/me/notification-preferences", { method: "PATCH", body: patch, ...options });
}

export function registerPushToken(body: PushTokenRegistration, options: CallOptions = {}): Promise<PushTokenInfo> {
  return apiRequest<PushTokenInfo>("/v1/me/push-tokens", { method: "POST", body, ...options });
}

export function listPushTokens(query: { limit?: number; cursor?: string | null } = {}, options: CallOptions = {}): Promise<Page<PushTokenInfo>> {
  return apiRequest<Page<PushTokenInfo>>("/v1/me/push-tokens", { query: { limit: query.limit ?? 20, cursor: query.cursor ?? null }, ...options });
}

export function deletePushToken(tokenId: string, options: CallOptions = {}): Promise<void> {
  return apiRequest<void>(`/v1/me/push-tokens/${enc(tokenId)}`, { method: "DELETE", ...options });
}

// ── Cancelación de una reserva (money §8) ────────────────────────────────────────────────────────────────────────

export function getCancellationPreview(bookingId: string, options: CallOptions = {}): Promise<CancellationPreview> {
  return apiRequest<CancellationPreview>(`/v1/bookings/${enc(bookingId)}/cancellation-preview`, options);
}

/** `Idempotency-Key` OBLIGATORIA: repetir la llamada con la misma clave devuelve el mismo resultado (no cancela dos veces). */
export function cancelBooking(
  bookingId: string,
  body: CancelBookingRequest,
  options: CallOptions & { idempotencyKey: string },
): Promise<CancelBookingResponse> {
  return apiRequest<CancelBookingResponse>(`/v1/bookings/${enc(bookingId)}/cancel`, { method: "POST", body, ...options });
}

// ── Devoluciones del pasajero (resultado de cancelar) ────────────────────────────────────────────────────────────

/** `GET /v1/me/refunds` (módulo de pagos): devoluciones propuestas o decididas del pasajero. */
export function listMyRefunds(query: { limit?: number; cursor?: string | null } = {}, options: CallOptions = {}): Promise<Page<RefundView>> {
  return apiRequest<Page<RefundView>>("/v1/me/refunds", { query: { limit: query.limit ?? 50, cursor: query.cursor ?? null }, ...options });
}
