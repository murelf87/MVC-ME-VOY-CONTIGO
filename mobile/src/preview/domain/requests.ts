/**
 * Solicitudes de plaza, holds y reservas (`src/services/request-service.ts`, `reservation-service.ts`).
 *
 * Máquina de estados (docs/STATE_MACHINES.md): pending → accepted → payment_pending → confirmed; pending → rejected;
 * payment_pending → expired | payment_late. «Aceptada ≠ confirmada»: una plaza solo está firme con reserva.
 */
import { requireAnyRole } from "../core/auth";
import type { PreviewDb } from "../core/db";
import { isUniqueViolation } from "../core/db";
import { ApiFailure } from "../core/errors";
import { newestFirst } from "../core/order";
import type { BookingRow, RideRequestRow, SeatHoldRow, TripRow } from "../core/rows";
import type { Principal } from "../core/types";
import { iso } from "../core/wire";
import { writeAudit } from "./audit";
import { assertCapacity, releaseExpiredHolds, requestedSegments } from "./seats";
import { rideRequestCreatedWire } from "./wire";

export type DecisionKind = "accept" | "reject";

/** Segundos que dura un hold por defecto en el 0.14 (`decideRideRequest`). El módulo `trips` usa 900. */
export const DEFAULT_HOLD_TTL_SECONDS = 600;

/** Datos adicionales de una solicitud (módulo `trips`); ver las columnas opcionales de `RideRequestRow`. */
export type RideRequestExtras = Pick<
  RideRequestRow,
  | "pickup_lat"
  | "pickup_lng"
  | "pickup_label"
  | "pickup_address"
  | "pickup_source"
  | "pickup_offset_s"
  | "pickup_walk_minutes"
  | "pickup_detour_minutes"
  | "dropoff_stop_seq"
  | "road_distance_m"
  | "message"
  | "weekly_reservation_id"
>;

function validateRange(from: number, to: number): void {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from) {
    throw new ApiFailure("INVALID_SEGMENT_RANGE", "Segment range is invalid");
  }
}

const OPEN_STATUSES: ReadonlySet<string> = new Set(["pending", "accepted", "payment_pending", "confirmed"]);

/** `insertRideRequestInTx`: capacidad por tramo + sin solicitud abierta solapada del mismo pasajero. */
export function insertRideRequest(
  db: PreviewDb,
  input: { tripId: string; passengerUserId: string; fromSegmentSeq: number; toSegmentSeq: number },
  extras: Partial<RideRequestExtras> = {},
  requestId?: string
): Readonly<RideRequestRow> {
  validateRange(input.fromSegmentSeq, input.toSegmentSeq);
  const segments = requestedSegments(db, input.tripId, input.fromSegmentSeq, input.toSegmentSeq);
  assertCapacity(db, input.tripId, segments);

  const overlap = db.rideRequests.find(
    (r) =>
      r.trip_id === input.tripId &&
      r.passenger_user_id === input.passengerUserId &&
      OPEN_STATUSES.has(r.status) &&
      r.from_segment_seq < input.toSegmentSeq &&
      r.to_segment_seq > input.fromSegmentSeq
  );
  if (overlap) throw new ApiFailure("DUPLICATE_OPEN_REQUEST", "An open request already exists for this segment range", 409);

  const now = db.nowMs();
  try {
    const row = db.rideRequests.insert({
      id: db.ids.uuid(),
      trip_id: input.tripId,
      passenger_user_id: input.passengerUserId,
      from_segment_seq: input.fromSegmentSeq,
      to_segment_seq: input.toSegmentSeq,
      status: "pending",
      requested_at: now,
      updated_at: now,
      ...extras,
    });
    writeAudit(db, {
      actorUserId: input.passengerUserId,
      action: "ride_request.created",
      entityType: "ride_request",
      entityId: row.id,
      requestId: requestId ?? null,
      metadata: {
        tripId: input.tripId,
        fromSegmentSeq: input.fromSegmentSeq,
        toSegmentSeq: input.toSegmentSeq,
        pickupSource: extras.pickup_source ?? null,
        weeklyReservationId: extras.weekly_reservation_id ?? null,
      },
    });
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiFailure("DUPLICATE_OPEN_REQUEST", "An open request already exists for this segment range", 409);
    }
    throw error;
  }
}

