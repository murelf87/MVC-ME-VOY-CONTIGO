/**
 * Atiende `https://storage.mvc-preview.invalid/<clave>?op=upload|download&sig=…&exp=…`: el «S3 privado» simulado.
 * Las respuestas de error imitan el XML de S3 porque el cliente (`putToSignedUrl`) solo mira `response.ok`.
 */
import type { PreviewDb } from "./db";
import { sha256Hex } from "./sha256";
import { keyFromPath, placeholderObject, STORAGE_PROVIDER_NAME } from "./storage";
import type { RawResponse } from "./server";

export interface StorageRequest {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

function xmlError(status: number, code: string, message: string, requestId: string): RawResponse {
  return {
    status,
    headers: { "content-type": "application/xml" },
    body: `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message><RequestId>${requestId}</RequestId></Error>`,
  };
}

async function readBytes(body: unknown): Promise<Uint8Array | null> {
  if (body === undefined || body === null) return new Uint8Array(0);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof Blob !== "undefined" && body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  if (typeof body === "string") return new TextEncoder().encode(body);
  return null;
}

export async function handleStorageRequest(db: PreviewDb, req: StorageRequest, requestId: string): Promise<RawResponse> {
  const key = keyFromPath(req.url.pathname);
  const expiresAt = Number(req.url.searchParams.get("exp")) * 1000;
  const signature = req.url.searchParams.get("sig");
  if (!signature || !Number.isFinite(expiresAt)) {
    return xmlError(403, "AccessDenied", "Falta la firma de la URL.", requestId);
  }
  if (expiresAt <= db.nowMs()) {
    return xmlError(403, "AccessDenied", "Request has expired", requestId);
  }

  if (req.method === "PUT") {
    if (req.url.searchParams.get("op") !== "upload") {
      return xmlError(403, "SignatureDoesNotMatch", "La URL no es de subida.", requestId);
    }
    const intent = db.uploadIntents.find((row) => row.storage_key === key && row.storage_provider === STORAGE_PROVIDER_NAME);
    if (!intent) return xmlError(403, "AccessDenied", "No hay ninguna subida autorizada para esta clave.", requestId);
    const declared = (req.headers["content-type"] ?? "").split(";")[0]?.trim() ?? "";
    if (declared !== intent.content_type) {
      return xmlError(403, "SignatureDoesNotMatch", "El tipo de contenido no coincide con la firma.", requestId);
    }
    const bytes = await readBytes(req.body);
    if (!bytes) return xmlError(400, "InvalidRequest", "Cuerpo de subida no soportado.", requestId);
    db.blobs.put(key, bytes, declared, db.nowMs());
    return { status: 200, headers: { etag: `"${sha256Hex(bytes).slice(0, 32)}"`, "content-length": "0" }, body: null };
  }

  if (req.method === "GET" || req.method === "HEAD") {
    if (req.url.searchParams.get("op") !== "download") {
      return xmlError(403, "SignatureDoesNotMatch", "La URL no es de descarga.", requestId);
    }
    const blob = db.blobs.get(key);
    const known = db.documents.find((row) => row.storage_key === key && row.storage_provider === STORAGE_PROVIDER_NAME);
    if (!blob && !known) return xmlError(404, "NoSuchKey", "The specified key does not exist.", requestId);
    if (blob?.bytes) {
      return {
        status: 200,
        headers: { "content-type": blob.contentType, "content-length": String(blob.bytes.byteLength) },
        body: req.method === "HEAD" ? null : blob.bytes,
      };
    }
    const placeholder = placeholderObject(key);
    return { status: 200, headers: { "content-type": placeholder.contentType }, body: placeholder.body };
  }

  return xmlError(405, "MethodNotAllowed", "Método no permitido.", requestId);
}
