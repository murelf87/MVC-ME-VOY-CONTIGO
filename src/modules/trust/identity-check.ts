import type { PoolClient } from "pg";
import { writeAudit } from "../../lib/audit.js";
import { notify } from "../../lib/notify.js";
import { UUID_RE, isoOrNull, trustError } from "./common.js";
import type { Db, TrustContext } from "./context.js";
import { hasAcceptedLatest } from "./legal.js";
import { checkReasonView, documentReasonView, isCheckRejectReason, isCheckRetryReason } from "./reasons.js";
import {
  createUploadIntent,
  loadIntent,
  markIntentCompleted,
  ownPreviewUrl,
  requireStorage,
  storageAvailable,
  verifyUploadedObject
} from "./uploads.js";

/** Intentos máximos de selfie por persona usuaria. */
export const MAX_SELFIE_ATTEMPTS = 3;

export type PrivateCheckStateName = "not_started" | "in_review" | "needs_retry" | "completed" | "rejected";
export type PrivateCheckNextAction = "accept_notice" | "capture" | "retry_capture" | "wait_review" | "use_alternative" | "none";

type CheckRow = {
  state: PrivateCheckStateName;
  attempts_used: number;
  reason_code: string | null;
  updated_at: Date;
};
type AttemptRow = {
  id: string;
  attempt_no: number;
  status: "in_review" | "accepted" | "needs_retry" | "rejected" | "superseded";
  storage_provider: string;
  storage_key: string;
  submitted_at: Date;
  decided_at: Date | null;
};
type DocRow = { review_status: "pending" | "approved" | "rejected"; review_reason: string | null; created_at: Date; updated_at: Date };

const RANK: Record<PrivateCheckStateName, number> = { completed: 5, in_review: 4, needs_retry: 3, rejected: 2, not_started: 1 };

export function nextActionFor(
  state: PrivateCheckStateName,
  method: "selfie" | "identity_document" | null,
  consentAccepted: boolean,
  remaining: number
): PrivateCheckNextAction {
  switch (state) {
    case "completed":
      return "none";
    case "in_review":
      return "wait_review";
    case "rejected":
      return "use_alternative";
    case "needs_retry":
      if (method === "identity_document" || remaining <= 0) return "use_alternative";
      return consentAccepted ? "retry_capture" : "accept_notice";
    case "not_started":
      return consentAccepted ? "capture" : "accept_notice";
  }
}

/** Estado de la comprobación privada (pantallas 06 y 08). Combina la selfie con la alternativa (documento de identidad). */
export async function getPrivateCheckState(ctx: TrustContext, userId: string) {
  const [checkQ, attemptQ, identityQ, docQ, consent] = await Promise.all([
    ctx.pool.query<CheckRow>(`select state, attempts_used, reason_code, updated_at from trust_identity_checks where user_id = $1`, [userId]),
    ctx.pool.query<AttemptRow>(
      `select id, attempt_no, status, storage_provider, storage_key, submitted_at, decided_at
         from trust_identity_check_attempts where user_id = $1 order by attempt_no desc limit 1`,
      [userId]
    ),
    ctx.pool.query<{ identity_status: string }>(`select identity_status from profiles where user_id = $1`, [userId]),
    ctx.pool.query<DocRow>(
      `select review_status, review_reason, created_at, updated_at
         from private_documents
        where owner_user_id = $1 and kind = 'identity_document'
        order by created_at desc, id desc limit 1`,
      [userId]
    ),
    hasAcceptedLatest(ctx.pool, userId, "private_check_notice")
  ]);
  const check = checkQ.rows[0] ?? null;
  const attempt = attemptQ.rows[0] ?? null;
  const doc = docQ.rows[0] ?? null;
  const identityStatus = identityQ.rows[0]?.identity_status ?? "unverified";

  const selfieState: PrivateCheckStateName = check?.state ?? "not_started";
  const docState: PrivateCheckStateName = !doc
    ? "not_started"
    : doc.review_status === "pending"
      ? "in_review"
      : doc.review_status === "approved"
        ? "completed"
        : "needs_retry";

  // Precedencia: completed > in_review > needs_retry > rejected > not_started (empate: gana la selfie).
  const useDoc = RANK[docState] > RANK[selfieState];
  const state = useDoc ? docState : selfieState;
  const method: "selfie" | "identity_document" | null = state === "not_started" ? null : useDoc ? "identity_document" : "selfie";

  const used = check?.attempts_used ?? 0;
  const attempts = { used, max: MAX_SELFIE_ATTEMPTS, remaining: Math.max(0, MAX_SELFIE_ATTEMPTS - used) };

  let reason = null;
  if (state === "needs_retry" || state === "rejected") {
    reason = method === "identity_document" ? documentReasonView(doc?.review_reason) : checkReasonView(state, check?.reason_code);
  }

  let lastAttempt = null;
  if (attempt) {
    const preview = await ownPreviewUrl(ctx, attempt.storage_key, attempt.storage_provider);
    lastAttempt = {
      id: attempt.id,
      attemptNo: attempt.attempt_no,
      status: attempt.status,
      submittedAt: attempt.submitted_at.toISOString(),
      decidedAt: isoOrNull(attempt.decided_at),
      previewUrl: preview?.url ?? null,
      previewExpiresAt: preview?.expiresAt ?? null
    };
  }

  const updatedAt = state === "not_started" ? null : isoOrNull(useDoc ? doc?.updated_at : check?.updated_at);
  return {
    state,
    method,
    attempts,
    reason,
    nextAction: nextActionFor(state, method, consent.accepted, attempts.remaining),
    canUseAlternative: identityStatus !== "verified",
    consent: {
      noticeKind: "private_check_notice" as const,
      noticeVersion: consent.latest?.version ?? null,
      accepted: consent.accepted,
      acceptedAt: consent.acceptedAt,
      noticeLegallyReviewed: consent.latest?.status === "published"
    },
    lastAttempt,
    review: "human" as const,
    biometricMatching: "not_activated" as const,
    selfieAloneVerifiesIdentity: false as const,
    uploadAvailable: storageAvailable(ctx),
    updatedAt
  };
}

