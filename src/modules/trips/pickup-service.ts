import type { GeocodingProvider } from "../../maps/types.js";
import type { Db } from "./common.js";
import { approx3, localTimeOf, pointOf, haversineM } from "./common.js";
import { err } from "./errors.js";
import { LIMITS } from "./settings.js";
import {
  positionOnRoute, stopDistances, stopOffsets, stopPoint,
  type SegmentLoad, type StopRow, type TripRow
} from "./trip-data.js";
import type { GeoPoint, PickupPointsResponse, PickupProposal, PrecisePoint } from "./types.js";

/** Un punto de subida ya resuelto (declarado por el conductor o proyectado sobre la ruta). */
export type PickupOption = {
  source: "driver_stop" | "route_projection";
  location: GeoPoint;
  /** Parada declarada (seq) o null si es una proyección sobre la ruta. */
  stopSeq: number | null;
  /** Tramo desde el que el pasajero ocupa plaza (el que contiene el punto). */
  segmentSeq: number;
  /** Segundos desde la salida hasta la subida. */
  offsetS: number;
  /** Metros de carretera desde el origen del viaje hasta la subida. */
  distanceFromStartM: number;
  /** Distancia en línea recta entre el pasajero y el punto (m). */
  straightM: number;
  /** Minutos a pie estimados (de la propuesta mostrada); null si no se conoce. */
  walkMinutes: number | null;
  detourMinutes: number;
  detourSource: "stop" | "estimate";
  label: string | null;
};

export type WalkEstimate = { minutes: number; distanceM: number };

/** Línea recta × 1,3 a 4,5 km/h (estimación, no ruta peatonal real). */
export function walkEstimate(straightM: number): WalkEstimate {
  const distanceM = Math.round(straightM * LIMITS.walkFactor);
  return { distanceM, minutes: distanceM <= 0 ? 0 : Math.max(1, Math.ceil(distanceM / LIMITS.walkMetersPerMinute)) };
}

/** 1 min de parada + 2 × distancia a la ruta a 30 km/h. */
export function detourEstimateMinutes(distanceToRouteM: number): number {
  return LIMITS.detourStopMinutes + Math.ceil((2 * Math.max(0, distanceToRouteM)) / LIMITS.detourMetersPerMinute);
}

/* ─────────────────────────────── Identificador opaco ─────────────────────────────── */

export function encodePickupId(tripId: string, point: GeoPoint, stopSeq: number | null, walkMinutes: number | null): string {
  const payload = JSON.stringify([1, tripId, Math.round(point.lat * 1e6) / 1e6, Math.round(point.lng * 1e6) / 1e6, stopSeq, walkMinutes]);
  return `pp1_${Buffer.from(payload, "utf8").toString("base64url")}`;
}

export function decodePickupId(
  id: string
): { tripId: string; lat: number; lng: number; stopSeq: number | null; walkMinutes: number | null } | null {
  if (!id.startsWith("pp1_") || id.length > 300) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(id.slice(4), "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length < 5 || parsed.length > 6 || parsed[0] !== 1) return null;
    const [, tripId, lat, lng, stopSeq, walk] = parsed as [number, unknown, unknown, unknown, unknown, unknown];
    if (typeof tripId !== "string" || typeof lat !== "number" || typeof lng !== "number") return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    if (stopSeq !== null && !(Number.isInteger(stopSeq) && (stopSeq as number) >= 0)) return null;
    const walkMinutes = typeof walk === "number" && Number.isInteger(walk) && walk >= 0 && walk <= 240 ? walk : null;
    return { tripId, lat, lng, stopSeq: stopSeq as number | null, walkMinutes };
  } catch {
    return null;
  }
}

/* ─────────────────────────────── Consultas geográficas ─────────────────────────────── */

export async function pointInProvince(db: Db, provinceId: string, point: GeoPoint): Promise<boolean> {
  const result = await db.query<{ covered: boolean }>(
    `select ST_CoveredBy(ST_SetSRID(ST_Point($2,$3),4326), p.geom) as covered from provinces p where p.id = $1`,
    [provinceId, point.lng, point.lat]
  );
  if (!result.rows[0]) throw err("PROVINCE_NOT_FOUND", 404, "La provincia no existe.");
  return result.rows[0].covered === true;
}

export type RouteProjection = { point: GeoPoint; distanceM: number; fraction: number };

