/**
 * Utilidades geográficas puras del módulo de mapas (sin dependencias de React ni de react-native-maps).
 * Proyección Web Mercator (EPSG:3857) con tiles de 256 pt, igual que Apple Maps / Google Maps / el sustituto web.
 */
import type { EdgePadding, MapBounds, MapPoint, MapRegion } from './types';

const TILE = 256;
const EARTH_RADIUS_M = 6371008.8;
const MAX_LAT = 85.0511;

/** Centro de Sevilla (Catedral / Giralda). Punto de partida del mapa cuando no hay otra cosa que encuadrar. */
export const SEVILLA_CENTER: MapPoint = { lat: 37.3859, lng: -5.9926 };

/** Devuelve el centro de Sevilla (copia). */
export function sevillaCenter(): MapPoint {
  return { ...SEVILLA_CENTER };
}

/** Región por defecto: la ciudad y su área metropolitana cercana (≈ 22 km de ancho). */
export const SEVILLA_REGION: MapRegion = { lat: 37.3891, lng: -5.9845, latDelta: 0.19, lngDelta: 0.2 };

/** Rectángulo que cubre la provincia de Sevilla (aproximado, para encuadres amplios). */
export const SEVILLA_PROVINCE_BOUNDS: MapBounds = { sw: { lat: 36.85, lng: -6.55 }, ne: { lat: 37.85, lng: -4.95 } };

const toRad = (d: number): number => (d * Math.PI) / 180;
const toDeg = (r: number): number => (r * 180) / Math.PI;

export const mercatorX = (lng: number): number => (lng + 180) / 360;
export function mercatorY(lat: number): number {
  const s = Math.sin(toRad(Math.max(-MAX_LAT, Math.min(MAX_LAT, lat))));
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}
export const lngFromMercatorX = (x: number): number => x * 360 - 180;
export const latFromMercatorY = (y: number): number => toDeg(Math.atan(Math.sinh(Math.PI * (1 - 2 * y))));

