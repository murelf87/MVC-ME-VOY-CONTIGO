/**
 * Ajustes del módulo «trips». Se leen de variables de entorno en cada llamada (todas opcionales, con valores por
 * defecto seguros) para poder variar en pruebas. Documentadas en docs/contracts/trips.md §0 y §16.
 */
export type TripsSettings = {
  /** Duración del hold de plaza tras aceptar el conductor (cuenta atrás de la pantalla 16: 15 min). */
  holdTtlSeconds: number;
  /** Días por delante para los que se materializan las ocurrencias de una serie. */
  horizonDays: number;
  /** Intervalo del barrido interno (caducidad de holds + ampliación de series). 0 = sin temporizador. */
  sweepIntervalSeconds: number;
  /** Una posición GPS más vieja que esto no se presenta como «en directo». */
  liveStaleSeconds: number;
  rateSearchPerMinute: number;
  rateMapPerMinute: number;
  ratePlanPerMinute: number;
  /** Vigencia de las claves de idempotencia. */
  idempotencyTtlHours: number;
  /** Base pública de las fotos de perfil aprobadas; null → photoUrl siempre null. */
  publicMediaBaseUrl: string | null;
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

function urlEnv(...names: string[]): string | null {
  for (const name of names) {
    const raw = process.env[name]?.trim();
    if (!raw) continue;
    if (!/^https?:\/\//i.test(raw)) throw new Error(`${name} must start with http:// or https://`);
    return raw.replace(/\/+$/, "");
  }
  return null;
}

export function tripsSettings(): TripsSettings {
  return {
    holdTtlSeconds: intEnv("TRIPS_SEAT_HOLD_TTL_SECONDS", 900, 30, 3600),
    horizonDays: intEnv("TRIPS_SERIES_HORIZON_DAYS", 28, 7, 90),
    sweepIntervalSeconds: intEnv("TRIPS_SWEEP_INTERVAL_SECONDS", 30, 0, 86_400),
    liveStaleSeconds: intEnv("TRIPS_LIVE_STALE_SECONDS", 60, 5, 3600),
    rateSearchPerMinute: intEnv("TRIPS_RATE_SEARCH_PER_MINUTE", 30, 1, 100_000),
    rateMapPerMinute: intEnv("TRIPS_RATE_MAP_PER_MINUTE", 60, 1, 100_000),
    ratePlanPerMinute: intEnv("TRIPS_RATE_PLAN_PER_MINUTE", 20, 1, 100_000),
    idempotencyTtlHours: intEnv("TRIPS_IDEMPOTENCY_TTL_HOURS", 24, 1, 720),
    publicMediaBaseUrl: urlEnv("PUBLIC_MEDIA_BASE_URL", "PUBLIC_PHOTO_BASE_URL")
  };
}

/** Límites fijos del módulo (no configurables: forman parte del contrato). */
export const LIMITS = {
  maxFavorites: 20,
  maxRoutineEntries: 40,
  maxStops: 10,
  maxWeeks: 4,
  /** Máximo de ocurrencias en una reserva semanal (4 semanas × 7 días × 2 sentidos, acotado). */
  maxWeeklyOccurrences: 60,
  messageMax: 300,
  /** Radio máximo de las propuestas de punto de recogida (distancia en línea recta). */
  pickupSearchRadiusM: 2500,
  /** Estimación a pie: línea recta × 1,3 a 4,5 km/h. */
  walkFactor: 1.3,
  walkMetersPerMinute: 75,
  /** Estimación de desvío: 1 min de parada + 2 × distancia a la ruta a 30 km/h. */
  detourStopMinutes: 1,
  detourMetersPerMinute: 500
} as const;
