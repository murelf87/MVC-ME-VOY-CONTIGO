import type { Pool, PoolClient } from "pg";
import { moneyDefined } from "../../lib/dto.js";
import { notify } from "../../lib/notify.js";
import { inParallel, iso, localTimeOf, type Db } from "./common.js";
import { toVehicleSummary } from "./dto.js";
import { err } from "./errors.js";
import { loadPublicUsers, publicUserOrUnknown } from "./public-user.js";
import { quoteForRequest } from "./quote-service.js";
import { loadSegmentLoads, loadStops, loadTrips, stopOffsets, type TripRow } from "./trip-data.js";
import type {
  RequestHold, RequestNextAction, RequestPoint, RequestStepper, RideRequestDetail, RideRequestStatus, TripBookingStatus
} from "./types.js";

/* ───────────────────────────── Caducidad de holds ───────────────────────────── */

/**
 * Caduca los holds vencidos: libera el hold, pasa la solicitud a `expired` y avisa al pasajero (`request_expired`).
 * Primero se bloquean las filas de `ride_requests` (mismo orden que `confirmProviderPayment`) para no provocar
 * interbloqueos con un pago concurrente. Idempotente. Devuelve cuántas solicitudes caducaron.
 */
export async function expireOverdueHolds(client: PoolClient, only?: { requestId?: string }): Promise<number> {
  const due = await client.query<{ id: string; passenger_user_id: string; trip_id: string; weekly_reservation_id: string | null }>(
    `select r.id, r.passenger_user_id, r.trip_id, r.weekly_reservation_id
       from ride_requests r join seat_holds h on h.request_id = r.id
      where h.status = 'active' and h.expires_at <= now() and r.status in ('payment_pending','accepted')
        and ($1::uuid is null or r.id = $1::uuid)
      order by r.id
      limit 200
        for update of r skip locked`,
    [only?.requestId ?? null]
  );
  for (const row of due.rows) {
    await client.query(`update seat_holds set status = 'released', released_at = now() where request_id = $1 and status = 'active'`, [row.id]);
    await client.query(
      `update ride_requests set status = 'expired', expired_at = now(), updated_at = now() where id = $1`,
      [row.id]
    );
    await notify(client, {
      userId: row.passenger_user_id,
      category: "trip",
      kind: "request_expired",
      title: "Tu plaza ha caducado",
      body: "No se completó el pago a tiempo y la plaza se ha liberado. Puedes volver a solicitarla.",
      data: { requestId: row.id, tripId: row.trip_id, ...(row.weekly_reservation_id ? { reservationId: row.weekly_reservation_id } : {}) }
    });
  }
  return due.rows.length;
}

/** Caduca los holds vencidos que afectan a una solicitud/reserva concreta antes de leerla. */
export async function expireIfDue(pool: Pool, requestIds: readonly string[]): Promise<void> {
  if (requestIds.length === 0) return;
  const overdue = await pool.query<{ id: string }>(
    `select r.id from ride_requests r join seat_holds h on h.request_id = r.id
      where r.id = any($1::uuid[]) and h.status = 'active' and h.expires_at <= now() and r.status in ('payment_pending','accepted')`,
    [requestIds]
  );
  if (!overdue.rowCount) return;
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const row of overdue.rows) await expireOverdueHolds(client, { requestId: row.id });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/* ───────────────────────────── Stepper y próxima acción ───────────────────────────── */

type StepState = "done" | "current" | "pending" | "failed";

export function buildStepper(input: {
  status: RideRequestStatus;
  hadHold: boolean;
  hadBooking: boolean;
}): RequestStepper {
  const keys = ["requested", "accepted", "payment", "confirmed"] as const;
  const set = (states: StepState[]): RequestStepper["steps"] => keys.map((key, i) => ({ key, state: states[i]! }));
  const { status } = input;
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
      // expired | cancelled | payment_late: se informa hasta dónde llegó.
      const terminal = status as "expired" | "cancelled" | "payment_late";
      if (input.hadBooking) {
        return { steps: set(["done", "done", "done", "failed"]), current: "confirmed", terminal };
      }
      if (input.hadHold) {
        return { steps: set(["done", "done", "failed", "pending"]), current: "accepted", terminal };
      }
      return { steps: set(["done", "failed", "pending", "pending"]), current: "requested", terminal };
    }
  }
}

