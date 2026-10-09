import type { PoolClient } from "pg";
import { writeAudit } from "../../lib/audit.js";
import { notify } from "../../lib/notify.js";
import { UUID_RE, isoOrNull, trustError } from "./common.js";
import type { TrustContext } from "./context.js";
import { photoReasonView } from "./reasons.js";
import { publicPhotoUrl } from "./public-photo-url.js";
import { createUploadIntent, loadIntent, markIntentCompleted, ownPreviewUrl, storageAvailable, verifyUploadedObject } from "./uploads.js";

type PhotoRow = {
  id: string;
  status: "in_review" | "approved" | "rejected" | "superseded";
  storage_provider: string;
  storage_key: string;
  reason_code: string | null;
  submitted_at: Date;
  decided_at: Date | null;
};

export type ProfilePhotoStateDto = Awaited<ReturnType<typeof getPhotoState>>;

/** Estado de la foto de perfil (pantalla 05). */
export async function getPhotoState(ctx: TrustContext, userId: string) {
  const profile = await ctx.pool.query<{ public_photo_key: string | null; public_photo_status: string }>(
    `select public_photo_key, public_photo_status from profiles where user_id = $1`,
    [userId]
  );
  const p = profile.rows[0];
  const latestRows = await ctx.pool.query<PhotoRow>(
    `select id, status, storage_provider, storage_key, reason_code, submitted_at, decided_at
       from trust_profile_photos
      where user_id = $1 and status <> 'superseded'
      order by submitted_at desc, id desc
      limit 1`,
    [userId]
  );
  const latest = latestRows.rows[0] ?? null;
  const visible = Boolean(p && p.public_photo_key && p.public_photo_status === "approved");

  let state: "none" | "in_review" | "approved" | "rejected" = "none";
  if (visible) state = "approved";
  else if (latest?.status === "in_review") state = "in_review";
  else if (latest?.status === "rejected") state = "rejected";
  else if (p?.public_photo_status === "rejected") state = "rejected";

  let latestDto = null;
  if (latest && latest.status !== "superseded") {
    const preview = await ownPreviewUrl(ctx, latest.storage_key, latest.storage_provider);
    latestDto = {
      id: latest.id,
      status: latest.status,
      submittedAt: latest.submitted_at.toISOString(),
      decidedAt: isoOrNull(latest.decided_at),
      reason: latest.status === "rejected" ? photoReasonView(latest.reason_code ?? "OTHER") : null,
      previewUrl: preview?.url ?? null,
      previewExpiresAt: preview?.expiresAt ?? null
    };
  }
  return {
    state,
    required: true as const,
    publicPhotoUrl: p ? publicPhotoUrl(userId, p.public_photo_key, p.public_photo_status) : null,
    latest: latestDto,
    uploadAvailable: storageAvailable(ctx)
  };
}

export function createPhotoUploadIntent(ctx: TrustContext, userId: string, input: { contentType: string; sizeBytes: number }) {
  return createUploadIntent(ctx, userId, "profile_photo", input);
}

/** Confirma la subida: verifica el objeto y registra la entrega en revisión humana (la pendiente anterior pasa a `superseded`). */
export async function completePhotoUpload(ctx: TrustContext, userId: string, intentId: string, requestId: string) {
  if (!UUID_RE.test(intentId)) throw trustError("UPLOAD_INTENT_NOT_FOUND", "No existe esa subida.", 404);
  const intent = await loadIntent(ctx.pool, userId, intentId, ["profile_photo"]);
  if (intent.completed_at) return getPhotoState(ctx, userId); // idempotente
  const object = await verifyUploadedObject(ctx, intent);

  const client = await ctx.pool.connect();
  try {
    await client.query("begin");
    // Serializa las entregas de un mismo usuario.
    await client.query(`select user_id from profiles where user_id = $1 for update`, [userId]);
    const again = await client.query(`select completed_at from trust_upload_intents where id = $1 for update`, [intentId]);
    if (again.rows[0]?.completed_at) {
      await client.query("commit");
      return getPhotoState(ctx, userId);
    }
    await client.query(`update trust_profile_photos set status = 'superseded' where user_id = $1 and status = 'in_review'`, [userId]);
    const inserted = await client.query<{ id: string }>(
      `insert into trust_profile_photos(user_id, intent_id, storage_provider, storage_key, content_type, size_bytes, sha256)
       values($1,$2,$3,$4,$5,$6,$7) returning id`,
      [userId, intentId, object.storageProvider, object.storageKey, object.contentType, object.sizeBytes, object.sha256]
    );
    // Sin foto visible aprobada y con rechazo anterior: vuelve a «pendiente» mientras se revisa la nueva.
    await client.query(
      `update profiles set public_photo_status = 'pending', updated_at = now()
        where user_id = $1 and public_photo_status = 'rejected'`,
      [userId]
    );
    await markIntentCompleted(client, intentId);
    await writeAudit(client, {
      actorUserId: userId,
      action: "photo.submitted",
      entityType: "profile_photo",
      entityId: inserted.rows[0]?.id ?? null,
      requestId,
      metadata: { sizeBytes: object.sizeBytes, contentType: object.contentType }
    });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return getPhotoState(ctx, userId);
}

/**
 * Decisión del personal sobre la entrega de foto en revisión (dentro de la transacción del llamante).
 * approved → pasa a ser la foto pública (profiles.public_photo_*); rejected → la anterior aprobada, si existe, sigue visible.
 */
export async function decideProfilePhoto(
  client: PoolClient,
  input: { userId: string; reviewerId: string; decision: "approved" | "rejected"; reasonCode: string | null; reason: string | null }
): Promise<{ photoId: string }> {
  const found = await client.query<{ id: string; storage_key: string }>(
    `select id, storage_key from trust_profile_photos where user_id = $1 and status = 'in_review' for update`,
    [input.userId]
  );
  const photo = found.rows[0];
  if (!photo) throw trustError("NOTHING_TO_REVIEW", "No hay entregas pendientes de este elemento.", 409);

  await client.query(
    `update trust_profile_photos
        set status = $2, reason_code = $3, reason_note = $4, decided_by_user_id = $5, decided_at = now()
      where id = $1`,
    [photo.id, input.decision, input.decision === "rejected" ? input.reasonCode ?? "OTHER" : null, input.reason, input.reviewerId]
  );
  if (input.decision === "approved") {
    await client.query(
      `update trust_profile_photos set status = 'superseded' where user_id = $1 and status = 'approved' and id <> $2`,
      [input.userId, photo.id]
    );
    await client.query(
      `update profiles set public_photo_key = $2, public_photo_status = 'approved', updated_at = now() where user_id = $1`,
      [input.userId, photo.storage_key]
    );
    await notify(client, {
      userId: input.userId,
      category: "system",
      kind: "profile_photo_approved",
      title: "Foto de perfil aprobada",
      body: "Tu foto de perfil ya es visible para otros usuarios.",
      data: { item: "profile_photo" }
    });
  } else {
    // Sin otra foto aprobada visible, el perfil queda como «rechazada».
    await client.query(
      `update profiles set public_photo_status = 'rejected', updated_at = now()
        where user_id = $1 and (public_photo_key is null or public_photo_status <> 'approved')`,
      [input.userId]
    );
    const view = photoReasonView(input.reasonCode ?? "OTHER");
    await notify(client, {
      userId: input.userId,
      category: "system",
      kind: "profile_photo_rejected",
      title: view?.title ?? "No hemos podido aprobar tu foto",
      body: view?.message ?? "Sube otra foto en la que se te vea bien.",
      data: { item: "profile_photo" }
    });
  }
  return { photoId: photo.id };
}
