/**
 * Backend en memoria de la vista previa · slice `driver` · bandeja de solicitudes (pantalla 20) y decisiones.
 *
 *   GET  /v1/me/driver/requests                  bandeja (solicitudes sueltas y reservas semanales, una fila por reserva)
 *   POST /v1/ride-requests/:requestId/decision   aceptar / rechazar UNA solicitud (sustituye a la forma heredada 0.14)
 *   POST /v1/weekly-reservations/:id/decision    aceptar / rechazar una reserva semanal ENTERA (todo o nada)
 *
 * Port de `driverRequests` (`src/modules/trips/driver-service.ts`) y de las reglas de `docs/contracts/trips.md` §7.5, §8.4 y
 * §9.1. Aceptar crea un hold de 15 minutos (`payment_pending`): NUNCA una reserva confirmada.
 *
 * La reserva semanal no tiene tabla propia aquí (la crea el paquete `search-request`): se deduce de las solicitudes que
 * llevan `weekly_reservation_id` (días, sentidos, inicio y número de viajes salen de sus ocurrencias).
 *
 * SIMULACIÓN: solo se carga con `EXPO_PUBLIC_PREVIEW=1`.
 */
import type { Page, Weekday } from "@/api/types";
import type {
  DecideRequestResponse,
  DriverRequestItem,
  DriverRequestOccupancy,
  RideRequestStatus,
  TripLeg,
} from "@/api/types/trips";
import {
  ApiFailure,
  acceptRequest,
  availableSeatsForRange,
  decideRideRequest,
  expireStaleHolds,
  iso,
  isoWeekdayOf,
  madridDate,
  madridHHmm,
  occupiedOnSegment,
  publicUser,
  rejectRequest,
  segmentsOf,
  uuidParam,
  type PreviewDb,
  type PreviewRouter,
  type Principal,
  type RideRequestRow,
  type TripRow,
} from "@/preview";
import { isVehicleBookable, requireDriver } from "./publishReadiness";

/** El módulo `trips` retiene la plaza 15 minutos (`TRIPS_SEAT_HOLD_TTL_SECONDS`, 900). */
export const INBOX_HOLD_TTL_SECONDS = 900;

const WEEKDAY_ORDER: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

type InboxStatusFilter = "pending" | "open" | "all";

const STATUS_FILTER: Record<InboxStatusFilter, readonly RideRequestRow["status"][]> = {
  pending: ["pending"],
  open: ["pending", "accepted", "payment_pending"],
  all: ["pending", "accepted", "payment_pending", "confirmed", "rejected", "expired", "cancelled", "payment_late"],
};

/** Fila de la bandeja con la caducidad de la plaza retenida (campo extra de la vista previa; el contrato aún no lo declara). */
export type InboxRow = DriverRequestItem & { hold?: { expiresAt: string } | null };

// ── Piezas ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

function stopLabel(db: PreviewDb, tripId: string, seq: number): string | null {
  return db.tripStops.get(`${tripId}:${seq}`)?.label ?? null;
}

/** Segundos desde la salida hasta cada parada (`stopOffsets`). */
function stopOffsets(db: PreviewDb, tripId: string): number[] {
  const segments = segmentsOf(db, tripId);
  const offsets: number[] = [];
  let acc = 0;
  for (let index = 0; index <= segments.length; index += 1) {
    offsets.push(acc);
    acc += segments.find((segment) => segment.seq === index)?.duration_s ?? 0;
  }
  return offsets;
}

function occupancyFor(db: PreviewDb, tripId: string, from: number, to: number, ownSeatCounts: boolean): DriverRequestOccupancy {
  const perSegment = segmentsOf(db, tripId).map((segment) => {
    const inRange = segment.seq >= from && segment.seq < to;
    const occupied = Math.max(0, occupiedOnSegment(db, tripId, segment.seq) - (inRange && ownSeatCounts ? 1 : 0));
    return {
      seq: segment.seq,
      fromLabel: stopLabel(db, tripId, segment.from_stop_seq),
      toLabel: stopLabel(db, tripId, segment.to_stop_seq),
      occupied,
      capacity: segment.capacity,
      inRequestedRange: inRange,
    };
  });
  const inRange = perSegment.filter((segment) => segment.inRequestedRange);
  const worst = inRange.reduce<(typeof inRange)[number] | null>((acc, segment) => (acc === null || segment.occupied > acc.occupied ? segment : acc), null);
  return {
    occupiedSeats: worst?.occupied ?? 0,
    totalSeats: inRange.reduce((max, segment) => Math.max(max, segment.capacity), 0),
    perSegment,
  };
}

