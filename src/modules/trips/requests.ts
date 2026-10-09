import type { Pool, PoolClient } from "pg";
import type { AuthPrincipal } from "../../auth/session.js";
import { notify } from "../../lib/notify.js";
import { writeAudit } from "../../lib/audit.js";
import {
  createRideRequestInTx, decideRideRequest, type RideRequestExtras, type RideRequestRow
} from "../../services/request-service.js";
import { localTimeOf, localDateOf, spanishDay, tx } from "./common.js";
import { err } from "./errors.js";
import { resolvePickupPointId, resolveDropoff, type PickupOption } from "./pickup-service.js";
import { loadPublicUsers } from "./public-user.js";
import { loadApprovedTariff, lockQuoteForRequest } from "./quote-service.js";
import {
  REQUEST_SELECT, buildRequestDetail, expireIfDue, loadRequestDetail, type RequestRow
} from "./request-detail.js";
import { withIdempotency } from "./idempotency.js";
import { tripsSettings } from "./settings.js";
import {
  loadSegmentLoads, loadStops, loadTrips, stopDistances, stopOffsets, type SegmentLoad, type StopRow, type TripRow
} from "./trip-data.js";
import type { CreateRideRequestBody, DecideRequestResponse, RideRequestDetail } from "./types.js";

/* ───────────────────────────── Resolución del tramo pedido ───────────────────────────── */

export type ResolvedRequestLeg = {
  fromSegmentSeq: number;
  toSegmentSeq: number;
  extras: RideRequestExtras;
};

export function normalizeMessage(message: string | undefined | null): string | null {
  if (message === undefined || message === null) return null;
  const clean = message.trim().replace(/\s+/g, " ");
  return clean.length === 0 ? null : clean;
}

/**
 * Convierte el cuerpo de la solicitud en un tramo validado en el servidor.
 * Exactamente UNA forma: `pickupPointId` (+ `dropoffStopSeq?`) o `fromSegmentSeq`+`toSegmentSeq` (heredado 0.14).
 */
export async function resolveRequestLeg(
  db: Pick<PoolClient, "query">,
  trip: TripRow,
  stops: readonly StopRow[],
  segments: readonly SegmentLoad[],
  body: Pick<CreateRideRequestBody, "pickupPointId" | "dropoffStopSeq" | "fromSegmentSeq" | "toSegmentSeq">
): Promise<ResolvedRequestLeg> {
  const hasPoint = body.pickupPointId !== undefined;
  const hasRange = body.fromSegmentSeq !== undefined || body.toSegmentSeq !== undefined;
  if (hasPoint === hasRange) {
    throw err("INVALID_REQUEST_SHAPE", 422, "Indica un punto de recogida (pickupPointId) o un rango de tramos, no ambos ni ninguno.");
  }
  const distances = stopDistances(stops, segments);
  const offsets = stopOffsets(stops, segments);

  if (hasPoint) {
    const pickup: PickupOption = await resolvePickupPointId(db, trip, stops, segments, body.pickupPointId!);
    const dropoff = resolveDropoff(stops, body.dropoffStopSeq, pickup);
    return {
      fromSegmentSeq: pickup.segmentSeq,
      toSegmentSeq: dropoff.seq,
      extras: {
        pickup: {
          lat: pickup.location.lat, lng: pickup.location.lng, label: pickup.label, address: null,
          source: pickup.source, offsetS: pickup.offsetS, walkMinutes: pickup.walkMinutes,
          detourMinutes: pickup.detourMinutes
        },
        dropoffStopSeq: dropoff.seq,
        roadDistanceM: Math.max(0, (distances[dropoff.seq] ?? 0) - pickup.distanceFromStartM)
      }
    };
  }

  if (body.dropoffStopSeq !== undefined) {
    throw err("INVALID_REQUEST_SHAPE", 422, "dropoffStopSeq solo puede usarse junto con pickupPointId.");
  }
  const from = body.fromSegmentSeq;
  const to = body.toSegmentSeq;
  if (from === undefined || to === undefined || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from) {
    throw err("INVALID_SEGMENT_RANGE", 422, "El rango de tramos no es válido.");
  }
  if (!segments.some(segment => segment.seq === to - 1) || !segments.some(segment => segment.seq === from)) {
    throw err("INVALID_SEGMENT_RANGE", 422, "El rango de tramos no existe en este viaje.");
  }
  const fromStop = stops[from];
  return {
    fromSegmentSeq: from,
    toSegmentSeq: to,
    extras: {
      pickup: fromStop
        ? {
            lat: fromStop.lat, lng: fromStop.lng, label: fromStop.label, address: null, source: "driver_stop",
            offsetS: offsets[from] ?? 0, walkMinutes: null, detourMinutes: fromStop.detour_minutes ?? 0
          }
        : null,
      dropoffStopSeq: stops[to] ? to : null,
      roadDistanceM: Math.max(0, (distances[to] ?? 0) - (distances[from] ?? 0))
    }
  };
}

