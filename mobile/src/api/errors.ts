/**
 * Errores tipados de la capa de red + mensajes de usuario en español.
 *
 * Toda llamada de `apiRequest` rechaza con exactamente uno de:
 *   ApiError | OfflineError | TimeoutError | AuthExpiredError
 * (más el `AbortError` nativo cuando quien llama cancela la petición: no es un fallo, se ignora).
 *
 * Usa `describeError(e)` / `errorMessage(e)` para pintar errores: nunca muestres `e.message` tal cual,
 * porque el mensaje del servidor está en inglés y es para desarrolladores.
 */

export type RequestErrorKind = "api" | "offline" | "timeout" | "auth_expired";

/** Respuesta HTTP no satisfactoria del backend (4xx / 5xx) o respuesta ilegible. */
export class ApiError extends Error {
  readonly kind = "api" as const;
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly requestId?: string;
  /** Segundos sugeridos por la cabecera `Retry-After` (429 / 503), si venía. */
  readonly retryAfterS?: number;

  constructor(
    message: string,
    code: string,
    status: number,
    details?: unknown,
    requestId?: string,
    retryAfterS?: number
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
    this.retryAfterS = retryAfterS;
  }
}

/** No hubo respuesta: sin red, DNS, servidor inalcanzable o la app está en modo avión. */
export class OfflineError extends Error {
  readonly kind = "offline" as const;
  readonly code = "OFFLINE" as const;

  constructor(message = "Sin conexión con el servidor.", options?: { cause?: unknown }) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "OfflineError";
  }
}

/** La petición superó su tiempo máximo (`timeoutMs`). */
export class TimeoutError extends Error {
  readonly kind = "timeout" as const;
  readonly code = "TIMEOUT" as const;
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`La petición superó ${timeoutMs} ms.`);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * El servidor rechazó el token de una petición autenticada (401). Cuando se lanza, la capa de red ya ha emitido
 * el evento `authExpired`; la sesión se limpia y se navega a Bienvenida. Quien llama no necesita hacer nada más
 * que dejar de pintar el resultado.
 */
export class AuthExpiredError extends Error {
  readonly kind = "auth_expired" as const;
  readonly code = "AUTH_EXPIRED" as const;
  readonly status = 401 as const;
  /** Código que devolvió el servidor (p. ej. AUTH_INVALID_OR_EXPIRED). */
  readonly serverCode: string;
  readonly requestId?: string;

  constructor(serverCode = "AUTH_INVALID_OR_EXPIRED", requestId?: string) {
    super("La sesión ha caducado o ya no es válida.");
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "AuthExpiredError";
    this.serverCode = serverCode;
    this.requestId = requestId;
  }
}

export type RequestError = ApiError | OfflineError | TimeoutError | AuthExpiredError;

function hasKind(value: unknown, kind: RequestErrorKind): boolean {
  return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === kind;
}

export function isApiError(value: unknown): value is ApiError {
  return hasKind(value, "api");
}
export function isOfflineError(value: unknown): value is OfflineError {
  return hasKind(value, "offline");
}
export function isTimeoutError(value: unknown): value is TimeoutError {
  return hasKind(value, "timeout");
}
export function isAuthExpiredError(value: unknown): value is AuthExpiredError {
  return hasKind(value, "auth_expired");
}
export function isRequestError(value: unknown): value is RequestError {
  return isApiError(value) || isOfflineError(value) || isTimeoutError(value) || isAuthExpiredError(value);
}

/** `true` si la promesa se canceló a propósito (desmontaje, nueva búsqueda…). No es un error que mostrar. */
export function isAbortError(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as { name?: unknown }).name === "AbortError";
}

/** Crea un AbortError compatible con web y React Native (DOMException puede no existir en Hermes). */
export function createAbortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("The operation was aborted.", "AbortError");
  }
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

/** `true` si es un ApiError con alguno de esos códigos estables (p. ej. `isApiErrorWithCode(e, "NO_CAPACITY_ON_SEGMENT")`). */
export function isApiErrorWithCode(value: unknown, ...codes: string[]): value is ApiError {
  return isApiError(value) && codes.includes(value.code);
}

/** `true` si el servidor dijo «hace falta cuenta» a una petición sin token (invitado). */
export function isAuthRequiredError(value: unknown): boolean {
  return isApiError(value) && value.status === 401;
}

// ---------------------------------------------------------------------------------------------------------------
// Mensajes de usuario
// ---------------------------------------------------------------------------------------------------------------

export interface ErrorCopy {
  title?: string;
  message: string;
}

/**
 * Catálogo base código → texto en español (es-ES). Las pantallas de cada slice pueden ampliarlo con
 * `registerErrorMessages({ MI_CODIGO: { message: "…" } })` (p. ej. al importar su `api.ts`).
 * Los textos «No hay plazas» / «Destino fuera de provincia» son literales de la lámina 36.
 */
