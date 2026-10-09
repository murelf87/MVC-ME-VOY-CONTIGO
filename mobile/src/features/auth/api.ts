/**
 * Llamadas de red del slice `auth` (pantalla → hook → ESTE fichero → `@/api`). Las pantallas nunca llaman a `fetch`.
 * Contratos: `docs/AUTH.md` y `docs/contracts/trust.md` §4.1 (verificación, pantallas 05–08) y §4.2 (documentos legales).
 *
 * El inicio de sesión y el alta con teléfono (`startPhoneVerification`, `verifyPhoneCode`, `getMe`, `updateProfile`) los
 * sirve el núcleo (`@/api`): aquí solo se CONSUMEN. Las funciones que se llaman antes de que exista la sesión de la app
 * (justo después de verificar el código) aceptan un `token` explícito y no emiten el evento de sesión caducada.
 */
import {
  apiRequest,
  getApiBaseUrl,
  putToSignedUrl,
  registerErrorMessages,
  type CallOptions,
} from "@/api";
import type { Role } from "@/api/types";
import type {
  LegalAcceptance,
  LegalAcceptRequest,
  LegalDocument,
  LegalDocumentKind,
  LegalDocumentSummary,
  LegalStatus,
  PrivateCheckState,
  ProfilePhotoState,
  TrustDocumentKind,
  TrustDocumentUploadCompleted,
  TrustRolesResponse,
  TrustUploadIntent,
  TrustVerificationOverview,
} from "@/api/types/trust";

export type { CallOptions } from "@/api";

/** Opciones comunes: cancelación/tiempo + `token` explícito (alta recién verificada) + clave de idempotencia. */
export interface AuthCallOptions extends CallOptions {
  token?: string;
  idempotencyKey?: string;
}

function tokenOptions(options: AuthCallOptions): { token?: string; authExpiry?: "ignore" } {
  return options.token ? { token: options.token, authExpiry: "ignore" } : {};
}

