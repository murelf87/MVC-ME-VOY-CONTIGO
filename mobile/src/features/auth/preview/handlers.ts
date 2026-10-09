/**
 * Backend en memoria de la vista previa para el slice `auth`: verificación de la persona (roles, foto, comprobación
 * privada, documentos de identidad) y documentos legales. Contrato: `docs/contracts/trust.md` §4.1–§4.2.
 *
 * SIMULACIÓN: solo se carga con `EXPO_PUBLIC_PREVIEW=1`. El inicio de sesión por SMS lo sirve el núcleo
 * (`src/preview/handlers/auth.ts`). Los archivos subidos quedan en el almacén simulado en memoria.
 */
import type { LegalDocumentKind, TrustUploadIntent } from "@/api/types/trust";
import { ApiFailure, addRole, iso, reply, sha256Hex, signedUrl, writeAudit, uuidParam } from "@/preview";
import type { PreviewDb, PreviewProfileId, PreviewRouter } from "@/preview";
import { reviewTables, type EvidenceRow, type ReviewItemRow } from "../../admin/preview/reviewWorld/store";
import { currentDocument, seedAccountAcceptances, seedLegalDocuments, trustTables, type TrustUploadPurpose, type TrustUploadRow } from "./trustStore";
import { MAX_CHECK_ATTEMPTS, identityState, photoState, privateCheckState, selfRoles, storageProvider, uploadAvailable, verificationOverview } from "./trustViews";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const DOCUMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const IMAGE_MAX = 10 * 1024 * 1024;
const DOCUMENT_MAX = 20 * 1024 * 1024;
const INTENT_TTL_MS = 10 * 60_000;
const UPLOADS_PER_DAY = 20;
const KINDS: readonly LegalDocumentKind[] = ["terms", "privacy", "cancellation", "private_check_notice"];

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf" };

function summaryOf(row: NonNullable<ReturnType<typeof currentDocument>>) {
  return {
    id: row.id,
    kind: row.kind,
    version: row.version,
    status: row.status,
    title: row.title,
    locale: "es-ES" as const,
    legallyEffective: row.status === "published",
    pendingLegalReview: row.status === "draft_pending_legal_review",
    effectiveFrom: iso(row.effective_from),
    publishedAt: iso(row.published_at),
    contentSha256: row.content_sha256,
  };
}

function legalNotFound(): never {
  throw new ApiFailure("LEGAL_DOCUMENT_NOT_FOUND", "Legal document not found", 404);
}

function kindOf(raw: string): LegalDocumentKind {
  if (!KINDS.includes(raw as LegalDocumentKind)) legalNotFound();
  return raw as LegalDocumentKind;
}

function createIntent(
  db: PreviewDb,
  userId: string,
  purpose: TrustUploadPurpose,
  input: { contentType: string; sizeBytes: number },
  allowed: readonly string[],
  maxBytes: number,
): TrustUploadIntent {
  if (!uploadAvailable(db)) throw new ApiFailure("PRIVATE_STORAGE_DISABLED", "Private storage is not configured", 503);
  if (!allowed.includes(input.contentType)) {
    throw new ApiFailure("UPLOAD_TYPE_NOT_ALLOWED", "File type is not allowed", 422, { allowedContentTypes: [...allowed] });
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > maxBytes) {
    throw new ApiFailure("UPLOAD_SIZE_INVALID", "File size is not valid", 422, { maxSizeBytes: maxBytes });
  }
  const { uploads } = trustTables(db);
  const since = db.nowMs() - 86_400_000;
  if (uploads.filter((u) => u.owner_user_id === userId && u.created_at >= since).length >= UPLOADS_PER_DAY) {
    throw new ApiFailure("UPLOAD_RATE_LIMITED", "Too many upload intents", 429);
  }
  const id = db.ids.uuid();
  const key = `users/${userId}/${purpose}/${id}.${EXT[input.contentType] ?? "bin"}`;
  const expiresAt = db.nowMs() + INTENT_TTL_MS;
  uploads.insert({ id, owner_user_id: userId, purpose, storage_key: key, content_type: input.contentType, expected_size_bytes: input.sizeBytes, expires_at: expiresAt, completed_at: null, created_at: db.nowMs() });
  return {
    intentId: id,
    uploadUrl: signedUrl("upload", key, expiresAt),
    method: "PUT",
    headers: { "content-type": input.contentType },
    expiresAt: iso(expiresAt) ?? "",
    maxSizeBytes: maxBytes,
    allowedContentTypes: [...allowed],
  };
}

