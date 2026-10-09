/** Seguimiento en vivo (`src/live/tracking-service.ts`): ubicación del conductor, visibilidad y mapa aproximado. */
import type { PreviewDb } from "../core/db";
import { ApiFailure } from "../core/errors";
import { STRICT_UUID_RE } from "../core/ids";
import { newestFirst } from "../core/order";
import type { LiveStateRow, LocationEventRow } from "../core/rows";
import { iso, snapToGrid } from "../core/wire";

export interface LocationEventInput {
  eventId: string;
  tripId: string;
  driverUserId: string;
  recordedAt: string;
  latitude: number;
  longitude: number;
  accuracyM?: number;
  speedMps?: number;
  headingDegrees?: number;
}

export interface LocationWriteResult {
  eventRowId: string;
  duplicate: boolean;
  acceptedAsCurrent: boolean;
}

export interface VisibleTripLocation {
  tripId: string;
  precision: "precise" | "approximate";
  latitude: number;
  longitude: number;
  recordedAt: string;
  receivedAt: string;
  stale: boolean;
  ageSeconds: number;
  accuracyM?: number;
  speedMps?: number;
  headingDegrees?: number;
}

export interface PublicLiveTripLocation {
  tripId: string;
  latitude: number;
  longitude: number;
  recordedAt: string;
  stale: boolean;
  ageSeconds: number;
}

function assertUuid(value: string, label: string): void {
  if (!STRICT_UUID_RE.test(value)) throw new ApiFailure("INVALID_LOCATION_EVENT", `${label} must be a UUID`);
}

function finiteInRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new ApiFailure("INVALID_LOCATION_EVENT", `${label} is outside its valid range`);
  }
}

function optionalFinite(value: number | undefined, min: number, max: number, label: string): void {
  if (value !== undefined) finiteInRange(value, min, max, label);
}

function parseRecordedAt(db: PreviewDb, value: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new ApiFailure("INVALID_LOCATION_EVENT", "recordedAt must be a valid ISO timestamp");
  const now = db.nowMs();
  if (ms > now + 120_000) throw new ApiFailure("LOCATION_EVENT_FROM_FUTURE", "GPS timestamp is too far in the future", 422);
  if (ms < now - 86_400_000) throw new ApiFailure("LOCATION_EVENT_TOO_OLD", "GPS event is older than 24 hours", 422);
  return ms;
}

export function recordDriverLocation(db: PreviewDb, input: LocationEventInput): LocationWriteResult {
  assertUuid(input.eventId, "eventId");
  finiteInRange(input.latitude, -90, 90, "latitude");
  finiteInRange(input.longitude, -180, 180, "longitude");
  optionalFinite(input.accuracyM, 0, 10_000, "accuracyM");
  optionalFinite(input.speedMps, 0, 150, "speedMps");
  optionalFinite(input.headingDegrees, 0, 359.999, "headingDegrees");
  const recordedAt = parseRecordedAt(db, input.recordedAt);

  return db.tx(() => {
    const trip = db.trips.get(input.tripId);
    if (!trip) throw new ApiFailure("TRIP_NOT_FOUND", "Trip not found", 404);
    if (trip.driver_user_id !== input.driverUserId) {
      throw new ApiFailure("LOCATION_FORBIDDEN", "Only the trip driver may publish location", 403);
    }
    if (trip.status !== "active") {
      throw new ApiFailure("TRIP_NOT_LIVE", "Location may only be published for an active trip", 409);
    }

    const now = db.nowMs();
    const existing = db.locationEvents.find((e) => e.trip_id === input.tripId && e.event_id === input.eventId);
    let event: Readonly<LocationEventRow>;
    let duplicate = false;
    if (existing) {
      duplicate = true;
      event = existing;
    } else {
      event = db.locationEvents.insert({
        id: String(db.ids.seq("trip_location_events")),
        event_id: input.eventId,
        trip_id: input.tripId,
        driver_user_id: input.driverUserId,
        recorded_at: recordedAt,
        received_at: now,
        lat: input.latitude,
        lng: input.longitude,
        accuracy_m: input.accuracyM ?? null,
        speed_mps: input.speedMps ?? null,
        heading_degrees: input.headingDegrees ?? null,
      });
      const state = db.liveState.get(input.tripId);
      const next: LiveStateRow = {
        id: input.tripId,
        trip_id: input.tripId,
        event_row_id: event.id,
        driver_user_id: input.driverUserId,
        recorded_at: event.recorded_at,
        received_at: event.received_at,
        lat: event.lat,
        lng: event.lng,
        accuracy_m: event.accuracy_m,
        speed_mps: event.speed_mps,
        heading_degrees: event.heading_degrees,
        updated_at: now,
      };
      if (!state) {
        db.liveState.insert(next);
      } else if (
        event.recorded_at > state.recorded_at ||
        (event.recorded_at === state.recorded_at && event.received_at > state.received_at)
      ) {
        db.liveState.update(input.tripId, next);
      }
      db.events.emit("location.recorded", { trip, event });
    }
    return {
      eventRowId: event.id,
      duplicate,
      acceptedAsCurrent: db.liveState.get(input.tripId)?.event_row_id === event.id,
    };
  });
}

