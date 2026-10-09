import type { AuthPrincipal } from "../../auth/session.js";
import { reviewPrivateDocument } from "../../documents/document-service.js";
import { DomainError } from "../../errors.js";
import { writeAudit } from "../../lib/audit.js";
import { notify } from "../../lib/notify.js";
import { UUID_RE, iso, isoOrNull, maskPhone, nameParts, trustError } from "./common.js";
import type { TrustContext } from "./context.js";
import { decideIdentityCheck } from "./identity-check.js";
import { decideProfilePhoto } from "./photo.js";
import { publicPhotoUrl } from "./public-photo-url.js";
import {
  checkReasonOptions,
  documentReasonOptions,
  isCheckRejectReason,
  isCheckRetryReason,
  isPhotoReason,
  photoReasonOptions,
  type ReasonOption
} from "./reasons.js";
import { ITEM_KEYS, type ItemKey, type ItemState, getReviewRow, getReviewSummary, itemStatesOf } from "./review-queue.js";
import { requireStorage } from "./uploads.js";

export type Decision = "approved" | "rejected" | "needs_retry";
export type EvidenceKind = "profile_photo" | "identity_selfie" | "private_document";
export type EvidencePurpose = "identity_review" | "photo_moderation" | "license_review" | "vehicle_review" | "support_case" | "legal_request";

const ACCESS_NOTE = "Acceso a documentación privada solo para personal autorizado de MVC.";

/* ───────────── Expediente ───────────── */

type ActorRef = { id: string; displayName: string | null } | null;

async function actorRefs(ctx: TrustContext, ids: Array<string | null>): Promise<Map<string, { id: string; displayName: string | null }>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const out = new Map<string, { id: string; displayName: string | null }>();
  if (unique.length === 0) return out;
  const rows = await ctx.pool.query<{ user_id: string; display_name: string | null }>(
    `select u.id as user_id, p.display_name from app_users u left join profiles p on p.user_id = u.id where u.id = any($1::uuid[])`,
    [unique]
  );
  for (const r of rows.rows) out.set(r.user_id, { id: r.user_id, displayName: r.display_name });
  return out;
}

function allowedDecisions(key: ItemKey, state: ItemState): Decision[] {
  if (state !== "in_review") return [];
  return key === "private_check" ? ["approved", "needs_retry", "rejected"] : ["approved", "rejected"];
}

function reasonOptionsFor(key: ItemKey): ReasonOption[] {
  if (key === "profile_photo") return photoReasonOptions();
  if (key === "private_check") return checkReasonOptions();
  return documentReasonOptions();
}

type DocEvidenceRow = {
  id: string;
  review_status: "pending" | "approved" | "rejected";
  review_reason: string | null;
  reviewed_by_user_id: string | null;
  content_type: string;
  size_bytes: string | number;
  created_at: Date;
  reviewed_at: Date | null;
};

