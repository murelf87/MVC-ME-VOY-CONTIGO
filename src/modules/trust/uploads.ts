import crypto from "node:crypto";
import { DomainError } from "../../errors.js";
import type { PrivateObjectStorage } from "../../storage/private-object-storage.js";
import { trustError } from "./common.js";
import type { Db, TrustContext } from "./context.js";
import { extensionFor, matchesDeclaredType } from "./magic-bytes.js";

export type UploadPurpose = "profile_photo" | "identity_selfie" | "identity_document" | "driver_license";

const MIB = 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
const DOCUMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

export const UPLOAD_POLICY: Record<UploadPurpose, { types: readonly string[]; maxBytes: number }> = {
  profile_photo: { types: IMAGE_TYPES, maxBytes: 10 * MIB },
  identity_selfie: { types: IMAGE_TYPES, maxBytes: 10 * MIB },
  identity_document: { types: DOCUMENT_TYPES, maxBytes: 20 * MIB },
  driver_license: { types: DOCUMENT_TYPES, maxBytes: 20 * MIB }
};

/** Intenciones de subida por usuario y 24 h (protege el almacenamiento y la cola de revisión). */
export const MAX_UPLOAD_INTENTS_PER_DAY = 20;

export type IntentRow = {
  id: string;
  owner_user_id: string;
  purpose: UploadPurpose;
  storage_provider: string;
  storage_key: string;
  content_type: string;
  expected_size_bytes: string | number;
  expires_at: Date;
  completed_at: Date | null;
};

export type VerifiedObject = {
  storageProvider: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
};

export function storageAvailable(ctx: TrustContext): boolean {
  return ctx.storage !== null && ctx.storage.providerName !== "disabled";
}

export function requireStorage(ctx: TrustContext): PrivateObjectStorage {
  if (!ctx.storage || ctx.storage.providerName === "disabled") {
    throw trustError(
      "PRIVATE_STORAGE_DISABLED",
      "El almacenamiento privado de archivos no está configurado. De momento no se pueden subir archivos.",
      503
    );
  }
  return ctx.storage;
}

