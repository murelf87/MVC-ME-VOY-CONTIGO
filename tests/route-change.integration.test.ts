import test,{after,before,beforeEach} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import type { AuthPrincipal } from "../src/auth/session.js";
import { DevLocalMapsProvider } from "../src/dev/dev-maps-provider.js";
import { DomainError } from "../src/errors.js";
import { recordDriverLocation } from "../src/live/tracking-service.js";
import { createRideRequest } from "../src/services/request-service.js";
import {
  decideRouteChange,listOwnRouteChanges,requestRouteChange,respondRouteChange,searchDetourCandidates
} from "../src/services/route-change-service.js";
import { createTripDraftWithServerRoute } from "../src/services/trip-draft-service.js";
import { tripEtaForViewer } from "../src/services/trip-progress-service.js";

const {Pool}=pg;
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
const pool=new Pool({connectionString:databaseUrl});
const maps=new DevLocalMapsProvider();

function auth(userId:string,roles:any[]):AuthPrincipal{
  return {sessionId:crypto.randomUUID(),userId,roles,expiresAt:new Date(Date.now()+3600000).toISOString()};
}
const code=(c:string)=>(e:unknown)=>e instanceof DomainError&&e.code===c;

// Dos Hermanas -> Sevilla Santa Justa, with an optional stop half way.
const ORIGIN={latitude:37.28287,longitude:-5.92088};
const DEST={latitude:37.39176,longitude:-5.97556};
const MID={latitude:(ORIGIN.latitude+DEST.latitude)/2,longitude:(ORIGIN.longitude+DEST.longitude)/2};
// About 800 m east of the straight route, one near the start and one near the end.
const PICKUP={latitude:37.31,longitude:-5.925};
const DROPOFF={latitude:37.37,longitude:-5.955};
const along=(f:number)=>({latitude:ORIGIN.latitude+(DEST.latitude-ORIGIN.latitude)*f,longitude:ORIGIN.longitude+(DEST.longitude-ORIGIN.longitude)*f});

async function seed(opts:{maxDetourM?:number;flexibilityMinutes?:number;mid?:boolean;seats?:number}={}){
  const ids:string[]=[];
  for(const name of ["Ana","Luis","Marta","Eva"]){
    const id=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
    await pool.query(`insert into profiles(user_id,display_name,public_photo_status,identity_status) values($1,$2,'approved','verified')`,[id,name]);
    ids.push(id);
  }
  const [driver,p1,p2,p3]=ids as [string,string,string,string];
  const province=(await pool.query(`
    insert into provinces(code,name,source_name,geom)
    values('SEV','Sevilla test','integration-test',
      ST_Multi(ST_GeomFromText('POLYGON((-6.2 37.0,-5.6 37.0,-5.6 37.6,-6.2 37.6,-6.2 37.0))',4326)))
    returning id`)).rows[0].id;
  const vehicle=(await pool.query(`
    insert into vehicles(driver_user_id,make,model,plate,passenger_seats,review_status,documentation_status,
      vehicle_photo_status,insurance_status,insurance_expires_on)
    values($1,'Seat','Leon','RC-001',4,'approved','approved','approved','approved',current_date+365) returning id`,[driver])).rows[0].id;
  const trip=await createTripDraftWithServerRoute(pool,auth(driver,["driver"]),maps,{
    vehicleId:vehicle,provinceId:province,category:"work",leg:"outbound",
    departureAt:new Date(Date.now()+3600000).toISOString(),
    flexibilityMinutes:opts.flexibilityMinutes??0,maxDetourM:opts.maxDetourM??6000,offeredSeats:opts.seats??3,
    origin:ORIGIN,destination:DEST,...(opts.mid?{intermediates:[MID]}:{})
  });
  await pool.query(`update trips set status='published' where id=$1`,[trip.id]);
  return {driver,p1,p2,p3,province,trip:trip.id as string};
}

