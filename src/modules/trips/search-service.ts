import type { Pool } from "pg";
import type { GeocodingProvider } from "../../maps/types.js";
import {
  grid, iso, localMinutesOf, localTimeOf, minutesFromSeconds, offsetFromCursor, encodeCursor,
  WORKDAYS, WEEKDAY_ORDER, sortWeekdays, type Db
} from "./common.js";
import { toVehicleSummary } from "./dto.js";
import { err } from "./errors.js";
import { bestDropoffStop, bestPickupOption, pointInProvince, viewPoint, walkEstimate } from "./pickup-service.js";
import { loadPublicUsers, publicUserOrUnknown } from "./public-user.js";
import { computeQuote, loadApprovedTariff } from "./quote-service.js";
import {
  TRIP_COLUMNS, VEHICLE_BOOKABLE_SQL, freeSeatsInRange, loadSegmentLoads, loadStops, maxFreeSeats,
  stopDistances, stopOffsets, type TripRow
} from "./trip-data.js";
import { tripsSettings } from "./settings.js";
import type {
  GeoPoint, MapCar, MapCarsResponse, SearchMode, SearchSuggestion, TripCategory, TripSearchItem, TripSearchPage, Weekday
} from "./types.js";

/* ───────────────────────────── Mapa de inicio (pantalla 09) ───────────────────────────── */

export type MapQuery = {
  provinceId: string;
  category: TripCategory | null;
  onlyWithSeats: boolean;
  withinHours: number;
  limit: number;
};

async function assertProvince(db: Db, provinceId: string): Promise<void> {
  const found = await db.query(`select 1 from provinces where id = $1`, [provinceId]);
  if (!found.rowCount) throw err("PROVINCE_NOT_FOUND", 404, "La provincia no existe.");
}

export async function mapCars(db: Db, query: MapQuery, now = new Date()): Promise<MapCarsResponse> {
  await assertProvince(db, query.provinceId);
  const settings = tripsSettings();
  const rows = await db.query<{
    id: string;
    category: TripCategory;
    status: "published" | "active";
    departure_at: Date;
    offered_seats: number;
    origin_label: string | null;
    destination_label: string | null;
    o_lat: number | null;
    o_lng: number | null;
    l_lat: number | null;
    l_lng: number | null;
    recorded_at: Date | null;
  }>(
    `select t.id, t.category, t.status, t.departure_at, t.offered_seats,
            o.label as origin_label, d.label as destination_label,
            ST_Y(o.geom) as o_lat, ST_X(o.geom) as o_lng,
            ST_Y(ls.geom) as l_lat, ST_X(ls.geom) as l_lng, ls.recorded_at
       from trips t
       join vehicles v on v.id = t.vehicle_id
       left join trip_stops o on o.trip_id = t.id and o.seq = 0
       left join lateral (select s.label from trip_stops s where s.trip_id = t.id order by s.seq desc limit 1) d on true
       left join trip_live_state ls on ls.trip_id = t.id
      where t.province_id = $1
        and ${VEHICLE_BOOKABLE_SQL}
        and (
          (t.status = 'published' and t.departure_at >= $5::timestamptz - interval '5 minutes'
             and t.departure_at <= $5::timestamptz + ($2 || ' hours')::interval)
          or t.status = 'active'
        )
        and ($3::trip_category is null or t.category = $3::trip_category)
      order by t.departure_at asc, t.id
      limit $4`,
    [query.provinceId, query.withinHours, query.category, query.limit * 3 + 1, now.toISOString()]
  );
  const ids = rows.rows.map(row => row.id);
  const loads = await loadSegmentLoads(db, ids);
  const cars: MapCar[] = [];
  for (const row of rows.rows) {
    const segments = loads.get(row.id) ?? [];
    const seatsAvailable = maxFreeSeats(segments);
    if (query.onlyWithSeats && seatsAvailable === 0) continue;
    const live = row.status === "active" && row.l_lat !== null && row.l_lng !== null && row.recorded_at !== null;
    const age = live && row.recorded_at ? Math.max(0, Math.floor((now.getTime() - row.recorded_at.getTime()) / 1000)) : null;
    const base = live ? { lat: Number(row.l_lat), lng: Number(row.l_lng) } : { lat: Number(row.o_lat ?? 0), lng: Number(row.o_lng ?? 0) };
    if (!live && (row.o_lat === null || row.o_lng === null)) continue;
    cars.push({
      tripId: row.id,
      category: row.category,
      state: row.status === "active" ? "live" : "scheduled",
      position: {
        lat: grid(base.lat),
        lng: grid(base.lng),
        precision: "approximate",
        source: live ? "live_gps" : "origin",
        recordedAt: live && row.recorded_at ? iso(row.recorded_at) : null,
        stale: live ? (age ?? 0) > settings.liveStaleSeconds : false,
        ageSeconds: age
      },
      seatsAvailable,
      seatsOffered: row.offered_seats,
      full: seatsAvailable === 0,
      departureAt: iso(row.departure_at),
      originLabel: row.origin_label,
      destinationLabel: row.destination_label
    });
  }
  const truncated = cars.length > query.limit;
  return {
    provinceId: query.provinceId,
    generatedAt: iso(now),
    cars: cars.slice(0, query.limit),
    truncated
  };
}

