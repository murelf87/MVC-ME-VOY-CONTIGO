/**
 * Contrato del módulo «comms» (notificaciones, mensajes, grupos de ruta, bloqueos y denuncias,
 * centro de ayuda, ajustes de usuario y derechos sobre los datos).
 *
 * Fuente de verdad en el cable: los schemas Fastify de `src/modules/comms/**` producen exactamente estas formas.
 * Documentación de endpoints, errores y ejemplos: `docs/contracts/comms.md`.
 *
 * Pantallas que sirve: 25 Mensajes · 26 Chat de reserva · 27 Notificaciones · 34 Ajustes · 35 Centro de ayuda.
 *
 * Convenciones: fechas ISO-8601 UTC con milisegundos; ids uuid; paginación con `Page<T>` (cursor opaco);
 * el dinero viaja como `Money` (céntimos enteros). Los campos desconocidos que pueda añadir el servidor deben ignorarse.
 */
import type { IsoDateTime, Money, Page, PublicUser, TripCategory, Uuid } from "./common";

/* ────────────────────────────── Notificaciones (pantalla 27) ────────────────────────────── */

/** Categoría de una notificación. Filtros de la pantalla: Todas (sin categoría) · Viajes · Mensajes · Pagos. */
export type NotificationCategory = "trip" | "message" | "payment" | "system";

/** Datos para navegar desde el aviso. Nunca contienen datos sensibles. Pueden aparecer claves nuevas: ignorarlas. */
export interface NotificationData {
  tripId?: Uuid;
  bookingId?: Uuid;
  requestId?: Uuid;
  conversationId?: Uuid;
  ticketId?: Uuid;
  reportId?: Uuid;
  [key: string]: unknown;
}

