/** Búsqueda de viajes publicados (`GET /v1/trips/search`, `src/services/trip-search-service.ts`). */
import type { PreviewDb } from "../core/db";
import { ApiFailure } from "../core/errors";
import { haversineM } from "../core/geo";
import type { TripStopRow } from "../core/rows";
import { iso } from "../core/wire";
import { availableSeatsForRange, segmentsOf } from "./seats";
import { utcToday } from "./vehicles";

export interface TripSearchInput {
  provinceId: string;
  originLatitude: number;
  originLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
  radiusM?: number;
  departureAfter?: string;
  departureBefore?: string;
  limit?: number;
}

export interface TripSearchResult {
  tripId: string;
  category: string;
  leg: string;
  departureAt: string | null;
  fromSegmentSeq: number;
  toSegmentSeq: number;
  pickupDistanceM: number;
  dropoffDistanceM: number;
  roadDistanceM: number;
  estimatedDurationS: number;
  availableSeats: number;
  driverDisplayName: string | null;
}

function finite(value: number, min: number, max: number, label: string): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new ApiFailure("INVALID_SEARCH_COORDINATE", `${label} is outside its valid range`);
  }
}

function parseDate(value: string | undefined, label: string): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new ApiFailure("INVALID_SEARCH_DATE", `${label} is invalid`);
  return ms;
}

export function searchPublishedTrips(db: PreviewDb, input: TripSearchInput): TripSearchResult[] {
  finite(input.originLatitude, -90, 90, "originLatitude");
  finite(input.originLongitude, -180, 180, "originLongitude");
  finite(input.destinationLatitude, -90, 90, "destinationLatitude");
  finite(input.destinationLongitude, -180, 180, "destinationLongitude");
  const radiusM = input.radiusM ?? 5000;
  if (!Number.isInteger(radiusM) || radiusM < 100 || radiusM > 50_000) {
    throw new ApiFailure("INVALID_SEARCH_RADIUS", "Search radius must be between 100 and 50000 meters");
  }
  const limit = input.limit ?? 30;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ApiFailure("INVALID_SEARCH_LIMIT", "Search limit must be between 1 and 100");
  }
  const after = parseDate(input.departureAfter, "departureAfter") ?? db.nowMs() - 300_000;
  const before = parseDate(input.departureBefore, "departureBefore");
  if (before !== null && before <= after) {
    throw new ApiFailure("INVALID_SEARCH_WINDOW", "departureBefore must be after departureAfter");
  }

  const origin = { latitude: input.originLatitude, longitude: input.originLongitude };
  const destination = { latitude: input.destinationLatitude, longitude: input.destinationLongitude };
  const today = utcToday(db);

  interface Candidate {
    result: TripSearchResult;
    departure: number;
    score: number;
  }
  const found: Candidate[] = [];

  for (const trip of db.trips.all()) {
    if (trip.province_id !== input.provinceId || trip.status !== "published" || trip.departure_at === null) continue;
    if (trip.departure_at < after || (before !== null && trip.departure_at > before)) continue;
    const vehicle = db.vehicles.get(trip.vehicle_id);
    if (
      !vehicle ||
      vehicle.vehicle_photo_status !== "approved" ||
      vehicle.insurance_status !== "approved" ||
      vehicle.insurance_expires_on === null ||
      vehicle.insurance_expires_on < today
    ) {
      continue;
    }

    const stops = db.tripStops.filter((s) => s.trip_id === trip.id).sort((a, b) => a.seq - b.seq);
    let best: { pickup: TripStopRow; dropoff: TripStopRow; pickupM: number; dropoffM: number } | null = null;
    for (const pickup of stops) {
      const pickupM = haversineM(origin, { latitude: pickup.lat, longitude: pickup.lng });
      if (pickupM > radiusM) continue;
      for (const dropoff of stops) {
        if (dropoff.seq <= pickup.seq) continue;
        const dropoffM = haversineM(destination, { latitude: dropoff.lat, longitude: dropoff.lng });
        if (dropoffM > radiusM) continue;
        if (!best || pickupM + dropoffM < best.pickupM + best.dropoffM) best = { pickup, dropoff, pickupM, dropoffM };
      }
    }
    if (!best) continue;

    const between = segmentsOf(db, trip.id).filter((s) => s.seq >= best.pickup.seq && s.seq < best.dropoff.seq);
    const roadDistanceM = between.reduce((sum, s) => sum + s.distance_m, 0);
    const estimatedDurationS = between.reduce((sum, s) => sum + s.duration_s, 0);
    if (best.dropoff.seq <= best.pickup.seq || roadDistanceM <= 0) continue;
    const availableSeats = availableSeatsForRange(db, trip.id, best.pickup.seq, best.dropoff.seq);
    if (availableSeats <= 0) continue;

    found.push({
      departure: trip.departure_at,
      score: best.pickupM + best.dropoffM,
      result: {
        tripId: trip.id,
        category: trip.category,
        leg: trip.leg,
        departureAt: iso(trip.departure_at),
        fromSegmentSeq: best.pickup.seq,
        toSegmentSeq: best.dropoff.seq,
        pickupDistanceM: Math.round(best.pickupM),
        dropoffDistanceM: Math.round(best.dropoffM),
        roadDistanceM,
        estimatedDurationS,
        availableSeats,
        driverDisplayName: db.profiles.get(trip.driver_user_id)?.display_name ?? null,
      },
    });
  }

  // El backend real no ordena (DISTINCT ON por id); la vista previa ordena por salida y cercanía para que sea legible.
  found.sort((a, b) => a.departure - b.departure || a.score - b.score);
  return found.slice(0, limit).map((candidate) => candidate.result);
}