/** Comprueba la subida (objeto, tamaño, tipo) y la marca como completada. Devuelve la fila y el SHA-256. */
function verifyUpload(db: PreviewDb, userId: string, intentId: string, purposes: readonly TrustUploadPurpose[]): { intent: Readonly<TrustUploadRow>; sha256: string; size: number } {
  if (!uploadAvailable(db)) throw new ApiFailure("PRIVATE_STORAGE_DISABLED", "Private storage is not configured", 503);
  const { uploads } = trustTables(db);
  const intent = uploads.get(intentId);
  if (intent === undefined || intent.owner_user_id !== userId || !purposes.includes(intent.purpose)) {
    throw new ApiFailure("UPLOAD_INTENT_NOT_FOUND", "Upload intent not found", 404);
  }
  if (intent.completed_at !== null) throw new ApiFailure("UPLOAD_INTENT_NOT_FOUND", "Upload intent already used", 404);
  if (intent.expires_at < db.nowMs()) throw new ApiFailure("UPLOAD_INTENT_EXPIRED", "Upload intent has expired", 410);
  const blob = db.blobs.get(intent.storage_key);
  if (blob === undefined) throw new ApiFailure("UPLOAD_OBJECT_MISSING", "Uploaded object not found", 409);
  const bytes = blob.bytes ?? new Uint8Array(blob.sizeBytes);
  if (bytes.byteLength !== intent.expected_size_bytes) throw new ApiFailure("UPLOAD_SIZE_MISMATCH", "Uploaded file size does not match", 422);
  if (blob.contentType && blob.contentType.split(";")[0] !== intent.content_type) throw new ApiFailure("UPLOAD_TYPE_MISMATCH", "Uploaded file type does not match", 422);
  return { intent, sha256: sha256Hex(bytes), size: bytes.byteLength };
}

function upsertItem(db: PreviewDb, userId: string, key: "profile_photo" | "private_check", evidence: EvidenceRow, supersede: boolean): void {
  const items = reviewTables(db).items;
  const id = `${userId}:${key}`;
  const now = db.nowMs();
  const existing = items.get(id);
  const previous = (existing?.evidence ?? []).map((e) => (supersede && e.status === "in_review" ? { ...e, status: "superseded" } : e));
  const row: ReviewItemRow = {
    id,
    user_id: userId,
    key,
    state: "in_review",
    submitted_at: now,
    decided_at: null,
    decided_by: null,
    reason: null,
    reason_code: null,
    evidence: [...previous, evidence],
  };
  if (existing === undefined) items.insert(row);
  else items.update(id, row);
}