const BASE_MESSAGES: Record<string, ErrorCopy> = {
  // Sesión y cuenta
  AUTH_REQUIRED: { title: "Hace falta una cuenta", message: "Crea una cuenta o entra para continuar." },
  AUTH_INVALID: { title: "Sesión caducada", message: "Tu sesión ha caducado. Vuelve a entrar." },
  AUTH_INVALID_OR_EXPIRED: { title: "Sesión caducada", message: "Tu sesión ha caducado. Vuelve a entrar." },
  AUTH_EXPIRED: { title: "Sesión caducada", message: "Tu sesión ha caducado. Vuelve a entrar." },
  AUTH_FORBIDDEN: { title: "Sin permiso", message: "No tienes permiso para hacer esto." },
  ACCOUNT_NOT_ACTIVE: {
    title: "Cuenta no activa",
    message: "Tu cuenta no está activa. Si crees que es un error, escríbenos desde el Centro de ayuda.",
  },
  // Verificación por SMS
  AUTH_CODE_INVALID_OR_EXPIRED: { title: "Código incorrecto", message: "Código incorrecto: inténtalo de nuevo." },
  INVALID_VERIFICATION_CODE: { title: "Código incorrecto", message: "Código incorrecto: inténtalo de nuevo." },
  AUTH_TOO_MANY_ATTEMPTS: {
    title: "Demasiados intentos",
    message: "Has superado el número de intentos. Solicita un código nuevo.",
  },
  AUTH_RESEND_TOO_SOON: {
    title: "Espera un momento",
    message: "Espera un momento antes de pedir otro código.",
  },
  AUTH_CHALLENGE_NOT_FOUND: {
    message: "La verificación ha caducado o ya no es válida. Solicita un código nuevo.",
  },
  AUTH_CHALLENGE_NOT_READY: {
    message: "La verificación ha caducado o ya no es válida. Solicita un código nuevo.",
  },
  AUTH_CHALLENGE_NOT_APPROVED: {
    message: "La verificación ha caducado o ya no es válida. Solicita un código nuevo.",
  },
  AUTH_CHALLENGE_ALREADY_USED: { message: "Este código ya se usó. Solicita uno nuevo." },
  AUTH_PROVIDER_MISMATCH: {
    message: "La verificación ha caducado o ya no es válida. Solicita un código nuevo.",
  },
  INVALID_PHONE_E164: {
    title: "Móvil no válido",
    message: "Introduce un número de móvil válido (por ejemplo, 612 345 678).",
  },
  INVALID_SELF_SERVICE_ROLES: { message: "Elige pasajero, conductor o ambos perfiles." },
  SMS_PROVIDER_UNAVAILABLE: {
    title: "SMS no disponible",
    message: "Ahora mismo no podemos enviar SMS. Inténtalo de nuevo más tarde.",
  },
  SMS_PROVIDER_BAD_RESPONSE: {
    title: "SMS no disponible",
    message: "Ahora mismo no podemos enviar SMS. Inténtalo de nuevo más tarde.",
  },
  SMS_RATE_LIMITED: {
    title: "Demasiadas solicitudes",
    message: "Has pedido demasiados códigos. Espera un poco e inténtalo de nuevo.",
  },
  // Perfil
  INVALID_DISPLAY_NAME: { message: "El nombre debe tener entre 2 y 80 caracteres." },
  PROFILE_NOT_FOUND: { message: "No hemos encontrado tu perfil." },
  USER_NOT_FOUND: { message: "No hemos encontrado a este usuario." },
  // Provincia / ruta / plazas (literales de la lámina 36 donde existen)
  NO_CAPACITY_ON_SEGMENT: {
    title: "No hay plazas",
    message: "En este momento no hay plazas disponibles para esta ruta.",
  },
  MVC_STOP_OUTSIDE_PROVINCE: {
    title: "Destino fuera de provincia",
    message: "El destino seleccionado está fuera de la provincia.",
  },
  MVC_ROUTE_UNVERIFIED: {
    title: "Ruta no verificada",
    message: "No hemos podido comprobar que toda la ruta se mantenga dentro de la provincia.",
  },
  PROVINCE_NOT_FOUND: {
    title: "Fuera de provincia",
    message: "Este punto no pertenece a ninguna provincia disponible.",
  },
  // Subidas privadas
  UPLOAD_INTENT_EXPIRED: { message: "La subida ha caducado. Vuelve a intentarlo." },
  UPLOAD_INTENT_NOT_FOUND: { message: "No encontramos esa subida. Vuelve a intentarlo." },
  PRIVATE_UPLOAD_FAILED: {
    title: "No se pudo subir",
    message: "No se pudo subir el archivo. Comprueba tu conexión e inténtalo de nuevo.",
  },
  LOCAL_FILE_TOO_LARGE: { title: "Archivo demasiado grande", message: "La imagen supera el límite de 20 MB." },
  LOCAL_FILE_SIZE_UNKNOWN: { message: "No se pudo calcular el tamaño del archivo." },
  // Red y servidor
  VALIDATION_ERROR: { message: "Algún dato no es válido. Revísalo e inténtalo de nuevo." },
  BAD_REQUEST: { message: "Algún dato no es válido. Revísalo e inténtalo de nuevo." },
  API_NOT_CONFIGURED: {
    title: "Servidor no configurado",
    message: "La app no tiene configurada la dirección del servidor.",
  },
  INVALID_RESPONSE: { title: "Respuesta inesperada", message: "El servidor ha respondido algo que no esperábamos." },
  OFFLINE: { title: "Sin conexión", message: "Sin conexión. Comprueba tu Internet e inténtalo de nuevo." },
  TIMEOUT: {
    title: "Tarda demasiado",
    message: "El servidor tarda demasiado en responder. Inténtalo de nuevo.",
  },
  RATE_LIMITED: {
    title: "Demasiadas solicitudes",
    message: "Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.",
  },
  INTERNAL_ERROR: {
    title: "Error del servidor",
    message: "Algo ha fallado en nuestros servidores. Inténtalo de nuevo en unos minutos.",
  },
};

