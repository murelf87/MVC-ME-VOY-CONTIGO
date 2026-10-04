import type { Pool, PoolClient } from "pg";
import { DomainError } from "../errors.js";
import type { OtpProvider } from "./otp-provider.js";
import {
  generateOpaqueToken,
  generateOtpCode,
  hashOtp,
  hashToken,
  newSalt,
  normalizePhoneE164,
  parseBearer,
  secureEqualHex
} from "./auth-utils.js";

export type AuthenticatedUser = {
  userId: string;
  phoneE164: string;
};

type RequestOtpInput = {
  phoneE164: string;
  purpose: "login" | "register";
  ttlSeconds?: number;
};

async function withTx<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function requestOtp(
  pool: Pool,
  provider: OtpProvider,
  input: RequestOtpInput
): Promise<{ challengeId: string; expiresAt: string }> {
  const phone = normalizePhoneE164(input.phoneE164);
  const ttlSeconds = input.ttlSeconds ?? 300;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 900) {
    throw new DomainError("INVALID_OTP_TTL", "OTP TTL must be between 60 and 900 seconds");
  }

  const code = generateOtpCode();
  const salt = newSalt();
  const codeHash = hashOtp(salt, code);

  const inserted = await pool.query(
    `insert into auth_otp_challenges(
       phone_e164,purpose,salt,code_hash,status,expires_at
     ) values($1,$2,$3,$4,'created',now()+($5 || ' seconds')::interval)
     returning id,expires_at`,
    [phone, input.purpose, salt, codeHash, ttlSeconds]
  );
  const challenge = inserted.rows[0];

  try {
    const delivery = await provider.sendOtp({ phoneE164: phone, code, ttlSeconds });
    await pool.query(
      `update auth_otp_challenges
          set status='sent',provider_name=$2,provider_message_id=$3
        where id=$1`,
      [challenge.id, delivery.providerName, delivery.providerMessageId]
    );
  } catch (error) {
    await pool.query(
      `update auth_otp_challenges set status='failed' where id=$1`,
      [challenge.id]
    );
    throw error;
  }

  return {
    challengeId: challenge.id as string,
    expiresAt: new Date(challenge.expires_at).toISOString()
  };
}

export async function verifyOtp(
  pool: Pool,
  input: {
    challengeId: string;
    phoneE164: string;
    code: string;
    userAgent?: string | undefined;
    ipAddress?: string | undefined;
  }
): Promise<{ accessToken: string; expiresAt: string; user: AuthenticatedUser }> {
  const phone = normalizePhoneE164(input.phoneE164);
  if (!/^\d{6}$/.test(input.code)) {
    throw new DomainError("INVALID_OTP_CODE", "OTP code must contain 6 digits", 400);
  }

  return withTx(pool, async (client) => {
    const challengeQ = await client.query(
      `select * from auth_otp_challenges where id=$1 for update`,
      [input.challengeId]
    );
    const challenge = challengeQ.rows[0];
    if (!challenge || challenge.phone_e164 !== phone) {
      throw new DomainError("OTP_CHALLENGE_NOT_FOUND", "OTP challenge not found", 404);
    }
    if (challenge.status !== "sent") {
      throw new DomainError("OTP_NOT_USABLE", "OTP challenge is not usable", 409);
    }
    if (new Date(challenge.expires_at).getTime() <= Date.now()) {
      throw new DomainError("OTP_EXPIRED", "OTP challenge expired", 410);
    }
    if (challenge.attempts >= challenge.max_attempts) {
      throw new DomainError("OTP_ATTEMPTS_EXCEEDED", "Maximum OTP attempts exceeded", 429);
    }

    const actualHash = hashOtp(challenge.salt, input.code);
    if (!secureEqualHex(actualHash, challenge.code_hash)) {
      await client.query(
        `update auth_otp_challenges set attempts=attempts+1 where id=$1`,
        [challenge.id]
      );
      throw new DomainError("OTP_INVALID", "Invalid OTP code", 401);
    }

    await client.query(
      `update auth_otp_challenges
          set status='consumed',consumed_at=now()
        where id=$1`,
      [challenge.id]
    );

    let userQ = await client.query(
      `select id,phone_e164,status from app_users where phone_e164=$1 for update`,
      [phone]
    );
    let user = userQ.rows[0];

    if (!user) {
      userQ = await client.query(
        `insert into app_users(phone_e164,status)
         values($1,'active') returning id,phone_e164,status`,
        [phone]
      );
      user = userQ.rows[0];
      await client.query(
        `insert into user_roles(user_id,role) values($1,'passenger')
         on conflict do nothing`,
        [user.id]
      );
      await client.query(
        `insert into profiles(user_id) values($1) on conflict do nothing`,
        [user.id]
      );
    }

    if (user.status !== "active") {
      throw new DomainError("USER_NOT_ACTIVE", "User account is not active", 403);
    }

    const token = generateOpaqueToken();
    const tokenHash = hashToken(token);
    const sessionQ = await client.query(
      `insert into auth_sessions(
         user_id,token_hash,expires_at,user_agent,ip_address
       ) values($1,$2,now()+interval '30 days',$3,$4::inet)
       returning expires_at`,
      [user.id, tokenHash, input.userAgent ?? null, input.ipAddress ?? null]
    );

    return {
      accessToken: token,
      expiresAt: new Date(sessionQ.rows[0].expires_at).toISOString(),
      user: { userId: user.id as string, phoneE164: user.phone_e164 as string }
    };
  });
}

export async function requireSession(
  pool: Pool,
  authorization: string | undefined
): Promise<AuthenticatedUser> {
  const token = parseBearer(authorization);
  const tokenHash = hashToken(token);

  const sessionQ = await pool.query(
    `select s.id,s.user_id,u.phone_e164,u.status
       from auth_sessions s
       join app_users u on u.id=s.user_id
      where s.token_hash=$1
        and s.revoked_at is null
        and s.expires_at > now()
      limit 1`,
    [tokenHash]
  );
  const row = sessionQ.rows[0];
  if (!row) throw new DomainError("SESSION_INVALID", "Session is invalid or expired", 401);
  if (row.status !== "active") throw new DomainError("USER_NOT_ACTIVE", "User account is not active", 403);

  void pool.query(`update auth_sessions set last_seen_at=now() where id=$1`, [row.id]);

  return { userId: row.user_id as string, phoneE164: row.phone_e164 as string };
}

export async function revokeSession(
  pool: Pool,
  authorization: string | undefined
): Promise<void> {
  const token = parseBearer(authorization);
  const tokenHash = hashToken(token);
  await pool.query(
    `update auth_sessions set revoked_at=now()
      where token_hash=$1 and revoked_at is null`,
    [tokenHash]
  );
}
