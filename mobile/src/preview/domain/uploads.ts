/**
 * Subidas al almacenamiento privado simulado (`src/documents/private-upload-service.ts`).
 *
 * Flujo: intent (URL firmada `storage.mvc-preview.invalid`) → la app hace PUT → `complete` (comprueba tamaño y tipo,
 * calcula el SHA-256 y registra el documento). El OCR del seguro está desactivado, como en el backend sin proveedor.
 */
import { requireAnyRole } from "../core/auth";
import type { PreviewDb } from "../core/db";
import { ApiFailure } from "../core/errors";
import { sha256Hex } from "../core/sha256";
import { signedUrl, STORAGE_PROVIDER_NAME } from "../core/storage";
import type { Principal } from "../core/types";
import { iso } from "../core/wire";
import { registerVerifiedPrivateDocument } from "./documents";
import { documentExistingWire, documentRegisteredWire } from "./wire";

export type PrivateUploadKind = "vehicle_photo" | "vehicle_insurance";

/** `PRIVATE_UPLOAD_TTL_SECONDS` por defecto del backend. */
export const DEFAULT_UPLOAD_TTL_SECONDS = 600;
const MAX_BYTES = 20 * 1024 * 1024;

const ALLOWED_TYPES: Record<PrivateUploadKind, ReadonlySet<string>> = {
  vehicle_photo: new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]),
  vehicle_insurance: new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
};

function extensionFor(contentType: string): string {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    case "application/pdf":
      return "pdf";
    default:
      return "bin";
  }
}

export function createPrivateUploadIntent(
  db: PreviewDb,
  principal: Principal,
  input: { kind: PrivateUploadKind; vehicleId: string; contentType: string; sizeBytes: number },
  ttlSeconds = DEFAULT_UPLOAD_TTL_SECONDS
) {
  requireAnyRole(principal, ["driver"]);
  if (!ALLOWED_TYPES[input.kind].has(input.contentType)) {
    throw new ApiFailure("PRIVATE_UPLOAD_TYPE_NOT_ALLOWED", "File type is not allowed for this upload", 422, {
      kind: input.kind,
      contentType: input.contentType,
    });
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_BYTES) {
    throw new ApiFailure("PRIVATE_UPLOAD_SIZE_INVALID", "File size must be between 1 byte and 20 MiB", 422);
  }
  const vehicle = db.vehicles.get(input.vehicleId);
  if (!vehicle) throw new ApiFailure("VEHICLE_NOT_FOUND", "Vehicle not found", 404);
  if (vehicle.driver_user_id !== principal.userId) {
    throw new ApiFailure("VEHICLE_NOT_OWNED", "You cannot upload files for another user's vehicle", 403);
  }

  const id = db.ids.uuid();
  const key = ["users", principal.userId, "vehicles", input.vehicleId, input.kind, `${id}.${extensionFor(input.contentType)}`].join("/");
  const expiresAt = db.nowMs() + ttlSeconds * 1000;
  db.uploadIntents.insert({
    id,
    owner_user_id: principal.userId,
    vehicle_id: input.vehicleId,
    kind: input.kind,
    storage_provider: STORAGE_PROVIDER_NAME,
    storage_key: key,
    content_type: input.contentType,
    expected_size_bytes: input.sizeBytes,
    expires_at: expiresAt,
    completed_at: null,
    created_at: db.nowMs(),
  });
  return {
    intentId: id,
    uploadUrl: signedUrl("upload", key, expiresAt),
    headers: { "content-type": input.contentType },
    expiresAt: iso(expiresAt),
  };
}

export function completePrivateUploadIntent(db: PreviewDb, principal: Principal, intentId: string, requestId?: string) {
  requireAnyRole(principal, ["driver"]);
  const intent = db.uploadIntents.get(intentId);
  if (!intent || intent.owner_user_id !== principal.userId) {
    throw new ApiFailure("UPLOAD_INTENT_NOT_FOUND", "Upload intent not found", 404);
  }

  if (intent.completed_at !== null) {
    const existing = db.documents.find(
      (d) => d.storage_provider === intent.storage_provider && d.storage_key === intent.storage_key
    );
    if (existing) return { document: documentExistingWire(existing), alreadyCompleted: true };
  }

  if (intent.expires_at < db.nowMs()) throw new ApiFailure("UPLOAD_INTENT_EXPIRED", "Upload intent has expired", 410);
  if (intent.storage_provider !== STORAGE_PROVIDER_NAME) {
    throw new ApiFailure("UPLOAD_STORAGE_MISMATCH", "Upload storage provider mismatch", 409);
  }

  const blob = db.blobs.get(intent.storage_key);
  if (!blob) {
    // El backend real deja pasar el error de S3 (HeadObject sobre una clave inexistente): 500 genérico.
    throw new ApiFailure("INTERNAL_ERROR", "Internal server error", 500);
  }
  if (blob.sizeBytes !== intent.expected_size_bytes) {
    throw new ApiFailure("UPLOADED_FILE_SIZE_MISMATCH", "Uploaded file size does not match the declared size", 422, {
      expected: intent.expected_size_bytes,
      actual: blob.sizeBytes,
    });
  }
  if (blob.contentType && blob.contentType.split(";")[0] !== intent.content_type) {
    throw new ApiFailure("UPLOADED_FILE_TYPE_MISMATCH", "Uploaded file content type does not match the declared type", 422);
  }
  // Un objeto sembrado (sin bytes) no se puede subir; uno subido siempre tiene bytes.
  const bytes = blob.bytes ?? new Uint8Array(blob.sizeBytes);
  if (bytes.byteLength !== intent.expected_size_bytes) {
    throw new ApiFailure("UPLOADED_FILE_SIZE_MISMATCH", "Uploaded file byte count is invalid", 422);
  }
  const sha256 = sha256Hex(bytes);

  return db.tx(() => {
    const row = registerVerifiedPrivateDocument(
      db,
      principal,
      {
        kind: intent.kind,
        vehicleId: intent.vehicle_id,
        object: {
          storageProvider: intent.storage_provider,
          storageKey: intent.storage_key,
          contentType: intent.content_type,
          sizeBytes: bytes.byteLength,
          sha256,
        },
      },
      requestId
    );
    db.uploadIntents.update(intentId, { completed_at: db.nowMs() });
    const analysis = intent.kind === "vehicle_insurance" ? { status: "pending", provider: "disabled" } : null;
    return { document: documentRegisteredWire(row), analysis, alreadyCompleted: false };
  });
}

export function createOwnDocumentDownloadUrl(db: PreviewDb, principal: Principal, documentId: string) {
  const document = db.documents.get(documentId);
  if (!document || document.owner_user_id !== principal.userId) {
    throw new ApiFailure("DOCUMENT_NOT_FOUND", "Document not found", 404);
  }
  if (document.storage_provider !== STORAGE_PROVIDER_NAME) {
    throw new ApiFailure("DOCUMENT_STORAGE_MISMATCH", "Document storage provider mismatch", 409);
  }
  const expiresAt = db.nowMs() + 300_000;
  return { url: signedUrl("download", document.storage_key, expiresAt), expiresAt: iso(expiresAt) };
}
