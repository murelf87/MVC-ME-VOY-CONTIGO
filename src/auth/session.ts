import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DomainError } from "../errors.js";
import type { SelfServiceRole } from "./phone.js";

export type UserRole = SelfServiceRole | "admin" | "verification_admin" | "finance_admin" | "support_admin";

export type AuthPrincipal = {
  sessionId: string;
  userId: string;
  roles: UserRole[];
  expiresAt: string;
};

export function createRawSessionToken(): string {
  return `mvc_sess_${randomBytes(32).toString("base64url")}`;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function readBearerToken(authorization: string | undefined): string {
  if (!authorization) throw new DomainError("AUTH_REQUIRED", "Authentication required", 401);
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!match?.[1] || !match[1].startsWith("mvc_sess_")) {
    throw new DomainError("AUTH_INVALID", "Invalid authentication token", 401);
  }
  return match[1];
}

export async function createSession(
  client: PoolClient,
  userId: string,
  ttlSeconds: number
): Promise<{ sessionId: string; token: string; expiresAt: string }> {
  const token = createRawSessionToken();
  const tokenHash = hashSessionToken(token);
  const result = await client.query<{ id: string; expires_at: Date }>(
    `insert into auth_sessions(user_id,token_hash,expires_at)
     values($1,$2,now() + ($3 || ' seconds')::interval)
     returning id,expires_at`,
    [userId, tokenHash, ttlSeconds]
  );
  const row = result.rows[0];
  if (!row) throw new Error("session insert returned no row");
  return { sessionId: row.id, token, expiresAt: row.expires_at.toISOString() };
}

export async function resolveSession(pool: Pool, token: string): Promise<AuthPrincipal> {
  const tokenHash = hashSessionToken(token);
  const result = await pool.query<{
    session_id: string;
    user_id: string;
    expires_at: Date;
    user_status: string;
    roles: UserRole[];
  }>(
    `select s.id as session_id,
            s.user_id,
            s.expires_at,
            u.status as user_status,
            coalesce(array_agg(ur.role::text order by ur.role::text) filter (where ur.role is not null),'{}'::text[]) as roles
       from auth_sessions s
       join app_users u on u.id=s.user_id
       left join user_roles ur on ur.user_id=u.id
      where s.token_hash=$1
        and s.revoked_at is null
        and s.expires_at > now()
      group by s.id,s.user_id,s.expires_at,u.status`,
    [tokenHash]
  );

  const row = result.rows[0];
  if (!row) throw new DomainError("AUTH_INVALID_OR_EXPIRED", "Session is invalid or expired", 401);
  if (row.user_status !== "active") {
    throw new DomainError("ACCOUNT_NOT_ACTIVE", "Account is not active", 403);
  }

  void pool.query(
    `update auth_sessions set last_seen_at=now()
      where id=$1 and last_seen_at < now()-interval '15 minutes'`,
    [row.session_id]
  ).catch(() => undefined);

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    roles: row.roles,
    expiresAt: row.expires_at.toISOString()
  };
}

export async function revokeSession(pool: Pool, token: string): Promise<void> {
  await pool.query(
    `update auth_sessions set revoked_at=coalesce(revoked_at,now()) where token_hash=$1`,
    [hashSessionToken(token)]
  );
}

export function requireAnyRole(principal: AuthPrincipal, allowed: readonly UserRole[]): void {
  if (!principal.roles.some(role => allowed.includes(role))) {
    throw new DomainError("AUTH_FORBIDDEN", "Insufficient permissions", 403);
  }
}
