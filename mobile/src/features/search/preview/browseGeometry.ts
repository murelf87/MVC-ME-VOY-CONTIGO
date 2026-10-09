/**
 * Geometría y capacidad de un viaje para el servidor simulado de «buscar y ver viajes»: paradas con su posición sobre la
 * ruta, tramos con ocupación, tiempos y distancias acumulados, puntos de recogida (parada declarada o proyección sobre la
 * ruta si el viaje recoge «en ruta») y el identificador OPACO `pickupPointId`.
 *
 * Porta, sobre la base en memoria, las funciones de `src/modules/trips/{trip-data,pickup-service}.ts` del backend real.
 * SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`).
 */
import type { GeoPoint } from "@/api/types";
import { haversineM, occupiedOnSegment, type PreviewDb, type TripRow } from "@/preview";
import type { TripMetaRow } from "./browseMeta";

/** Estimación a pie: línea recta × 1,3 a 4,5 km/h. */
const WALK_FACTOR = 1.3;
const WALK_METERS_PER_MINUTE = 75;
/** Estimación de desvío: 1 min de parada + 2 × distancia a la ruta a 30 km/h. */
const DETOUR_STOP_MINUTES = 1;
const DETOUR_METERS_PER_MINUTE = 500;

export function distM(a: GeoPoint, b: GeoPoint): number {
  return haversineM({ latitude: a.lat, longitude: a.lng }, { latitude: b.lat, longitude: b.lng });
}

export interface WalkEstimate {
  minutes: number;
  distanceM: number;
}

export function walkEstimate(straightM: number): WalkEstimate {
  const distanceM = Math.round(straightM * WALK_FACTOR);
  return { distanceM, minutes: distanceM <= 0 ? 0 : Math.max(1, Math.ceil(distanceM / WALK_METERS_PER_MINUTE)) };
}

export function detourEstimateMinutes(distanceToRouteM: number): number {
  return DETOUR_STOP_MINUTES + Math.ceil((2 * Math.max(0, distanceToRouteM)) / DETOUR_METERS_PER_MINUTE);
}

/** `ST_SnapToGrid(…, 0.001)`: tres decimales (≈110 m), lo que ve quien no participa en el viaje. */
export function approx3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function minutesFromSeconds(seconds: number): number {
  return Math.max(0, Math.round(seconds / 60));
}

// ---------------------------------------------------------------------------------------------------------------
// Paradas y tramos
// ---------------------------------------------------------------------------------------------------------------

export type StopKind = "origin" | "stop" | "destination";

export interface StopView {
  seq: number;
  kind: StopKind;
  label: string | null;
  lat: number;
  lng: number;
  optional: boolean;
  detourMinutes: number | null;
  /** Fracción (0..1) de la ruta en la que cae la parada, forzada a no decreciente. */
  frac: number;
}

export interface SegmentView {
  seq: number;
  fromStopSeq: number;
  toStopSeq: number;
  distanceM: number;
  durationS: number;
  capacity: number;
  occupied: number;
}

export interface TripGeometry {
  stops: StopView[];
  segments: SegmentView[];
  /** Segundos desde la salida hasta cada parada. */
  offsets: number[];
  /** Metros de carretera acumulados hasta cada parada. */
  distances: number[];
  /** Geometría de la ruta [lng, lat]. */
  route: ReadonlyArray<readonly [number, number]>;
}

export interface RouteProjection {
  point: GeoPoint;
  distanceM: number;
  /** Fracción (0..1) de la longitud de la ruta. */
  fraction: number;
}

/** Punto de la ruta más cercano a `target` (aproximación plana local: suficiente a escala provincial). */
export function projectOnRoute(route: ReadonlyArray<readonly [number, number]>, target: GeoPoint): RouteProjection | null {
  if (route.length < 2) return null;
  const metersPerDegLat = 111_195;
  const metersPerDegLng = 111_195 * Math.cos((target.lat * Math.PI) / 180);
  const cumulative: number[] = [0];
  for (let i = 1; i < route.length; i += 1) {
    const a = route[i - 1] as readonly [number, number];
    const b = route[i] as readonly [number, number];
    cumulative.push((cumulative[i - 1] ?? 0) + distM({ lat: a[1], lng: a[0] }, { lat: b[1], lng: b[0] }));
  }
  const total = cumulative[cumulative.length - 1] ?? 0;
  let best: { index: number; t: number; px: number; py: number; dist: number } | null = null;
  for (let i = 1; i < route.length; i += 1) {
    const a = route[i - 1] as readonly [number, number];
    const b = route[i] as readonly [number, number];
    const ax = (a[0] - target.lng) * metersPerDegLng;
    const ay = (a[1] - target.lat) * metersPerDegLat;
    const bx = (b[0] - target.lng) * metersPerDegLng;
    const by = (b[1] - target.lat) * metersPerDegLat;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const dist = Math.hypot(px, py);
    if (best === null || dist < best.dist) best = { index: i, t, px, py, dist };
  }
  if (best === null) return null;
  const start = cumulative[best.index - 1] ?? 0;
  const end = cumulative[best.index] ?? start;
  return {
    point: { lat: target.lat + best.py / metersPerDegLat, lng: target.lng + best.px / metersPerDegLng },
    distanceM: best.dist,
    fraction: total > 0 ? (start + best.t * (end - start)) / total : 0,
  };
}

