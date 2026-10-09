/** Ejecución del viaje (`src/services/trip-execution-service.ts`): iniciar, código de recogida y completar. */
import { requireAnyRole } from "../core/auth";
import type { PreviewDb } from "../core/db";
import { ApiFailure } from "../core/errors";
import { sha256Hex } from "../core/sha256";
import type { Principal } from "../core/types";
import { iso } from "../core/wire";
import { writeAudit } from "./audit";
import { assertVehicleCanDrive } from "./vehicles";

const MAX_PICKUP_ATTEMPTS = 5;

export function hashCode(salt: string, code: string): string {
  return sha256Hex(`${salt}:${code}`);
}

export function startOwnedTrip(db: PreviewDb, principal: Principal, tripId: string, requestId?: string) {
  requireAnyRole(principal, ["driver"]);
  return db.tx(() => {
    const trip = db.trips.get(tripId);
    if (!trip) throw new ApiFailure("TRIP_NOT_FOUND", "Trip not found", 404);
    if (trip.driver_user_id !== principal.userId) throw new ApiFailure("TRIP_NOT_OWNED", "Only the trip driver may start it", 403);
    if (trip.status !== "published") throw new ApiFailure("TRIP_NOT_STARTABLE", "Only a published trip may be started", 409);
    assertVehicleCanDrive(db, trip.vehicle_id);
    const now = db.nowMs();
    const started = db.trips.update(tripId, { status: "active", started_at: now, updated_at: now });
    writeAudit(db, { actorUserId: principal.userId, action: "trip.started", entityType: "trip", entityId: tripId, requestId: requestId ?? null });
    db.events.emit("trip.started", { trip: started });
    return { id: started.id, status: started.status, started_at: iso(started.started_at) };
  });
}

export function generateOwnPickupCode(db: PreviewDb, principal: Principal, bookingId: string, requestId?: string) {
  requireAnyRole(principal, ["passenger"]);
  return db.tx(() => {
    const booking = db.bookings.get(bookingId);
    if (!booking) throw new ApiFailure("BOOKING_NOT_FOUND", "Booking not found", 404);
    const request = db.rideRequests.get(booking.request_id);
    const trip = request ? db.trips.get(request.trip_id) : undefined;
    if (!request || !trip) throw new ApiFailure("BOOKING_NOT_FOUND", "Booking not found", 404);
    if (request.passenger_user_id !== principal.userId) {
      throw new ApiFailure("BOOKING_NOT_OWNED", "Only the booked passenger may generate the pickup code", 403);
    }
    if (booking.status !== "confirmed") {
      throw new ApiFailure("BOOKING_NOT_PICKUP_ELIGIBLE", "Booking is not eligible for pickup verification", 409);
    }
    if (trip.status !== "active") {
      throw new ApiFailure("TRIP_NOT_LIVE", "Pickup code is available only while the trip is active", 409);
    }

    const code = db.ids.digits(6);
    const salt = db.ids.hex(22);
    const now = db.nowMs();
    db.pickupCodes.put({
      id: bookingId,
      booking_id: bookingId,
      salt,
      code_hash: hashCode(salt, code),
      attempts: 0,
      max_attempts: MAX_PICKUP_ATTEMPTS,
      generated_at: now,
      verified_at: null,
    });
    writeAudit(db, { actorUserId: principal.userId, action: "pickup_code.generated", entityType: "booking", entityId: bookingId, requestId: requestId ?? null });
    return { bookingId, code, generatedAt: iso(now) };
  });
}

