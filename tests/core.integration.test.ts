import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { publishTrip } from "../src/services/trip-service.js";
import { createSeatHold, confirmProviderPayment } from "../src/services/reservation-service.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
const pool = new Pool({ connectionString: databaseUrl });

async function seedBase(routeWkt: string) {
  const user = (await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  await pool.query(`insert into user_roles(user_id,role) values($1,'driver')`, [user]);
  await pool.query(`insert into profiles(user_id,public_photo_status,identity_status) values($1,'approved','verified')`, [user]);

  const passenger = (await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  await pool.query(`insert into user_roles(user_id,role) values($1,'passenger')`, [passenger]);
  await pool.query(`insert into profiles(user_id,public_photo_status,identity_status) values($1,'approved','verified')`, [passenger]);

  const province = (await pool.query(`
    insert into provinces(code,name,source_name,geom)
    values('TEST','Synthetic Test Province','integration-test',
      ST_Multi(ST_GeomFromText('POLYGON((0 0,10 0,10 10,0 10,0 0))',4326)))
    returning id`)).rows[0].id;

  const vehicle = (await pool.query(`
    insert into vehicles(driver_user_id,make,model,plate,passenger_seats,review_status,documentation_status)
    values($1,'Test','Car','TEST-001',1,'approved','approved') returning id`, [user])).rows[0].id;

  const trip = (await pool.query(`
    insert into trips(
      driver_user_id,vehicle_id,province_id,category,kind,leg,status,
      offered_seats,origin_geom,destination_geom,route_geom,route_distance_m,route_duration_s,
      route_provider,route_provider_ref
    ) values(
      $1,$2,$3,'work','single','outbound','draft',1,
      ST_SetSRID(ST_Point(1,1),4326),ST_SetSRID(ST_Point(9,9),4326),
      ST_GeomFromText($4,4326),10000,900,'integration-test','route-1'
    ) returning id`, [user,vehicle,province,routeWkt])).rows[0].id;

  await pool.query(`
    insert into trip_stops(trip_id,seq,kind,label,geom) values
      ($1,0,'origin','A',ST_SetSRID(ST_Point(1,1),4326)),
      ($1,1,'stop','B',ST_SetSRID(ST_Point(5,5),4326)),
      ($1,2,'destination','C',ST_SetSRID(ST_Point(9,9),4326))`, [trip]);
  await pool.query(`
    insert into trip_segments(trip_id,seq,from_stop_seq,to_stop_seq,distance_m,duration_s,capacity) values
      ($1,0,0,1,5000,450,1),
      ($1,1,1,2,5000,450,1)`, [trip]);

  return { user, passenger, province, vehicle, trip };
}

async function newAcceptedRequest(trip: string, passenger: string, from: number, to: number) {
  return (await pool.query(`
    insert into ride_requests(trip_id,passenger_user_id,from_segment_seq,to_segment_seq,status)
    values($1,$2,$3,$4,'accepted') returning id`, [trip,passenger,from,to])).rows[0].id as string;
}

before(async () => {
  await pool.query("select postgis_full_version()");
});

beforeEach(async () => {
  await pool.query(`
    truncate table
      audit_events, route_change_acceptances, route_change_proposals, quote_snapshots,
      tariff_versions, payment_compensations, bookings, seat_holds, ride_requests,
      trip_segments, trip_stops, trips, vehicles, profiles, user_roles, app_users, provinces
    restart identity cascade`);
});

after(async () => {
  await pool.end();
});

test("whole route leaving province is rejected even if endpoints are inside", async () => {
  const { trip } = await seedBase("LINESTRING(1 1,11 5,9 9)");
  await assert.rejects(() => publishTrip(pool, trip), /MVC_ROUTE_OUTSIDE_PROVINCE/);
});

test("fully contained routed geometry can publish", async () => {
  const { trip } = await seedBase("LINESTRING(1 1,5 5,9 9)");
  await publishTrip(pool, trip);
  const row = (await pool.query("select status from trips where id=$1",[trip])).rows[0];
  assert.equal(row.status, "published");
});

test("concurrent overlapping requests cannot oversell a one-seat segment", async () => {
  const { trip, passenger } = await seedBase("LINESTRING(1 1,5 5,9 9)");
  await publishTrip(pool, trip);
  const passenger2 = (await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  const r1 = await newAcceptedRequest(trip, passenger, 0, 2);
  const r2 = await newAcceptedRequest(trip, passenger2, 0, 2);

  const results = await Promise.allSettled([createSeatHold(pool,r1), createSeatHold(pool,r2)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected").length, 1);
});

test("non-overlapping segment requests may coexist", async () => {
  const { trip, passenger } = await seedBase("LINESTRING(1 1,5 5,9 9)");
  await publishTrip(pool, trip);
  const passenger2 = (await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  const r1 = await newAcceptedRequest(trip, passenger, 0, 1);
  const r2 = await newAcceptedRequest(trip, passenger2, 1, 2);
  const [h1,h2] = await Promise.all([createSeatHold(pool,r1), createSeatHold(pool,r2)]);
  assert.ok(h1);
  assert.ok(h2);
});

test("late provider payment creates compensation and no booking", async () => {
  const { trip, passenger } = await seedBase("LINESTRING(1 1,5 5,9 9)");
  await publishTrip(pool, trip);
  const request = await newAcceptedRequest(trip, passenger, 0, 2);
  await createSeatHold(pool, request);
  await pool.query(`update seat_holds set expires_at=now()-interval '1 second' where request_id=$1`, [request]);

  const result = await confirmProviderPayment(pool, {
    requestId: request,
    providerPaymentId: "pay_late_1",
    amountCents: 500
  });
  assert.equal(result.status, "compensation_required");
  const b = await pool.query(`select count(*)::int as n from bookings where request_id=$1`, [request]);
  assert.equal(b.rows[0].n, 0);
  const rq = await pool.query(`select status from ride_requests where id=$1`, [request]);
  assert.equal(rq.rows[0].status, "payment_late");
});

test("repeated provider payment is idempotent", async () => {
  const { trip, passenger } = await seedBase("LINESTRING(1 1,5 5,9 9)");
  await publishTrip(pool, trip);
  const request = await newAcceptedRequest(trip, passenger, 0, 2);
  await createSeatHold(pool, request);

  const a = await confirmProviderPayment(pool, {
    requestId: request, providerPaymentId: "pay_same_1", amountCents: 500
  });
  const b = await confirmProviderPayment(pool, {
    requestId: request, providerPaymentId: "pay_same_1", amountCents: 500
  });
  assert.equal(a.status, "confirmed");
  assert.equal(b.status, "confirmed");
  if (a.status === "confirmed" && b.status === "confirmed") assert.equal(a.bookingId,b.bookingId);

  const count = await pool.query(`select count(*)::int as n from bookings where request_id=$1`, [request]);
  assert.equal(count.rows[0].n, 1);
});
