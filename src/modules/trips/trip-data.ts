import type { Db } from "./common.js";
import { clamp, pointOf } from "./common.js";
import type { GeoPoint, TripCategory, TripLeg, TripStatus } from "./types.js";

/**
 * Condición SQL de «vehículo en condiciones de circular» (mismas reglas que la búsqueda 0.14 y `assertVehicleCanDrive`).
 * Se aplica a todo lo que se muestra públicamente: un seguro caducado oculta el viaje aunque siga `published`.
 */
export const VEHICLE_BOOKABLE_SQL = `
  v.review_status = 'approved' and v.documentation_status = 'approved'
  and v.vehicle_photo_status = 'approved' and v.insurance_status = 'approved'
  and v.insurance_expires_on is not null and v.insurance_expires_on >= current_date`;

export type TripRow = {
  id: string;
  series_id: string | null;
  driver_user_id: string;
  vehicle_id: string;
  province_id: string;
  province_name: string;
  category: TripCategory;
  kind: "single" | "recurring";
  leg: TripLeg;
  status: TripStatus;
  departure_at: Date | null;
  service_date: string | null;
  flexibility_minutes: number;
  max_detour_minutes: number;
  pickup_on_route: boolean;
  offered_seats: number;
  route_distance_m: number | null;
  route_duration_s: number | null;
  route_version: number;
  make: string;
  model: string;
  plate: string;
  color: string | null;
  passenger_seats: number;
  vehicle_bookable: boolean;
};

export const TRIP_COLUMNS = `
  t.id, t.series_id, t.driver_user_id, t.vehicle_id, t.province_id, pr.name as province_name,
  t.category, t.kind, t.leg, t.status, t.departure_at, t.service_date::text as service_date,
  t.flexibility_minutes, t.max_detour_minutes, t.pickup_on_route, t.offered_seats,
  t.route_distance_m, t.route_duration_s, t.route_version,
  v.make, v.model, v.plate, v.color, v.passenger_seats,
  (${VEHICLE_BOOKABLE_SQL}) as vehicle_bookable`;

export async function loadTrips(db: Db, ids: readonly string[]): Promise<Map<string, TripRow>> {
  const out = new Map<string, TripRow>();
  if (ids.length === 0) return out;
  const rows = await db.query<TripRow>(
    `select ${TRIP_COLUMNS}
       from trips t
       join vehicles v on v.id = t.vehicle_id
       join provinces pr on pr.id = t.province_id
      where t.id = any($1::uuid[])`,
    [[...new Set(ids)]]
  );
  for (const row of rows.rows) out.set(row.id, row);
  return out;
}

export type StopRow = {
  trip_id: string;
  seq: number;
  kind: "origin" | "pickup" | "stop" | "dropoff" | "destination";
  label: string | null;
  lat: number;
  lng: number;
  optional: boolean;
  detour_minutes: number | null;
  /** Fracción (0..1) de la ruta en la que cae la parada, forzada a no decreciente. */
  frac: number;
};

export async function loadStops(db: Db, tripIds: readonly string[]): Promise<Map<string, StopRow[]>> {
  const out = new Map<string, StopRow[]>();
  if (tripIds.length === 0) return out;
  const rows = await db.query<Omit<StopRow, "frac"> & { frac: number | null }>(
    `select s.trip_id, s.seq, s.kind, s.label, ST_Y(s.geom) as lat, ST_X(s.geom) as lng,
            s.optional, s.detour_minutes,
            case when t.route_geom is null then null else ST_LineLocatePoint(t.route_geom, s.geom) end as frac
       from trip_stops s join trips t on t.id = s.trip_id
      where s.trip_id = any($1::uuid[])
      order by s.trip_id, s.seq`,
    [[...new Set(tripIds)]]
  );
  for (const row of rows.rows) {
    const list = out.get(row.trip_id) ?? [];
    const previous = list[list.length - 1];
    const raw = row.frac ?? (previous ? previous.frac : 0);
    list.push({ ...row, lat: Number(row.lat), lng: Number(row.lng), frac: Math.max(raw, previous?.frac ?? 0) });
    out.set(row.trip_id, list);
  }
  return out;
}

export type SegmentLoad = {
  trip_id: string;
  seq: number;
  from_stop_seq: number;
  to_stop_seq: number;
  distance_m: number;
  duration_s: number;
  capacity: number;
  occupied: number;
};