/** `blockedReasonFor`: viaje cerrado o ya salido hace más de 5 minutos, vehículo no reservable, o sin plaza en el tramo. */
function blockedReasonFor(db: PreviewDb, trip: Readonly<TripRow>, free: number): string | null {
  const open = trip.status === "published" || trip.status === "active";
  const departed = trip.status !== "active" && trip.departure_at !== null && trip.departure_at < db.nowMs() - 5 * 60_000;
  if (!open || !isVehicleBookable(db, trip.vehicle_id) || departed) return "TRIP_NOT_BOOKABLE";
  if (free <= 0) return "NO_CAPACITY_ON_SEGMENT";
  return null;
}

function aggregateStatus(statuses: readonly RideRequestRow["status"][]): RideRequestStatus {
  if (statuses.includes("pending")) return "pending";
  if (statuses.some((status) => status === "payment_pending" || status === "accepted")) return "payment_pending";
  if (statuses.includes("confirmed")) return "confirmed";
  if (statuses.length > 0 && statuses.every((status) => status === "rejected")) return "rejected";
  if (statuses.some((status) => status === "expired" || status === "payment_late")) return "expired";
  return "cancelled";
}

function sortWeekdays(days: readonly Weekday[]): Weekday[] {
  return WEEKDAY_ORDER.filter((day) => days.includes(day));
}

function weekdayOfTrip(trip: Readonly<TripRow>): Weekday | null {
  if (trip.departure_at === null) return null;
  return WEEKDAY_ORDER[isoWeekdayOf(madridDate(trip.departure_at)) - 1] ?? null;
}

/** Caducidad de la plaza retenida de una solicitud (la más próxima si hay varias). */
function holdExpiry(db: PreviewDb, requestIds: readonly string[]): string | null {
  let soonest: number | null = null;
  for (const hold of db.seatHolds.all()) {
    if (hold.status !== "active" || !requestIds.includes(hold.request_id)) continue;
    if (soonest === null || hold.expires_at < soonest) soonest = hold.expires_at;
  }
  return soonest === null ? null : iso(soonest);
}

// ── Bandeja ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Entry {
  sortDeparture: number;
  sortRequested: number;
  id: string;
  build: () => InboxRow;
}

function singleEntry(db: PreviewDb, row: Readonly<RideRequestRow>, trip: Readonly<TripRow>): Entry {
  const departure = trip.departure_at ?? db.nowMs();
  return {
    sortDeparture: departure,
    sortRequested: row.requested_at,
    id: row.id,
    build: () => {
      const offsets = stopOffsets(db, trip.id);
      const toSeq = row.dropoff_stop_seq ?? row.to_segment_seq;
      const fromAt = departure + (row.pickup_offset_s ?? offsets[row.from_segment_seq] ?? 0) * 1000;
      const toAt = departure + (offsets[toSeq] ?? 0) * 1000;
      const holdsSeat = row.status === "payment_pending" || row.status === "accepted" || row.status === "confirmed";
      const free = availableSeatsForRange(db, trip.id, row.from_segment_seq, row.to_segment_seq) + (holdsSeat ? 1 : 0);
      const blockedReason = row.status === "pending" ? blockedReasonFor(db, trip, free) : null;
      const status: RideRequestStatus = row.status === "accepted" ? "payment_pending" : row.status;
      const expiry = status === "payment_pending" ? holdExpiry(db, [row.id]) : null;
      return {
        id: row.id,
        kind: "single",
        status,
        passenger: publicUser(db, row.passenger_user_id),
        tripId: trip.id,
        leg: trip.leg,
        category: trip.category,
        departureAt: iso(departure) as string,
        from: {
          label: row.pickup_label ?? stopLabel(db, trip.id, row.from_segment_seq),
          at: iso(fromAt) as string,
          atLocal: madridHHmm(fromAt),
        },
        to: { label: stopLabel(db, trip.id, toSeq), at: iso(toAt) as string, atLocal: madridHHmm(toAt) },
        detourMinutes: row.pickup_detour_minutes ?? null,
        occupancy: occupancyFor(db, trip.id, row.from_segment_seq, row.to_segment_seq, holdsSeat),
        message: row.message ?? null,
        weekly: null,
        canAccept: row.status === "pending" && blockedReason === null,
        blockedReason,
        requestedAt: iso(row.requested_at) as string,
        ...(expiry !== null ? { hold: { expiresAt: expiry } } : {}),
      };
    },
  };
}

