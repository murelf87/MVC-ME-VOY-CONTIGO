import type { Pool, PoolClient } from "pg";
import { DomainError } from "../errors.js";
import { displayName, notify } from "./notification-service.js";

type PaymentConfirmation =
  | { status: "confirmed"; bookingId: string }
  | { status: "compensation_required"; compensationId: string };

async function tx<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function releaseExpiredHolds(client: PoolClient, tripId: string): Promise<void> {
  await client.query(
    `update seat_holds h
        set status='released', released_at=now()
       from ride_requests r
      where h.request_id=r.id and r.trip_id=$1
        and h.status='active' and h.expires_at <= now()`,
    [tripId]
  );
}

export async function createSeatHold(pool: Pool, requestId: string, ttlSeconds = 600): Promise<string> {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 3600) {
    throw new DomainError("INVALID_HOLD_TTL", "Seat hold TTL must be between 30 and 3600 seconds");
  }

  return tx(pool, async (client) => {
    const rq = await client.query(
      `select * from ride_requests where id=$1 for update`,
      [requestId]
    );
    const request = rq.rows[0];
    if (!request) throw new DomainError("REQUEST_NOT_FOUND", "Ride request not found", 404);
    if (request.status !== "accepted") {
      throw new DomainError("REQUEST_NOT_ACCEPTED", "Driver must accept the request before payment hold");
    }

    const tripQ = await client.query(`select * from trips where id=$1 for update`, [request.trip_id]);
    const trip = tripQ.rows[0];
    if (!trip || !["published", "active"].includes(trip.status)) {
      throw new DomainError("TRIP_NOT_BOOKABLE", "Trip is not bookable");
    }

    await releaseExpiredHolds(client, trip.id);

    const segments = await client.query(
      `select * from trip_segments
        where trip_id=$1 and seq >= $2 and seq < $3
        order by seq
        for update`,
      [trip.id, request.from_segment_seq, request.to_segment_seq]
    );
    const expected = request.to_segment_seq - request.from_segment_seq;
    if (segments.rowCount !== expected) {
      throw new DomainError("INVALID_SEGMENT_RANGE", "Requested segment range is not contiguous");
    }

    for (const segment of segments.rows) {
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
        [trip.id, segment.seq]
      );
      if ((occupancy.rows[0]?.occupied ?? 0) >= segment.capacity) {
        throw new DomainError("NO_CAPACITY_ON_SEGMENT", "No seat capacity on at least one affected segment", 409);
      }
    }

    const hold = await client.query(
      `insert into seat_holds(request_id,status,expires_at)
       values($1,'active',now() + ($2 || ' seconds')::interval)
       on conflict(request_id) do update
          set status='active', expires_at=excluded.expires_at, released_at=null
       returning id`,
      [requestId, ttlSeconds]
    );
    await client.query(`update ride_requests set status='payment_pending', updated_at=now() where id=$1`, [requestId]);
    return hold.rows[0].id as string;
  });
}

export async function confirmProviderPayment(
  pool: Pool,
  input: { requestId: string; providerPaymentId: string; amountCents: number }
): Promise<PaymentConfirmation> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 0) {
    throw new DomainError("INVALID_PAYMENT_AMOUNT", "Payment amount must be exact integer cents");
  }

  return tx(pool, async (client) => {
    const existingBooking = await client.query(
      `select id from bookings
        where request_id=$1 or provider_payment_id=$2
        limit 1`,
      [input.requestId, input.providerPaymentId]
    );
    if (existingBooking.rowCount) {
      return { status: "confirmed", bookingId: existingBooking.rows[0].id as string };
    }

    const existingComp = await client.query(
      `select id from payment_compensations where provider_payment_id=$1 limit 1`,
      [input.providerPaymentId]
    );
    if (existingComp.rowCount) {
      return { status: "compensation_required", compensationId: existingComp.rows[0].id as string };
    }

    const reqQ = await client.query(`select * from ride_requests where id=$1 for update`, [input.requestId]);
    const request = reqQ.rows[0];
    if (!request) throw new DomainError("REQUEST_NOT_FOUND", "Ride request not found", 404);

    const holdQ = await client.query(`select * from seat_holds where request_id=$1 for update`, [input.requestId]);
    const hold = holdQ.rows[0];

    if (!hold || hold.status !== "active" || new Date(hold.expires_at).getTime() <= Date.now()) {
      if (hold?.status === "active") {
        await client.query(`update seat_holds set status='released', released_at=now() where id=$1`, [hold.id]);
      }
      const comp = await client.query(
        `insert into payment_compensations
           (request_id,provider_payment_id,amount_cents,reason,action,status)
         values($1,$2,$3,'hold_expired','refund_required','pending')
         returning id`,
        [input.requestId, input.providerPaymentId, input.amountCents]
      );
      await client.query(`update ride_requests set status='payment_late', updated_at=now() where id=$1`, [input.requestId]);
      return { status: "compensation_required", compensationId: comp.rows[0].id as string };
    }

    const booking = await client.query(
      `insert into bookings(request_id,provider_payment_id,amount_cents,status,cancellation_policy_version_id)
       values($1,$2,$3,'confirmed',
         (select id from cancellation_policy_versions where status='active'))
       returning id`,
      [input.requestId, input.providerPaymentId, input.amountCents]
    );
    await client.query(`update seat_holds set status='consumed', consumed_at=now() where id=$1`, [hold.id]);
    await client.query(`update ride_requests set status='confirmed', updated_at=now() where id=$1`, [input.requestId]);
    const trip = await client.query(`select driver_user_id from trips where id=$1`, [request.trip_id]);
    await notify(client, [request.passenger_user_id, trip.rows[0].driver_user_id], "booking.confirmed", request.trip_id, {
      bookingId: booking.rows[0].id,
      passengerName: await displayName(client, request.passenger_user_id),
      driverName: await displayName(client, trip.rows[0].driver_user_id)
    });

    return { status: "confirmed", bookingId: booking.rows[0].id as string };
  });
}
