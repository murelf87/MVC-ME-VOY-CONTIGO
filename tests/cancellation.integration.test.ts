import test,{after,before,beforeEach} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import type { AuthPrincipal } from "../src/auth/session.js";
import { DomainError } from "../src/errors.js";
import { createRideRequest, decideRideRequest } from "../src/services/request-service.js";
import { confirmProviderPayment } from "../src/services/reservation-service.js";
import {
  adminActivateCancellationPolicy,
  adminCreateCancellationPolicy,
  adminListPendingRefunds,
  cancelOwnRideRequest,
  cancelOwnTrip
} from "../src/services/cancellation-service.js";

const {Pool}=pg;
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
const pool=new Pool({connectionString:databaseUrl});

function auth(userId:string,roles:any[]):AuthPrincipal{
  return {sessionId:crypto.randomUUID(),userId,roles,expiresAt:new Date(Date.now()+3600000).toISOString()};
}
const code=(c:string)=>(e:unknown)=>e instanceof DomainError&&e.code===c;

// Example figures for tests only.
const RULES={
  passenger:[
    {minMinutesBeforeDeparture:1440,refundContributionBps:10000,refundPassengerFeeBps:0},
    {minMinutesBeforeDeparture:0,refundContributionBps:5000,refundPassengerFeeBps:0}
  ],
  passengerAfterStart:{refundContributionBps:0,refundPassengerFeeBps:0},
  driver:{refundContributionBps:10000,refundPassengerFeeBps:10000},
  platform:{refundContributionBps:10000,refundPassengerFeeBps:10000},
  forceMajeure:{refundContributionBps:10000,refundPassengerFeeBps:10000}
};

async function seed(departureHours=48){
  const ids:string[]=[];
  for(let i=0;i<4;i++){
    const id=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
    await pool.query(`insert into profiles(user_id,public_photo_status,identity_status) values($1,'approved','verified')`,[id]);
    ids.push(id);
  }
  const [driver,p1,p2,finance]=ids as [string,string,string,string];
  const province=(await pool.query(`
    insert into provinces(code,name,source_name,geom)
    values('CAN','Cancel Province','integration-test',
      ST_Multi(ST_GeomFromText('POLYGON((0 0,10 0,10 10,0 10,0 0))',4326)))
    returning id`)).rows[0].id;
  const vehicle=(await pool.query(`
    insert into vehicles(driver_user_id,make,model,plate,passenger_seats,review_status,documentation_status)
    values($1,'Test','Car','CAN-001',2,'approved','approved') returning id`,[driver])).rows[0].id;
  const trip=(await pool.query(`
    insert into trips(driver_user_id,vehicle_id,province_id,category,kind,leg,status,offered_seats,departure_at,
      origin_geom,destination_geom,route_geom,route_distance_m,route_duration_s,route_provider,route_provider_ref)
    values($1,$2,$3,'work','single','outbound','published',2,now()+($4||' hours')::interval,
      ST_SetSRID(ST_Point(1,1),4326),ST_SetSRID(ST_Point(9,9),4326),
      ST_GeomFromText('LINESTRING(1 1,5 5,9 9)',4326),10000,900,'integration-test','cancel-route')
    returning id`,[driver,vehicle,province,departureHours])).rows[0].id;
  await pool.query(`
    insert into trip_segments(trip_id,seq,from_stop_seq,to_stop_seq,distance_m,duration_s,capacity)
    values($1,0,0,1,5000,450,2),($1,1,1,2,5000,450,2)`,[trip]);
  return {driver,p1,p2,finance,trip};
}

async function book(s:{driver:string;trip:string},passenger:string,amountCents=1000){
  const r=await createRideRequest(pool,auth(passenger,["passenger"]),{tripId:s.trip,fromSegmentSeq:0,toSegmentSeq:2});
  await decideRideRequest(pool,auth(s.driver,["driver"]),r.id,"accept");
  const c=await confirmProviderPayment(pool,{requestId:r.id,providerPaymentId:`pay-${crypto.randomUUID()}`,amountCents});
  return {requestId:r.id as string,bookingId:(c as any).bookingId as string};
}

async function activatePolicy(finance:string){
  const p=await adminCreateCancellationPolicy(pool,auth(finance,["finance_admin"]),{rules:RULES,notes:"test"});
  await adminActivateCancellationPolicy(pool,auth(finance,["finance_admin"]),p.id);
  return p;
}

before(async()=>{await pool.query("select 1 from booking_cancellations limit 1")});
beforeEach(async()=>{
  await pool.query(`
    truncate table booking_cancellations,cancellation_policy_versions,audit_events,quote_snapshots,
      payment_compensations,bookings,seat_holds,ride_requests,trip_segments,trip_stops,
      trips,vehicles,profiles,user_roles,app_users,provinces restart identity cascade`);
});
after(async()=>{await pool.end()});

