import crypto from "node:crypto";
import type { SmsVerificationProvider, VerificationCheck, VerificationStart } from "../auth/provider.js";

/**
 * Development-only SMS provider. Generates a random 6-digit code per challenge
 * and writes it to the server log. It never sends an SMS, never uses a universal
 * code, and buildSmsVerificationProvider refuses it outside NODE_ENV=development.
 */
export class DevConsoleSmsProvider implements SmsVerificationProvider {
  readonly name = "dev_console";
  private readonly codes = new Map<string, string>();

  async start(phoneE164: string): Promise<VerificationStart> {
    const providerChallengeId = `dev_${crypto.randomUUID()}`;
    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
    this.codes.set(providerChallengeId, code);
    console.log(`[DEV SMS] ${phoneE164} code=${code}`);
    return { providerChallengeId, providerStatus: "pending" };
  }

  async check(providerChallengeId: string, code: string): Promise<VerificationCheck> {
    const expected = this.codes.get(providerChallengeId);
    const approved = expected !== undefined && expected === code;
    if (approved) this.codes.delete(providerChallengeId);
    return { approved, providerStatus: approved ? "approved" : "pending" };
  }
}
