/**
 * Configuración propia del módulo `comms`. Todo con valor por defecto seguro (integraciones externas DESACTIVADAS).
 * Se lee de `process.env` aquí (y no de `src/config.ts`) para no tocar ficheros compartidos; ver docs/contracts/comms.md §13.
 */
export type CommsConfig = {
  /** Solo `disabled` está implementado: no hay proveedor push/credenciales. */
  pushProvider: "disabled";
  peerCallEnabled: boolean;
  peerCallWindowBeforeMinutes: number;
  peerCallWindowAfterMinutes: number;
  accountDeletionGraceDays: number;
  exportTtlHours: number;
  /** 0 = sin temporizador interno (los trabajos se pueden lanzar a mano o desde un cron externo). */
  jobsIntervalSeconds: number;
  /** Base pública para construir photoUrl; null → photoUrl siempre null. */
  publicMediaBaseUrl: string | null;
};

type Env = Record<string, string | undefined>;

function intEnv(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid integer environment variable: ${name}`);
  }
  return value;
}

function boolEnv(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`Invalid boolean environment variable: ${name} (use true or false)`);
}

export function loadCommsConfig(env: Env = process.env): CommsConfig {
  const push = env.PUSH_PROVIDER ?? "disabled";
  if (push !== "disabled") {
    throw new Error("PUSH_PROVIDER must be disabled (no push provider is implemented yet)");
  }
  const media = env.PUBLIC_MEDIA_BASE_URL?.trim();
  return {
    pushProvider: "disabled",
    peerCallEnabled: boolEnv(env, "COMMS_PEER_CALL_ENABLED", true),
    peerCallWindowBeforeMinutes: intEnv(env, "COMMS_PEER_CALL_WINDOW_BEFORE_MINUTES", 720, 0, 10_080),
    peerCallWindowAfterMinutes: intEnv(env, "COMMS_PEER_CALL_WINDOW_AFTER_MINUTES", 180, 0, 10_080),
    accountDeletionGraceDays: intEnv(env, "COMMS_ACCOUNT_DELETION_GRACE_DAYS", 14, 1, 60),
    exportTtlHours: intEnv(env, "COMMS_EXPORT_TTL_HOURS", 168, 1, 720),
    jobsIntervalSeconds: intEnv(env, "COMMS_JOBS_INTERVAL_SECONDS", 60, 0, 86_400),
    publicMediaBaseUrl: media ? media.replace(/\/+$/, "") : null
  };
}