export function loadTripGeometry(db: PreviewDb, trip: Readonly<TripRow>, meta: TripMetaRow): TripGeometry {
  const route = trip.route_geometry;
  const rows = db.tripStops.filter((s) => s.trip_id === trip.id).sort((a, b) => a.seq - b.seq);
  const stops: StopView[] = [];
  for (const row of rows) {
    const projected = projectOnRoute(route, { lat: row.lat, lng: row.lng });
    const previous = stops[stops.length - 1];
    const optional = meta.optionalStops.find((o) => o.seq === row.seq);
    stops.push({
      seq: row.seq,
      kind: row.kind,
      label: row.label,
      lat: row.lat,
      lng: row.lng,
      optional: optional !== undefined,
      detourMinutes: optional ? optional.detourMinutes : null,
      frac: Math.max(projected?.fraction ?? previous?.frac ?? 0, previous?.frac ?? 0),
    });
  }
  const segments: SegmentView[] = db.tripSegments
    .filter((s) => s.trip_id === trip.id)
    .sort((a, b) => a.seq - b.seq)
    .map((s) => ({
      seq: s.seq,
      fromStopSeq: s.from_stop_seq,
      toStopSeq: s.to_stop_seq,
      distanceM: s.distance_m,
      durationS: s.duration_s,
      capacity: s.capacity,
      occupied: occupiedOnSegment(db, trip.id, s.seq),
    }));
  const offsets: number[] = [];
  const distances: number[] = [];
  let seconds = 0;
  let meters = 0;
  for (let i = 0; i < stops.length; i += 1) {
    offsets.push(seconds);
    distances.push(meters);
    const segment = segments.find((s) => s.seq === i);
    seconds += segment?.durationS ?? 0;
    meters += segment?.distanceM ?? 0;
  }
  return { stops, segments, offsets, distances, route };
}

/** Plazas libres mínimas en los tramos [from, to). 0 si el rango no existe. */
export function freeSeatsInRange(segments: readonly SegmentView[], from: number, to: number): number {
  let min = Number.POSITIVE_INFINITY;
  let found = 0;
  for (const segment of segments) {
    if (segment.seq >= from && segment.seq < to) {
      found += 1;
      min = Math.min(min, segment.capacity - segment.occupied);
    }
  }
  return found === 0 || !Number.isFinite(min) ? 0 : Math.max(0, min);
}

/** Máximo de plazas libres en cualquier tramo (lo que muestra el mapa: «2 plazas»). */
export function maxFreeSeats(segments: readonly SegmentView[]): number {
  let max = 0;
  for (const segment of segments) max = Math.max(max, segment.capacity - segment.occupied);
  return Math.max(0, max);
}

export interface RoutePosition {
  segmentSeq: number;
  offsetS: number;
  distanceFromStartM: number;
}

/** Convierte una fracción de ruta en tramo + tiempo + distancia. */
export function positionOnRoute(geo: TripGeometry, fraction: number): RoutePosition {
  const { stops, segments, offsets, distances } = geo;
  const lastSegment = Math.max(0, stops.length - 2);
  let k = 0;
  for (let i = 0; i <= lastSegment; i += 1) {
    if ((stops[i]?.frac ?? 0) <= fraction) k = i;
  }
  const a = stops[k]?.frac ?? 0;
  const b = stops[k + 1]?.frac ?? a;
  const t = b > a ? Math.min(1, Math.max(0, (fraction - a) / (b - a))) : 0;
  const segment = segments.find((s) => s.seq === k);
  return {
    segmentSeq: k,
    offsetS: Math.round((offsets[k] ?? 0) + t * (segment?.durationS ?? 0)),
    distanceFromStartM: Math.round((distances[k] ?? 0) + t * (segment?.distanceM ?? 0)),
  };
}

export function canBoardAt(stop: StopView, lastSeq: number): boolean {
  return (stop.kind === "origin" || stop.kind === "stop") && stop.seq < lastSeq;
}

export function canAlightAt(stop: StopView): boolean {
  return (stop.kind === "stop" || stop.kind === "destination") && stop.seq >= 1;
}

// ---------------------------------------------------------------------------------------------------------------
// Puntos de recogida
// ---------------------------------------------------------------------------------------------------------------

