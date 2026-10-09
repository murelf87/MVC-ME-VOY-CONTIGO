/**
 * Subida a almacenamiento privado mediante URL firmada (PUT directo a S3 / compatible).
 *
 * Flujo de las subidas privadas del backend:
 *   1. POST /v1/me/uploads/intents        → { intentId, uploadUrl, headers, expiresAt }
 *   2. putToSignedUrl(intent, archivo)    ← este módulo
 *   3. POST /v1/me/uploads/:intentId/complete
 *
 * La URL firmada ya lleva la autorización: NO se envía el Bearer de la sesión (rompería la firma) y las
 * cabeceras que devuelve el intent se envían tal cual, después de `content-type`.
 * No se reintenta: es una subida de un solo intento; si falla, el llamador decide (pedir otro intent).
 */
import { ApiError, OfflineError, TimeoutError, createAbortError, isAbortError } from "./errors";
import { isNetworkOffline } from "./runtime";

export interface SignedUploadTarget {
  uploadUrl: string;
  /** Cabeceras que el servidor firmó junto a la URL (p. ej. content-type, x-amz-*). */
  headers?: Record<string, string>;
}

export interface UploadSource {
  /** `file://…` (nativo), `blob:`/`data:` (web). */
  uri: string;
  contentType: string;
}

export interface PutToSignedUrlOptions {
  signal?: AbortSignal;
  /** Por defecto 60 s (una foto en 3G tarda). */
  timeoutMs?: number;
}

const DEFAULT_UPLOAD_TIMEOUT_MS = 60_000;

export async function putToSignedUrl(
  target: SignedUploadTarget,
  source: UploadSource,
  options: PutToSignedUrlOptions = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS;
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

  try {
    let blob: Blob;
    try {
      const local = await fetch(source.uri, { signal: controller.signal });
      blob = await local.blob();
    } catch (error) {
      if (timedOut) throw new TimeoutError(timeoutMs);
      if (callerSignal?.aborted || isAbortError(error)) throw createAbortError();
      throw new ApiError("No se pudo leer el archivo local.", "LOCAL_FILE_UNREADABLE", 0);
    }

    let response: Response;
    try {
      response = await fetch(target.uploadUrl, {
        method: "PUT",
        headers: { "content-type": source.contentType, ...target.headers },
        body: blob,
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) throw new TimeoutError(timeoutMs);
      if (callerSignal?.aborted || isAbortError(error)) throw createAbortError();
      throw new OfflineError(undefined, { cause: error });
    }

    if (!response.ok) {
      throw new ApiError(
        "No se pudo subir el archivo al almacenamiento privado.",
        "PRIVATE_UPLOAD_FAILED",
        response.status
      );
    }
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}