export function buildNextAction(status: RideRequestStatus, holdExpiresAt: Date | null): RequestNextAction {
  switch (status) {
    case "pending":
      return { kind: "wait_for_driver", deadlineAt: null };
    case "accepted":
    case "payment_pending":
      return { kind: "pay", deadlineAt: holdExpiresAt ? iso(holdExpiresAt) : null };
    case "confirmed":
      return { kind: "view_booking", deadlineAt: null };
    default:
      return { kind: "search_again", deadlineAt: null };
  }
}

export function buildHold(
  status: RideRequestStatus,
  hold: { status: string; expires_at: Date } | null,
  now: Date
): RequestHold | null {
  if (!hold) return null;
  if (status === "pending" || status === "confirmed") return null;
  const active = hold.status === "active" && hold.expires_at.getTime() > now.getTime();
  return {
    expiresAt: iso(hold.expires_at),
    remainingSeconds: active ? Math.max(0, Math.floor((hold.expires_at.getTime() - now.getTime()) / 1000)) : 0,
    active
  };
}

/* ───────────────────────────── Detalle de solicitud ───────────────────────────── */

type RequestRow = {
  id: string;
  trip_id: string;
  passenger_user_id: string;
  from_segment_seq: number;
  to_segment_seq: number;
  status: RideRequestStatus;
  requested_at: Date;
  updated_at: Date;
  pickup_label: string | null;
  pickup_address: string | null;
  pickup_offset_s: number | null;
  pickup_walk_minutes: number | null;
  pickup_detour_minutes: number | null;
  p_lat: number | null;
  p_lng: number | null;
  dropoff_stop_seq: number | null;
  road_distance_m: number | null;
  message: string | null;
  weekly_reservation_id: string | null;
  hold_status: string | null;
  hold_expires_at: Date | null;
  booking_id: string | null;
  booking_status: TripBookingStatus | null;
  booking_amount_cents: number | null;
  service_date: string | null;
};

const REQUEST_SELECT = `
  select r.id, r.trip_id, r.passenger_user_id, r.from_segment_seq, r.to_segment_seq, r.status,
         r.requested_at, r.updated_at, r.pickup_label, r.pickup_address, r.pickup_offset_s,
         r.pickup_walk_minutes, r.pickup_detour_minutes, ST_Y(r.pickup_geom) as p_lat, ST_X(r.pickup_geom) as p_lng,
         r.dropoff_stop_seq, r.road_distance_m, r.message, r.weekly_reservation_id,
         h.status as hold_status, h.expires_at as hold_expires_at,
         b.id as booking_id, b.status as booking_status, b.amount_cents as booking_amount_cents,
         t.service_date::text as service_date
    from ride_requests r
    join trips t on t.id = r.trip_id
    left join seat_holds h on h.request_id = r.id
    left join bookings b on b.request_id = r.id`;

/**
 * Detalle de una solicitud para su pasajero titular o para el conductor del viaje. Cualquier otro usuario
 * recibe `404 REQUEST_NOT_FOUND` (no se revela su existencia). Caduca el hold vencido antes de leer.
 */
export async function loadRequestDetail(pool: Pool, requestId: string, viewerUserId: string, now = new Date()): Promise<RideRequestDetail> {
  await expireIfDue(pool, [requestId]);
  const found = await pool.query<RequestRow>(`${REQUEST_SELECT} where r.id = $1`, [requestId]);
  const row = found.rows[0];
  const trip = row ? (await loadTrips(pool, [row.trip_id])).get(row.trip_id) : undefined;
  if (!row || !trip || (row.passenger_user_id !== viewerUserId && trip.driver_user_id !== viewerUserId)) {
    throw err("REQUEST_NOT_FOUND", 404, "La solicitud no existe.");
  }
  return buildRequestDetail(pool, row, trip, viewerUserId, now);
}

