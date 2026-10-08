import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DomainError } from "../errors.js";
import type { EmailProvider } from "../email/provider.js";
import {
  assertPasswordPolicy, burnPasswordCheck, hashPassword, normalizeEmail, verifyPassword
} from "./credentials.js";
import { normalizeRequestedRoles, type SelfServiceRole } from "./roles.js";
import { createSession } from "./session.js";

export type AuthServiceConfig = {
  sessionTtlSeconds: number;
  /** Failed passwords in a row before the account pauses sign-in. */
  maxFailedLogins: number;
  lockMinutes: number;
  codeTtlSeconds: number;
  resendCooldownSeconds: number;
};

type SessionResult = { token: string; expiresAt: string; user: { id: string; roles: string[]; email: string; emailVerified: boolean } };
type Purpose = "verify_email" | "reset_password";

async function tx<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const value = await fn(client);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

const codeHash = (salt: string, code: string) => crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");

async function openSession(client: PoolClient, userId: string, ttl: number, action: string): Promise<SessionResult> {
  const session = await createSession(client, userId, ttl);
  const u = (await client.query(`
    select u.email,u.email_verified_at,
           coalesce(array_agg(r.role::text order by r.role::text) filter (where r.role is not null),'{}') as roles
      from app_users u left join user_roles r on r.user_id=u.id where u.id=$1 group by u.id`, [userId])).rows[0];
  await client.query(`
    insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
    values($1,$2,'auth_session',$3,'{"method":"password"}'::jsonb)`, [userId, action, session.sessionId]);
  return {
    token: session.token, expiresAt: session.expiresAt,
    user: { id: userId, roles: u.roles, email: u.email, emailVerified: Boolean(u.email_verified_at) }
  };
}

/** Issues a fresh code (older open ones stop working) and returns it for the caller to email after commit. */
async function issueCode(client: PoolClient, userId: string, purpose: Purpose, config: AuthServiceConfig): Promise<string | null> {
  const recent = await client.query(`
    select 1 from auth_email_codes where user_id=$1 and purpose=$2 and used_at is null
       and created_at > now() - make_interval(secs=>$3)`, [userId, purpose, config.resendCooldownSeconds]);
  if (recent.rowCount) return null;
  await client.query(`update auth_email_codes set used_at=now() where user_id=$1 and purpose=$2 and used_at is null`, [userId, purpose]);
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  const salt = crypto.randomBytes(16).toString("base64url");
  await client.query(`
    insert into auth_email_codes(user_id,purpose,salt,code_hash,expires_at)
    values($1,$2,$3,$4,now()+make_interval(secs=>$5))`, [userId, purpose, salt, codeHash(salt, code), config.codeTtlSeconds]);
  return code;
}

function codeEmail(to: string, purpose: Purpose, code: string, minutes: number) {
  return purpose === "verify_email"
    ? { to, subject: "Confirma tu correo en MVC", text: `Tu código para confirmar el correo es ${code}. Caduca en ${minutes} minutos.` }
    : { to, subject: "Cambia tu contraseña de MVC", text: `Tu código para cambiar la contraseña es ${code}. Caduca en ${minutes} minutos. Si no lo has pedido tú, ignora este correo.` };
}

/** Checks a code; wrong codes count against it and a used or expired code never works twice. */
async function consumeCode(client: PoolClient, userId: string, purpose: Purpose, code: string): Promise<void> {
  const row = (await client.query(`
    select id,salt,code_hash,attempts,max_attempts,expires_at from auth_email_codes
     where user_id=$1 and purpose=$2 and used_at is null order by created_at desc limit 1 for update`, [userId, purpose])).rows[0];
  if (!row || new Date(row.expires_at) <= new Date() || row.attempts >= row.max_attempts) {
    throw new DomainError("AUTH_CODE_INVALID_OR_EXPIRED", "Code is invalid or expired", 401);
  }
  const a = Buffer.from(codeHash(row.salt, code), "hex"), b = Buffer.from(row.code_hash, "hex");
  if (!/^\d{6}$/.test(code) || !crypto.timingSafeEqual(a, b)) {
    await client.query(`update auth_email_codes set attempts=attempts+1 where id=$1`, [row.id]);
    throw new DomainError("AUTH_CODE_INVALID_OR_EXPIRED", "Code is invalid or expired", 401);
  }
  await client.query(`update auth_email_codes set used_at=now() where id=$1`, [row.id]);
}

