/**
 * Cliente de red del paquete `driver` · «publicar rutas». Contratos: docs/contracts/trips.md §9–§10 (+§13–§14), núcleo
 * (vehículos, documentos y subidas privadas) y docs/contracts/trust.md §3 (permiso de conducir). Tipos en `@/api/types`.
 *
 *   GET  /v1/me/vehicles                                            → { vehicles }                    (núcleo)
 *   POST /v1/me/vehicles · PUT /v1/me/vehicles/{id}                 → Vehicle                         (núcleo; editar reinicia la revisión)
 *   GET  /v1/me/documents                                           → { documents }                   (núcleo)
 *   POST /v1/me/uploads/intents → PUT firmado → POST …/{id}/complete → CompletePrivateUpload         (núcleo: foto y seguro)
 *   POST /v1/me/identity/documents/upload-intents → PUT → …/complete → TrustDocumentUploadCompleted    (trust: permiso de conducir)
 *   GET  /v1/me/documents/{id}/download                             → { url, expiresAt }              (núcleo)
 *   GET  /v1/me/driver/readiness                                    → DriverReadiness                 (trips §9)
 *   POST /v1/me/routes/plan                                         → RoutePlanResponse               (trips §9; sin efectos)
 *   POST /v1/me/routes                                              → PublishRouteResponse            (trips §9; Idempotency-Key)
 *   GET  /v1/me/driver/requests                                     → Page<DriverRequestItem>         (trips §7)
 *   POST /v1/ride-requests/{id}/decision · /v1/weekly-reservations/{id}/decision → DecideRequestResponse
 *   GET  /v1/trip-categories                                        → TripCategoriesResponse          (lo registra `search-browse`)
 *   GET  /v1/provinces · /v1/provinces/resolve                      → Province                        (núcleo)
 *   POST /v1/conversations/direct                                   → ConversationDetail              (lo registra `messages`)
 *
 * Las pantallas NO importan este fichero: pasan por los hooks de `./hooks`. Los errores se explican con
 * `describePublishError` (lógica/errors.ts), no con el catálogo global.
 */
import { apiRequest, listProvinces, putToSignedUrl, resolveProvince, type CallOptions } from "@/api";
import type {
  CompletePrivateUpload,
  ConversationDetail,
  DecideRequestResponse,
  DriverReadiness,
  DriverRequestItem,
  DriverRequestsQuery,
  Page,
  PrivateUploadIntent,
  Province,
  PublishRouteBody,
  PublishRouteResponse,
  RoutePlanBody,
  RoutePlanResponse,
  TripCategoriesResponse,
  TrustDocumentUploadCompleted,
  TrustUploadIntent,
  Uuid,
} from "@/api/types";
import type { DocumentRecord, LocalFile, UploadPhase, VehicleBody, VehicleRecord } from "./types";
import type { UploadKind } from "./logic/documents";

const enc = encodeURIComponent;

/** Opciones de las llamadas que CREAN o CAMBIAN cosas: llevan `Idempotency-Key` (se reutiliza al reintentar). */
export type PublishCallOptions = CallOptions & { idempotencyKey?: string };

// ── Vehículos ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Mis vehículos, el más reciente primero (el que evalúa `GET /v1/me/driver/readiness`). */
export async function listVehicles(options: CallOptions = {}): Promise<VehicleRecord[]> {
  const result = await apiRequest<{ vehicles: VehicleRecord[] }>("/v1/me/vehicles", options);
  return result.vehicles;
}

/** Da de alta un vehículo. Queda pendiente de revisión. `409 VEHICLE_PLATE_ALREADY_EXISTS` si la matrícula ya existe. */
export function createVehicle(body: VehicleBody, options: PublishCallOptions = {}): Promise<VehicleRecord> {
  return apiRequest<VehicleRecord>("/v1/me/vehicles", { method: "POST", body, ...options });
}

/** Edita un vehículo. El servidor REINICIA su revisión (marca, modelo, matrícula, plazas y documentación). */
export function updateVehicle(vehicleId: Uuid, body: VehicleBody, options: PublishCallOptions = {}): Promise<VehicleRecord> {
  return apiRequest<VehicleRecord>(`/v1/me/vehicles/${enc(vehicleId)}`, { method: "PUT", body, ...options });
}

// ── Documentos y subidas privadas ───────────────────────────────────────────────────────────────────────────────────────

export async function listDocuments(options: CallOptions = {}): Promise<DocumentRecord[]> {
  const result = await apiRequest<{ documents: DocumentRecord[] }>("/v1/me/documents", options);
  return result.documents;
}

export interface UploadCallbacks {
  onPhase?: (phase: UploadPhase) => void;
}

/**
 * Sube la foto o el seguro de un vehículo: intención → PUT firmado → completar. El servidor comprueba tamaño y tipo.
 * No se reintenta sola: un PUT fallido pide otra intención (el llamador decide).
 */
export async function uploadVehicleFile(
  kind: Exclude<UploadKind, "driver_license">,
  vehicleId: Uuid,
  file: LocalFile,
  options: CallOptions & UploadCallbacks = {},
): Promise<CompletePrivateUpload> {
  const { onPhase, ...call } = options;
  onPhase?.("preparing");
  const intent = await apiRequest<PrivateUploadIntent>("/v1/me/uploads/intents", {
    method: "POST",
    body: { kind, vehicleId, contentType: file.contentType, sizeBytes: file.sizeBytes },
    ...call,
  });
  onPhase?.("uploading");
  await putToSignedUrl(
    { uploadUrl: intent.uploadUrl, headers: intent.headers },
    { uri: file.uri, contentType: file.contentType },
    call.signal !== undefined ? { signal: call.signal } : {},
  );
  onPhase?.("finishing");
  return apiRequest<CompletePrivateUpload>(`/v1/me/uploads/${enc(intent.intentId)}/complete`, { method: "POST", ...call });
}

