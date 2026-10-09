/**
 * Modelo de ruta y ETA del módulo `live` (`src/modules/live/eta.ts` + ajustes de `config.ts`) para la vista previa.
 *
 * La ETA NO usa línea recta: proyecta la posición viva del conductor sobre la ruta por carretera guardada del viaje
 * (`trips.route_geometry`) y suma los tramos planificados (`trip_segments`: distancia y duración) hasta la parada
 * objetivo, más el tiempo de parada en las paradas intermedias. Sin posición viva usa la hora planificada.
 *
 * Es lo que necesitan TODAS las pantallas de «viaje en directo» (consola del conductor, esperando el coche, en el coche,
 * enlace compartido): por eso vive en el dominio compartido de la vista previa. Es puro (sin red) y síncrono, con las
 * mismas fórmulas que el backend; las horas son milisegundos desde epoch.
 */
import type { PreviewDb } from "../core/db";
import { ApiFailure } from "../core/errors";
import { distanceM } from "../core/geo";

export interface LiveSettings {
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
}

/** Valores por defecto del backend (`liveSettings()` sin variables de entorno). */
export const LIVE_SETTINGS: Readonly<LiveSettings> = {
  staleAfterSeconds: 60,
  arrivalWarningSeconds: 300,
  arrivedDistanceM: 100,
  stopDwellSeconds: 60,
  offRouteM: 300,
  materialScheduleDeltaS: 180,
  routeChangeTtlSeconds: 300,
  ratingWindowDays: 14,
};

export interface RouteStop {
  seq: number;
  label: string | null;
  kind: string;
  lat: number;
  lng: number;
  /** Fracción (0..1) de la ruta donde se proyecta la parada; no decreciente. */
  frac: number;
}

export interface RouteSegment {
  seq: number;
  distanceM: number;
  durationS: number;
  capacity: number;
}

export interface RouteModel {
  tripId: string;
  status: string;
  departureAtMs: number | null;
  startedAtMs: number | null;
  completedAtMs: number | null;
  routeDistanceM: number | null;
  routeDurationS: number | null;
  routeVersion: number;
  provinceId: string;
  driverUserId: string;
  vehicleId: string;
  offeredSeats: number;
  flexibilityMinutes: number;
  maxDetourM: number;
  stops: RouteStop[];
  segments: RouteSegment[];
}

export interface LiveFix {
  lat: number;
  lng: number;
  recordedAtMs: number;
  receivedAtMs: number;
  accuracyM: number | null;
  speedMps: number | null;
  headingDegrees: number | null;
  /** Fracción de la ruta donde se proyecta la posición; null si el viaje no tiene geometría. */
  frac: number | null;
  /** Distancia (m) de la posición a la ruta guardada. */
  offRouteM: number | null;
}

export type LiveSignalKind = "live" | "stale" | "none";

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

// ── Proyección sobre la ruta (equivale a ST_LineLocatePoint / ST_Distance a la ruta) ─────────────────────────────────

export interface RouteProjection {
  /** Fracción (0..1) de la longitud de la ruta. */
  fraction: number;
  /** Distancia en metros del punto a la ruta. */
  offRouteM: number;
}

/** Proyecta `lat/lng` sobre la polilínea `[lng, lat]`. Devuelve `null` si la polilínea no tiene al menos dos puntos. */
export function projectOnRoute(points: ReadonlyArray<readonly [number, number]>, lat: number, lng: number): RouteProjection | null {
  if (points.length < 2) return null;
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as readonly [number, number];
    const b = points[i] as readonly [number, number];
    const length = distanceM(a[1], a[0], b[1], b[0]);
    lengths.push(length);
    total += length;
  }
  if (total <= 0) return null;

  const cosLat = Math.cos((lat * Math.PI) / 180);
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * cosLat;
  let best = { distance: Number.POSITIVE_INFINITY, along: 0 };
  let cumulative = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as readonly [number, number];
    const b = points[i] as readonly [number, number];
    const ax = (a[0] - lng) * metersPerDegLng;
    const ay = (a[1] - lat) * metersPerDegLat;
    const bx = (b[0] - lng) * metersPerDegLng;
    const by = (b[1] - lat) * metersPerDegLat;
    const dx = bx - ax;
    const dy = by - ay;
    const squared = dx * dx + dy * dy;
    const t = squared > 0 ? clamp(-(ax * dx + ay * dy) / squared, 0, 1) : 0;
    const px = ax + dx * t;
    const py = ay + dy * t;
    const distance = Math.sqrt(px * px + py * py);
    const length = lengths[i - 1] as number;
    if (distance < best.distance) best = { distance, along: cumulative + length * t };
    cumulative += length;
  }
  return { fraction: clamp(best.along / total, 0, 1), offRouteM: best.distance };
}

// ── Carga del modelo ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Fracciones no decrecientes en [0,1]. Si falta la geometría de la ruta se reparten según la distancia planificada
 * acumulada.
 */
