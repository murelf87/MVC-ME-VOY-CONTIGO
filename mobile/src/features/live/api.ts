/**
 * Cliente de red del slice `live` (pasajero en directo). Contrato: docs/contracts/live.md.
 *
 *   GET    /v1/bookings/:id/live                         → LiveBookingStatusView        (21)
 *   GET    /v1/bookings/:id/in-car                       → LiveInCarState               (23)
 *   GET    /v1/bookings/:id/summary                      → LiveBookingSummary           (24)
 *   POST   /v1/bookings/:id/pickup-code                  → LivePickupCodeGenerated      (núcleo; código en claro UNA vez)
 *   GET    /v1/route-changes/:id                         → LiveRouteChange              (22)
 *   POST   /v1/route-changes/:id/respond                 → LiveRouteChange              (22: aceptar / rechazar)
 *   POST   /v1/trips/:tripId/ratings                     → LiveRating                   (valorar)
 *   POST   /v1/incident-reports                          → LiveIncidentReport           (reportar)
 *   GET    /v1/me/incident-reports · …/:reportId         → Page<LiveIncidentReport> · LiveIncidentReport
 *   POST   /v1/incident-reports/:id/attachments          → LiveIncidentAttachmentIntent (intención de subida privada)
 *   POST   /v1/incident-reports/:id/attachments/:att/complete → LiveIncidentAttachment
 *   POST|GET|DELETE /v1/bookings/:id/share               → LiveShareCreated · {share} · 204
 *   GET    /v1/shared-trips/:token                       → LiveSharedTrip               (PÚBLICO: sin sesión)
 *   GET|PUT /v1/me/live-privacy                          → LivePrivacyPreferences
 * Los de otros paquetes que consumen estas pantallas (no se registran aquí):
 *   POST   /v1/conversations/direct                      → ConversationDetail           (messages: abrir el chat)
 *   GET    /v1/conversations/:id/call-contact            → PeerCallContact              (messages: «Llamar a Ana»)
 *
 * Las pantallas NO importan este fichero: pasan por los hooks de `./hooks`.
 */
import { apiRequest, registerErrorMessages, type CallOptions } from "@/api";
import type {
  ConversationDetail,
  LiveBookingStatusView,
  LiveBookingSummary,
  LiveCreateIncidentBody,
  LiveCreateRatingBody,
  LiveIncidentAttachment,
  LiveIncidentAttachmentIntent,
  LiveIncidentAttachmentIntentBody,
  LiveIncidentReport,
  LiveInCarState,
  LivePickupCodeGenerated,
  LivePrivacyPreferences,
  LiveRating,
  LiveRespondRouteChangeBody,
  LiveRouteChange,
  LiveShare,
  LiveShareCreateBody,
  LiveShareCreated,
  LiveSharedTrip,
  OpenDirectConversationRequest,
  Page,
  PeerCallContact,
} from "@/api/types";

/** Opciones de las llamadas que CREAN cosas: llevan `Idempotency-Key` (la misma al reintentar). */
export type WriteOptions = CallOptions & { idempotencyKey?: string };

/**
 * Textos de los códigos de error propios de este módulo. Los compartidos (BOOKING_NOT_FOUND, IDEMPOTENCY_KEY_REUSED,
 * VALIDATION_ERROR…) ya los registra la capa de red o el slice que los posee.
 */