/* ───────────────────────────── Búsqueda (pantallas 10 y 11) ───────────────────────────── */

export type SearchInput = {
  provinceId: string;
  origin: GeoPoint;
  dest: GeoPoint;
  originLabel: string | null;
  destLabel: string | null;
  arriveBy: string;
  returnAt: string | null;
  mode: SearchMode;
  date: string | null;
  weekdays: Weekday[] | null;
  category: TripCategory | null;
  onlyWithSeats: boolean;
  toleranceMinutes: number;
  radiusM: number;
  offset: number;
  limit: number;
};

const ISO_DOW: Record<Weekday, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

type Candidate = TripRow & { series_weekdays: Weekday[] | null; series_return_local: string | null };

type Evaluated = { item: TripSearchItem; arriveDiff: number; walk: number };

export async function searchTrips(
  pool: Pool,
  geocoder: GeocodingProvider | null,
  input: SearchInput,
  viewerUserId: string | null,
  now = new Date()
): Promise<TripSearchPage> {
  void geocoder;
  const page = await runSearch(pool, input, viewerUserId, now);
  const suggestions: SearchSuggestion[] = [];
  if (input.offset === 0 && page.total < 3) {
    const alternatives: Array<{ kind: SearchSuggestion["kind"]; changed: SearchInput; apply: SearchSuggestion["apply"]; text: string }> = [];
    if (input.toleranceMinutes < 90) {
      const tolerance = Math.min(90, input.toleranceMinutes + 30);
      alternatives.push({
        kind: "widen_time", changed: { ...input, toleranceMinutes: tolerance }, apply: { toleranceMinutes: tolerance },
        text: "Prueba a ampliar el horario ±30 min"
      });
    }
    if (input.mode === "weekly" && (input.weekdays ?? WORKDAYS).length < 7) {
      alternatives.push({
        kind: "more_days", changed: { ...input, weekdays: [...WEEKDAY_ORDER] }, apply: { weekdays: WEEKDAY_ORDER.join(",") },
        text: "Prueba con más días"
      });
    }
    if (input.radiusM < 10_000) {
      const radius = Math.min(10_000, input.radiusM * 2);
      alternatives.push({
        kind: "wider_radius", changed: { ...input, radiusM: radius }, apply: { radiusM: radius },
        text: "Prueba a ampliar la zona de recogida"
      });
    }
    for (const alternative of alternatives) {
      const result = await runSearch(pool, { ...alternative.changed, offset: 0, limit: 50 }, viewerUserId, now);
      const extra = result.total - page.total;
      if (extra > 0) {
        suggestions.push({
          kind: alternative.kind,
          message: `${alternative.text}: ${extra === 1 ? "aparecería 1 coche más" : `aparecerían ${extra} coches más`}.`,
          wouldMatch: extra,
          apply: alternative.apply
        });
      }
    }
  }
  return {
    items: page.items,
    nextCursor: page.nextCursor,
    suggestions,
    criteria: {
      mode: input.mode,
      arriveBy: input.arriveBy,
      toleranceMinutes: input.toleranceMinutes,
      weekdays: input.mode === "weekly" ? (input.weekdays ?? [...WORKDAYS]) : null,
      date: input.mode === "one_off" ? input.date : null,
      radiusM: input.radiusM,
      originLabel: input.originLabel,
      destLabel: input.destLabel
    }
  };
}

