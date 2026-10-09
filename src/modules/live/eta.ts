import { DomainError } from "../../errors.js";
import { clamp, type Db } from "./common.js";
import type { LiveSettings } from "./config.js";

/**
 * Modelo de ruta y ETA del módulo `live`.
 *
 * La ETA NO usa línea recta: proyecta la posición viva del conductor sobre la ruta por carretera guardada del viaje
 * (trips.route_geom) y suma los tramos planificados (trip_segments: distancia y duración del proveedor de rutas) hasta la
 * parada objetivo, más el tiempo de parada en las paradas intermedias. Sin posición viva usa la hora planificada.
 * El tráfico real exige proveedor de rutas (ver docs/contracts/live.md §11).
 */

export type RouteStop = {
  seq: number;
  label: string | null;
  kind: string;
  lat: number;
  lng: number;
  /** Fracción (0..1) de la ruta donde se proyecta la parada; no decreciente. */
  frac: number;
};

export type RouteSegment = { seq: number; distanceM: number; durationS: number; capacity: number };

export type RouteModel = {
  tripId: string;
  status: string;
  departureAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
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
};

export type LiveFix = {
  lat: number;
  lng: number;
  recordedAt: Date;
  receivedAt: Date;
  accuracyM: number | null;
  speedMps: number | null;
  headingDegrees: number | null;
  /** Fracción de la ruta donde se proyecta la posición; null si el viaje no tiene geometría. */
  frac: number | null;
  /** Distancia (m) de la posición a la ruta guardada. */
  offRouteM: number | null;
};

export async function loadRouteModel(db: Db, tripId: string): Promise<RouteModel> {
  const tripQ = await db.query<{
    id: string; status: string; departure_at: Date | null; started_at: Date | null; completed_at: Date | null;
    route_distance_m: number | null; route_duration_s: number | null; route_version: number; province_id: string;
    driver_user_id: string; vehicle_id: string; offered_seats: number; flexibility_minutes: number; max_detour_m: number;
  }>(
    `select id,status,departure_at,started_at,completed_at,route_distance_m,route_duration_s,route_version,
            province_id,driver_user_id,vehicle_id,offered_seats,flexibility_minutes,max_detour_m
       from trips where id=$1`,
    [tripId]
  );
  const trip = tripQ.rows[0];
  if (!trip) throw new DomainError("TRIP_NOT_FOUND", "Trip not found", 404);

  const stopsQ = await db.query<{
    seq: number; label: string | null; kind: string; lat: number; lng: number; frac: number | null;
  }>(
    `select s.seq, s.label, s.kind, ST_Y(s.geom) as lat, ST_X(s.geom) as lng,
            case when t.route_geom is null then null else ST_LineLocatePoint(t.route_geom, s.geom) end as frac
       from trip_stops s join trips t on t.id=s.trip_id
      where s.trip_id=$1 order by s.seq`,
    [tripId]
  );
  const segQ = await db.query<{ seq: number; distance_m: number; duration_s: number; capacity: number }>(
    `select seq, distance_m, duration_s, capacity from trip_segments where trip_id=$1 order by seq`,
    [tripId]
  );

  const segments: RouteSegment[] = segQ.rows.map(r => ({
    seq: r.seq, distanceM: r.distance_m, durationS: r.duration_s, capacity: r.capacity
  }));
  const fractions = normalizeFractions(stopsQ.rows.map(r => r.frac), segments);
  const stops: RouteStop[] = stopsQ.rows.map((r, index) => ({
    seq: r.seq, label: r.label, kind: r.kind, lat: Number(r.lat), lng: Number(r.lng), frac: fractions[index] ?? 0
  }));

  return {
    tripId: trip.id,
    status: trip.status,
    departureAt: trip.departure_at,
    startedAt: trip.started_at,
    completedAt: trip.completed_at,
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
    segments
  };
}