/** Sube el permiso de conducir (módulo de confianza): queda en revisión humana. Exige el rol de conductor. */
export async function uploadDriverLicense(
  file: LocalFile,
  options: CallOptions & UploadCallbacks = {},
): Promise<TrustDocumentUploadCompleted> {
  const { onPhase, ...call } = options;
  const path = "/v1/me/identity/documents/upload-intents";
  onPhase?.("preparing");
  const intent = await apiRequest<TrustUploadIntent>(path, {
    method: "POST",
    body: { kind: "driver_license", contentType: file.contentType, sizeBytes: file.sizeBytes },
    ...call,
  });
  onPhase?.("uploading");
  await putToSignedUrl(
    { uploadUrl: intent.uploadUrl, headers: intent.headers },
    { uri: file.uri, contentType: file.contentType },
    call.signal !== undefined ? { signal: call.signal } : {},
  );
  onPhase?.("finishing");
  return apiRequest<TrustDocumentUploadCompleted>(`${path}/${enc(intent.intentId)}/complete`, { method: "POST", ...call });
}

/** URL firmada y de corta duración para ver un documento propio. */
export function getDocumentDownloadUrl(documentId: Uuid, options: CallOptions = {}): Promise<{ url: string; expiresAt: string }> {
  return apiRequest<{ url: string; expiresAt: string }>(`/v1/me/documents/${enc(documentId)}/download`, options);
}

// ── Requisitos para publicar ────────────────────────────────────────────────────────────────────────────────────────────

/** Qué falta para publicar. El servidor decide (`canPublish`); la app solo lo explica. */
export function getDriverReadiness(options: CallOptions = {}): Promise<DriverReadiness> {
  return apiRequest<DriverReadiness>("/v1/me/driver/readiness", options);
}

// ── Planificar y publicar ──────────────────────────────────────────────────────────────────────────────────────────────

/** Calcula la ruta y valida la provincia POR PARADA. No guarda nada (se puede llamar en cada edición). */
export function planRoute(body: RoutePlanBody, options: CallOptions = {}): Promise<RoutePlanResponse> {
  return apiRequest<RoutePlanResponse>("/v1/me/routes/plan", { method: "POST", body, retries: 0, ...options });
}

/** «Guardar ruta». Idempotente: reintentar con la MISMA `idempotencyKey` devuelve lo ya publicado. */
export function publishRoute(body: PublishRouteBody, options: PublishCallOptions = {}): Promise<PublishRouteResponse> {
  return apiRequest<PublishRouteResponse>("/v1/me/routes", { method: "POST", body, ...options });
}

/** Provincia del viaje: la que contiene el origen; si no cae en ninguna, la primera disponible (el servidor señalará la parada). */
export async function provinceFor(origin: { lat: number; lng: number }, options: CallOptions = {}): Promise<Province> {
  const resolved = await resolveProvince({ latitude: origin.lat, longitude: origin.lng }, options);
  if (resolved !== null) return resolved;
  const all = await listProvinces(options);
  const first = all[0];
  if (first === undefined) throw new Error("PROVINCE_NOT_FOUND");
  return first;
}

/** Categorías de viaje (las registra `search-browse`; la pantalla trae un respaldo con los mismos nombres). */
export function listTripCategories(options: CallOptions = {}): Promise<TripCategoriesResponse> {
  return apiRequest<TripCategoriesResponse>("/v1/trip-categories", { token: null, ...options });
}

// ── Solicitudes de pasajeros ────────────────────────────────────────────────────────────────────────────────────────────

export type DriverRequestsParams = {
  [K in "status" | "tripId" | "cursor" | "limit"]?: DriverRequestsQuery[K] | undefined;
};

/** Bandeja del conductor: solicitudes sueltas y reservas semanales (una sola fila por reserva). */
export function listDriverRequests(params: DriverRequestsParams = {}, options: CallOptions = {}): Promise<Page<DriverRequestItem>> {
  return apiRequest<Page<DriverRequestItem>>("/v1/me/driver/requests", {
    query: { status: params.status ?? "open", tripId: params.tripId, cursor: params.cursor, limit: params.limit },
    ...options,
  });
}

/** Acepta o rechaza UNA solicitud. Aceptar crea la retención de plaza (el pasajero paga después): NO es una reserva. */
export function decideRideRequest(
  requestId: Uuid,
  decision: "accept" | "reject",
  options: CallOptions = {},
): Promise<DecideRequestResponse> {
  return apiRequest<DecideRequestResponse>(`/v1/ride-requests/${enc(requestId)}/decision`, {
    method: "POST",
    body: { decision },
    ...options,
  });
}

/** Acepta o rechaza una reserva semanal ENTERA (todas sus ocurrencias o ninguna). */
export function decideWeeklyReservation(
  reservationId: Uuid,
  decision: "accept" | "reject",
  options: CallOptions = {},
): Promise<DecideRequestResponse> {
  return apiRequest<DecideRequestResponse>(`/v1/weekly-reservations/${enc(reservationId)}/decision`, {
    method: "POST",
    body: { decision },
    ...options,
  });
}

/** Abre (o recupera) el chat con un pasajero. Solo existe con una reserva confirmada entre ambos. */
export function openDirectConversation(tripId: Uuid, peerUserId: Uuid, options: CallOptions = {}): Promise<ConversationDetail> {
  return apiRequest<ConversationDetail>("/v1/conversations/direct", { method: "POST", body: { tripId, peerUserId }, ...options });
}