export async function getDossier(ctx: TrustContext, reviewer: AuthPrincipal, userId: string) {
  if (!UUID_RE.test(userId)) throw trustError("USER_NOT_FOUND", "No existe esa persona usuaria.", 404);
  const row = await getReviewRow(ctx.pool, userId);
  if (!row) throw trustError("USER_NOT_FOUND", "No existe esa persona usuaria.", 404);
  const userQ = await ctx.pool.query<{ phone_e164: string | null; created_at: Date }>(
    `select phone_e164, created_at from app_users where id = $1`,
    [userId]
  );
  const user = userQ.rows[0];
  const summary = (await getReviewSummary(ctx.pool, userId, reviewer.userId))!;
  const states = itemStatesOf(row);

  const [docs, lics, photos, attempts, vehicles] = await Promise.all([
    ctx.pool.query<DocEvidenceRow>(
      `select id, review_status::text as review_status, review_reason, reviewed_by_user_id, content_type, size_bytes, created_at, reviewed_at
         from private_documents where owner_user_id = $1 and kind = 'identity_document' order by created_at desc, id desc limit 5`,
      [userId]
    ),
    ctx.pool.query<DocEvidenceRow>(
      `select id, review_status::text as review_status, review_reason, reviewed_by_user_id, content_type, size_bytes, created_at, reviewed_at
         from private_documents where owner_user_id = $1 and kind = 'driver_license' order by created_at desc, id desc limit 5`,
      [userId]
    ),
    ctx.pool.query<{
      id: string; status: string; reason_code: string | null; reason_note: string | null; decided_by_user_id: string | null;
      content_type: string; size_bytes: string | number; submitted_at: Date; decided_at: Date | null;
    }>(
      `select id, status, reason_code, reason_note, decided_by_user_id, content_type, size_bytes, submitted_at, decided_at
         from trust_profile_photos where user_id = $1 order by submitted_at desc, id desc limit 5`,
      [userId]
    ),
    ctx.pool.query<{
      id: string; attempt_no: number; status: string; reason_code: string | null; reason_note: string | null; decided_by_user_id: string | null;
      content_type: string; size_bytes: string | number; submitted_at: Date; decided_at: Date | null;
    }>(
      `select id, attempt_no, status, reason_code, reason_note, decided_by_user_id, content_type, size_bytes, submitted_at, decided_at
         from trust_identity_check_attempts where user_id = $1 order by attempt_no desc limit 3`,
      [userId]
    ),
    ctx.pool.query<{
      id: string; make: string; model: string; plate: string; review_status: string; documentation_status: string;
      vehicle_photo_status: string; insurance_status: string;
    }>(
      `select id, make, model, plate, review_status::text as review_status, documentation_status::text as documentation_status,
              vehicle_photo_status::text as vehicle_photo_status, insurance_status::text as insurance_status
         from vehicles where driver_user_id = $1 order by created_at`,
      [userId]
    )
  ]);
  const actors = await actorRefs(ctx, [
    ...docs.rows.map(d => d.reviewed_by_user_id),
    ...lics.rows.map(d => d.reviewed_by_user_id),
    ...photos.rows.map(p => p.decided_by_user_id),
    ...attempts.rows.map(a => a.decided_by_user_id)
  ]);
  const actor = (id: string | null): ActorRef => (id ? actors.get(id) ?? { id, displayName: null } : null);

  const docItem = (key: "identity" | "driver_license", rows: DocEvidenceRow[], label: string) => {
    const latest = rows[0];
    return {
      key,
      label: key === "identity" ? (states.identity === "approved" ? "DNI verificado" : label) : label,
      state: states[key],
      badge: states[key] === "in_review" && key !== "identity" ? "Requiere revisión" : null,
      submittedAt: latest ? iso(latest.created_at) : null,
      decidedAt: latest ? isoOrNull(latest.reviewed_at) : null,
      decidedBy: latest ? actor(latest.reviewed_by_user_id) : null,
      reason: latest?.review_reason ?? null,
      evidence: rows.map(d => ({
        kind: "private_document" as const,
        id: d.id,
        label,
        contentType: d.content_type,
        sizeBytes: Number(d.size_bytes),
        submittedAt: iso(d.created_at),
        status: d.review_status === "pending" ? "in_review" : d.review_status
      })),
      allowedDecisions: allowedDecisions(key, states[key]),
      reasonOptions: reasonOptionsFor(key)
    };
  };

  const isDriver = row.roles.includes("driver");
  const out: Array<Record<string, unknown>> = [];
  out.push(docItem("identity", docs.rows, states.identity === "none" ? "Identidad · Sin enviar" : states.identity === "in_review" ? "Identidad · En revisión" : "Identidad · Rechazada"));
  if (isDriver || lics.rows.length > 0) out.push(docItem("driver_license", lics.rows, "Permiso de conducir"));
  {
    const latest = photos.rows.find(p => p.status !== "superseded");
    out.push({
      key: "profile_photo",
      label: "Foto de perfil",
      state: states.profile_photo,
      badge: states.profile_photo === "in_review" ? "Requiere revisión" : null,
      submittedAt: latest ? iso(latest.submitted_at) : null,
      decidedAt: latest ? isoOrNull(latest.decided_at) : null,
      decidedBy: latest ? actor(latest.decided_by_user_id) : null,
      reason: latest?.reason_note ?? latest?.reason_code ?? null,
      evidence: photos.rows
        .filter(p => p.status !== "superseded")
        .map(p => ({
          kind: "profile_photo" as const,
          id: p.id,
          label: "Foto de perfil",
          contentType: p.content_type,
          sizeBytes: Number(p.size_bytes),
          submittedAt: iso(p.submitted_at),
          status: p.status
        })),
      allowedDecisions: allowedDecisions("profile_photo", states.profile_photo),
      reasonOptions: reasonOptionsFor("profile_photo")
    });
  }
  if (states.private_check !== "none") {
    const latest = attempts.rows[0];
    out.push({
      key: "private_check",
      label: "Comprobación privada",
      state: states.private_check,
      badge: states.private_check === "in_review" ? "Requiere revisión" : null,
      submittedAt: latest ? iso(latest.submitted_at) : null,
      decidedAt: latest ? isoOrNull(latest.decided_at) : null,
      decidedBy: latest ? actor(latest.decided_by_user_id) : null,
      reason: latest?.reason_note ?? latest?.reason_code ?? null,
      evidence: attempts.rows.map(a => ({
        kind: "identity_selfie" as const,
        id: a.id,
        label: `Captura ${a.attempt_no}`,
        contentType: a.content_type,
        sizeBytes: Number(a.size_bytes),
        submittedAt: iso(a.submitted_at),
        status: a.status
      })),
      allowedDecisions: allowedDecisions("private_check", states.private_check),
      reasonOptions: reasonOptionsFor("private_check")
    });
  }

  // Historial: entregas y decisiones (de las tablas de revisión; sin texto libre del usuario).
  const history: Array<{ at: string; action: string; actor: ActorRef; summary: string }> = [];
  for (const d of docs.rows) {
    history.push({ at: iso(d.created_at), action: "identity_document.submitted", actor: null, summary: "Documento de identidad enviado" });
    if (d.reviewed_at) {
      history.push({
        at: iso(d.reviewed_at),
        action: `identity_document.${d.review_status}`,
        actor: actor(d.reviewed_by_user_id),
        summary: d.review_status === "approved" ? "Documento de identidad aprobado" : "Documento de identidad rechazado"
      });
    }
  }
  for (const d of lics.rows) {
    history.push({ at: iso(d.created_at), action: "driver_license.submitted", actor: null, summary: "Permiso de conducir enviado" });
    if (d.reviewed_at) {
      history.push({
        at: iso(d.reviewed_at),
        action: `driver_license.${d.review_status}`,
        actor: actor(d.reviewed_by_user_id),
        summary: d.review_status === "approved" ? "Permiso de conducir aprobado" : "Permiso de conducir rechazado"
      });
    }
  }
  for (const p of photos.rows) {
    history.push({ at: iso(p.submitted_at), action: "profile_photo.submitted", actor: null, summary: "Foto de perfil enviada" });
    if (p.decided_at && (p.status === "approved" || p.status === "rejected" || p.status === "superseded")) {
      history.push({
        at: iso(p.decided_at),
        action: `profile_photo.${p.status}`,
        actor: actor(p.decided_by_user_id),
        summary: p.status === "approved" ? "Foto de perfil aprobada" : p.status === "rejected" ? "Foto de perfil rechazada" : "Foto de perfil sustituida"
      });
    }
  }
  for (const a of attempts.rows) {
    history.push({ at: iso(a.submitted_at), action: "identity_check.attempt_submitted", actor: null, summary: `Captura ${a.attempt_no} enviada` });
    if (a.decided_at) {
      history.push({
        at: iso(a.decided_at),
        action: `identity_check.${a.status}`,
        actor: actor(a.decided_by_user_id),
        summary: a.status === "accepted" ? `Captura ${a.attempt_no} aceptada` : a.status === "needs_retry" ? `Captura ${a.attempt_no}: nueva captura solicitada` : `Captura ${a.attempt_no} rechazada`
      });
    }
  }
  history.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));

  const { displayName, firstName } = nameParts(row.display_name);
  return {
    user: {
      id: userId,
      displayName,
      firstName,
      photoUrl: publicPhotoUrl(userId, row.public_photo_key, row.public_photo_status),
      roles: row.roles as Array<"passenger" | "driver">,
      status: row.user_status as "active" | "suspended" | "deleted",
      phoneMasked: maskPhone(user?.phone_e164),
      createdAt: iso(user?.created_at ?? new Date(0))
    },
    summary,
    items: out,
    vehicles: vehicles.rows.map(v => ({
      id: v.id,
      label: `${v.make} ${v.model}`,
      plate: v.plate,
      reviewStatus: v.review_status,
      documentationStatus: v.documentation_status,
      vehiclePhotoStatus: v.vehicle_photo_status,
      insuranceStatus: v.insurance_status,
      reviewEndpoint: `/v1/admin/vehicles/${v.id}/review`
    })),
    history: history.slice(0, 40),
    accessNote: ACCESS_NOTE
  };
}

