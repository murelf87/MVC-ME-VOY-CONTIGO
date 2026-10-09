import type { Pool } from "pg";
import {
  iso, localTimeOf, minutesFromSeconds, sortWeekdays, type Db
} from "./common.js";
import { toVehicleSummary } from "./dto.js";
import { err } from "./errors.js";
import {
  bestPickupOption, canAlightAt, canBoardAt, viewPoint, type PickupOption
} from "./pickup-service.js";
import { loadPublicUsers, publicUserOrUnknown } from "./public-user.js";
import { computeQuote, loadApprovedTariff } from "./quote-service.js";
import {
  freeSeatsInRange, loadSegmentLoads, loadStops, loadTrips, maxFreeSeats, stopDistances, stopOffsets,
  type SegmentLoad, type StopRow, type TripRow
} from "./trip-data.js";
import type {
  CoordinatePrecision, GeoPoint, RideRequestStatus, TripDetail, TripDetailStop, TripRouteGeometry, Weekday
} from "./types.js";

export type ViewerStanding = {
  relation: "public" | "driver" | "requester" | "passenger";
  /** Solicitud abierta del lector en este viaje (pending | payment_pending | confirmed). */
  openRequest: {
    id: string;
    status: RideRequestStatus;
    fromSegmentSeq: number;
    toSegmentSeq: number;
    dropoffStopSeq: number | null;
    pickupGeom: GeoPoint | null;
  } | null;
  precision: CoordinatePrecision;
  /** Matrícula completa: conductor o reserva confirmada. */
  fullPlate: boolean;
};

export async function viewerStanding(db: Db, trip: TripRow, userId: string | null): Promise<ViewerStanding> {
  if (userId === null) return { relation: "public", openRequest: null, precision: "approximate", fullPlate: false };
  if (userId === trip.driver_user_id) return { relation: "driver", openRequest: null, precision: "precise", fullPlate: true };
  const result = await db.query<{
    id: string; status: RideRequestStatus; from_segment_seq: number; to_segment_seq: number;
    dropoff_stop_seq: number | null; p_lat: number | null; p_lng: number | null;
  }>(
    `select r.id, r.status, r.from_segment_seq, r.to_segment_seq, r.dropoff_stop_seq,
            ST_Y(r.pickup_geom) as p_lat, ST_X(r.pickup_geom) as p_lng
       from ride_requests r
      where r.trip_id = $1 and r.passenger_user_id = $2 and r.status in ('pending','accepted','payment_pending','confirmed')
      order by r.requested_at desc limit 1`,
    [trip.id, userId]
  );
  const row = result.rows[0];
  if (!row) return { relation: "public", openRequest: null, precision: "approximate", fullPlate: false };
  const status: RideRequestStatus = row.status === "accepted" ? "payment_pending" : row.status;
  const confirmed = status === "confirmed";
  return {
    relation: confirmed ? "passenger" : "requester",
    openRequest: {
      id: row.id,
      status,
      fromSegmentSeq: row.from_segment_seq,
      toSegmentSeq: row.to_segment_seq,
      dropoffStopSeq: row.dropoff_stop_seq,
      pickupGeom: row.p_lat === null || row.p_lng === null ? null : { lat: Number(row.p_lat), lng: Number(row.p_lng) }
    },
    // Coordenadas precisas con solicitud aceptada (hold activo) o confirmada.
    precision: status === "payment_pending" || confirmed ? "precise" : "approximate",
    fullPlate: confirmed
  };
}

export type Bookability = { canRequest: boolean; reason: string | null };

/** ¿Puede el lector solicitar plaza ahora mismo en este rango? Códigos estables (ver contrato). */
export function bookability(input: {
  trip: TripRow;
  userId: string | null;
  standing: ViewerStanding;
  freeSeats: number;
  now: Date;
}): Bookability {
  const { trip, userId, standing } = input;
  if (userId === null) return { canRequest: false, reason: "AUTH_REQUIRED" };
  if (userId === trip.driver_user_id) return { canRequest: false, reason: "DRIVER_CANNOT_REQUEST_OWN_TRIP" };
  const open = trip.status === "published" || trip.status === "active";
  const notDeparted = trip.status === "active" || (trip.departure_at !== null && trip.departure_at.getTime() > input.now.getTime() - 5 * 60_000);
  if (!open || !trip.vehicle_bookable || !notDeparted) return { canRequest: false, reason: "TRIP_NOT_BOOKABLE" };
  if (standing.openRequest) return { canRequest: false, reason: "OPEN_REQUEST_EXISTS" };
  if (input.freeSeats <= 0) return { canRequest: false, reason: "NO_CAPACITY" };
  return { canRequest: true, reason: null };
}

