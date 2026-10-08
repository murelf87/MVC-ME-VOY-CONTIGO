import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { DomainError } from "../src/errors.js";
import type { EmailMessage, EmailProvider } from "../src/email/provider.js";
import {
  changePassword, confirmEmail, loginWithPassword, registerWithPassword, requestPasswordReset,
  resendEmailVerification, resetPassword
} from "../src/auth/service.js";
import { resolveSession, revokeSession } from "../src/auth/session.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
const pool = new Pool({ connectionString: databaseUrl });

const config = { sessionTtlSeconds: 3600, maxFailedLogins: 3, lockMinutes: 15, codeTtlSeconds: 1800, resendCooldownSeconds: 60 };
const PW = "una frase larga de prueba";

class TestEmail implements EmailProvider {
  readonly name = "test";
  sent: EmailMessage[] = [];
  async send(m: EmailMessage) { this.sent.push(m); }
  lastCode() { return /(\d{6})/.exec(this.sent.at(-1)?.text ?? "")?.[1] ?? ""; }
}
const code = (c: string) => (e: unknown) => e instanceof DomainError && e.code === c;
const register = (email: TestEmail, address = "marina@example.es", roles: unknown = ["passenger", "driver"]) =>
  registerWithPassword(pool, email, config, { email: address, password: PW, roles });

beforeEach(async () => {
  await pool.query(`truncate table auth_email_codes, auth_sessions, audit_events, profiles, user_roles, app_users restart identity cascade`);
});
after(async () => { await pool.end(); });

test("registering creates only the requested self-service roles, a session and an email code; passwords are never stored in clear", async () => {
  const email = new TestEmail();
  const r = await register(email, "  Marina@Example.ES ");
  assert.equal(r.user.email, "marina@example.es");
  assert.deepEqual([...r.user.roles].sort(), ["driver", "passenger"]);
  assert.equal(r.user.emailVerified, false);
  assert.equal(r.verificationEmailSent, true);
  assert.equal(email.sent[0]?.to, "marina@example.es");
  const principal = await resolveSession(pool, r.token);
  assert.deepEqual([...principal.roles].sort(), ["driver", "passenger"]);
  const row = (await pool.query(`select password_hash from app_users where id=$1`, [r.user.id])).rows[0];
  assert.match(row.password_hash, /^scrypt\$/);
  assert.ok(!row.password_hash.includes(PW));
  await revokeSession(pool, r.token);
  await assert.rejects(() => resolveSession(pool, r.token), code("AUTH_INVALID_OR_EXPIRED"));
});

test("public registration cannot request an administrative role, reuse an email or use a weak password", async () => {
  const email = new TestEmail();
  await assert.rejects(() => register(email, "a@example.es", ["admin"]), code("INVALID_SELF_SERVICE_ROLES"));
  await register(email, "a@example.es");
  await assert.rejects(() => register(email, "A@EXAMPLE.ES"), code("EMAIL_ALREADY_REGISTERED"));
  await assert.rejects(() => registerWithPassword(pool, email, config, { email: "b@example.es", password: "corta" }), code("PASSWORD_TOO_WEAK"));
  assert.equal((await pool.query(`select count(*)::int as n from app_users`)).rows[0].n, 1);
});

test("login gives the same answer for a wrong password and an unknown email, and pauses after repeated failures", async () => {
  const email = new TestEmail();
  const r = await register(email);
  const ok = await loginWithPassword(pool, config, { email: "MARINA@example.es", password: PW });
  assert.equal(ok.user.id, r.user.id);
  await assert.rejects(() => loginWithPassword(pool, config, { email: "nadie@example.es", password: PW }), code("INVALID_CREDENTIALS"));
  for (let i = 0; i < 3; i++) {
    await assert.rejects(() => loginWithPassword(pool, config, { email: "marina@example.es", password: "otra clave cualquiera" }), code("INVALID_CREDENTIALS"));
  }
  await assert.rejects(() => loginWithPassword(pool, config, { email: "marina@example.es", password: PW }), code("AUTH_TEMPORARILY_LOCKED"));
  await pool.query(`update app_users set locked_until=now()-interval '1 second'`);
  assert.equal((await loginWithPassword(pool, config, { email: "marina@example.es", password: PW })).user.id, r.user.id);
  await pool.query(`update app_users set status='suspended'`);
  await assert.rejects(() => loginWithPassword(pool, config, { email: "marina@example.es", password: PW }), code("ACCOUNT_NOT_ACTIVE"));
});