/** Punto de la ruta del viaje más cercano a `target` (null si el viaje no tiene geometría). */
export async function projectOnRoute(db: Db, tripId: string, target: GeoPoint): Promise<RouteProjection | null> {
  const result = await db.query<{ lat: number; lng: number; distance_m: number; frac: number }>(
    `select ST_Y(c.cp) as lat, ST_X(c.cp) as lng,
            ST_Distance(t.route_geom::geography, c.pt::geography) as distance_m,
            ST_LineLocatePoint(t.route_geom, c.pt) as frac
       from trips t
       cross join lateral (select ST_SetSRID(ST_Point($2,$3),4326) as pt,
                                  ST_ClosestPoint(t.route_geom, ST_SetSRID(ST_Point($2,$3),4326)) as cp) c
      where t.id = $1 and t.route_geom is not null`,
    [tripId, target.lng, target.lat]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    point: pointOf(row.lat, row.lng),
    distanceM: Number(row.distance_m),
    fraction: Number(row.frac)
  };
}

const BOARDING_KINDS = new Set(["origin", "pickup", "stop"]);
const ALIGHTING_KINDS = new Set(["stop", "dropoff", "destination"]);

export function canBoardAt(stop: StopRow, lastSeq: number): boolean {
  return BOARDING_KINDS.has(stop.kind) && stop.seq < lastSeq;
}

export function canAlightAt(stop: StopRow): boolean {
  return ALIGHTING_KINDS.has(stop.kind) && stop.seq >= 1;
}

/* ─────────────────────────────── Opciones de subida ─────────────────────────────── */

function declaredOption(
  stop: StopRow,
  stops: readonly StopRow[],
  segments: readonly SegmentLoad[],
  from: GeoPoint
): PickupOption {
  const offsets = stopOffsets(stops, segments);
  const distances = stopDistances(stops, segments);
  return {
    source: "driver_stop",
    location: stopPoint(stop),
    stopSeq: stop.seq,
    segmentSeq: stop.seq,
    offsetS: offsets[stop.seq] ?? 0,
    distanceFromStartM: distances[stop.seq] ?? 0,
    straightM: haversineM(from, stopPoint(stop)),
    walkMinutes: walkEstimate(haversineM(from, stopPoint(stop))).minutes,
    detourMinutes: stop.detour_minutes ?? 0,
    detourSource: "stop",
    label: stop.label
  };
}

/** Mejor subida para un pasajero en `from`: parada declarada o proyección sobre la ruta (si el viaje la admite). */
export async function bestPickupOption(
  db: Db,
  trip: TripRow,
  stops: readonly StopRow[],
  segments: readonly SegmentLoad[],
  from: GeoPoint,
  radiusM: number
): Promise<PickupOption | null> {
  const lastSeq = stops.length - 1;
  let best: PickupOption | null = null;
  for (const stop of stops) {
    if (!canBoardAt(stop, lastSeq)) continue;
    const distance = haversineM(from, stopPoint(stop));
    if (distance <= radiusM && (best === null || distance < best.straightM)) {
      best = declaredOption(stop, stops, segments, from);
    }
  }
  if (trip.pickup_on_route) {
    const projection = await projectOnRoute(db, trip.id, from);
    if (projection && projection.distanceM <= radiusM) {
      const straight = haversineM(from, projection.point);
      if (best === null || straight < best.straightM - 25) {
        const position = positionOnRoute(stops, segments, projection.fraction);
        const detour = detourEstimateMinutes(0);
        if (position.segmentSeq < lastSeq && detour <= trip.max_detour_minutes) {
          best = {
            source: "route_projection",
            location: projection.point,
            stopSeq: null,
            segmentSeq: position.segmentSeq,
            offsetS: position.offsetS,
            distanceFromStartM: position.distanceFromStartM,
            straightM: straight,
            walkMinutes: walkEstimate(straight).minutes,
            detourMinutes: detour,
            detourSource: "estimate",
            label: null
          };
        }
      }
    }
  }
  return best;
}

/** Parada de bajada más próxima a `to` posterior a la subida (null si ninguna está dentro del radio). */
export function bestDropoffStop(
  stops: readonly StopRow[],
  pickup: PickupOption,
  to: GeoPoint,
  radiusM: number
): { stop: StopRow; straightM: number } | null {
  let best: { stop: StopRow; straightM: number } | null = null;
  for (const stop of stops) {
    if (!canAlightAt(stop) || stop.seq <= pickup.segmentSeq) continue;
    const straight = haversineM(to, stopPoint(stop));
    if (straight <= radiusM && (best === null || straight < best.straightM)) best = { stop, straightM: straight };
  }
  return best;
}