/**
 * Fracciones no decrecientes en [0,1]. Si falta la geometría de la ruta se reparten según la distancia planificada acumulada.
 */
export function normalizeFractions(raw: Array<number | null>, segments: RouteSegment[]): number[] {
  const n = raw.length;
  const out: number[] = [];
  const haveAll = raw.every(v => v !== null && Number.isFinite(v));
  if (haveAll) {
    let previous = 0;
    for (const value of raw) {
      const clamped = clamp(value as number, 0, 1);
      previous = Math.max(previous, clamped);
      out.push(previous);
    }
    return out;
  }
  const total = segments.reduce((sum, s) => sum + s.distanceM, 0);
  let cumulative = 0;
  for (let i = 0; i < n; i += 1) {
    out.push(total > 0 ? clamp(cumulative / total, 0, 1) : 0);
    cumulative += segments[i]?.distanceM ?? 0;
  }
  return out;
}

export async function loadLiveFix(db: Db, tripId: string): Promise<LiveFix | null> {
  const result = await db.query<{
    lat: number; lng: number; recorded_at: Date; received_at: Date;
    accuracy_m: string | null; speed_mps: string | null; heading_degrees: string | null;
    frac: number | null; off_route_m: number | null;
  }>(
    `select ST_Y(ls.geom) as lat, ST_X(ls.geom) as lng, ls.recorded_at, ls.received_at,
            ls.accuracy_m, ls.speed_mps, ls.heading_degrees,
            case when t.route_geom is null then null else ST_LineLocatePoint(t.route_geom, ls.geom) end as frac,
            case when t.route_geom is null then null
                 else ST_Distance(ls.geom::geography, ST_ClosestPoint(t.route_geom, ls.geom)::geography) end as off_route_m
       from trip_live_state ls join trips t on t.id=ls.trip_id
      where ls.trip_id=$1`,
    [tripId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    lat: Number(row.lat),
    lng: Number(row.lng),
    recordedAt: row.recorded_at,
    receivedAt: row.received_at,
    accuracyM: row.accuracy_m === null ? null : Number(row.accuracy_m),
    speedMps: row.speed_mps === null ? null : Number(row.speed_mps),
    headingDegrees: row.heading_degrees === null ? null : Number(row.heading_degrees),
    frac: row.frac === null ? null : Number(row.frac),
    offRouteM: row.off_route_m === null ? null : Number(row.off_route_m)
  };
}

export function signalOf(fix: LiveFix | null, now: Date, staleAfterSeconds: number): "live" | "stale" | "none" {
  if (!fix) return "none";
  const ageMs = now.getTime() - fix.recordedAt.getTime();
  return ageMs > staleAfterSeconds * 1000 ? "stale" : "live";
}

export function stopFractions(model: RouteModel): number[] {
  return model.stops.map(s => s.frac);
}

/** Segmento actual `c` (entre la parada c y la c+1) y avance `q` (0..1) dentro de él. */
export function currentProgress(fractions: number[], position: number): { c: number; q: number } {
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
  return currentProgress(stopFractions(model), fix.frac);
}

export function remainingBetween(
  model: RouteModel,
  c: number,
  q: number,
  target: number,
  dwellS: number
): { distanceM: number; durationS: number; passed: boolean } {
  if (target <= c) return { distanceM: 0, durationS: 0, passed: true };
  const current = model.segments[c];
  if (!current) return { distanceM: 0, durationS: 0, passed: false };
  let distanceM = current.distanceM * (1 - q);
  let durationS = current.durationS * (1 - q);
  for (let j = c + 1; j <= target - 1; j += 1) {
    const seg = model.segments[j];
    if (!seg) break;
    distanceM += seg.distanceM;
    durationS += seg.durationS + dwellS;
  }
  return { distanceM, durationS, passed: false };
}

/**
 * Hora planificada de llegada a la parada `target` (sin posición viva).
 * `basis: "live"` parte de la salida real si el viaje ya empezó; `basis: "schedule"` parte siempre de la hora publicada.
 */
export function plannedArrival(
  model: RouteModel, target: number, dwellS: number, basis: "live" | "schedule" = "live"
): Date | null {
  const base = basis === "schedule" ? model.departureAt : (model.startedAt ?? model.departureAt);
  if (!base || target < 0 || target >= model.stops.length) return null;
  let seconds = 0;
  for (let j = 0; j < target; j += 1) {
    const seg = model.segments[j];
    if (!seg) return null;
    seconds += seg.durationS + (j > 0 ? dwellS : 0);
  }
  return new Date(base.getTime() + seconds * 1000);
}

function averageSpeedMps(model: RouteModel): number {
  const distance = model.segments.reduce((sum, s) => sum + s.distanceM, 0);
  const duration = model.segments.reduce((sum, s) => sum + s.durationS, 0);
  return distance > 0 && duration > 0 ? distance / duration : 8;
}

export type EtaCalc = {
  at: Date;
  /** Segundos que faltan desde `now` (≥ 0). */
  remainingS: number;
  /** Distancia restante por la ruta (m); null si la ETA es planificada. */
  remainingM: number | null;
  source: "live_route" | "schedule";
  approximate: boolean;
  offRoute: boolean;
  /** El coche ya ha pasado (o está en) la parada. */
  passed: boolean;
};

export function computeEta(
  model: RouteModel,
  targetSeq: number,
  fix: LiveFix | null,
  now: Date,
  settings: LiveSettings
): EtaCalc | null {
  if (targetSeq < 0 || targetSeq >= model.stops.length || model.segments.length === 0) return null;

  const progress = progressOf(model, fix);
  if (progress && fix) {
    const rem = remainingBetween(model, progress.c, progress.q, targetSeq, settings.stopDwellSeconds);
    let distanceM = rem.distanceM;
    let durationS = rem.durationS;
    const offRoute = (fix.offRouteM ?? 0) > settings.offRouteM;
    if (offRoute && fix.offRouteM !== null) {
      distanceM += fix.offRouteM;
      durationS += fix.offRouteM / averageSpeedMps(model);
    }
    const at = new Date(fix.recordedAt.getTime() + Math.round(durationS * 1000));
    const stale = now.getTime() - fix.recordedAt.getTime() > settings.staleAfterSeconds * 1000;
    return {
      at,
      remainingS: Math.max(0, (at.getTime() - now.getTime()) / 1000),
      remainingM: Math.round(distanceM),
      source: "live_route",
      approximate: stale || offRoute,
      offRoute,
      passed: rem.passed
    };
  }

  const planned = plannedArrival(model, targetSeq, settings.stopDwellSeconds);
  if (!planned) return null;
  return {
    at: planned,
    remainingS: Math.max(0, (planned.getTime() - now.getTime()) / 1000),
    remainingM: null,
    source: "schedule",
    approximate: true,
    offRoute: false,
    passed: false
  };
}

export function minutesUntil(at: Date, now: Date): number {
  return Math.max(0, Math.ceil((at.getTime() - now.getTime()) / 60000));
}

export function stopAt(model: RouteModel, seq: number): RouteStop {
  const stop = model.stops.find(s => s.seq === seq);
  if (!stop) {
    throw new DomainError("TRIP_ROUTE_DATA_MISSING", "The trip is missing a stop required by this booking", 409, { seq });
  }
  return stop;
}

/** Suma de los tramos [from, to) (numeración de paradas de la solicitud). */
export function journeySums(model: RouteModel, fromSeq: number, toSeq: number): { distanceM: number; durationS: number } {
  let distanceM = 0;
  let durationS = 0;
  for (const seg of model.segments) {
    if (seg.seq >= fromSeq && seg.seq < toSeq) {
      distanceM += seg.distanceM;
      durationS += seg.durationS;
    }
  }
  return { distanceM, durationS };
}
