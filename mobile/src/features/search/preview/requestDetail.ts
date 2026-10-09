/**
 * Detalle de una solicitud de plaza (`GET /v1/ride-requests/:id`) y retirada (`POST …/withdraw`).
 * Porta `src/modules/trips/request-detail.ts`: línea de estado (Solicitud → Aceptada → Pago → Confirmada), cuenta atrás
 * del hold calculada con el reloj del servidor y próxima acción. «Aceptada» NO es «confirmada»: la plaza solo es firme
 * cuando existe reserva.
 *
 * SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`).
 */
import type { RequestHold, RequestNextAction, RequestPoint, RequestStepper, RideRequestDetail, RideRequestStatus, TripQuote } from "@/api/types";
import { expireStaleHolds, fail, isoReq, madridDate, moneyIllustrative, publicUser, type PreviewDb, type RideRequestRow, type TripRow } from "@/preview";
import { loadTripGeometry } from "./browseGeometry";
import { metaFor, readPreviewTariff } from "./browseMeta";
import { computeQuote } from "./browseQuote";
import { localTimeOf, vehicleSummary, viewPoint } from "./browseShared";

/** Importe fijado a una solicitud en el momento de crearla (`quote_snapshots`). */
export interface QuoteLockRow {
  /** = id de la solicitud */
  id: string;
  quote: TripQuote;
  locked_at: number;
}

export const quoteLocks = (db: PreviewDb) => db.collection<QuoteLockRow>("request_quote_locks");

type StepState = "done" | "current" | "pending" | "failed";

export function buildStepper(status: RideRequestStatus, hadHold: boolean, hadBooking: boolean): RequestStepper {
  const keys = ["requested", "accepted", "payment", "confirmed"] as const;
  const set = (states: StepState[]): RequestStepper["steps"] => keys.map((key, i) => ({ key, state: states[i] ?? "pending" }));
  switch (status) {
    case "pending":
      return { steps: set(["current", "pending", "pending", "pending"]), current: "requested", terminal: null };
    case "accepted":
    case "payment_pending":
      return { steps: set(["done", "current", "pending", "pending"]), current: "accepted", terminal: null };
    case "confirmed":
      return { steps: set(["done", "done", "done", "done"]), current: "confirmed", terminal: null };
    case "rejected":
      return { steps: set(["done", "failed", "pending", "pending"]), current: "requested", terminal: "rejected" };
    default: {
      const terminal = status as "expired" | "cancelled" | "payment_late";
      if (hadBooking) return { steps: set(["done", "done", "done", "failed"]), current: "confirmed", terminal };
      if (hadHold) return { steps: set(["done", "done", "failed", "pending"]), current: "accepted", terminal };
      return { steps: set(["done", "failed", "pending", "pending"]), current: "requested", terminal };
    }
  }
}

export function buildNextAction(status: RideRequestStatus, holdExpiresAt: number | null): RequestNextAction {
  switch (status) {
    case "pending":
      return { kind: "wait_for_driver", deadlineAt: null };
    case "accepted":
    case "payment_pending":
      return { kind: "pay", deadlineAt: holdExpiresAt === null ? null : isoReq(holdExpiresAt) };
    case "confirmed":
      return { kind: "view_booking", deadlineAt: null };
    default:
      return { kind: "search_again", deadlineAt: null };
  }
}

export function holdView(db: PreviewDb, requestId: string, status: RideRequestStatus): RequestHold | null {
  const hold = db.seatHolds.find((h) => h.request_id === requestId);
  if (!hold || status === "pending" || status === "confirmed") return null;
  const now = db.nowMs();
  const active = hold.status === "active" && hold.expires_at > now;
  return { expiresAt: isoReq(hold.expires_at), remainingSeconds: active ? Math.max(0, Math.floor((hold.expires_at - now) / 1000)) : 0, active };
}

function pointOf(label: string | null, address: string | null, lat: number, lng: number, atMs: number, walk: number | null, detour: number | null): RequestPoint {
  return {
    label,
    address,
    location: viewPoint({ lat, lng }, true),
    atLocal: localTimeOf(atMs),
    at: isoReq(atMs),
    walkMinutes: walk,
    detourMinutes: detour,
  };
}

/** Importe a mostrar: el fijado al crear la solicitud o, si es antiguo, el cálculo en vivo con la tarifa vigente. */
export function quoteOfRequest(db: PreviewDb, row: Readonly<RideRequestRow>): TripQuote {
  const lock = quoteLocks(db).get(row.id);
  if (lock) return { ...lock.quote, lockedAt: isoReq(lock.locked_at) };
  return computeQuote(readPreviewTariff(db), row.road_distance_m ?? 0);
}

