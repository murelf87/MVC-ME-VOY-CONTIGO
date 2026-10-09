/**
 * Lógica del servidor simulado de «buscar y ver viajes»: catálogo de categorías, mapa de inicio, búsqueda por hora de
 * llegada y detalle del viaje. Porta `src/modules/trips/{search-service,detail-service}.ts` del backend real sobre la base
 * en memoria (los viajes, paradas y tramos son los del núcleo; lo que el núcleo no modela vive en `browseMeta.ts`).
 *
 * SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`).
 */
import type {
  GeoPoint,
  IsoDate,
  LocalTime,
  MapCar,
  MapCarsResponse,
  SearchMode,
  SearchSuggestion,
  TripCategory,
  TripCategoryInfo,
  TripDetail,
  TripDetailStop,
  TripSearchItem,
  TripSearchPage,
  Weekday,
} from "@/api/types";
import { fail, isoReq, madridDate, madridParts, publicUser, snapToGrid, type PreviewDb, type TripRow } from "@/preview";
import {
  bestDropoffStop,
  bestPickupOption,
  canAlightAt,
  canBoardAt,
  freeSeatsInRange,
  fromBase64Url,
  loadTripGeometry,
  maxFreeSeats,
  minutesFromSeconds,
  toBase64Url,
  walkEstimate,
  type PickupOption,
  type TripGeometry,
} from "./browseGeometry";
import { WEEKDAY_ORDER, WORKDAYS, metaFor, readPreviewTariff, type TripMetaRow } from "./browseMeta";
import { computeQuote } from "./browseQuote";
import {
  assertProvince,
  bookability,
  loadVisibleTrip,
  localMinutesOf,
  localTimeOf,
  minutesOfDay,
  pointInProvince,
  vehicleBookable,
  vehicleSummary,
  viewerStanding,
  viewPoint,
} from "./browseShared";

/** Segundos tras los que una posición en directo deja de presentarse como «en directo». */
const LIVE_STALE_SECONDS = 60;

// ---------------------------------------------------------------------------------------------------------------
// GET /v1/trip-categories
// ---------------------------------------------------------------------------------------------------------------

/** Categorías de viaje (pantallas 09, 10 y 18). El orden es el de las pantallas. */
export const TRIP_CATEGORIES: readonly TripCategoryInfo[] = [
  { id: "work", label: "Trabajo" },
  { id: "university", label: "Universidad" },
  { id: "fp_academies", label: "FP" },
  { id: "hospital", label: "Hospital" },
  { id: "sport", label: "Deporte" },
  { id: "other", label: "Otros" },
];

// ---------------------------------------------------------------------------------------------------------------
// Cursor opaco (`{ o: desplazamiento }`, como el backend real)
// ---------------------------------------------------------------------------------------------------------------

function encodeCursor(offset: number): string {
  return toBase64Url(JSON.stringify({ o: offset }));
}

function offsetFromCursor(cursor: string | undefined): number {
  if (cursor === undefined || cursor === "") return 0;
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(cursor));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const offset = (parsed as Record<string, unknown>).o;
      if (typeof offset === "number" && Number.isInteger(offset) && offset >= 0 && offset <= 100_000) return offset;
    }
  } catch {
    // cae al error de abajo
  }
  return fail("INVALID_CURSOR", "El cursor de paginación no es válido.", 400);
}

function sortWeekdays(days: readonly Weekday[]): Weekday[] {
  return WEEKDAY_ORDER.filter((day) => days.includes(day));
}

/** `weekdays` CSV de la query → lista ordenada y sin repetidos; `null` si no se envió. */
export function parseWeekdaysCsv(value: string | undefined): Weekday[] | null {
  if (value === undefined || value.trim() === "") return null;
  const parts = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const valid = parts.filter((part): part is Weekday => (WEEKDAY_ORDER as readonly string[]).includes(part));
  if (valid.length !== parts.length || valid.length === 0) {
    return fail("INVALID_SEARCH_WEEKDAYS", "Los días indicados no son válidos. Usa mon,tue,wed,thu,fri,sat,sun.", 422);
  }
  return sortWeekdays([...new Set(valid)]);
}