/* ───────────────────────────── Crear solicitud ───────────────────────────── */

export async function createRequestForTrip(
  pool: Pool,
  principal: AuthPrincipal,
  tripId: string,
  body: CreateRideRequestBody,
  idempotencyKey: string | undefined
) {
  const result = await withIdempotency(
    pool,
    { userId: principal.userId, scope: `request:${tripId}`, key: idempotencyKey, fingerprintOf: body },
    async client => {
      if (!principal.roles.includes("passenger")) throw err("AUTH_FORBIDDEN", 403, "Necesitas el rol de pasajero para solicitar una plaza.");
      const locked = await client.query(`select id from trips where id = $1 for update`, [tripId]);
      if (!locked.rowCount) throw err("TRIP_NOT_FOUND", 404, "El viaje no existe.");
      const trip = (await loadTrips(client, [tripId])).get(tripId)!;
      if (trip.driver_user_id === principal.userId) {
        throw err("DRIVER_CANNOT_REQUEST_OWN_TRIP", 409, "No puedes solicitar plaza en tu propio viaje.");
      }
      if (!["published", "active"].includes(trip.status) || !trip.vehicle_bookable) {
        throw err("TRIP_NOT_BOOKABLE", 409, "Este viaje ya no admite solicitudes.");
      }
      const stops = (await loadStops(client, [tripId])).get(tripId) ?? [];
      const segments = (await loadSegmentLoads(client, [tripId])).get(tripId) ?? [];
      const leg = await resolveRequestLeg(client, trip, stops, segments, body);
      const message = normalizeMessage(body.message);
      const tariff = await loadApprovedTariff(client);
      const row = await createRideRequestInTx(
        client,
        principal,
        { tripId, fromSegmentSeq: leg.fromSegmentSeq, toSegmentSeq: leg.toSegmentSeq },
        { ...leg.extras, message },
        {
          afterCreate: async (c, created) => {
            await lockQuoteForRequest(c, { requestId: created.id, tariff, roadDistanceM: leg.extras.roadDistanceM ?? 0 });
            await notifyDriverOfRequest(c, trip, created, principal.userId, leg);
          }
        }
      );
      const detail = await detailInTx(client, row.id, principal.userId);
      return { status: 201, body: detail };
    }
  );
  return result;
}

async function notifyDriverOfRequest(
  client: PoolClient, trip: TripRow, row: RideRequestRow, passengerUserId: string, leg: ResolvedRequestLeg
): Promise<void> {
  const people = await loadPublicUsers(client, [passengerUserId]);
  const name = people.get(passengerUserId)?.firstName ?? "Un pasajero";
  const at = trip.departure_at ? ` el ${spanishDay(localDateOf(trip.departure_at))} a las ${localTimeOf(trip.departure_at)}` : "";
  await notify(client, {
    userId: trip.driver_user_id,
    category: "trip",
    kind: "request_received",
    title: "Nueva solicitud de plaza",
    body: `${name} quiere viajar contigo${at}.`,
    data: { requestId: row.id, tripId: trip.id, fromSegmentSeq: leg.fromSegmentSeq, toSegmentSeq: leg.toSegmentSeq }
  });
}

async function detailInTx(client: PoolClient, requestId: string, viewerUserId: string): Promise<RideRequestDetail> {
  const found = await client.query<RequestRow>(`${REQUEST_SELECT} where r.id = $1`, [requestId]);
  const row = found.rows[0]!;
  const trip = (await loadTrips(client, [row.trip_id])).get(row.trip_id)!;
  return buildRequestDetail(client, row, trip, viewerUserId, new Date());
}

/* ───────────────────────────── Retirar solicitud ───────────────────────────── */

