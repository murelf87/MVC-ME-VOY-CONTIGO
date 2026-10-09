/**
 * Estado de verificación visto por la propia persona (`GET /v1/me/verification` y derivados). Se calcula siempre a
 * partir de lo que el panel de administración también lee: `trust_review_items` (foto, comprobación privada),
 * `private_documents` (identidad, permiso), `profiles` y las aceptaciones legales. Así lo que decida el personal se ve aquí.
 */
import type {
  LegalDocumentKind,
  PrivateCheckAttempt,
  PrivateCheckState,
  ProfilePhotoState,
  TrustDocumentSubmission,
  TrustIdentityState,
  TrustPhotoSubmission,
  TrustReason,
  TrustReasonCode,
  TrustVerificationOverview,
} from "@/api/types/trust";
import type { PreviewDb } from "@/preview";
import { STORAGE_PROVIDER_NAME, iso } from "@/preview";
import { reviewTables, type EvidenceRow, type ReviewItemRow } from "../../admin/preview/reviewWorld/store";
import { currentDocument, trustTables } from "./trustStore";

export const MAX_CHECK_ATTEMPTS = 3;
export const SETTING_UPLOAD_DISABLED = "auth.trust.uploadDisabled";

export function uploadAvailable(db: PreviewDb): boolean {
  return db.getSetting(SETTING_UPLOAD_DISABLED) !== true;
}

const PHOTO_MESSAGES: Record<string, string> = {
  FACE_NOT_VISIBLE: "No se ve tu rostro con claridad.",
  SUNGLASSES_OR_COVERING: "Llevas gafas de sol o el rostro tapado.",
  MULTIPLE_PEOPLE: "Aparece más de una persona en la foto.",
  LOW_QUALITY: "La foto tiene poca calidad.",
  NOT_A_PERSON: "La imagen no muestra a una persona.",
  INAPPROPRIATE_CONTENT: "La imagen no es adecuada para un perfil.",
  OTHER: "No hemos podido aprobar esta foto.",
};
const CHECK_RETRY_MESSAGES: Record<string, string> = {
  FACE_OUT_OF_FRAME: "El rostro está fuera del marco o no se ve con claridad.",
  LOW_LIGHT: "Hay poca luz. Busca un sitio más iluminado.",
  IMAGE_BLURRY: "La imagen sale borrosa. Mantén quieto el móvil.",
  FACE_COVERED: "El rostro está tapado. Quita gafas de sol o mascarilla.",
  MULTIPLE_PEOPLE: "Aparece más de una persona en la captura.",
};
const CHECK_REJECT_TEXT = "No hemos podido completar la comprobación con foto. Puedes verificar tu identidad aportando un documento.";

function sortNewest<T extends { submitted_at: number }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => b.submitted_at - a.submitted_at);
}

/** Vista previa firmada de SU propia captura: en la simulación es un `data:` URL con los bytes subidos (hermético). */
export function ownPreviewUrl(db: PreviewDb, storageKey: string): string | null {
  const blob = db.blobs.get(storageKey);
  if (blob?.bytes === null || blob?.bytes === undefined) return null;
  let binary = "";
  const bytes = blob.bytes;
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] ?? 0);
  if (typeof btoa !== "function") return null;
  return `data:${blob.contentType || "image/jpeg"};base64,${btoa(binary)}`;
}

function previewExpiry(db: PreviewDb): string {
  return iso(db.nowMs() + 5 * 60_000) ?? "";
}

// ── Foto de perfil ───────────────────────────────────────────────────────────────────────────────────────────────

function photoReason(row: Readonly<ReviewItemRow>): TrustReason | null {
  if (row.state !== "rejected") return null;
  const code = (row.reason_code ?? "OTHER") as TrustReasonCode;
  return { code, title: "No hemos podido aprobar tu foto", message: row.reason !== null && row.reason !== "" ? row.reason : (PHOTO_MESSAGES[code] ?? PHOTO_MESSAGES.OTHER ?? "") };
}

