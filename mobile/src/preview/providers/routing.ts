/**
 * Proveedor de rutas SIMULADO (equivale a `GoogleMapsProvider#computeRoutes`). Genera una polilínea suave y
 * determinista entre los puntos (una curva con unos 10 vértices por tramo) y una segunda alternativa que se curva
 * hacia el otro lado. Distancia y duración son estimaciones (polilínea × 1,15; 30–58 km/h según el tramo): no usan
 * ninguna red viaria real.
 */
import { polylineLengthM, type LngLat } from "../core/geo";
import { sha256Hex } from "../core/sha256";
import type { GeoLatLng } from "../core/types";

export const ROUTE_PROVIDER_NAME = "preview-sim";

export interface RouteCandidate {
  provider: string;
  providerRef: string;
  distanceMeters: number;
  durationSeconds: number;
  geometry: { type: "LineString"; coordinates: LngLat[] };
  labels: string[];
}

export interface RouteComputationRequest {
  origin: GeoLatLng;
  destination: GeoLatLng;
  intermediates?: readonly GeoLatLng[];
  departureTime?: string;
  alternatives: boolean;
}

const SAMPLES = 10;
const ROAD_FACTOR = 1.15;

function speedMps(distanceM: number): number {
  if (distanceM <= 8_000) return 8.3; // ≈ 30 km/h urbano
  if (distanceM <= 30_000) return 11.5; // ≈ 41 km/h metropolitano
  return 16; // ≈ 58 km/h interurbano
}

/** Pseudoaleatorio estable de 0 a 1 a partir de unas coordenadas. */
function unit(seed: string): number {
  const hex = sha256Hex(seed).slice(0, 8);
  return parseInt(hex, 16) / 0xffffffff;
}

function leg(a: GeoLatLng, b: GeoLatLng, side: 1 | -1): LngLat[] {
  const dLat = b.latitude - a.latitude;
  const dLng = b.longitude - a.longitude;
  const length = Math.hypot(dLat, dLng) || 1e-9;
  // vector perpendicular unitario
  const pLat = -dLng / length;
  const pLng = dLat / length;
  const wobble = 0.05 + unit(`${a.latitude},${a.longitude}>${b.latitude},${b.longitude}`) * 0.07;
  const bend = length * wobble * side;
  const out: LngLat[] = [[a.longitude, a.latitude]];
  for (let i = 1; i < SAMPLES; i += 1) {
    const t = i / SAMPLES;
    const offset = Math.sin(Math.PI * t) * bend + Math.sin(2 * Math.PI * t) * bend * 0.25;
    out.push([a.longitude + dLng * t + pLng * offset, a.latitude + dLat * t + pLat * offset]);
  }
  out.push([b.longitude, b.latitude]);
  return out;
}

function candidate(points: readonly GeoLatLng[], side: 1 | -1, label: string): RouteCandidate {
  const coordinates: LngLat[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const part = leg(points[i] as GeoLatLng, points[i + 1] as GeoLatLng, side);
    coordinates.push(...(i === 0 ? part : part.slice(1)));
  }
  const raw = polylineLengthM(coordinates);
  const distanceMeters = Math.round(raw * ROAD_FACTOR);
  const durationSeconds = Math.round(distanceMeters / speedMps(distanceMeters));
  const ref = sha256Hex(JSON.stringify(coordinates)).slice(0, 24);
  return {
    provider: ROUTE_PROVIDER_NAME,
    providerRef: `${ROUTE_PROVIDER_NAME}-${ref}`,
    distanceMeters,
    durationSeconds,
    geometry: { type: "LineString", coordinates },
    labels: [label],
  };
}

export function computeRoutes(request: RouteComputationRequest): RouteCandidate[] {
  const points = [request.origin, ...(request.intermediates ?? []), request.destination];
  const primary = candidate(points, 1, "DEFAULT_ROUTE");
  if (!request.alternatives) return [primary];
  return [primary, candidate(points, -1, "DEFAULT_ROUTE_ALTERNATE")];
}

/** `route_provider_ref` de una ruta combinada por tramos (misma forma que el backend: `<proveedor>-segments-sha256:<hex>`). */
export function segmentsRef(segments: readonly RouteCandidate[]): string {
  return `${ROUTE_PROVIDER_NAME}-segments-sha256:${sha256Hex(JSON.stringify(segments.map((s) => s.providerRef)))}`;
}
