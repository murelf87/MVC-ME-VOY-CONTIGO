import type { Pool } from "pg";
import type { AuthPrincipal } from "../../auth/session.js";
import type { PublicUserDto } from "../../lib/dto.js";
import { categoryLabel } from "./catalog.js";
import {
  encodeCursor, iso, localDateOf, localTimeOf, requireRole, sortWeekdays, weekdaysLabel, type Db
} from "./common.js";
import { loadPublicUsers } from "./public-user.js";
import { expireIfDue } from "./request-detail.js";
import type { SeriesRow } from "./series-service.js";
import { SERIES_SELECT, normalizeSeries } from "./series-service.js";
import { tripsSettings } from "./settings.js";
import {
  loadSegmentLoads, loadStops, loadTrips, positionOnRoute, stopOffsets, type SegmentLoad, type StopRow, type TripRow
} from "./trip-data.js";
import type {
  OverviewCard, OverviewStatus, Page, RideRequestStatus, TripCategory, TripLeg, TripOverviewCard, TripsOverview, Weekday,
  WeeklyReservationCard
} from "./types.js";

const STATUS_LABELS: Record<OverviewStatus["code"], string> = {
  confirmed: "Confirmada",
  pending: "Pendiente",
  payment_pending: "Pago pendiente",
  scheduled: "Programado",
  live: "En curso",
  completed: "Completado",
  cancelled: "Cancelado",
  no_show: "No presentado",
  rejected: "Rechazada",
  expired: "Caducada"
};

const status = (code: OverviewStatus["code"]): OverviewStatus => ({ code, label: STATUS_LABELS[code] });

export type OverviewInput = {
  role: "passenger" | "driver";
  section: "all" | "upcoming" | "in_progress" | "history";
  offset: number;
  limit: number;
};

/** «En 12 min»: minutos hasta `at` si faltan entre 0 y 3 h; si no, null. */
export function startsInMinutes(at: Date, now: Date): number | null {
  const diff = Math.ceil((at.getTime() - now.getTime()) / 60_000);
  return diff >= 0 && diff <= 180 ? diff : null;
}

type Occupancy = { occupied: number; total: number };

function occupancyOf(trip: TripRow, segments: readonly SegmentLoad[]): Occupancy {
  const occupied = segments.reduce((max, segment) => Math.max(max, segment.occupied), 0);
  return { occupied, total: trip.offered_seats };
}

type RiderMap = Map<string, string[]>;

/** Pasajeros CONFIRMADOS de cada viaje (solo se enseñan a quien participa en él). */
async function loadConfirmedRiders(db: Db, tripIds: readonly string[], excludeUserId: string | null): Promise<RiderMap> {
  const out: RiderMap = new Map();
  if (tripIds.length === 0) return out;
  const rows = await db.query<{ trip_id: string; passenger_user_id: string }>(
    `select r.trip_id, r.passenger_user_id
       from ride_requests r join bookings b on b.request_id = r.id
      where r.trip_id = any($1::uuid[]) and b.status in ('confirmed','completed')
        and ($2::uuid is null or r.passenger_user_id <> $2::uuid)
      order by b.created_at, r.id`,
    [[...new Set(tripIds)], excludeUserId]
  );
  for (const row of rows.rows) {
    const list = out.get(row.trip_id) ?? [];
    list.push(row.passenger_user_id);
    out.set(row.trip_id, list);
  }
  return out;
}

function ridersOf(map: RiderMap, tripId: string, users: Map<string, PublicUserDto>): PublicUserDto[] {
  return (map.get(tripId) ?? []).map(id => users.get(id)).filter((user): user is PublicUserDto => user !== undefined);
}

/* ───────────────────────────── ETA en directo ───────────────────────────── */

type LiveRow = { trip_id: string; recorded_at: Date; frac_car: number | null };

/**
 * «El conductor llegará en unos 10 min». Solo con posición FRESCA (< `liveStaleSeconds`) y si el coche aún no ha
 * pasado por la recogida. Se calcula por la ruta con las duraciones por tramo del proveedor, nunca en línea recta.
 */