registerErrorMessages({
  // Código de recogida
  BOOKING_NOT_OWNED: { title: "Esta reserva no es tuya", message: "Solo la persona que hizo la reserva puede generar el código de recogida." },
  BOOKING_NOT_PICKUP_ELIGIBLE: { title: "Sin código de recogida", message: "Esta reserva ya no admite un código de recogida: no está confirmada o ya se completó." },
  TRIP_NOT_LIVE: { title: "El viaje aún no ha empezado", message: "Podrás generar tu código cuando la persona que conduce inicie el viaje." },
  // Cambio de ruta
  ROUTE_CHANGE_NOT_FOUND: { title: "Propuesta no encontrada", message: "Esta propuesta de cambio de ruta ya no existe o no te afecta." },
  ROUTE_CHANGE_NOT_PENDING: { title: "La propuesta ya está resuelta", message: "Esta propuesta ya no está pendiente: se aplicó, se rechazó, caducó o la retiraron." },
  ROUTE_CHANGE_EXPIRED: { title: "La propuesta ha caducado", message: "No respondiste a tiempo, así que el cambio de ruta no se aplica y el viaje sigue como estaba." },
  ROUTE_CHANGE_ACCEPTANCE_NOT_REQUIRED: { title: "No hace falta tu respuesta", message: "Este cambio no te afecta de forma material, así que no necesitas aceptarlo ni rechazarlo." },
  ROUTE_CHANGE_ALREADY_DECIDED: { title: "Ya respondiste", message: "Ya enviaste una respuesta distinta a esta propuesta y no se puede cambiar." },
  // Valoraciones
  RATING_NOT_PARTICIPANT: { title: "No puedes valorar este viaje", message: "Solo pueden valorar quienes participaron en el viaje." },
  RATING_TRIP_NOT_COMPLETED: { title: "El viaje aún no ha terminado", message: "Podrás valorarlo cuando el viaje haya terminado." },
  RATING_BOOKING_NOT_COMPLETED: { title: "No completaste el viaje", message: "Solo puedes valorar un viaje que hiciste completo." },
  RATING_INVALID_RATEE: { title: "Persona no válida", message: "Solo puedes valorar a quien viajó contigo en este viaje." },
  RATING_ALREADY_SUBMITTED: { title: "Ya lo valoraste", message: "Ya enviaste tu valoración de este viaje. Gracias." },
  RATING_WINDOW_CLOSED: { title: "Plazo cerrado", message: "El plazo de 14 días para valorar este viaje ya terminó." },
  RATING_INVALID_STARS: { title: "Valoración no válida", message: "Elige entre 1 y 5 estrellas." },
  RATING_COMMENT_TOO_LONG: { title: "Comentario demasiado largo", message: "El comentario puede tener hasta 500 caracteres." },
  // Incidencias
  INCIDENT_NOT_PARTICIPANT: { title: "No puedes reportar este viaje", message: "Solo quienes participaron en el viaje pueden reportar una incidencia." },
  INCIDENT_BOOKING_MISMATCH: { title: "Reserva no válida", message: "La reserva elegida no corresponde a este viaje." },
  INCIDENT_DESCRIPTION_INVALID: { title: "Descripción no válida", message: "Cuéntanos qué pasó con entre 10 y 2.000 caracteres." },
  INCIDENT_NOT_FOUND: { title: "Incidencia no encontrada", message: "No encontramos esta incidencia. Puede que ya no exista." },
  INCIDENT_CLOSED: { title: "Incidencia cerrada", message: "Esta incidencia ya está resuelta o descartada y no admite más adjuntos." },
  INCIDENT_ATTACHMENT_LIMIT: { title: "Demasiados adjuntos", message: "Puedes adjuntar hasta 5 imágenes por incidencia." },
  INCIDENT_ATTACHMENT_TYPE: { title: "Formato no admitido", message: "Solo se admiten imágenes JPEG, PNG, WebP o HEIC." },
  INCIDENT_ATTACHMENT_SIZE: { title: "Imagen demasiado grande", message: "Cada imagen puede pesar hasta 10 MB." },
  INCIDENT_ATTACHMENT_NOT_FOUND: { title: "Adjunto no encontrado", message: "No encontramos este adjunto. Vuelve a añadirlo." },
  INCIDENT_ATTACHMENT_EXPIRED: { title: "La subida ha caducado", message: "Tardaste demasiado en subir la imagen. Vuelve a añadirla." },
  INCIDENT_ATTACHMENT_MISMATCH: { title: "La imagen no se subió bien", message: "El archivo subido no coincide con el que anunciaste. Vuelve a añadirlo." },
  // Compartir viaje
  SHARE_NOT_ALLOWED: { title: "No se puede compartir", message: "Solo puedes compartir un viaje con una reserva confirmada y un viaje que no haya terminado." },
  SHARE_INVALID_DURATION: { title: "Duración no válida", message: "El enlace puede durar entre 15 minutos y 24 horas." },
  SHARE_NOT_FOUND: { title: "Enlace no encontrado", message: "Este enlace no existe. Pide a quien te lo envió que lo comparta de nuevo." },
  SHARE_REVOKED: { title: "Enlace desactivado", message: "Quien compartió este viaje ha desactivado el enlace." },
  SHARE_EXPIRED: { title: "Enlace caducado", message: "Este enlace ya ha caducado. Pide a quien te lo envió que lo comparta de nuevo." },
});

const enc = encodeURIComponent;

// ── Pasajero en directo ──────────────────────────────────────────────────────────────────────────────────────────

export function getBookingLive(bookingId: string, options: CallOptions = {}): Promise<LiveBookingStatusView> {
  return apiRequest<LiveBookingStatusView>(`/v1/bookings/${enc(bookingId)}/live`, options);
}

export function getBookingInCar(bookingId: string, options: CallOptions = {}): Promise<LiveInCarState> {
  return apiRequest<LiveInCarState>(`/v1/bookings/${enc(bookingId)}/in-car`, options);
}

export function getBookingSummary(bookingId: string, options: CallOptions = {}): Promise<LiveBookingSummary> {
  return apiRequest<LiveBookingSummary>(`/v1/bookings/${enc(bookingId)}/summary`, options);
}

/** Genera un código nuevo (e invalida el anterior). Devuelve el código en claro UNA sola vez. */
export function generatePickupCode(bookingId: string, options: CallOptions = {}): Promise<LivePickupCodeGenerated> {
  return apiRequest<LivePickupCodeGenerated>(`/v1/bookings/${enc(bookingId)}/pickup-code`, { method: "POST", ...options });
}

// ── Cambio de ruta ───────────────────────────────────────────────────────────────────────────────────────────────

export function getRouteChange(proposalId: string, options: CallOptions = {}): Promise<LiveRouteChange> {
  return apiRequest<LiveRouteChange>(`/v1/route-changes/${enc(proposalId)}`, options);
}

