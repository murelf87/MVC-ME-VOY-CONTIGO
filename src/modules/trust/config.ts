/**
 * Configuración del módulo `trust`. Todas las variables tienen un valor seguro por defecto.
 * (No viven en `src/config.ts` por propiedad de archivos; ver docs/contracts/trust.md §5.)
 */
export type EconomicsActivation = "disabled" | "enabled";

export type TrustConfig = {
  /** `enabled` es la ÚNICA forma de permitir publicar tarifas. Por defecto `disabled`: la economía no está activada. */
  economicsActivation: EconomicsActivation;
  /** Vida de la URL firmada que recibe el personal para ver documentación privada. */
  signedUrlTtlSeconds: number;
  /** Vida de las vistas previas firmadas de lo propio (foto, selfie). */
  ownPreviewTtlSeconds: number;
  /** Vida de la URL firmada tras el 302 de la foto pública. */
  publicPhotoTtlSeconds: number;
  /** Clave HMAC para el hash de IP de las aceptaciones legales. Sin ella no se guarda ningún hash. */
  ipHashPepper: string | undefined;
  /** Antigüedad máxima (segundos) de una posición para contarla como «vehículo en ruta». */
  vehicleActivityFreshnessSeconds: number;
};

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid integer environment variable: ${name} (expected ${min}-${max})`);
  }
  return value;
}

export function loadTrustConfig(env: NodeJS.ProcessEnv = process.env): TrustConfig {
  const activation = env.ECONOMICS_ACTIVATION ?? "disabled";
  if (activation !== "disabled" && activation !== "enabled") {
    throw new Error("ECONOMICS_ACTIVATION must be disabled or enabled");
  }
  const pepper = env.TRUST_IP_HASH_PEPPER?.trim();
  return {
    economicsActivation: activation,
    signedUrlTtlSeconds: intEnv(env, "TRUST_SIGNED_URL_TTL_SECONDS", 120, 30, 300),
    ownPreviewTtlSeconds: intEnv(env, "TRUST_OWN_PREVIEW_TTL_SECONDS", 300, 60, 900),
    publicPhotoTtlSeconds: intEnv(env, "TRUST_PUBLIC_PHOTO_TTL_SECONDS", 900, 60, 3600),
    ipHashPepper: pepper ? pepper : undefined,
    vehicleActivityFreshnessSeconds: intEnv(env, "TRUST_VEHICLE_ACTIVITY_FRESHNESS_SECONDS", 600, 60, 3600)
  };
}