async function loadLivePositions(db: Db, tripIds: readonly string[]): Promise<Map<string, LiveRow>> {
  const out = new Map<string, LiveRow>();
  if (tripIds.length === 0) return out;
  const rows = await db.query<LiveRow>(
    `select s.trip_id, s.recorded_at,
            case when t.route_geom is null then null else ST_LineLocatePoint(t.route_geom, s.geom) end as frac_car
       from trip_live_state s join trips t on t.id = s.trip_id
      where s.trip_id = any($1::uuid[])`,
    [[...new Set(tripIds)]]
  );
  for (const row of rows.rows) out.set(row.trip_id, row);
  return out;
}

function liveEtaFor(
  live: LiveRow | undefined,
  stops: readonly StopRow[],
  segments: readonly SegmentLoad[],
  pickupOffsetS: number,
  now: Date
): TripOverviewCard["liveEta"] {
  if (!live || live.frac_car === null) return null;
  const ageMs = now.getTime() - live.recorded_at.getTime();
  if (ageMs > tripsSettings().liveStaleSeconds * 1000) return null;
  const car = positionOnRoute(stops, segments, Number(live.frac_car));
  const remainingS = pickupOffsetS - car.offsetS;
  if (remainingS <= 0) return null;
  const minutes = Math.max(1, Math.ceil(remainingS / 60));
  return {
    minutes,
    phrase: minutes <= 1 ? "El conductor está a punto de llegar" : `El conductor llegará en unos ${minutes} min`,
    stale: false
  };
}

/* ───────────────────────────── Pasajero ───────────────────────────── */

type PassengerRow = {
  request_id: string;
  trip_id: string;
  req_status: RideRequestStatus;
  from_segment_seq: number;
  to_segment_seq: number;
  pickup_label: string | null;
  pickup_offset_s: number | null;
  dropoff_stop_seq: number | null;
  weekly_reservation_id: string | null;
  booking_id: string | null;
  booking_status: "confirmed" | "completed" | "no_show" | "cancelled" | "driver_cancelled" | null;
  trip_status: TripRow["status"];
  departure_at: Date | null;
  frac_pickup: number | null;
  bucket: "in_progress" | "weekly_open" | "upcoming" | "history";
};

const PASSENGER_CTE = `
  with x as (
    select r.id as request_id, r.trip_id, r.status as req_status, r.from_segment_seq, r.to_segment_seq,
           r.pickup_label, r.pickup_offset_s, r.dropoff_stop_seq, r.weekly_reservation_id,
           b.id as booking_id, b.status as booking_status, t.status as trip_status, t.departure_at,
           case when t.route_geom is not null and r.pickup_geom is not null then ST_LineLocatePoint(t.route_geom, r.pickup_geom) end as frac_pickup,
           case
             when t.status = 'active' and r.status = 'confirmed' and b.status = 'confirmed' then 'in_progress'
             when r.weekly_reservation_id is not null and t.status = 'published' and (
                    (r.status = 'confirmed' and b.status = 'confirmed')
                 or (r.status in ('pending','accepted','payment_pending') and t.departure_at > now())) then 'weekly_open'
             when r.weekly_reservation_id is null and t.status = 'published' and (
                    (r.status = 'confirmed' and b.status = 'confirmed')
                 or (r.status in ('pending','accepted','payment_pending') and t.departure_at > now())) then 'upcoming'
             else 'history'
           end as bucket
      from ride_requests r
      join trips t on t.id = r.trip_id
      left join bookings b on b.request_id = r.id
     where r.passenger_user_id = $1
       and not (r.weekly_reservation_id is not null and r.status = 'cancelled' and b.id is null)
  )`;

function passengerStatus(row: PassengerRow): OverviewStatus {
  if (row.bucket === "in_progress") return status("live");
  if (row.bucket === "upcoming" || row.bucket === "weekly_open") {
    if (row.req_status === "confirmed") return status("confirmed");
    if (row.req_status === "pending") return status("pending");
    return status("payment_pending");
  }
  // Historial
  if (row.booking_status === "completed") return status("completed");
  if (row.booking_status === "no_show") return status("no_show");
  if (row.booking_status === "cancelled" || row.booking_status === "driver_cancelled") return status("cancelled");
  if (row.trip_status === "cancelled") return status("cancelled");
  if (row.trip_status === "completed" && row.req_status === "confirmed") return status("completed");
  switch (row.req_status) {
    case "rejected": return status("rejected");
    case "cancelled": return status("cancelled");
    default: return status("expired");
  }
}