/** `createRideRequestInTx`: valida el viaje y crea la solicitud; emite `ride_request.created` dentro de la transacción. */
export function createRideRequestForTrip(
  db: PreviewDb,
  principal: Principal,
  input: { tripId: string; fromSegmentSeq: number; toSegmentSeq: number },
  extras: Partial<RideRequestExtras> = {},
  requestId?: string
): { request: Readonly<RideRequestRow>; trip: Readonly<TripRow> } {
  requireAnyRole(principal, ["passenger"]);
  validateRange(input.fromSegmentSeq, input.toSegmentSeq);
  return db.tx(() => {
    const trip = db.trips.get(input.tripId);
    if (!trip) throw new ApiFailure("TRIP_NOT_FOUND", "Trip not found", 404);
    if (trip.status !== "published" && trip.status !== "active") {
      throw new ApiFailure("TRIP_NOT_BOOKABLE", "Trip is not bookable", 409);
    }
    if (trip.driver_user_id === principal.userId) {
      throw new ApiFailure("DRIVER_CANNOT_REQUEST_OWN_TRIP", "Driver cannot request a seat on their own trip", 409);
    }
    const request = insertRideRequest(
      db,
      { tripId: input.tripId, passengerUserId: principal.userId, fromSegmentSeq: input.fromSegmentSeq, toSegmentSeq: input.toSegmentSeq },
      extras,
      requestId
    );
    db.events.emit("ride_request.created", { request, trip });
    return { request, trip };
  });
}

/** `POST /v1/trips/:tripId/requests` (forma heredada 0.14). */
export function createRideRequest(
  db: PreviewDb,
  principal: Principal,
  input: { tripId: string; fromSegmentSeq: number; toSegmentSeq: number },
  requestId?: string
) {
  const { request } = createRideRequestForTrip(db, principal, input, {}, requestId);
  return rideRequestCreatedWire(request);
}

export function listOwnRideRequests(db: PreviewDb, principal: Principal) {
  requireAnyRole(principal, ["passenger"]);
  expireStaleHolds(db);
  return newestFirst(
    db.rideRequests.filter((r) => r.passenger_user_id === principal.userId),
    (r) => r.requested_at
  ).map((r) => {
    const hold = db.seatHolds.find((h) => h.request_id === r.id && h.status === "active");
    return {
      id: r.id,
      trip_id: r.trip_id,
      from_segment_seq: r.from_segment_seq,
      to_segment_seq: r.to_segment_seq,
      status: r.status,
      requested_at: iso(r.requested_at),
      updated_at: iso(r.updated_at),
      hold_expires_at: hold ? iso(hold.expires_at) : null,
    };
  });
}

export function listTripRideRequests(db: PreviewDb, principal: Principal, tripId: string) {
  requireAnyRole(principal, ["driver"]);
  expireStaleHolds(db);
  const trip = db.trips.get(tripId);
  if (!trip) throw new ApiFailure("TRIP_NOT_FOUND", "Trip not found", 404);
  if (trip.driver_user_id !== principal.userId) {
    throw new ApiFailure("TRIP_NOT_OWNED", "Only the trip driver can view its requests", 403);
  }
  return db.rideRequests
    .filter((r) => r.trip_id === tripId)
    .sort((a, b) => a.requested_at - b.requested_at)
    .map((r) => ({
      id: r.id,
      passenger_user_id: r.passenger_user_id,
      from_segment_seq: r.from_segment_seq,
      to_segment_seq: r.to_segment_seq,
      status: r.status,
      requested_at: iso(r.requested_at),
      updated_at: iso(r.updated_at),
    }));
}

export interface DecisionOutcome {
  request: {
    id: string;
    trip_id: string;
    passenger_user_id: string;
    from_segment_seq: number;
    to_segment_seq: number;
    status: string;
    updated_at: string | null;
  };
  hold: { id: string; expiresAt: string | null } | null;
}

function decisionRequestWire(r: Readonly<RideRequestRow>): DecisionOutcome["request"] {
  return {
    id: r.id,
    trip_id: r.trip_id,
    passenger_user_id: r.passenger_user_id,
    from_segment_seq: r.from_segment_seq,
    to_segment_seq: r.to_segment_seq,
    status: r.status,
    updated_at: iso(r.updated_at),
  };
}

export function rejectRequest(db: PreviewDb, requestId: string, driverUserId: string, auditRequestId?: string): DecisionOutcome {
  const rejected = db.rideRequests.update(requestId, { status: "rejected", updated_at: db.nowMs() });
  writeAudit(db, {
    actorUserId: driverUserId,
    action: "ride_request.rejected",
    entityType: "ride_request",
    entityId: requestId,
    requestId: auditRequestId ?? null,
  });
  return { request: decisionRequestWire(rejected), hold: null };
}

