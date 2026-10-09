/**
 * Errores de dominio del backend en memoria. Misma forma que el backend real:
 *   { error: { code, message, details? }, requestId }
 * (`src/errors.ts` → `DomainError` y el manejador global de `src/app.ts`).
 */

export class ApiFailure extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: unknown;
  /** Cabeceras adicionales (p. ej. `retry-after`). */
  readonly headers: Readonly<Record<string, string>> | undefined;

  constructor(
    code: string,
    message: string,
    statusCode = 400,
    details?: unknown,
    headers?: Record<string, string>
  ) {
    super(message);
    this.name = "ApiFailure";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.headers = headers;
  }
}

/** Lanza un `ApiFailure`. Atajo para los servicios de dominio (`fail("TRIP_NOT_FOUND", "Trip not found", 404)`). */
export function fail(code: string, message: string, statusCode = 400, details?: unknown): never {
  throw new ApiFailure(code, message, statusCode, details);
}

export function isApiFailure(value: unknown): value is ApiFailure {
  return value instanceof ApiFailure;
}

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
  requestId: string;
}

export function errorBody(code: string, message: string, requestId: string, details?: unknown): ErrorBody {
  const error: ErrorBody["error"] = { code, message };
  if (details !== undefined) error.details = details;
  return { error, requestId };
}

/** Respuesta por defecto de Fastify para una ruta inexistente (no pasa por el manejador de DomainError). */
export function notFoundBody(method: string, path: string): { message: string; error: string; statusCode: number } {
  return { message: `Route ${method}:${path} not found`, error: "Not Found", statusCode: 404 };
}

/** Un fallo de red de `fetch` (sin respuesta del servidor). El cliente de la app lo convierte en OfflineError. */
export function networkFailure(message = "Failed to fetch"): TypeError {
  return new TypeError(message);
}

/** Equivalente a `DOMException("AbortError")`, que no existe en todos los entornos. */
export function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}
