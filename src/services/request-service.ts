import type { Pool, PoolClient } from "pg";
import type { AuthPrincipal } from "../auth/session.js";
import { requireAnyRole } from "../auth/session.js";
import { DomainError } from "../errors.js";

export async function tx<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const value = await fn(client);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function lockRequestedSegments(
  client: PoolClient,
  tripId: string,
  fromSegmentSeq: number,
  toSegmentSeq: number
) {
  const expected = toSegmentSeq - fromSegmentSeq;
  const segments = await client.query(
    `select * from trip_segments
      where trip_id=$1 and seq >= $2 and seq < $3
      order by seq
      for update`,
    [tripId, fromSegmentSeq, toSegmentSeq]
  );
  if (segments.rowCount !== expected) {
    throw new DomainError("INVALID_SEGMENT_RANGE", "Requested segment range is not contiguous");
  }
  return segments.rows;
}

export async function assertCapacity(
  client: PoolClient,
  tripId: string,
  segments: Array<{ seq: number; capacity: number }>
): Promise<void> {
  await client.query(
    `update seat_holds h
        set status='released',released_at=now()
       from ride_requests r
      where h.request_id=r.id and r.trip_id=$1
        and h.status='active' and h.expires_at <= now()`,
    [tripId]
  );

  for (const segment of segments) {
    const occupancy = await client.query(
      `select
        (select count(*)::int
           from seat_holds h
           join ride_requests r on r.id=h.request_id
          where r.trip_id=$1 and h.status='active' and h.expires_at > now()
            and r.from_segment_seq <= $2 and r.to_segment_seq > $2)
        +
        (select count(*)::int
           from bookings b
           join ride_requests r on r.id=b.request_id
          where r.trip_id=$1 and b.status in ('confirmed','completed')
            and r.from_segment_seq <= $2 and r.to_segment_seq > $2)
        as occupied`,
      [tripId, segment.seq]
    );
    if ((occupancy.rows[0]?.occupied ?? 0) >= segment.capacity) {
      throw new DomainError("NO_CAPACITY_ON_SEGMENT", "No seat capacity on at least one affected segment", 409);
    }
  }
}

function validateRange(from: number, to: number): void {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from) {
    throw new DomainError("INVALID_SEGMENT_RANGE", "Segment range is invalid");
  }
}

/**
 * Datos adicionales de una solicitud (módulo «trips»): punto de recogida elegido, bajada, distancia de carretera,
 * mensaje y reserva semanal. Todos opcionales: la solicitud heredada 0.14 (solo tramos) sigue siendo válida.
 */
export type RideRequestExtras = {
  pickup?: {
    lat: number;
    lng: number;
    label: string | null;
    address: string | null;
    source: "driver_stop" | "route_projection";
    offsetS: number | null;
    walkMinutes: number | null;
    detourMinutes: number | null;
  } | null;
  dropoffStopSeq?: number | null;
  roadDistanceM?: number | null;
  message?: string | null;
  weeklyReservationId?: string | null;
};

export type RideRequestRow = {
  id: string;
  trip_id: string;
  passenger_user_id: string;
  from_segment_seq: number;
  to_segment_seq: number;
  status: string;
  requested_at: Date;
  updated_at: Date;
};

export type CreateRideRequestHooks = {
  /** Se ejecuta dentro de la transacción tras insertar (notificaciones, instantánea de presupuesto…). */
  afterCreate?: (client: PoolClient, row: RideRequestRow, trip: { driver_user_id: string }) => Promise<void>;
};

/**
 * Inserta una solicitud `pending` dentro de una transacción en la que el viaje YA está bloqueado (`for update`).
 * Comprueba capacidad por tramo (una solicitud pendiente no reserva plaza, pero no se admite sobre un tramo lleno)
 * y que el pasajero no tenga otra solicitud abierta que se solape en el mismo viaje.
 */