function common(options: AuthCallOptions): Pick<AuthCallOptions, "signal" | "timeoutMs" | "retries" | "idempotencyKey"> {
  const { signal, timeoutMs, retries, idempotencyKey } = options;
  return {
    ...(signal !== undefined ? { signal } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(retries !== undefined ? { retries } : {}),
    ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
  };
}

// ── Textos de usuario para los códigos estables del módulo trust ──────────────────────────────────────────────────────

registerErrorMessages({
  PRIVATE_STORAGE_DISABLED: {
    title: "Subida no disponible",
    message: "Ahora mismo no podemos recibir archivos. Inténtalo de nuevo más tarde.",
  },
  UPLOAD_TYPE_NOT_ALLOWED: { message: "Ese formato no está permitido." },
  UPLOAD_SIZE_INVALID: { message: "El archivo es demasiado grande o está vacío." },
  UPLOAD_RATE_LIMITED: {
    title: "Demasiados intentos",
    message: "Has hecho demasiadas subidas hoy. Inténtalo de nuevo mañana.",
  },
  UPLOAD_OBJECT_MISSING: { message: "No hemos recibido el archivo. Vuelve a intentarlo." },
  UPLOAD_SIZE_MISMATCH: { message: "El archivo no coincide con el que ibas a enviar. Vuelve a intentarlo." },
  UPLOAD_TYPE_MISMATCH: { message: "El archivo no coincide con el que ibas a enviar. Vuelve a intentarlo." },
  UPLOAD_CONTENT_INVALID: { message: "El archivo no es válido. Prueba con otro." },
  UPLOAD_STORAGE_MISMATCH: { message: "No hemos podido validar el archivo. Vuelve a intentarlo." },
  LOCAL_FILE_UNREADABLE: { message: "No se pudo leer el archivo. Elige otro." },
  PRIVATE_CHECK_CONSENT_REQUIRED: { message: "Antes de enviar tu captura debes aceptar la información de privacidad." },
  PRIVATE_CHECK_IN_REVIEW: { message: "Tu comprobación ya está en revisión." },
  PRIVATE_CHECK_ALREADY_COMPLETED: { message: "Tu comprobación ya está completada." },
  PRIVATE_CHECK_MAX_ATTEMPTS_REACHED: {
    title: "Has agotado los intentos",
    message: "Has usado los 3 intentos con foto. Puedes verificar tu identidad aportando un documento.",
  },
  PRIVATE_CHECK_REJECTED: {
    title: "No hemos podido completar la comprobación",
    message: "Puedes verificar tu identidad aportando un documento.",
  },
  DOCUMENT_IN_REVIEW: { message: "Ya hay un documento tuyo en revisión." },
  IDENTITY_ALREADY_VERIFIED: { message: "Tu identidad ya está verificada." },
  DRIVER_ROLE_REQUIRED: { message: "Para subir el permiso de conducir necesitas el perfil de conductor." },
  ROLES_INVALID: { message: "Elige pasajero, conductor o ambos perfiles." },
  ROLE_IN_USE: { message: "No puedes quitar ese perfil mientras tengas viajes, solicitudes o reservas abiertos." },
  LEGAL_VERSION_OUTDATED: { message: "Ha salido una versión más reciente del documento. Léela y acepta de nuevo." },
  LEGAL_DOCUMENT_NOT_FOUND: { message: "No hemos encontrado ese documento." },
  LEGAL_DOCUMENT_RETIRED: { message: "Ese documento ya no está vigente." },
  PHOTO_NOT_FOUND: { message: "No hay una foto aprobada para esta persona." },
});

// ── Roles ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** `PUT /v1/me/roles`: pasajero, conductor o ambos (chips de la 05 y pantalla 02 con sesión). */
export function saveRoles(roles: readonly Role[], options: AuthCallOptions = {}): Promise<TrustRolesResponse> {
  return apiRequest<TrustRolesResponse>("/v1/me/roles", {
    method: "PUT",
    body: { roles },
    ...tokenOptions(options),
    ...common(options),
  });
}

// ── Estado de verificación ─────────────────────────────────────────────────────────────────────────────────────────

/** `GET /v1/me/verification`: roles + foto + comprobación privada + identidad en una sola llamada. */
export function getVerification(options: AuthCallOptions = {}): Promise<TrustVerificationOverview> {
  return apiRequest<TrustVerificationOverview>("/v1/me/verification", { ...tokenOptions(options), ...common(options) });
}

/** `GET /v1/me/photo`. */
export function getProfilePhoto(options: AuthCallOptions = {}): Promise<ProfilePhotoState> {
  return apiRequest<ProfilePhotoState>("/v1/me/photo", { ...tokenOptions(options), ...common(options) });
}

/** `GET /v1/me/identity-check` (lámina 08). */
export function getPrivateCheck(options: AuthCallOptions = {}): Promise<PrivateCheckState> {
  return apiRequest<PrivateCheckState>("/v1/me/identity-check", { ...tokenOptions(options), ...common(options) });
}

// ── Subidas: intención → PUT firmado → completar ──────────────────────────────────────────────────────────────────────

export interface LocalUpload {
  uri: string;
  contentType: string;
  sizeBytes: number;
}

export type UploadPhase = "preparing" | "uploading" | "finishing";

export interface UploadCallbacks {
  onPhase?: (phase: UploadPhase) => void;
}

async function runUpload<TResult>(
  intentPath: string,
  intentBody: Record<string, unknown>,
  file: LocalUpload,
  options: AuthCallOptions & UploadCallbacks,
): Promise<TResult> {
  options.onPhase?.("preparing");
  const intent = await apiRequest<TrustUploadIntent>(intentPath, {
    method: "POST",
    body: intentBody,
    ...tokenOptions(options),
    ...common(options),
  });
  options.onPhase?.("uploading");
  await putToSignedUrl(
    { uploadUrl: intent.uploadUrl, headers: intent.headers },
    { uri: file.uri, contentType: file.contentType },
    { ...(options.signal !== undefined ? { signal: options.signal } : {}) },
  );
  options.onPhase?.("finishing");
  return apiRequest<TResult>(`${intentPath}/${encodeURIComponent(intent.intentId)}/complete`, {
    method: "POST",
    ...tokenOptions(options),
    ...common(options),
  });
}

/** Foto de perfil (05 «Guardar»): `POST /v1/me/photo/upload-intents` → PUT → `…/complete`. Queda en revisión humana. */
export function uploadProfilePhoto(file: LocalUpload, options: AuthCallOptions & UploadCallbacks = {}): Promise<ProfilePhotoState> {
  return runUpload<ProfilePhotoState>(
    "/v1/me/photo/upload-intents",
    { contentType: file.contentType, sizeBytes: file.sizeBytes },
    file,
    options,
  );
}

/** Selfie de la comprobación privada (07 «Continuar» tras aceptar el aviso). Cuenta un intento. */
export function uploadSelfie(file: LocalUpload, options: AuthCallOptions & UploadCallbacks = {}): Promise<PrivateCheckState> {
  return runUpload<PrivateCheckState>(
    "/v1/me/identity-check/upload-intents",
    { contentType: file.contentType, sizeBytes: file.sizeBytes },
    file,
    options,
  );
}

/** «Otra forma de verificar»: documento de identidad (o permiso de conducir si el usuario es conductor). */
export function uploadIdentityDocument(
  kind: TrustDocumentKind,
  file: LocalUpload,
  options: AuthCallOptions & UploadCallbacks = {},
): Promise<TrustDocumentUploadCompleted> {
  return runUpload<TrustDocumentUploadCompleted>(
    "/v1/me/identity/documents/upload-intents",
    { kind, contentType: file.contentType, sizeBytes: file.sizeBytes },
    file,
    options,
  );
}

// ── Documentos legales ─────────────────────────────────────────────────────────────────────────────────────────────────

/** `GET /v1/legal/documents`: últimas versiones (público, sin sesión). */
export async function listLegalDocuments(options: AuthCallOptions = {}): Promise<LegalDocumentSummary[]> {
  const result = await apiRequest<{ items: LegalDocumentSummary[] }>("/v1/legal/documents", { token: null, ...common(options) });
  return result.items;
}

/** `GET /v1/legal/documents/{kind}` (vigente) o `/versions/{version}`. Público. */
export function getLegalDocument(kind: LegalDocumentKind, version?: number, options: AuthCallOptions = {}): Promise<LegalDocument> {
  const path =
    version === undefined
      ? `/v1/legal/documents/${encodeURIComponent(kind)}`
      : `/v1/legal/documents/${encodeURIComponent(kind)}/versions/${version}`;
  return apiRequest<LegalDocument>(path, { token: null, ...common(options) });
}

/** `GET /v1/me/legal/status`: qué falta por aceptar en la versión vigente. */
export function getLegalStatus(options: AuthCallOptions = {}): Promise<LegalStatus> {
  return apiRequest<LegalStatus>("/v1/me/legal/status", { ...tokenOptions(options), ...common(options) });
}

/** `POST /v1/me/legal/acceptances`: acepta UNA versión (idempotente: si ya estaba aceptada responde 200). */
export function acceptLegal(input: LegalAcceptRequest, options: AuthCallOptions = {}): Promise<LegalAcceptance> {
  return apiRequest<LegalAcceptance>("/v1/me/legal/acceptances", {
    method: "POST",
    body: input,
    ...tokenOptions(options),
    ...common(options),
  });
}

// ── Utilidades de presentación de rutas del servidor ─────────────────────────────────────────────────────────────────────

/**
 * Convierte la URL de una foto que da el servidor en algo que una imagen pueda cargar: las rutas relativas
 * (`/v1/public/users/{id}/photo?v=…`) se resuelven contra la URL base de la API; las absolutas (URL firmada, `data:`,
 * `blob:`) se dejan tal cual.
 */
export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (url === null || url === undefined || url === "") return null;
  if (url.startsWith("/")) {
    const base = getApiBaseUrl();
    return base === "" ? null : `${base}${url}`;
  }
  return url;
}