/** `true` si el valor es un punto con coordenadas finitas dentro de rango. */
export function isValidPoint(p: MapPoint | null | undefined): p is MapPoint {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

/** Distancia en metros (haversine). */
export function distanceMeters(a: MapPoint, b: MapPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Longitud (m) de una polilínea. */
export function polylineLengthMeters(points: readonly MapPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceMeters(points[i - 1] as MapPoint, points[i] as MapPoint);
  return total;
}

/** Rumbo inicial (grados, 0 = norte) de `a` hacia `b`. */
export function bearingDegrees(a: MapPoint, b: MapPoint): number {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Punto situado a `meters` del inicio siguiendo la polilínea (se queda en el último punto si se pasa). */
export function pointAlong(points: readonly MapPoint[], meters: number): MapPoint | null {
  const first = points[0];
  if (!first) return null;
  let remaining = Math.max(0, meters);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as MapPoint;
    const b = points[i] as MapPoint;
    const seg = distanceMeters(a, b);
    if (seg >= remaining && seg > 0) {
      const t = remaining / seg;
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    }
    remaining -= seg;
  }
  return points[points.length - 1] ?? first;
}

/** Rectángulo mínimo que contiene los puntos válidos; `null` si no hay ninguno. */
export function boundsOf(points: readonly (MapPoint | null | undefined)[]): MapBounds | null {
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const p of points) {
    if (!isValidPoint(p)) continue;
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
    west = Math.min(west, p.lng);
    east = Math.max(east, p.lng);
  }
  return north < south ? null : { sw: { lat: south, lng: west }, ne: { lat: north, lng: east } };
}

export function boundsCenter(b: MapBounds): MapPoint {
  return { lat: (b.sw.lat + b.ne.lat) / 2, lng: (b.sw.lng + b.ne.lng) / 2 };
}

export function regionToBounds(r: MapRegion): MapBounds {
  return { sw: { lat: r.lat - r.latDelta / 2, lng: r.lng - r.lngDelta / 2 }, ne: { lat: r.lat + r.latDelta / 2, lng: r.lng + r.lngDelta / 2 } };
}

export function normalizePadding(p?: Partial<EdgePadding> | number): EdgePadding {
  if (typeof p === 'number') return { top: p, right: p, bottom: p, left: p };
  return { top: p?.top ?? 0, right: p?.right ?? 0, bottom: p?.bottom ?? 0, left: p?.left ?? 0 };
}

export interface FitBoundsOptions {
  /** Márgenes en pt (número = los cuatro lados). Por defecto 40. */
  padding?: Partial<EdgePadding> | number;
  /** Tamaño del mapa en pt. Si se omite se asume 393 × 420. */
  viewport?: { width: number; height: number };
  /** Zoom máximo (para un solo punto o puntos muy juntos). Por defecto 15.5. */
  maxZoom?: number;
}

/**
 * Región que encuadra los puntos dentro de `viewport` respetando `padding` (Web Mercator).
 * Con un solo punto devuelve una región centrada a `maxZoom`. Con ninguno devuelve `SEVILLA_REGION`.
 */
export function fitBounds(input: readonly (MapPoint | null | undefined)[] | MapBounds, options: FitBoundsOptions = {}): MapRegion {
  const bounds = Array.isArray(input) ? boundsOf(input as readonly (MapPoint | null | undefined)[]) : (input as MapBounds);
  if (!bounds) return SEVILLA_REGION;
  const pad = normalizePadding(options.padding ?? 40);
  const w = Math.max(60, options.viewport?.width ?? 393);
  const h = Math.max(60, options.viewport?.height ?? 420);
  const innerW = Math.max(40, w - pad.left - pad.right);
  const innerH = Math.max(40, h - pad.top - pad.bottom);
  const x0 = mercatorX(bounds.sw.lng);
  const x1 = mercatorX(bounds.ne.lng);
  const y0 = mercatorY(bounds.ne.lat);
  const y1 = mercatorY(bounds.sw.lat);
  const spanX = Math.max(x1 - x0, 1e-9);
  const spanY = Math.max(y1 - y0, 1e-9);
  const zoom = Math.min(options.maxZoom ?? 15.5, Math.log2(innerW / (spanX * TILE)), Math.log2(innerH / (spanY * TILE)));
  const world = TILE * 2 ** zoom;
  // El centro del encuadre se desplaza según el desequilibrio de márgenes (hoja inferior = centro más abajo).
  const cx = (x0 + x1) / 2 + (pad.right - pad.left) / 2 / world;
  const cy = (y0 + y1) / 2 + (pad.bottom - pad.top) / 2 / world;
  const top = latFromMercatorY(cy - h / 2 / world);
  const bottom = latFromMercatorY(cy + h / 2 / world);
  return { lat: latFromMercatorY(cy), lng: lngFromMercatorX(cx), latDelta: Math.abs(top - bottom), lngDelta: (w / world) * 360 };
}

/** Región centrada en un punto a un zoom Web Mercator dado (para un viewport conocido). */
export function regionForZoom(center: MapPoint, zoom: number, viewport: { width: number; height: number }): MapRegion {
  const world = TILE * 2 ** zoom;
  const cy = mercatorY(center.lat);
  const top = latFromMercatorY(cy - viewport.height / 2 / world);
  const bottom = latFromMercatorY(cy + viewport.height / 2 / world);
  return { lat: center.lat, lng: center.lng, latDelta: Math.abs(top - bottom), lngDelta: (viewport.width / world) * 360 };
}

/** Zoom Web Mercator equivalente de una región para un ancho de mapa dado. */
export function zoomForRegion(region: MapRegion, viewportWidth: number): number {
  return Math.log2((viewportWidth * 360) / Math.max(1e-9, region.lngDelta) / TILE);
}

/** Copia de un arreglo de puntos sin elementos inválidos. */
export function validPoints(points: readonly (MapPoint | null | undefined)[]): MapPoint[] {
  return points.filter(isValidPoint);
}
