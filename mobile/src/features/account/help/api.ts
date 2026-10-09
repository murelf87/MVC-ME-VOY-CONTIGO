/**
 * Cliente de red del paquete «account-help»: ajustes (docs/contracts/comms.md §5), centro de ayuda (§4), derechos
 * sobre los datos (§6), documentos legales (docs/contracts/trust.md §4.2), baja del token push al cerrar sesión (§1.6)
 * y las dos sondas de salud del servidor.
 *
 *   GET|PATCH /v1/me/settings
 *   GET  /v1/me/support/trips
 *   POST /v1/me/support/uploads/intents · POST /v1/me/support/uploads/:intentId/complete
 *   GET  /v1/me/support/attachments/:attachmentId/download
 *   POST|GET /v1/me/support/tickets · GET /v1/me/support/tickets/:id
 *   POST /v1/me/support/tickets/:id/replies · POST /v1/me/support/tickets/:id/close
 *   POST|GET /v1/me/data-exports · GET /v1/me/data-exports/:id · GET /v1/me/data-exports/:id/download
 *   GET|POST /v1/me/account-deletion · POST /v1/me/account-deletion/cancel
 *   GET /v1/legal/documents · GET /v1/legal/documents/:kind[/versions/:n]            (público; los registra `auth`)
 *   GET|DELETE /v1/me/push-tokens[/:id]                                                (los registra `messages`)
 *   GET /health/live · GET /health/ready
 *
 * Las pantallas NO importan este fichero: pasan por los hooks de `./hooks`.
 */
import { apiRequest, putToSignedUrl, registerErrorMessages, type CallOptions } from "@/api";
import type {
  AccountDeletionState,
  CreateSupportTicketRequest,
  DataExportDownload,
  DataExportRequest,
  LegalDocument,
  LegalDocumentKind,
  LegalDocumentSummary,
  Page,
  PushTokenInfo,
  RequestAccountDeletionRequest,
  SupportAttachment,
  SupportAttachmentContentType,
  SupportAttachmentDownload,
  SupportReplyRequest,
  SupportTicketDetail,
  SupportTicketStatus,
  SupportTicketSummary,
  SupportTripOption,
  SupportUploadIntent,
  UserSettings,
  UserSettingsPatch,
} from "@/api/types";

/** Opciones de las llamadas que CREAN cosas: llevan `Idempotency-Key` (reutilizada al reintentar). */
export type WriteOptions = CallOptions & { idempotencyKey?: string };

