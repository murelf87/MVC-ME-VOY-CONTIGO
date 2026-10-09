/**
 * Geometría mínima y PURA para la consola del conductor (sin dependencias): distancias, proyección de un punto sobre una
 * ruta y punto a una distancia dada. Las rutas viajan como `[lng, lat]` (GeoJSON), igual que `TripRouteGeometry`.
 * Aproximación esférica (radio medio de la Tierra): a escala provincial el error es despreciable para estas pantallas.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** `[lng, lat]`. */
export type LngLat = readonly [number, number];

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (degrees: number): number => (degrees * Math.PI) / 180;
const deg = (radians: number): number => (radians * 180) / Math.PI;

/** Distancia ortodrómica en metros. */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const toLatLng = (p: LngLat): LatLng => ({ lat: p[1], lng: p[0] });

/** Rumbo inicial de `a` a `b` en grados [0, 360). */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Longitud de una polilínea en metros. */
export function polylineLengthM(points: readonly LngLat[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineM(toLatLng(points[i - 1] as LngLat), toLatLng(points[i] as LngLat));
  }
  return total;
}

export interface RouteProjection {
  /** Metros desde el inicio de la ruta hasta el punto proyectado. */
  distanceAlongM: number;
  /** Distancia (m) del punto a la ruta. */
  offRouteM: number;
  /** Longitud total de la ruta (m). */
  totalM: number;
  /** `distanceAlongM / totalM` en [0, 1] (0 si la ruta no tiene longitud). */
  fraction: number;
}

/** Proyecta un punto sobre la ruta: dónde va y cuánto se aleja de ella. `null` si la ruta está vacía. */
export function projectOnPolyline(points: readonly LngLat[], lat: number, lng: number): RouteProjection | null {
  const first = points[0];
  if (!first) return null;
  if (points.length === 1) {
    const off = haversineM({ lat, lng }, toLatLng(first));
    return { distanceAlongM: 0, offRouteM: off, totalM: 0, fraction: 0 };
  }
  const metersPerDegLat = (EARTH_RADIUS_M * Math.PI) / 180;
  const metersPerDegLng = metersPerDegLat * Math.cos(rad(lat));
  let travelled = 0;
  let bestOff = Number.POSITIVE_INFINITY;
  let bestAlong = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as LngLat;
    const b = points[i] as LngLat;
    const segmentM = haversineM(toLatLng(a), toLatLng(b));
    const bx = (b[0] - a[0]) * metersPerDegLng;
    const by = (b[1] - a[1]) * metersPerDegLat;
    const px = (lng - a[0]) * metersPerDegLng;
    const py = (lat - a[1]) * metersPerDegLat;
    const lengthSq = bx * bx + by * by;
    const t = lengthSq > 0 ? Math.min(1, Math.max(0, (px * bx + py * by) / lengthSq)) : 0;
    const off = Math.hypot(px - bx * t, py - by * t);
    if (off < bestOff) {
      bestOff = off;
      bestAlong = travelled + segmentM * t;
    }
    travelled += segmentM;
  }
  return {
    distanceAlongM: bestAlong,
    offRouteM: bestOff,
    totalM: travelled,
    fraction: travelled > 0 ? Math.min(1, bestAlong / travelled) : 0,
  };
}

export interface RoutePoint extends LatLng {
  /** Rumbo del tramo en ese punto, en grados [0, 360). */
  headingDegrees: number;
}

/** Punto a `meters` del inicio de la ruta (se queda en el extremo si se pasa). `null` si la ruta está vacía. */
export function pointAtDistance(points: readonly LngLat[], meters: number): RoutePoint | null {
  const first = points[0];
  if (!first) return null;
  if (points.length === 1) return { ...toLatLng(first), headingDegrees: 0 };
  let remaining = Math.max(0, meters);
  for (let i = 1; i < points.length; i += 1) {
    const a = toLatLng(points[i - 1] as LngLat);
    const b = toLatLng(points[i] as LngLat);
    const segmentM = haversineM(a, b);
    if (remaining <= segmentM && segmentM > 0) {
      const t = remaining / segmentM;
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t, headingDegrees: bearingDegrees(a, b) };
    }
    remaining -= segmentM;
  }
  const last = toLatLng(points[points.length - 1] as LngLat);
  const beforeLast = toLatLng(points[points.length - 2] as LngLat);
  return { ...last, headingDegrees: bearingDegrees(beforeLast, last) };
}

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** Caja que contiene todos los puntos; `null` si no hay ninguno. */
export function boundsOf(points: readonly LatLng[]): Bounds | null {
  const first = points[0];
  if (!first) return null;
  const box: Bounds = { minLat: first.lat, maxLat: first.lat, minLng: first.lng, maxLng: first.lng };
  for (const p of points) {
    box.minLat = Math.min(box.minLat, p.lat);
    box.maxLat = Math.max(box.maxLat, p.lat);
    box.minLng = Math.min(box.minLng, p.lng);
    box.maxLng = Math.max(box.maxLng, p.lng);
  }
  return box;
}

/** `[lng, lat][]` → puntos `{lat, lng}`. */
export function toLatLngs(points: readonly LngLat[]): LatLng[] {
  return points.map(toLatLng);
}