/** Geometría simplificada: aproximada (≈110 m) para quien no participa, algo más precisa para participantes. */
export async function loadRouteGeometry(db: Db, tripId: string, precise: boolean): Promise<TripRouteGeometry> {
  const result = await db.query<{ geojson: string | null }>(
    precise
      ? `select ST_AsGeoJSON(ST_Simplify(route_geom, 0.0002), 5) as geojson from trips where id = $1`
      : `select ST_AsGeoJSON(ST_SnapToGrid(ST_Simplify(route_geom, 0.0005), 0.001), 3) as geojson from trips where id = $1`,
    [tripId]
  );
  const raw = result.rows[0]?.geojson;
  const coordinates: [number, number][] = [];
  if (raw) {
    const parsed = JSON.parse(raw) as { coordinates?: [number, number][] };
    for (const c of parsed.coordinates ?? []) coordinates.push([c[0], c[1]]);
  }
  return { type: "LineString", coordinates, precision: precise ? "precise" : "approximate" };
}

export type DetailQuery = { pickupLat?: number | undefined; pickupLng?: number | undefined; dropoffStopSeq?: number | undefined };

export async function tripDetail(
  pool: Pool,
  tripId: string,
  viewerUserId: string | null,
  query: DetailQuery,
  now = new Date()
): Promise<TripDetail> {
  const trip = (await loadTrips(pool, [tripId])).get(tripId);
  const isDriver = trip !== undefined && viewerUserId === trip.driver_user_id;
  if (!trip || ((trip.status === "draft" || trip.status === "cancelled") && !isDriver)) {
    throw err("TRIP_NOT_FOUND", 404, "El viaje no existe.");
  }
  const [stopsMap, loadsMap, standing, tariff] = await Promise.all([
    loadStops(pool, [tripId]), loadSegmentLoads(pool, [tripId]),
    viewerStanding(pool, trip, viewerUserId), loadApprovedTariff(pool)
  ]);
  const stops = stopsMap.get(tripId) ?? [];
  const segments = loadsMap.get(tripId) ?? [];
  const departure = trip.departure_at ?? now;
  const precise = standing.precision === "precise";
  const lastSeq = stops.length - 1;

  // Rango del lector: solicitud abierta > contexto de búsqueda (pickupLat/Lng + dropoffStopSeq).
  let pickup: PickupOption | null = null;
  let fromSeg: number | null = null;
  let toSeg: number | null = null;
  let yourPickupStop: number | null = null;
  let yourDropoffStop: number | null = null;
  if (standing.openRequest) {
    fromSeg = standing.openRequest.fromSegmentSeq;
    toSeg = standing.openRequest.toSegmentSeq;
    yourPickupStop = stops[fromSeg] && canBoardAt(stops[fromSeg]!, lastSeq) && standing.openRequest.pickupGeom === null ? fromSeg : null;
    yourDropoffStop = toSeg;
  } else if (query.pickupLat !== undefined && query.pickupLng !== undefined) {
    pickup = await bestPickupOption(pool, trip, stops, segments, { lat: query.pickupLat, lng: query.pickupLng }, 5000);
    if (pickup) {
      fromSeg = pickup.segmentSeq;
      yourPickupStop = pickup.stopSeq;
    }
  }
  if (toSeg === null) {
    const wanted = query.dropoffStopSeq ?? lastSeq;
    const stop = stops[wanted];
    if (stop && canAlightAt(stop) && (fromSeg === null || wanted > fromSeg)) {
      toSeg = wanted;
      yourDropoffStop = wanted;
    } else if (query.dropoffStopSeq !== undefined) {
      throw err("DROPOFF_STOP_INVALID", 422, "La parada de bajada no es válida para este viaje.");
    }
  }
  const rangeFrom = fromSeg ?? 0;
  const rangeTo = toSeg ?? lastSeq;
  const seatsAvailable = fromSeg !== null || standing.openRequest
    ? freeSeatsInRange(segments, rangeFrom, rangeTo)
    : maxFreeSeats(segments);

  const offsets = stopOffsets(stops, segments);
  const distances = stopDistances(stops, segments);
  const detailStops: TripDetailStop[] = stops.map((stop: StopRow) => {
    const etaAt = new Date(departure.getTime() + (offsets[stop.seq] ?? 0) * 1000);
    return {
      seq: stop.seq,
      kind: stop.kind,
      label: stop.label,
      location: viewPoint({ lat: stop.lat, lng: stop.lng }, precise),
      etaAt: iso(etaAt),
      etaLocal: localTimeOf(etaAt),
      optional: stop.optional,
      detourMinutes: stop.optional ? stop.detour_minutes : null,
      isYourPickup: yourPickupStop === stop.seq,
      isYourDropoff: yourDropoffStop === stop.seq,
      canBoard: canBoardAt(stop, lastSeq),
      canAlight: canAlightAt(stop)
    };
  });

  const routeDistanceM = trip.route_distance_m ?? (distances[lastSeq] ?? 0) + (segments.find(s => s.seq === lastSeq)?.distance_m ?? 0);
  const routeDurationS = trip.route_duration_s ?? segments.reduce((sum, s) => sum + s.duration_s, 0);
  const rangeDistance = fromSeg !== null || toSeg !== null
    ? Math.max(0, (distances[rangeTo] ?? routeDistanceM) - (pickup?.distanceFromStartM ?? distances[rangeFrom] ?? 0))
    : routeDistanceM;
  const quote = computeQuote(tariff, rangeDistance);
  const bookable = bookability({ trip, userId: viewerUserId, standing, freeSeats: seatsAvailable, now });
  const geometry = await loadRouteGeometry(pool, tripId, precise);

  const series = trip.series_id
    ? (await pool.query<{ weekdays: Weekday[]; outbound_local: string; return_local: string | null }>(
        `select weekdays, outbound_local::text as outbound_local, return_local::text as return_local from trip_series where id = $1`,
        [trip.series_id]
      )).rows[0] ?? null
    : null;

  const driverMap = await loadPublicUsers(pool, [trip.driver_user_id]);
  let owner: TripDetail["owner"] = null;
  if (isDriver) {
    const pending = await pool.query<{ n: number }>(
      `select count(*)::int as n from ride_requests where trip_id = $1 and status = 'pending'`, [tripId]
    );
    const confirmed = await pool.query<{ passenger_user_id: string }>(
      `select distinct r.passenger_user_id from ride_requests r join bookings b on b.request_id = r.id
        where r.trip_id = $1 and b.status in ('confirmed','completed')`, [tripId]
    );
    const people = await loadPublicUsers(pool, confirmed.rows.map(row => row.passenger_user_id));
    owner = {
      pendingRequests: pending.rows[0]?.n ?? 0,
      confirmedPassengers: confirmed.rows.map(row => publicUserOrUnknown(people, row.passenger_user_id))
    };
  }

  return {
    id: trip.id,
    seriesId: trip.series_id,
    status: trip.status,
    kind: trip.kind,
    leg: trip.leg,
    category: trip.category,
    provinceId: trip.province_id,
    provinceName: trip.province_name,
    driver: publicUserOrUnknown(driverMap, trip.driver_user_id),
    vehicle: toVehicleSummary(trip, standing.fullPlate, isDriver),
    departureAt: iso(departure),
    flexibilityMinutes: trip.flexibility_minutes,
    recurrence: series
      ? {
          weekdays: sortWeekdays(series.weekdays),
          outboundLocal: series.outbound_local.slice(0, 5),
          returnLocal: series.return_local ? series.return_local.slice(0, 5) : null
        }
      : null,
    pickupPolicy: { onRoute: trip.pickup_on_route, maxDetourMinutes: trip.max_detour_minutes },
    seats: {
      offered: trip.offered_seats,
      available: seatsAvailable,
      perSegment: segments.map((segment: SegmentLoad) => ({
        seq: segment.seq,
        fromStopSeq: segment.from_stop_seq,
        toStopSeq: segment.to_stop_seq,
        capacity: segment.capacity,
        occupied: segment.occupied,
        free: Math.max(0, segment.capacity - segment.occupied),
        distanceM: segment.distance_m,
        durationMinutes: minutesFromSeconds(segment.duration_s)
      }))
    },
    route: { distanceM: routeDistanceM, durationMinutes: minutesFromSeconds(routeDurationS), geometry },
    stops: detailStops,
    totals: {
      roadDistanceM: routeDistanceM,
      durationMinutes: minutesFromSeconds(routeDurationS),
      detourMinutes: stops.reduce((sum, stop) => sum + (stop.optional ? stop.detour_minutes ?? 0 : 0), 0)
    },
    price: quote.total,
    breakdownAvailable: trip.status === "published" || trip.status === "active",
    viewer: {
      relation: standing.relation,
      precision: standing.precision,
      openRequest: standing.openRequest ? { id: standing.openRequest.id, status: standing.openRequest.status } : null
    },
    owner,
    canRequest: bookable.canRequest,
    cannotRequestReason: bookable.reason
  };
}

