/**
 * Borradores de viaje, plan de ruta dentro de la provincia y publicación
 * (`src/services/trip-draft-service.ts`, `src/maps/province-route-service.ts`, `src/services/trip-service.ts`).
 *
 * La ruta la calcula el proveedor SIMULADO (`providers/routing.ts`); «dentro de la provincia» se comprueba contra el
 * contorno simplificado de `data/provinces.ts` (todos los vértices de la polilínea deben quedar dentro).
 */
import { requireAnyRole } from "../core/auth";
import type { PreviewDb } from "../core/db";
import { ApiFailure } from "../core/errors";
import { pointInRing, type LngLat } from "../core/geo";
import { newestFirst } from "../core/order";
import type { ProvinceRow, TripCategory, TripLeg, TripRow } from "../core/rows";
import type { GeoLatLng, Principal } from "../core/types";
import { labelForPoint } from "../providers/geocoder";
import { computeRoutes, segmentsRef, ROUTE_PROVIDER_NAME, type RouteCandidate } from "../providers/routing";
import { writeAudit } from "./audit";
import { assertVehicleCanDrive } from "./vehicles";
import { tripDraftWire } from "./wire";

export interface CreateTripDraftInput {
  vehicleId: string;
  provinceId: string;
  category: TripCategory;
  leg: TripLeg;
  departureAt: string;
  flexibilityMinutes: number;
  maxDetourM: number;
  offeredSeats: number;
  origin: GeoLatLng;
  destination: GeoLatLng;
  intermediates?: GeoLatLng[];
}

export function requireProvince(db: PreviewDb, provinceId: string): Readonly<ProvinceRow> {
  const province = db.provinces.get(provinceId);
  if (!province) throw new ApiFailure("PROVINCE_NOT_FOUND", "Province not found", 404);
  return province;
}

export function pointCoveredByProvince(province: Readonly<ProvinceRow>, point: GeoLatLng): boolean {
  return pointInRing(point.latitude, point.longitude, province.ring);
}

export function routeCoveredByProvince(province: Readonly<ProvinceRow>, route: RouteCandidate): boolean {
  return route.geometry.coordinates.every(([lng, lat]) => pointInRing(lat, lng, province.ring));
}

export interface ProvinceRouteSegmentPlan {
  route: RouteCandidate;
  segments: RouteCandidate[];
}

function combineSegmentRoutes(segments: RouteCandidate[]): RouteCandidate {
  const coordinates: LngLat[] = [];
  for (const segment of segments) {
    for (const coordinate of segment.geometry.coordinates) {
      const previous = coordinates[coordinates.length - 1];
      if (!previous || previous[0] !== coordinate[0] || previous[1] !== coordinate[1]) coordinates.push(coordinate);
    }
  }
  if (coordinates.length < 2) {
    throw new ApiFailure("ROUTING_PROVIDER_BAD_RESPONSE", "Segmented route produced no usable geometry", 502);
  }
  return {
    provider: ROUTE_PROVIDER_NAME,
    providerRef: segmentsRef(segments),
    distanceMeters: segments.reduce((sum, s) => sum + s.distanceMeters, 0),
    durationSeconds: segments.reduce((sum, s) => sum + s.durationSeconds, 0),
    geometry: { type: "LineString", coordinates },
    labels: ["PROVINCE_SEGMENTED_FALLBACK"],
  };
}

/** `computeProvinceCompliantSegmentPlan`: una ruta por tramo entre paradas consecutivas, todas dentro de la provincia. */
export function computeProvinceCompliantSegmentPlan(
  db: PreviewDb,
  request: { provinceId: string; origin: GeoLatLng; destination: GeoLatLng; intermediates?: readonly GeoLatLng[]; departureTime?: string }
): ProvinceRouteSegmentPlan {
  const province = requireProvince(db, request.provinceId);
  const points = [request.origin, ...(request.intermediates ?? []), request.destination];
  points.forEach((point, index) => {
    if (!pointCoveredByProvince(province, point)) {
      throw new ApiFailure(
        "ROUTE_POINT_OUTSIDE_PROVINCE",
        "Origin, destination and every intermediate stop must be inside the selected province",
        422,
        { pointIndex: index }
      );
    }
  });

  const segments: RouteCandidate[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const candidates = computeRoutes({
      origin: points[index] as GeoLatLng,
      destination: points[index + 1] as GeoLatLng,
      alternatives: true,
      ...(index === 0 && request.departureTime ? { departureTime: request.departureTime } : {}),
    });
    const selected = candidates.find((candidate) => routeCoveredByProvince(province, candidate));
    if (!selected) {
      throw new ApiFailure(
        "NO_ROUTE_WITHIN_PROVINCE",
        "At least one requested leg has no driving route that remains inside the selected province",
        422,
        { provider: ROUTE_PROVIDER_NAME, segmentIndex: index, candidatesChecked: candidates.length }
      );
    }
    segments.push(selected);
  }

  const route = combineSegmentRoutes(segments);
  if (!routeCoveredByProvince(province, route)) {
    throw new ApiFailure("NO_ROUTE_WITHIN_PROVINCE", "Combined route does not remain inside the selected province", 422, {
      provider: ROUTE_PROVIDER_NAME,
    });
  }
  return { route, segments };
}

