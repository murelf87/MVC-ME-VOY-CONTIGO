/**
 * Autenticación por teléfono (OTP por SMS) y sesiones opacas. Contrato: docs/AUTH.md.
 *
 *   POST /v1/auth/phone/start   → 202 { challengeId, expiresAt }
 *   POST /v1/auth/phone/verify  → 200 { token, expiresAt, user }
 *   GET  /v1/auth/session       → 200 { user, session }
 *   POST /v1/auth/logout        → 204
 *
 * Estas funciones NO tocan la sesión de la app: guardar el token es cosa de `useAuth().signIn(payload)`.
 */
import { apiRequest, type RequestOptions } from "../client";
import type { Role, SessionInfo, SessionPayload, VerificationStart } from "../types";

/** Opciones de red que aceptan todas las funciones de `endpoints/*` (y, por convención, las de cada slice). */
export type CallOptions = Pick<RequestOptions, "signal" | "timeoutMs" | "retries">;

/** Pide el código SMS. Sin `roles` el backend asume solo pasajero. */
export function startPhoneVerification(
  input: { phone: string; roles?: Role[] },
  options: CallOptions = {}
): Promise<VerificationStart> {
  return apiRequest<VerificationStart>("/v1/auth/phone/start", {
    method: "POST",
    token: null,
    body: input,
    ...options,
  });
}

/**
 * Comprueba el código. Un código incorrecto devuelve ApiError 401 `AUTH_CODE_INVALID_OR_EXPIRED`
 * (NO es una sesión caducada: va sin token).
 */
export function verifyPhoneCode(
  input: { challengeId: string; code: string },
  options: CallOptions = {}
): Promise<SessionPayload> {
  return apiRequest<SessionPayload>("/v1/auth/phone/verify", {
    method: "POST",
    token: null,
    body: input,
    ...options,
  });
}

/** Valida un token contra el servidor. Con `token` explícito no emite el evento de sesión caducada. */
export function fetchAuthSession(
  options: CallOptions & { token?: string } = {}
): Promise<SessionInfo> {
  const { token, ...rest } = options;
  return apiRequest<SessionInfo>("/v1/auth/session", {
    ...(token ? { token, authExpiry: "ignore" as const } : {}),
    ...rest,
  });
}

/** Revoca el token en el servidor. */
export function logoutSession(token: string, options: CallOptions = {}): Promise<void> {
  return apiRequest<void>("/v1/auth/logout", {
    method: "POST",
    token,
    authExpiry: "ignore",
    ...options,
  });
}
