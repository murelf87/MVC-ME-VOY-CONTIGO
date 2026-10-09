/**
 * Descarga del justificante imprimible (`GET /v1/me/receipts/{id}/printable`, docs/contracts/money.md §7.1).
 *
 * El cliente JSON del núcleo (`apiRequest`) solo entiende JSON, y este endpoint devuelve un documento HTML
 * (`text/html; charset=utf-8`), así que se hace aquí una petición propia con las mismas garantías: token de la sesión,
 * tiempo máximo, cancelación del llamador, sin conexión → `OfflineError`, 401 → sesión caducada y errores del
 * contrato (`{ error: { code, message } }`) → `ApiError`.
 *
 * Vista previa: el backend en memoria serializa todas las respuestas como JSON, de modo que el HTML llega como una cadena
 * JSON. Se detecta por la cabecera `content-type` y se decodifica; el backend real nunca la envía así.
 */
import { ApiError, AuthExpiredError, OfflineError, TimeoutError, getApiBaseUrl, isAbortError } from "@/api";
import { parseErrorPayload } from "@/api/client";
import { createAbortError } from "@/api/errors";
import { emitAuthExpired, getAccessToken, isNetworkOffline } from "@/api/runtime";

const DEFAULT_TIMEOUT_MS = 15_000;
/** Un justificante pesa pocos KB; por encima de esto el servidor no está devolviendo un justificante. */
const MAX_DOCUMENT_CHARS = 512_000;

export interface TextDocumentOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Decodifica el cuerpo: HTML tal cual (backend real) o cadena JSON con el HTML dentro (vista previa). */
export function decodeHtmlBody(text: string, contentType: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  let html: unknown = trimmed;
  if (contentType.toLowerCase().includes("json") || trimmed.startsWith('"')) {
    try {
      html = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (typeof html !== "string") return null;
  const document = html.trim();
  if (document === "" || document.length > MAX_DOCUMENT_CHARS) return null;
  return /^<(?:!doctype|html|head|body|meta|style|section|article|main|div)\b/i.test(document) ? document : null;
}

/** GET de un documento HTML autenticado. Rechaza con `ApiError | OfflineError | TimeoutError | AuthExpiredError` (o AbortError). */
export async function fetchHtmlDocument(path: string, options: TextDocumentOptions = {}): Promise<string> {
  const base = getApiBaseUrl();
  if (base === "") throw new ApiError("La dirección del backend no está configurada.", "API_NOT_CONFIGURED", 0);
  const callerAborted = (): boolean => options.signal?.aborted === true;
  if (callerAborted()) throw createAbortError();
  if (isNetworkOffline()) throw new OfflineError();

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = (): void => controller.abort();
  options.signal?.addEventListener("abort", onCallerAbort, { once: true });

  const token = getAccessToken();
  const headers: Record<string, string> = { accept: "text/html" };
  if (token !== null && token !== "") headers.authorization = `Bearer ${token}`;

  try {
    let response: Response;
    let text: string;
    try {
      response = await globalThis.fetch(`${base}${path}`, { method: "GET", headers, signal: controller.signal });
      text = await response.text();
    } catch (error) {
      if (timedOut) throw new TimeoutError(timeoutMs);
      if (callerAborted() || isAbortError(error)) throw createAbortError();
      throw new OfflineError(undefined, { cause: error });
    }

    const requestId = response.headers.get("x-request-id") ?? undefined;
    if (!response.ok) {
      let payload: unknown = text;
      try {
        payload = JSON.parse(text);
      } catch {
        // texto plano o HTML de un proxy: parseErrorPayload lo resume
      }
      const parsed = parseErrorPayload(response.status, payload);
      const effectiveRequestId = parsed.requestId ?? requestId;
      if (response.status === 401 && token !== null && token !== "") {
        emitAuthExpired({ token, code: parsed.code, requestId: effectiveRequestId });
        throw new AuthExpiredError(parsed.code, effectiveRequestId);
      }
      throw new ApiError(parsed.message, parsed.code, response.status, parsed.details, effectiveRequestId);
    }

    const document = decodeHtmlBody(text, response.headers.get("content-type") ?? "");
    if (document === null) {
      throw new ApiError("El servidor devolvió un documento que no es HTML.", "INVALID_RESPONSE", response.status, undefined, requestId);
    }
    return document;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onCallerAbort);
  }
}