function weeklyEntry(
  db: PreviewDb,
  reservationId: string,
  all: readonly Readonly<RideRequestRow>[],
  matching: readonly Readonly<RideRequestRow>[],
): Entry | null {
  const tripOf = (row: Readonly<RideRequestRow>): Readonly<TripRow> | undefined => db.trips.get(row.trip_id);
  const ordered = [...matching].sort((a, b) => (tripOf(a)?.departure_at ?? 0) - (tripOf(b)?.departure_at ?? 0) || (a.id < b.id ? -1 : 1));
  const first = ordered[0];
  if (first === undefined) return null;
  const firstTrip = tripOf(first);
  if (firstTrip === undefined) return null;
  const departure = firstTrip.departure_at ?? db.nowMs();
  const createdAt = Math.min(...all.map((row) => row.requested_at));
  const status = aggregateStatus(all.map((row) => row.status));
  return {
    sortDeparture: departure,
    sortRequested: createdAt,
    id: reservationId,
    build: () => {
      const offsets = stopOffsets(db, firstTrip.id);
      const toSeq = first.dropoff_stop_seq ?? first.to_segment_seq;
      const fromAt = departure + (first.pickup_offset_s ?? offsets[first.from_segment_seq] ?? 0) * 1000;
      const toAt = departure + (offsets[toSeq] ?? 0) * 1000;
      let blockedReason: string | null = null;
      if (status === "pending") {
        for (const pending of all.filter((row) => row.status === "pending")) {
          const pendingTrip = tripOf(pending);
          if (pendingTrip === undefined) {
            blockedReason = "TRIP_NOT_BOOKABLE";
            break;
          }
          blockedReason = blockedReasonFor(db, pendingTrip, availableSeatsForRange(db, pendingTrip.id, pending.from_segment_seq, pending.to_segment_seq));
          if (blockedReason !== null) break;
        }
      }
      const days = sortWeekdays(
        all.map((row) => (tripOf(row) ? weekdayOfTrip(tripOf(row) as Readonly<TripRow>) : null)).filter((day): day is Weekday => day !== null),
      );
      const legs = (["outbound", "return"] as const).filter((leg) => all.some((row) => tripOf(row)?.leg === leg));
      const startMs = Math.min(...all.map((row) => tripOf(row)?.departure_at ?? Number.POSITIVE_INFINITY));
      const expiry = status === "payment_pending" ? holdExpiry(db, all.map((row) => row.id)) : null;
      return {
        id: reservationId,
        kind: "weekly",
        status,
        passenger: publicUser(db, first.passenger_user_id),
        tripId: firstTrip.id,
        leg: firstTrip.leg,
        category: firstTrip.category,
        departureAt: iso(departure) as string,
        from: {
          label: first.pickup_label ?? stopLabel(db, firstTrip.id, first.from_segment_seq),
          at: iso(fromAt) as string,
          atLocal: madridHHmm(fromAt),
        },
        to: { label: stopLabel(db, firstTrip.id, toSeq), at: iso(toAt) as string, atLocal: madridHHmm(toAt) },
        detourMinutes: first.pickup_detour_minutes ?? null,
        occupancy: occupancyFor(db, firstTrip.id, first.from_segment_seq, first.to_segment_seq, false),
        message: first.message ?? null,
        weekly: {
          weekdays: days,
          legs: legs as TripLeg[],
          occurrences: all.length,
          startDate: Number.isFinite(startMs) ? madridDate(startMs) : madridDate(departure),
        },
        canAccept: status === "pending" && blockedReason === null,
        blockedReason,
        requestedAt: iso(createdAt) as string,
        ...(expiry !== null ? { hold: { expiresAt: expiry } } : {}),
      };
    },
  };
}

export interface InboxQuery {
  status: InboxStatusFilter;
  tripId: string | null;
  offset: number;
  limit: number;
}

function decodeOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const match = /^o:(\d{1,6})$/.exec(cursor);
  if (match === null) throw new ApiFailure("INVALID_CURSOR", "El cursor no es válido.", 400);
  return Number(match[1]);
}