/* ─────────────────────────────── Propuestas A/B (pantalla 13) ─────────────────────────────── */

const CODES = ["A", "B", "C", "D"] as const;

export async function proposePickupPoints(
  db: Db,
  geocoder: GeocodingProvider | null,
  input: {
    trip: TripRow;
    stops: readonly StopRow[];
    segments: readonly SegmentLoad[];
    origin: GeoPoint;
    dropoffSeq: number;
    limit: number;
  }
): Promise<PickupProposal[]> {
  const { trip, stops, segments, origin, dropoffSeq, limit } = input;
  const lastSeq = stops.length - 1;
  const options: PickupOption[] = [];
  for (const stop of stops) {
    if (!canBoardAt(stop, lastSeq) || stop.seq >= dropoffSeq) continue;
    const straight = haversineM(origin, stopPoint(stop));
    if (straight <= LIMITS.pickupSearchRadiusM) options.push(declaredOption(stop, stops, segments, origin));
  }
  if (trip.pickup_on_route) {
    const projection = await projectOnRoute(db, trip.id, origin);
    if (projection) {
      const straight = haversineM(origin, projection.point);
      const position = positionOnRoute(stops, segments, projection.fraction);
      const detour = detourEstimateMinutes(0);
      const duplicate = options.some(option => haversineM(option.location, projection.point) < 60);
      if (
        straight <= LIMITS.pickupSearchRadiusM && !duplicate && position.segmentSeq < dropoffSeq &&
        detour <= trip.max_detour_minutes
      ) {
        options.push({
          source: "route_projection",
          location: projection.point,
          stopSeq: null,
          segmentSeq: position.segmentSeq,
          offsetS: position.offsetS,
          distanceFromStartM: position.distanceFromStartM,
          straightM: straight,
          walkMinutes: walkEstimate(straight).minutes,
          detourMinutes: detour,
          detourSource: "estimate",
          label: null
        });
      }
    }
  }
  options.sort((a, b) => a.straightM - b.straightM || a.offsetS - b.offsetS);
  const distances = stopDistances(stops, segments);
  const departure = trip.departure_at ?? new Date();
  const proposals: PickupProposal[] = [];
  for (const [index, option] of options.slice(0, limit).entries()) {
    const walk = walkEstimate(option.straightM);
    let name = option.label;
    let address: string | null = null;
    if (option.source === "route_projection" && geocoder) {
      try {
        const found = await geocoder.reverseGeocode({ latitude: option.location.lat, longitude: option.location.lng });
        address = found[0]?.formattedAddress ?? null;
        name = address;
      } catch {
        // sin geocodificación: la app muestra «Punto A»
      }
    }
    const boardsAt = new Date(departure.getTime() + option.offsetS * 1000);
    const location: PrecisePoint = { ...option.location, precision: "precise" };
    proposals.push({
      id: encodePickupId(trip.id, option.location, option.stopSeq, walk.minutes),
      code: CODES[index] ?? String(index + 1),
      name,
      address,
      location,
      source: option.source,
      walk: { minutes: walk.minutes, distanceM: walk.distanceM, estimated: true },
      detour: { minutes: option.detourMinutes, source: option.detourSource },
      fromSegmentSeq: option.segmentSeq,
      boardsAt: boardsAt.toISOString(),
      boardsAtLocal: localTimeOf(boardsAt),
      distanceToDropoffM: Math.max(0, (distances[dropoffSeq] ?? 0) - option.distanceFromStartM),
      recommended: index === 0
    });
  }
  return proposals;
}

export const SAFETY_NOTICE = "Comprueba que el punto permite una parada segura y legal.";

export function pickupPointsResponse(
  trip: TripRow,
  stops: readonly StopRow[],
  origin: GeoPoint,
  dropoffSeq: number,
  proposals: PickupProposal[]
): PickupPointsResponse {
  const dropoffStop = stops[dropoffSeq];
  return {
    tripId: trip.id,
    origin,
    dropoff: {
      stopSeq: dropoffSeq,
      label: dropoffStop?.label ?? null,
      location: { lat: dropoffStop?.lat ?? 0, lng: dropoffStop?.lng ?? 0, precision: "precise" }
    },
    proposals,
    safetyNotice: SAFETY_NOTICE
  };
}

