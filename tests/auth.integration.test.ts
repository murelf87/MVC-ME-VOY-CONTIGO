import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { DomainError } from "../src/errors.js";
import type { SmsVerificationProvider } from "../src/auth/provider.js";
import { beginPhoneVerification, verifyPhoneCode } from "../src/auth/service.js";
import { resolveSession, revokeSession } from "../src/auth/session.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
const pool = new Pool({ connectionString: databaseUrl });

const config = {
  challengeTtlSeconds: 600,
  sessionTtlSeconds: 3600,
  maxCheckAttempts: 3,
  resendCooldownSeconds: 60
};

class TestSmsProvider implements SmsVerificationProvider {
  readonly name = "test-provider";
  starts = 0;

  async start(): Promise<{ providerChallengeId: string; providerStatus: string }> {
    this.starts += 1;
    return {
      providerChallengeId: `VE${this.starts.toString(16).padStart(32,"0")}`,
      providerStatus: "pending"
    };
  }

  async check(_providerChallengeId: string, code: string) {
    return { approved: code === "123456", providerStatus: code === "123456" ? "approved" : "pending" };
  }
}

before(async () => {
  await pool.query("select 1 from auth_sessions limit 1");
});

beforeEach(async () => {
  await pool.query(`
    truncate table auth_sessions, auth_challenges, audit_events, profiles, user_roles, app_users
    restart identity cascade`);
});

after(async () => {
  await pool.end();
});

test("verified phone creates only requested self-service roles and a revocable session", async () => {
  const provider = new TestSmsProvider();
  const started = await beginPhoneVerification(pool, provider, config, {
    phone: "+34600111222",
    roles: ["passenger", "driver"]
  });
  const verified = await verifyPhoneCode(pool, provider, config, {
    challengeId: started.challengeId,
    code: "123456"
  });

  assert.match(verified.token, /^mvc_sess_/);
  assert.deepEqual(new Set(verified.user.roles), new Set(["passenger", "driver"]));

  const stored = await pool.query(`select token_hash from auth_sessions where id=$1`, [
    (await resolveSession(pool, verified.token)).sessionId
  ]);
  assert.equal(stored.rows[0].token_hash.length, 64);
  assert.notEqual(stored.rows[0].token_hash, verified.token);

  const principal = await resolveSession(pool, verified.token);
  assert.ok(Array.isArray(principal.roles), "session roles must be a real array, not a Postgres array literal");
  assert.deepEqual(new Set(principal.roles), new Set(["passenger", "driver"]));

  await revokeSession(pool, verified.token);
  await assert.rejects(() => resolveSession(pool, verified.token), /Session is invalid or expired/);
});

test("public registration cannot request an administrative role", async () => {
  const provider = new TestSmsProvider();
  await assert.rejects(
    () => beginPhoneVerification(pool, provider, config, { phone: "+34600111222", roles: ["admin"] }),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_SELF_SERVICE_ROLES"
  );
  assert.equal(provider.starts, 0);
});

test("resend cooldown prevents duplicate SMS dispatch", async () => {
  const provider = new TestSmsProvider();
  await beginPhoneVerification(pool, provider, config, { phone: "+34600111222" });
  await assert.rejects(
    () => beginPhoneVerification(pool, provider, config, { phone: "+34600111222" }),
    (error: unknown) => error instanceof DomainError && error.code === "AUTH_RESEND_TOO_SOON"
  );
  assert.equal(provider.starts, 1);
});

test("wrong verification code never creates a user or session", async () => {
  const provider = new TestSmsProvider();
  const started = await beginPhoneVerification(pool, provider, config, { phone: "+34600111222" });
  await assert.rejects(
    () => verifyPhoneCode(pool, provider, config, { challengeId: started.challengeId, code: "000000" }),
    (error: unknown) => error instanceof DomainError && error.code === "AUTH_CODE_INVALID_OR_EXPIRED"
  );

  const users = await pool.query(`select count(*)::int as n from app_users`);
  const sessions = await pool.query(`select count(*)::int as n from auth_sessions`);
  assert.equal(users.rows[0].n, 0);
  assert.equal(sessions.rows[0].n, 0);
});