export function buildRequestDetail(db: PreviewDb, row: Readonly<RideRequestRow>, trip: Readonly<TripRow>): RideRequestDetail {
  const meta = metaFor(db, trip.id);
  const geo = loadTripGeometry(db, trip, meta);
  const departure = trip.departure_at ?? db.nowMs();
  const fromStop = geo.stops[row.from_segment_seq];
  const dropoffSeq = row.dropoff_stop_seq ?? row.to_segment_seq;
  const toStop = geo.stops[dropoffSeq];
  const pickupAt = departure + (row.pickup_offset_s ?? geo.offsets[row.from_segment_seq] ?? 0) * 1000;
  const dropoffAt = departure + (geo.offsets[dropoffSeq] ?? 0) * 1000;
  const hold = db.seatHolds.find((h) => h.request_id === row.id);
  const booking = db.bookings.find((b) => b.request_id === row.id);
  const status = row.status === "accepted" ? "payment_pending" : row.status;
  const first = geo.stops[0];
  const last = geo.stops[geo.stops.length - 1];

  const weekly = row.weekly_reservation_id
    ? { reservationId: row.weekly_reservation_id, occurrenceDate: madridDate(departure), leg: trip.leg }
    : null;

  return {
    id: row.id,
    status,
    trip: {
      id: trip.id,
      leg: trip.leg,
      category: trip.category,
      departureAt: isoReq(departure),
      originLabel: first?.label ?? null,
      destinationLabel: last?.label ?? null,
      driver: publicUser(db, trip.driver_user_id),
      vehicle: vehicleSummary(db, trip, status === "confirmed", false),
    },
    passenger: publicUser(db, row.passenger_user_id),
    pickup: pointOf(
      row.pickup_label ?? fromStop?.label ?? null,
      row.pickup_address ?? null,
      row.pickup_lat ?? fromStop?.lat ?? 0,
      row.pickup_lng ?? fromStop?.lng ?? 0,
      pickupAt,
      row.pickup_walk_minutes ?? null,
      row.pickup_detour_minutes ?? null
    ),
    dropoff: pointOf(toStop?.label ?? null, null, toStop?.lat ?? 0, toStop?.lng ?? 0, dropoffAt, null, null),
    fromSegmentSeq: row.from_segment_seq,
    toSegmentSeq: row.to_segment_seq,
    roadDistanceM: row.road_distance_m ?? null,
    message: row.message ?? null,
    stepper: buildStepper(status, hold !== undefined, booking !== undefined),
    hold: holdView(db, row.id, status),
    quote: quoteOfRequest(db, row),
    nextAction: buildNextAction(status, hold?.status === "active" ? hold.expires_at : null),
    booking: booking
      ? { id: booking.id, status: booking.status, amount: moneyIllustrative(booking.amount_cents) }
      : null,
    weekly,
    requestedAt: isoReq(row.requested_at),
    updatedAt: isoReq(row.updated_at),
  };
}

/** Solicitud visible solo para su pasajero titular y para el conductor del viaje; para el resto 404 (no se revela). */
export function loadRequestFor(db: PreviewDb, requestId: string, viewerUserId: string): { row: Readonly<RideRequestRow>; trip: Readonly<TripRow> } {
  expireStaleHolds(db);
  const row = db.rideRequests.get(requestId);
  const trip = row ? db.trips.get(row.trip_id) : undefined;
  if (!row || !trip || (row.passenger_user_id !== viewerUserId && trip.driver_user_id !== viewerUserId)) {
    return fail("REQUEST_NOT_FOUND", "La solicitud no existe.", 404);
  }
  return { row, trip };
}

export function getRideRequest(db: PreviewDb, requestId: string, viewerUserId: string): RideRequestDetail {
  const { row, trip } = loadRequestFor(db, requestId, viewerUserId);
  return buildRequestDetail(db, row, trip);
}

/** Retirar una solicitud: solo la persona que la hizo y solo mientras está `pending` (después, se cancela la reserva). */
export function withdrawRideRequest(db: PreviewDb, requestId: string, userId: string): RideRequestDetail {
  const { row, trip } = loadRequestFor(db, requestId, userId);
  if (row.passenger_user_id !== userId) return fail("REQUEST_NOT_FOUND", "La solicitud no existe.", 404);
  if (row.status !== "pending") return fail("REQUEST_NOT_WITHDRAWABLE", "Solo puedes retirar una solicitud que el conductor aún no ha respondido.", 409);
  const updated = db.rideRequests.update(row.id, { status: "cancelled", updated_at: db.nowMs() });
  db.events.emit("ride_request.withdrawn", { request: updated, trip });
  return buildRequestDetail(db, updated, trip);
}