// ---------------------------------------------------------------------------------------------------------------
// GET /v1/trips/map  (pantalla 09)
// ---------------------------------------------------------------------------------------------------------------

export interface MapQuery {
  provinceId: string;
  category: TripCategory | null;
  onlyWithSeats: boolean;
  withinHours: number;
  limit: number;
}

export function mapCars(db: PreviewDb, query: MapQuery): MapCarsResponse {
  assertProvince(db, query.provinceId);
  const now = db.nowMs();
  const until = now + query.withinHours * 3_600_000;
  const rows = db.trips
    .filter((trip) => {
      if (trip.province_id !== query.provinceId || !vehicleBookable(db, trip)) return false;
      if (query.category !== null && trip.category !== query.category) return false;
      if (trip.status === "active") return true;
      return trip.status === "published" && trip.departure_at !== null && trip.departure_at >= now - 5 * 60_000 && trip.departure_at <= until;
    })
    .sort((a, b) => (a.departure_at ?? 0) - (b.departure_at ?? 0) || a.id.localeCompare(b.id))
    .slice(0, query.limit * 3 + 1);

  const cars: MapCar[] = [];
  for (const trip of rows) {
    const meta = metaFor(db, trip.id);
    const geo = loadTripGeometry(db, trip, meta);
    const seatsAvailable = maxFreeSeats(geo.segments);
    if (query.onlyWithSeats && seatsAvailable === 0) continue;
    const state = db.liveState.get(trip.id);
    const live = trip.status === "active" && state !== undefined;
    const origin = geo.stops[0];
    if (!live && !origin) continue;
    const base = live && state ? { lat: state.lat, lng: state.lng } : { lat: origin?.lat ?? 0, lng: origin?.lng ?? 0 };
    const age = live && state ? Math.max(0, Math.floor((now - state.recorded_at) / 1000)) : null;
    cars.push({
      tripId: trip.id,
      category: trip.category,
      state: trip.status === "active" ? "live" : "scheduled",
      position: {
        lat: snapToGrid(base.lat),
        lng: snapToGrid(base.lng),
        precision: "approximate",
        source: live ? "live_gps" : "origin",
        recordedAt: live && state ? isoReq(state.recorded_at) : null,
        stale: live ? (age ?? 0) > LIVE_STALE_SECONDS : false,
        ageSeconds: age,
      },
      seatsAvailable,
      seatsOffered: trip.offered_seats,
      full: seatsAvailable === 0,
      departureAt: isoReq(trip.departure_at ?? now),
      originLabel: geo.stops[0]?.label ?? null,
      destinationLabel: geo.stops[geo.stops.length - 1]?.label ?? null,
    });
  }
  return {
    provinceId: query.provinceId,
    generatedAt: isoReq(now),
    cars: cars.slice(0, query.limit),
    truncated: cars.length > query.limit,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// GET /v1/search/trips  (pantallas 10 y 11)
// ---------------------------------------------------------------------------------------------------------------

export interface SearchInput {
  provinceId: string;
  origin: GeoPoint;
  dest: GeoPoint;
  originLabel: string | null;
  destLabel: string | null;
  arriveBy: LocalTime;
  returnAt: LocalTime | null;
  mode: SearchMode;
  date: IsoDate | null;
  weekdays: Weekday[] | null;
  category: TripCategory | null;
  onlyWithSeats: boolean;
  toleranceMinutes: number;
  radiusM: number;
  offset: number;
  limit: number;
}

interface Evaluated {
  item: TripSearchItem;
  arriveDiff: number;
  walk: number;
}

function runSearch(db: PreviewDb, input: SearchInput, viewerUserId: string | null): { items: TripSearchItem[]; nextCursor: string | null; total: number } {
  assertProvince(db, input.provinceId);
  if (!pointInProvince(db, input.provinceId, input.origin)) return fail("ORIGIN_OUTSIDE_PROVINCE", "Origen fuera de provincia.", 422);
  if (!pointInProvince(db, input.provinceId, input.dest)) return fail("DESTINATION_OUTSIDE_PROVINCE", "Destino fuera de provincia.", 422);
  if (input.mode === "one_off" && !input.date) return fail("SEARCH_DATE_REQUIRED", "Indica la fecha para un viaje puntual.", 422);

  const now = db.nowMs();
  const weekdays: Weekday[] = input.mode === "weekly" ? (input.weekdays ?? [...WORKDAYS]) : [];
  const tariff = readPreviewTariff(db);
  const candidates = db.trips
    .filter((trip) => {
      if (trip.province_id !== input.provinceId || trip.status !== "published" || trip.leg !== "outbound") return false;
      if (trip.departure_at === null || trip.departure_at <= now || !vehicleBookable(db, trip)) return false;
      if (input.category !== null && trip.category !== input.category) return false;
      if (viewerUserId !== null && trip.driver_user_id === viewerUserId) return false;
      if (input.mode === "one_off") return madridDate(trip.departure_at) === input.date;
      const meta = metaFor(db, trip.id);
      const occurrenceDay = WEEKDAY_ORDER[madridParts(trip.departure_at).isoWeekday - 1];
      return meta.seriesId !== null && occurrenceDay !== undefined && weekdays.includes(occurrenceDay);
    })
    .sort((a, b) => (a.departure_at ?? 0) - (b.departure_at ?? 0) || a.id.localeCompare(b.id))
    .slice(0, 600);

  const arriveBy = minutesOfDay(input.arriveBy);
  const evaluated: Evaluated[] = [];
  const seenSeries = new Set<string>();
  for (const trip of candidates) {
    const meta = metaFor(db, trip.id);
    if (input.mode === "weekly" && meta.seriesId && seenSeries.has(meta.seriesId)) continue;
    const geo = loadTripGeometry(db, trip, meta);
    const departure = trip.departure_at;
    if (departure === null || geo.stops.length < 2) continue;
    const pickup = bestPickupOption(geo, meta, input.origin, input.radiusM);
    if (!pickup) continue;
    const dropoff = bestDropoffStop(geo, pickup, input.dest, input.radiusM);
    if (!dropoff) continue;
    const arriveAt = departure + (geo.offsets[dropoff.stop.seq] ?? 0) * 1000;
    const arriveDiff = Math.abs(localMinutesOf(arriveAt) - arriveBy);
    if (arriveDiff > input.toleranceMinutes) continue;
    const seatsAvailable = freeSeatsInRange(geo.segments, pickup.segmentSeq, dropoff.stop.seq);
    if (input.onlyWithSeats && seatsAvailable <= 0) continue;
    if (meta.seriesId) seenSeries.add(meta.seriesId);

    const roadDistanceM = Math.max(0, (geo.distances[dropoff.stop.seq] ?? 0) - pickup.distanceFromStartM);
    const durationS = Math.max(0, (geo.offsets[dropoff.stop.seq] ?? 0) - pickup.offsetS);
    const pickupAt = departure + pickup.offsetS * 1000;
    const walkIn = walkEstimate(pickup.straightM);
    const walkOut = walkEstimate(dropoff.straightM);
    const minutesFromNow = Math.round((pickupAt - now) / 60_000);
    const seriesDays = meta.weekdays;
    const matchedWeekdays = seriesDays ? sortWeekdays(weekdays.filter((day) => seriesDays.includes(day))) : [];
    const stopLabel = pickup.stopSeq === null ? null : (geo.stops[pickup.stopSeq]?.label ?? null);
    const driver = publicUser(db, trip.driver_user_id);
    const returnLocal = meta.returnLocal;
    const item: TripSearchItem = {
      tripId: trip.id,
      seriesId: meta.seriesId,
      leg: trip.leg,
      category: trip.category,
      driver,
      vehicle: vehicleSummary(db, trip, false, false),
      recurrence: seriesDays
        ? {
            weekdays: sortWeekdays(seriesDays),
            matchedWeekdays,
            fullMatch: input.mode === "weekly" && weekdays.every((day) => seriesDays.includes(day)),
          }
        : null,
      departureAt: isoReq(departure),
      seatsAvailable,
      seatsOffered: trip.offered_seats,
      pickup: {
        label: stopLabel ?? pickup.label,
        location: viewPoint(pickup.location, false),
        pickupAt: isoReq(pickupAt),
        pickupAtLocal: localTimeOf(pickupAt),
        minutesFromNow: minutesFromNow >= 0 && minutesFromNow <= 180 ? minutesFromNow : null,
        walkDistanceM: walkIn.distanceM,
        walkMinutes: walkIn.minutes,
        onRoute: pickup.source === "route_projection",
        stopSeq: pickup.stopSeq,
      },
      dropoff: {
        label: dropoff.stop.label,
        location: viewPoint({ lat: dropoff.stop.lat, lng: dropoff.stop.lng }, false),
        arriveAt: isoReq(arriveAt),
        arriveAtLocal: localTimeOf(arriveAt),
        walkDistanceM: walkOut.distanceM,
        walkMinutes: walkOut.minutes,
        stopSeq: dropoff.stop.seq,
      },
      fromSegmentSeq: pickup.segmentSeq,
      toSegmentSeq: dropoff.stop.seq,
      roadDistanceM,
      durationMinutes: minutesFromSeconds(durationS),
      price: computeQuote(tariff, roadDistanceM).total,
      return: meta.seriesId
        ? {
            available: returnLocal !== null,
            departsLocal: returnLocal,
            matchesRequested: input.returnAt
              ? returnLocal !== null && Math.abs(minutesOfDay(returnLocal) - minutesOfDay(input.returnAt)) <= input.toleranceMinutes
              : null,
          }
        : null,
    };
    evaluated.push({ item, arriveDiff, walk: pickup.straightM + dropoff.straightM });
  }

  evaluated.sort((a, b) => a.arriveDiff - b.arriveDiff || a.walk - b.walk || a.item.departureAt.localeCompare(b.item.departureAt));
  const total = evaluated.length;
  const items = evaluated.slice(input.offset, input.offset + input.limit).map((entry) => entry.item);
  const next = input.offset + input.limit;
  return { items, nextCursor: next < total ? encodeCursor(next) : null, total };
}

export function searchTrips(db: PreviewDb, input: SearchInput, viewerUserId: string | null): TripSearchPage {
  const page = runSearch(db, input, viewerUserId);
  const suggestions: SearchSuggestion[] = [];
  if (input.offset === 0 && page.total < 3) {
    const alternatives: Array<{ kind: SearchSuggestion["kind"]; changed: SearchInput; apply: SearchSuggestion["apply"]; text: string }> = [];
    if (input.toleranceMinutes < 90) {
      const tolerance = Math.min(90, input.toleranceMinutes + 30);
      alternatives.push({
        kind: "widen_time",
        changed: { ...input, toleranceMinutes: tolerance },
        apply: { toleranceMinutes: tolerance },
        text: "Prueba a ampliar el horario ±30 min",
      });
    }
    if (input.mode === "weekly" && (input.weekdays ?? WORKDAYS).length < 7) {
      alternatives.push({
        kind: "more_days",
        changed: { ...input, weekdays: [...WEEKDAY_ORDER] },
        apply: { weekdays: WEEKDAY_ORDER.join(",") },
        text: "Prueba con más días",
      });
    }
    if (input.radiusM < 10_000) {
      const radius = Math.min(10_000, input.radiusM * 2);
      alternatives.push({
        kind: "wider_radius",
        changed: { ...input, radiusM: radius },
        apply: { radiusM: radius },
        text: "Prueba a ampliar la zona de recogida",
      });
    }
    for (const alternative of alternatives) {
      const result = runSearch(db, { ...alternative.changed, offset: 0, limit: 50 }, viewerUserId);
      const extra = result.total - page.total;
      if (extra > 0) {
        suggestions.push({
          kind: alternative.kind,
          message: `${alternative.text}: ${extra === 1 ? "aparecería 1 coche más" : `aparecerían ${extra} coches más`}.`,
          wouldMatch: extra,
          apply: alternative.apply,
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
      destLabel: input.destLabel,
    },
  };
}

export function searchInputFromQuery(query: {
  provinceId: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  originLabel?: string;
  destLabel?: string;
  arriveBy: LocalTime;
  returnAt?: LocalTime;
  mode: SearchMode;
  date?: IsoDate;
  weekdays?: string;
  category?: TripCategory;
  onlyWithSeats?: boolean;
  toleranceMinutes?: number;
  radiusM?: number;
  cursor?: string;
  limit?: number;
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
    weekdays: parseWeekdaysCsv(query.weekdays),
    category: query.category ?? null,
    onlyWithSeats: query.onlyWithSeats ?? true,
    toleranceMinutes: query.toleranceMinutes ?? 20,
    radiusM: query.radiusM ?? 2000,
    offset: offsetFromCursor(query.cursor),
    limit: query.limit ?? 20,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// GET /v1/trips/:tripId  (pantalla 12)
// ---------------------------------------------------------------------------------------------------------------

export interface DetailQuery {
  pickupLat?: number;
  pickupLng?: number;
  dropoffStopSeq?: number;
}

/** Geometría simplificada: ≈110 m (cuadrícula de 0,001°) para quien no participa; 5 decimales para participantes. */
function routeCoordinates(geo: TripGeometry, precise: boolean): [number, number][] {
  const out: [number, number][] = [];
  for (const [lng, lat] of geo.route) {
    const point: [number, number] = precise
      ? [Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]
      : [Math.round(lng * 1000) / 1000, Math.round(lat * 1000) / 1000];
    const last = out[out.length - 1];
    if (!last || last[0] !== point[0] || last[1] !== point[1]) out.push(point);
  }
  return out;
}

export function tripDetail(db: PreviewDb, tripId: string, viewerUserId: string | null, query: DetailQuery): TripDetail {
  const trip: Readonly<TripRow> = loadVisibleTrip(db, tripId, viewerUserId);
  const isDriver = viewerUserId === trip.driver_user_id;
  const meta: TripMetaRow = metaFor(db, trip.id);
  const geo = loadTripGeometry(db, trip, meta);
  const standing = viewerStanding(db, trip, viewerUserId);
  const tariff = readPreviewTariff(db);
  const stops = geo.stops;
  const segments = geo.segments;
  const departure = trip.departure_at ?? db.nowMs();
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
    const fromStop = stops[fromSeg];
    yourPickupStop = fromStop && canBoardAt(fromStop, lastSeq) && standing.openRequest.pickupIsDeclaredStop ? fromSeg : null;
    yourDropoffStop = toSeg;
  } else if (query.pickupLat !== undefined && query.pickupLng !== undefined) {
    pickup = bestPickupOption(geo, meta, { lat: query.pickupLat, lng: query.pickupLng }, 5000);
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
      return fail("DROPOFF_STOP_INVALID", "La parada de bajada no es válida para este viaje.", 422);
    }
  }
  const rangeFrom = fromSeg ?? 0;
  const rangeTo = toSeg ?? lastSeq;
  const seatsAvailable = fromSeg !== null || standing.openRequest ? freeSeatsInRange(segments, rangeFrom, rangeTo) : maxFreeSeats(segments);

  const detailStops: TripDetailStop[] = stops.map((stop) => {
    const etaAt = departure + (geo.offsets[stop.seq] ?? 0) * 1000;
    return {
      seq: stop.seq,
      kind: stop.kind,
      label: stop.label,
      location: viewPoint({ lat: stop.lat, lng: stop.lng }, precise),
      etaAt: isoReq(etaAt),
      etaLocal: localTimeOf(etaAt),
      optional: stop.optional,
      detourMinutes: stop.optional ? stop.detourMinutes : null,
      isYourPickup: yourPickupStop === stop.seq,
      isYourDropoff: yourDropoffStop === stop.seq,
      canBoard: canBoardAt(stop, lastSeq),
      canAlight: canAlightAt(stop),
    };
  });

  const routeDistanceM = trip.route_distance_m;
  const routeDurationS = trip.route_duration_s;
  const rangeDistance =
    fromSeg !== null || toSeg !== null
      ? Math.max(0, (geo.distances[rangeTo] ?? routeDistanceM) - (pickup?.distanceFromStartM ?? geo.distances[rangeFrom] ?? 0))
      : routeDistanceM;
  const quote = computeQuote(tariff, rangeDistance);
  const bookable = bookability({ db, trip, userId: viewerUserId, standing, freeSeats: seatsAvailable });

  let owner: TripDetail["owner"] = null;
  if (isDriver) {
    const passengers = new Set<string>();
    for (const booking of db.bookings.all()) {
      if (booking.status !== "confirmed" && booking.status !== "completed") continue;
      const request = db.rideRequests.get(booking.request_id);
      if (request && request.trip_id === trip.id) passengers.add(request.passenger_user_id);
    }
    owner = {
      pendingRequests: db.rideRequests.count((r) => r.trip_id === trip.id && r.status === "pending"),
      confirmedPassengers: [...passengers].map((id) => publicUser(db, id)),
    };
  }

  return {
    id: trip.id,
    seriesId: meta.seriesId,
    status: trip.status,
    kind: trip.kind,
    leg: trip.leg,
    category: trip.category,
    provinceId: trip.province_id,
    provinceName: db.provinces.get(trip.province_id)?.name ?? "",
    driver: publicUser(db, trip.driver_user_id),
    vehicle: vehicleSummary(db, trip, standing.fullPlate, isDriver),
    departureAt: isoReq(departure),
    flexibilityMinutes: trip.flexibility_minutes,
    recurrence: meta.weekdays
      ? { weekdays: sortWeekdays(meta.weekdays), outboundLocal: localTimeOf(departure), returnLocal: meta.returnLocal }
      : null,
    pickupPolicy: { onRoute: meta.pickupOnRoute, maxDetourMinutes: meta.maxDetourMinutes },
    seats: {
      offered: trip.offered_seats,
      available: seatsAvailable,
      perSegment: segments.map((segment) => ({
        seq: segment.seq,
        fromStopSeq: segment.fromStopSeq,
        toStopSeq: segment.toStopSeq,
        capacity: segment.capacity,
        occupied: segment.occupied,
        free: Math.max(0, segment.capacity - segment.occupied),
        distanceM: segment.distanceM,
        durationMinutes: minutesFromSeconds(segment.durationS),
      })),
    },
    route: {
      distanceM: routeDistanceM,
      durationMinutes: minutesFromSeconds(routeDurationS),
      geometry: { type: "LineString", coordinates: routeCoordinates(geo, precise), precision: precise ? "precise" : "approximate" },
    },
    stops: detailStops,
    totals: {
      roadDistanceM: routeDistanceM,
      durationMinutes: minutesFromSeconds(routeDurationS),
      detourMinutes: stops.reduce((sum, stop) => sum + (stop.optional ? (stop.detourMinutes ?? 0) : 0), 0),
    },
    price: quote.total,
    breakdownAvailable: trip.status === "published" || trip.status === "active",
    viewer: {
      relation: standing.relation,
      precision: standing.precision,
      openRequest: standing.openRequest ? { id: standing.openRequest.id, status: standing.openRequest.status } : null,
    },
    owner,
    canRequest: bookable.canRequest,
    cannotRequestReason: bookable.reason,
  };
}