/** Acepta una solicitud `pending`: capacidad por tramo → hold activo → `payment_pending` (aceptada ≠ confirmada). */
export function acceptRequest(
  db: PreviewDb,
  request: Readonly<RideRequestRow>,
  driverUserId: string,
  holdTtlSeconds: number,
  auditRequestId?: string
): DecisionOutcome {
  const segments = requestedSegments(db, request.trip_id, request.from_segment_seq, request.to_segment_seq);
  assertCapacity(db, request.trip_id, segments);
  const now = db.nowMs();
  const expiresAt = now + holdTtlSeconds * 1000;
  const previous = db.seatHolds.find((h) => h.request_id === request.id);
  let hold: Readonly<SeatHoldRow>;
  if (previous) {
    hold = db.seatHolds.update(previous.id, { status: "active", expires_at: expiresAt, released_at: null, consumed_at: null });
  } else {
    hold = db.seatHolds.insert({
      id: db.ids.uuid(),
      request_id: request.id,
      status: "active",
      expires_at: expiresAt,
      released_at: null,
      consumed_at: null,
      created_at: now,
    });
  }
  const accepted = db.rideRequests.update(request.id, { status: "payment_pending", updated_at: now });
  writeAudit(db, {
    actorUserId: driverUserId,
    action: "ride_request.accepted_with_hold",
    entityType: "ride_request",
    entityId: request.id,
    requestId: auditRequestId ?? null,
    metadata: { holdId: hold.id },
  });
  return { request: decisionRequestWire(accepted), hold: { id: hold.id, expiresAt: iso(hold.expires_at) } };
}

/** `POST /v1/ride-requests/:requestId/decision` (forma heredada 0.14). */
export function decideRideRequest(
  db: PreviewDb,
  principal: Principal,
  requestId: string,
  decision: DecisionKind,
  holdTtlSeconds = DEFAULT_HOLD_TTL_SECONDS,
  auditRequestId?: string
): DecisionOutcome {
  requireAnyRole(principal, ["driver"]);
  if (!Number.isInteger(holdTtlSeconds) || holdTtlSeconds < 30 || holdTtlSeconds > 3600) {
    throw new ApiFailure("INVALID_HOLD_TTL", "Seat hold TTL must be between 30 and 3600 seconds");
  }
  expireStaleHolds(db);
  return db.tx(() => {
    const request = db.rideRequests.get(requestId);
    if (!request) throw new ApiFailure("REQUEST_NOT_FOUND", "Ride request not found", 404);
    if (request.status !== "pending") {
      throw new ApiFailure("REQUEST_NOT_PENDING", "Only pending requests can be decided", 409);
    }
    const trip = db.trips.get(request.trip_id);
    if (!trip) throw new ApiFailure("TRIP_NOT_FOUND", "Trip not found", 404);
    if (trip.driver_user_id !== principal.userId) {
      throw new ApiFailure("TRIP_NOT_OWNED", "Only the trip driver can decide this request", 403);
    }
    let outcome: DecisionOutcome;
    if (decision === "reject") {
      outcome = rejectRequest(db, requestId, principal.userId, auditRequestId);
    } else {
      if (trip.status !== "published" && trip.status !== "active") {
        throw new ApiFailure("TRIP_NOT_BOOKABLE", "Trip is not bookable", 409);
      }
      outcome = acceptRequest(db, request, principal.userId, holdTtlSeconds, auditRequestId);
    }
    db.events.emit("ride_request.decided", {
      request: db.rideRequests.get(requestId),
      decision,
      hold: outcome.hold,
      trip,
    });
    return outcome;
  });
}

/**
 * Caducidad de holds (regla dependiente del tiempo): un hold activo cuya hora ya pasó se libera y la solicitud
 * `payment_pending` pasa a `expired`. Equivale al barrido periódico que el contrato `trips` describe (§7.3).
 */
export function expireStaleHolds(db: PreviewDb): number {
  const now = db.nowMs();
  let expired = 0;
  for (const hold of db.seatHolds.filter((h) => h.status === "active" && h.expires_at <= now)) {
    db.tx(() => {
      db.seatHolds.update(hold.id, { status: "released", released_at: now });
      const request = db.rideRequests.get(hold.request_id);
      if (request && request.status === "payment_pending") {
        const updated = db.rideRequests.update(request.id, { status: "expired", updated_at: now });
        db.events.emit("ride_request.expired", { request: updated });
      }
    });
    expired += 1;
  }
  return expired;
}

// ---------------------------------------------------------------------------------------------------------------
// Reserva (reservation-service.ts). Los llama el módulo `money` tras confirmar el pago con el proveedor.
// ---------------------------------------------------------------------------------------------------------------

export interface PaymentCompensationRow {
  id: string;
  request_id: string;
  provider_payment_id: string;
  amount_cents: number;
  reason: "hold_expired";
  action: "refund_required";
  status: "pending" | "done";
  created_at: number;
}