async function confirmedBooking(tripId:string,passenger:string,from:number,to:number){
  const r=(await pool.query(`insert into ride_requests(trip_id,passenger_user_id,from_segment_seq,to_segment_seq,status)
    values($1,$2,$3,$4,'confirmed') returning id`,[tripId,passenger,from,to])).rows[0].id;
  const b=(await pool.query(`insert into bookings(request_id,provider_payment_id,amount_cents,status)
    values($1,$2,0,'confirmed') returning id`,[r,`rc-${crypto.randomUUID()}`])).rows[0].id;
  return {request:r as string,booking:b as string};
}

async function startAt(tripId:string,driver:string,f:number,ageSeconds=0){
  await pool.query(`update trips set status='active' where id=$1`,[tripId]);
  return moveTo(tripId,driver,f,ageSeconds);
}
async function moveTo(tripId:string,driver:string,f:number,ageSeconds=0){
  const p=along(f);
  return recordDriverLocation(pool,{eventId:crypto.randomUUID(),tripId,driverUserId:driver,
    recordedAt:new Date(Date.now()-ageSeconds*1000).toISOString(),latitude:p.latitude,longitude:p.longitude});
}
const counts=async(tripId:string)=>(await pool.query(`
  select (select count(*)::int from trip_stops where trip_id=$1) as stops,
         (select count(*)::int from trip_segments where trip_id=$1) as segments,
         (select route_version from trips where id=$1) as version`,[tripId])).rows[0];

before(async()=>{await pool.query("select 1 from route_change_responses limit 1")});
beforeEach(async()=>{
  await pool.query(`
    truncate table user_notifications,audit_events,route_change_responses,route_change_proposals,quote_snapshots,
      bookings,seat_holds,ride_requests,trip_live_state,trip_location_events,trip_segments,trip_stops,trips,
      vehicles,profiles,user_roles,app_users,provinces restart identity cascade`);
});
after(async()=>{await pool.end()});

test("a trip whose driver accepts no detour refuses off-route pickups",async()=>{
  const s=await seed({maxDetourM:0});
  await assert.rejects(()=>requestRouteChange(pool,maps,auth(s.p1,["passenger"]),{tripId:s.trip,pickup:PICKUP,dropoff:DROPOFF}),
    code("DETOUR_NOT_ALLOWED"));
});

test("a detour longer than the driver's maximum is refused with the real added distance",async()=>{
  const s=await seed({maxDetourM:100});
  await assert.rejects(()=>requestRouteChange(pool,maps,auth(s.p1,["passenger"]),{tripId:s.trip,pickup:PICKUP,dropoff:DROPOFF}),
    (e:unknown)=>e instanceof DomainError&&e.code==="DETOUR_TOO_LONG"&&(e.details as any).addedDistanceM>100);
});

test("with nobody else on board the driver's yes applies the new route and holds the seat",async()=>{
  const s=await seed();
  const asked=await requestRouteChange(pool,maps,auth(s.p1,["passenger"]),
    {tripId:s.trip,pickup:PICKUP,dropoff:DROPOFF,pickupLabel:"Calle Real"});
  assert.equal(asked.status,"awaiting_driver");
  assert.ok(asked.added_distance_m>0&&asked.added_distance_m<=6000);
  await assert.rejects(()=>requestRouteChange(pool,maps,auth(s.p1,["passenger"]),{tripId:s.trip,pickup:PICKUP,dropoff:DROPOFF}),
    code("DUPLICATE_OPEN_ROUTE_CHANGE"));
  await assert.rejects(()=>decideRouteChange(pool,auth(s.p2,["driver"]),asked.id,"accept"),code("TRIP_NOT_OWNED"));

  const out=await decideRouteChange(pool,auth(s.driver,["driver"]),asked.id,"accept");
  assert.equal(out.status,"applied");
  assert.deepEqual(await counts(s.trip),{stops:4,segments:3,version:2});
  const req=(await pool.query(`select from_segment_seq,to_segment_seq,status from ride_requests where id=$1`,[(out as any).requestId])).rows[0];
  assert.deepEqual(req,{from_segment_seq:1,to_segment_seq:2,status:"payment_pending"});
  const stop=(await pool.query(`select kind,label from trip_stops where trip_id=$1 and seq=1`,[s.trip])).rows[0];
  assert.deepEqual(stop,{kind:"pickup",label:"Calle Real"});
  const kinds=(await pool.query(`select kind from user_notifications where user_id=$1`,[s.p1])).rows.map(r=>r.kind);
  assert.ok(kinds.includes("route_change.applied"));
});