test("the emailed code confirms the address once; wrong codes count and a resend replaces the old code", async () => {
  const email = new TestEmail();
  const r = await register(email);
  const first = email.lastCode();
  await assert.rejects(() => resendEmailVerification(pool, email, config, r.user.id), code("AUTH_RESEND_TOO_SOON"));
  await pool.query(`update auth_email_codes set created_at=now()-interval '2 minutes'`);
  await resendEmailVerification(pool, email, config, r.user.id);
  const second = email.lastCode();
  if (first !== second) await assert.rejects(() => confirmEmail(pool, r.user.id, first), code("AUTH_CODE_INVALID_OR_EXPIRED"));
  await assert.rejects(() => confirmEmail(pool, r.user.id, second === "000000" ? "000001" : "000000"), code("AUTH_CODE_INVALID_OR_EXPIRED"));
  assert.deepEqual(await confirmEmail(pool, r.user.id, second), { emailVerified: true });
  assert.ok((await pool.query(`select email_verified_at from app_users`)).rows[0].email_verified_at);
  assert.deepEqual(await resendEmailVerification(pool, email, config, r.user.id), { alreadyVerified: true, sent: false });
});

test("password reset never reveals whether an email exists, and a used code closes every old session", async () => {
  const email = new TestEmail();
  const r = await register(email);
  email.sent = [];
  assert.deepEqual(await requestPasswordReset(pool, email, config, { email: "nadie@example.es" }), { accepted: true });
  assert.equal(email.sent.length, 0);
  assert.deepEqual(await requestPasswordReset(pool, email, config, { email: "marina@example.es" }), { accepted: true });
  const resetCode = email.lastCode();
  assert.match(email.sent[0]?.subject ?? "", /contraseña/);

  const newPw = "otra frase todavia mas larga";
  const done = await resetPassword(pool, config, { email: "marina@example.es", code: resetCode, newPassword: newPw });
  await assert.rejects(() => resolveSession(pool, r.token), code("AUTH_INVALID_OR_EXPIRED"));
  await resolveSession(pool, done.token);
  await assert.rejects(() => resetPassword(pool, config, { email: "marina@example.es", code: resetCode, newPassword: newPw }), code("AUTH_CODE_INVALID_OR_EXPIRED"));
  await assert.rejects(() => loginWithPassword(pool, config, { email: "marina@example.es", password: PW }), code("INVALID_CREDENTIALS"));
  await loginWithPassword(pool, config, { email: "marina@example.es", password: newPw });

  const disabled: EmailProvider = { name: "disabled", async send() { throw new Error("no"); } };
  await assert.rejects(() => requestPasswordReset(pool, disabled, config, { email: "marina@example.es" }), code("EMAIL_PROVIDER_UNAVAILABLE"));
});

test("changing the password needs the current one and closes the other sessions only", async () => {
  const email = new TestEmail();
  const r = await register(email);
  const other = await loginWithPassword(pool, config, { email: "marina@example.es", password: PW });
  const me = await resolveSession(pool, r.token);
  await assert.rejects(() => changePassword(pool, me.userId, me.sessionId, { currentPassword: "equivocada del todo", newPassword: "nueva frase segura" }), code("INVALID_CREDENTIALS"));
  await changePassword(pool, me.userId, me.sessionId, { currentPassword: PW, newPassword: "nueva frase segura" });
  await resolveSession(pool, r.token);
  await assert.rejects(() => resolveSession(pool, other.token), code("AUTH_INVALID_OR_EXPIRED"));
});