async function runSearch(
  pool: Pool,
  input: SearchInput,
  viewerUserId: string | null,
  now: Date
): Promise<{ items: TripSearchItem[]; nextCursor: string | null; total: number }> {
  await assertProvince(pool, input.provinceId);
  if (!(await pointInProvince(pool, input.provinceId, input.origin))) {
    throw err("ORIGIN_OUTSIDE_PROVINCE", 422, "Origen fuera de provincia.");
  }
  if (!(await pointInProvince(pool, input.provinceId, input.dest))) {
    throw err("DESTINATION_OUTSIDE_PROVINCE", 422, "Destino fuera de provincia.");
  }
  if (input.mode === "one_off" && !input.date) throw err("SEARCH_DATE_REQUIRED", 422, "Indica la fecha para un viaje puntual.");

  const weekdays = input.mode === "weekly" ? (input.weekdays ?? [...WORKDAYS]) : [];
  const rows = await pool.query<Candidate>(
    `select ${TRIP_COLUMNS}, s.weekdays as series_weekdays, s.return_local::text as series_return_local
       from trips t
       join vehicles v on v.id = t.vehicle_id
       join provinces pr on pr.id = t.province_id
       left join trip_series s on s.id = t.series_id
      where t.province_id = $1
        and t.status = 'published' and t.leg = 'outbound' and t.departure_at > $12::timestamptz
        and ${VEHICLE_BOOKABLE_SQL}
        and ($2::trip_category is null or t.category = $2::trip_category)
        and ( ($3::text = 'one_off' and t.service_date = $4::date)
           or ($3::text = 'weekly' and t.series_id is not null and s.status = 'active'
               and extract(isodow from t.service_date)::int = any($5::int[])) )
        and ( exists (select 1 from trip_stops ps
                       where ps.trip_id = t.id and ps.kind in ('origin','pickup','stop')
                         and ST_DWithin(ps.geom::geography, ST_SetSRID(ST_Point($6,$7),4326)::geography, $10))
           or (t.pickup_on_route and t.route_geom is not null
               and ST_DWithin(t.route_geom::geography, ST_SetSRID(ST_Point($6,$7),4326)::geography, $10)) )
        and exists (select 1 from trip_stops ds
                     where ds.trip_id = t.id and ds.kind in ('stop','dropoff','destination') and ds.seq >= 1
                       and ST_DWithin(ds.geom::geography, ST_SetSRID(ST_Point($8,$9),4326)::geography, $10))
        and ($11::uuid is null or t.driver_user_id <> $11::uuid)
      order by t.departure_at asc, t.id
      limit 600`,
    [
      input.provinceId, input.category, input.mode, input.date, weekdays.map(day => ISO_DOW[day]),
      input.origin.lng, input.origin.lat, input.dest.lng, input.dest.lat, input.radiusM, viewerUserId, now.toISOString()
    ]
  );
  const candidates = rows.rows;
  const ids = candidates.map(row => row.id);
  const [stopsMap, loadsMap, tariff] = await Promise.all([
    loadStops(pool, ids), loadSegmentLoads(pool, ids), loadApprovedTariff(pool)
  ]);
  const drivers = await loadPublicUsers(pool, candidates.map(row => row.driver_user_id));

  const arriveBy = minutesOfDay(input.arriveBy);
  const evaluated: Evaluated[] = [];
  const seenSeries = new Set<string>();
  for (const trip of candidates) {
    if (input.mode === "weekly" && trip.series_id && seenSeries.has(trip.series_id)) continue;
    const stops = stopsMap.get(trip.id);
    const segments = loadsMap.get(trip.id);
    const departure = trip.departure_at;
    if (!stops || !segments || !departure || stops.length < 2) continue;
    const pickup = await bestPickupOption(pool, trip, stops, segments, input.origin, input.radiusM);
    if (!pickup) continue;
    const dropoff = bestDropoffStop(stops, pickup, input.dest, input.radiusM);
    if (!dropoff) continue;
    const offsets = stopOffsets(stops, segments);
    const distances = stopDistances(stops, segments);
    const arriveAt = new Date(departure.getTime() + (offsets[dropoff.stop.seq] ?? 0) * 1000);
    const arriveDiff = Math.abs(localMinutesOf(arriveAt) - arriveBy);
    if (arriveDiff > input.toleranceMinutes) continue;
    const seatsAvailable = freeSeatsInRange(segments, pickup.segmentSeq, dropoff.stop.seq);
    if (input.onlyWithSeats && seatsAvailable <= 0) continue;
    if (trip.series_id) seenSeries.add(trip.series_id);

    const roadDistanceM = Math.max(0, (distances[dropoff.stop.seq] ?? 0) - pickup.distanceFromStartM);
    const durationS = Math.max(0, (offsets[dropoff.stop.seq] ?? 0) - pickup.offsetS);
    const pickupAt = new Date(departure.getTime() + pickup.offsetS * 1000);
    const walkIn = walkEstimate(pickup.straightM);
    const walkOut = walkEstimate(dropoff.straightM);
    const minutesFromNow = Math.round((pickupAt.getTime() - now.getTime()) / 60_000);
    const matchedWeekdays = trip.series_weekdays
      ? sortWeekdays(weekdays.filter(day => trip.series_weekdays?.includes(day)))
      : [];
    const returnLocal = trip.series_return_local ? trip.series_return_local.slice(0, 5) : null;
    const stopLabelOf = (seq: number | null): string | null => (seq === null ? null : stops[seq]?.label ?? null);
    const item: TripSearchItem = {
      tripId: trip.id,
      seriesId: trip.series_id,
      leg: trip.leg,
      category: trip.category,
      driver: publicUserOrUnknown(drivers, trip.driver_user_id),
      vehicle: toVehicleSummary(trip, false),
      recurrence: trip.series_weekdays
        ? {
            weekdays: sortWeekdays(trip.series_weekdays),
            matchedWeekdays,
            fullMatch: input.mode === "weekly" && weekdays.every(day => trip.series_weekdays?.includes(day))
          }
        : null,
      departureAt: iso(departure),
      seatsAvailable,
      seatsOffered: trip.offered_seats,
      pickup: {
        label: stopLabelOf(pickup.stopSeq) ?? pickup.label,
        location: viewPoint(pickup.location, false),
        pickupAt: iso(pickupAt),
        pickupAtLocal: localTimeOf(pickupAt),
        minutesFromNow: minutesFromNow >= 0 && minutesFromNow <= 180 ? minutesFromNow : null,
        walkDistanceM: walkIn.distanceM,
        walkMinutes: walkIn.minutes,
        onRoute: pickup.source === "route_projection",
        stopSeq: pickup.stopSeq
      },
      dropoff: {
        label: dropoff.stop.label,
        location: viewPoint({ lat: dropoff.stop.lat, lng: dropoff.stop.lng }, false),
        arriveAt: iso(arriveAt),
        arriveAtLocal: localTimeOf(arriveAt),
        walkDistanceM: walkOut.distanceM,
        walkMinutes: walkOut.minutes,
        stopSeq: dropoff.stop.seq
      },
      fromSegmentSeq: pickup.segmentSeq,
      toSegmentSeq: dropoff.stop.seq,
      roadDistanceM,
      durationMinutes: minutesFromSeconds(durationS),
      price: computeQuote(tariff, roadDistanceM).total,
      return: trip.series_id
        ? {
            available: returnLocal !== null,
            departsLocal: returnLocal,
            matchesRequested: input.returnAt
              ? returnLocal !== null && Math.abs(minutesOfDay(returnLocal) - minutesOfDay(input.returnAt)) <= input.toleranceMinutes
              : null
          }
        : null
    };
    evaluated.push({ item, arriveDiff, walk: pickup.straightM + dropoff.straightM });
  }

  evaluated.sort((a, b) =>
    a.arriveDiff - b.arriveDiff || a.walk - b.walk || a.item.departureAt.localeCompare(b.item.departureAt));
  const total = evaluated.length;
  const slice = evaluated.slice(input.offset, input.offset + input.limit).map(entry => entry.item);
  const next = input.offset + input.limit;
  return { items: slice, nextCursor: next < total ? encodeCursor({ o: next }) : null, total };
}