export type PaymentConfirmation =
  | { status: "confirmed"; bookingId: string }
  | { status: "compensation_required"; compensationId: string };

export function paymentCompensations(db: PreviewDb) {
  return db.collection<PaymentCompensationRow>("payment_compensations").unique("provider_payment_id", (r) => r.provider_payment_id);
}

/** `createSeatHold`: crea (o reactiva) el hold de una solicitud `accepted` y la pasa a `payment_pending`. */
export function createSeatHold(db: PreviewDb, requestId: string, ttlSeconds = DEFAULT_HOLD_TTL_SECONDS): string {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 3600) {
    throw new ApiFailure("INVALID_HOLD_TTL", "Seat hold TTL must be between 30 and 3600 seconds");
  }
  return db.tx(() => {
    const request = db.rideRequests.get(requestId);
    if (!request) throw new ApiFailure("REQUEST_NOT_FOUND", "Ride request not found", 404);
    if (request.status !== "accepted") {
      throw new ApiFailure("REQUEST_NOT_ACCEPTED", "Driver must accept the request before payment hold");
    }
    const trip = db.trips.get(request.trip_id);
    if (!trip || (trip.status !== "published" && trip.status !== "active")) {
      throw new ApiFailure("TRIP_NOT_BOOKABLE", "Trip is not bookable");
    }
    releaseExpiredHolds(db, trip.id);
    const segments = requestedSegments(db, trip.id, request.from_segment_seq, request.to_segment_seq);
    assertCapacity(db, trip.id, segments);
    const now = db.nowMs();
    const previous = db.seatHolds.find((h) => h.request_id === requestId);
    const expiresAt = now + ttlSeconds * 1000;
    const hold = previous
      ? db.seatHolds.update(previous.id, { status: "active", expires_at: expiresAt, released_at: null })
      : db.seatHolds.insert({
          id: db.ids.uuid(),
          request_id: requestId,
          status: "active",
          expires_at: expiresAt,
          released_at: null,
          consumed_at: null,
          created_at: now,
        });
    db.rideRequests.update(requestId, { status: "payment_pending", updated_at: now });
    return hold.id;
  });
}

/** `confirmProviderPayment`: crea la reserva si el hold sigue activo; si no, `payment_late` + compensación. Idempotente. */
export function confirmProviderPayment(
  db: PreviewDb,
  input: { requestId: string; providerPaymentId: string; amountCents: number }
): PaymentConfirmation {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 0) {
    throw new ApiFailure("INVALID_PAYMENT_AMOUNT", "Payment amount must be exact integer cents");
  }
  return db.tx(() => {
    const existing = db.bookings.find((b) => b.request_id === input.requestId || b.provider_payment_id === input.providerPaymentId);
    if (existing) return { status: "confirmed", bookingId: existing.id };
    const compensations = paymentCompensations(db);
    const existingComp = compensations.find((c) => c.provider_payment_id === input.providerPaymentId);
    if (existingComp) return { status: "compensation_required", compensationId: existingComp.id };

    const request = db.rideRequests.get(input.requestId);
    if (!request) throw new ApiFailure("REQUEST_NOT_FOUND", "Ride request not found", 404);
    const hold = db.seatHolds.find((h) => h.request_id === input.requestId);
    const now = db.nowMs();

    if (!hold || hold.status !== "active" || hold.expires_at <= now) {
      if (hold?.status === "active") db.seatHolds.update(hold.id, { status: "released", released_at: now });
      const comp = compensations.insert({
        id: db.ids.uuid(),
        request_id: input.requestId,
        provider_payment_id: input.providerPaymentId,
        amount_cents: input.amountCents,
        reason: "hold_expired",
        action: "refund_required",
        status: "pending",
        created_at: now,
      });
      db.rideRequests.update(input.requestId, { status: "payment_late", updated_at: now });
      return { status: "compensation_required", compensationId: comp.id };
    }

    const booking: Readonly<BookingRow> = db.bookings.insert({
      id: db.ids.uuid(),
      request_id: input.requestId,
      provider_payment_id: input.providerPaymentId,
      amount_cents: input.amountCents,
      status: "confirmed",
      picked_up_at: null,
      created_at: now,
      updated_at: now,
    });
    db.seatHolds.update(hold.id, { status: "consumed", consumed_at: now });
    const confirmed = db.rideRequests.update(input.requestId, { status: "confirmed", updated_at: now });
    db.events.emit("booking.confirmed", { booking, request: confirmed });
    return { status: "confirmed", bookingId: booking.id };
  });
}
