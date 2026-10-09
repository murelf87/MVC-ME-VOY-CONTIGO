/** Cálculos puros de ubicación (sin módulos nativos). */

const EARTH_RADIUS_M = 6_371_008.8;

export interface LatLngLike {
  latitude: number;
  longitude: number;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Distancia entre dos puntos en metros (haversine). */
export function distanceMeters(a: LatLngLike, b: LatLngLike): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Por encima de este radio de incertidumbre la posición se considera aproximada (no apta para «aquí estoy»). */
export const APPROXIMATE_ACCURACY_M = 500;

export type PositionPrecision = "precise" | "approximate";

export function classifyPrecision(accuracyM: number | null, permissionIsCoarse: boolean): PositionPrecision {
  if (permissionIsCoarse) return "approximate";
  if (accuracyM !== null && accuracyM > APPROXIMATE_ACCURACY_M) return "approximate";
  return "precise";
}

export interface PositionThrottleOptions {
  /** Mínimo entre dos lecturas entregadas. Por defecto 5000 ms. */
  minIntervalMs?: number;
  /** Con `minIntervalMs` cumplido, exige además haberse movido tanto. 0 = solo tiempo. */
  minDistanceM?: number;
  /** Aunque no se haya movido, entrega una lectura cada `heartbeatMs` (para no parecer «sin señal»). */
  heartbeatMs?: number;
}

export interface TimedPoint extends LatLngLike {
  timestamp: number;
}

/**
 * Regulador de lecturas GPS: decide si una lectura nueva debe entregarse. La primera siempre pasa.
 * Pasa si ha transcurrido `minIntervalMs` y (se movió `minDistanceM` o venció el latido).
 */
export function createPositionThrottle(options: PositionThrottleOptions = {}): (point: TimedPoint) => boolean {
  const minIntervalMs = options.minIntervalMs ?? 5_000;
  const minDistanceM = options.minDistanceM ?? 0;
  const heartbeatMs = options.heartbeatMs ?? Number.POSITIVE_INFINITY;
  let last: TimedPoint | null = null;
  return (point) => {
    if (last) {
      const elapsed = point.timestamp - last.timestamp;
      if (elapsed < minIntervalMs) return false;
      const moved = distanceMeters(last, point) >= minDistanceM;
      if (!moved && elapsed < heartbeatMs) return false;
    }
    last = point;
    return true;
  };
}
