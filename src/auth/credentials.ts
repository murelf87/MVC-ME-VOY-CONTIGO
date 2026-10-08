import crypto from "node:crypto";
import { promisify } from "node:util";
import { DomainError } from "../errors.js";

const scrypt = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike, salt: crypto.BinaryLike, keylen: number, options: crypto.ScryptOptions
) => Promise<Buffer>;

// scrypt with N=2^15, r=8, p=1 (OWASP minimum); parameters travel in the stored string so they can be raised later.
const N = 32768, R = 8, P = 1, KEYLEN = 64, MAXMEM = 64 * 1024 * 1024;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export function assertPasswordPolicy(password: string): void {
  if (typeof password !== "string" || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new DomainError("PASSWORD_TOO_WEAK", `Password must have between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters`);
  }
  if (/^\d+$/.test(password) || new Set(password).size < 4) {
    throw new DomainError("PASSWORD_TOO_WEAK", "Password is too easy to guess");
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length,
    { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM });
  return crypto.timingSafeEqual(key, expected);
}

/** Spends the same time as a real check, so an unknown email does not answer faster. */
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("mvc-dummy-password-never-used");
  await verifyPassword(password, await dummyHash);
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
export function normalizeEmail(input: string): string {
  const value = (input ?? "").trim().toLowerCase();
  if (value.length > 254 || !EMAIL.test(value)) {
    throw new DomainError("INVALID_EMAIL", "Email address is not valid");
  }
  return value;
}

export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!local || !domain) return null;
  return `${local.slice(0, 2)}${"•".repeat(Math.max(1, local.length - 2))}@${domain}`;
}