/** Capacidad y ocupación por tramo: holds activos no caducados + reservas confirmadas/completadas. */
export async function loadSegmentLoads(db: Db, tripIds: readonly string[]): Promise<Map<string, SegmentLoad[]>> {
  const out = new Map<string, SegmentLoad[]>();
  if (tripIds.length === 0) return out;
  const rows = await db.query<SegmentLoad>(
    `select s.trip_id, s.seq, s.from_stop_seq, s.to_stop_seq, s.distance_m, s.duration_s, s.capacity,
            (
              (select count(*)::int from seat_holds h join ride_requests r on r.id = h.request_id
                where r.trip_id = s.trip_id and h.status = 'active' and h.expires_at > now()
                  and r.from_segment_seq <= s.seq and r.to_segment_seq > s.seq)
              +
              (select count(*)::int from bookings b join ride_requests r on r.id = b.request_id
                where r.trip_id = s.trip_id and b.status in ('confirmed','completed')
                  and r.from_segment_seq <= s.seq and r.to_segment_seq > s.seq)
            ) as occupied
       from trip_segments s
      where s.trip_id = any($1::uuid[])
      order by s.trip_id, s.seq`,
    [[...new Set(tripIds)]]
  );
  for (const row of rows.rows) {
    const list = out.get(row.trip_id) ?? [];
    list.push(row);
    out.set(row.trip_id, list);
  }
  return out;
}

/** Plazas libres mínimas en los tramos [from, to). 0 si el rango no existe. */
export function freeSeatsInRange(segments: readonly SegmentLoad[], from: number, to: number): number {
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
export function maxFreeSeats(segments: readonly SegmentLoad[]): number {
  let max = 0;
  for (const segment of segments) max = Math.max(max, segment.capacity - segment.occupied);
  return Math.max(0, max);
}

/** Desplazamiento (s) desde la salida hasta cada parada: offsets[seq]. */
export function stopOffsets(stops: readonly StopRow[], segments: readonly SegmentLoad[]): number[] {
  const bySeq = new Map(segments.map(segment => [segment.seq, segment]));
  const offsets: number[] = [];
  let acc = 0;
  for (let i = 0; i < stops.length; i += 1) {
    offsets.push(acc);
    acc += bySeq.get(i)?.duration_s ?? 0;
  }
  return offsets;
}

/** Distancia por carretera acumulada hasta cada parada. */
export function stopDistances(stops: readonly StopRow[], segments: readonly SegmentLoad[]): number[] {
  const bySeq = new Map(segments.map(segment => [segment.seq, segment]));
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < stops.length; i += 1) {
    out.push(acc);
    acc += bySeq.get(i)?.distance_m ?? 0;
  }
  return out;
}

export type RoutePosition = {
  /** Tramo que contiene el punto (el pasajero ocupa desde este tramo). */
  segmentSeq: number;
  /** Segundos desde la salida hasta el punto (interpolado dentro del tramo). */
  offsetS: number;
  /** Metros por carretera desde la salida hasta el punto (interpolado). */
  distanceFromStartM: number;
};

/** Convierte una fracción de ruta en tramo + tiempo + distancia, usando la geometría de los tramos del proveedor. */
export function positionOnRoute(
  stops: readonly StopRow[],
  segments: readonly SegmentLoad[],
  fraction: number
): RoutePosition {
  const offsets = stopOffsets(stops, segments);
  const distances = stopDistances(stops, segments);
  const lastSegment = Math.max(0, stops.length - 2);
  let k = 0;
  for (let i = 0; i <= lastSegment; i += 1) {
    if ((stops[i]?.frac ?? 0) <= fraction) k = i;
  }
  const a = stops[k]?.frac ?? 0;
  const b = stops[k + 1]?.frac ?? a;
  const t = b > a ? clamp((fraction - a) / (b - a), 0, 1) : 0;
  const segment = segments.find(item => item.seq === k);
  return {
    segmentSeq: k,
    offsetS: Math.round((offsets[k] ?? 0) + t * (segment?.duration_s ?? 0)),
    distanceFromStartM: Math.round((distances[k] ?? 0) + t * (segment?.distance_m ?? 0))
  };
}

export function stopPoint(stop: StopRow): GeoPoint {
  return pointOf(stop.lat, stop.lng);
}
