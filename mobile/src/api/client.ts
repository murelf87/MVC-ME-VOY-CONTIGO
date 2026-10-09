/**
 * Cliente HTTP único de la app. TODA la red pasa por aquí (pantalla → hook → features/<slice>/api.ts → client).
 *
 *  - JSON de ida y vuelta; 204 / cuerpo vacío → `undefined`.
 *  - Timeout con AbortController (por defecto 15 s) y cancelación por `signal` del llamador.
 *  - Errores tipados: ApiError | OfflineError | TimeoutError | AuthExpiredError (ver ./errors).
 *  - 401 a una petición CON token → `AuthExpiredError` + evento `authExpired` (el AuthProvider limpia la sesión
 *    y lleva a Bienvenida). Un 401 sin token es un ApiError normal (p. ej. código de SMS incorrecto, invitado).
 *  - `Idempotency-Key` opcional (acciones que crean cosas).
 *  - Reintento con backoff exponencial SOLO para GET (nunca para POST/PUT/PATCH/DELETE).
 *  - Captura del identificador de petición (`x-request-id` o `requestId` del cuerpo) en `ApiError.requestId`.
 */
import {
  ApiError,
  AuthExpiredError,
  OfflineError,
  TimeoutError,
  createAbortError,
  isAbortError,
  isApiError,
  isOfflineError,
  isTimeoutError,
} from "./errors";
import { emitAuthExpired, getAccessToken, isNetworkOffline } from "./runtime";

export { ApiError, AuthExpiredError, OfflineError, TimeoutError } from "./errors";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

// ---------------------------------------------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------------------------------------------

/** Origen que NUNCA resuelve (RFC 2606): en la vista previa la red está interceptada y no sale del navegador. */
export const PREVIEW_FALLBACK_API_URL = "https://api.preview.mvc.invalid";

/**
 * Resuelve la URL base. `EXPO_PUBLIC_API_URL` manda; si no existe y estamos en vista previa
 * (`EXPO_PUBLIC_PREVIEW=1`) se usa un origen reservado que el backend en memoria intercepta.
 */
export function resolveApiUrl(apiUrl: string | undefined, preview: string | undefined): string {
  const explicit = (apiUrl ?? "").trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  return preview === "1" ? PREVIEW_FALLBACK_API_URL : "";
}

// Expo sustituye estas dos expresiones literales en tiempo de compilación: no las abstraigas.
export const API_URL: string = resolveApiUrl(
  process.env.EXPO_PUBLIC_API_URL,
  process.env.EXPO_PUBLIC_PREVIEW
);

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_GET_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 400;
const RETRY_MAX_DELAY_MS = 4_000;
/** Si el servidor pide esperar más que esto con Retry-After, no reintentamos: avisamos al usuario. */
const RETRY_AFTER_CAP_S = 5;

export interface ApiConfig {
  baseUrl: string;
  fetchImpl: typeof fetch | null;
  defaultTimeoutMs: number;
  retryBaseDelayMs: number;
  random: () => number;
}

const config: ApiConfig = {
  baseUrl: API_URL,
  fetchImpl: null,
  defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  retryBaseDelayMs: RETRY_BASE_DELAY_MS,
  random: Math.random,
};

/** Solo para pruebas: sustituye la URL base, `fetch`, el timeout por defecto, la espera base de reintentos o el aleatorio. */
export function configureApi(overrides: Partial<ApiConfig>): void {
  Object.assign(config, overrides);
}

export function resetApiConfig(): void {
  config.baseUrl = API_URL;
  config.fetchImpl = null;
  config.defaultTimeoutMs = DEFAULT_TIMEOUT_MS;
  config.retryBaseDelayMs = RETRY_BASE_DELAY_MS;
  config.random = Math.random;
}

/** URL base vigente (sin barra final); vacía si no hay configurada. */
export function getApiBaseUrl(): string {
  return config.baseUrl;
}

function doFetch(input: string, init: RequestInit): Promise<Response> {
  // Se resuelve en cada llamada (no al importar): la vista previa sustituye `globalThis.fetch` al arrancar.
  const impl = config.fetchImpl ?? globalThis.fetch;
  return impl(input, init);
}

// ---------------------------------------------------------------------------------------------------------------
// Utilidades puras (con pruebas)
// ---------------------------------------------------------------------------------------------------------------

export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number | boolean)[];

/** `?a=1&b=x&b=y` (vacío si no hay nada). Omite null/undefined; los arrays repiten la clave. */
export function buildQueryString(query?: Record<string, QueryValue>): string {
  if (!query) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
    }
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export function buildUrl(base: string, path: string, query?: Record<string, QueryValue>): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const qs = buildQueryString(query);
  if (!qs) return `${base}${normalizedPath}`;
  return normalizedPath.includes("?")
    ? `${base}${normalizedPath}&${qs.slice(1)}`
    : `${base}${normalizedPath}${qs}`;
}