function validateInput(db: PreviewDb, input: CreateTripDraftInput): number {
  const departure = Date.parse(input.departureAt);
  if (Number.isNaN(departure)) throw new ApiFailure("INVALID_DEPARTURE_TIME", "departureAt must be a valid ISO timestamp");
  if (departure < db.nowMs() - 300_000) {
    throw new ApiFailure("DEPARTURE_TIME_IN_PAST", "Departure time cannot be in the past", 422);
  }
  if (!Number.isInteger(input.flexibilityMinutes) || input.flexibilityMinutes < 0 || input.flexibilityMinutes > 60) {
    throw new ApiFailure("INVALID_FLEXIBILITY", "Flexibility must be between 0 and 60 minutes");
  }
  if (!Number.isInteger(input.maxDetourM) || input.maxDetourM < 0 || input.maxDetourM > 100_000) {
    throw new ApiFailure("INVALID_MAX_DETOUR", "Maximum detour is invalid");
  }
  if (!Number.isInteger(input.offeredSeats) || input.offeredSeats < 1 || input.offeredSeats > 8) {
    throw new ApiFailure("INVALID_OFFERED_SEATS", "Offered seats must be between 1 and 8");
  }
  if ((input.intermediates?.length ?? 0) > 10) {
    throw new ApiFailure("TOO_MANY_STOPS", "A trip can contain at most 10 intermediate stops");
  }
  return departure;
}

/** Inserta el viaje + paradas + tramos de un plan ya calculado (lo reutiliza `POST /v1/me/routes` del módulo `trips`). */
export function insertTripWithPlan(
  db: PreviewDb,
  input: {
    /** Id fijo (datos sembrados); si falta se genera uno. */
    id?: string;
    driverUserId: string;
    vehicleId: string;
    provinceId: string;
    category: TripCategory;
    leg: TripLeg;
    departureAtMs: number;
    flexibilityMinutes: number;
    maxDetourM: number;
    offeredSeats: number;
    origin: GeoLatLng;
    destination: GeoLatLng;
    intermediates?: readonly GeoLatLng[];
    status?: TripRow["status"];
    stopLabels?: readonly (string | null)[];
  },
  plan: ProvinceRouteSegmentPlan
): Readonly<TripRow> {
  const now = db.nowMs();
  const trip = db.trips.insert({
    id: input.id ?? db.ids.uuid(),
    driver_user_id: input.driverUserId,
    vehicle_id: input.vehicleId,
    province_id: input.provinceId,
    category: input.category,
    kind: "single",
    leg: input.leg,
    status: input.status ?? "draft",
    departure_at: input.departureAtMs,
    flexibility_minutes: input.flexibilityMinutes,
    max_detour_m: input.maxDetourM,
    offered_seats: input.offeredSeats,
    origin_lat: input.origin.latitude,
    origin_lng: input.origin.longitude,
    destination_lat: input.destination.latitude,
    destination_lng: input.destination.longitude,
    route_geometry: plan.route.geometry.coordinates,
    route_distance_m: plan.route.distanceMeters,
    route_duration_s: plan.route.durationSeconds,
    route_provider: plan.route.provider,
    route_provider_ref: plan.route.providerRef,
    route_version: 1,
    started_at: null,
    completed_at: null,
    created_at: now,
    updated_at: now,
  });
  const points = [input.origin, ...(input.intermediates ?? []), input.destination];
  points.forEach((point, seq) => {
    db.tripStops.insert({
      id: `${trip.id}:${seq}`,
      trip_id: trip.id,
      seq,
      kind: seq === 0 ? "origin" : seq === points.length - 1 ? "destination" : "stop",
      lat: point.latitude,
      lng: point.longitude,
      label: input.stopLabels?.[seq] ?? labelForPoint(point),
    });
  });
  plan.segments.forEach((segment, seq) => {
    db.tripSegments.insert({
      id: `${trip.id}:${seq}`,
      trip_id: trip.id,
      seq,
      from_stop_seq: seq,
      to_stop_seq: seq + 1,
      distance_m: segment.distanceMeters,
      duration_s: segment.durationSeconds,
      capacity: input.offeredSeats,
    });
  });
  return trip;
}

