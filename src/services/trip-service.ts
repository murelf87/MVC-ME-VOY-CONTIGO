import type { Pool, PoolClient } from "pg";
import { DomainError } from "../errors.js";
import { assertVehicleCanDrive } from "../vehicles/compliance-service.js";

async function withTx<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
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

export async function publishTrip(pool: Pool, tripId: string): Promise<void> {
  await withTx(pool, async (client) => {
    const tripResult = await client.query(
      `select t.*, v.passenger_seats, v.review_status, v.documentation_status,
              p.public_photo_status, p.identity_status
         from trips t
         join vehicles v on v.id = t.vehicle_id
         join profiles p on p.user_id = t.driver_user_id
        where t.id = $1
        for update of t`,
      [tripId]
    );
    const trip = tripResult.rows[0];
    if (!trip) throw new DomainError("TRIP_NOT_FOUND", "Trip not found", 404);
    if (trip.status !== "draft") throw new DomainError("TRIP_NOT_DRAFT", "Only draft trips can be published");

    if (!trip.route_geom || !trip.route_distance_m || !trip.route_provider || !trip.route_provider_ref) {
      throw new DomainError("MVC_ROUTE_UNVERIFIED", "Verified routed geometry and distance are required");
    }
    if (trip.public_photo_status !== "approved") {
      throw new DomainError("DRIVER_PUBLIC_PHOTO_REQUIRED", "Approved public profile photo is required");
    }
    if (trip.identity_status !== "verified") {
      throw new DomainError("DRIVER_IDENTITY_REQUIRED", "Verified driver identity is required");
    }
    if (trip.review_status !== "approved" || trip.documentation_status !== "approved") {
      throw new DomainError("VEHICLE_NOT_APPROVED", "Vehicle and documentation must be approved");
    }
    await assertVehicleCanDrive(client, trip.vehicle_id);
    if (trip.offered_seats > trip.passenger_seats) {
      throw new DomainError("OFFERED_SEATS_EXCEED_VEHICLE", "Offered seats exceed vehicle capacity", 422);
    }

    const invalidStops = await client.query(
      `select count(*)::int as n
         from trip_stops s
         join trips t on t.id = s.trip_id
         join provinces p on p.id = t.province_id
        where s.trip_id = $1 and not ST_CoveredBy(s.geom, p.geom)`,
      [tripId]
    );
    if ((invalidStops.rows[0]?.n ?? 0) > 0) {
      throw new DomainError("MVC_STOP_OUTSIDE_PROVINCE", "One or more stops are outside the trip province");
    }

    const seg = await client.query(
      `select count(*)::int as n, coalesce(max(capacity),0)::int as max_capacity
         from trip_segments where trip_id = $1`,
      [tripId]
    );
    if ((seg.rows[0]?.n ?? 0) < 1) {
      throw new DomainError("TRIP_SEGMENTS_REQUIRED", "At least one route segment is required");
    }
    if ((seg.rows[0]?.max_capacity ?? 0) > trip.offered_seats) {
      throw new DomainError("SEGMENT_CAPACITY_INVALID", "Segment capacity exceeds offered seats");
    }

    // Database trigger performs final whole-geometry province enforcement.
    await client.query(`update trips set status='published', updated_at=now() where id=$1`, [tripId]);
  });
}