function aggregateWeeklyStatus(rows: readonly PassengerRow[]): OverviewStatus {
  const confirmed = rows.filter(row => row.req_status === "confirmed").length;
  if (confirmed === rows.length) return status("confirmed");
  if (rows.some(row => row.req_status === "payment_pending" || row.req_status === "accepted")) return status("payment_pending");
  if (confirmed > 0) return status("confirmed");
  return status("pending");
}

async function passengerOverview(
  pool: Pool,
  principal: AuthPrincipal,
  input: OverviewInput,
  now: Date
): Promise<TripsOverview> {
  const userId = principal.userId;
  // Caduca los holds vencidos de este pasajero antes de pintar (no se muestra «Pago pendiente» ya caducado).
  const overdue = await pool.query<{ id: string }>(
    `select r.id from ride_requests r join seat_holds h on h.request_id = r.id
      where r.passenger_user_id = $1 and h.status = 'active' and h.expires_at <= now() and r.status in ('payment_pending','accepted')
      limit 100`,
    [userId]
  );
  await expireIfDue(pool, overdue.rows.map(row => row.id));

  const open = (await pool.query<PassengerRow>(
    `${PASSENGER_CTE} select * from x where bucket in ('in_progress','weekly_open','upcoming') order by departure_at, request_id`,
    [userId]
  )).rows;
  const wantsHistory = input.section === "all" || input.section === "history";
  const history = wantsHistory
    ? (await pool.query<PassengerRow>(
        `${PASSENGER_CTE} select * from x where bucket = 'history' order by departure_at desc nulls last, request_id offset $2 limit $3`,
        [userId, input.offset, input.limit + 1]
      )).rows
    : [];
  const historyCount = (await pool.query<{ n: number }>(
    `${PASSENGER_CTE} select count(*)::int as n from x where bucket = 'history'`, [userId]
  )).rows[0]?.n ?? 0;

  const weeklyIds = [...new Set(open.filter(row => row.bucket === "weekly_open").map(row => row.weekly_reservation_id!))];
  const headers = weeklyIds.length === 0 ? [] : (await pool.query<{
    id: string; series_id: string; weekdays: Weekday[]; legs: TripLeg[]; created_at: Date;
  }>(
    `select id, series_id, weekdays, legs, created_at from weekly_reservations where id = any($1::uuid[])`, [weeklyIds]
  )).rows;

  const historyPage = history.slice(0, input.limit);
  const allRows = [...open, ...historyPage];
  const tripIds = [...new Set(allRows.map(row => row.trip_id))];
  const [trips, stopsMap, loadsMap, liveMap, riderMap] = await Promise.all([
    loadTrips(pool, tripIds), loadStops(pool, tripIds), loadSegmentLoads(pool, tripIds),
    loadLivePositions(pool, open.filter(row => row.bucket === "in_progress").map(row => row.trip_id)),
    loadConfirmedRiders(pool, tripIds, userId)
  ]);
  const riderIds = [...riderMap.values()].flat();
  const users = await loadPublicUsers(pool, riderIds);

  const tripCard = (row: PassengerRow): TripOverviewCard | null => {
    const trip = trips.get(row.trip_id);
    if (!trip) return null;
    const stops = stopsMap.get(row.trip_id) ?? [];
    const segments = loadsMap.get(row.trip_id) ?? [];
    const offsets = stopOffsets(stops, segments);
    const departure = trip.departure_at ?? now;
    const toSeq = row.dropoff_stop_seq ?? row.to_segment_seq;
    const pickupOffsetS = row.pickup_offset_s ??
      (row.frac_pickup !== null ? positionOnRoute(stops, segments, Number(row.frac_pickup)).offsetS : (offsets[row.from_segment_seq] ?? 0));
    const pickupAt = new Date(departure.getTime() + pickupOffsetS * 1000);
    const arriveAt = new Date(departure.getTime() + (offsets[toSeq] ?? 0) * 1000);
    const toLabel = stops[toSeq]?.label ?? null;
    const confirmed = row.req_status === "confirmed" && row.booking_status === "confirmed";
    const phase: TripOverviewCard["phase"] = row.bucket === "in_progress" ? "live" : row.bucket === "history" ? "finished" : "scheduled";
    return {
      kind: "trip",
      id: row.request_id,
      tripId: row.trip_id,
      requestId: row.request_id,
      bookingId: row.booking_id,
      role: "passenger",
      leg: trip.leg,
      departureAt: iso(departure),
      category: trip.category,
      title: toLabel ? `${categoryLabel(trip.category)} – ${toLabel}` : categoryLabel(trip.category),
      from: { label: row.pickup_label ?? stops[row.from_segment_seq]?.label ?? null, timeLocal: localTimeOf(pickupAt) },
      to: { label: toLabel, timeLocal: localTimeOf(arriveAt) },
      riders: confirmed ? ridersOf(riderMap, row.trip_id, users) : [],
      occupancy: occupancyOf(trip, segments),
      status: passengerStatus(row),
      startsInMinutes: phase === "scheduled" ? startsInMinutes(pickupAt, now) : null,
      phase,
      liveEta: phase === "live" && confirmed
        ? liveEtaFor(liveMap.get(row.trip_id), stops, segments, pickupOffsetS, now)
        : null
    };
  };

  const inProgress: OverviewCard[] = open.filter(row => row.bucket === "in_progress")
    .map(tripCard).filter((card): card is TripOverviewCard => card !== null);
  const upcomingSingles = open.filter(row => row.bucket === "upcoming")
    .map(tripCard).filter((card): card is TripOverviewCard => card !== null);

  const weeklyCards: WeeklyReservationCard[] = [];
  for (const header of headers) {
    const rows = open.filter(row => row.weekly_reservation_id === header.id && row.bucket === "weekly_open");
    const next = rows[0];
    if (!next) continue;
    const trip = trips.get(next.trip_id);
    if (!trip) continue;
    const stops = stopsMap.get(next.trip_id) ?? [];
    const segments = loadsMap.get(next.trip_id) ?? [];
    const offsets = stopOffsets(stops, segments);
    const departure = trip.departure_at ?? now;
    const toSeq = next.dropoff_stop_seq ?? next.to_segment_seq;
    const pickupAt = new Date(departure.getTime() + (next.pickup_offset_s ?? offsets[next.from_segment_seq] ?? 0) * 1000);
    const arriveAt = new Date(departure.getTime() + (offsets[toSeq] ?? 0) * 1000);
    const weekdays = sortWeekdays(header.weekdays);
    weeklyCards.push({
      kind: "weekly_reservation",
      id: header.id,
      seriesId: header.series_id,
      reservationId: header.id,
      category: trip.category,
      title: categoryLabel(trip.category),
      from: { label: next.pickup_label ?? stops[next.from_segment_seq]?.label ?? null, timeLocal: localTimeOf(pickupAt) },
      to: { label: stops[toSeq]?.label ?? null, timeLocal: localTimeOf(arriveAt) },
      riders: rows.some(row => row.req_status === "confirmed") ? ridersOf(riderMap, next.trip_id, users) : [],
      occupancy: occupancyOf(trip, segments),
      status: aggregateWeeklyStatus(rows),
      recurrence: { weekdays, recurring: true, label: `${weekdaysLabel(weekdays)} · Recurrente` }
    });
  }
  const upcoming: OverviewCard[] = [...weeklyCards, ...upcomingSingles];

  const historyCards = historyPage.map(tripCard).filter((card): card is TripOverviewCard => card !== null);
  const hasMore = history.length > input.limit;
  const nextOffset = input.offset + input.limit;
  const wantsUpcoming = input.section === "all" || input.section === "upcoming";
  const wantsLive = input.section === "all" || input.section === "in_progress";
  return {
    role: "passenger",
    generatedAt: iso(now),
    counts: { upcoming: upcoming.length, inProgress: inProgress.length, history: historyCount },
    upcoming: wantsUpcoming ? upcoming : [],
    inProgress: wantsLive ? inProgress : [],
    history: { items: historyCards, nextCursor: hasMore ? encodeCursor({ o: nextOffset }) : null } satisfies Page<OverviewCard>
  };
}