export function createTripDraftWithServerRoute(db: PreviewDb, principal: Principal, input: CreateTripDraftInput, requestId?: string) {
  requireAnyRole(principal, ["driver"]);
  const departure = validateInput(db, input);

  const vehicle = db.vehicles.get(input.vehicleId);
  if (!vehicle) throw new ApiFailure("VEHICLE_NOT_FOUND", "Vehicle not found", 404);
  if (vehicle.driver_user_id !== principal.userId) {
    throw new ApiFailure("VEHICLE_NOT_OWNED", "Only the vehicle owner may create a trip with it", 403);
  }
  if (input.offeredSeats > vehicle.passenger_seats) {
    throw new ApiFailure("OFFERED_SEATS_EXCEED_VEHICLE", "Offered seats exceed vehicle capacity", 422);
  }

  const plan = computeProvinceCompliantSegmentPlan(db, {
    provinceId: input.provinceId,
    origin: input.origin,
    destination: input.destination,
    ...(input.intermediates?.length ? { intermediates: input.intermediates } : {}),
    departureTime: new Date(departure).toISOString(),
  });

  return db.tx(() => {
    const trip = insertTripWithPlan(
      db,
      {
        driverUserId: principal.userId,
        vehicleId: input.vehicleId,
        provinceId: input.provinceId,
        category: input.category,
        leg: input.leg,
        departureAtMs: departure,
        flexibilityMinutes: input.flexibilityMinutes,
        maxDetourM: input.maxDetourM,
        offeredSeats: input.offeredSeats,
        origin: input.origin,
        destination: input.destination,
        ...(input.intermediates ? { intermediates: input.intermediates } : {}),
      },
      plan
    );
    writeAudit(db, {
      actorUserId: principal.userId,
      action: "trip.draft.created",
      entityType: "trip",
      entityId: trip.id,
      requestId: requestId ?? null,
      metadata: { provider: plan.route.provider, segmentCount: plan.segments.length, routeDistanceM: plan.route.distanceMeters },
    });
    return tripDraftWire(trip, { withOwner: true });
  });
}

export function listOwnDriverTrips(db: PreviewDb, principal: Principal) {
  requireAnyRole(principal, ["driver"]);
  return newestFirst(
    db.trips.filter((t) => t.driver_user_id === principal.userId),
    (t) => t.created_at
  ).map((t) => tripDraftWire(t, { withOwner: false }));
}

export function publishOwnedTrip(db: PreviewDb, principal: Principal, tripId: string): void {
  requireAnyRole(principal, ["driver"]);
  const trip = db.trips.get(tripId);
  if (!trip) throw new ApiFailure("TRIP_NOT_FOUND", "Trip not found", 404);
  if (trip.driver_user_id !== principal.userId) throw new ApiFailure("TRIP_NOT_OWNED", "Only the trip driver may publish it", 403);
  if (trip.kind === "recurring") {
    throw new ApiFailure("RECURRING_TRIP_NOT_READY", "Recurring trip scheduling is not implemented yet", 409);
  }
  publishTrip(db, tripId);
}

/** Comprobaciones de `publishTrip`, en el mismo orden que el backend. */
export function publishTrip(db: PreviewDb, tripId: string): void {
  db.tx(() => {
    const trip = db.trips.get(tripId);
    if (!trip) throw new ApiFailure("TRIP_NOT_FOUND", "Trip not found", 404);
    if (trip.status !== "draft") throw new ApiFailure("TRIP_NOT_DRAFT", "Only draft trips can be published");
    if (trip.route_geometry.length < 2 || !trip.route_distance_m || !trip.route_provider || !trip.route_provider_ref) {
      throw new ApiFailure("MVC_ROUTE_UNVERIFIED", "Verified routed geometry and distance are required");
    }
    const vehicle = db.vehicles.get(trip.vehicle_id);
    const profile = db.profiles.get(trip.driver_user_id);
    if (!vehicle || !profile) throw new ApiFailure("TRIP_NOT_FOUND", "Trip not found", 404);
    if (profile.public_photo_status !== "approved") {
      throw new ApiFailure("DRIVER_PUBLIC_PHOTO_REQUIRED", "Approved public profile photo is required");
    }
    if (profile.identity_status !== "verified") {
      throw new ApiFailure("DRIVER_IDENTITY_REQUIRED", "Verified driver identity is required");
    }
    if (vehicle.review_status !== "approved" || vehicle.documentation_status !== "approved") {
      throw new ApiFailure("VEHICLE_NOT_APPROVED", "Vehicle and documentation must be approved");
    }
    assertVehicleCanDrive(db, trip.vehicle_id);
    if (trip.offered_seats > vehicle.passenger_seats) {
      throw new ApiFailure("OFFERED_SEATS_EXCEED_VEHICLE", "Offered seats exceed vehicle capacity");
    }

    const province = requireProvince(db, trip.province_id);
    const stops = db.tripStops.filter((s) => s.trip_id === tripId);
    if (stops.some((s) => !pointCoveredByProvince(province, { latitude: s.lat, longitude: s.lng }))) {
      throw new ApiFailure("MVC_STOP_OUTSIDE_PROVINCE", "One or more stops are outside the trip province");
    }

    const segments = db.tripSegments.filter((s) => s.trip_id === tripId);
    if (segments.length < 1) throw new ApiFailure("TRIP_SEGMENTS_REQUIRED", "At least one route segment is required");
    if (Math.max(0, ...segments.map((s) => s.capacity)) > trip.offered_seats) {
      throw new ApiFailure("SEGMENT_CAPACITY_INVALID", "Segment capacity exceeds offered seats");
    }

    const published = db.trips.update(tripId, { status: "published", updated_at: db.nowMs() });
    db.events.emit("trip.published", { trip: published });
  });
}