const extraMessages = new Map<string, ErrorCopy>();

/** Amplía (o sobrescribe) el catálogo código → texto. Idempotente: puede llamarse al importar un módulo. */
export function registerErrorMessages(messages: Record<string, ErrorCopy | string>): void {
  for (const [code, copy] of Object.entries(messages)) {
    extraMessages.set(code, typeof copy === "string" ? { message: copy } : copy);
  }
}

function lookupMessage(code: string): ErrorCopy | undefined {
  return extraMessages.get(code) ?? BASE_MESSAGES[code];
}

function statusCopy(status: number): ErrorCopy {
  if (status === 401) return BASE_MESSAGES.AUTH_REQUIRED as ErrorCopy;
  if (status === 403) return BASE_MESSAGES.AUTH_FORBIDDEN as ErrorCopy;
  if (status === 404) return { title: "No encontrado", message: "No hemos encontrado lo que buscas." };
  if (status === 408) return BASE_MESSAGES.TIMEOUT as ErrorCopy;
  if (status === 409) {
    return {
      title: "Algo ha cambiado",
      message: "La situación ha cambiado mientras tanto. Actualiza e inténtalo de nuevo.",
    };
  }
  if (status === 413) return { title: "Archivo demasiado grande", message: "El archivo es demasiado grande." };
  if (status === 429) return BASE_MESSAGES.RATE_LIMITED as ErrorCopy;
  if (status >= 500) return BASE_MESSAGES.INTERNAL_ERROR as ErrorCopy;
  return { title: "No se ha podido completar", message: "No se ha podido completar la acción. Revisa los datos." };
}

export interface ErrorDescription {
  kind: RequestErrorKind | "unknown";
  /** Titular corto en español (títulos de `ErrorState` / `Banner`). */
  title: string;
  /** Explicación en español, lista para mostrar. */
  message: string;
  /** Código estable en MAYÚSCULAS_SNAKE (o `OFFLINE`/`TIMEOUT`/`AUTH_EXPIRED`); null si no hay. */
  code: string | null;
  status: number | null;
  requestId: string | null;
  /** `true` si reintentar la misma acción puede funcionar (sin red, timeout, 5xx, 429). */
  retryable: boolean;
}

/** Traduce cualquier error a datos listos para pintar. Nunca lanza. */
export function describeError(error: unknown): ErrorDescription {
  if (isOfflineError(error)) {
    const copy = BASE_MESSAGES.OFFLINE as ErrorCopy;
    return {
      kind: "offline",
      title: copy.title ?? "Sin conexión",
      message: copy.message,
      code: error.code,
      status: null,
      requestId: null,
      retryable: true,
    };
  }
  if (isTimeoutError(error)) {
    const copy = BASE_MESSAGES.TIMEOUT as ErrorCopy;
    return {
      kind: "timeout",
      title: copy.title ?? "Tarda demasiado",
      message: copy.message,
      code: error.code,
      status: null,
      requestId: null,
      retryable: true,
    };
  }
  if (isAuthExpiredError(error)) {
    const copy = BASE_MESSAGES.AUTH_EXPIRED as ErrorCopy;
    return {
      kind: "auth_expired",
      title: copy.title ?? "Sesión caducada",
      message: copy.message,
      code: error.code,
      status: 401,
      requestId: error.requestId ?? null,
      retryable: false,
    };
  }
  if (isApiError(error)) {
    const copy = lookupMessage(error.code) ?? statusCopy(error.status);
    return {
      kind: "api",
      title: copy.title ?? statusCopy(error.status).title ?? "No se ha podido completar",
      message: copy.message,
      code: error.code,
      status: error.status,
      requestId: error.requestId ?? null,
      retryable: error.status >= 500 || error.status === 429 || error.status === 408,
    };
  }
  return {
    kind: "unknown",
    title: "Algo ha salido mal",
    message: "Ha ocurrido un error inesperado. Inténtalo de nuevo.",
    code: null,
    status: null,
    requestId: null,
    retryable: true,
  };
}

/** Atajo: solo el texto en español. */
export function errorMessage(error: unknown): string {
  return describeError(error).message;
}