/* ───────────── Decisión ───────────── */

export type DecisionInput = { decision: Decision; reason?: string | undefined; reasonCode?: string | undefined; items?: ItemKey[] | undefined };
type ItemResult = { item: ItemKey; outcome: Decision | "skipped"; errorCode: string | null; message: string | null };

function allowedReasonCodes(decision: Decision): (code: string) => boolean {
  if (decision === "needs_retry") return code => isCheckRetryReason(code);
  if (decision === "rejected") return code => isPhotoReason(code) || (isCheckRejectReason(code) && code !== "MAX_ATTEMPTS_REACHED") || code === "DOCUMENT_REVIEW_REJECTED";
  return () => false;
}

export async function decideReview(
  ctx: TrustContext,
  reviewer: AuthPrincipal,
  userId: string,
  input: DecisionInput,
  requestId: string
) {
  if (!UUID_RE.test(userId)) throw trustError("USER_NOT_FOUND", "No existe esa persona usuaria.", 404);
  const row = await getReviewRow(ctx.pool, userId);
  if (!row) throw trustError("USER_NOT_FOUND", "No existe esa persona usuaria.", 404);
  if (userId === reviewer.userId) {
    throw trustError("SELF_REVIEW_FORBIDDEN", "No puedes revisar tu propio expediente.", 403);
  }
  const reason = input.reason?.trim() || null;
  if (input.decision === "rejected" && (!reason || reason.length < 3)) {
    throw trustError("REVIEW_REASON_REQUIRED", "Indica el motivo del rechazo (al menos 3 caracteres).", 422);
  }
  if (reason && reason.length > 1000) {
    throw trustError("REVIEW_REASON_REQUIRED", "El motivo no puede superar los 1000 caracteres.", 422);
  }
  if (input.decision === "needs_retry" && !input.reasonCode) {
    throw trustError("REVIEW_REASON_REQUIRED", "Indica por qué hace falta otra captura.", 422);
  }
  if (input.reasonCode !== undefined && !allowedReasonCodes(input.decision)(input.reasonCode)) {
    throw trustError("REVIEW_REASON_CODE_INVALID", "El código de motivo no es válido para esta decisión.", 422, { reasonCode: input.reasonCode });
  }

  const states = itemStatesOf(row);
  const requested = input.items ? [...new Set(input.items)] : null;
  const targets: ItemKey[] = ITEM_KEYS.filter(key => (requested ? requested.includes(key) : states[key] === "in_review"));
  const results: ItemResult[] = [];
  for (const key of targets) {
    if (input.decision === "needs_retry" && key !== "private_check") {
      results.push({ item: key, outcome: "skipped", errorCode: "REVIEW_ITEM_INVALID", message: "Solo la comprobación privada admite pedir otra captura." });
      continue;
    }
    if (states[key] !== "in_review") {
      results.push({ item: key, outcome: "skipped", errorCode: "NOTHING_TO_REVIEW", message: "No hay entregas pendientes de este elemento." });
      continue;
    }
    try {
      await applyItemDecision(ctx, reviewer, userId, key, { ...input, reason }, requestId);
      results.push({ item: key, outcome: input.decision, errorCode: null, message: null });
    } catch (error) {
      if (error instanceof DomainError && (error.code === "NOTHING_TO_REVIEW" || error.code === "VEHICLE_INSURANCE_EXPIRED")) {
        results.push({ item: key, outcome: "skipped", errorCode: error.code, message: error.message });
      } else {
        throw error;
      }
    }
  }
  if (!results.some(r => r.outcome !== "skipped")) {
    throw trustError("NOTHING_TO_REVIEW", "No hay ningún elemento pendiente de revisión para esta decisión.", 409, { results });
  }
  const summary = await getReviewSummary(ctx.pool, userId, reviewer.userId);
  return { userId, results, summary };
}