function photoSubmission(db: PreviewDb, row: Readonly<ReviewItemRow>, evidence: EvidenceRow): TrustPhotoSubmission {
  const status = evidence.status === "approved" ? "approved" : evidence.status === "rejected" ? "rejected" : evidence.status === "superseded" ? "superseded" : "in_review";
  const decided = status === "approved" || status === "rejected";
  const previewUrl = uploadAvailable(db) ? ownPreviewUrl(db, evidence.storage_key) : null;
  return {
    id: evidence.id,
    status,
    submittedAt: iso(evidence.submitted_at) ?? "",
    decidedAt: decided ? iso(row.decided_at) : null,
    reason: status === "rejected" ? photoReason(row) : null,
    previewUrl,
    previewExpiresAt: previewUrl !== null ? previewExpiry(db) : null,
  };
}

export function photoState(db: PreviewDb, userId: string): ProfilePhotoState {
  const profile = db.profiles.get(userId);
  const row = reviewTables(db).items.get(`${userId}:profile_photo`);
  const latestEvidence = row !== undefined ? sortNewest(row.evidence)[0] : undefined;
  const latest = row !== undefined && latestEvidence !== undefined ? photoSubmission(db, row, latestEvidence) : null;
  const approved = profile?.public_photo_status === "approved" && profile.public_photo_key !== null;
  const state: ProfilePhotoState["state"] = approved ? "approved" : row === undefined ? "none" : row.state === "rejected" ? "rejected" : row.state === "approved" ? "approved" : "in_review";
  let publicPhotoUrl: string | null = null;
  if (approved && profile?.public_photo_key) {
    publicPhotoUrl = profile.public_photo_key.startsWith("preview-asset://") ? profile.public_photo_key : ownPreviewUrl(db, profile.public_photo_key);
  }
  return { state, required: true, publicPhotoUrl, latest, uploadAvailable: uploadAvailable(db) };
}

// ── Comprobación privada ─────────────────────────────────────────────────────────────────────────────────────────

function consentOf(db: PreviewDb, userId: string): PrivateCheckState["consent"] {
  const doc = currentDocument(db, "private_check_notice");
  const accepted = doc === undefined ? undefined : trustTables(db).acceptances.find((a) => a.user_id === userId && a.kind === "private_check_notice" && a.version === doc.version);
  return {
    noticeKind: "private_check_notice",
    noticeVersion: doc?.version ?? null,
    accepted: accepted !== undefined,
    acceptedAt: accepted !== undefined ? iso(accepted.accepted_at) : null,
    noticeLegallyReviewed: doc?.status === "published",
  };
}

function attemptOf(db: PreviewDb, evidence: EvidenceRow, index: number, decidedAt: number | null): PrivateCheckAttempt {
  const status = evidence.status === "accepted" ? "accepted" : evidence.status === "needs_retry" ? "needs_retry" : evidence.status === "rejected" ? "rejected" : evidence.status === "superseded" ? "superseded" : "in_review";
  const previewUrl = uploadAvailable(db) ? ownPreviewUrl(db, evidence.storage_key) : null;
  return {
    id: evidence.id,
    attemptNo: index,
    status,
    submittedAt: iso(evidence.submitted_at) ?? "",
    decidedAt: status === "in_review" ? null : iso(decidedAt),
    previewUrl,
    previewExpiresAt: previewUrl !== null ? previewExpiry(db) : null,
  };
}

function identityDocs(db: PreviewDb, userId: string, kind: "identity_document" | "driver_license") {
  return db.documents.filter((d) => d.owner_user_id === userId && d.kind === kind).sort((a, b) => b.created_at - a.created_at);
}