export interface AppNotification {
  id: Uuid;
  category: NotificationCategory;
  /** Identificador estable del tipo de aviso: "pickup_soon", "eta_changed", "request_accepted", "payment_completed", "chat_message"… */
  kind: string;
  title: string;
  body: string;
  data: NotificationData;
  /**
   * true  → aviso esencial (no se puede desactivar: cambios de hora, recogida, aceptaciones, cancelaciones, pagos, seguridad).
   * false → aviso opcional (llegada del conductor «arrival_*» y mensajes de chat); el usuario puede desactivarlo.
   */
  essential: boolean;
  read: boolean;
  readAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export interface NotificationPage extends Page<AppNotification> {
  /** Total de no leídas (de todas las categorías), para la insignia. */
  unreadCount: number;
}

export interface NotificationUnreadCount {
  total: number;
  byCategory: Record<NotificationCategory, number>;
}

export interface NotificationReadAllRequest {
  /** Si se omite, se marcan todas. */
  category?: NotificationCategory;
}
export interface NotificationReadAllResponse {
  updated: number;
}

/** Estado real del envío push. Mientras `available` sea false, solo hay avisos dentro de la app. */
export interface PushDeliveryStatus {
  available: boolean;
  provider: string;
  /** "PROVIDER_DISABLED" mientras no haya proveedor push configurado en el servidor. */
  reason: "PROVIDER_DISABLED" | null;
  registeredDevices: number;
}

export interface NotificationPreferences {
  /** «Avisos esenciales del viaje». SIEMPRE true: el servidor rechaza cualquier intento de desactivarlo. */
  essentialTripNotices: true;
  /** «Avisos opcionales de llegada (recomendado)». */
  arrivalAlerts: boolean;
  /** Avisos por mensajes nuevos del chat. */
  messages: boolean;
  push: PushDeliveryStatus;
  updatedAt: IsoDateTime | null;
}

export interface NotificationPreferencesPatch {
  /** Solo se admite `true`; `false` → 422 ESSENTIAL_NOTICES_LOCKED. */
  essentialTripNotices?: boolean;
  arrivalAlerts?: boolean;
  messages?: boolean;
}

export type PushPlatform = "ios" | "android" | "web";
export type PushTokenProvider = "expo" | "fcm" | "apns";

export interface PushTokenRegistration {
  token: string;
  platform: PushPlatform;
  provider: PushTokenProvider;
  /** Identificador estable del dispositivo en la app (no el IMEI). */
  deviceId?: string;
  appVersion?: string;
  locale?: string;
}

export interface PushTokenInfo {
  id: Uuid;
  platform: PushPlatform;
  provider: PushTokenProvider;
  deviceId: string | null;
  appVersion: string | null;
  createdAt: IsoDateTime;
  lastSeenAt: IsoDateTime;
}

/* ────────────────────────────── Mensajes (pantallas 25 y 26) ────────────────────────────── */

export type ConversationKind = "direct" | "group";
/** Pestañas de la pantalla 25: Todos · Mis reservas · Grupos. */
export type ConversationFilter = "all" | "bookings" | "groups";
export type ConversationRole = "driver" | "passenger";
/** Tipos de mensaje. Notas de voz e imágenes en el chat: NO implementado (ver docs/contracts/comms.md §Bloqueado). */
export type ChatMessageKind = "text" | "location";
/** Acuse de un mensaje propio: enviado (✓) · entregado (✓✓ gris) · leído (✓✓ azul). */
export type ReceiptState = "sent" | "delivered" | "read";

export interface ConversationLastMessage {
  id: Uuid;
  kind: ChatMessageKind;
  /** Texto listo para la fila. En grupos lleva el prefijo «Ana: » (o «Tú: »); las ubicaciones se muestran como «Ubicación: <etiqueta>». */
  preview: string;
  senderId: Uuid;
  mine: boolean;
  createdAt: IsoDateTime;
}

export interface ConversationSummary {
  id: Uuid;
  kind: ConversationKind;
  /** direct: nombre de la otra persona («Ana»). group: «Ruta Sevilla · Trabajo». */
  title: string;
  /** direct: «Ruta al trabajo · Sevilla», «Universidad · Sevilla»… group: null. */
  subtitle: string | null;
  /** Solo en direct. */
  peer: PublicUser | null;
  /** Solo en group: personas con acceso ahora mismo (conductor incluido). */
  memberCount: number | null;
  myRole: ConversationRole;
  category: TripCategory;
  provinceName: string | null;
  /** direct: viaje de la reserva. group: viaje ancla de la ruta (puede no ser el próximo). */
  tripId: Uuid | null;
  /** direct: reserva del pasajero. */
  bookingId: Uuid | null;
  lastMessage: ConversationLastMessage | null;
  /** Insignia roja de la fila. */
  unreadCount: number;
  /** Fecha del último mensaje o, si aún no hay, del inicio de la conversación (para ordenar). */
  lastActivityAt: IsoDateTime;
}

export interface ConversationPlace {
  label: string | null;
  lat: number;
  lng: number;
}

export interface ConversationTrip {
  id: Uuid;
  status: "draft" | "published" | "active" | "completed" | "cancelled";
  departureAt: IsoDateTime | null;
  /** departureAt + duración de la ruta; null si no hay ruta calculada. */
  arrivalEstimateAt: IsoDateTime | null;
  /** «Sevilla Centro» */
  originLabel: string | null;
  /** «Isla Mágica» */
  destinationLabel: string | null;
}

export interface ConversationBooking {
  id: Uuid;
  /** Solo hay chat con reservas confirmadas o completadas. */
  status: "confirmed" | "completed";
  /** Modelo actual: una solicitud = una plaza. */
  seats: number;
}

export interface ConversationMember {
  user: PublicUser;
  role: ConversationRole;
}

/** Cabecera del chat (pantalla 26): tarjetas «Tu reserva confirmada», «Punto de recogida» y «Aporte del viaje». */
export interface ConversationDetail extends ConversationSummary {
  /** direct: datos del viaje. group: null. */
  trip: ConversationTrip | null;
  /** direct: reserva (la del pasajero, la veas como conductor o como pasajero). group: null. */
  booking: ConversationBooking | null;
  /** direct: punto de recogida de la reserva. */
  pickupPoint: ConversationPlace | null;
  /** direct: aporte del viaje. «Por definir» (`pending_definition`) mientras no haya tarifa aprobada. group: null. */
  contribution: Money | null;
  /** group: «Sevilla Centro → Isla Mágica». */
  routeLabel: string | null;
  /** group: miembros actuales. direct: null. */
  members: ConversationMember[] | null;
}

export interface ConversationPage extends Page<ConversationSummary> {
  /** Total de mensajes sin leer en todas las conversaciones (insignia de «Mensajes»). */
  unreadTotal: number;
}

export interface ConversationUnreadCount {
  total: number;
  direct: number;
  groups: number;
  conversationsWithUnread: number;
}

export interface ChatLocation {
  lat: number;
  lng: number;
  label: string | null;
}

export interface MessageReceipt {
  state: ReceiptState;
  /** Otras personas con acceso a la conversación en este momento (1 en directos). */
  recipientCount: number;
  deliveredCount: number;
  readCount: number;
}

export interface ChatMessage {
  id: Uuid;
  /** Número de orden dentro de la conversación (creciente). Úsalo para `afterSeq`/`upToSeq`. */
  seq: number;
  conversationId: Uuid;
  senderId: Uuid;
  senderName: string;
  mine: boolean;
  kind: ChatMessageKind;
  /** null si el mensaje fue retirado por moderación (`hidden`). Para ubicaciones es la etiqueta. */
  body: string | null;
  location: ChatLocation | null;
  hidden: boolean;
  /** Solo en mensajes propios. */
  receipt: MessageReceipt | null;
  createdAt: IsoDateTime;
}

/**
 * Página de mensajes en orden cronológico ascendente.
 * Con `cursor` (hacia atrás): `nextCursor` apunta a mensajes MÁS ANTIGUOS (null = no hay más).
 * Con `afterSeq` (sondeo de nuevos): `nextCursor` es siempre null.
 */
export interface ChatMessagePage extends Page<ChatMessage> {
  /** Último `seq` leído por mí en esta conversación. */
  lastReadSeq: number;
}

export interface OpenDirectConversationRequest {
  tripId: Uuid;
  peerUserId: Uuid;
}

export interface SendChatMessageRequest {
  /** Uuid generado por el cliente: hace idempotente el reintento (mismo id + mismo contenido = mismo mensaje). */
  clientMessageId: Uuid;
  kind?: ChatMessageKind;
  /** Obligatorio si kind = "text" (1–2000 caracteres tras recortar). Opcional en "location". */
  body?: string;
  /** Obligatorio si kind = "location". */
  location?: { lat: number; lng: number; label?: string };
}

export interface MarkConversationReadRequest {
  /** Hasta qué `seq` se marca leído. Por defecto, todo lo recibido. */
  upToSeq?: number;
}
export interface MarkConversationReadResponse {
  conversationId: Uuid;
  lastReadSeq: number;
  unreadCount: number;
}

/** PEER_UNAVAILABLE: la otra persona ya no tiene un teléfono activo (cuenta eliminada o suspendida). */
export type PeerCallUnavailableReason = "PEER_CALL_DISABLED" | "OUTSIDE_TRIP_WINDOW" | "PEER_UNAVAILABLE";

/** «Llamar a Ana». El teléfono solo se entrega a la otra parte de una reserva confirmada y dentro de la ventana del viaje. */
export interface PeerCallContact {
  available: boolean;
  reason: PeerCallUnavailableReason | null;
  peerFirstName: string;
  phoneE164: string | null;
  availableFrom: IsoDateTime | null;
  availableUntil: IsoDateTime | null;
}

/* ────────────────────────────── Bloqueos y denuncias ────────────────────────────── */

export interface BlockedUser {
  user: PublicUser;
  blockedAt: IsoDateTime;
}
export type BlockedUsersPage = Page<BlockedUser>;

export type UserReportReason =
  | "harassment"
  | "unsafe_behavior"
  | "inappropriate_content"
  | "spam_or_fraud"
  | "no_show"
  | "other";

/** Estados que gestiona el personal (módulo trust). */
export type UserReportStatus = "open" | "in_review" | "actioned" | "dismissed";

export interface CreateUserReportRequest {
  reportedUserId: Uuid;
  reason: UserReportReason;
  details?: string;
  /** Viaje en el que ambas personas participaron. */
  tripId?: Uuid;
  /** Conversación en la que ambas participan (necesaria si se aportan mensajes como prueba). */
  conversationId?: Uuid;
  /** Hasta 10 mensajes de esa conversación como prueba. Se guarda una copia literal en el momento de denunciar. */
  evidenceMessageIds?: Uuid[];
}

export interface ReportMessageRequest {
  reason: UserReportReason;
  details?: string;
}

export interface UserReport {
  id: Uuid;
  reportedUser: PublicUser;
  reason: UserReportReason;
  details: string | null;
  tripId: Uuid | null;
  conversationId: Uuid | null;
  evidenceCount: number;
  status: UserReportStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  resolvedAt: IsoDateTime | null;
}

/* ────────────────────────────── Centro de ayuda (pantalla 35) ────────────────────────────── */

/** «Problema en un viaje» · «Problema de pago» · «Mi perfil y cuenta». */
export type SupportCategory = "trip_issue" | "payment_issue" | "account_profile";
export type SupportTicketStatus = "open" | "answered" | "closed";
export type SupportAttachmentContentType = "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/heif";

/** Opción del selector «Selecciona un viaje (opcional)». La app formatea «Vie, 16 may · Sevilla → Camas». */
export interface SupportTripOption {
  tripId: Uuid;
  /** Reserva del usuario en ese viaje (si fue pasajero). */
  bookingId: Uuid | null;
  role: ConversationRole;
  departureAt: IsoDateTime | null;
  originLabel: string | null;
  destinationLabel: string | null;
  status: ConversationTrip["status"];
}

export interface SupportUploadIntentRequest {
  contentType: SupportAttachmentContentType;
  /** 1 byte – 10 MiB. */
  sizeBytes: number;
}
export interface SupportUploadIntent {
  intentId: Uuid;
  /** URL firmada para subir el archivo con PUT (misma mecánica que los documentos privados). */
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: IsoDateTime;
}

export interface SupportAttachment {
  id: Uuid;
  contentType: string;
  sizeBytes: number;
  createdAt: IsoDateTime;
}
export interface SupportAttachmentDownload {
  url: string;
  expiresAt: IsoDateTime;
}

export interface CreateSupportTicketRequest {
  category: SupportCategory;
  /** 1–500 caracteres (contador «0/500»). */
  body: string;
  tripId?: Uuid;
  bookingId?: Uuid;
  /** Hasta 4 adjuntos ya completados con /v1/me/support/uploads/:intentId/complete. */
  attachmentIds?: Uuid[];
}

export interface SupportReplyRequest {
  /** 1–1000 caracteres. */
  body: string;
  attachmentIds?: Uuid[];
}

export interface SupportTicketSummary {
  id: Uuid;
  /** Referencia legible para el usuario: «MVC-2026-000123». */
  reference: string;
  category: SupportCategory;
  status: SupportTicketStatus;
  bodyPreview: string;
  tripId: Uuid | null;
  bookingId: Uuid | null;
  attachmentCount: number;
  /** true si el equipo ya ha respondido alguna vez. */
  hasStaffReply: boolean;
  lastActivityAt: IsoDateTime;
  createdAt: IsoDateTime;
}

export interface SupportTicketMessage {
  id: Uuid;
  authorType: "user" | "staff";
  /** «Tú» no se calcula en el servidor: `authorType` basta. Para el personal: «Equipo MVC». */
  authorName: string;
  body: string;
  attachments: SupportAttachment[];
  createdAt: IsoDateTime;
}

export interface SupportTicketDetail extends SupportTicketSummary {
  body: string;
  /** Hilo completo en orden cronológico; el primer elemento es la consulta original. */
  messages: SupportTicketMessage[];
  closedAt: IsoDateTime | null;
}

/* ────────────────────────────── Ajustes (pantalla 34) ────────────────────────────── */

/** «Tamaño de letra»: Pequeño · Normal · Grande · Muy grande. */
export type FontScale = "small" | "normal" | "large" | "extra_large";

export interface SettingsAccountSummary {
  userId: Uuid;
  displayName: string | null;
  photoUrl: string | null;
  roles: Array<"passenger" | "driver" | "admin" | "verification_admin" | "finance_admin" | "support_admin">;
  /** Teléfono propio en E.164 («Mi móvil»). */
  phoneE164: string | null;
  /** Presente si hay una eliminación de cuenta programada (para mostrar el aviso). */
  pendingDeletion: { requestId: Uuid; scheduledFor: IsoDateTime } | null;
}

export interface UserSettings {
  /**
   * «Compartir ubicación en viaje — Solo durante el trayecto activo».
   * Si es false, la posición precisa del usuario no se comparte con los demás participantes.
   */
  shareLiveLocationInTrip: boolean;
  fontScale: FontScale;
  language: "es";
  updatedAt: IsoDateTime | null;
  account: SettingsAccountSummary;
}

export interface UserSettingsPatch {
  shareLiveLocationInTrip?: boolean;
  fontScale?: FontScale;
  language?: "es";
}

/* ────────────────────────────── Derechos sobre los datos ────────────────────────────── */

/**
 * queued/processing: en curso · ready: descargable · failed: error (se puede solicitar de nuevo) ·
 * blocked_storage_disabled: el servidor no tiene almacenamiento privado configurado, no se genera el archivo ·
 * expired: el enlace ya caducó.
 */
export type DataExportStatus = "queued" | "processing" | "ready" | "failed" | "blocked_storage_disabled" | "expired";

export interface DataExportRequest {
  id: Uuid;
  status: DataExportStatus;
  format: "json";
  requestedAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  /** Hasta cuándo se puede descargar. */
  expiresAt: IsoDateTime | null;
  sizeBytes: number | null;
  downloadable: boolean;
  errorCode: string | null;
}
export interface DataExportDownload {
  /** URL firmada de corta duración. */
  url: string;
  expiresAt: IsoDateTime;
}

export type AccountDeletionStatus = "scheduled" | "blocked" | "processing" | "completed" | "cancelled";

export type AccountDeletionBlockerCode =
  | "ACTIVE_TRIP_AS_DRIVER"
  | "UPCOMING_BOOKING_AS_PASSENGER"
  | "OPEN_RIDE_REQUEST"
  | "PENDING_PAYMENT_COMPENSATION"
  /** Otros módulos pueden registrar bloqueos propios (pagos pendientes, disputas…). */
  | (string & {});

export interface AccountDeletionBlocker {
  code: AccountDeletionBlockerCode;
  message: string;
  count: number;
}

export interface AccountDeletionRequest {
  id: Uuid;
  status: AccountDeletionStatus;
  requestedAt: IsoDateTime;
  /** Fin del periodo de gracia: ese día se ejecuta si no hay bloqueos. */
  scheduledFor: IsoDateTime;
  cancelledAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  /** Bloqueos detectados en la última comprobación (status = "blocked"). */
  blockers: AccountDeletionBlocker[];
}

export interface AccountDeletionPlan {
  /** Se borra por completo. */
  deleted: string[];
  /** Se conserva sin identificar a la persona. */
  anonymised: string[];
  /** Se conserva por obligación legal o seguridad, con su plazo. */
  retained: Array<{ item: string; reason: string; period: string }>;
}

export interface AccountDeletionState {
  /** Sin bloqueos ahora mismo. */
  eligible: boolean;
  blockers: AccountDeletionBlocker[];
  graceDays: number;
  /** Solicitud vigente (scheduled | blocked | processing) o la última finalizada/cancelada; null si nunca hubo. */
  request: AccountDeletionRequest | null;
  plan: AccountDeletionPlan;
}

export interface RequestAccountDeletionRequest {
  /** Debe ser exactamente "ELIMINAR". */
  confirmation: "ELIMINAR";
  reason?: string;
}

/* ────────────────────────────── Códigos de error estables ────────────────────────────── */

export type CommsErrorCode =
  | "VALIDATION_ERROR"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "RATE_LIMITED"
  | "INVALID_CURSOR"
  | "NOTIFICATION_NOT_FOUND"
  | "ESSENTIAL_NOTICES_LOCKED"
  | "PUSH_TOKEN_INVALID"
  | "PUSH_TOKEN_NOT_FOUND"
  | "CONVERSATION_NOT_FOUND"
  | "MESSAGE_NOT_FOUND"
  | "TRIP_NOT_FOUND"
  | "CHAT_SELF_FORBIDDEN"
  | "CHAT_FORBIDDEN"
  | "CHAT_BLOCKED"
  | "CHAT_IDEMPOTENCY_CONFLICT"
  | "INVALID_CHAT_MESSAGE"
  | "INVALID_LOCATION"
  | "CALL_NOT_SUPPORTED_FOR_GROUPS"
  | "USER_NOT_FOUND"
  | "REPORT_SELF_FORBIDDEN"
  | "REPORT_NOT_RELATED"
  | "REPORT_EVIDENCE_INVALID"
  | "REPORT_ALREADY_FILED"
  | "REPORT_IDEMPOTENCY_CONFLICT"
  | "REPORT_RATE_LIMITED"
  | "SUPPORT_TICKET_NOT_FOUND"
  | "SUPPORT_LINK_FORBIDDEN"
  | "SUPPORT_TICKET_CLOSED"
  | "SUPPORT_TICKET_LIMIT"
  | "SUPPORT_ATTACHMENT_LIMIT"
  | "SUPPORT_ATTACHMENT_INVALID"
  | "SUPPORT_ATTACHMENT_NOT_FOUND"
  | "SUPPORT_IDEMPOTENCY_CONFLICT"
  | "PRIVATE_STORAGE_NOT_CONFIGURED"
  | "PRIVATE_UPLOAD_TYPE_NOT_ALLOWED"
  | "PRIVATE_UPLOAD_SIZE_INVALID"
  | "UPLOAD_INTENT_NOT_FOUND"
  | "UPLOAD_INTENT_EXPIRED"
  | "UPLOAD_OBJECT_MISSING"
  | "UPLOAD_STORAGE_MISMATCH"
  | "UPLOADED_FILE_SIZE_MISMATCH"
  | "UPLOADED_FILE_TYPE_MISMATCH"
  | "EXPORT_NOT_FOUND"
  | "EXPORT_NOT_READY"
  | "EXPORT_EXPIRED"
  | "EXPORT_RATE_LIMITED"
  | "ACCOUNT_DELETION_CONFIRMATION_REQUIRED"
  | "ACCOUNT_DELETION_BLOCKED"
  | "ACCOUNT_DELETION_NOT_FOUND"
  | "ACCOUNT_DELETION_IN_PROGRESS";