export function registerPreview(r: PreviewRouter, db: PreviewDb): void {
  const intentBody = {
    type: "object",
    required: ["contentType", "sizeBytes"],
    properties: { contentType: { type: "string" }, sizeBytes: { type: "integer" } },
  } as const;

  // ── Verificación ─────────────────────────────────────────────────────────────────────────────────────────────────
  r.get("/v1/me/verification", { summary: "Estado de verificación (agregado)", tags: ["trust"] }, (req) => verificationOverview(db, req.auth().userId));

  r.put<{ Body: { roles: string[] } }>(
    "/v1/me/roles",
    {
      summary: "Elegir rol",
      tags: ["trust"],
      schema: { body: { type: "object", additionalProperties: false, required: ["roles"], properties: { roles: { type: "array", items: { type: "string" } } } } },
    },
    (req) => {
      const me = req.auth();
      const wanted = [...new Set(req.body.roles)];
      if (wanted.length === 0 || wanted.some((role) => role !== "passenger" && role !== "driver")) {
        throw new ApiFailure("ROLES_INVALID", "Select passenger, driver, or both", 422);
      }
      const current = selfRoles(db, me.userId);
      if (current.includes("driver") && !wanted.includes("driver")) {
        const busy = db.trips.filter((t) => t.driver_user_id === me.userId && (t.status === "active"));
        if (busy.length > 0) throw new ApiFailure("ROLE_IN_USE", "You still have open trips as a driver", 409);
      }
      db.tx(() => {
        for (const role of wanted) addRole(db, me.userId, role as "passenger" | "driver");
        for (const role of current) if (!wanted.includes(role)) db.userRoles.delete(`${me.userId}:${role}`);
        writeAudit(db, { actorUserId: me.userId, action: "me.roles.updated", entityType: "user", entityId: me.userId, requestId: req.requestId, metadata: { roles: wanted } });
      });
      return { roles: selfRoles(db, me.userId) };
    },
  );

  // ── Foto de perfil ───────────────────────────────────────────────────────────────────────────────────────────────
  r.get("/v1/me/photo", { summary: "Foto de perfil", tags: ["trust"] }, (req) => photoState(db, req.auth().userId));

  r.post<{ Body: { contentType: string; sizeBytes: number } }>(
    "/v1/me/photo/upload-intents",
    { summary: "Pedir subida de la foto", tags: ["trust"], schema: { body: intentBody } },
    (req) => reply.created(createIntent(db, req.auth().userId, "profile_photo", req.body, IMAGE_TYPES, IMAGE_MAX)),
  );

  r.post<{ Params: { intentId: string } }>(
    "/v1/me/photo/upload-intents/:intentId/complete",
    { summary: "Confirmar la foto", tags: ["trust"], schema: { params: uuidParam("intentId") } },
    (req) => {
      const me = req.auth();
      const { intent, size } = verifyUpload(db, me.userId, req.params.intentId, ["profile_photo"]);
      db.tx(() => {
        const evidence: EvidenceRow = { id: db.ids.uuid(), kind: "profile_photo", label: "Foto de perfil", content_type: intent.content_type, size_bytes: size, submitted_at: db.nowMs(), status: "in_review", storage_key: intent.storage_key };
        upsertItem(db, me.userId, "profile_photo", evidence, true);
        trustTables(db).uploads.update(intent.id, { completed_at: db.nowMs() });
        const profile = db.profiles.get(me.userId);
        if (profile !== undefined && profile.public_photo_status !== "approved") {
          db.profiles.update(me.userId, { public_photo_key: intent.storage_key, public_photo_status: "pending", updated_at: db.nowMs() });
        }
        writeAudit(db, { actorUserId: me.userId, action: "profile_photo.submitted", entityType: "profile_photo", entityId: evidence.id, requestId: req.requestId });
      });
      return photoState(db, me.userId);
    },
  );

  // ── Comprobación privada ─────────────────────────────────────────────────────────────────────────────────────────
  r.get("/v1/me/identity-check", { summary: "Estado de la comprobación privada", tags: ["trust"] }, (req) => privateCheckState(db, req.auth().userId));

  const checkGuard = (userId: string): void => {
    const state = privateCheckState(db, userId);
    if (!state.consent.accepted) throw new ApiFailure("PRIVATE_CHECK_CONSENT_REQUIRED", "Accept the private check notice first", 409);
    const row = reviewTables(db).items.get(`${userId}:private_check`);
    if (row?.state === "approved") throw new ApiFailure("PRIVATE_CHECK_ALREADY_COMPLETED", "Private check already completed", 409);
    if (row?.state === "in_review") throw new ApiFailure("PRIVATE_CHECK_IN_REVIEW", "Private check is in review", 409);
    if (row?.state === "rejected") throw new ApiFailure("PRIVATE_CHECK_REJECTED", "Private check was rejected", 409);
    if (state.attempts.used >= MAX_CHECK_ATTEMPTS) throw new ApiFailure("PRIVATE_CHECK_MAX_ATTEMPTS_REACHED", "No attempts left", 409);
  };

  r.post<{ Body: { contentType: string; sizeBytes: number } }>(
    "/v1/me/identity-check/upload-intents",
    { summary: "Pedir subida de la selfie", tags: ["trust"], schema: { body: intentBody } },
    (req) => {
      const me = req.auth();
      checkGuard(me.userId);
      return reply.created(createIntent(db, me.userId, "identity_selfie", req.body, IMAGE_TYPES, IMAGE_MAX));
    },
  );

  r.post<{ Params: { intentId: string } }>(
    "/v1/me/identity-check/upload-intents/:intentId/complete",
    { summary: "Confirmar la selfie", tags: ["trust"], schema: { params: uuidParam("intentId") } },
    (req) => {
      const me = req.auth();
      checkGuard(me.userId);
      const { intent, size } = verifyUpload(db, me.userId, req.params.intentId, ["identity_selfie"]);
      db.tx(() => {
        const evidence: EvidenceRow = { id: db.ids.uuid(), kind: "identity_selfie", label: "Captura de la comprobación", content_type: intent.content_type, size_bytes: size, submitted_at: db.nowMs(), status: "in_review", storage_key: intent.storage_key };
        upsertItem(db, me.userId, "private_check", evidence, true);
        trustTables(db).uploads.update(intent.id, { completed_at: db.nowMs() });
        writeAudit(db, { actorUserId: me.userId, action: "identity_check.submitted", entityType: "identity_check_attempt", entityId: evidence.id, requestId: req.requestId });
      });
      return privateCheckState(db, me.userId);
    },
  );

  // ── Documentos de identidad / permiso ────────────────────────────────────────────────────────────────────────────
  r.post<{ Body: { kind: "identity_document" | "driver_license"; contentType: string; sizeBytes: number } }>(
    "/v1/me/identity/documents/upload-intents",
    {
      summary: "Pedir subida de un documento",
      tags: ["trust"],
      schema: {
        body: {
          type: "object",
          required: ["kind", "contentType", "sizeBytes"],
          properties: { kind: { type: "string", enum: ["identity_document", "driver_license"] }, contentType: { type: "string" }, sizeBytes: { type: "integer" } },
        },
      },
    },
    (req) => {
      const me = req.auth();
      const kind = req.body.kind;
      if (kind === "driver_license" && !selfRoles(db, me.userId).includes("driver")) throw new ApiFailure("DRIVER_ROLE_REQUIRED", "Driver role required", 403);
      if (kind === "identity_document" && db.profiles.get(me.userId)?.identity_status === "verified") throw new ApiFailure("IDENTITY_ALREADY_VERIFIED", "Identity already verified", 409);
      if (db.documents.filter((d) => d.owner_user_id === me.userId && d.kind === kind && d.review_status === "pending").length > 0) {
        throw new ApiFailure("DOCUMENT_IN_REVIEW", "A document of this kind is already in review", 409);
      }
      return reply.created(createIntent(db, me.userId, kind, req.body, DOCUMENT_TYPES, DOCUMENT_MAX));
    },
  );

  r.post<{ Params: { intentId: string } }>(
    "/v1/me/identity/documents/upload-intents/:intentId/complete",
    { summary: "Confirmar el documento", tags: ["trust"], schema: { params: uuidParam("intentId") } },
    (req) => {
      const me = req.auth();
      const { intent, sha256, size } = verifyUpload(db, me.userId, req.params.intentId, ["identity_document", "driver_license"]);
      const kind = intent.purpose === "driver_license" ? "driver_license" : "identity_document";
      const document = db.tx(() => {
        const now = db.nowMs();
        const row = db.documents.insert({
          id: db.ids.uuid(),
          owner_user_id: me.userId,
          vehicle_id: null,
          kind,
          storage_provider: storageProvider(),
          storage_key: intent.storage_key,
          content_type: intent.content_type,
          size_bytes: size,
          sha256,
          review_status: "pending",
          review_reason: null,
          reviewed_by_user_id: null,
          reviewed_at: null,
          analysis_status: "not_required",
          detected_expires_on: null,
          verified_expires_on: null,
          analysis_confidence: null,
          analyzer_provider: null,
          analyzer_reference: null,
          analyzed_at: null,
          expiry_verification_source: null,
          created_at: now,
          updated_at: now,
        });
        if (kind === "identity_document") db.profiles.update(me.userId, { identity_status: "pending", updated_at: now });
        trustTables(db).uploads.update(intent.id, { completed_at: now });
        writeAudit(db, { actorUserId: me.userId, action: "private_document.registered", entityType: "private_document", entityId: row.id, requestId: req.requestId, metadata: { kind } });
        return row;
      });
      const identity = identityState(db, me.userId);
      const submitted = kind === "driver_license" ? identity.driverLicense : identity.documents.find((d) => d.id === document.id);
      return { document: submitted, privateCheck: privateCheckState(db, me.userId), identity };
    },
  );

  // ── Legal ────────────────────────────────────────────────────────────────────────────────────────────────────────
  r.get("/v1/legal/documents", { summary: "Últimas versiones legales", tags: ["legal"] }, () => ({
    items: KINDS.flatMap((kind) => {
      const doc = currentDocument(db, kind);
      return doc === undefined ? [] : [summaryOf(doc)];
    }),
  }));

  r.get<{ Params: { kind: string } }>("/v1/legal/documents/:kind", { summary: "Versión vigente", tags: ["legal"] }, (req) => {
    const doc = currentDocument(db, kindOf(req.params.kind));
    if (doc === undefined) return legalNotFound();
    return { ...summaryOf(doc), sections: doc.sections };
  });

  r.get<{ Params: { kind: string; version: number } }>(
    "/v1/legal/documents/:kind/versions/:version",
    { summary: "Una versión concreta", tags: ["legal"], schema: { params: { type: "object", properties: { kind: { type: "string" }, version: { type: "integer", minimum: 1 } } } } },
    (req) => {
      const kind = kindOf(req.params.kind);
      const doc = trustTables(db).legalDocuments.find((d) => d.kind === kind && d.version === Number(req.params.version));
      if (doc === undefined) return legalNotFound();
      return { ...summaryOf(doc), sections: doc.sections };
    },
  );

  r.get("/v1/me/legal/status", { summary: "Qué falta por aceptar", tags: ["legal"] }, (req) => {
    const me = req.auth();
    const { acceptances } = trustTables(db);
    const items = KINDS.flatMap((kind) => {
      const doc = currentDocument(db, kind);
      if (doc === undefined) return [];
      const mine = acceptances.filter((a) => a.user_id === me.userId && a.kind === kind && a.version === doc.version).sort((a, b) => b.accepted_at - a.accepted_at)[0];
      return [
        {
          kind,
          latestVersion: doc.version,
          status: doc.status,
          pendingLegalReview: doc.status === "draft_pending_legal_review",
          scope: doc.scope,
          accepted: mine !== undefined,
          acceptedVersion: mine?.version ?? null,
          acceptedAt: iso(mine?.accepted_at ?? null),
        },
      ];
    });
    return { items, accountDocumentsAccepted: items.filter((i) => i.scope === "account").every((i) => i.accepted) };
  });

  r.get("/v1/me/legal/acceptances", { summary: "Historial de aceptaciones", tags: ["legal"] }, (req) => {
    const me = req.auth();
    const items = trustTables(db)
      .acceptances.filter((a) => a.user_id === me.userId)
      .sort((a, b) => b.accepted_at - a.accepted_at)
      .map((a) => ({
        id: a.id,
        documentId: a.document_id,
        kind: a.kind,
        version: a.version,
        context: a.context,
        acceptedAt: iso(a.accepted_at),
        legallyEffective: trustTables(db).legalDocuments.get(a.document_id)?.status === "published",
      }));
    return { items };
  });

  r.post<{ Body: { kind: string; version: number; context?: string } }>(
    "/v1/me/legal/acceptances",
    {
      summary: "Aceptar una versión",
      tags: ["legal"],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "version"],
          properties: { kind: { type: "string" }, version: { type: "integer", minimum: 1 }, context: { type: "string", enum: ["registration", "account", "booking", "private_check", "other"] } },
        },
      },
    },
    (req) => {
      const me = req.auth();
      const kind = kindOf(req.body.kind);
      const doc = trustTables(db).legalDocuments.find((d) => d.kind === kind && d.version === req.body.version);
      if (doc === undefined) return legalNotFound();
      if (doc.status === "retired") throw new ApiFailure("LEGAL_DOCUMENT_RETIRED", "Legal document retired", 409);
      const latest = currentDocument(db, kind);
      if (latest !== undefined && latest.version !== doc.version) throw new ApiFailure("LEGAL_VERSION_OUTDATED", "A newer version is available", 409, { latestVersion: latest.version });
      const { acceptances } = trustTables(db);
      const existing = acceptances.find((a) => a.user_id === me.userId && a.document_id === doc.id);
      const row =
        existing ??
        acceptances.insert({
          id: db.ids.uuid(),
          user_id: me.userId,
          document_id: doc.id,
          kind,
          version: doc.version,
          context: (req.body.context ?? "other") as "registration" | "account" | "booking" | "private_check" | "other",
          accepted_at: db.nowMs(),
        });
      const body = { id: row.id, documentId: doc.id, kind, version: doc.version, context: row.context, acceptedAt: iso(row.accepted_at), legallyEffective: doc.status === "published" };
      return existing !== undefined ? body : reply.created(body);
    },
  );
}

export function seedSlice(db: PreviewDb, _profile: PreviewProfileId, _seed: string): void {
  seedLegalDocuments(db);
  seedAccountAcceptances(db);
}