async function applyItemDecision(
  ctx: TrustContext,
  reviewer: AuthPrincipal,
  userId: string,
  key: ItemKey,
  input: { decision: Decision; reason: string | null; reasonCode?: string | undefined },
  requestId: string
): Promise<void> {
  if (key === "identity" || key === "driver_license") {
    if (input.decision === "needs_retry") throw trustError("REVIEW_ITEM_INVALID", "Este elemento no admite pedir otra captura.", 422);
    const kind = key === "identity" ? "identity_document" : "driver_license";
    const pending = await ctx.pool.query<{ id: string }>(
      `select id from private_documents
        where owner_user_id = $1 and kind = $2 and review_status = 'pending'
        order by created_at desc, id desc limit 1`,
      [userId, kind]
    );
    const documentId = pending.rows[0]?.id;
    if (!documentId) throw trustError("NOTHING_TO_REVIEW", "No hay entregas pendientes de este elemento.", 409);
    // Servicio existente: actualiza private_documents y, para identidad, profiles.identity_status (verified | rejected).
    await reviewPrivateDocument(ctx.pool, reviewer, documentId, {
      decision: input.decision,
      ...(input.reason ? { reason: input.reason } : {})
    });
    const label = key === "identity" ? "documento de identidad" : "permiso de conducir";
    await notify(ctx.pool, {
      userId,
      category: "system",
      kind: input.decision === "approved" ? `${kind}_approved` : `${kind}_rejected`,
      title: input.decision === "approved" ? (key === "identity" ? "Identidad verificada" : "Permiso de conducir aprobado") : `No hemos podido validar tu ${label}`,
      body:
        input.decision === "approved"
          ? key === "identity"
            ? "Hemos verificado tu identidad."
            : "Hemos revisado tu permiso de conducir."
          : input.reason ?? "Puedes volver a subir el documento.",
      data: { item: key }
    });
    await writeAudit(ctx.pool, {
      actorUserId: reviewer.userId,
      action: "admin.review.decision",
      entityType: "user",
      entityId: userId,
      requestId,
      metadata: { item: key, decision: input.decision, documentId, hasReason: Boolean(input.reason) }
    });
    return;
  }

  const client = await ctx.pool.connect();
  try {
    await client.query("begin");
    let evidenceId: string;
    if (key === "profile_photo") {
      if (input.decision === "needs_retry") throw trustError("REVIEW_ITEM_INVALID", "Este elemento no admite pedir otra captura.", 422);
      const result = await decideProfilePhoto(client, {
        userId,
        reviewerId: reviewer.userId,
        decision: input.decision,
        reasonCode: input.reasonCode && isPhotoReason(input.reasonCode) ? input.reasonCode : null,
        reason: input.reason
      });
      evidenceId = result.photoId;
    } else {
      const result = await decideIdentityCheck(client, {
        userId,
        reviewerId: reviewer.userId,
        decision: input.decision,
        reasonCode: input.reasonCode ?? null,
        reason: input.reason
      });
      evidenceId = result.attemptId;
    }
    await writeAudit(client, {
      actorUserId: reviewer.userId,
      action: "admin.review.decision",
      entityType: "user",
      entityId: userId,
      requestId,
      metadata: { item: key, decision: input.decision, evidenceId, reasonCode: input.reasonCode ?? null, hasReason: Boolean(input.reason) }
    });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/* ───────────── Acceso a evidencias privadas ───────────── */

type EvidenceLocator = {
  ownerUserId: string;
  storageProvider: string;
  storageKey: string;
  contentType: string;
  entityType: string;
};

async function locateEvidence(ctx: TrustContext, kind: EvidenceKind, evidenceId: string): Promise<EvidenceLocator | null> {
  if (!UUID_RE.test(evidenceId)) return null;
  if (kind === "profile_photo") {
    const r = await ctx.pool.query<{ user_id: string; storage_provider: string; storage_key: string; content_type: string }>(
      `select user_id, storage_provider, storage_key, content_type from trust_profile_photos where id = $1`,
      [evidenceId]
    );
    const row = r.rows[0];
    return row ? { ownerUserId: row.user_id, storageProvider: row.storage_provider, storageKey: row.storage_key, contentType: row.content_type, entityType: "profile_photo" } : null;
  }
  if (kind === "identity_selfie") {
    const r = await ctx.pool.query<{ user_id: string; storage_provider: string; storage_key: string; content_type: string }>(
      `select user_id, storage_provider, storage_key, content_type from trust_identity_check_attempts where id = $1`,
      [evidenceId]
    );
    const row = r.rows[0];
    return row ? { ownerUserId: row.user_id, storageProvider: row.storage_provider, storageKey: row.storage_key, contentType: row.content_type, entityType: "identity_check_attempt" } : null;
  }
  const r = await ctx.pool.query<{ owner_user_id: string; storage_provider: string; storage_key: string; content_type: string }>(
    `select owner_user_id, storage_provider, storage_key, content_type from private_documents where id = $1`,
    [evidenceId]
  );
  const row = r.rows[0];
  return row ? { ownerUserId: row.owner_user_id, storageProvider: row.storage_provider, storageKey: row.storage_key, contentType: row.content_type, entityType: "private_document" } : null;
}

/**
 * URL firmada de lectura de vida corta para el personal. Orden: localizar → firmar → AUDITAR → devolver.
 * Si la auditoría falla no sale ninguna URL (falla cerrado).
 */
export async function issueEvidenceAccess(
  ctx: TrustContext,
  principal: AuthPrincipal,
  kind: EvidenceKind,
  evidenceId: string,
  input: { purpose: EvidencePurpose; note?: string | undefined },
  requestId: string
) {
  const located = await locateEvidence(ctx, kind, evidenceId);
  if (!located) throw trustError("EVIDENCE_NOT_FOUND", "No existe esa evidencia.", 404);
  if (located.ownerUserId === principal.userId) {
    throw trustError("SELF_REVIEW_FORBIDDEN", "No puedes acceder a tu propia documentación desde el panel.", 403);
  }
  const storage = requireStorage(ctx);
  if (located.storageProvider !== storage.providerName) {
    throw trustError("EVIDENCE_STORAGE_MISMATCH", "El archivo está en otro proveedor de almacenamiento.", 409);
  }
  const ttl = ctx.config.signedUrlTtlSeconds;
  const url = await storage.createDownloadUrl(located.storageKey, ttl);
  const expiresAt = new Date(ctx.now().getTime() + ttl * 1000).toISOString();
  const note = input.note?.trim() || null;
  await writeAudit(ctx.pool, {
    actorUserId: principal.userId,
    action: "admin.evidence.access_url_issued",
    entityType: located.entityType,
    entityId: evidenceId,
    requestId,
    metadata: {
      evidenceKind: kind,
      purpose: input.purpose,
      ...(note ? { note } : {}),
      ttlSeconds: ttl,
      ownerUserId: located.ownerUserId,
      contentType: located.contentType
    }
  });
  return { url, expiresAt, ttlSeconds: ttl, contentType: located.contentType, evidence: { kind, id: evidenceId } };
}
