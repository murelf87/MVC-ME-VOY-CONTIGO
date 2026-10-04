import type { Pool, PoolClient } from "pg";
import { DomainError } from "../errors.js";
import type { SmsVerificationProvider } from "./provider.js";
import { normalizeE164, normalizeRequestedRoles, type SelfServiceRole } from "./phone.js";
import { createSession } from "./session.js";

export type AuthServiceConfig = {
  challengeTtlSeconds: number;
  sessionTtlSeconds: number;
  maxCheckAttempts: number;
  resendCooldownSeconds: number;
};

type ChallengeRow = {
  id: string;
  phone_e164: string;
  requested_roles: SelfServiceRole[];
  provider: string;
  provider_challenge_id: string | null;
  status: string;
  check_attempts: number;
  expires_at: Date;
};

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

export async function beginPhoneVerification(
  pool: Pool,
  provider: SmsVerificationProvider,
  config: AuthServiceConfig,
  input: { phone: string; roles?: unknown }
): Promise<{ challengeId: string; expiresAt: string }> {
  const phone = normalizeE164(input.phone);
  const roles = normalizeRequestedRoles(input.roles);

  const reserved = await tx(pool, async client => {
    await client.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`, [phone]);
    const recent = await client.query(
      `select id from auth_challenges
        where phone_e164=$1
          and status in ('dispatching','pending','provider_approved')
          and requested_at > now() - ($2 || ' seconds')::interval
        order by requested_at desc
        limit 1`,
      [phone, config.resendCooldownSeconds]
    );
    if (recent.rowCount) {
      throw new DomainError("AUTH_RESEND_TOO_SOON", "Wait before requesting another verification code", 429);
    }

    const result = await client.query<{ id: string; expires_at: Date }>(
      `insert into auth_challenges(
         phone_e164,requested_roles,provider,status,expires_at
       ) values($1,$2::user_role[],$3,'dispatching',now() + ($4 || ' seconds')::interval)
       returning id,expires_at`,
      [phone, roles, provider.name, config.challengeTtlSeconds]
    );
    const row = result.rows[0];
    if (!row) throw new Error("challenge insert returned no row");
    return { id: row.id, expiresAt: row.expires_at };
  });

  try {
    const started = await provider.start(phone);
    await pool.query(
      `update auth_challenges
          set provider_challenge_id=$2,provider_status=$3,status='pending',updated_at=now()
        where id=$1 and status='dispatching'`,
      [reserved.id, started.providerChallengeId, started.providerStatus]
    );
    await pool.query(
      `insert into audit_events(action,entity_type,entity_id,metadata)
       values('auth.challenge.started','auth_challenge',$1,$2::jsonb)`,
      [reserved.id, JSON.stringify({ provider: provider.name, roles })]
    );
  } catch (error) {
    await pool.query(
      `update auth_challenges set status='failed',updated_at=now() where id=$1 and status='dispatching'`,
      [reserved.id]
    ).catch(() => undefined);
    throw error;
  }

  return { challengeId: reserved.id, expiresAt: reserved.expiresAt.toISOString() };
}

async function prepareVerification(
  pool: Pool,
  challengeId: string,
  maxCheckAttempts: number
): Promise<{ mode: "finalize" } | { mode: "check"; challenge: ChallengeRow }> {
  return tx(pool, async client => {
    const result = await client.query<ChallengeRow>(
      `select id,phone_e164,requested_roles::text[] as requested_roles,provider,provider_challenge_id,status,check_attempts,expires_at\n         from auth_challenges where id=$1 for update`,
      [challengeId]
    );
    const row = result.rows[0];
    if (!row) throw new DomainError("AUTH_CHALLENGE_NOT_FOUND", "Verification challenge not found", 404);

    if (row.status === "provider_approved") return { mode: "finalize" } as const;
    if (row.status === "verified") {
      throw new DomainError("AUTH_CHALLENGE_ALREADY_USED", "Verification challenge has already been used", 409);
    }
    if (row.expires_at.getTime() <= Date.now()) {
      await client.query(`update auth_challenges set status='expired',updated_at=now() where id=$1`, [challengeId]);
      throw new DomainError("AUTH_CODE_INVALID_OR_EXPIRED", "Verification code is invalid or expired", 401);
    }
    if (row.status !== "pending" || !row.provider_challenge_id) {
      throw new DomainError("AUTH_CHALLENGE_NOT_READY", "Verification challenge is not ready", 409);
    }
    if (row.check_attempts >= maxCheckAttempts) {
      throw new DomainError("AUTH_TOO_MANY_ATTEMPTS", "Too many verification attempts", 429);
    }

    await client.query(
      `update auth_challenges set check_attempts=check_attempts+1,updated_at=now() where id=$1`,
      [challengeId]
    );
    return { mode: "check", challenge: row } as const;
  });
}

async function finalizeApprovedChallenge(
  pool: Pool,
  challengeId: string,
  sessionTtlSeconds: number
): Promise<{ token: string; expiresAt: string; user: { id: string; roles: SelfServiceRole[] } }> {
  return tx(pool, async client => {
    const result = await client.query<ChallengeRow>(
      `select * from auth_challenges where id=$1 for update`,
      [challengeId]
    );
    const challenge = result.rows[0];
    if (!challenge) throw new DomainError("AUTH_CHALLENGE_NOT_FOUND", "Verification challenge not found", 404);
    if (challenge.status !== "provider_approved") {
      throw new DomainError("AUTH_CHALLENGE_NOT_APPROVED", "Verification challenge is not approved", 409);
    }

    const userResult = await client.query<{ id: string; status: string }>(
      `insert into app_users(phone_e164)
       values($1)
       on conflict(phone_e164) do update set updated_at=now()
       returning id,status`,
      [challenge.phone_e164]
    );
    const user = userResult.rows[0];
    if (!user) throw new Error("user upsert returned no row");
    if (user.status !== "active") {
      throw new DomainError("ACCOUNT_NOT_ACTIVE", "Account is not active", 403);
    }

    await client.query(
      `insert into profiles(user_id) values($1) on conflict(user_id) do nothing`,
      [user.id]
    );
    for (const role of challenge.requested_roles) {
      await client.query(
        `insert into user_roles(user_id,role) values($1,$2) on conflict do nothing`,
        [user.id, role]
      );
    }

    const session = await createSession(client, user.id, sessionTtlSeconds);
    await client.query(
      `update auth_challenges set status='verified',verified_at=now(),updated_at=now() where id=$1`,
      [challengeId]
    );
    await client.query(
      `insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
       values($1,'auth.login','auth_session',$2,$3::jsonb)`,
      [user.id, session.sessionId, JSON.stringify({ provider: challenge.provider })]
    );

    return {
      token: session.token,
      expiresAt: session.expiresAt,
      user: { id: user.id, roles: challenge.requested_roles }
    };
  });
}

export async function verifyPhoneCode(
  pool: Pool,
  provider: SmsVerificationProvider,
  config: AuthServiceConfig,
  input: { challengeId: string; code: string }
): Promise<{ token: string; expiresAt: string; user: { id: string; roles: SelfServiceRole[] } }> {
  const prepared = await prepareVerification(pool, input.challengeId, config.maxCheckAttempts);
  if (prepared.mode === "finalize") {
    return finalizeApprovedChallenge(pool, input.challengeId, config.sessionTtlSeconds);
  }

  if (prepared.challenge.provider !== provider.name) {
    throw new DomainError("AUTH_PROVIDER_MISMATCH", "Verification provider mismatch", 409);
  }

  const checked = await provider.check(prepared.challenge.provider_challenge_id!, input.code);
  if (!checked.approved) {
    await pool.query(
      `update auth_challenges set provider_status=$2,updated_at=now() where id=$1 and status='pending'`,
      [input.challengeId, checked.providerStatus]
    );
    throw new DomainError("AUTH_CODE_INVALID_OR_EXPIRED", "Verification code is invalid or expired", 401);
  }

  await pool.query(
    `update auth_challenges
        set status='provider_approved',provider_status=$2,provider_approved_at=now(),updated_at=now()
      where id=$1 and status='pending'`,
    [input.challengeId, checked.providerStatus]
  );

  return finalizeApprovedChallenge(pool, input.challengeId, config.sessionTtlSeconds);
}