registerErrorMessages({
  // Centro de ayuda (comms §4)
  SUPPORT_TICKET_NOT_FOUND: { title: "No encontramos esta consulta", message: "Puede que ya no exista. Mira tu lista de consultas." },
  SUPPORT_LINK_FORBIDDEN: {
    title: "Ese viaje no es tuyo",
    message: "Solo puedes relacionar tu consulta con viajes en los que has participado. Elige otro o envíala sin viaje.",
  },
  SUPPORT_TICKET_CLOSED: {
    title: "Consulta cerrada",
    message: "Esta consulta ya está cerrada y no admite más mensajes. Si necesitas algo más, abre una consulta nueva.",
  },
  SUPPORT_TICKET_LIMIT: {
    title: "Demasiadas consultas",
    message:
      "Has alcanzado el límite de consultas abiertas o de consultas enviadas hoy. Espera a que respondamos, cierra alguna que ya esté resuelta o inténtalo mañana.",
  },
  SUPPORT_ATTACHMENT_LIMIT: { title: "Demasiadas imágenes", message: "Puedes adjuntar hasta 4 imágenes." },
  SUPPORT_ATTACHMENT_INVALID: {
    title: "Imagen no válida",
    message: "Alguna de las imágenes ya no está disponible. Quítala y vuelve a subirla.",
  },
  SUPPORT_ATTACHMENT_NOT_FOUND: { title: "Imagen no disponible", message: "No encontramos esa imagen." },
  SUPPORT_IDEMPOTENCY_CONFLICT: {
    title: "Consulta repetida",
    message: "Esta consulta ya se envió con otro contenido. Revísala y vuelve a enviarla.",
  },
  PRIVATE_STORAGE_NOT_CONFIGURED: {
    title: "No se pueden adjuntar imágenes",
    message: "Ahora mismo el servicio no admite archivos adjuntos. Puedes enviar tu consulta sin imágenes.",
  },
  PRIVATE_UPLOAD_TYPE_NOT_ALLOWED: { message: "Solo se pueden adjuntar fotos (JPG, PNG, WebP o HEIC)." },
  PRIVATE_UPLOAD_SIZE_INVALID: { message: "La imagen debe pesar entre 1 byte y 10 MB." },
  UPLOAD_OBJECT_MISSING: { message: "La imagen no ha llegado al servidor. Vuelve a subirla." },
  UPLOADED_FILE_SIZE_MISMATCH: { message: "La imagen no coincide con la que ibas a enviar. Vuelve a subirla." },
  UPLOADED_FILE_TYPE_MISMATCH: { message: "El archivo no es una imagen válida. Prueba con otra." },
  // Descargar mis datos (comms §6.1)
  EXPORT_NOT_FOUND: { title: "No encontramos esa copia", message: "Puede que ya no exista. Mira tu lista de solicitudes." },
  EXPORT_NOT_READY: { title: "Todavía no está lista", message: "Tu archivo se está preparando. Vuelve a intentarlo en unos minutos." },
  EXPORT_EXPIRED: { title: "El enlace ha caducado", message: "Este archivo ya no está disponible. Puedes pedir otra copia." },
  EXPORT_RATE_LIMITED: {
    title: "Ya has pedido una copia hace poco",
    message: "Solo se puede pedir una copia cada 24 horas. Cuando esté lista la verás en esta pantalla.",
  },
  // Eliminar cuenta (comms §6.2)
  ACCOUNT_DELETION_CONFIRMATION_REQUIRED: {
    title: "Falta la confirmación",
    message: "Escribe la palabra ELIMINAR para confirmar que quieres eliminar tu cuenta.",
  },
  ACCOUNT_DELETION_BLOCKED: {
    title: "No se puede eliminar todavía",
    message: "Tienes algo pendiente que impide eliminar la cuenta. Resuélvelo y vuelve a intentarlo.",
  },
  ACCOUNT_DELETION_NOT_FOUND: { title: "No hay ninguna eliminación en curso", message: "No tienes una solicitud de eliminación que cancelar." },
  ACCOUNT_DELETION_IN_PROGRESS: {
    title: "Ya no se puede cancelar",
    message: "El proceso de eliminación ya ha empezado y no se puede detener.",
  },
  // Documentos legales (trust §4.2)
  LEGAL_DOCUMENT_NOT_FOUND: { title: "Documento no disponible", message: "No encontramos ese documento o esa versión." },
});

const enc = encodeURIComponent;

// ── Ajustes (pantalla 34) ───────────────────────────────────────────────────────────────────────────────────────

/** `GET /v1/me/settings`: ajustes de la cuenta + cabecera de perfil de «Ajustes». */
export function getSettings(options: CallOptions = {}): Promise<UserSettings> {
  return apiRequest<UserSettings>("/v1/me/settings", options);
}

/** `PATCH /v1/me/settings`: cambio parcial (`shareLiveLocationInTrip`, `fontScale`, `language`). */
export function patchSettings(patch: UserSettingsPatch, options: CallOptions = {}): Promise<UserSettings> {
  return apiRequest<UserSettings>("/v1/me/settings", { method: "PATCH", body: patch, ...options });
}

// ── Centro de ayuda (pantalla 35) ───────────────────────────────────────────────────────────────────────────────