export function verifyPickupCode(db: PreviewDb, principal: Principal, bookingId: string, code: string, requestId?: string) {
  requireAnyRole(principal, ["driver"]);
  if (!/^\d{6}$/.test(code)) throw new ApiFailure("INVALID_PICKUP_CODE", "Pickup code must contain exactly 6 digits");

  type Outcome =
    | { kind: "verified"; value: { bookingId: string; pickedUpAt: string | null; alreadyVerified: boolean } }
    | { kind: "invalid"; attempts: number; maxAttempts: number };

  const result = db.tx((): Outcome => {
    const booking = db.bookings.get(bookingId);
    if (!booking) throw new ApiFailure("BOOKING_NOT_FOUND", "Booking not found", 404);
    const request = db.rideRequests.get(booking.request_id);
    const trip = request ? db.trips.get(request.trip_id) : undefined;
    if (!request || !trip) throw new ApiFailure("BOOKING_NOT_FOUND", "Booking not found", 404);
    if (trip.driver_user_id !== principal.userId) throw new ApiFailure("TRIP_NOT_OWNED", "Only the trip driver may verify pickup", 403);
    if (trip.status !== "active") throw new ApiFailure("TRIP_NOT_LIVE", "Pickup may only be verified during an active trip", 409);
    if (booking.status !== "confirmed") {
      throw new ApiFailure("BOOKING_NOT_PICKUP_ELIGIBLE", "Booking is not eligible for pickup verification", 409);
    }
    if (booking.picked_up_at !== null) {
      return { kind: "verified", value: { bookingId, pickedUpAt: iso(booking.picked_up_at), alreadyVerified: true } };
    }
    const stored = db.pickupCodes.get(bookingId);
    if (!stored) throw new ApiFailure("PICKUP_CODE_NOT_GENERATED", "Passenger has not generated a pickup code", 409);
    if (stored.verified_at !== null) {
      return { kind: "verified", value: { bookingId, pickedUpAt: iso(stored.verified_at), alreadyVerified: true } };
    }
    if (stored.attempts >= stored.max_attempts) {
      throw new ApiFailure("PICKUP_ATTEMPTS_EXCEEDED", "Maximum pickup code attempts exceeded", 429);
    }
    if (hashCode(stored.salt, code) !== stored.code_hash) {
      const failed = db.pickupCodes.update(bookingId, { attempts: stored.attempts + 1 });
      return { kind: "invalid", attempts: failed.attempts, maxAttempts: failed.max_attempts };
    }
    const now = db.nowMs();
    db.bookings.update(bookingId, { picked_up_at: now, updated_at: now });
    db.pickupCodes.update(bookingId, { verified_at: now });
    writeAudit(db, {
      actorUserId: principal.userId,
      action: "pickup.verified",
      entityType: "booking",
      entityId: bookingId,
      requestId: requestId ?? null,
      metadata: { tripId: trip.id },
    });
    db.events.emit("pickup.verified", { booking: db.bookings.get(bookingId), trip });
    return { kind: "verified", value: { bookingId, pickedUpAt: iso(now), alreadyVerified: false } };
  });

  // El intento fallido se confirma (contador) y DESPUÉS se informa del error, como en el backend.
  if (result.kind === "invalid") {
    throw new ApiFailure("PICKUP_CODE_INVALID", "Pickup code is invalid", 401, {
      attempts: result.attempts,
      maxAttempts: result.maxAttempts,
    });
  }
  return result.value;
}

export function completeOwnedTrip(db: PreviewDb, principal: Principal, tripId: string, requestId?: string) {
  requireAnyRole(principal, ["driver"]);
  return db.tx(() => {
    const trip = db.trips.get(tripId);
    if (!trip) throw new ApiFailure("TRIP_NOT_FOUND", "Trip not found", 404);
    if (trip.driver_user_id !== principal.userId) throw new ApiFailure("TRIP_NOT_OWNED", "Only the trip driver may complete it", 403);
    if (trip.status !== "active") throw new ApiFailure("TRIP_NOT_COMPLETABLE", "Only an active trip may be completed", 409);

    const now = db.nowMs();
    for (const booking of db.bookings.all()) {
      if (booking.status !== "confirmed") continue;
      const request = db.rideRequests.get(booking.request_id);
      if (!request || request.trip_id !== tripId) continue;
      db.bookings.update(booking.id, { status: booking.picked_up_at === null ? "no_show" : "completed", updated_at: now });
    }
    const done = db.trips.update(tripId, { status: "completed", completed_at: now, updated_at: now });
    writeAudit(db, { actorUserId: principal.userId, action: "trip.completed", entityType: "trip", entityId: tripId, requestId: requestId ?? null });
    db.events.emit("trip.completed", { trip: done });
    return { id: done.id, status: done.status, completed_at: iso(done.completed_at) };
  });
}