export function normalizeFractions(raw: ReadonlyArray<number | null>, segments: readonly RouteSegment[]): number[] {
  const out: number[] = [];
  const haveAll = raw.every((value) => value !== null && Number.isFinite(value));
  if (haveAll) {
    let previous = 0;
    for (const value of raw) {
      previous = Math.max(previous, clamp(value as number, 0, 1));
      out.push(previous);
    }
    return out;
  }
  const total = segments.reduce((sum, segment) => sum + segment.distanceM, 0);
  let cumulative = 0;
  for (let i = 0; i < raw.length; i += 1) {
    out.push(total > 0 ? clamp(cumulative / total, 0, 1) : 0);
    cumulative += segments[i]?.distanceM ?? 0;
  }
  return out;
}

/** `loadRouteModel`: viaje + paradas + tramos. 404 `TRIP_NOT_FOUND` si el viaje no existe. */
export function loadRouteModel(db: PreviewDb, tripId: string): RouteModel {
  const trip = db.trips.get(tripId);
  if (!trip) throw new ApiFailure("TRIP_NOT_FOUND", "Trip not found", 404);
  const stopRows = db.tripStops.filter((s) => s.trip_id === tripId).sort((a, b) => a.seq - b.seq);
  const segments: RouteSegment[] = db.tripSegments
    .filter((s) => s.trip_id === tripId)
    .sort((a, b) => a.seq - b.seq)
    .map((s) => ({ seq: s.seq, distanceM: s.distance_m, durationS: s.duration_s, capacity: s.capacity }));
  const hasGeometry = trip.route_geometry.length >= 2;
  const raw = stopRows.map((stop) => (hasGeometry ? (projectOnRoute(trip.route_geometry, stop.lat, stop.lng)?.fraction ?? null) : null));
  const fractions = normalizeFractions(raw, segments);
  const stops: RouteStop[] = stopRows.map((stop, index) => ({
    seq: stop.seq,
    label: stop.label,
    kind: stop.kind,
    lat: stop.lat,
    lng: stop.lng,
    frac: fractions[index] ?? 0,
  }));
  return {
    tripId: trip.id,
    status: trip.status,
    departureAtMs: trip.departure_at,
    startedAtMs: trip.started_at,
    completedAtMs: trip.completed_at,
    routeDistanceM: trip.route_distance_m,
    routeDurationS: trip.route_duration_s,
    routeVersion: trip.route_version,
    provinceId: trip.province_id,
    driverUserId: trip.driver_user_id,
    vehicleId: trip.vehicle_id,
    offeredSeats: trip.offered_seats,
    flexibilityMinutes: trip.flexibility_minutes,
    maxDetourM: trip.max_detour_m,
    stops,
    segments,
  };
}

/** `loadLiveFix`: última posición viva del viaje, ya proyectada sobre su ruta. */
export function loadLiveFix(db: PreviewDb, tripId: string): LiveFix | null {
  const state = db.liveState.get(tripId);
  if (!state) return null;
  const trip = db.trips.get(tripId);
  const projection = trip ? projectOnRoute(trip.route_geometry, state.lat, state.lng) : null;
  return {
    lat: state.lat,
    lng: state.lng,
    recordedAtMs: state.recorded_at,
    receivedAtMs: state.received_at,
    accuracyM: state.accuracy_m,
    speedMps: state.speed_mps,
    headingDegrees: state.heading_degrees,
    frac: projection ? projection.fraction : null,
    offRouteM: projection ? projection.offRouteM : null,
  };
}

export function signalOf(fix: LiveFix | null, nowMs: number, staleAfterSeconds: number): LiveSignalKind {
  if (!fix) return "none";
  return nowMs - fix.recordedAtMs > staleAfterSeconds * 1000 ? "stale" : "live";
}

// ── Progreso y ETA ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Segmento actual `c` (entre la parada c y la c+1) y avance `q` (0..1) dentro de él. */
export function currentProgress(fractions: readonly number[], position: number): { c: number; q: number } {
  const segmentCount = fractions.length - 1;
  if (segmentCount < 1) return { c: 0, q: 0 };
  let c = 0;
  for (let j = 0; j < segmentCount; j += 1) {
    if ((fractions[j] as number) <= position) c = j;
    else break;
  }
  const from = fractions[c] as number;
  const to = fractions[c + 1] as number;
  const span = to - from;
  const q = span > 1e-9 ? clamp((position - from) / span, 0, 1) : position >= to ? 1 : 0;
  return { c, q };
}

/** Progreso del coche sobre la ruta (solo con viaje activo y posición proyectable). */
export function progressOf(model: RouteModel, fix: LiveFix | null): { c: number; q: number } | null {
  if (model.status !== "active" || !fix || fix.frac === null || model.stops.length < 2) return null;
  return currentProgress(
    model.stops.map((s) => s.frac),
    fix.frac,
  );
}