export function listSupportTrips(query: { limit?: number; cursor?: string | null } = {}, options: CallOptions = {}): Promise<Page<SupportTripOption>> {
  return apiRequest<Page<SupportTripOption>>("/v1/me/support/trips", {
    query: { limit: query.limit ?? 20, cursor: query.cursor ?? null },
    ...options,
  });
}

export function createSupportUploadIntent(
  body: { contentType: SupportAttachmentContentType; sizeBytes: number },
  options: CallOptions = {},
): Promise<SupportUploadIntent> {
  return apiRequest<SupportUploadIntent>("/v1/me/support/uploads/intents", { method: "POST", body, ...options });
}

export function completeSupportUpload(intentId: string, options: CallOptions = {}): Promise<SupportAttachment> {
  return apiRequest<SupportAttachment>(`/v1/me/support/uploads/${enc(intentId)}/complete`, { method: "POST", ...options });
}

export interface LocalSupportImage {
  uri: string;
  contentType: SupportAttachmentContentType;
  sizeBytes: number;
}

/** Subida privada de una imagen: intención → PUT firmado → completar. Devuelve el adjunto listo para vincular. */
export async function uploadSupportImage(file: LocalSupportImage, options: CallOptions = {}): Promise<SupportAttachment> {
  const intent = await createSupportUploadIntent({ contentType: file.contentType, sizeBytes: file.sizeBytes }, options);
  await putToSignedUrl(
    { uploadUrl: intent.uploadUrl, headers: intent.headers },
    { uri: file.uri, contentType: file.contentType },
    { ...(options.signal !== undefined ? { signal: options.signal } : {}) },
  );
  return completeSupportUpload(intent.intentId, options);
}

export function getSupportAttachmentDownload(attachmentId: string, options: CallOptions = {}): Promise<SupportAttachmentDownload> {
  return apiRequest<SupportAttachmentDownload>(`/v1/me/support/attachments/${enc(attachmentId)}/download`, options);
}

export function createSupportTicket(body: CreateSupportTicketRequest, options: WriteOptions = {}): Promise<SupportTicketDetail> {
  const { idempotencyKey, ...rest } = options;
  return apiRequest<SupportTicketDetail>("/v1/me/support/tickets", {
    method: "POST",
    body,
    ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    ...rest,
  });
}

export interface ListSupportTicketsQuery {
  status?: SupportTicketStatus | null;
  limit?: number;
  cursor?: string | null;
}

export function listSupportTickets(query: ListSupportTicketsQuery = {}, options: CallOptions = {}): Promise<Page<SupportTicketSummary>> {
  return apiRequest<Page<SupportTicketSummary>>("/v1/me/support/tickets", {
    query: { status: query.status ?? null, limit: query.limit ?? 20, cursor: query.cursor ?? null },
    ...options,
  });
}

export function getSupportTicket(ticketId: string, options: CallOptions = {}): Promise<SupportTicketDetail> {
  return apiRequest<SupportTicketDetail>(`/v1/me/support/tickets/${enc(ticketId)}`, options);
}

export function replySupportTicket(ticketId: string, body: SupportReplyRequest, options: CallOptions = {}): Promise<SupportTicketDetail> {
  return apiRequest<SupportTicketDetail>(`/v1/me/support/tickets/${enc(ticketId)}/replies`, { method: "POST", body, ...options });
}

export function closeSupportTicket(ticketId: string, options: CallOptions = {}): Promise<SupportTicketDetail> {
  return apiRequest<SupportTicketDetail>(`/v1/me/support/tickets/${enc(ticketId)}/close`, { method: "POST", ...options });
}

// ── Derechos sobre los datos (RGPD) ─────────────────────────────────────────────────────────────────────────────

export function requestDataExport(options: WriteOptions = {}): Promise<DataExportRequest> {
  const { idempotencyKey, ...rest } = options;
  return apiRequest<DataExportRequest>("/v1/me/data-exports", {
    method: "POST",
    ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    ...rest,
  });
}

