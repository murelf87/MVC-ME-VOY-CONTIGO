import type { Pool } from "pg";
import type { AuthPrincipal } from "../../auth/session.js";
import type { GeocodingProvider } from "../../maps/types.js";
import { iso, localTimeOf } from "./common.js";
import { bookability, viewerStanding } from "./detail-service.js";
import { err } from "./errors.js";
import {
  canAlightAt, pickupPointsResponse, proposePickupPoints, viewPoint
} from "./pickup-service.js";
import { computeQuote, loadApprovedTariff } from "./quote-service.js";
import { resolveRequestLeg } from "./requests.js";
import { freeSeatsInRange, loadSegmentLoads, loadStops, loadTrips, stopOffsets } from "./trip-data.js";
import type {
  GeoPoint, PickupPointsResponse, RequestPoint, TripQuoteRequest, TripQuoteResponse
} from "./types.js";

/**
 * `GET /v1/trips/:tripId/pickup-points` — propuestas A/B de punto de recogida (pantalla 13). Solo propuestas dentro de
 * 2,5 km (línea recta) de la posición indicada, sobre paradas declaradas o sobre la ruta si el viaje recoge «en ruta».
 */
export async function pickupPoints(
  pool: Pool,
  geocoder: GeocodingProvider | null,
  principal: AuthPrincipal,
  tripId: string,
  query: { lat: number; lng: number; dropoffStopSeq?: number | undefined; limit: number }
): Promise<PickupPointsResponse> {
  const trip = (await loadTrips(pool, [tripId])).get(tripId);
  if (!trip || (trip.status === "draft" || trip.status === "cancelled")) throw err("TRIP_NOT_FOUND", 404, "El viaje no existe.");
  if (trip.driver_user_id === principal.userId) {
    throw err("DRIVER_CANNOT_REQUEST_OWN_TRIP", 409, "No puedes solicitar plaza en tu propio viaje.");
  }
  if (!["published", "active"].includes(trip.status) || !trip.vehicle_bookable) {
    throw err("TRIP_NOT_BOOKABLE", 409, "Este viaje ya no admite solicitudes.");
  }
  const [stopsMap, loadsMap] = await Promise.all([loadStops(pool, [tripId]), loadSegmentLoads(pool, [tripId])]);
  const stops = stopsMap.get(tripId) ?? [];
  const segments = loadsMap.get(tripId) ?? [];
  const dropoffSeq = query.dropoffStopSeq ?? stops.length - 1;
  const dropoff = Number.isInteger(dropoffSeq) ? stops[dropoffSeq] : undefined;
  if (!dropoff || !canAlightAt(dropoff)) throw err("DROPOFF_STOP_INVALID", 422, "La parada de bajada no es válida para este viaje.");
  const origin: GeoPoint = { lat: query.lat, lng: query.lng };
  const proposals = await proposePickupPoints(pool, geocoder, { trip, stops, segments, origin, dropoffSeq, limit: query.limit });
  return pickupPointsResponse(trip, stops, origin, dropoffSeq, proposals);
}

/**
 * `POST /v1/trips/:tripId/quote` — «Revisa tu solicitud» y «Ver desglose». No crea nada: calcula la aportación sobre los
 * km de carretera del tramo del pasajero con la tarifa APROBADA (o «Por definir» si no hay ninguna).
 */
export async function quoteTrip(
  pool: Pool,
  viewer: AuthPrincipal | null,
  tripId: string,
  body: TripQuoteRequest,
  now = new Date()
): Promise<TripQuoteResponse> {
  const trip = (await loadTrips(pool, [tripId])).get(tripId);
  const isDriver = trip !== undefined && viewer?.userId === trip.driver_user_id;
  if (!trip || ((trip.status === "draft" || trip.status === "cancelled") && !isDriver)) throw err("TRIP_NOT_FOUND", 404, "El viaje no existe.");
  if (!["published", "active"].includes(trip.status)) throw err("TRIP_NOT_BOOKABLE", 409, "Este viaje ya no admite solicitudes.");

  const [stopsMap, loadsMap, tariff, standing] = await Promise.all([
    loadStops(pool, [tripId]), loadSegmentLoads(pool, [tripId]), loadApprovedTariff(pool),
    viewerStanding(pool, trip, viewer?.userId ?? null)
  ]);
  const stops = stopsMap.get(tripId) ?? [];
  const segments = loadsMap.get(tripId) ?? [];
  const noShape = body.pickupPointId === undefined && body.fromSegmentSeq === undefined &&
    body.toSegmentSeq === undefined && body.dropoffStopSeq === undefined;
  const leg = await resolveRequestLeg(pool, trip, stops, segments, noShape
    ? { fromSegmentSeq: 0, toSegmentSeq: Math.max(1, stops.length - 1) }
    : body);

  const offsets = stopOffsets(stops, segments);
  const departure = trip.departure_at ?? now;
  const roadDistanceM = leg.extras.roadDistanceM ?? 0;
  const pickupInfo = leg.extras.pickup;
  const dropoffSeq = leg.extras.dropoffStopSeq ?? leg.toSegmentSeq;
  const dropoffStop = stops[dropoffSeq];
  const boardsAt = new Date(departure.getTime() + (pickupInfo?.offsetS ?? offsets[leg.fromSegmentSeq] ?? 0) * 1000);
  const arrivesAt = new Date(departure.getTime() + (offsets[dropoffSeq] ?? 0) * 1000);

  // Un punto de recogida propuesto (A/B) es un punto de encuentro público: se enseña con precisión a quien lo ha pedido
  // con sesión. En el resto de casos (tramos heredados) la precisión depende de la relación con el viaje.
  const precisePickup = body.pickupPointId !== undefined && viewer !== null ? true : standing.precision === "precise";
  const preciseDropoff = viewer !== null && body.pickupPointId !== undefined ? true : standing.precision === "precise";
  const pickup: RequestPoint = {
    label: pickupInfo?.label ?? stops[leg.fromSegmentSeq]?.label ?? null,
    address: null,
    location: viewPoint(
      pickupInfo ? { lat: pickupInfo.lat, lng: pickupInfo.lng } : { lat: stops[leg.fromSegmentSeq]?.lat ?? 0, lng: stops[leg.fromSegmentSeq]?.lng ?? 0 },
      precisePickup
    ),
    atLocal: localTimeOf(boardsAt),
    at: iso(boardsAt),
    walkMinutes: pickupInfo?.walkMinutes ?? null,
    detourMinutes: pickupInfo?.detourMinutes ?? null
  };
  const dropoff: RequestPoint = {
    label: dropoffStop?.label ?? null,
    address: null,
    location: viewPoint({ lat: dropoffStop?.lat ?? 0, lng: dropoffStop?.lng ?? 0 }, preciseDropoff),
    atLocal: localTimeOf(arrivesAt),
    at: iso(arrivesAt),
    walkMinutes: null,
    detourMinutes: null
  };
  const free = freeSeatsInRange(segments, leg.fromSegmentSeq, leg.toSegmentSeq);
  const can = bookability({ trip, userId: viewer?.userId ?? null, standing, freeSeats: free, now });
  return {
    tripId,
    quote: computeQuote(tariff, roadDistanceM),
    pickup,
    dropoff,
    seatsAvailable: free,
    roadDistanceM,
    canRequest: can.canRequest,
    cannotRequestReason: can.reason
  };
}
