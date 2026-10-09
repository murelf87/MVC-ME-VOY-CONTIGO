/**
 * Sesiones opacas simuladas. Replica `src/auth/session.ts` del backend:
 *  - token `mvc_sess_<43 caracteres base64url>`; en base solo se guarda su SHA-256.
 *  - errores y códigos HTTP idénticos (AUTH_REQUIRED, AUTH_INVALID, AUTH_INVALID_OR_EXPIRED, ACCOUNT_NOT_ACTIVE,
 *    AUTH_FORBIDDEN).
 */
import { ApiFailure } from "./errors";
import type { PreviewDb } from "./db";
import { base64Url, sha256Bytes, sha256Hex, utf8Encode } from "./sha256";
import type { Principal, UserRole } from "./types";

export const SESSION_TOKEN_PREFIX = "mvc_sess_";
export const DEFAULT_SESSION_TTL_SECONDS = 2_592_000; // 30 días, como AUTH_SESSION_TTL_SECONDS por defecto

export function hashSessionToken(token: string): string {
  return sha256Hex(token);
}

export function readBearerToken(authorization: string | undefined): string {
  if (!authorization) throw new ApiFailure("AUTH_REQUIRED", "Authentication required", 401);
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  const token = match?.[1];
  if (!token || !token.startsWith(SESSION_TOKEN_PREFIX)) {
    throw new ApiFailure("AUTH_INVALID", "Invalid authentication token", 401);
  }
  return token;
}

/** Token estable derivado de un nombre: la sesión de un perfil de prueba sobrevive a reinicios del mundo. */
export function deterministicSessionToken(key: string): string {
  return `${SESSION_TOKEN_PREFIX}${base64Url(sha256Bytes(utf8Encode(`mvc-preview-session:${key}`)))}`;
}

/**
 * Roles de un usuario en el orden en que se le concedieron. El backend real hace `array_agg(role)` sin `ORDER BY`, así
 * que su orden no está garantizado; en la práctica es el de alta (registrarse con `["driver","passenger"]` devuelve
 * `["driver","passenger"]`), que es lo que se replica.
 */
export function rolesOf(db: PreviewDb, userId: string): UserRole[] {
  const roles: UserRole[] = [];
  for (const row of db.userRoles.filter((r) => r.user_id === userId)) {
    if (!roles.includes(row.role)) roles.push(row.role);
  }
  return roles;
}

export function createSession(
  db: PreviewDb,
  userId: string,
  options: { ttlSeconds?: number; token?: string } = {}
): { sessionId: string; token: string; expiresAt: string } {
  const token = options.token ?? db.ids.sessionToken();
  const now = db.nowMs();
  const expires = now + (options.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS) * 1000;
  const row = db.sessions.insert({
    id: db.ids.uuid(),
    user_id: userId,
    token_hash: hashSessionToken(token),
    expires_at: expires,
    revoked_at: null,
    last_seen_at: now,
    created_at: now,
  });
  return { sessionId: row.id, token, expiresAt: new Date(expires).toISOString() };
}

export function resolveSession(db: PreviewDb, token: string): Principal {
  const hash = hashSessionToken(token);
  const session = db.sessions.find((row) => row.token_hash === hash);
  const now = db.nowMs();
  if (!session || session.revoked_at !== null || session.expires_at <= now) {
    throw new ApiFailure("AUTH_INVALID_OR_EXPIRED", "Session is invalid or expired", 401);
  }
  const user = db.users.get(session.user_id);
  if (!user) throw new ApiFailure("AUTH_INVALID_OR_EXPIRED", "Session is invalid or expired", 401);
  if (user.status !== "active") throw new ApiFailure("ACCOUNT_NOT_ACTIVE", "Account is not active", 403);
  if (now - session.last_seen_at > 15 * 60_000) db.sessions.update(session.id, { last_seen_at: now });
  return {
    sessionId: session.id,
    userId: session.user_id,
    roles: rolesOf(db, session.user_id),
    expiresAt: new Date(session.expires_at).toISOString(),
  };
}

export function revokeSession(db: PreviewDb, token: string): void {
  const hash = hashSessionToken(token);
  const session = db.sessions.find((row) => row.token_hash === hash);
  if (session && session.revoked_at === null) db.sessions.update(session.id, { revoked_at: db.nowMs() });
}

export function requireAnyRole(principal: Principal, allowed: readonly UserRole[]): void {
  if (!principal.roles.some((role) => allowed.includes(role))) {
    throw new ApiFailure("AUTH_FORBIDDEN", "Insufficient permissions", 403);
  }
}