export function listDataExports(query: { limit?: number; cursor?: string | null } = {}, options: CallOptions = {}): Promise<Page<DataExportRequest>> {
  return apiRequest<Page<DataExportRequest>>("/v1/me/data-exports", {
    query: { limit: query.limit ?? 20, cursor: query.cursor ?? null },
    ...options,
  });
}

export function getDataExport(exportId: string, options: CallOptions = {}): Promise<DataExportRequest> {
  return apiRequest<DataExportRequest>(`/v1/me/data-exports/${enc(exportId)}`, options);
}

/** Enlace firmado de 5 minutos (auditado en el servidor): pídelo solo cuando la persona pulsa «Descargar». */
export function getDataExportDownload(exportId: string, options: CallOptions = {}): Promise<DataExportDownload> {
  return apiRequest<DataExportDownload>(`/v1/me/data-exports/${enc(exportId)}/download`, { retries: 0, ...options });
}

export function getAccountDeletion(options: CallOptions = {}): Promise<AccountDeletionState> {
  return apiRequest<AccountDeletionState>("/v1/me/account-deletion", options);
}

export function requestAccountDeletion(body: RequestAccountDeletionRequest, options: CallOptions = {}): Promise<AccountDeletionState> {
  return apiRequest<AccountDeletionState>("/v1/me/account-deletion", { method: "POST", body, ...options });
}

export function cancelAccountDeletion(options: CallOptions = {}): Promise<AccountDeletionState> {
  return apiRequest<AccountDeletionState>("/v1/me/account-deletion/cancel", { method: "POST", ...options });
}

// ── Documentos legales (públicos) ───────────────────────────────────────────────────────────────────────────────

/** `GET /v1/legal/documents`: última versión de cada documento. Sin sesión. */
export async function listLegalDocuments(options: CallOptions = {}): Promise<LegalDocumentSummary[]> {
  const result = await apiRequest<{ items: LegalDocumentSummary[] }>("/v1/legal/documents", { token: null, ...options });
  return result.items;
}

/** Documento vigente (`version` omitida) o una versión concreta. Sin sesión. */
export function getLegalDocument(kind: LegalDocumentKind, version?: number, options: CallOptions = {}): Promise<LegalDocument> {
  const path =
    version === undefined ? `/v1/legal/documents/${enc(kind)}` : `/v1/legal/documents/${enc(kind)}/versions/${version}`;
  return apiRequest<LegalDocument>(path, { token: null, ...options });
}

// ── Cierre de sesión: baja del token push de ESTE móvil ─────────────────────────────────────────────────────────

export function listPushTokens(query: { limit?: number; cursor?: string | null } = {}, options: CallOptions = {}): Promise<Page<PushTokenInfo>> {
  return apiRequest<Page<PushTokenInfo>>("/v1/me/push-tokens", {
    query: { limit: query.limit ?? 50, cursor: query.cursor ?? null },
    ...options,
  });
}

export function deletePushToken(tokenId: string, options: CallOptions = {}): Promise<void> {
  return apiRequest<void>(`/v1/me/push-tokens/${enc(tokenId)}`, { method: "DELETE", ...options });
}

// ── Salud del servidor (Estado del servicio) ────────────────────────────────────────────────────────────────────

export interface HealthLive {
  status: string;
}
export interface HealthReady {
  status: string;
  postgis?: string;
}

/** `GET /health/live`: el proceso responde. Sin sesión, sin reintentos (queremos saber qué pasa AHORA). */
export function getHealthLive(options: CallOptions = {}): Promise<HealthLive> {
  return apiRequest<HealthLive>("/health/live", { token: null, retries: 0, timeoutMs: 6000, authExpiry: "ignore", ...options });
}

/** `GET /health/ready`: la base de datos y PostGIS responden. 503 = el servidor está, pero no está listo. */
export function getHealthReady(options: CallOptions = {}): Promise<HealthReady> {
  return apiRequest<HealthReady>("/health/ready", { token: null, retries: 0, timeoutMs: 6000, authExpiry: "ignore", ...options });
}
