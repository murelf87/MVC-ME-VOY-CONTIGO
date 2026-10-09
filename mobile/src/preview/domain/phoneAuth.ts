/**
 * Verificación por teléfono (SMS) → sesión. Replica `src/auth/service.ts` paso a paso:
 *  - `/v1/auth/phone/start`: cooldown de reenvío, desafío en estado dispatching → pending.
 *  - `/v1/auth/phone/verify`: intentos máximos, caducidad, aprobación del proveedor, alta/ingreso del usuario.
 * El proveedor de SMS es SIMULADO (`providers/sms.ts`).
 */
import { createSession, rolesOf } from "../core/auth";
import type { PreviewDb } from "../core/db";
import { ApiFailure } from "../core/errors";
import { iso } from "../core/wire";
import { checkVerification, SMS_PROVIDER_NAME, startVerification } from "../providers/sms";
import { writeAudit } from "./audit";
import { addRole, ensureProfile, normalizeE164, normalizeRequestedRoles } from "./users";
import type { AnyRoleDto } from "./wire";

export interface AuthServiceConfig {
  challengeTtlSeconds: number;
  sessionTtlSeconds: number;
  maxCheckAttempts: number;
  resendCooldownSeconds: number;
}

/** Valores por defecto del backend (`src/config.ts`). */
export const DEFAULT_AUTH_CONFIG: AuthServiceConfig = {
  challengeTtlSeconds: 600,
  sessionTtlSeconds: 2_592_000,
  maxCheckAttempts: 5,
  resendCooldownSeconds: 60,
};

export function beginPhoneVerification(
  db: PreviewDb,
  input: { phone: string; roles?: unknown },
  config: AuthServiceConfig = DEFAULT_AUTH_CONFIG
): { challengeId: string; expiresAt: string } {
  const phone = normalizeE164(input.phone);
  const roles = normalizeRequestedRoles(input.roles);
  const now = db.nowMs();

  const recent = db.challenges.find(
    (row) =>
      row.phone_e164 === phone &&
      (row.status === "dispatching" || row.status === "pending" || row.status === "provider_approved") &&
      row.requested_at > now - config.resendCooldownSeconds * 1000
  );
  if (recent) throw new ApiFailure("AUTH_RESEND_TOO_SOON", "Wait before requesting another verification code", 429);

  const challenge = db.challenges.insert({
    id: db.ids.uuid(),
    phone_e164: phone,
    requested_roles: roles,
    provider: SMS_PROVIDER_NAME,
    provider_challenge_id: null,
    provider_status: null,
    status: "dispatching",
    check_attempts: 0,
    expires_at: now + config.challengeTtlSeconds * 1000,
    requested_at: now,
    verified_at: null,
    provider_approved_at: null,
    updated_at: now,
  });

  try {
    const started = startVerification(db, phone);
    db.challenges.update(challenge.id, {
      provider_challenge_id: started.providerChallengeId,
      provider_status: started.providerStatus,
      status: "pending",
      updated_at: db.nowMs(),
    });
    writeAudit(db, {
      actorUserId: null,
      action: "auth.challenge.started",
      entityType: "auth_challenge",
      entityId: challenge.id,
      metadata: { provider: SMS_PROVIDER_NAME, roles },
    });
  } catch (error) {
    db.challenges.update(challenge.id, { status: "failed", updated_at: db.nowMs() });
    throw error;
  }

  return { challengeId: challenge.id, expiresAt: iso(challenge.expires_at) as string };
}

