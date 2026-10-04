export type AppConfig = {
  nodeEnv: string;
  host: string;
  port: number;
  databaseUrl: string;
  trustProxy: boolean;
  rateLimitMax: number;
  rateLimitWindow: string;
};

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid integer environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    host: process.env.HOST ?? "0.0.0.0",
    port: intEnv("PORT", 3000),
    databaseUrl,
    trustProxy: process.env.TRUST_PROXY === "true",
    rateLimitMax: intEnv("RATE_LIMIT_MAX", 120),
    rateLimitWindow: process.env.RATE_LIMIT_WINDOW ?? "1 minute"
  };
}