export function privateCheckState(db: PreviewDb, userId: string): PrivateCheckState {
  const row = reviewTables(db).items.get(`${userId}:private_check`);
  const consent = consentOf(db, userId);
  const evidence = row !== undefined ? [...row.evidence].sort((a, b) => a.submitted_at - b.submitted_at) : [];
  const used = evidence.length;
  const profile = db.profiles.get(userId);
  const docInReview = identityDocs(db, userId, "identity_document").find((d) => d.review_status === "pending");
  const identityVerified = profile?.identity_status === "verified";
  const attempts = { used, max: MAX_CHECK_ATTEMPTS, remaining: Math.max(0, MAX_CHECK_ATTEMPTS - used) };
  const last = evidence.length > 0 ? attemptOf(db, evidence[evidence.length - 1] as EvidenceRow, used, row?.decided_at ?? null) : null;
  const base = {
    attempts,
    canUseAlternative: !identityVerified,
    consent,
    lastAttempt: last,
    review: "human" as const,
    biometricMatching: "not_activated" as const,
    selfieAloneVerifiesIdentity: false as const,
    uploadAvailable: uploadAvailable(db),
    updatedAt: iso(row?.decided_at ?? row?.submitted_at ?? null),
  };

  let state: PrivateCheckState["state"] = "not_started";
  let method: PrivateCheckState["method"] = used > 0 ? "selfie" : null;
  let reason: TrustReason | null = null;
  let nextAction: PrivateCheckState["nextAction"] = consent.accepted ? "capture" : "accept_notice";

  if (row?.state === "approved") {
    state = "completed";
    nextAction = "none";
  } else if (row?.state === "rejected") {
    state = "rejected";
    nextAction = "use_alternative";
    reason = { code: (row.reason_code ?? "OTHER") as TrustReasonCode, title: "No hemos podido completar la comprobación", message: CHECK_REJECT_TEXT };
  } else if (row?.state === "needs_retry") {
    if (used >= MAX_CHECK_ATTEMPTS) {
      state = "rejected";
      nextAction = "use_alternative";
      reason = { code: "MAX_ATTEMPTS_REACHED", title: "Has agotado los intentos", message: "Has usado los 3 intentos con foto. Puedes verificar tu identidad aportando un documento." };
    } else {
      state = "needs_retry";
      nextAction = "retry_capture";
      const code = (row.reason_code ?? "FACE_OUT_OF_FRAME") as TrustReasonCode;
      reason = { code, title: "Necesitamos otra captura", message: CHECK_RETRY_MESSAGES[code] ?? CHECK_RETRY_MESSAGES.FACE_OUT_OF_FRAME ?? "" };
    }
  } else if (row?.state === "in_review") {
    state = "in_review";
    nextAction = "wait_review";
  }

  if (docInReview !== undefined && state !== "completed") {
    state = "in_review";
    method = "identity_document";
    nextAction = "wait_review";
    reason = null;
  }
  return { state, method, reason, nextAction, ...base };
}

// ── Identidad ────────────────────────────────────────────────────────────────────────────────────────────────────

function documentSubmission(row: ReturnType<typeof identityDocs>[number], kind: "identity_document" | "driver_license"): TrustDocumentSubmission {
  const status = row.review_status === "pending" ? "in_review" : row.review_status === "approved" ? "approved" : "rejected";
  return {
    id: row.id,
    kind,
    status,
    submittedAt: iso(row.created_at) ?? "",
    decidedAt: status === "in_review" ? null : iso(row.reviewed_at),
    reason: status === "rejected" ? { code: "DOCUMENT_REVIEW_REJECTED", title: "Documento no válido", message: row.review_reason ?? "No hemos podido aceptar el documento." } : null,
  };
}

export function identityState(db: PreviewDb, userId: string): TrustIdentityState {
  const profile = db.profiles.get(userId);
  const docs = identityDocs(db, userId, "identity_document").map((d) => documentSubmission(d, "identity_document"));
  const license = identityDocs(db, userId, "driver_license")[0];
  const status = profile?.identity_status ?? "unverified";
  return {
    status: status === "verified" ? "verified" : status === "pending" ? "pending" : status === "rejected" ? "rejected" : "unverified",
    verifiedBy: status === "verified" ? "identity_document" : null,
    documents: docs,
    driverLicense: license !== undefined ? documentSubmission(license, "driver_license") : null,
    uploadAvailable: uploadAvailable(db),
  };
}

export function selfRoles(db: PreviewDb, userId: string): Array<"passenger" | "driver"> {
  const roles = db.userRoles.filter((r) => r.user_id === userId).map((r) => r.role);
  return (["passenger", "driver"] as const).filter((role) => roles.includes(role));
}

export function verificationOverview(db: PreviewDb, userId: string): TrustVerificationOverview {
  return { roles: selfRoles(db, userId), photo: photoState(db, userId), privateCheck: privateCheckState(db, userId), identity: identityState(db, userId) };
}

export function storageProvider(): string {
  return STORAGE_PROVIDER_NAME;
}

export type { LegalDocumentKind };