export function respondRouteChange(proposalId: string, body: LiveRespondRouteChangeBody, options: WriteOptions = {}): Promise<LiveRouteChange> {
  return apiRequest<LiveRouteChange>(`/v1/route-changes/${enc(proposalId)}/respond`, { method: "POST", body, ...options });
}

// ── Fin de viaje: valorar y reportar ─────────────────────────────────────────────────────────────────────────────

export function createRating(tripId: string, body: LiveCreateRatingBody, options: WriteOptions = {}): Promise<LiveRating> {
  return apiRequest<LiveRating>(`/v1/trips/${enc(tripId)}/ratings`, { method: "POST", body, ...options });
}

export function createIncident(body: LiveCreateIncidentBody, options: WriteOptions = {}): Promise<LiveIncidentReport> {
  return apiRequest<LiveIncidentReport>("/v1/incident-reports", { method: "POST", body, ...options });
}

export interface ListIncidentsQuery {
  cursor?: string | null;
  limit?: number;
}

export function listMyIncidents(query: ListIncidentsQuery = {}, options: CallOptions = {}): Promise<Page<LiveIncidentReport>> {
  return apiRequest<Page<LiveIncidentReport>>("/v1/me/incident-reports", {
    query: { cursor: query.cursor ?? null, limit: query.limit ?? 20 },
    ...options,
  });
}

export function getMyIncident(reportId: string, options: CallOptions = {}): Promise<LiveIncidentReport> {
  return apiRequest<LiveIncidentReport>(`/v1/me/incident-reports/${enc(reportId)}`, options);
}

export function createIncidentAttachmentIntent(
  reportId: string,
  body: LiveIncidentAttachmentIntentBody,
  options: CallOptions = {},
): Promise<LiveIncidentAttachmentIntent> {
  return apiRequest<LiveIncidentAttachmentIntent>(`/v1/incident-reports/${enc(reportId)}/attachments`, { method: "POST", body, ...options });
}

export function completeIncidentAttachment(reportId: string, attachmentId: string, options: CallOptions = {}): Promise<LiveIncidentAttachment> {
  return apiRequest<LiveIncidentAttachment>(`/v1/incident-reports/${enc(reportId)}/attachments/${enc(attachmentId)}/complete`, { method: "POST", ...options });
}

// ── Compartir viaje (privado) ────────────────────────────────────────────────────────────────────────────────────

/** Crea el enlace (y revoca el anterior de esta reserva). El `token` solo se devuelve aquí. */
export function createShare(bookingId: string, body: LiveShareCreateBody = {}, options: CallOptions = {}): Promise<LiveShareCreated> {
  return apiRequest<LiveShareCreated>(`/v1/bookings/${enc(bookingId)}/share`, { method: "POST", body, ...options });
}

export interface ShareStatus {
  share: LiveShare | null;
}

export function getShare(bookingId: string, options: CallOptions = {}): Promise<ShareStatus> {
  return apiRequest<ShareStatus>(`/v1/bookings/${enc(bookingId)}/share`, options);
}

/** Revoca el enlace activo (idempotente: sin enlace también acaba bien). */
export function revokeShare(bookingId: string, options: CallOptions = {}): Promise<void> {
  return apiRequest<void>(`/v1/bookings/${enc(bookingId)}/share`, { method: "DELETE", ...options });
}

/** Vista PÚBLICA del enlace: no envía `Authorization` (funciona sin sesión). */
export function getSharedTrip(token: string, options: CallOptions = {}): Promise<LiveSharedTrip> {
  return apiRequest<LiveSharedTrip>(`/v1/shared-trips/${enc(token)}`, { token: null, ...options });
}

// ── Privacidad en directo ────────────────────────────────────────────────────────────────────────────────────────

export function getLivePrivacy(options: CallOptions = {}): Promise<LivePrivacyPreferences> {
  return apiRequest<LivePrivacyPreferences>("/v1/me/live-privacy", options);
}

export function putLivePrivacy(body: { showProfileToCoPassengers: boolean }, options: CallOptions = {}): Promise<LivePrivacyPreferences> {
  return apiRequest<LivePrivacyPreferences>("/v1/me/live-privacy", { method: "PUT", body, ...options });
}

// ── Contacto con la persona que conduce (endpoints del paquete `messages`) ───────────────────────────────────────

/** Abre (o recupera) el chat directo del viaje con la persona que conduce. 201 si es nuevo, 200 si ya existía. */
export function openDriverConversation(body: OpenDirectConversationRequest, options: CallOptions = {}): Promise<ConversationDetail> {
  return apiRequest<ConversationDetail>("/v1/conversations/direct", { method: "POST", body, ...options });
}

/** Teléfono de la persona que conduce: solo dentro de la ventana del viaje y sin bloqueo (el servidor decide). */
export function getDriverCallContact(conversationId: string, options: CallOptions = {}): Promise<PeerCallContact> {
  return apiRequest<PeerCallContact>(`/v1/conversations/${enc(conversationId)}/call-contact`, options);
}