/* ─────────────────────────────── Revalidación al solicitar ─────────────────────────────── */

export type ResolvedLeg = {
  pickup: PickupOption;
  dropoff: StopRow;
  fromSegmentSeq: number;
  toSegmentSeq: number;
  roadDistanceM: number;
};

/** Valida el rango de bajada: entero, dentro del viaje, alightable y posterior a la subida. */
export function resolveDropoff(stops: readonly StopRow[], dropoffStopSeq: number | undefined, pickup: PickupOption): StopRow {
  const seq = dropoffStopSeq ?? stops.length - 1;
  const stop = Number.isInteger(seq) ? stops[seq] : undefined;
  if (!stop || !canAlightAt(stop)) throw err("DROPOFF_STOP_INVALID", 422, "La parada de bajada no es válida para este viaje.");
  if (stop.seq <= pickup.segmentSeq) throw err("DROPOFF_BEFORE_PICKUP", 422, "La bajada debe ser posterior al punto de recogida.");
  return stop;
}

/**
 * Descodifica y REVALIDA un `pickupPointId` en el servidor (nunca se confía en el cliente):
 * pertenece al viaje, está dentro de la provincia, sobre/cerca de la ruta y su desvío cabe en el máximo del conductor.
 */
export async function resolvePickupPointId(
  db: Db,
  trip: TripRow,
  stops: readonly StopRow[],
  segments: readonly SegmentLoad[],
  pickupPointId: string
): Promise<PickupOption> {
  const decoded = decodePickupId(pickupPointId);
  if (!decoded || decoded.tripId !== trip.id) throw err("PICKUP_POINT_INVALID", 422, "El punto de recogida no es válido para este viaje.");
  const lastSeq = stops.length - 1;
  const target = pointOf(decoded.lat, decoded.lng);

  if (decoded.stopSeq !== null) {
    const stop = stops[decoded.stopSeq];
    if (!stop || !canBoardAt(stop, lastSeq)) throw err("PICKUP_POINT_INVALID", 422, "El punto de recogida no es válido para este viaje.");
    if (!(await pointInProvince(db, trip.province_id, stopPoint(stop)))) {
      throw err("PICKUP_POINT_OUTSIDE_PROVINCE", 422, "El punto de recogida está fuera de la provincia.");
    }
    return { ...declaredOption(stop, stops, segments, stopPoint(stop)), walkMinutes: decoded.walkMinutes };
  }

  if (!trip.pickup_on_route) throw err("PICKUP_NOT_ON_ROUTE", 422, "Este viaje solo recoge en las paradas indicadas por el conductor.");
  if (!(await pointInProvince(db, trip.province_id, target))) {
    throw err("PICKUP_POINT_OUTSIDE_PROVINCE", 422, "El punto de recogida está fuera de la provincia.");
  }
  const projection = await projectOnRoute(db, trip.id, target);
  if (!projection || projection.distanceM > 75) throw err("PICKUP_NOT_ON_ROUTE", 422, "El punto de recogida no está sobre la ruta del viaje.");
  const detour = detourEstimateMinutes(projection.distanceM);
  if (detour > trip.max_detour_minutes) {
    throw err("PICKUP_DETOUR_TOO_LARGE", 422, "El desvío necesario supera el máximo que acepta el conductor.", {
      detourMinutes: detour, maxDetourMinutes: trip.max_detour_minutes
    });
  }
  const position = positionOnRoute(stops, segments, projection.fraction);
  if (position.segmentSeq >= lastSeq) throw err("PICKUP_POINT_INVALID", 422, "El punto de recogida no es válido para este viaje.");
  return {
    source: "route_projection",
    location: projection.point,
    stopSeq: null,
    segmentSeq: position.segmentSeq,
    offsetS: position.offsetS,
    distanceFromStartM: position.distanceFromStartM,
    straightM: 0,
    walkMinutes: decoded.walkMinutes,
    detourMinutes: detour,
    detourSource: "estimate",
    label: null
  };
}

/** Un `RequestPoint`-like con precisión explícita; coordenadas aproximadas si el lector no participa. */
export function viewPoint(point: GeoPoint, precise: boolean): PrecisePoint {
  return precise
    ? { lat: point.lat, lng: point.lng, precision: "precise" }
    : { lat: approx3(point.lat), lng: approx3(point.lng), precision: "approximate" };
}