export function searchInputFromQuery(query: {
  provinceId: string; originLat: number; originLng: number; destLat: number; destLng: number;
  originLabel?: string | undefined; destLabel?: string | undefined; arriveBy: string; returnAt?: string | undefined;
  mode: SearchMode; date?: string | undefined; weekdays: Weekday[] | null; category?: TripCategory | undefined;
  onlyWithSeats?: boolean | undefined; toleranceMinutes?: number | undefined; radiusM?: number | undefined;
  cursor?: string | undefined; limit?: number | undefined;
}): SearchInput {
  return {
    provinceId: query.provinceId,
    origin: { lat: query.originLat, lng: query.originLng },
    dest: { lat: query.destLat, lng: query.destLng },
    originLabel: query.originLabel ?? null,
    destLabel: query.destLabel ?? null,
    arriveBy: query.arriveBy,
    returnAt: query.returnAt ?? null,
    mode: query.mode,
    date: query.date ?? null,
    weekdays: query.weekdays,
    category: query.category ?? null,
    onlyWithSeats: query.onlyWithSeats ?? true,
    toleranceMinutes: query.toleranceMinutes ?? 20,
    radiusM: query.radiusM ?? 2000,
    offset: offsetFromCursor(query.cursor),
    limit: query.limit ?? 20
  };
}