export async function insertRideRequestInTx(
  client: PoolClient,
  input: { tripId: string; passengerUserId: string; fromSegmentSeq: number; toSegmentSeq: number },
  extras: RideRequestExtras = {}
): Promise<RideRequestRow> {
  validateRange(input.fromSegmentSeq, input.toSegmentSeq);
  const segments = await lockRequestedSegments(client, input.tripId, input.fromSegmentSeq, input.toSegmentSeq);
  await assertCapacity(client, input.tripId, segments);

  const overlap = await client.query(
    `select 1 from ride_requests
      where trip_id=$1 and passenger_user_id=$2
        and status in ('pending','accepted','payment_pending','confirmed')
        and from_segment_seq < $4 and to_segment_seq > $3
      limit 1`,
    [input.tripId, input.passengerUserId, input.fromSegmentSeq, input.toSegmentSeq]
  );
  if (overlap.rowCount) {
    throw new DomainError("DUPLICATE_OPEN_REQUEST", "An open request already exists for this segment range", 409);
  }

  const pickup = extras.pickup ?? null;
  try {
    const result = await client.query<RideRequestRow>(
      `insert into ride_requests(
         trip_id,passenger_user_id,from_segment_seq,to_segment_seq,status,
         pickup_geom,pickup_label,pickup_address,pickup_source,pickup_offset_s,
         pickup_walk_minutes,pickup_detour_minutes,dropoff_stop_seq,road_distance_m,message,weekly_reservation_id
       ) values($1,$2,$3,$4,'pending',
         case when $5::float8 is null then null else ST_SetSRID(ST_Point($6,$5),4326) end,
         $7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       returning id,trip_id,passenger_user_id,from_segment_seq,to_segment_seq,status,requested_at,updated_at`,
      [
        input.tripId, input.passengerUserId, input.fromSegmentSeq, input.toSegmentSeq,
        pickup?.lat ?? null, pickup?.lng ?? null, pickup?.label ?? null, pickup?.address ?? null,
        pickup?.source ?? null, pickup?.offsetS ?? null, pickup?.walkMinutes ?? null, pickup?.detourMinutes ?? null,
        extras.dropoffStopSeq ?? null, extras.roadDistanceM ?? null, extras.message ?? null,
        extras.weeklyReservationId ?? null
      ]
    );
    const row = result.rows[0]!;
    await client.query(
      `insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
       values($1,'ride_request.created','ride_request',$2,$3::jsonb)`,
      [input.passengerUserId, row.id, JSON.stringify({
        tripId: input.tripId,
        fromSegmentSeq: input.fromSegmentSeq,
        toSegmentSeq: input.toSegmentSeq,
        pickupSource: pickup?.source ?? null,
        weeklyReservationId: extras.weeklyReservationId ?? null
      })]
    );
    return row;
  } catch (error: any) {
    if (error?.code === "23505") {
      throw new DomainError("DUPLICATE_OPEN_REQUEST", "An open request already exists for this segment range", 409);
    }
    throw error;
  }
}

/** Variante dentro de transacción de `createRideRequest`: bloquea el viaje, valida y notifica mediante `hooks`. */
export async function createRideRequestInTx(
  client: PoolClient,
  principal: AuthPrincipal,
  input: { tripId: string; fromSegmentSeq: number; toSegmentSeq: number },
  extras: RideRequestExtras = {},
  hooks: CreateRideRequestHooks = {}
): Promise<RideRequestRow> {
  requireAnyRole(principal, ["passenger"]);
  validateRange(input.fromSegmentSeq, input.toSegmentSeq);
  const tripQ = await client.query(
    `select id,driver_user_id,status from trips where id=$1 for update`,
    [input.tripId]
  );
  const trip = tripQ.rows[0];
  if (!trip) throw new DomainError("TRIP_NOT_FOUND", "Trip not found", 404);
  if (!["published","active"].includes(trip.status)) {
    throw new DomainError("TRIP_NOT_BOOKABLE", "Trip is not bookable", 409);
  }
  if (trip.driver_user_id === principal.userId) {
    throw new DomainError("DRIVER_CANNOT_REQUEST_OWN_TRIP", "Driver cannot request a seat on their own trip", 409);
  }
  const row = await insertRideRequestInTx(
    client,
    { tripId: input.tripId, passengerUserId: principal.userId, fromSegmentSeq: input.fromSegmentSeq, toSegmentSeq: input.toSegmentSeq },
    extras
  );
  if (hooks.afterCreate) await hooks.afterCreate(client, row, trip);
  return row;
}

export async function createRideRequest(
  pool: Pool,
  principal: AuthPrincipal,
  input: { tripId: string; fromSegmentSeq: number; toSegmentSeq: number },
  extras: RideRequestExtras = {},
  hooks: CreateRideRequestHooks = {}
) {
  requireAnyRole(principal, ["passenger"]);
  validateRange(input.fromSegmentSeq, input.toSegmentSeq);
  return tx(pool, client => createRideRequestInTx(client, principal, input, extras, hooks));
}

export async function listOwnRideRequests(pool: Pool, principal: AuthPrincipal) {
  requireAnyRole(principal, ["passenger"]);
  return (await pool.query(
    `select r.id,r.trip_id,r.from_segment_seq,r.to_segment_seq,r.status,
            r.requested_at,r.updated_at,h.expires_at as hold_expires_at
       from ride_requests r
       left join seat_holds h on h.request_id=r.id and h.status='active'
      where r.passenger_user_id=$1
      order by r.requested_at desc`,
    [principal.userId]
  )).rows;
}

export async function listTripRideRequests(
  pool: Pool,
  principal: AuthPrincipal,
  tripId: string
) {
  requireAnyRole(principal, ["driver"]);
  const trip=await pool.query(`select driver_user_id from trips where id=$1`,[tripId]);
  if (!trip.rowCount) throw new DomainError("TRIP_NOT_FOUND","Trip not found",404);
  if (trip.rows[0].driver_user_id!==principal.userId) {
    throw new DomainError("TRIP_NOT_OWNED","Only the trip driver can view its requests",403);
  }
  return (await pool.query(
    `select id,passenger_user_id,from_segment_seq,to_segment_seq,status,requested_at,updated_at
       from ride_requests
      where trip_id=$1
      order by requested_at asc`,
    [tripId]
  )).rows;
}