export interface PickupOption {
  source: "driver_stop" | "route_projection";
  location: GeoPoint;
  /** Parada declarada (seq) o null si es una proyección sobre la ruta. */
  stopSeq: number | null;
  /** Tramo desde el que el pasajero ocupa plaza. */
  segmentSeq: number;
  offsetS: number;
  distanceFromStartM: number;
  /** Distancia en línea recta entre la persona y el punto (m). */
  straightM: number;
  walkMinutes: number | null;
  detourMinutes: number;
  detourSource: "stop" | "estimate";
  label: string | null;
}

export function declaredOption(stop: StopView, geo: TripGeometry, from: GeoPoint): PickupOption {
  const straightM = distM(from, { lat: stop.lat, lng: stop.lng });
  return {
    source: "driver_stop",
    location: { lat: stop.lat, lng: stop.lng },
    stopSeq: stop.seq,
    segmentSeq: stop.seq,
    offsetS: geo.offsets[stop.seq] ?? 0,
    distanceFromStartM: geo.distances[stop.seq] ?? 0,
    straightM,
    walkMinutes: walkEstimate(straightM).minutes,
    detourMinutes: stop.detourMinutes ?? 0,
    detourSource: "stop",
    label: stop.label,
  };
}

/** Mejor subida para una persona en `from`: parada declarada o proyección sobre la ruta (si el viaje la admite). */
export function bestPickupOption(geo: TripGeometry, meta: TripMetaRow, from: GeoPoint, radiusM: number): PickupOption | null {
  const lastSeq = geo.stops.length - 1;
  let best: PickupOption | null = null;
  for (const stop of geo.stops) {
    if (!canBoardAt(stop, lastSeq)) continue;
    const distance = distM(from, { lat: stop.lat, lng: stop.lng });
    if (distance <= radiusM && (best === null || distance < best.straightM)) best = declaredOption(stop, geo, from);
  }
  if (meta.pickupOnRoute) {
    const projection = projectOnRoute(geo.route, from);
    if (projection && projection.distanceM <= radiusM) {
      const straightM = distM(from, projection.point);
      if (best === null || straightM < best.straightM - 25) {
        const position = positionOnRoute(geo, projection.fraction);
        const detour = detourEstimateMinutes(0);
        if (position.segmentSeq < lastSeq && detour <= meta.maxDetourMinutes) {
          best = {
            source: "route_projection",
            location: projection.point,
            stopSeq: null,
            segmentSeq: position.segmentSeq,
            offsetS: position.offsetS,
            distanceFromStartM: position.distanceFromStartM,
            straightM,
            walkMinutes: walkEstimate(straightM).minutes,
            detourMinutes: detour,
            detourSource: "estimate",
            label: null,
          };
        }
      }
    }
  }
  return best;
}

/** Parada de bajada más próxima a `to` posterior a la subida (null si ninguna está dentro del radio). */
export function bestDropoffStop(geo: TripGeometry, pickup: PickupOption, to: GeoPoint, radiusM: number): { stop: StopView; straightM: number } | null {
  let best: { stop: StopView; straightM: number } | null = null;
  for (const stop of geo.stops) {
    if (!canAlightAt(stop) || stop.seq <= pickup.segmentSeq) continue;
    const straightM = distM(to, { lat: stop.lat, lng: stop.lng });
    if (straightM <= radiusM && (best === null || straightM < best.straightM)) best = { stop, straightM };
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------
// Identificador opaco de un punto de recogida (mismo formato que el backend real: `pp1_` + base64url del JSON)
// ---------------------------------------------------------------------------------------------------------------

export function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
}

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

export function encodePickupId(tripId: string, point: GeoPoint, stopSeq: number | null, walkMinutes: number | null): string {
  return `pp1_${toBase64Url(JSON.stringify([1, tripId, round6(point.lat), round6(point.lng), stopSeq, walkMinutes]))}`;
}

export interface DecodedPickupId {
  tripId: string;
  lat: number;
  lng: number;
  stopSeq: number | null;
  walkMinutes: number | null;
}

export function decodePickupId(id: string): DecodedPickupId | null {
  if (!id.startsWith("pp1_") || id.length > 300) return null;
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(id.slice(4)));
    if (!Array.isArray(parsed) || parsed.length < 5 || parsed.length > 6 || parsed[0] !== 1) return null;
    const [, tripId, lat, lng, stopSeq, walk] = parsed as [number, unknown, unknown, unknown, unknown, unknown];
    if (typeof tripId !== "string" || typeof lat !== "number" || typeof lng !== "number") return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    if (stopSeq !== null && !(typeof stopSeq === "number" && Number.isInteger(stopSeq) && stopSeq >= 0)) return null;
    const walkMinutes = typeof walk === "number" && Number.isInteger(walk) && walk >= 0 && walk <= 240 ? walk : null;
    return { tripId, lat, lng, stopSeq: stopSeq as number | null, walkMinutes };
  } catch {
    return null;
  }
}
