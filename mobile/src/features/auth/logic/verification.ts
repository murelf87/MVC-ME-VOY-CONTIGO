/**
 * Estados de pantalla derivados de lo que devuelve el servidor (`GET /v1/me/verification`, `/photo`, `/identity-check`).
 * Regla de producto: JAMÁS se muestra «aprobada» una foto que no lo está, ni «completada» una comprobación que no lo está;
 * la selfie nunca verifica la identidad por sí sola. Puro: se prueba en Node.
 */
import type {
  PrivateCheckState,
  PrivateCheckStateName,
  ProfilePhotoState,
  TrustDocumentSubmission,
  TrustIdentityState,
  TrustReason,
} from "@/api/types/trust";
import { authStrings } from "../strings";

export type PhotoPhase = "none" | "in_review" | "approved" | "rejected";

export interface PhotoView {
  phase: PhotoPhase;
  /** Hay una foto aprobada visible y, además, una nueva esperando revisión. */
  replacementInReview: boolean;
  /** Motivo de rechazo de la última entrega (solo si `phase === "rejected"`). */
  reason: TrustReason | null;
  /** Vista previa firmada de SU foto más reciente, si el servidor la da. */
  previewUrl: string | null;
  /** Foto visible para otros usuarios (solo con foto aprobada). */
  publicUrl: string | null;
  uploadAvailable: boolean;
}

export function derivePhotoView(state: ProfilePhotoState): PhotoView {
  const latest = state.latest;
  const phase: PhotoPhase = state.state;
  return {
    phase,
    replacementInReview: phase === "approved" && latest !== null && latest.status === "in_review",
    reason: phase === "rejected" ? (latest?.reason ?? null) : null,
    previewUrl: latest?.previewUrl ?? null,
    publicUrl: phase === "approved" ? state.publicPhotoUrl : null,
    uploadAvailable: state.uploadAvailable,
  };
}

/** Los tres tramos de la franja de la lámina 08. */
export type StripStep = "in_review" | "retry" | "completed";

/** Tramo activo de la franja «En revisión · Repetir · Completada». `null` si no corresponde ninguno (sin empezar / rechazada). */
export function activeStripStep(state: PrivateCheckStateName): StripStep | null {
  switch (state) {
    case "in_review":
      return "in_review";
    case "needs_retry":
      return "retry";
    case "completed":
      return "completed";
    case "not_started":
    case "rejected":
      return null;
  }
}

export interface CheckView {
  state: PrivateCheckStateName;
  step: StripStep | null;
  attemptsLabel: string;
  used: number;
  max: number;
  remaining: number;
  /** Título y texto del motivo (reintento o rechazo). */
  reasonTitle: string | null;
  reasonMessage: string | null;
  /** ¿Se puede hacer otra captura con la cámara ahora mismo? */
  canCapture: boolean;
  /** «Otra forma de verificar» disponible (documento). */
  canUseAlternative: boolean;
  consentAccepted: boolean;
  noticeVersion: number | null;
  noticeLegallyReviewed: boolean;
  previewUrl: string | null;
  uploadAvailable: boolean;
}

/** Título de rechazo por defecto del servidor cuando se agotan los intentos. */
const MAX_ATTEMPTS_TITLE = "Has agotado los intentos";

export function deriveCheckView(state: PrivateCheckState): CheckView {
  const reason = state.reason;
  const title =
    reason === null
      ? null
      : (reason.title ?? (reason.code === "MAX_ATTEMPTS_REACHED" ? MAX_ATTEMPTS_TITLE : state.state === "needs_retry" ? authStrings.check.retryTitle : authStrings.status.rejectedFallbackTitle));
  return {
    state: state.state,
    step: activeStripStep(state.state),
    attemptsLabel: authStrings.check.attempts(state.attempts.used, state.attempts.max),
    used: state.attempts.used,
    max: state.attempts.max,
    remaining: state.attempts.remaining,
    reasonTitle: title,
    reasonMessage: reason?.message ?? null,
    canCapture: state.nextAction === "capture" || state.nextAction === "retry_capture" || state.nextAction === "accept_notice",
    canUseAlternative: state.canUseAlternative,
    consentAccepted: state.consent.accepted,
    noticeVersion: state.consent.noticeVersion,
    noticeLegallyReviewed: state.consent.noticeLegallyReviewed,
    previewUrl: state.lastAttempt?.previewUrl ?? null,
    uploadAvailable: state.uploadAvailable,
  };
}

/** Último documento de identidad entregado (el más reciente primero). */
export function latestIdentityDocument(identity: TrustIdentityState): TrustDocumentSubmission | null {
  return identity.documents[0] ?? null;
}

export type DocumentPhase = "none" | "in_review" | "approved" | "rejected";

export function documentPhase(identity: TrustIdentityState): DocumentPhase {
  if (identity.status === "verified") return "approved";
  const latest = latestIdentityDocument(identity);
  if (latest === null) return "none";
  if (latest.status === "approved") return "approved";
  return latest.status;
}