/** Bandeja del conductor (`driverRequests`): solo solicitudes de SUS viajes; las reservas semanales aparecen una vez. */
export function driverInbox(db: PreviewDb, principal: Principal, query: InboxQuery): Page<InboxRow> {
  requireDriver(principal, "Necesitas el rol de conductor para ver solicitudes.");
  if (query.status !== "pending") expireStaleHolds(db);
  const statuses = STATUS_FILTER[query.status];
  const ownTripIds = new Set(db.trips.filter((trip) => trip.driver_user_id === principal.userId).map((trip) => trip.id));

  const entries: Entry[] = [];
  const weeklyIds = new Set<string>();
  for (const row of db.rideRequests.all()) {
    if (!ownTripIds.has(row.trip_id)) continue;
    if (row.weekly_reservation_id !== null && row.weekly_reservation_id !== undefined) {
      weeklyIds.add(row.weekly_reservation_id);
      continue;
    }
    if (!statuses.includes(row.status)) continue;
    if (query.tripId !== null && row.trip_id !== query.tripId) continue;
    const trip = db.trips.get(row.trip_id);
    if (trip !== undefined) entries.push(singleEntry(db, row, trip));
  }
  for (const id of weeklyIds) {
    const all = db.rideRequests.filter((row) => row.weekly_reservation_id === id && ownTripIds.has(row.trip_id));
    const matching = all.filter((row) => statuses.includes(row.status));
    if (matching.length === 0) continue;
    if (query.tripId !== null && !all.some((row) => row.trip_id === query.tripId)) continue;
    const entry = weeklyEntry(db, id, all, matching);
    if (entry !== null) entries.push(entry);
  }

  entries.sort(
    query.status === "all"
      ? (a, b) => b.sortRequested - a.sortRequested || (a.id < b.id ? -1 : 1)
      : (a, b) => a.sortDeparture - b.sortDeparture || b.sortRequested - a.sortRequested || (a.id < b.id ? -1 : 1),
  );
  const slice = entries.slice(query.offset, query.offset + query.limit);
  const next = query.offset + query.limit;
  return { items: slice.map((entry) => entry.build()), nextCursor: entries.length > next ? `o:${next}` : null };
}

// ── Decisiones ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** `POST /v1/ride-requests/:requestId/decision`: el viaje es del conductor ANTES que cualquier otra comprobación (§7.5). */
export function decideSingle(
  db: PreviewDb,
  principal: Principal,
  requestId: string,
  decision: "accept" | "reject",
  auditRequestId: string,
): DecideRequestResponse {
  requireDriver(principal, "Necesitas el rol de conductor para decidir solicitudes.");
  const request = db.rideRequests.get(requestId);
  if (request === undefined) throw new ApiFailure("REQUEST_NOT_FOUND", "No encontramos esa solicitud.", 404);
  const trip = db.trips.get(request.trip_id);
  if (trip === undefined || trip.driver_user_id !== principal.userId) {
    throw new ApiFailure("TRIP_NOT_OWNED", "Solo quien conduce este viaje puede decidir sus solicitudes.", 403);
  }
  if (request.weekly_reservation_id !== null && request.weekly_reservation_id !== undefined) {
    throw new ApiFailure(
      "REQUEST_IN_WEEKLY_RESERVATION",
      "Esta solicitud forma parte de una reserva semanal: se acepta o se rechaza entera.",
      409,
      { reservationId: request.weekly_reservation_id },
    );
  }
  const outcome = decideRideRequest(db, principal, requestId, decision, INBOX_HOLD_TTL_SECONDS, auditRequestId);
  return {
    id: requestId,
    kind: "single",
    status: outcome.request.status as RideRequestStatus,
    hold: outcome.hold !== null && outcome.hold.expiresAt !== null ? { id: outcome.hold.id, expiresAt: outcome.hold.expiresAt } : null,
    requestIds: [requestId],
  };
}