/** Reglas de entrada para una nueva selfie (lectura; la comprobación definitiva se repite bajo bloqueo al completar). */
async function assertSelfieAllowed(db: Db, userId: string): Promise<void> {
  const consent = await hasAcceptedLatest(db, userId, "private_check_notice");
  const check = (await db.query<CheckRow>(`select state, attempts_used, reason_code, updated_at from trust_identity_checks where user_id = $1`, [userId])).rows[0];
  const verified = (await db.query<{ identity_status: string }>(`select identity_status from profiles where user_id = $1`, [userId])).rows[0];
  guardSelfie(check ?? null, consent.accepted, verified?.identity_status === "verified");
}

function guardSelfie(check: CheckRow | null, consentAccepted: boolean, identityVerified: boolean): void {
  if (check?.state === "completed" || identityVerified) {
    throw trustError("PRIVATE_CHECK_ALREADY_COMPLETED", "La comprobación ya está completada.", 409);
  }
  if (!consentAccepted) {
    throw trustError(
      "PRIVATE_CHECK_CONSENT_REQUIRED",
      "Antes de continuar debes aceptar el aviso de privacidad de la comprobación.",
      409
    );
  }
  if (check?.state === "in_review") {
    throw trustError("PRIVATE_CHECK_IN_REVIEW", "Tu captura ya está en revisión. Te avisaremos cuando terminemos.", 409);
  }
  if (check?.state === "rejected") {
    throw trustError(
      "PRIVATE_CHECK_REJECTED",
      "La comprobación con foto no está disponible. Puedes verificarte aportando un documento de identidad.",
      409
    );
  }
  if ((check?.attempts_used ?? 0) >= MAX_SELFIE_ATTEMPTS) {
    throw trustError("PRIVATE_CHECK_MAX_ATTEMPTS_REACHED", "Has usado los 3 intentos. Puedes verificarte aportando un documento de identidad.", 409);
  }
}

export async function createSelfieUploadIntent(ctx: TrustContext, userId: string, input: { contentType: string; sizeBytes: number }) {
  requireStorage(ctx);
  await assertSelfieAllowed(ctx.pool, userId);
  return createUploadIntent(ctx, userId, "identity_selfie", input);
}