async function sendQuietly(email: EmailProvider, message: { to: string; subject: string; text: string }): Promise<boolean> {
  try { await email.send(message); return true; } catch { return false; }
}

export async function registerWithPassword(
  pool: Pool, email: EmailProvider, config: AuthServiceConfig,
  input: { email: string; password: string; roles?: unknown }
): Promise<SessionResult & { verificationEmailSent: boolean }> {
  const address = normalizeEmail(input.email);
  assertPasswordPolicy(input.password);
  const roles: SelfServiceRole[] = normalizeRequestedRoles(input.roles);
  const hash = await hashPassword(input.password);
  const { result, code } = await tx(pool, async client => {
    const created = await client.query(`
      insert into app_users(email,password_hash,password_changed_at) values($1,$2,now())
      on conflict do nothing returning id`, [address, hash]);
    if (!created.rowCount) throw new DomainError("EMAIL_ALREADY_REGISTERED", "An account with this email already exists", 409);
    const id = created.rows[0].id as string;
    await client.query(`insert into profiles(user_id) values($1)`, [id]);
    for (const role of roles) await client.query(`insert into user_roles(user_id,role) values($1,$2)`, [id, role]);
    const code = await issueCode(client, id, "verify_email", config);
    return { result: await openSession(client, id, config.sessionTtlSeconds, "auth.registered"), code };
  });
  const sent = code ? await sendQuietly(email, codeEmail(address, "verify_email", code, Math.round(config.codeTtlSeconds / 60))) : false;
  return { ...result, verificationEmailSent: sent };
}

export async function loginWithPassword(
  pool: Pool, config: AuthServiceConfig, input: { email: string; password: string }
): Promise<SessionResult> {
  let address: string;
  try { address = normalizeEmail(input.email); } catch {
    throw new DomainError("INVALID_CREDENTIALS", "Email or password is incorrect", 401);
  }
  const user = (await pool.query(`
    select id,password_hash,status,locked_until from app_users where lower(email)=$1`, [address])).rows[0];
  if (!user || !user.password_hash) {
    await burnPasswordCheck(input.password ?? "");
    throw new DomainError("INVALID_CREDENTIALS", "Email or password is incorrect", 401);
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new DomainError("AUTH_TEMPORARILY_LOCKED", "Too many failed attempts, try again later", 429,
      { retryAfter: new Date(user.locked_until).toISOString() });
  }
  const ok = await verifyPassword(input.password ?? "", user.password_hash);
  if (!ok) {
    // After the limit the account pauses sign-in for a while and the counter starts again.
    await pool.query(`
      update app_users set
        locked_until=case when failed_login_count+1>=$2 then now()+make_interval(mins=>$3) else locked_until end,
        failed_login_count=case when failed_login_count+1>=$2 then 0 else failed_login_count+1 end
       where id=$1`, [user.id, config.maxFailedLogins, config.lockMinutes]);
    throw new DomainError("INVALID_CREDENTIALS", "Email or password is incorrect", 401);
  }
  if (user.status !== "active") throw new DomainError("ACCOUNT_NOT_ACTIVE", "Account is not active", 403);
  return tx(pool, async client => {
    await client.query(`update app_users set failed_login_count=0,locked_until=null where id=$1`, [user.id]);
    return openSession(client, user.id, config.sessionTtlSeconds, "auth.login");
  });
}

export async function resendEmailVerification(pool: Pool, email: EmailProvider, config: AuthServiceConfig, userId: string) {
  const { address, code, verified } = await tx(pool, async client => {
    const u = (await client.query(`select email,email_verified_at from app_users where id=$1 for update`, [userId])).rows[0];
    if (!u?.email) throw new DomainError("USER_NOT_FOUND", "User not found", 404);
    if (u.email_verified_at) return { address: u.email as string, code: null, verified: true };
    return { address: u.email as string, code: await issueCode(client, userId, "verify_email", config), verified: false };
  });
  if (verified) return { alreadyVerified: true, sent: false };
  if (!code) throw new DomainError("AUTH_RESEND_TOO_SOON", "Wait a minute before asking for another code", 429);
  await email.send(codeEmail(address, "verify_email", code, Math.round(config.codeTtlSeconds / 60)));
  return { alreadyVerified: false, sent: true };
}

