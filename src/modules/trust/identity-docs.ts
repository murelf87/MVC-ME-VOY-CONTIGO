import type { AuthPrincipal } from "../../auth/session.js";
import { registerVerifiedPrivateDocument } from "../../documents/document-service.js";
import { UUID_RE, isoOrNull, trustError } from "./common.js";
import type { Db, TrustContext } from "./context.js";
import { getPrivateCheckState } from "./identity-check.js";
import { documentReasonView } from "./reasons.js";
import { createUploadIntent, loadIntent, markIntentCompleted, requireStorage, storageAvailable, verifyUploadedObject } from "./uploads.js";

export type DocumentKind = "identity_document" | "driver_license";

type DocRow = {
  id: string;
  kind: DocumentKind;
  review_status: "pending" | "approved" | "rejected";
  review_reason: string | null;
  created_at: Date;
  reviewed_at: Date | null;
};

export function toDocumentSubmission(row: DocRow) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.review_status === "pending" ? ("in_review" as const) : row.review_status,
    submittedAt: row.created_at.toISOString(),
    decidedAt: isoOrNull(row.reviewed_at),
    reason: row.review_status === "rejected" ? documentReasonView(row.review_reason) : null
  };
}

/** Estado de identidad y documentos del usuario (alternativa a la selfie y permiso de conducir). */
export async function getIdentityState(ctx: TrustContext, userId: string, roles: readonly string[]) {
  const [profile, docs, license] = await Promise.all([
    ctx.pool.query<{ identity_status: "unverified" | "pending" | "verified" | "rejected" }>(
      `select identity_status from profiles where user_id = $1`,
      [userId]
    ),
    ctx.pool.query<DocRow>(
      `select id, kind, review_status, review_reason, created_at, reviewed_at
         from private_documents
        where owner_user_id = $1 and kind = 'identity_document'
        order by created_at desc, id desc limit 5`,
      [userId]
    ),
    ctx.pool.query<DocRow>(
      `select id, kind, review_status, review_reason, created_at, reviewed_at
         from private_documents
        where owner_user_id = $1 and kind = 'driver_license'
        order by created_at desc, id desc limit 1`,
      [userId]
    )
  ]);
  const status = profile.rows[0]?.identity_status ?? "unverified";
  const licenseRow = license.rows[0];
  return {
    status,
    verifiedBy: status === "verified" ? ("identity_document" as const) : null,
    documents: docs.rows.map(toDocumentSubmission),
    driverLicense: roles.includes("driver") && licenseRow ? toDocumentSubmission(licenseRow) : null,
    uploadAvailable: storageAvailable(ctx)
  };
}

async function pendingDocument(db: Db, userId: string, kind: DocumentKind): Promise<boolean> {
  const found = await db.query(
    `select 1 from private_documents where owner_user_id = $1 and kind = $2 and review_status = 'pending' limit 1`,
    [userId, kind]
  );
  return Boolean(found.rowCount);
}

async function assertDocumentAllowed(db: Db, principal: AuthPrincipal, kind: DocumentKind): Promise<void> {
  if (kind === "driver_license" && !principal.roles.includes("driver")) {
    throw trustError("DRIVER_ROLE_REQUIRED", "El permiso de conducir solo lo aportan las personas conductoras.", 403);
  }
  if (kind === "identity_document") {
    const profile = await db.query<{ identity_status: string }>(`select identity_status from profiles where user_id = $1`, [principal.userId]);
    if (profile.rows[0]?.identity_status === "verified") {
      throw trustError("IDENTITY_ALREADY_VERIFIED", "Tu identidad ya está verificada.", 409);
    }
  }
  if (await pendingDocument(db, principal.userId, kind)) {
    throw trustError("DOCUMENT_IN_REVIEW", "Ya tienes un documento de este tipo en revisión. Te avisaremos cuando terminemos.", 409);
  }
}

export async function createDocumentUploadIntent(
  ctx: TrustContext,
  principal: AuthPrincipal,
  input: { kind: DocumentKind; contentType: string; sizeBytes: number }
) {
  requireStorage(ctx);
  await assertDocumentAllowed(ctx.pool, principal, input.kind);
  return createUploadIntent(ctx, principal.userId, input.kind, { contentType: input.contentType, sizeBytes: input.sizeBytes });
}

/** Registra el documento con el servicio existente (private_documents) y lo deja en revisión humana. */
export async function completeDocumentUpload(ctx: TrustContext, principal: AuthPrincipal, intentId: string, roles: readonly string[]) {
  if (!UUID_RE.test(intentId)) throw trustError("UPLOAD_INTENT_NOT_FOUND", "No existe esa subida.", 404);
  const intent = await loadIntent(ctx.pool, principal.userId, intentId, ["identity_document", "driver_license"]);
  const kind = intent.purpose as DocumentKind;

  let row: DocRow | undefined;
  if (intent.completed_at) {
    row = (
      await ctx.pool.query<DocRow>(
        `select id, kind, review_status, review_reason, created_at, reviewed_at
           from private_documents where storage_provider = $1 and storage_key = $2`,
        [intent.storage_provider, intent.storage_key]
      )
    ).rows[0];
  }
  if (!row) {
    if (!intent.completed_at) {
      // Reglas vigentes ahora mismo (pudieron cambiar desde que se pidió la subida).
      await assertDocumentAllowed(ctx.pool, principal, kind);
    }
    const object = await verifyUploadedObject(ctx, intent);
    try {
      const registered = await registerVerifiedPrivateDocument(ctx.pool, principal, { kind, object });
      row = {
        id: registered.id,
        kind,
        review_status: registered.review_status,
        review_reason: null,
        created_at: registered.created_at,
        reviewed_at: null
      };
    } catch (error) {
      if ((error as { code?: string }).code !== "23505") throw error;
      row = (
        await ctx.pool.query<DocRow>(
          `select id, kind, review_status, review_reason, created_at, reviewed_at
             from private_documents where storage_provider = $1 and storage_key = $2`,
          [intent.storage_provider, intent.storage_key]
        )
      ).rows[0];
    }
    await markIntentCompleted(ctx.pool, intentId);
  }
  if (!row) throw trustError("UPLOAD_OBJECT_MISSING", "No se ha podido registrar el documento. Vuelve a intentarlo.", 409);
  return {
    document: toDocumentSubmission(row),
    privateCheck: await getPrivateCheckState(ctx, principal.userId),
    identity: await getIdentityState(ctx, principal.userId, roles)
  };
}
