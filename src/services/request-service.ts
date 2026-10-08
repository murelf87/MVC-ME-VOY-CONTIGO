import type { Pool, PoolClient } from "pg";
import type { AuthPrincipal } from "../auth/session.js";
import { requireAnyRole } from "../auth/session.js";
import { DomainError } from "../errors.js";
import { displayName, notify } from "./notification-service.js";
import { snapshotQuoteForRequest } from "./tariff-service.js";
import { assertStopAhead } from "./trip-progress-service.js";
import { assertLegalAccepted } from "./legal-service.js";

async function tx<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
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

async function lockRequestedSegments(
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

async function assertCapacity(
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

export async function createRideRequest(
  pool: Pool,
  principal: AuthPrincipal,
  input: { tripId: string; fromSegmentSeq: number; toSegmentSeq: number }
) {
  requireAnyRole(principal, ["passenger"]);
  validateRange(input.fromSegmentSeq, input.toSegmentSeq);
  await assertLegalAccepted(pool, principal.userId);

  return tx(pool, async client => {
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

    if (trip.status==="active") await assertStopAhead(client,input.tripId,input.fromSegmentSeq);
    const segments = await lockRequestedSegments(
      client,input.tripId,input.fromSegmentSeq,input.toSegmentSeq
    );
    await assertCapacity(client,input.tripId,segments);

    try {
      const result = await client.query(
        `insert into ride_requests(
           trip_id,passenger_user_id,from_segment_seq,to_segment_seq,status
         ) values($1,$2,$3,$4,'pending')
         returning id,trip_id,passenger_user_id,from_segment_seq,to_segment_seq,status,requested_at,updated_at`,
        [input.tripId,principal.userId,input.fromSegmentSeq,input.toSegmentSeq]
      );
      const row=result.rows[0];
      await client.query(
        `insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
         values($1,'ride_request.created','ride_request',$2,$3::jsonb)`,
        [principal.userId,row.id,JSON.stringify({
          tripId: input.tripId,
          fromSegmentSeq: input.fromSegmentSeq,
          toSegmentSeq: input.toSegmentSeq
        })]
      );
      await notify(client,trip.driver_user_id,"ride_request.received",input.tripId,{
        requestId:row.id,passengerName:await displayName(client,principal.userId)
      });
      return row;
    } catch (error: any) {
      if (error?.code==="23505") {
        throw new DomainError("DUPLICATE_OPEN_REQUEST", "An open request already exists for this segment range", 409);
      }
      throw error;
    }
  });
}

export async function listOwnRideRequests(pool: Pool, principal: AuthPrincipal) {
  requireAnyRole(principal, ["passenger"]);
  return (await pool.query(
    `select r.id,r.trip_id,r.from_segment_seq,r.to_segment_seq,r.status,
            r.requested_at,r.updated_at,h.expires_at as hold_expires_at,
            t.driver_user_id,dp.display_name as driver_display_name,
            t.status as trip_status,t.departure_at,
            b.id as booking_id,b.status as booking_status,b.picked_up_at,
            mr.score as my_rating_score,
            bc.refund_cents,bc.refund_status,r.weekly_group_id,
            qs.passenger_total_cents as quote_total_cents,qs.contribution_cents as quote_contribution_cents,
            qs.road_distance_m as quote_road_distance_m
       from ride_requests r
       join trips t on t.id=r.trip_id
       left join profiles dp on dp.user_id=t.driver_user_id
       left join seat_holds h on h.request_id=r.id and h.status='active'
       left join bookings b on b.request_id=r.id
       left join trip_ratings mr on mr.booking_id=b.id and mr.rater_user_id=r.passenger_user_id
       left join booking_cancellations bc on bc.booking_id=b.id
       left join quote_snapshots qs on qs.request_id=r.id
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
    `select r.id,r.passenger_user_id,pp.display_name as passenger_display_name,
            r.from_segment_seq,r.to_segment_seq,r.status,r.requested_at,r.updated_at,
            b.id as booking_id,b.status as booking_status,b.picked_up_at,
            mr.score as my_rating_score,r.weekly_group_id
       from ride_requests r
       left join profiles pp on pp.user_id=r.passenger_user_id
       left join bookings b on b.request_id=r.id
       left join trip_ratings mr on mr.booking_id=b.id and mr.rater_user_id=$2
      where r.trip_id=$1
      order by r.requested_at asc`,
    [tripId,principal.userId]
  )).rows;
}

export async function decideRideRequest(
  pool: Pool,
  principal: AuthPrincipal,
  requestId: string,
  decision: "accept" | "reject",
  holdTtlSeconds = 600
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
    if (request.status!=="pending") {
      throw new DomainError("REQUEST_NOT_PENDING","Only pending requests can be decided",409);
    }

    const tripQ=await client.query(
      `select id,driver_user_id,status from trips where id=$1 for update`,
      [request.trip_id]
    );
    const trip=tripQ.rows[0];
    if (!trip) throw new DomainError("TRIP_NOT_FOUND","Trip not found",404);
    if (trip.driver_user_id!==principal.userId) {
      throw new DomainError("TRIP_NOT_OWNED","Only the trip driver can decide this request",403);
    }

    if (decision==="reject") {
      const rejected=await client.query(
        `update ride_requests set status='rejected',updated_at=now()
          where id=$1
          returning id,trip_id,passenger_user_id,from_segment_seq,to_segment_seq,status,updated_at`,
        [requestId]
      );
      await client.query(
        `insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
         values($1,'ride_request.rejected','ride_request',$2,'{}'::jsonb)`,
        [principal.userId,requestId]
      );
      await notify(client,request.passenger_user_id,"ride_request.rejected",request.trip_id,{
        requestId,driverName:await displayName(client,principal.userId)
      });
      return { request:rejected.rows[0],hold:null };
    }

    if (!["published","active"].includes(trip.status)) {
      throw new DomainError("TRIP_NOT_BOOKABLE","Trip is not bookable",409);
    }

    if (trip.status==="active") await assertStopAhead(client,trip.id,request.from_segment_seq);
    const segments=await lockRequestedSegments(
      client,trip.id,request.from_segment_seq,request.to_segment_seq
    );
    await assertCapacity(client,trip.id,segments);

    await client.query(
      `update ride_requests set status='accepted',updated_at=now() where id=$1`,
      [requestId]
    );
    const hold=await client.query(
      `insert into seat_holds(request_id,status,expires_at)
       values($1,'active',now()+($2 || ' seconds')::interval)
       returning id,expires_at`,
      [requestId,holdTtlSeconds]
    );
    const accepted=await client.query(
      `update ride_requests set status='payment_pending',updated_at=now()
        where id=$1
        returning id,trip_id,passenger_user_id,from_segment_seq,to_segment_seq,status,updated_at`,
      [requestId]
    );
    await client.query(
      `insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
       values($1,'ride_request.accepted_with_hold','ride_request',$2,$3::jsonb)`,
      [principal.userId,requestId,JSON.stringify({holdId:hold.rows[0].id})]
    );
    const quote=await snapshotQuoteForRequest(client,requestId);
    await notify(client,request.passenger_user_id,"ride_request.accepted",request.trip_id,{
      requestId,driverName:await displayName(client,principal.userId),
      holdExpiresAt:new Date(hold.rows[0].expires_at).toISOString()
    });
    return {
      quote,
      request:accepted.rows[0],
      hold:{
        id:hold.rows[0].id,
        expiresAt:new Date(hold.rows[0].expires_at).toISOString()
      }
    };
  });
}