test("booking keeps the policy version accepted at payment and refund follows it",async()=>{
  const s=await seed(48);
  const policy=await activatePolicy(s.finance);
  const b=await book(s,s.p1,1000);
  const v=await pool.query(`select cancellation_policy_version_id from bookings where id=$1`,[b.bookingId]);
  assert.equal(v.rows[0].cancellation_policy_version_id,policy.id);

  // A newer policy does not change what the passenger already accepted.
  const newer=await adminCreateCancellationPolicy(pool,auth(s.finance,["finance_admin"]),{rules:{...RULES,passenger:[{minMinutesBeforeDeparture:0,refundContributionBps:0,refundPassengerFeeBps:0}]}});
  await adminActivateCancellationPolicy(pool,auth(s.finance,["finance_admin"]),newer.id);

  const out=await cancelOwnRideRequest(pool,auth(s.p1,["passenger"]),{requestId:b.requestId,reason:"Cambio de planes"});
  assert.equal(out.cancellation.rule_applied,"passenger[0]");
  assert.equal(out.cancellation.refund_cents,1000);
  assert.equal(out.cancellation.refund_status,"pending_provider");
  const pending=await adminListPendingRefunds(pool,auth(s.finance,["finance_admin"]));
  assert.equal(pending.length,1);
});

test("cancelling frees the seat for someone else",async()=>{
  const s=await seed(48);
  await pool.query(`update trip_segments set capacity=1 where trip_id=$1`,[s.trip]);
  const b=await book(s,s.p1);
  await cancelOwnRideRequest(pool,auth(s.p1,["passenger"]),{requestId:b.requestId});
  const again=await book(s,s.p2);
  assert.ok(again.bookingId);
});

test("without an active policy the refund waits for review instead of guessing",async()=>{
  const s=await seed(2);
  const b=await book(s,s.p1);
  const out=await cancelOwnRideRequest(pool,auth(s.p1,["passenger"]),{requestId:b.requestId});
  assert.equal(out.cancellation.refund_status,"pending_policy");
  assert.equal(out.cancellation.refund_cents,null);
});

test("pending requests cancel without a refund record and release the hold",async()=>{
  const s=await seed();
  const r=await createRideRequest(pool,auth(s.p1,["passenger"]),{tripId:s.trip,fromSegmentSeq:0,toSegmentSeq:1});
  await decideRideRequest(pool,auth(s.driver,["driver"]),r.id,"accept");
  const out=await cancelOwnRideRequest(pool,auth(s.p1,["passenger"]),{requestId:r.id});
  assert.equal(out.cancellation,null);
  const hold=await pool.query(`select status from seat_holds where request_id=$1`,[r.id]);
  assert.equal(hold.rows[0].status,"released");
  await assert.rejects(()=>cancelOwnRideRequest(pool,auth(s.p1,["passenger"]),{requestId:r.id}),code("REQUEST_NOT_CANCELLABLE"));
  await assert.rejects(()=>cancelOwnRideRequest(pool,auth(s.p2,["passenger"]),{requestId:r.id}),code("REQUEST_NOT_OWNED"));
});

test("driver cancels the trip: every passenger is refunded under the driver rule",async()=>{
  const s=await seed(3);
  await activatePolicy(s.finance);
  await book(s,s.p1,700);
  const pend=await createRideRequest(pool,auth(s.p2,["passenger"]),{tripId:s.trip,fromSegmentSeq:0,toSegmentSeq:1});
  const out=await cancelOwnTrip(pool,auth(s.driver,["driver"]),{tripId:s.trip,reason:"Avería del coche"});
  assert.equal(out.affectedPassengers,2);
  assert.equal(out.cancellations[0].rule_applied,"driver");
  assert.equal(out.cancellations[0].refund_cents,700);
  const r=await pool.query(`select status from ride_requests where id=$1`,[pend.id]);
  assert.equal(r.rows[0].status,"cancelled");
  const b=await pool.query(`select b.status from bookings b join ride_requests r on r.id=b.request_id where r.passenger_user_id=$1`,[s.p1]);
  assert.equal(b.rows[0].status,"driver_cancelled");
  await assert.rejects(()=>cancelOwnTrip(pool,auth(s.driver,["driver"]),{tripId:s.trip,reason:"otra vez"}),code("TRIP_NOT_CANCELLABLE"));
});

test("only finance or admin manage policies, and only one is active",async()=>{
  const s=await seed();
  await assert.rejects(()=>adminCreateCancellationPolicy(pool,auth(s.driver,["driver"]),{rules:RULES}),code("AUTH_FORBIDDEN"));
  await activatePolicy(s.finance);
  await activatePolicy(s.finance);
  const active=await pool.query(`select version from cancellation_policy_versions where status='active'`);
  assert.deepEqual(active.rows,[{version:2}]);
});
