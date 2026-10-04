import test,{after,before,beforeEach} from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { searchPublishedTrips } from "../src/services/trip-search-service.js";

const {Pool}=pg;
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
const pool=new Pool({connectionString:databaseUrl});

async function seed(){
  const driver=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  await pool.query(`insert into profiles(user_id,display_name,public_photo_status,identity_status) values($1,'Conductor Test','approved','verified')`,[driver]);
  await pool.query(`insert into user_roles(user_id,role) values($1,'driver')`,[driver]);
  const province=(await pool.query(`
    insert into provinces(code,name,source_name,geom)
    values('SRC','Search Province','integration-test',
      ST_Multi(ST_GeomFromText('POLYGON((-10 35,5 35,5 45,-10 45,-10 35))',4326)))
    returning id`)).rows[0].id;
  const otherProvince=(await pool.query(`
    insert into provinces(code,name,source_name,geom)
    values('OTH','Other Province','integration-test',
      ST_Multi(ST_GeomFromText('POLYGON((10 35,20 35,20 45,10 45,10 35))',4326)))
    returning id`)).rows[0].id;
  const vehicle=(await pool.query(`
    insert into vehicles(driver_user_id,make,model,plate,passenger_seats,review_status,documentation_status)
    values($1,'Test','Car','SRC-001',2,'approved','approved') returning id`,[driver])).rows[0].id;

  const trip=(await pool.query(`
    insert into trips(driver_user_id,vehicle_id,province_id,category,kind,leg,status,departure_at,
      offered_seats,origin_geom,destination_geom,route_geom,route_distance_m,route_duration_s,
      route_provider,route_provider_ref)
    values($1,$2,$3,'work','single','outbound','published',now()+interval '2 hours',2,
      ST_SetSRID(ST_Point(-5.99,37.38),4326),ST_SetSRID(ST_Point(-5.80,37.50),4326),
      ST_GeomFromText('LINESTRING(-5.99 37.38,-5.90 37.44,-5.80 37.50)',4326),
      20000,1800,'integration-test','search-route') returning id`,[driver,vehicle,province])).rows[0].id;
  await pool.query(`
    insert into trip_stops(trip_id,seq,kind,label,geom) values
      ($1,0,'origin','A',ST_SetSRID(ST_Point(-5.99,37.38),4326)),
      ($1,1,'stop','B',ST_SetSRID(ST_Point(-5.90,37.44),4326)),
      ($1,2,'destination','C',ST_SetSRID(ST_Point(-5.80,37.50),4326))`,[trip]);
  await pool.query(`
    insert into trip_segments(trip_id,seq,from_stop_seq,to_stop_seq,distance_m,duration_s,capacity)
    values($1,0,0,1,9000,800,2),($1,1,1,2,11000,1000,2)`,[trip]);
  return {driver,province,otherProvince,trip};
}

before(async()=>{await pool.query("select postgis_full_version()")});
beforeEach(async()=>{
  await pool.query(`
    truncate table trip_live_state,trip_location_events,private_documents,audit_events,
      route_change_acceptances,route_change_proposals,quote_snapshots,tariff_versions,
      payment_compensations,bookings,seat_holds,ride_requests,trip_segments,trip_stops,
      trips,vehicles,profiles,user_roles,auth_sessions,auth_challenges,app_users,
      province_dataset_imports,provinces restart identity cascade`);
});
after(async()=>{await pool.end()});

test("search returns correct ordered stop pair and road segment totals",async()=>{
  const s=await seed();
  const results=await searchPublishedTrips(pool,{
    provinceId:s.province,
    originLatitude:37.3805,originLongitude:-5.9905,
    destinationLatitude:37.4995,destinationLongitude:-5.8005,
    radiusM:1000
  });
  assert.equal(results.length,1);
  assert.equal(results[0]?.tripId,s.trip);
  assert.equal(results[0]?.fromSegmentSeq,0);
  assert.equal(results[0]?.toSegmentSeq,2);
  assert.equal(results[0]?.roadDistanceM,20000);
  assert.equal(results[0]?.estimatedDurationS,1800);
  assert.equal(results[0]?.availableSeats,2);
});

test("search rejects reverse direction even when both places are close to stops",async()=>{
  const s=await seed();
  const results=await searchPublishedTrips(pool,{
    provinceId:s.province,
    originLatitude:37.50,originLongitude:-5.80,
    destinationLatitude:37.38,destinationLongitude:-5.99,
    radiusM:1000
  });
  assert.equal(results.length,0);
});

test("search is strictly scoped to requested province",async()=>{
  const s=await seed();
  const results=await searchPublishedTrips(pool,{
    provinceId:s.otherProvince,
    originLatitude:37.38,originLongitude:-5.99,
    destinationLatitude:37.50,destinationLongitude:-5.80,
    radiusM:1000
  });
  assert.equal(results.length,0);
});

test("search excludes trip when every seat in requested segment range is held",async()=>{
  const s=await seed();
  for(let i=0;i<2;i++){
    const passenger=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
    const request=(await pool.query(`
      insert into ride_requests(trip_id,passenger_user_id,from_segment_seq,to_segment_seq,status)
      values($1,$2,0,2,'payment_pending') returning id`,[s.trip,passenger])).rows[0].id;
    await pool.query(`insert into seat_holds(request_id,status,expires_at) values($1,'active',now()+interval '10 minutes')`,[request]);
  }
  const results=await searchPublishedTrips(pool,{
    provinceId:s.province,
    originLatitude:37.38,originLongitude:-5.99,
    destinationLatitude:37.50,destinationLongitude:-5.80,
    radiusM:1000
  });
  assert.equal(results.length,0);
});

test("search reports minimum remaining seats across all requested segments",async()=>{
  const s=await seed();
  const passenger=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  const request=(await pool.query(`
    insert into ride_requests(trip_id,passenger_user_id,from_segment_seq,to_segment_seq,status)
    values($1,$2,0,1,'payment_pending') returning id`,[s.trip,passenger])).rows[0].id;
  await pool.query(`insert into seat_holds(request_id,status,expires_at) values($1,'active',now()+interval '10 minutes')`,[request]);

  const results=await searchPublishedTrips(pool,{
    provinceId:s.province,
    originLatitude:37.38,originLongitude:-5.99,
    destinationLatitude:37.50,destinationLongitude:-5.80,
    radiusM:1000
  });
  assert.equal(results[0]?.availableSeats,1);
});