function finalizeApprovedChallenge(
  db: PreviewDb,
  challengeId: string,
  sessionTtlSeconds: number
): { token: string; expiresAt: string; user: { id: string; roles: AnyRoleDto[] } } {
  return db.tx(() => {
    const challenge = db.challenges.get(challengeId);
    if (!challenge) throw new ApiFailure("AUTH_CHALLENGE_NOT_FOUND", "Verification challenge not found", 404);
    if (challenge.status !== "provider_approved") {
      throw new ApiFailure("AUTH_CHALLENGE_NOT_APPROVED", "Verification challenge is not approved", 409);
    }

    const now = db.nowMs();
    let user = db.users.find((row) => row.phone_e164 === challenge.phone_e164);
    if (user) {
      user = db.users.update(user.id, { updated_at: now });
    } else {
      user = db.users.insert({
        id: db.ids.uuid(),
        phone_e164: challenge.phone_e164,
        status: "active",
        created_at: now,
        updated_at: now,
      });
    }
    if (user.status !== "active") throw new ApiFailure("ACCOUNT_NOT_ACTIVE", "Account is not active", 403);

    ensureProfile(db, user.id);
    for (const role of challenge.requested_roles) addRole(db, user.id, role, now);

    const session = createSession(db, user.id, { ttlSeconds: sessionTtlSeconds });
    db.challenges.update(challengeId, { status: "verified", verified_at: now, updated_at: now });
    writeAudit(db, {
      actorUserId: user.id,
      action: "auth.login",
      entityType: "auth_session",
      entityId: session.sessionId,
      metadata: { provider: challenge.provider },
    });

    // El backend real devuelve los roles SOLICITADOS (no los de la base): se replica.
    return {
      token: session.token,
      expiresAt: session.expiresAt,
      user: { id: user.id, roles: [...challenge.requested_roles] },
    };
  });
}

export function verifyPhoneCode(
  db: PreviewDb,
  input: { challengeId: string; code: string },
  config: AuthServiceConfig = DEFAULT_AUTH_CONFIG
): { token: string; expiresAt: string; user: { id: string; roles: AnyRoleDto[] } } {
  // --- prepareVerification ---
  const challenge = db.challenges.get(input.challengeId);
  if (!challenge) throw new ApiFailure("AUTH_CHALLENGE_NOT_FOUND", "Verification challenge not found", 404);
  if (challenge.status === "provider_approved") {
    return finalizeApprovedChallenge(db, input.challengeId, config.sessionTtlSeconds);
  }
  if (challenge.status === "verified") {
    throw new ApiFailure("AUTH_CHALLENGE_ALREADY_USED", "Verification challenge has already been used", 409);
  }
  if (challenge.expires_at <= db.nowMs()) {
    db.challenges.update(challenge.id, { status: "expired", updated_at: db.nowMs() });
    throw new ApiFailure("AUTH_CODE_INVALID_OR_EXPIRED", "Verification code is invalid or expired", 401);
  }
  if (challenge.status !== "pending" || !challenge.provider_challenge_id) {
    throw new ApiFailure("AUTH_CHALLENGE_NOT_READY", "Verification challenge is not ready", 409);
  }
  if (challenge.check_attempts >= config.maxCheckAttempts) {
    throw new ApiFailure("AUTH_TOO_MANY_ATTEMPTS", "Too many verification attempts", 429);
  }
  db.challenges.update(challenge.id, { check_attempts: challenge.check_attempts + 1, updated_at: db.nowMs() });

  if (challenge.provider !== SMS_PROVIDER_NAME) {
    throw new ApiFailure("AUTH_PROVIDER_MISMATCH", "Verification provider mismatch", 409);
  }

  const checked = checkVerification(db, challenge.provider_challenge_id, input.code);
  if (!checked.approved) {
    db.challenges.update(challenge.id, { provider_status: checked.providerStatus, updated_at: db.nowMs() });
    throw new ApiFailure("AUTH_CODE_INVALID_OR_EXPIRED", "Verification code is invalid or expired", 401);
  }

  db.challenges.update(challenge.id, {
    status: "provider_approved",
    provider_status: checked.providerStatus,
    provider_approved_at: db.nowMs(),
    updated_at: db.nowMs(),
  });
  return finalizeApprovedChallenge(db, input.challengeId, config.sessionTtlSeconds);
}

/** Roles de un usuario en el formato del cable. */
export function sessionRoles(db: PreviewDb, userId: string): AnyRoleDto[] {
  return rolesOf(db, userId);
}