export async function buildRequestDetail(
  db: Db,
  row: RequestRow,
  trip: TripRow,
  viewerUserId: string,
  now: Date
): Promise<RideRequestDetail> {
  const [stopsMap, loadsMap, people, quote] = await inParallel(db, [
    () => loadStops(db, [trip.id]), () => loadSegmentLoads(db, [trip.id]),
    () => loadPublicUsers(db, [trip.driver_user_id, row.passenger_user_id]), () => quoteForRequest(db, row.id)
  ]);
  const stops = stopsMap.get(trip.id) ?? [];
  const segments = loadsMap.get(trip.id) ?? [];
  const offsets = stopOffsets(stops, segments);
  const departure = trip.departure_at ?? now;
  const status: RideRequestStatus = row.status === "accepted" ? "payment_pending" : row.status;
  const hold = row.hold_status && row.hold_expires_at ? { status: row.hold_status, expires_at: row.hold_expires_at } : null;
  const isDriver = viewerUserId === trip.driver_user_id;
  const fullPlate = isDriver || status === "confirmed";

  const fromStop = stops[row.from_segment_seq];
  const dropSeq = row.dropoff_stop_seq ?? row.to_segment_seq;
  const dropStop = stops[dropSeq];
  let pickup: RequestPoint | null = null;
  if (fromStop || (row.p_lat !== null && row.p_lng !== null)) {
    const at = new Date(departure.getTime() + (row.pickup_offset_s ?? offsets[row.from_segment_seq] ?? 0) * 1000);
    pickup = {
      label: row.pickup_label ?? fromStop?.label ?? null,
      address: row.pickup_address,
      location: {
        lat: row.p_lat !== null ? Number(row.p_lat) : fromStop!.lat,
        lng: row.p_lng !== null ? Number(row.p_lng) : fromStop!.lng,
        precision: "precise"
      },
      at: iso(at),
      atLocal: localTimeOf(at),
      walkMinutes: row.pickup_walk_minutes,
      detourMinutes: row.pickup_detour_minutes
    };
  }
  let dropoff: RequestPoint | null = null;
  if (dropStop) {
    const at = new Date(departure.getTime() + (offsets[dropSeq] ?? 0) * 1000);
    dropoff = {
      label: dropStop.label,
      address: null,
      location: { lat: dropStop.lat, lng: dropStop.lng, precision: "precise" },
      at: iso(at),
      atLocal: localTimeOf(at),
      walkMinutes: null,
      detourMinutes: null
    };
  }
  const holdDto = buildHold(status, hold, now);
  return {
    id: row.id,
    status,
    trip: {
      id: trip.id,
      leg: trip.leg,
      category: trip.category,
      departureAt: iso(departure),
      originLabel: stops[0]?.label ?? null,
      destinationLabel: stops[stops.length - 1]?.label ?? null,
      driver: publicUserOrUnknown(people, trip.driver_user_id),
      vehicle: toVehicleSummary(trip, fullPlate, false)
    },
    passenger: publicUserOrUnknown(people, row.passenger_user_id),
    pickup,
    dropoff,
    fromSegmentSeq: row.from_segment_seq,
    toSegmentSeq: row.to_segment_seq,
    roadDistanceM: row.road_distance_m,
    message: row.message,
    stepper: buildStepper({ status, hadHold: hold !== null, hadBooking: row.booking_id !== null }),
    hold: holdDto,
    quote: quote ?? {
      state: "pending_definition",
      tariff: { state: "none_approved", version: null },
      basis: { roadDistanceM: row.road_distance_m ?? 0, rateMicrosPerKm: null },
      contribution: { cents: null, currency: "EUR", status: "pending_definition" },
      managementFee: { cents: null, currency: "EUR", status: "pending_definition" },
      total: { cents: null, currency: "EUR", status: "pending_definition" },
      weekly: null,
      lockedAt: null
    },
    nextAction: buildNextAction(status, hold && hold.status === "active" ? hold.expires_at : null),
    booking: row.booking_id && row.booking_status
      ? { id: row.booking_id, status: row.booking_status, amount: moneyDefined(row.booking_amount_cents ?? 0) }
      : null,
    weekly: row.weekly_reservation_id && row.service_date
      ? { reservationId: row.weekly_reservation_id, occurrenceDate: row.service_date, leg: trip.leg }
      : null,
    requestedAt: iso(row.requested_at),
    updatedAt: iso(row.updated_at)
  };
}

export { REQUEST_SELECT };
export type { RequestRow };