export type DecisionOutcome = {
  request: { id: string; trip_id: string; passenger_user_id: string; from_segment_seq: number; to_segment_seq: number; status: string; updated_at: Date };
  hold: { id: string; expiresAt: string } | null;
};

export type DecideRideRequestHooks = {
  /** Se ejecuta dentro de la transacción de la decisión (notificación al pasajero, instantánea de presupuesto…). */
  afterDecision?: (
    client: PoolClient,
    outcome: DecisionOutcome,
    decision: "accept" | "reject",
    trip: { id: string; driver_user_id: string }
  ) => Promise<void>;
};

/** Rechaza una solicitud `pending` (el viaje ya está bloqueado y el conductor verificado). */
export async function rejectRequestInTx(client: PoolClient, requestId: string, driverUserId: string): Promise<DecisionOutcome> {
  const rejected = await client.query(
    `update ride_requests set status='rejected',updated_at=now()
      where id=$1
      returning id,trip_id,passenger_user_id,from_segment_seq,to_segment_seq,status,updated_at`,
    [requestId]
  );
  await client.query(
    `insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
     values($1,'ride_request.rejected','ride_request',$2,'{}'::jsonb)`,
    [driverUserId, requestId]
  );
  return { request: rejected.rows[0], hold: null };
}

/**
 * Acepta una solicitud `pending`: comprueba capacidad por tramo, crea el hold y pasa a `payment_pending`
 * (aceptada ≠ confirmada) en la misma transacción. El viaje ya está bloqueado.
 */
export async function acceptRequestInTx(
  client: PoolClient,
  request: { id: string; trip_id: string; from_segment_seq: number; to_segment_seq: number },
  driverUserId: string,
  holdTtlSeconds: number,
  holdExpiresAt?: Date
): Promise<DecisionOutcome> {
  const segments = await lockRequestedSegments(client, request.trip_id, request.from_segment_seq, request.to_segment_seq);
  await assertCapacity(client, request.trip_id, segments);

  await client.query(
    `update ride_requests set status='accepted',updated_at=now() where id=$1`,
    [request.id]
  );
  const hold = holdExpiresAt
    ? await client.query(
        `insert into seat_holds(request_id,status,expires_at) values($1,'active',$2) returning id,expires_at`,
        [request.id, holdExpiresAt.toISOString()]
      )
    : await client.query(
        `insert into seat_holds(request_id,status,expires_at)
         values($1,'active',now()+($2 || ' seconds')::interval)
         returning id,expires_at`,
        [request.id, holdTtlSeconds]
      );
  const accepted = await client.query(
    `update ride_requests set status='payment_pending',updated_at=now()
      where id=$1
      returning id,trip_id,passenger_user_id,from_segment_seq,to_segment_seq,status,updated_at`,
    [request.id]
  );
  await client.query(
    `insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
     values($1,'ride_request.accepted_with_hold','ride_request',$2,$3::jsonb)`,
    [driverUserId, request.id, JSON.stringify({ holdId: hold.rows[0].id })]
  );
  return {
    request: accepted.rows[0],
    hold: { id: hold.rows[0].id, expiresAt: new Date(hold.rows[0].expires_at).toISOString() }
  };
}

export async function decideRideRequest(
  pool: Pool,
  principal: AuthPrincipal,
  requestId: string,
  decision: "accept" | "reject",
  holdTtlSeconds = 600,
  hooks: DecideRideRequestHooks = {}
) {
  requireAnyRole(principal, ["driver"]);
  if (!Number.isInteger(holdTtlSeconds) || holdTtlSeconds < 30 || holdTtlSeconds > 3600) {
    throw new DomainError("INVALID_HOLD_TTL", "Seat hold TTL must be between 30 and 3600 seconds");
  }

  return tx(pool, async client => {
    const requestQ=await client.query(
      `select * from ride_requests where id=$1 for update`,
      [requestId]
    );
    const request=requestQ.rows[0];
    if (!request) throw new DomainError("REQUEST_NOT_FOUND","Ride request not found",404);

    const tripQ=await client.query(
      `select id,driver_user_id,status from trips where id=$1 for update`,
      [request.trip_id]
    );
    const trip=tripQ.rows[0];
    if (!trip) throw new DomainError("TRIP_NOT_FOUND","Trip not found",404);
    // La propiedad se comprueba ANTES que el estado: quien no es el conductor no averigua si la solicitud sigue pendiente.
    if (trip.driver_user_id!==principal.userId) {
      throw new DomainError("TRIP_NOT_OWNED","Only the trip driver can decide this request",403);
    }
    if (request.status!=="pending") {
      throw new DomainError("REQUEST_NOT_PENDING","Only pending requests can be decided",409);
    }

    let outcome: DecisionOutcome;
    if (decision==="reject") {
      outcome = await rejectRequestInTx(client, requestId, principal.userId);
    } else {
      if (!["published","active"].includes(trip.status)) {
        throw new DomainError("TRIP_NOT_BOOKABLE","Trip is not bookable",409);
      }
      outcome = await acceptRequestInTx(client, request, principal.userId, holdTtlSeconds);
    }
    if (hooks.afterDecision) await hooks.afterDecision(client, outcome, decision, trip);
    return outcome;
  });
}