export interface ParsedErrorPayload {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

function statusToCode(status: number): string {
  if (status === 400) return "BAD_REQUEST";
  if (status === 401) return "AUTH_REQUIRED";
  if (status === 403) return "AUTH_FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 408) return "TIMEOUT";
  if (status === 409) return "CONFLICT";
  if (status === 413) return "PAYLOAD_TOO_LARGE";
  if (status === 422) return "UNPROCESSABLE";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "INTERNAL_ERROR";
  return "HTTP_ERROR";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeFastifyCode(raw: unknown, status: number): string {
  if (typeof raw !== "string" || !raw) return statusToCode(status);
  if (raw.startsWith("FST_ERR_VALIDATION")) return "VALIDATION_ERROR";
  if (raw.startsWith("FST_ERR_")) return statusToCode(status);
  return /^[A-Z0-9_]+$/.test(raw) ? raw : statusToCode(status);
}

/**
 * Entiende los tres formatos de error que puede devolver el backend:
 *   1. `{ error: { code, message, details? }, requestId }`    (DomainError, el contrato)
 *   2. `{ statusCode, code?, error: "Bad Request", message }`  (Fastify / plugins: validación, 404, rate-limit)
 *   3. texto plano / HTML de un proxy
 */
export function parseErrorPayload(status: number, body: unknown): ParsedErrorPayload {
  const record = asRecord(body);
  const requestId = typeof record?.requestId === "string" ? record.requestId : undefined;
  const nested = asRecord(record?.error);
  if (nested) {
    return {
      code: typeof nested.code === "string" && nested.code ? nested.code : statusToCode(status),
      message: typeof nested.message === "string" && nested.message ? nested.message : `HTTP ${status}`,
      details: nested.details,
      requestId,
    };
  }
  if (record) {
    return {
      code: normalizeFastifyCode(record.code, status),
      message: typeof record.message === "string" && record.message ? record.message : `HTTP ${status}`,
      details: record.validation ?? record.details,
      requestId,
    };
  }
  return {
    code: statusToCode(status),
    message: typeof body === "string" && body.trim() ? body.trim().slice(0, 200) : `HTTP ${status}`,
  };
}

export function parseRetryAfter(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}

/** ¿Se puede reintentar esta petición? SOLO GET (idempotente) y solo ante fallos transitorios. */
export function shouldRetry(method: HttpMethod, error: unknown, attempt: number, maxRetries: number): boolean {
  if (method !== "GET") return false;
  if (attempt >= maxRetries) return false;
  if (isOfflineError(error) || isTimeoutError(error)) return true;
  if (isApiError(error)) {
    if (error.status === 429 || error.status === 503) {
      return error.retryAfterS === undefined || error.retryAfterS <= RETRY_AFTER_CAP_S;
    }
    return error.status === 502 || error.status === 504;
  }
  return false;
}

export interface BackoffInput {
  attempt: number;
  baseMs?: number;
  maxMs?: number;
  retryAfterS?: number;
  random?: () => number;
}

/** Espera antes del reintento nº `attempt` (0 = primer reintento): exponencial con jitter ±25 %, respeta Retry-After. */
export function computeBackoffMs({
  attempt,
  baseMs = RETRY_BASE_DELAY_MS,
  maxMs = RETRY_MAX_DELAY_MS,
  retryAfterS,
  random = Math.random,
}: BackoffInput): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** attempt);
  const jittered = Math.round(exponential * (0.75 + random() * 0.5));
  if (retryAfterS !== undefined) return Math.max(jittered, retryAfterS * 1000);
  return jittered;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Petición
// ---------------------------------------------------------------------------------------------------------------

export interface RequestOptions {
  method?: HttpMethod;
  /**
   * `undefined` (por defecto): usa el token de la sesión actual, si lo hay.
   * `string`: usa ese token. `null`: no envía `Authorization`.
   */
  token?: string | null;
  /** Cuerpo JSON (se serializa solo). */
  body?: unknown;
  /** Parámetros de query (se codifican; null/undefined se omiten; arrays repiten la clave). */
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  /** Cancelación del llamador (desmontaje, nueva búsqueda…): rechaza con AbortError, no con TimeoutError. */
  signal?: AbortSignal;
  /** Tiempo máximo en ms (por defecto 15 000). */
  timeoutMs?: number;
  /** Cabecera `Idempotency-Key`. Úsala en acciones que crean cosas y reutiliza la MISMA al reintentar. */
  idempotencyKey?: string;
  /** Reintentos ante fallo transitorio. SOLO se aplican a GET (por defecto 2). */
  retries?: number;
  /**
   * `"handle"` (por defecto): un 401 con token emite `authExpired` (limpieza de sesión + Bienvenida).
   * `"ignore"`: lanza AuthExpiredError igualmente pero SIN emitir el evento (arranque de sesión, validación de token).
   */
  authExpiry?: "handle" | "ignore";
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  requestId: string | null;
  durationMs: number;
}

function requireBaseUrl(): string {
  if (!config.baseUrl) {
    throw new ApiError("La dirección del backend no está configurada.", "API_NOT_CONFIGURED", 0);
  }
  return config.baseUrl;
}

async function attempt<T>(
  method: HttpMethod,
  url: string,
  token: string | null,
  options: RequestOptions
): Promise<ApiResponse<T>> {
  const timeoutMs = options.timeoutMs ?? config.defaultTimeoutMs;
  const callerSignal = options.signal;
  if (callerSignal?.aborted) throw createAbortError();
  if (isNetworkOffline()) throw new OfflineError();

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = () => controller.abort();
  callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

  const headers: Record<string, string> = { accept: "application/json", ...options.headers };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;

  const started = Date.now();
  const mapFailure = (error: unknown): Error => {
    if (timedOut) return new TimeoutError(timeoutMs);
    if (callerSignal?.aborted || isAbortError(error)) return createAbortError();
    return new OfflineError(undefined, { cause: error });
  };

  try {
    let response: Response;
    let text: string;
    try {
      response = await doFetch(url, {
        method,
        headers,
        signal: controller.signal,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
      text = await response.text();
    } catch (error) {
      throw mapFailure(error);
    }

    const requestId = response.headers.get("x-request-id") ?? undefined;
    let payload: unknown;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        if (response.ok) {
          throw new ApiError(
            "El servidor devolvió una respuesta que no es JSON.",
            "INVALID_RESPONSE",
            response.status,
            undefined,
            requestId
          );
        }
        payload = text;
      }
    }

    if (!response.ok) {
      const parsed = parseErrorPayload(response.status, payload);
      const effectiveRequestId = parsed.requestId ?? requestId;
      if (response.status === 401 && token) {
        if (options.authExpiry !== "ignore") {
          emitAuthExpired({ token, code: parsed.code, requestId: effectiveRequestId });
        }
        throw new AuthExpiredError(parsed.code, effectiveRequestId);
      }
      throw new ApiError(
        parsed.message,
        parsed.code,
        response.status,
        parsed.details,
        effectiveRequestId,
        parseRetryAfter(response.headers.get("retry-after"))
      );
    }

    return {
      data: payload as T,
      status: response.status,
      requestId: requestId ?? null,
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}

/** Como `apiRequest`, pero devuelve también estado HTTP, identificador de petición y duración. */
export async function apiRequestDetailed<T>(
  path: string,
  options: RequestOptions = {}
): Promise<ApiResponse<T>> {
  const method = options.method ?? "GET";
  const url = buildUrl(requireBaseUrl(), path, options.query);
  const token = options.token === undefined ? getAccessToken() : options.token;
  const maxRetries = method === "GET" ? (options.retries ?? DEFAULT_GET_RETRIES) : 0;

  for (let attemptNumber = 0; ; attemptNumber += 1) {
    try {
      return await attempt<T>(method, url, token, options);
    } catch (error) {
      if (isNetworkOffline() || options.signal?.aborted) throw error;
      if (!shouldRetry(method, error, attemptNumber, maxRetries)) throw error;
      await sleep(
        computeBackoffMs({
          attempt: attemptNumber,
          baseMs: config.retryBaseDelayMs,
          retryAfterS: isApiError(error) ? error.retryAfterS : undefined,
          random: config.random,
        }),
        options.signal
      );
    }
  }
}

/**
 * Petición JSON al backend. Devuelve el cuerpo ya decodificado (`undefined` en 204).
 * Rechaza con ApiError | OfflineError | TimeoutError | AuthExpiredError (o AbortError si se cancela).
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return (await apiRequestDetailed<T>(path, options)).data;
}

/**
 * Sondea `GET /health/live`. «offline» significa que el servidor no contestó bien; la app puede seguir
 * mostrando datos en caché. No reintenta ni emite eventos.
 */
export async function checkApiHealth(): Promise<"online" | "offline" | "unconfigured"> {
  if (!config.baseUrl) return "unconfigured";
  if (isNetworkOffline()) return "offline";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await doFetch(`${config.baseUrl}/health/live`, { signal: controller.signal });
    return response.ok ? "online" : "offline";
  } catch {
    return "offline";
  } finally {
    clearTimeout(timeout);
  }
}