export async function createUploadIntent(
  ctx: TrustContext,
  userId: string,
  purpose: UploadPurpose,
  input: { contentType: string; sizeBytes: number }
) {
  const storage = requireStorage(ctx);
  const policy = UPLOAD_POLICY[purpose];
  if (!policy.types.includes(input.contentType)) {
    throw trustError("UPLOAD_TYPE_NOT_ALLOWED", "Ese tipo de archivo no está permitido.", 422, {
      contentType: input.contentType,
      allowedContentTypes: policy.types
    });
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > policy.maxBytes) {
    throw trustError("UPLOAD_SIZE_INVALID", "El archivo debe pesar entre 1 byte y el máximo permitido.", 422, {
      maxSizeBytes: policy.maxBytes
    });
  }
  const recent = await ctx.pool.query<{ n: string }>(
    `select count(*)::text as n from trust_upload_intents
      where owner_user_id = $1 and created_at > now() - interval '24 hours'`,
    [userId]
  );
  if (Number(recent.rows[0]?.n ?? 0) >= MAX_UPLOAD_INTENTS_PER_DAY) {
    throw trustError("UPLOAD_RATE_LIMITED", "Has pedido demasiadas subidas hoy. Inténtalo de nuevo mañana.", 429);
  }

  const id = crypto.randomUUID();
  const key = ["users", userId, "trust", purpose, `${id}.${extensionFor(input.contentType)}`].join("/");
  const signed = await storage.createUploadUrl({ key, contentType: input.contentType, expiresInSeconds: ctx.uploadTtlSeconds });
  await ctx.pool.query(
    `insert into trust_upload_intents(id, owner_user_id, purpose, storage_provider, storage_key, content_type, expected_size_bytes, expires_at)
     values($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, userId, purpose, storage.providerName, key, input.contentType, input.sizeBytes, signed.expiresAt]
  );
  return {
    intentId: id,
    uploadUrl: signed.url,
    method: "PUT" as const,
    headers: signed.headers,
    expiresAt: new Date(signed.expiresAt).toISOString(),
    maxSizeBytes: policy.maxBytes,
    allowedContentTypes: [...policy.types]
  };
}

export async function loadIntent(db: Db, userId: string, intentId: string, purposes: readonly UploadPurpose[]): Promise<IntentRow> {
  const found = await db.query<IntentRow>(
    `select id, owner_user_id, purpose, storage_provider, storage_key, content_type, expected_size_bytes, expires_at, completed_at
       from trust_upload_intents
      where id = $1 and owner_user_id = $2 and purpose = any($3::text[])`,
    [intentId, userId, [...purposes]]
  );
  const row = found.rows[0];
  if (!row) throw trustError("UPLOAD_INTENT_NOT_FOUND", "No existe esa subida.", 404);
  return row;
}

/**
 * Verifica en el servidor el objeto subido: proveedor, existencia, tamaño, tipo declarado y firma binaria; calcula el SHA-256.
 * Nunca se confía en lo que diga el cliente.
 */
export async function verifyUploadedObject(ctx: TrustContext, intent: IntentRow): Promise<VerifiedObject> {
  const storage = requireStorage(ctx);
  if (new Date(intent.expires_at).getTime() < ctx.now().getTime()) {
    throw trustError("UPLOAD_INTENT_EXPIRED", "La subida ha caducado. Pide una nueva.", 410);
  }
  if (intent.storage_provider !== storage.providerName) {
    throw trustError("UPLOAD_STORAGE_MISMATCH", "El proveedor de almacenamiento ya no coincide con el de la subida.", 409);
  }
  const expected = Number(intent.expected_size_bytes);
  const policy = UPLOAD_POLICY[intent.purpose];

  let info;
  try {
    info = await storage.headObject(intent.storage_key);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw trustError("UPLOAD_OBJECT_MISSING", "Todavía no se ha recibido el archivo. Súbelo y vuelve a confirmar.", 409);
  }
  if (info.sizeBytes !== expected) {
    throw trustError("UPLOAD_SIZE_MISMATCH", "El tamaño del archivo no coincide con el declarado.", 422, {
      expected,
      actual: info.sizeBytes
    });
  }
  if (info.contentType && info.contentType.split(";")[0]?.trim() !== intent.content_type) {
    throw trustError("UPLOAD_TYPE_MISMATCH", "El tipo del archivo no coincide con el declarado.", 422);
  }

  let bytes: Uint8Array;
  try {
    bytes = await storage.readObject(intent.storage_key, policy.maxBytes);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (/exceeds/i.test(message)) {
      throw trustError("UPLOAD_SIZE_MISMATCH", "El archivo supera el tamaño máximo permitido.", 422);
    }
    throw trustError("UPLOAD_OBJECT_MISSING", "No se ha podido leer el archivo subido. Vuelve a intentarlo.", 409);
  }
  if (bytes.byteLength !== expected) {
    throw trustError("UPLOAD_SIZE_MISMATCH", "El tamaño del archivo no coincide con el declarado.", 422, {
      expected,
      actual: bytes.byteLength
    });
  }
  if (!matchesDeclaredType(bytes, intent.content_type)) {
    throw trustError("UPLOAD_CONTENT_INVALID", "El contenido del archivo no corresponde a su tipo.", 422);
  }
  return {
    storageProvider: intent.storage_provider,
    storageKey: intent.storage_key,
    contentType: intent.content_type,
    sizeBytes: bytes.byteLength,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex")
  };
}

export async function markIntentCompleted(db: Db, intentId: string): Promise<void> {
  await db.query(`update trust_upload_intents set completed_at = coalesce(completed_at, now()) where id = $1`, [intentId]);
}

/** URL firmada de lectura de lo propio; null si no hay almacenamiento o falla la firma (no rompe el estado). */
export async function ownPreviewUrl(
  ctx: TrustContext,
  key: string,
  provider: string
): Promise<{ url: string; expiresAt: string } | null> {
  if (!storageAvailable(ctx) || !ctx.storage || ctx.storage.providerName !== provider) return null;
  try {
    const ttl = ctx.config.ownPreviewTtlSeconds;
    const url = await ctx.storage.createDownloadUrl(key, ttl);
    return { url, expiresAt: new Date(ctx.now().getTime() + ttl * 1000).toISOString() };
  } catch {
    return null;
  }
}
