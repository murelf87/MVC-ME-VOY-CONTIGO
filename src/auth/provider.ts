import { DomainError } from "../errors.js";
import type { AppConfig } from "../config.js";

export type VerificationStart = {
  providerChallengeId: string;
  providerStatus: string;
};

export type VerificationCheck = {
  approved: boolean;
  providerStatus: string;
};

export interface SmsVerificationProvider {
  readonly name: string;
  start(phoneE164: string): Promise<VerificationStart>;
  check(providerChallengeId: string, code: string): Promise<VerificationCheck>;
}

class DisabledSmsVerificationProvider implements SmsVerificationProvider {
  readonly name = "disabled";

  async start(): Promise<never> {
    throw new DomainError("SMS_PROVIDER_UNAVAILABLE", "SMS verification provider is not configured", 503);
  }

  async check(): Promise<never> {
    throw new DomainError("SMS_PROVIDER_UNAVAILABLE", "SMS verification provider is not configured", 503);
  }
}

type TwilioResponse = {
  sid?: string;
  status?: string;
};

class TwilioVerifyProvider implements SmsVerificationProvider {
  readonly name = "twilio";

  constructor(
    private readonly apiKeySid: string,
    private readonly apiKeySecret: string,
    private readonly serviceSid: string
  ) {}

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.apiKeySid}:${this.apiKeySecret}`).toString("base64")}`;
  }

  private async post(path: string, body: URLSearchParams): Promise<TwilioResponse> {
    const response = await fetch(`https://verify.twilio.com/v2/Services/${this.serviceSid}/${path}`, {
      method: "POST",
      headers: {
        authorization: this.authHeader(),
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json"
      },
      body
    });

    let data: TwilioResponse = {};
    try {
      data = await response.json() as TwilioResponse;
    } catch {
      data = {};
    }

    if (!response.ok) {
      if (response.status === 429) {
        throw new DomainError("SMS_RATE_LIMITED", "SMS verification is temporarily rate limited", 429);
      }
      if (response.status === 404 && path === "VerificationCheck") {
        throw new DomainError("AUTH_CODE_INVALID_OR_EXPIRED", "Verification code is invalid or expired", 401);
      }
      throw new DomainError(
        "SMS_PROVIDER_ERROR",
        "SMS verification provider returned an error",
        502,
        { provider: this.name, httpStatus: response.status }
      );
    }

    return data;
  }

  async start(phoneE164: string): Promise<VerificationStart> {
    const data = await this.post("Verifications", new URLSearchParams({
      To: phoneE164,
      Channel: "sms"
    }));

    if (!data.sid || !/^VE[0-9a-fA-F]{32}$/.test(data.sid)) {
      throw new DomainError("SMS_PROVIDER_BAD_RESPONSE", "SMS provider returned an invalid verification identifier", 502);
    }

    return {
      providerChallengeId: data.sid,
      providerStatus: data.status ?? "pending"
    };
  }

  async check(providerChallengeId: string, code: string): Promise<VerificationCheck> {
    if (!/^[^\s]{4,10}$/.test(code)) {
      throw new DomainError("INVALID_VERIFICATION_CODE", "Verification code must contain 4 to 10 characters");
    }

    const data = await this.post("VerificationCheck", new URLSearchParams({
      VerificationSid: providerChallengeId,
      Code: code
    }));

    return {
      approved: data.status === "approved",
      providerStatus: data.status ?? "unknown"
    };
  }
}

export function buildSmsVerificationProvider(config: AppConfig): SmsVerificationProvider {
  if (config.smsProvider === "disabled") {
    if (config.nodeEnv === "production") {
      throw new Error("SMS_PROVIDER must be configured for production");
    }
    return new DisabledSmsVerificationProvider();
  }

  if (!config.twilioApiKeySid || !config.twilioApiKeySecret || !config.twilioVerifyServiceSid) {
    throw new Error("Twilio Verify configuration is incomplete");
  }

  return new TwilioVerifyProvider(
    config.twilioApiKeySid,
    config.twilioApiKeySecret,
    config.twilioVerifyServiceSid
  );
}
