/**
 * SIMULACIÓN (solo vista previa): un conductor virtual que avanza por la ruta del viaje.
 *
 * En la app real las posiciones llegan del GPS (`@/platform` → `watchPosition`). En la vista previa web no hay GPS que se
 * mueva, así que este «sustituto» recorre la polilínea de la ruta a velocidad constante y entrega posiciones por la
 * MISMA tubería de envío que las reales (`POST /v1/trips/{id}/location`). La consola lo rotula como simulación y solo
 * en la compilación de vista previa. Código puro: sin reloj ni temporizadores (quien lo usa decide cuándo avanzar).
 */
import { pointAtDistance, polylineLengthM, projectOnPolyline, type LngLat } from "../logic/geo";

/** 50 km/h: rápido para ver el avance en la vista previa, plausible en carretera de acceso a Sevilla. */
export const SIM_SPEED_MPS = 14;

export interface WalkerState {
  lat: number;
  lng: number;
  headingDegrees: number;
  speedMps: number;
  distanceAlongM: number;
  totalM: number;
  /** Llegó al final de la ruta. */
  finished: boolean;
}

export interface RouteWalker {
  current(): WalkerState;
  /** Avanza `seconds` de conducción y devuelve el estado nuevo. */
  step(seconds: number): WalkerState;
}

export interface RouteWalkerOptions {
  speedMps?: number;
  /** Punto de partida: se proyecta sobre la ruta (p. ej. la última posición conocida). */
  start?: { lat: number; lng: number } | null;
}

/** `null` si la ruta tiene menos de dos puntos (no hay por dónde caminar). */
export function createRouteWalker(route: readonly LngLat[], options: RouteWalkerOptions = {}): RouteWalker | null {
  if (route.length < 2) return null;
  const total = polylineLengthM(route);
  if (!(total > 0)) return null;
  const speed = options.speedMps ?? SIM_SPEED_MPS;
  const projected = options.start ? projectOnPolyline(route, options.start.lat, options.start.lng) : null;
  let along = projected ? Math.min(total, projected.distanceAlongM) : 0;

  const state = (): WalkerState => {
    const point = pointAtDistance(route, along);
    if (!point) throw new Error("Ruta sin puntos");
    const finished = along >= total - 0.5;
    return {
      lat: point.lat,
      lng: point.lng,
      headingDegrees: point.headingDegrees,
      speedMps: finished ? 0 : speed,
      distanceAlongM: along,
      totalM: total,
      finished,
    };
  };

  return {
    current: state,
    step(seconds: number): WalkerState {
      along = Math.min(total, along + Math.max(0, seconds) * speed);
      return state();
    },
  };
}