/** Confirma la selfie y cuenta el intento bajo bloqueo (nunca más de 3). Revisión humana; sin biometría. */
export async function completeSelfieUpload(ctx: TrustContext, userId: string, intentId: string, requestId: string) {
  if (!UUID_RE.test(intentId)) throw trustError("UPLOAD_INTENT_NOT_FOUND", "No existe esa subida.", 404);
  const intent = await loadIntent(ctx.pool, userId, intentId, ["identity_selfie"]);
  if (intent.completed_at) return getPrivateCheckState(ctx, userId); // idempotente
  const object = await verifyUploadedObject(ctx, intent);

  const client = await ctx.pool.connect();
  try {
    await client.query("begin");
    await client.query(`insert into trust_identity_checks(user_id) values($1) on conflict (user_id) do nothing`, [userId]);
    const lock = await client.query<CheckRow>(
      `select state, attempts_used, reason_code, updated_at from trust_identity_checks where user_id = $1 for update`,
      [userId]
    );
    const check = lock.rows[0] ?? null;
    const done = await client.query(`select completed_at from trust_upload_intents where id = $1 for update`, [intentId]);
    if (done.rows[0]?.completed_at) {
      await client.query("commit");
      return getPrivateCheckState(ctx, userId);
    }
    const consent = await hasAcceptedLatest(client, userId, "private_check_notice");
    const verified = (await client.query<{ identity_status: string }>(`select identity_status from profiles where user_id = $1`, [userId])).rows[0];
    guardSelfie(check, consent.accepted, verified?.identity_status === "verified");

    const attemptNo = (check?.attempts_used ?? 0) + 1;
    const inserted = await client.query<{ id: string }>(
      `insert into trust_identity_check_attempts(
         user_id, attempt_no, intent_id, storage_provider, storage_key, content_type, size_bytes, sha256, notice_document_id)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [userId, attemptNo, intentId, object.storageProvider, object.storageKey, object.contentType, object.sizeBytes, object.sha256, consent.latest?.id ?? null]
    );
    await client.query(
      `update trust_identity_checks
          set state = 'in_review', attempts_used = $2, reason_code = null, reason_note = null,
              decided_by_user_id = null, decided_at = null, updated_at = now()
        where user_id = $1`,
      [userId, attemptNo]
    );
    await markIntentCompleted(client, intentId);
    await writeAudit(client, {
      actorUserId: userId,
      action: "identity_check.attempt_submitted",
      entityType: "identity_check_attempt",
      entityId: inserted.rows[0]?.id ?? null,
      requestId,
      metadata: { attemptNo, noticeVersion: consent.latest?.version ?? null }
    });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return getPrivateCheckState(ctx, userId);
}

/**
 * Decisión del personal sobre la selfie en revisión (dentro de la transacción del llamante).
 *  approved → completed (NO verifica la identidad) · rejected → rejected (queda la alternativa del documento)
 *  needs_retry → needs_retry; si ya se usaron los 3 intentos → rejected con MAX_ATTEMPTS_REACHED.
 */
export async function decideIdentityCheck(
  client: PoolClient,
  input: {
    userId: string;
    reviewerId: string;
    decision: "approved" | "rejected" | "needs_retry";
    reasonCode: string | null;
    reason: string | null;
  }
): Promise<{ attemptId: string; resultingState: PrivateCheckStateName }> {
  const lock = await client.query<CheckRow>(
    `select state, attempts_used, reason_code, updated_at from trust_identity_checks where user_id = $1 for update`,
    [input.userId]
  );
  const check = lock.rows[0];
  if (!check || check.state !== "in_review") throw trustError("NOTHING_TO_REVIEW", "No hay entregas pendientes de este elemento.", 409);
  const attemptQ = await client.query<{ id: string }>(
    `select id from trust_identity_check_attempts where user_id = $1 and status = 'in_review' order by attempt_no desc limit 1 for update`,
    [input.userId]
  );
  const attempt = attemptQ.rows[0];
  if (!attempt) throw trustError("NOTHING_TO_REVIEW", "No hay entregas pendientes de este elemento.", 409);

  let attemptStatus: "accepted" | "needs_retry" | "rejected";
  let state: PrivateCheckStateName;
  let reasonCode: string | null = null;
  if (input.decision === "approved") {
    attemptStatus = "accepted";
    state = "completed";
  } else if (input.decision === "rejected") {
    attemptStatus = "rejected";
    state = "rejected";
    reasonCode = input.reasonCode && isCheckRejectReason(input.reasonCode) ? input.reasonCode : "OTHER";
  } else if (check.attempts_used >= MAX_SELFIE_ATTEMPTS) {
    attemptStatus = "rejected";
    state = "rejected";
    reasonCode = "MAX_ATTEMPTS_REACHED";
  } else {
    attemptStatus = "needs_retry";
    state = "needs_retry";
    reasonCode = input.reasonCode && isCheckRetryReason(input.reasonCode) ? input.reasonCode : "FACE_OUT_OF_FRAME";
  }

  await client.query(
    `update trust_identity_check_attempts
        set status = $2, reason_code = $3, reason_note = $4, decided_by_user_id = $5, decided_at = now()
      where id = $1`,
    [attempt.id, attemptStatus, reasonCode, input.reason, input.reviewerId]
  );
  await client.query(
    `update trust_identity_checks
        set state = $2, reason_code = $3, reason_note = $4, decided_by_user_id = $5, decided_at = now(), updated_at = now()
      where user_id = $1`,
    [input.userId, state, reasonCode, input.reason, input.reviewerId]
  );

  if (state === "completed") {
    await notify(client, {
      userId: input.userId,
      category: "system",
      kind: "identity_check_completed",
      title: "Comprobación privada completada",
      body: "Hemos revisado tu captura. Esta comprobación no sustituye a la verificación de identidad con documento.",
      data: { item: "private_check" }
    });
  } else {
    const view = checkReasonView(state, reasonCode);
    await notify(client, {
      userId: input.userId,
      category: "system",
      kind: state === "needs_retry" ? "identity_check_retry" : "identity_check_rejected",
      title: view.title ?? "Comprobación privada",
      body: view.message,
      data: { item: "private_check", state }
    });
  }
  return { attemptId: attempt.id, resultingState: state };
}
