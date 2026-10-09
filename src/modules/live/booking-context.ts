import { DomainError } from "../../errors.js";
import type { Db } from "./common.js";
import type { LiveBookingStatus, LiveTripStatus, LiveVehicle } from "./types.js";

/**
 * Contexto de UNA reserva (reserva + solicitud + viaje + vehículo). Se carga siempre con comprobación de titularidad:
 * cualquiera que no sea el pasajero titular recibe 404 BOOKING_NOT_FOUND (no se revela si la reserva existe).
 */
export type BookingContext = {
  bookingId: string;
  requestId: string;
  tripId: string;
  passengerUserId: string;
  driverUserId: string;
  vehicleId: string;
  bookingStatus: LiveBookingStatus;
  requestStatus: string;
  tripStatus: LiveTripStatus;
  /** Parada de recogida y de bajada (seq de `trip_stops`, numeración vigente). */
  fromSeq: number;
  toSeq: number;
  pickedUpAt: Date | null;
  bookingCreatedAt: Date;
  amountCents: number;
  providerPaymentId: string;
  tripDepartureAt: Date | null;
  tripStartedAt: Date | null;
  tripCompletedAt: Date | null;
  vehicle: LiveVehicle;
};

type ContextRow = {
  booking_id: string;
  request_id: string;
  trip_id: string;
  passenger_user_id: string;
  driver_user_id: string;
  vehicle_id: string;
  booking_status: LiveBookingStatus;
  request_status: string;
  trip_status: string;
  from_seq: number;
  to_seq: number;
  picked_up_at: Date | null;
  booking_created_at: Date;
  amount_cents: number;
  provider_payment_id: string;
  departure_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  make: string;
  model: string;
  color: string | null;
  plate: string;
};

const CONTEXT_SQL = `
  select b.id as booking_id, r.id as request_id, r.trip_id, r.passenger_user_id, t.driver_user_id, t.vehicle_id,
         b.status as booking_status, r.status as request_status, t.status as trip_status,
         r.from_segment_seq as from_seq, r.to_segment_seq as to_seq, b.picked_up_at, b.created_at as booking_created_at,
         b.amount_cents, b.provider_payment_id, t.departure_at, t.started_at, t.completed_at,
         v.make, v.model, v.color, v.plate
    from bookings b
    join ride_requests r on r.id=b.request_id
    join trips t on t.id=r.trip_id
    join vehicles v on v.id=t.vehicle_id
   where b.id=$1`;

function mapRow(row: ContextRow): BookingContext {
  // `draft` no puede tener reservas; se trata como publicado por seguridad de tipos.
  const tripStatus: LiveTripStatus = row.trip_status === "draft" ? "published" : (row.trip_status as LiveTripStatus);
  return {
    bookingId: row.booking_id,
    requestId: row.request_id,
    tripId: row.trip_id,
    passengerUserId: row.passenger_user_id,
    driverUserId: row.driver_user_id,
    vehicleId: row.vehicle_id,
    bookingStatus: row.booking_status,
    requestStatus: row.request_status,
    tripStatus,
    fromSeq: row.from_seq,
    toSeq: row.to_seq,
    pickedUpAt: row.picked_up_at,
    bookingCreatedAt: row.booking_created_at,
    amountCents: row.amount_cents,
    providerPaymentId: row.provider_payment_id,
    tripDepartureAt: row.departure_at,
    tripStartedAt: row.started_at,
    tripCompletedAt: row.completed_at,
    vehicle: { make: row.make, model: row.model, color: row.color, plate: row.plate }
  };
}

export function bookingNotFound(): DomainError {
  return new DomainError("BOOKING_NOT_FOUND", "Booking not found", 404);
}

/** Reserva del pasajero titular; para cualquier otra persona, 404 BOOKING_NOT_FOUND. */
export async function loadPassengerBooking(db: Db, bookingId: string, userId: string): Promise<BookingContext> {
  const context = await loadBookingById(db, bookingId);
  if (!context || context.passengerUserId !== userId) throw bookingNotFound();
  return context;
}

/** Sin comprobación de titularidad: solo para el enlace compartido (el token ya autoriza) y otras rutas internas. */
export async function loadBookingById(db: Db, bookingId: string): Promise<BookingContext | null> {
  const result = await db.query<ContextRow>(CONTEXT_SQL, [bookingId]);
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}