/* ───────────────────────────── Conductor ───────────────────────────── */

type DriverTripRow = {
  id: string;
  series_id: string | null;
  status: TripRow["status"];
  departure_at: Date | null;
  bucket: "in_progress" | "upcoming" | "history" | "hidden";
};

const DRIVER_CTE = `
  with x as (
    select t.id, t.series_id, t.status, t.departure_at,
           case
             when t.status = 'active' then 'in_progress'
             when t.status = 'published' and t.departure_at > now() - interval '2 hours'
                  and (t.series_id is null or t.departure_at <= now() + interval '24 hours') then 'upcoming'
             when t.status = 'published' and t.series_id is not null and t.departure_at > now() + interval '24 hours' then 'hidden'
             else 'history'
           end as bucket
      from trips t
     where t.driver_user_id = $1 and t.status <> 'draft'
  )`;

function driverTripStatus(row: DriverTripRow): OverviewStatus {
  if (row.bucket === "in_progress") return status("live");
  if (row.bucket === "upcoming") return status("scheduled");
  if (row.status === "completed") return status("completed");
  if (row.status === "cancelled") return status("cancelled");
  return status("expired");
}

async function driverOverview(
  pool: Pool,
  principal: AuthPrincipal,
  input: OverviewInput,
  now: Date
): Promise<TripsOverview> {
  const userId = principal.userId;
  const open = (await pool.query<DriverTripRow>(
    `${DRIVER_CTE} select * from x where bucket in ('in_progress','upcoming') order by departure_at, id`, [userId]
  )).rows;
  const wantsHistory = input.section === "all" || input.section === "history";
  const history = wantsHistory
    ? (await pool.query<DriverTripRow>(
        `${DRIVER_CTE} select * from x where bucket = 'history' order by departure_at desc nulls last, id offset $2 limit $3`,
        [userId, input.offset, input.limit + 1]
      )).rows
    : [];
  const historyCount = (await pool.query<{ n: number }>(
    `${DRIVER_CTE} select count(*)::int as n from x where bucket = 'history'`, [userId]
  )).rows[0]?.n ?? 0;

  const seriesRows = (await pool.query<SeriesRow>(
    `${SERIES_SELECT} where driver_user_id = $1 and status = 'active' and frequency = 'daily_workdays'
        and (end_date is null or end_date >= $2::date) order by start_date desc, id`,
    [userId, localDateOf(now)]
  )).rows.map(normalizeSeries);
  const nextOccurrences = seriesRows.length === 0 ? [] : (await pool.query<{ id: string; series_id: string }>(
    `select distinct on (series_id) id, series_id from trips
      where series_id = any($1::uuid[]) and status = 'published' and departure_at > now()
      order by series_id, departure_at`,
    [seriesRows.map(row => row.id)]
  )).rows;

  const historyPage = history.slice(0, input.limit);
  const tripIds = [...new Set([...open, ...historyPage].map(row => row.id).concat(nextOccurrences.map(row => row.id)))];
  const [trips, stopsMap, loadsMap, riderMap] = await Promise.all([
    loadTrips(pool, tripIds), loadStops(pool, tripIds), loadSegmentLoads(pool, tripIds), loadConfirmedRiders(pool, tripIds, null)
  ]);
  const users = await loadPublicUsers(pool, [...riderMap.values()].flat());

  const tripCard = (row: DriverTripRow): TripOverviewCard | null => {
    const trip = trips.get(row.id);
    if (!trip) return null;
    const stops = stopsMap.get(row.id) ?? [];
    const segments = loadsMap.get(row.id) ?? [];
    const offsets = stopOffsets(stops, segments);
    const departure = trip.departure_at ?? now;
    const lastSeq = Math.max(0, stops.length - 1);
    const arriveAt = new Date(departure.getTime() + (offsets[lastSeq] ?? 0) * 1000);
    const toLabel = stops[lastSeq]?.label ?? null;
    const phase: TripOverviewCard["phase"] = row.bucket === "in_progress" ? "live" : row.bucket === "upcoming" ? "scheduled" : "finished";
    return {
      kind: "trip",
      id: row.id,
      tripId: row.id,
      requestId: null,
      bookingId: null,
      role: "driver",
      leg: trip.leg,
      departureAt: iso(departure),
      category: trip.category,
      title: toLabel ? `${categoryLabel(trip.category)} – ${toLabel}` : categoryLabel(trip.category),
      from: { label: stops[0]?.label ?? null, timeLocal: localTimeOf(departure) },
      to: { label: toLabel, timeLocal: localTimeOf(arriveAt) },
      riders: ridersOf(riderMap, row.id, users),
      occupancy: occupancyOf(trip, segments),
      status: driverTripStatus(row),
      startsInMinutes: phase === "scheduled" ? startsInMinutes(departure, now) : null,
      phase,
      liveEta: null
    };
  };

  const seriesCards: WeeklyReservationCard[] = seriesRows.map(series => {
    const next = nextOccurrences.find(item => item.series_id === series.id);
    const nextTrip = next ? trips.get(next.id) : undefined;
    const outbound = series.outbound_template;
    const first = outbound.stops[0];
    const last = outbound.stops[outbound.stops.length - 1];
    const [h, m] = series.outbound_local.split(":").map(Number) as [number, number];
    const arrival = (h * 60 + m + Math.round(outbound.route.durationS / 60)) % 1440;
    const arrivalLocal = `${String(Math.floor(arrival / 60)).padStart(2, "0")}:${String(arrival % 60).padStart(2, "0")}`;
    const weekdays = sortWeekdays(series.weekdays);
    return {
      kind: "weekly_reservation",
      id: series.id,
      seriesId: series.id,
      reservationId: null,
      category: series.category as TripCategory,
      title: categoryLabel(series.category),
      from: { label: first?.label ?? null, timeLocal: series.outbound_local },
      to: { label: last?.label ?? null, timeLocal: arrivalLocal },
      riders: next ? ridersOf(riderMap, next.id, users) : [],
      occupancy: next && nextTrip ? occupancyOf(nextTrip, loadsMap.get(next.id) ?? []) : { occupied: 0, total: series.seats },
      status: status("scheduled"),
      recurrence: { weekdays, recurring: true, label: `${weekdaysLabel(weekdays)} · Recurrente` }
    };
  });

  const inProgress: OverviewCard[] = open.filter(row => row.bucket === "in_progress")
    .map(tripCard).filter((card): card is TripOverviewCard => card !== null);
  const upcoming: OverviewCard[] = [
    ...seriesCards,
    ...open.filter(row => row.bucket === "upcoming").map(tripCard).filter((card): card is TripOverviewCard => card !== null)
  ];
  const hasMore = history.length > input.limit;
  const wantsUpcoming = input.section === "all" || input.section === "upcoming";
  const wantsLive = input.section === "all" || input.section === "in_progress";
  return {
    role: "driver",
    generatedAt: iso(now),
    counts: { upcoming: upcoming.length, inProgress: inProgress.length, history: historyCount },
    upcoming: wantsUpcoming ? upcoming : [],
    inProgress: wantsLive ? inProgress : [],
    history: {
      items: historyPage.map(tripCard).filter((card): card is TripOverviewCard => card !== null),
      nextCursor: hasMore ? encodeCursor({ o: input.offset + input.limit }) : null
    }
  };
}

/* ───────────────────────────── Entrada ───────────────────────────── */

/** `GET /v1/me/trips/overview` — Mis viajes (pantalla 30). Solo datos del propio usuario. */
export async function tripsOverview(pool: Pool, principal: AuthPrincipal, input: OverviewInput, now = new Date()): Promise<TripsOverview> {
  if (input.role === "driver") requireRole(principal, "driver", "Necesitas el rol de conductor para ver tus viajes como conductor.");
  else requireRole(principal, "passenger", "Necesitas el rol de pasajero para ver tus viajes como pasajero.");
  return input.role === "driver" ? driverOverview(pool, principal, input, now) : passengerOverview(pool, principal, input, now);
}
