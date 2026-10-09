/**
 * Geometría mínima para la vista previa: distancias, punto en polígono, rumbo e interpolación.
 * Aproximaciones esféricas (radio medio 6 371 008,8 m). PostGIS usa el elipsoide WGS84; la diferencia (< 0,3 %)
 * no afecta a ninguna pantalla.
 */
import type { GeoLatLng } from "./types";

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

export type LngLat = [number, number];

/** Distancia ortodrómica en metros (fórmula de haversine). */
export function haversineM(a: GeoLatLng, b: GeoLatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return haversineM({ latitude: lat1, longitude: lng1 }, { latitude: lat2, longitude: lng2 });
}

/** Rumbo inicial en grados [0, 360). */
export function bearingDeg(a: GeoLatLng, b: GeoLatLng): number {
  const y = Math.sin(toRad(b.longitude - a.longitude)) * Math.cos(toRad(b.latitude));
  const x =
    Math.cos(toRad(a.latitude)) * Math.sin(toRad(b.latitude)) -
    Math.sin(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.cos(toRad(b.longitude - a.longitude));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Punto a fracción `t` (0–1) entre dos puntos (interpolación lineal en lat/lng: suficiente a escala provincial). */
export function lerpPoint(a: GeoLatLng, b: GeoLatLng, t: number): GeoLatLng {
  return { latitude: a.latitude + (b.latitude - a.latitude) * t, longitude: a.longitude + (b.longitude - a.longitude) * t };
}

/** ¿El punto está dentro (o sobre el borde) del anillo [lng, lat]? Ray casting. */
export function pointInRing(lat: number, lng: number, ring: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i] as readonly [number, number];
    const [xj, yj] = ring[j] as readonly [number, number];
    // sobre el borde cuenta como dentro (ST_CoveredBy)
    if (onSegment(lng, lat, xi, yi, xj, yj)) return true;
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function onSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): boolean {
  const cross = (px - x1) * (y2 - y1) - (py - y1) * (x2 - x1);
  if (Math.abs(cross) > 1e-12) return false;
  return px >= Math.min(x1, x2) - 1e-12 && px <= Math.max(x1, x2) + 1e-12 && py >= Math.min(y1, y2) - 1e-12 && py <= Math.max(y1, y2) + 1e-12;
}

/** Longitud de una polilínea [lng, lat] en metros. */
export function polylineLengthM(points: ReadonlyArray<readonly [number, number]>): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as readonly [number, number];
    const b = points[i] as readonly [number, number];
    total += distanceM(a[1], a[0], b[1], b[0]);
  }
  return total;
}

/** Punto situado a `meters` desde el inicio de la polilínea (se queda en el extremo si se pasa). */
export function pointAlong(points: ReadonlyArray<readonly [number, number]>, meters: number): GeoLatLng {
  if (points.length === 0) throw new Error("polilínea vacía");
  let remaining = Math.max(0, meters);
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as readonly [number, number];
    const b = points[i] as readonly [number, number];
    const seg = distanceM(a[1], a[0], b[1], b[0]);
    if (remaining <= seg && seg > 0) {
      const t = remaining / seg;
      return { latitude: a[1] + (b[1] - a[1]) * t, longitude: a[0] + (b[0] - a[0]) * t };
    }
    remaining -= seg;
  }
  const last = points[points.length - 1] as readonly [number, number];
  return { latitude: last[1], longitude: last[0] };
}

export function toLngLat(point: GeoLatLng): LngLat {
  return [point.longitude, point.latitude];
}