export async function confirmEmail(pool: Pool, userId: string, code: string) {
  return tx(pool, async client => {
    const u = (await client.query(`select email_verified_at from app_users where id=$1 for update`, [userId])).rows[0];
    if (!u) throw new DomainError("USER_NOT_FOUND", "User not found", 404);
    if (u.email_verified_at) return { emailVerified: true };
    await consumeCode(client, userId, "verify_email", code);
    await client.query(`update app_users set email_verified_at=now(),updated_at=now() where id=$1`, [userId]);
    await client.query(`insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
      values($1,'auth.email_verified','user',$2,'{}'::jsonb)`, [userId, userId]);
    return { emailVerified: true };
  });
}

/** Always answers the same way, so nobody can find out which emails have an account. */
export async function requestPasswordReset(pool: Pool, email: EmailProvider, config: AuthServiceConfig, input: { email: string }) {
  if (email.name === "disabled") throw new DomainError("EMAIL_PROVIDER_UNAVAILABLE", "Email delivery is not configured", 503);
  let address: string;
  try { address = normalizeEmail(input.email); } catch { return { accepted: true }; }
  const code = await tx(pool, async client => {
    const u = (await client.query(`select id from app_users where lower(email)=$1 and status='active' for update`, [address])).rows[0];
    return u ? issueCode(client, u.id, "reset_password", config) : null;
  });
  if (code) await sendQuietly(email, codeEmail(address, "reset_password", code, Math.round(config.codeTtlSeconds / 60)));
  return { accepted: true };
}

/** A correct code sets the new password, confirms the email and closes every open session. */
export async function resetPassword(pool: Pool, config: AuthServiceConfig, input: { email: string; code: string; newPassword: string }) {
  assertPasswordPolicy(input.newPassword);
  let address: string;
  try { address = normalizeEmail(input.email); } catch {
    throw new DomainError("AUTH_CODE_INVALID_OR_EXPIRED", "Code is invalid or expired", 401);
  }
  const hash = await hashPassword(input.newPassword);
  return tx(pool, async client => {
    const u = (await client.query(`select id from app_users where lower(email)=$1 and status='active' for update`, [address])).rows[0];
    if (!u) throw new DomainError("AUTH_CODE_INVALID_OR_EXPIRED", "Code is invalid or expired", 401);
    await consumeCode(client, u.id, "reset_password", input.code);
    await client.query(`
      update app_users set password_hash=$2,password_changed_at=now(),failed_login_count=0,locked_until=null,
        email_verified_at=coalesce(email_verified_at,now()),updated_at=now() where id=$1`, [u.id, hash]);
    await client.query(`delete from auth_sessions where user_id=$1`, [u.id]);
    await client.query(`insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
      values($1,'auth.password_reset','user',$2,'{}'::jsonb)`, [u.id, u.id]);
    return openSession(client, u.id, config.sessionTtlSeconds, "auth.login");
  });
}

/** Changing the password closes every other session of the account. */
export async function changePassword(pool: Pool, userId: string, sessionId: string, input: { currentPassword: string; newPassword: string }) {
  assertPasswordPolicy(input.newPassword);
  const u = (await pool.query(`select password_hash from app_users where id=$1`, [userId])).rows[0];
  if (!u?.password_hash || !(await verifyPassword(input.currentPassword ?? "", u.password_hash))) {
    throw new DomainError("INVALID_CREDENTIALS", "Current password is incorrect", 401);
  }
  const hash = await hashPassword(input.newPassword);
  await tx(pool, async client => {
    await client.query(`update app_users set password_hash=$2,password_changed_at=now(),updated_at=now() where id=$1`, [userId, hash]);
    await client.query(`delete from auth_sessions where user_id=$1 and id<>$2`, [userId, sessionId]);
    await client.query(`insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
      values($1,'auth.password_changed','user',$2,'{}'::jsonb)`, [userId, userId]);
  });
  return { changed: true };
}
