/**
 * Ajustes del módulo `live`. Se leen de variables de entorno (todas opcionales, con valores por defecto seguros)
 * en cada llamada, para poder variar en pruebas. Documentadas en docs/contracts/live.md §0.
 */
export type LiveSettings = {
  /** Una posición GPS más vieja que esto se marca como obsoleta (nunca «en directo»). */
  staleAfterSeconds: number;
  /** Aviso «llega en ~5 min». */
  arrivalWarningSeconds: number;
  /** Distancia a la parada a partir de la cual se considera «ha llegado». */
  arrivedDistanceM: number;
  /** Tiempo de parada en cada parada intermedia (subida/bajada). */
  stopDwellSeconds: number;
  /** Desviación de la ruta guardada a partir de la cual la ETA es aproximada. */
  offRouteM: number;
  /** Retraso mínimo (s) que se considera cambio material de horario. */
  materialScheduleDeltaS: number;
  /** Vigencia de una propuesta de cambio de ruta pendiente. */
  routeChangeTtlSeconds: number;
  /** Plazo para valorar tras el fin de viaje. */
  ratingWindowDays: number;
  publicPhotoBaseUrl: string | null;
  publicShareBaseUrl: string | null;
};

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid integer environment variable: ${name}`);
  }
  return value;
}

function urlEnv(name: string): string | null {
  const raw = process.env[name];
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) throw new Error(`${name} must start with http:// or https://`);
  return raw.replace(/\/+$/, "");
}

export function liveSettings(): LiveSettings {
  return {
    staleAfterSeconds: intEnv("LIVE_STALE_AFTER_SECONDS", 60, 5, 3600),
    arrivalWarningSeconds: intEnv("LIVE_ARRIVAL_WARNING_SECONDS", 300, 30, 1800),
    arrivedDistanceM: intEnv("LIVE_ARRIVED_DISTANCE_M", 100, 10, 1000),
    stopDwellSeconds: intEnv("LIVE_STOP_DWELL_SECONDS", 60, 0, 600),
    offRouteM: intEnv("LIVE_OFF_ROUTE_M", 300, 50, 5000),
    materialScheduleDeltaS: intEnv("LIVE_MATERIAL_SCHEDULE_DELTA_S", 180, 0, 3600),
    routeChangeTtlSeconds: intEnv("LIVE_ROUTE_CHANGE_TTL_SECONDS", 300, 30, 3600),
    ratingWindowDays: intEnv("LIVE_RATING_WINDOW_DAYS", 14, 1, 365),
    publicPhotoBaseUrl: urlEnv("PUBLIC_PHOTO_BASE_URL"),
    publicShareBaseUrl: urlEnv("PUBLIC_SHARE_BASE_URL")
  };
}

/** Longitud del código de recogida que emite el backend actual (trip-execution-service). */
export const PICKUP_CODE_LENGTH = 6;
export const MAX_INCIDENT_ATTACHMENTS = 5;
export const MAX_INCIDENT_ATTACHMENT_BYTES = 10 * 1024 * 1024;
