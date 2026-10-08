import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import {
  getTripLocationForViewer,
  listApproximateLiveTrips,
  recordDriverLocation
} from "../src/live/tracking-service.js";
import { DomainError } from "../src/errors.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
const pool = new Pool({ connectionString: databaseUrl });

async function seed() {
  const driver = (await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  const passenger = (await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  const stranger = (await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  for (const id of [driver,passenger,stranger]) {
    await pool.query(`insert into profiles(user_id,public_photo_status,identity_status) values($1,'approved','verified')`,[id]);
  }
  await pool.query(`insert into user_roles(user_id,role) values($1,'driver'),($2,'passenger'),($3,'passenger')`,[driver,passenger,stranger]);

  const province = (await pool.query(`
    insert into provinces(code,name,source_name,geom)
    values('LIV','Live Test Province','integration-test',
      ST_Multi(ST_GeomFromText('POLYGON((-10 35,5 35,5 45,-10 45,-10 35))',4326)))
    returning id`)).rows[0].id;

  const vehicle = (await pool.query(`
    insert into vehicles(driver_user_id,make,model,plate,passenger_seats,review_status,documentation_status)
    values($1,'Test','Car','LIVE-001',4,'approved','approved') returning id`,[driver])).rows[0].id;

  const trip = (await pool.query(`
    insert into trips(
      driver_user_id,vehicle_id,province_id,category,kind,leg,status,
      offered_seats,origin_geom,destination_geom,route_geom,route_distance_m,route_duration_s,
      route_provider,route_provider_ref
    ) values(
      $1,$2,$3,'work','single','outbound','active',4,
      ST_SetSRID(ST_Point(-5.99,37.38),4326),
      ST_SetSRID(ST_Point(-5.90,37.42),4326),
      ST_GeomFromText('LINESTRING(-5.99 37.38,-5.95 37.40,-5.90 37.42)',4326),
      10000,900,'integration-test','live-route'
    ) returning id`,[driver,vehicle,province])).rows[0].id;

  const request = (await pool.query(`
    insert into ride_requests(trip_id,passenger_user_id,from_segment_seq,to_segment_seq,status)
    values($1,$2,0,1,'confirmed') returning id`,[trip,passenger])).rows[0].id;
  await pool.query(`
    insert into bookings(request_id,provider_payment_id,amount_cents,status)
    values($1,$2,100,'confirmed')`,[request,`live-pay-${crypto.randomUUID()}`]);

  return { driver,passenger,stranger,province,trip };
}

before(async () => {
  await pool.query("select 1 from trip_live_state limit 1");
});

beforeEach(async () => {
  await pool.query(`
    truncate table
      trip_live_state,trip_location_events,private_documents,audit_events,
      route_change_responses,route_change_proposals,quote_snapshots,tariff_versions,
      payment_compensations,bookings,seat_holds,ride_requests,trip_segments,trip_stops,
      trips,vehicles,profiles,user_roles,auth_sessions,auth_challenges,app_users,
      province_dataset_imports,provinces
    restart identity cascade`);
});

after(async () => { await pool.end(); });

test("only the actual driver can publish live location", async () => {
  const s=await seed();
  await assert.rejects(
    () => recordDriverLocation(pool,{
      eventId:crypto.randomUUID(),tripId:s.trip,driverUserId:s.stranger,
      recordedAt:new Date().toISOString(),latitude:37.3891,longitude:-5.9845
    }),
    (error: unknown) => error instanceof DomainError && error.code==="LOCATION_FORBIDDEN"
  );
});

test("confirmed passenger and driver see precise location while stranger sees approximate location", async () => {
  const s=await seed();
  await recordDriverLocation(pool,{
    eventId:crypto.randomUUID(),tripId:s.trip,driverUserId:s.driver,
    recordedAt:new Date().toISOString(),latitude:37.389123,longitude:-5.984567,
    accuracyM:8,speedMps:12,headingDegrees:90
  });

  const driver=await getTripLocationForViewer(pool,s.trip,s.driver);
  const passenger=await getTripLocationForViewer(pool,s.trip,s.passenger);
  const stranger=await getTripLocationForViewer(pool,s.trip,s.stranger);
  const publicView=await getTripLocationForViewer(pool,s.trip,null);

  assert.equal(driver?.precision,"precise");
  assert.equal(passenger?.precision,"precise");
  assert.equal(passenger?.latitude,37.389123);
  assert.equal(passenger?.speedMps,12);
  assert.equal(stranger?.precision,"approximate");
  assert.equal(publicView?.precision,"approximate");
  assert.equal(stranger?.speedMps,undefined);
  assert.notEqual(stranger?.latitude,37.389123);
});

test("older out-of-order GPS event is stored but cannot replace current live state", async () => {
  const s=await seed();
  const latestId=crypto.randomUUID();
  const oldId=crypto.randomUUID();
  const now=Date.now();

  const latest=await recordDriverLocation(pool,{
    eventId:latestId,tripId:s.trip,driverUserId:s.driver,
    recordedAt:new Date(now-1000).toISOString(),latitude:37.40,longitude:-5.98
  });
  const older=await recordDriverLocation(pool,{
    eventId:oldId,tripId:s.trip,driverUserId:s.driver,
    recordedAt:new Date(now-5000).toISOString(),latitude:37.20,longitude:-5.70
  });

  assert.equal(latest.acceptedAsCurrent,true);
  assert.equal(older.acceptedAsCurrent,false);
  const visible=await getTripLocationForViewer(pool,s.trip,s.driver);
  assert.equal(visible?.latitude,37.40);
  assert.equal(visible?.longitude,-5.98);
});

test("duplicate event id is idempotent", async () => {
  const s=await seed();
  const eventId=crypto.randomUUID();
  const input={
    eventId,tripId:s.trip,driverUserId:s.driver,
    recordedAt:new Date().toISOString(),latitude:37.40,longitude:-5.98
  };
  const first=await recordDriverLocation(pool,input);
  const second=await recordDriverLocation(pool,input);
  assert.equal(first.duplicate,false);
  assert.equal(second.duplicate,true);
  assert.equal(first.eventRowId,second.eventRowId);
});

test("public live map returns only approximate active-trip positions", async () => {
  const s=await seed();
  await recordDriverLocation(pool,{
    eventId:crypto.randomUUID(),tripId:s.trip,driverUserId:s.driver,
    recordedAt:new Date().toISOString(),latitude:37.389123,longitude:-5.984567
  });
  const rows=await listApproximateLiveTrips(pool,s.province);
  assert.equal(rows.length,1);
  assert.equal(rows[0]?.tripId,s.trip);
  assert.notEqual(rows[0]?.latitude,37.389123);
});

test("stale GPS is explicitly marked", async () => {
  const s=await seed();
  await recordDriverLocation(pool,{
    eventId:crypto.randomUUID(),tripId:s.trip,driverUserId:s.driver,
    recordedAt:new Date(Date.now()-120000).toISOString(),latitude:37.40,longitude:-5.98
  });
  const location=await getTripLocationForViewer(pool,s.trip,s.passenger,60);
  assert.equal(location?.stale,true);
  assert.ok((location?.ageSeconds ?? 0) >= 119);
});
