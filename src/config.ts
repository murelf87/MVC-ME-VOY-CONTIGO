export type SmsProviderName = "disabled" | "twilio" | "dev_console";
export type MapsProviderName = "disabled" | "google" | "dev_local";
export type PrivateStorageProviderName = "disabled" | "s3";
export type InsuranceOcrProviderName = "disabled" | "google_vision";

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
  privateStorageProvider: PrivateStorageProviderName;
  s3Endpoint: string | undefined;
  s3Region: string;
  s3Bucket: string | undefined;
  s3AccessKeyId: string | undefined;
  s3SecretAccessKey: string | undefined;
  s3ForcePathStyle: boolean;
  privateUploadTtlSeconds: number;
  insuranceOcrProvider: InsuranceOcrProviderName;
  googleVisionApiKey: string | undefined;
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
  if (value !== "disabled" && value !== "google" && value !== "dev_local") {
    throw new Error("MAPS_PROVIDER must be disabled, google or dev_local");
  }
  return value;
}

function privateStorageProviderEnv(): PrivateStorageProviderName {
  const value = process.env.PRIVATE_STORAGE_PROVIDER ?? "disabled";
  if (value !== "disabled" && value !== "s3") {
    throw new Error("PRIVATE_STORAGE_PROVIDER must be disabled or s3");
  }
  return value;
}

function insuranceOcrProviderEnv(): InsuranceOcrProviderName {
  const value = process.env.INSURANCE_OCR_PROVIDER ?? "disabled";
  if (value !== "disabled" && value !== "google_vision") {
    throw new Error("INSURANCE_OCR_PROVIDER must be disabled or google_vision");
  }
  return value;
}

function smsProviderEnv(): SmsProviderName {
  const value = process.env.SMS_PROVIDER ?? "disabled";
  if (value !== "disabled" && value !== "twilio" && value !== "dev_console") {
    throw new Error("SMS_PROVIDER must be disabled, twilio or dev_console");
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
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
    privateStorageProvider: privateStorageProviderEnv(),
    s3Endpoint: process.env.S3_ENDPOINT,
    s3Region: process.env.S3_REGION ?? "eu-west-1",
    s3Bucket: process.env.S3_BUCKET,
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    privateUploadTtlSeconds: intEnv("PRIVATE_UPLOAD_TTL_SECONDS", 600, 60, 3600),
    insuranceOcrProvider: insuranceOcrProviderEnv(),
    googleVisionApiKey: process.env.GOOGLE_VISION_API_KEY
  };
}