export async function withdrawRequest(pool: Pool, principal: AuthPrincipal, requestId: string): Promise<RideRequestDetail> {
  await tx(pool, async client => {
    const found = await client.query<{ id: string; trip_id: string; passenger_user_id: string; status: string; weekly_reservation_id: string | null }>(
      `select id, trip_id, passenger_user_id, status, weekly_reservation_id from ride_requests where id = $1 for update`,
      [requestId]
    );
    const row = found.rows[0];
    if (!row || row.passenger_user_id !== principal.userId) throw err("REQUEST_NOT_FOUND", 404, "La solicitud no existe.");
    if (row.status !== "pending") {
      throw err("REQUEST_NOT_WITHDRAWABLE", 409, "Solo puedes retirar una solicitud que el conductor aún no ha respondido.", { status: row.status });
    }
    await client.query(`update ride_requests set status = 'cancelled', updated_at = now() where id = $1`, [requestId]);
    await writeAudit(client, {
      actorUserId: principal.userId, action: "ride_request.withdrawn", entityType: "ride_request", entityId: requestId,
      metadata: { tripId: row.trip_id }
    });
    const trip = (await loadTrips(client, [row.trip_id])).get(row.trip_id);
    if (trip) {
      const people = await loadPublicUsers(client, [principal.userId]);
      await notify(client, {
        userId: trip.driver_user_id,
        category: "trip",
        kind: "request_withdrawn",
        title: "Solicitud retirada",
        body: `${people.get(principal.userId)?.firstName ?? "El pasajero"} ha retirado su solicitud de plaza.`,
        data: { requestId, tripId: row.trip_id }
      });
    }
  });
  return loadRequestDetail(pool, requestId, principal.userId);
}

/* ───────────────────────────── Decisión del conductor ───────────────────────────── */

export async function decideRequest(
  pool: Pool,
  principal: AuthPrincipal,
  requestId: string,
  decision: "accept" | "reject"
): Promise<DecideRequestResponse> {
  await expireIfDue(pool, [requestId]);
  const pre = await pool.query<{ weekly_reservation_id: string | null; driver_user_id: string }>(
    `select r.weekly_reservation_id, t.driver_user_id from ride_requests r join trips t on t.id = r.trip_id where r.id = $1`,
    [requestId]
  );
  const info = pre.rows[0];
  // Solo el conductor del viaje conoce que la solicitud pertenece a una reserva semanal (no se revela a terceros).
  if (info?.weekly_reservation_id && info.driver_user_id === principal.userId) {
    throw err("REQUEST_IN_WEEKLY_RESERVATION", 409, "Esta solicitud forma parte de una reserva semanal: decide sobre la reserva completa.", {
      reservationId: info.weekly_reservation_id
    });
  }
  const tariff = await loadApprovedTariff(pool);
  const outcome = await decideRideRequest(pool, principal, requestId, decision, tripsSettings().holdTtlSeconds, {
    afterDecision: async (client, result, decided, trip) => {
      const people = await loadPublicUsers(client, [trip.driver_user_id]);
      const driverName = people.get(trip.driver_user_id)?.firstName ?? "El conductor";
      if (decided === "accept") {
        const road = await client.query<{ road_distance_m: number | null }>(
          `select coalesce(road_distance_m, (select sum(distance_m)::int from trip_segments
                                              where trip_id = $2 and seq >= $3 and seq < $4), 0) as road_distance_m
             from ride_requests where id = $1`,
          [requestId, result.request.trip_id, result.request.from_segment_seq, result.request.to_segment_seq]
        );
        await lockQuoteForRequest(client, { requestId, tariff, roadDistanceM: road.rows[0]?.road_distance_m ?? 0 });
      }
      await notify(client, {
        userId: result.request.passenger_user_id,
        category: "trip",
        kind: decided === "accept" ? "request_accepted" : "request_rejected",
        title: decided === "accept" ? "Plaza aceptada" : "Solicitud rechazada",
        body: decided === "accept"
          ? `${driverName} ha aceptado tu solicitud. Completa el pago antes de que acabe el tiempo para asegurar tu plaza.`
          : `${driverName} no ha podido aceptar tu solicitud. Prueba con otro viaje.`,
        data: {
          requestId, tripId: result.request.trip_id,
          ...(result.hold ? { holdExpiresAt: result.hold.expiresAt } : {})
        }
      });
    }
  });
  return {
    id: requestId,
    kind: "single",
    status: outcome.request.status as DecideRequestResponse["status"],
    hold: outcome.hold ? { id: outcome.hold.id, expiresAt: outcome.hold.expiresAt } : null,
    requestIds: [requestId]
  };
}