/** `POST /v1/weekly-reservations/:id/decision`: todo o nada. */
export function decideWeekly(
  db: PreviewDb,
  principal: Principal,
  reservationId: string,
  decision: "accept" | "reject",
  auditRequestId: string,
): DecideRequestResponse {
  requireDriver(principal, "Necesitas el rol de conductor para decidir solicitudes.");
  const all = db.rideRequests.filter((row) => row.weekly_reservation_id === reservationId);
  const owned = all.length > 0 && all.every((row) => db.trips.get(row.trip_id)?.driver_user_id === principal.userId);
  if (!owned) throw new ApiFailure("WEEKLY_RESERVATION_NOT_FOUND", "No encontramos esa reserva semanal.", 404);
  const pending = all.filter((row) => row.status === "pending");
  if (pending.length === 0) throw new ApiFailure("REQUEST_NOT_PENDING", "Esta reserva semanal ya no está pendiente.", 409);
  const requestIds = all.map((row) => row.id);

  return db.tx(() => {
    expireStaleHolds(db);
    if (decision === "reject") {
      for (const row of pending) {
        rejectRequest(db, row.id, principal.userId, auditRequestId);
        db.events.emit("ride_request.decided", {
          request: db.rideRequests.get(row.id),
          decision,
          hold: null,
          trip: db.trips.get(row.trip_id),
        });
      }
      return { id: reservationId, kind: "weekly", status: "rejected", hold: null, requestIds };
    }

    // Aceptar es todo o nada: si una sola ocurrencia ya no tiene plaza, no cambia nada.
    const unavailable: string[] = [];
    let closed = false;
    for (const row of pending) {
      const trip = db.trips.get(row.trip_id);
      if (trip === undefined || !(trip.status === "published" || trip.status === "active")) {
        closed = true;
        continue;
      }
      if (availableSeatsForRange(db, trip.id, row.from_segment_seq, row.to_segment_seq) <= 0) {
        unavailable.push(trip.departure_at !== null ? madridDate(trip.departure_at) : trip.id);
      }
    }
    if (closed) throw new ApiFailure("TRIP_NOT_BOOKABLE", "Alguno de los viajes de la reserva ya no admite solicitudes.", 409);
    if (unavailable.length > 0) {
      throw new ApiFailure("NO_CAPACITY_ON_SEGMENT", "Ya no queda plaza en alguno de los viajes de la reserva.", 409, {
        dates: unavailable,
      });
    }

    const expiresAt = db.nowMs() + INBOX_HOLD_TTL_SECONDS * 1000;
    let firstHoldId: string | null = null;
    for (const row of pending) {
      const outcome = acceptRequest(db, row, principal.userId, INBOX_HOLD_TTL_SECONDS, auditRequestId);
      if (outcome.hold !== null) {
        db.seatHolds.update(outcome.hold.id, { expires_at: expiresAt });
        firstHoldId ??= outcome.hold.id;
      }
      db.events.emit("ride_request.decided", {
        request: db.rideRequests.get(row.id),
        decision,
        hold: outcome.hold === null ? null : { id: outcome.hold.id, expiresAt: iso(expiresAt) },
        trip: db.trips.get(row.trip_id),
      });
    }
    return {
      id: reservationId,
      kind: "weekly",
      status: "payment_pending",
      hold: { id: firstHoldId, expiresAt: iso(expiresAt) as string },
      requestIds,
    };
  });
}

// ── Rutas ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

const decisionBody = {
  type: "object",
  additionalProperties: false,
  required: ["decision"],
  properties: { decision: { type: "string", enum: ["accept", "reject"] } },
} as const;

export function registerInbox(r: PreviewRouter, db: PreviewDb): void {
  r.get<{ Query: { status?: InboxStatusFilter; tripId?: string; cursor?: string; limit?: number } }>(
    "/v1/me/driver/requests",
    {
      summary: "Bandeja de solicitudes del conductor (pantalla 20)",
      tags: ["trips"],
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            status: { type: "string", enum: ["pending", "open", "all"] },
            tripId: { type: "string", format: "uuid" },
            cursor: { type: "string", maxLength: 200 },
            limit: { type: "integer", minimum: 1, maximum: 50 },
          },
        },
      },
    },
    (req) =>
      driverInbox(db, req.auth(), {
        status: req.query.status ?? "pending",
        tripId: req.query.tripId ?? null,
        offset: decodeOffset(req.query.cursor),
        limit: req.query.limit ?? 20,
      }),
  );

  r.override<{ Params: { requestId: string }; Body: { decision: "accept" | "reject" } }>(
    "POST",
    "/v1/ride-requests/:requestId/decision",
    {
      summary: "Aceptar o rechazar una solicitud (crea el hold de 15 minutos; contrato trips §7.5)",
      tags: ["trips"],
      schema: { params: uuidParam("requestId"), body: decisionBody },
    },
    (req) => decideSingle(db, req.auth(), req.params.requestId, req.body.decision, req.requestId),
  );

  r.post<{ Params: { id: string }; Body: { decision: "accept" | "reject" } }>(
    "/v1/weekly-reservations/:id/decision",
    {
      summary: "Aceptar o rechazar una reserva semanal entera (todo o nada; contrato trips §8.4)",
      tags: ["trips"],
      schema: { params: uuidParam("id"), body: decisionBody },
    },
    (req) => decideWeekly(db, req.auth(), req.params.id, req.body.decision, req.requestId),
  );
}