export function remainingBetween(
  model: RouteModel,
  c: number,
  q: number,
  target: number,
  dwellS: number,
): { distanceM: number; durationS: number; passed: boolean } {
  if (target <= c) return { distanceM: 0, durationS: 0, passed: true };
  const current = model.segments[c];
  if (!current) return { distanceM: 0, durationS: 0, passed: false };
  let distance = current.distanceM * (1 - q);
  let duration = current.durationS * (1 - q);
  for (let j = c + 1; j <= target - 1; j += 1) {
    const segment = model.segments[j];
    if (!segment) break;
    distance += segment.distanceM;
    duration += segment.durationS + dwellS;
  }
  return { distanceM: distance, durationS: duration, passed: false };
}

/**
 * Hora planificada de llegada a la parada `target` (sin posición viva). `basis: "live"` parte de la salida real si el
 * viaje ya empezó; `basis: "schedule"` parte siempre de la hora publicada.
 */
export function plannedArrival(model: RouteModel, target: number, dwellS: number, basis: "live" | "schedule" = "live"): number | null {
  const base = basis === "schedule" ? model.departureAtMs : (model.startedAtMs ?? model.departureAtMs);
  if (base === null || target < 0 || target >= model.stops.length) return null;
  let seconds = 0;
  for (let j = 0; j < target; j += 1) {
    const segment = model.segments[j];
    if (!segment) return null;
    seconds += segment.durationS + (j > 0 ? dwellS : 0);
  }
  return base + seconds * 1000;
}

function averageSpeedMps(model: RouteModel): number {
  const distance = model.segments.reduce((sum, s) => sum + s.distanceM, 0);
  const duration = model.segments.reduce((sum, s) => sum + s.durationS, 0);
  return distance > 0 && duration > 0 ? distance / duration : 8;
}

export interface EtaCalc {
  atMs: number;
  /** Segundos que faltan desde `now` (≥ 0). */
  remainingS: number;
  /** Distancia restante por la ruta (m); null si la ETA es planificada. */
  remainingM: number | null;
  source: "live_route" | "schedule";
  approximate: boolean;
  offRoute: boolean;
  /** El coche ya ha pasado (o está en) la parada. */
  passed: boolean;
}

export function computeEta(model: RouteModel, targetSeq: number, fix: LiveFix | null, nowMs: number, settings: LiveSettings = LIVE_SETTINGS): EtaCalc | null {
  if (targetSeq < 0 || targetSeq >= model.stops.length || model.segments.length === 0) return null;

  const progress = progressOf(model, fix);
  if (progress && fix) {
    const rem = remainingBetween(model, progress.c, progress.q, targetSeq, settings.stopDwellSeconds);
    let distance = rem.distanceM;
    let duration = rem.durationS;
    const offRoute = (fix.offRouteM ?? 0) > settings.offRouteM;
    if (offRoute && fix.offRouteM !== null) {
      distance += fix.offRouteM;
      duration += fix.offRouteM / averageSpeedMps(model);
    }
    const atMs = fix.recordedAtMs + Math.round(duration * 1000);
    const stale = nowMs - fix.recordedAtMs > settings.staleAfterSeconds * 1000;
    return {
      atMs,
      remainingS: Math.max(0, (atMs - nowMs) / 1000),
      remainingM: Math.round(distance),
      source: "live_route",
      approximate: stale || offRoute,
      offRoute,
      passed: rem.passed,
    };
  }

  const planned = plannedArrival(model, targetSeq, settings.stopDwellSeconds);
  if (planned === null) return null;
  return {
    atMs: planned,
    remainingS: Math.max(0, (planned - nowMs) / 1000),
    remainingM: null,
    source: "schedule",
    approximate: true,
    offRoute: false,
    passed: false,
  };
}

export function minutesUntil(atMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((atMs - nowMs) / 60_000));
}

/** 409 `TRIP_ROUTE_DATA_MISSING` si el viaje no tiene esa parada. */
export function stopAt(model: RouteModel, seq: number): RouteStop {
  const stop = model.stops.find((s) => s.seq === seq);
  if (!stop) throw new ApiFailure("TRIP_ROUTE_DATA_MISSING", "The trip is missing a stop required by this booking", 409, { seq });
  return stop;
}

/** Suma de los tramos [from, to) (numeración de paradas de la solicitud). */
export function journeySums(model: RouteModel, fromSeq: number, toSeq: number): { distanceM: number; durationS: number } {
  let distance = 0;
  let duration = 0;
  for (const segment of model.segments) {
    if (segment.seq >= fromSeq && segment.seq < toSeq) {
      distance += segment.distanceM;
      duration += segment.durationS;
    }
  }
  return { distanceM: distance, durationS: duration };
}

/** Cuadrícula de ~1 km (0,01°) de las posiciones que no deben darse con precisión. */
export function approximateCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}
