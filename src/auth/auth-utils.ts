import crypto from "node:crypto";
import { DomainError } from "../errors.js";

export function normalizePhoneE164(value: string): string {
  const phone = value.trim();
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw new DomainError("INVALID_PHONE_E164", "Phone number must use E.164 format");
  }
  return phone;
}

export function generateOtpCode(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function newSalt(): string {
  return crypto.randomBytes(16).toString("base64url");
}

export function hashOtp(salt: string, code: string): string {
  return crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function secureEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function parseBearer(value: string | undefined): string {
  if (!value) throw new DomainError("AUTH_REQUIRED", "Authentication required", 401);
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  if (!match?.[1]) throw new DomainError("INVALID_AUTHORIZATION", "Invalid Authorization header", 401);
  return match[1];
}