/** Pasajero con reserva confirmada del viaje (`bookings.status = 'confirmed'`, `ride_requests.status = 'confirmed'`). */
function viewerHasConfirmedBooking(db: PreviewDb, tripId: string, viewerUserId: string): boolean {
  return db.bookings.all().some((b) => {
    if (b.status !== "confirmed") return false;
    const request = db.rideRequests.get(b.request_id);
    return Boolean(request && request.trip_id === tripId && request.passenger_user_id === viewerUserId && request.status === "confirmed");
  });
}

function viewerCanSeePrecise(db: PreviewDb, tripId: string, driverUserId: string, viewerUserId: string | null): boolean {
  if (!viewerUserId) return false;
  if (viewerUserId === driverUserId) return true;
  return viewerHasConfirmedBooking(db, tripId, viewerUserId);
}

export function getTripLocationForViewer(
  db: PreviewDb,
  tripId: string,
  viewerUserId: string | null,
  staleAfterSeconds = 60
): VisibleTripLocation | null {
  if (!Number.isInteger(staleAfterSeconds) || staleAfterSeconds < 5 || staleAfterSeconds > 3600) {
    throw new ApiFailure("INVALID_STALE_THRESHOLD", "staleAfterSeconds must be between 5 and 3600");
  }
  const trip = db.trips.get(tripId);
  if (!trip) throw new ApiFailure("TRIP_NOT_FOUND", "Trip not found", 404);
  if (trip.status !== "active") return null;

  const precise = viewerCanSeePrecise(db, tripId, trip.driver_user_id, viewerUserId);
  const row = db.liveState.get(tripId);
  if (!row) return null;

  const ageSeconds = Math.max(0, Math.floor((db.nowMs() - row.recorded_at) / 1000));
  const result: VisibleTripLocation = {
    tripId,
    precision: precise ? "precise" : "approximate",
    latitude: precise ? row.lat : snapToGrid(row.lat),
    longitude: precise ? row.lng : snapToGrid(row.lng),
    recordedAt: iso(row.recorded_at) as string,
    receivedAt: iso(row.received_at) as string,
    stale: ageSeconds > staleAfterSeconds,
    ageSeconds,
  };
  if (precise) {
    if (row.accuracy_m !== null) result.accuracyM = row.accuracy_m;
    if (row.speed_mps !== null) result.speedMps = row.speed_mps;
    if (row.heading_degrees !== null) result.headingDegrees = row.heading_degrees;
  }
  return result;
}

export function listApproximateLiveTrips(db: PreviewDb, provinceId: string, staleAfterSeconds = 60): PublicLiveTripLocation[] {
  if (!Number.isInteger(staleAfterSeconds) || staleAfterSeconds < 5 || staleAfterSeconds > 3600) {
    throw new ApiFailure("INVALID_STALE_THRESHOLD", "staleAfterSeconds must be between 5 and 3600");
  }
  const now = db.nowMs();
  return newestFirst(
    db.liveState.all().filter((state) => {
      const trip = db.trips.get(state.trip_id);
      return trip !== undefined && trip.province_id === provinceId && trip.status === "active";
    }),
    (state) => state.recorded_at
  ).map((state) => {
    const ageSeconds = Math.max(0, Math.floor((now - state.recorded_at) / 1000));
    return {
      tripId: state.trip_id,
      latitude: snapToGrid(state.lat),
      longitude: snapToGrid(state.lng),
      recordedAt: iso(state.recorded_at) as string,
      stale: ageSeconds > staleAfterSeconds,
      ageSeconds,
    };
  });
}
