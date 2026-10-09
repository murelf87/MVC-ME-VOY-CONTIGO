/**
 * Reglas del código por SMS (lámina 04): cuenta atrás de reenvío, caducidad, intentos máximos y traducción de los
 * errores de `POST /v1/auth/phone/{start,verify}` a estados de pantalla. Puro: se prueba en Node.
 *
 * Valores del backend (docs/AUTH.md y `src/config.ts`): el código caduca a los 600 s, el reenvío se bloquea 60 s y se
 * admiten 5 comprobaciones por desafío. La respuesta de «iniciar» solo trae `expiresAt`, así que el instante de envío es
 * `expiresAt − 600 s`.
 */
import { describeError, isApiError, isOfflineError, isTimeoutError, type ErrorDescription } from "@/api/errors";
import { authStrings } from "../strings";

export const CHALLENGE_TTL_SECONDS = 600;
export const RESEND_COOLDOWN_SECONDS = 60;
export const MAX_CHECK_ATTEMPTS = 5;
export const CODE_LENGTH = 6;

/** Instante (ms) en que se envió el código, deducido de su caducidad. `null` si la fecha no es válida. */
export function sentAtMs(expiresAtIso: string): number | null {
  const expires = Date.parse(expiresAtIso);
  return Number.isFinite(expires) ? expires - CHALLENGE_TTL_SECONDS * 1000 : null;
}

/** Segundos que faltan para poder pedir otro código (0 = ya se puede). */
export function resendRemainingSeconds(sentAt: number | null, nowMs: number): number {
  if (sentAt === null) return 0;
  const remaining = Math.ceil((sentAt + RESEND_COOLDOWN_SECONDS * 1000 - nowMs) / 1000);
  return Math.max(0, Math.min(RESEND_COOLDOWN_SECONDS, remaining));
}

export function isChallengeExpired(expiresAtIso: string, nowMs: number): boolean {
  const expires = Date.parse(expiresAtIso);
  return Number.isFinite(expires) && expires <= nowMs;
}

/** Solo dígitos, como máximo `CODE_LENGTH`. */
export function sanitizeCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, CODE_LENGTH);
}

export function isCompleteCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

export type VerifyFailureKind =
  | "wrong_code"
  | "expired"
  | "too_many_attempts"
  | "challenge_gone"
  | "account_inactive"
  | "offline"
  | "timeout"
  | "server"
  | "unknown";

export interface VerifyFailure {
  kind: VerifyFailureKind;
  message: string;
  /** Tras este fallo hay que pedir un código nuevo (el actual ya no sirve). */
  needsNewCode: boolean;
  /** Reintentar el mismo código/acción puede funcionar (red, tiempo, servidor). */
  retryable: boolean;
  /** Intentos que quedan con este código (solo si se conocen: fallo de código incorrecto). */
  attemptsLeft: number | null;
}

/** Traduce un error de `verifyPhoneCode` a un estado de pantalla. `failedAttempts` cuenta este fallo si fue de código. */
export function classifyVerifyError(error: unknown, context: { expiresAtIso: string; nowMs: number; failedAttempts: number }): VerifyFailure {
  const copy = authStrings.verify;
  if (isOfflineError(error)) return { kind: "offline", message: describeError(error).message, needsNewCode: false, retryable: true, attemptsLeft: null };
  if (isTimeoutError(error)) return { kind: "timeout", message: describeError(error).message, needsNewCode: false, retryable: true, attemptsLeft: null };
  if (isApiError(error)) {
    switch (error.code) {
      case "AUTH_CODE_INVALID_OR_EXPIRED":
      case "INVALID_VERIFICATION_CODE": {
        if (isChallengeExpired(context.expiresAtIso, context.nowMs)) {
          return { kind: "expired", message: copy.expiredCode, needsNewCode: true, retryable: false, attemptsLeft: null };
        }
        const left = Math.max(0, MAX_CHECK_ATTEMPTS - context.failedAttempts);
        if (left === 0) {
          return { kind: "too_many_attempts", message: copy.tooManyAttempts, needsNewCode: true, retryable: false, attemptsLeft: 0 };
        }
        return { kind: "wrong_code", message: copy.wrongCode, needsNewCode: false, retryable: false, attemptsLeft: left };
      }
      case "AUTH_TOO_MANY_ATTEMPTS":
        return { kind: "too_many_attempts", message: copy.tooManyAttempts, needsNewCode: true, retryable: false, attemptsLeft: 0 };
      case "AUTH_CHALLENGE_NOT_FOUND":
      case "AUTH_CHALLENGE_NOT_READY":
      case "AUTH_CHALLENGE_NOT_APPROVED":
      case "AUTH_CHALLENGE_ALREADY_USED":
      case "AUTH_PROVIDER_MISMATCH":
        return { kind: "challenge_gone", message: copy.challengeGone, needsNewCode: true, retryable: false, attemptsLeft: null };
      case "ACCOUNT_NOT_ACTIVE":
        return { kind: "account_inactive", message: copy.accountInactive, needsNewCode: false, retryable: false, attemptsLeft: null };
      default: {
        const described: ErrorDescription = describeError(error);
        return {
          kind: described.retryable ? "server" : "unknown",
          message: described.message,
          needsNewCode: false,
          retryable: described.retryable,
          attemptsLeft: null,
        };
      }
    }
  }
  return { kind: "unknown", message: describeError(error).message, needsNewCode: false, retryable: true, attemptsLeft: null };
}

export type StartFailureKind =
  | "resend_too_soon"
  | "rate_limited"
  | "sms_unavailable"
  | "invalid_phone"
  | "invalid_roles"
  | "offline"
  | "timeout"
  | "server"
  | "unknown";

export interface StartFailure {
  kind: StartFailureKind;
  title: string;
  message: string;
  /** Segundos que sugiere el servidor esperar (`Retry-After`), si los hay. */
  retryAfterSeconds: number | null;
  retryable: boolean;
}

/** Traduce un error de `startPhoneVerification` («Recibir código» / «Reenviar código»). */
export function classifyStartError(error: unknown): StartFailure {
  const described = describeError(error);
  const base = { title: described.title, message: described.message, retryAfterSeconds: null, retryable: described.retryable };
  if (isOfflineError(error)) return { ...base, kind: "offline" };
  if (isTimeoutError(error)) return { ...base, kind: "timeout" };
  if (isApiError(error)) {
    const retryAfter = typeof error.retryAfterS === "number" && error.retryAfterS > 0 ? error.retryAfterS : null;
    switch (error.code) {
      case "AUTH_RESEND_TOO_SOON":
        return { ...base, kind: "resend_too_soon", message: authStrings.create.resendTooSoon, retryAfterSeconds: retryAfter ?? RESEND_COOLDOWN_SECONDS, retryable: true };
      case "SMS_RATE_LIMITED":
      case "RATE_LIMITED":
        return { ...base, kind: "rate_limited", retryAfterSeconds: retryAfter, retryable: true };
      case "SMS_PROVIDER_UNAVAILABLE":
      case "SMS_PROVIDER_BAD_RESPONSE":
        return { ...base, kind: "sms_unavailable", title: authStrings.create.smsUnavailableTitle, message: authStrings.create.smsUnavailable, retryAfterSeconds: retryAfter, retryable: true };
      case "INVALID_PHONE_E164":
        return { ...base, kind: "invalid_phone" };
      case "INVALID_SELF_SERVICE_ROLES":
        return { ...base, kind: "invalid_roles" };
      default:
        return { ...base, kind: described.retryable ? "server" : "unknown" };
    }
  }
  return { ...base, kind: "unknown" };
}
