/**
 * Comprobaciones locales de un archivo ANTES de pedir la intención de subida (el servidor las repite al completar).
 * Límites del contrato `docs/contracts/trust.md` §4.1: fotos y selfies `jpeg|png|webp|heic|heif` ≤ 10 MiB; documentos
 * `jpeg|png|webp|pdf` ≤ 20 MiB. Puro: se prueba en Node.
 */
import { authStrings } from "../strings";

export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;

export const PHOTO_CONTENT_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
export const DOCUMENT_CONTENT_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export type UploadKind = "photo" | "document";

export interface LocalFile {
  uri: string;
  mimeType: string;
  /** Bytes; `null` si no se pudo medir. */
  sizeBytes: number | null;
}

export type UploadValidationCode = "UPLOAD_TYPE_NOT_ALLOWED" | "UPLOAD_SIZE_INVALID" | "LOCAL_FILE_SIZE_UNKNOWN" | "LOCAL_FILE_EMPTY";

export type UploadValidation =
  | { ok: true; contentType: string; sizeBytes: number }
  | { ok: false; code: UploadValidationCode; message: string };

/** `image/JPG` → `image/jpeg`; quita parámetros (`; charset=…`). */
export function normalizeContentType(raw: string): string {
  const base = (raw.split(";")[0] ?? "").trim().toLowerCase();
  if (base === "image/jpg" || base === "image/pjpeg") return "image/jpeg";
  return base;
}

export function validateLocalFile(kind: UploadKind, file: LocalFile): UploadValidation {
  const copy = authStrings.upload;
  const allowed = kind === "photo" ? PHOTO_CONTENT_TYPES : DOCUMENT_CONTENT_TYPES;
  const contentType = normalizeContentType(file.mimeType);
  if (!allowed.includes(contentType)) {
    return { ok: false, code: "UPLOAD_TYPE_NOT_ALLOWED", message: kind === "photo" ? copy.notAllowed : copy.notAllowedDocument };
  }
  if (file.sizeBytes === null) return { ok: false, code: "LOCAL_FILE_SIZE_UNKNOWN", message: copy.sizeUnknown };
  if (file.sizeBytes <= 0) return { ok: false, code: "LOCAL_FILE_EMPTY", message: copy.empty };
  const max = kind === "photo" ? PHOTO_MAX_BYTES : DOCUMENT_MAX_BYTES;
  if (file.sizeBytes > max) {
    return { ok: false, code: "UPLOAD_SIZE_INVALID", message: kind === "photo" ? copy.tooLargePhoto : copy.tooLargeDocument };
  }
  return { ok: true, contentType, sizeBytes: file.sizeBytes };
}

/** «482 KB», «1,2 MB»: tamaño legible para el resumen del archivo elegido. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${(Math.round(mb * 10) / 10).toString().replace(".", ",")} MB`;
}