test("a confirmed passenger delayed beyond the flexibility must accept, and one no blocks the change",async()=>{
  const s=await seed({flexibilityMinutes:0});
  await confirmedBooking(s.trip,s.p2,0,1);
  const asked=await requestRouteChange(pool,maps,auth(s.p1,["passenger"]),{tripId:s.trip,pickup:PICKUP,dropoff:DROPOFF});
  const d=await decideRouteChange(pool,auth(s.driver,["driver"]),asked.id,"accept");
  assert.equal(d.status,"awaiting_passengers");
  const mine=await listOwnRouteChanges(pool,auth(s.p2,["passenger"]));
  assert.equal(mine.toAnswer.length,1);
  assert.ok(mine.toAnswer[0].extra_delay_s>0);
  await assert.rejects(()=>respondRouteChange(pool,auth(s.p3,["passenger"]),asked.id,"accept"),code("ROUTE_CHANGE_NOT_ASKED"));

  const r=await respondRouteChange(pool,auth(s.p2,["passenger"]),asked.id,"reject");
  assert.equal(r.status,"rejected");
  assert.deepEqual(await counts(s.trip),{stops:2,segments:1,version:1});
});

test("when every affected passenger accepts, their own booking is renumbered onto the new route",async()=>{
  const s=await seed({flexibilityMinutes:0});
  const b=await confirmedBooking(s.trip,s.p2,0,1);
  const asked=await requestRouteChange(pool,maps,auth(s.p1,["passenger"]),{tripId:s.trip,pickup:PICKUP,dropoff:DROPOFF});
  await decideRouteChange(pool,auth(s.driver,["driver"]),asked.id,"accept");
  const r=await respondRouteChange(pool,auth(s.p2,["passenger"]),asked.id,"accept");
  assert.equal(r.status,"applied");
  const moved=(await pool.query(`select from_segment_seq,to_segment_seq from ride_requests where id=$1`,[b.request])).rows[0];
  assert.deepEqual(moved,{from_segment_seq:0,to_segment_seq:3});
});

test("a generous flexibility applies the change without asking anyone",async()=>{
  const s=await seed({flexibilityMinutes:60});
  await confirmedBooking(s.trip,s.p2,0,1);
  const asked=await requestRouteChange(pool,maps,auth(s.p1,["passenger"]),{tripId:s.trip,pickup:PICKUP,dropoff:DROPOFF});
  const d=await decideRouteChange(pool,auth(s.driver,["driver"]),asked.id,"accept");
  assert.equal(d.status,"applied");
});

test("a full segment blocks the detour",async()=>{
  const s=await seed({seats:1});
  await confirmedBooking(s.trip,s.p2,0,1);
  await assert.rejects(()=>requestRouteChange(pool,maps,auth(s.p1,["passenger"]),{tripId:s.trip,pickup:PICKUP,dropoff:DROPOFF}),
    code("NO_CAPACITY_ON_SEGMENT"));
});

test("while moving: needs a fresh position and a pickup the car has not reached",async()=>{
  const s=await seed();
  await startAt(s.trip,s.driver,0.05,300);
  await assert.rejects(()=>requestRouteChange(pool,maps,auth(s.p1,["passenger"]),{tripId:s.trip,pickup:PICKUP,dropoff:DROPOFF}),
    code("LIVE_POSITION_STALE"));
  await moveTo(s.trip,s.driver,0.6);
  await assert.rejects(()=>requestRouteChange(pool,maps,auth(s.p1,["passenger"]),{tripId:s.trip,pickup:PICKUP,dropoff:DROPOFF}),
    code("PICKUP_ALREADY_PASSED"));
  await moveTo(s.trip,s.driver,0.1);
  // Positions are ordered by GPS time, so the newer 10% fix replaces the 60% one.
  const asked=await requestRouteChange(pool,maps,auth(s.p1,["passenger"]),{tripId:s.trip,pickup:PICKUP,dropoff:DROPOFF});
  const out=await decideRouteChange(pool,auth(s.driver,["driver"]),asked.id,"accept");
  assert.equal(out.status,"applied");
});

