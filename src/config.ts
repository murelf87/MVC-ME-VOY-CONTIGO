export type SmsProviderName = "disabled" | "twilio";
export type MapsProviderName = "disabled" | "google";

export type AppConfig = {
  nodeEnv: string;
  host: string;
  port: number;
  databaseUrl: string;
  trustProxy: boolean;
  rateLimitMax: number;
  rateLimitWindow: string;
  smsProvider: SmsProviderName;
  twilioApiKeySid: string | undefined;
  twilioApiKeySecret: string | undefined;
  twilioVerifyServiceSid: string | undefined;
  authChallengeTtlSeconds: number;
  authSessionTtlSeconds: number;
  authMaxCheckAttempts: number;
  authResendCooldownSeconds: number;
  mapsProvider: MapsProviderName;
  googleMapsApiKey: string | undefined;
};

function intEnv(name: string, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid integer environment variable: ${name}`);
  }
  return value;
}

function mapsProviderEnv(): MapsProviderName {
  const value = process.env.MAPS_PROVIDER ?? "disabled";
  if (value !== "disabled" && value !== "google") {
    throw new Error("MAPS_PROVIDER must be disabled or google");
  }
  return value;
}

function smsProviderEnv(): SmsProviderName {
  const value = process.env.SMS_PROVIDER ?? "disabled";
  if (value !== "disabled" && value !== "twilio") {
    throw new Error("SMS_PROVIDER must be disabled or twilio");
  }
  return value;
}

export function loadConfig(): AppConfig {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    host: process.env.HOST ?? "0.0.0.0",
    port: intEnv("PORT", 3000, 1, 65535),
    databaseUrl,
    trustProxy: process.env.TRUST_PROXY === "true",
    rateLimitMax: intEnv("RATE_LIMIT_MAX", 120, 1, 100_000),
    rateLimitWindow: process.env.RATE_LIMIT_WINDOW ?? "1 minute",
    smsProvider: smsProviderEnv(),
    twilioApiKeySid: process.env.TWILIO_API_KEY_SID,
    twilioApiKeySecret: process.env.TWILIO_API_KEY_SECRET,
    twilioVerifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID,
    authChallengeTtlSeconds: intEnv("AUTH_CHALLENGE_TTL_SECONDS", 600, 120, 86_400),
    authSessionTtlSeconds: intEnv("AUTH_SESSION_TTL_SECONDS", 2_592_000, 3_600, 31_536_000),
    authMaxCheckAttempts: intEnv("AUTH_MAX_CHECK_ATTEMPTS", 5, 1, 10),
    authResendCooldownSeconds: intEnv("AUTH_RESEND_COOLDOWN_SECONDS", 60, 30, 3_600),
    mapsProvider: mapsProviderEnv(),
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY
  };
}
