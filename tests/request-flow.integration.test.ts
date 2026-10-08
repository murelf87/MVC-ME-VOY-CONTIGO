import test,{after,before,beforeEach} from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import type { AuthPrincipal } from "../src/auth/session.js";
import { DomainError } from "../src/errors.js";
import {
  createRideRequest,
  decideRideRequest,
  listOwnRideRequests,
  listTripRideRequests
} from "../src/services/request-service.js";

const {Pool}=pg;
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
const pool=new Pool({connectionString:databaseUrl});

function principal(userId:string,roles:any[]):AuthPrincipal{
  return {sessionId:crypto.randomUUID(),userId,roles,expiresAt:new Date(Date.now()+3600000).toISOString()};
}

async function seed(){
  const driver=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  const p1=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  const p2=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  const otherDriver=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  for(const id of [driver,p1,p2,otherDriver]){
    await pool.query(`insert into profiles(user_id,public_photo_status,identity_status) values($1,'approved','verified')`,[id]);
  }
  await pool.query(`insert into user_roles(user_id,role) values($1,'driver'),($2,'passenger'),($3,'passenger'),($4,'driver')`,[driver,p1,p2,otherDriver]);
  const province=(await pool.query(`
    insert into provinces(code,name,source_name,geom)
    values('REQ','Request Test Province','integration-test',
      ST_Multi(ST_GeomFromText('POLYGON((0 0,10 0,10 10,0 10,0 0))',4326)))
    returning id`)).rows[0].id;
  const vehicle=(await pool.query(`
    insert into vehicles(driver_user_id,make,model,plate,passenger_seats,review_status,documentation_status)
    values($1,'Test','Car','REQ-001',1,'approved','approved') returning id`,[driver])).rows[0].id;
  const trip=(await pool.query(`
    insert into trips(driver_user_id,vehicle_id,province_id,category,kind,leg,status,offered_seats,
      origin_geom,destination_geom,route_geom,route_distance_m,route_duration_s,route_provider,route_provider_ref)
    values($1,$2,$3,'work','single','outbound','published',1,
      ST_SetSRID(ST_Point(1,1),4326),ST_SetSRID(ST_Point(9,9),4326),
      ST_GeomFromText('LINESTRING(1 1,5 5,9 9)',4326),10000,900,'integration-test','request-route')
    returning id`,[driver,vehicle,province])).rows[0].id;
  await pool.query(`
    insert into trip_segments(trip_id,seq,from_stop_seq,to_stop_seq,distance_m,duration_s,capacity)
    values($1,0,0,1,5000,450,1),($1,1,1,2,5000,450,1)`,[trip]);
  return {driver,p1,p2,otherDriver,trip};
}

before(async()=>{await pool.query("select 1 from ride_requests limit 1")});
beforeEach(async()=>{
  await pool.query(`
    truncate table trip_live_state,trip_location_events,private_documents,audit_events,
      route_change_responses,route_change_proposals,quote_snapshots,tariff_versions,
      payment_compensations,bookings,seat_holds,ride_requests,trip_segments,trip_stops,
      trips,vehicles,profiles,user_roles,auth_sessions,auth_challenges,app_users,
      province_dataset_imports,provinces restart identity cascade`);
});
after(async()=>{await pool.end()});

test("passenger creates pending request and can list only own requests",async()=>{
  const s=await seed();
  const request=await createRideRequest(pool,principal(s.p1,["passenger"]),{
    tripId:s.trip,fromSegmentSeq:0,toSegmentSeq:2
  });
  assert.equal(request.status,"pending");
  assert.equal((await listOwnRideRequests(pool,principal(s.p1,["passenger"]))).length,1);
  assert.equal((await listOwnRideRequests(pool,principal(s.p2,["passenger"]))).length,0);
});

test("driver cannot request a seat on own trip",async()=>{
  const s=await seed();
  await assert.rejects(
    ()=>createRideRequest(pool,principal(s.driver,["driver","passenger"]),{
      tripId:s.trip,fromSegmentSeq:0,toSegmentSeq:1
    }),
    (e:unknown)=>e instanceof DomainError&&e.code==="DRIVER_CANNOT_REQUEST_OWN_TRIP"
  );
});

test("only owning driver can view and decide trip requests",async()=>{
  const s=await seed();
  const request=await createRideRequest(pool,principal(s.p1,["passenger"]),{
    tripId:s.trip,fromSegmentSeq:0,toSegmentSeq:1
  });
  await assert.rejects(
    ()=>listTripRideRequests(pool,principal(s.otherDriver,["driver"]),s.trip),
    (e:unknown)=>e instanceof DomainError&&e.code==="TRIP_NOT_OWNED"
  );
  await assert.rejects(
    ()=>decideRideRequest(pool,principal(s.otherDriver,["driver"]),request.id,"accept"),
    (e:unknown)=>e instanceof DomainError&&e.code==="TRIP_NOT_OWNED"
  );
});

test("driver acceptance atomically creates hold and payment_pending state",async()=>{
  const s=await seed();
  const request=await createRideRequest(pool,principal(s.p1,["passenger"]),{
    tripId:s.trip,fromSegmentSeq:0,toSegmentSeq:2
  });
  const result=await decideRideRequest(pool,principal(s.driver,["driver"]),request.id,"accept");
  assert.equal(result.request.status,"payment_pending");
  assert.ok(result.hold?.id);
  const db=await pool.query(`
    select r.status,h.status as hold_status
      from ride_requests r join seat_holds h on h.request_id=r.id
     where r.id=$1`,[request.id]);
  assert.equal(db.rows[0].status,"payment_pending");
  assert.equal(db.rows[0].hold_status,"active");
});

test("concurrent driver acceptance cannot oversell last seat",async()=>{
  const s=await seed();
  const r1=await createRideRequest(pool,principal(s.p1,["passenger"]),{
    tripId:s.trip,fromSegmentSeq:0,toSegmentSeq:2
  });
  const r2=await createRideRequest(pool,principal(s.p2,["passenger"]),{
    tripId:s.trip,fromSegmentSeq:0,toSegmentSeq:2
  });
  const results=await Promise.allSettled([
    decideRideRequest(pool,principal(s.driver,["driver"]),r1.id,"accept"),
    decideRideRequest(pool,principal(s.driver,["driver"]),r2.id,"accept")
  ]);
  assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(results.filter(x=>x.status==="rejected").length,1);
  const holds=await pool.query(`select count(*)::int n from seat_holds where status='active'`);
  assert.equal(holds.rows[0].n,1);
});

test("driver can reject a pending request without creating hold",async()=>{
  const s=await seed();
  const request=await createRideRequest(pool,principal(s.p1,["passenger"]),{
    tripId:s.trip,fromSegmentSeq:0,toSegmentSeq:1
  });
  const result=await decideRideRequest(pool,principal(s.driver,["driver"]),request.id,"reject");
  assert.equal(result.request.status,"rejected");
  assert.equal(result.hold,null);
  const holds=await pool.query(`select count(*)::int n from seat_holds`);
  assert.equal(holds.rows[0].n,0);
});

test("duplicate open request for same exact range is rejected",async()=>{
  const s=await seed();
  const p=principal(s.p1,["passenger"]);
  await createRideRequest(pool,p,{tripId:s.trip,fromSegmentSeq:0,toSegmentSeq:1});
  await assert.rejects(
    ()=>createRideRequest(pool,p,{tripId:s.trip,fromSegmentSeq:0,toSegmentSeq:1}),
    (e:unknown)=>e instanceof DomainError&&e.code==="DUPLICATE_OPEN_REQUEST"
  );
});