test("an on-route stop already passed by the moving car cannot be booked",async()=>{
  const s=await seed({mid:true});
  await startAt(s.trip,s.driver,0.7);
  await assert.rejects(()=>createRideRequest(pool,auth(s.p1,["passenger"]),{tripId:s.trip,fromSegmentSeq:1,toSegmentSeq:2}),
    code("PICKUP_ALREADY_PASSED"));
  await moveTo(s.trip,s.driver,0.3);
  const r=await createRideRequest(pool,auth(s.p1,["passenger"]),{tripId:s.trip,fromSegmentSeq:1,toSegmentSeq:2});
  assert.equal(r.status,"pending");
});

test("detour search lists trips that pass close enough and are still ahead",async()=>{
  const s=await seed();
  const found=await searchDetourCandidates(pool,{provinceId:s.province,origin:PICKUP,destination:DROPOFF});
  assert.equal(found.length,1);
  assert.ok(found[0]!.pickupOffRouteM>0);
  const reversed=await searchDetourCandidates(pool,{provinceId:s.province,origin:DROPOFF,destination:PICKUP});
  assert.equal(reversed.length,0);
});

test("ETA counts down to the passenger's pickup and sends a single arriving notice",async()=>{
  const s=await seed({mid:true});
  const b=await confirmedBooking(s.trip,s.p1,1,2);
  await assert.rejects(()=>tripEtaForViewer(pool,auth(s.p3,["passenger"]),s.trip),code("TRIP_ETA_FORBIDDEN"));

  await startAt(s.trip,s.driver,0.25);
  const far=await tripEtaForViewer(pool,auth(s.p1,["passenger"]),s.trip);
  assert.equal(far.live,true);
  assert.ok(far.me!.pickupEtaS!>0&&far.me!.dropoffEtaS!>far.me!.pickupEtaS!);
  assert.equal(far.me!.arriving,false);
  assert.equal(far.stops.length,0,"a passenger does not get the driver's stop list");

  await moveTo(s.trip,s.driver,0.49);
  const near=await tripEtaForViewer(pool,auth(s.p1,["passenger"]),s.trip);
  assert.ok(near.me!.pickupEtaS!<far.me!.pickupEtaS!);
  assert.equal(near.me!.arriving,true);
  await moveTo(s.trip,s.driver,0.495);
  const notices=(await pool.query(`select count(*)::int as n from user_notifications where user_id=$1 and kind='trip.driver_arriving'`,[s.p1])).rows[0].n;
  assert.equal(notices,1);
  assert.ok((await pool.query(`select arrival_notified_at from bookings where id=$1`,[b.booking])).rows[0].arrival_notified_at);

  const driverView=await tripEtaForViewer(pool,auth(s.driver,["driver"]),s.trip);
  assert.equal(driverView.stops.length,3);
  assert.equal(driverView.stops[0]!.passed,true);

  await moveTo(s.trip,s.driver,0.5,600);
  // The newest fix by GPS time is still the 0.495 one, so the view stays live; an old fix never replaces it.
  const still=await tripEtaForViewer(pool,auth(s.p1,["passenger"]),s.trip);
  assert.equal(still.live,true);
});

test("an old position is reported as stale and gives no ETA",async()=>{
  const s=await seed({mid:true});
  await confirmedBooking(s.trip,s.p1,1,2);
  await startAt(s.trip,s.driver,0.25,300);
  const v=await tripEtaForViewer(pool,auth(s.p1,["passenger"]),s.trip);
  assert.equal(v.live,false);
  assert.equal(v.stale,true);
  assert.equal(v.me!.pickupEtaS,null);
});
