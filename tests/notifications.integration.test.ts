import test,{after,before,beforeEach} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import type { AuthPrincipal } from "../src/auth/session.js";
import { createRideRequest, decideRideRequest } from "../src/services/request-service.js";
import { confirmProviderPayment } from "../src/services/reservation-service.js";
import { cancelOwnTrip } from "../src/services/cancellation-service.js";
import { listOwnNotifications, markNotificationsRead } from "../src/services/notification-service.js";

const {Pool}=pg;
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
const pool=new Pool({connectionString:databaseUrl});

function auth(userId:string,roles:any[]):AuthPrincipal{
  return {sessionId:crypto.randomUUID(),userId,roles,expiresAt:new Date(Date.now()+3600000).toISOString()};
}

async function seed(){
  const ids:string[]=[];
  for(const name of ["Ana","Luis","Eva"]){
    const id=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
    await pool.query(`insert into profiles(user_id,display_name,public_photo_status,identity_status) values($1,$2,'approved','verified')`,[id,name]);
    ids.push(id);
  }
  const [driver,p1,p2]=ids as [string,string,string];
  const province=(await pool.query(`
    insert into provinces(code,name,source_name,geom)
    values('NTF','Notify Province','integration-test',
      ST_Multi(ST_GeomFromText('POLYGON((0 0,10 0,10 10,0 10,0 0))',4326)))
    returning id`)).rows[0].id;
  const vehicle=(await pool.query(`
    insert into vehicles(driver_user_id,make,model,plate,passenger_seats,review_status,documentation_status)
    values($1,'Test','Car','NTF-001',3,'approved','approved') returning id`,[driver])).rows[0].id;
  const trip=(await pool.query(`
    insert into trips(driver_user_id,vehicle_id,province_id,category,kind,leg,status,offered_seats,departure_at,
      origin_geom,destination_geom,route_geom,route_distance_m,route_duration_s,route_provider,route_provider_ref)
    values($1,$2,$3,'work','single','outbound','published',3,now()+interval '1 day',
      ST_SetSRID(ST_Point(1,1),4326),ST_SetSRID(ST_Point(9,9),4326),
      ST_GeomFromText('LINESTRING(1 1,5 5,9 9)',4326),10000,900,'integration-test','notify-route')
    returning id`,[driver,vehicle,province])).rows[0].id;
  await pool.query(`
    insert into trip_segments(trip_id,seq,from_stop_seq,to_stop_seq,distance_m,duration_s,capacity)
    values($1,0,0,1,5000,450,3),($1,1,1,2,5000,450,3)`,[trip]);
  return {driver,p1,p2,trip};
}

before(async()=>{await pool.query("select 1 from user_notifications limit 1")});
beforeEach(async()=>{
  await pool.query(`
    truncate table user_notifications,booking_cancellations,audit_events,bookings,seat_holds,ride_requests,
      trip_segments,trip_stops,trips,vehicles,profiles,user_roles,app_users,provinces restart identity cascade`);
});
after(async()=>{await pool.end()});

test("each step of a booking lands in the right inbox only",async()=>{
  const s=await seed();
  const r=await createRideRequest(pool,auth(s.p1,["passenger"]),{tripId:s.trip,fromSegmentSeq:0,toSegmentSeq:2});
  let ana=await listOwnNotifications(pool,auth(s.driver,["driver"]));
  assert.equal(ana.unread,1);
  assert.equal(ana.notifications[0].kind,"ride_request.received");
  assert.equal(ana.notifications[0].payload.passengerName,"Luis");

  await decideRideRequest(pool,auth(s.driver,["driver"]),r.id,"accept");
  await confirmProviderPayment(pool,{requestId:r.id,providerPaymentId:`p-${crypto.randomUUID()}`,amountCents:500});
  const luis=await listOwnNotifications(pool,auth(s.p1,["passenger"]));
  assert.deepEqual(luis.notifications.map((n:any)=>n.kind),["booking.confirmed","ride_request.accepted"]);
  assert.equal((await listOwnNotifications(pool,auth(s.p2,["passenger"]))).unread,0);

  ana=await listOwnNotifications(pool,auth(s.driver,["driver"]));
  assert.equal(ana.unread,2);
  await markNotificationsRead(pool,auth(s.driver,["driver"]),[ana.notifications[0].id]);
  assert.equal((await listOwnNotifications(pool,auth(s.driver,["driver"]))).unread,1);
  await markNotificationsRead(pool,auth(s.p1,["passenger"]),[ana.notifications[1].id]);
  assert.equal((await listOwnNotifications(pool,auth(s.driver,["driver"]))).unread,1,"cannot mark someone else's notice");
  await markNotificationsRead(pool,auth(s.driver,["driver"]));
  assert.equal((await listOwnNotifications(pool,auth(s.driver,["driver"]))).unread,0);
});

test("cancelling a trip tells every affected passenger with the reason",async()=>{
  const s=await seed();
  await createRideRequest(pool,auth(s.p1,["passenger"]),{tripId:s.trip,fromSegmentSeq:0,toSegmentSeq:1});
  await createRideRequest(pool,auth(s.p2,["passenger"]),{tripId:s.trip,fromSegmentSeq:1,toSegmentSeq:2});
  await cancelOwnTrip(pool,auth(s.driver,["driver"]),{tripId:s.trip,reason:"Avería"});
  for(const p of [s.p1,s.p2]){
    const inbox=await listOwnNotifications(pool,auth(p,["passenger"]));
    assert.equal(inbox.notifications[0].kind,"trip.cancelled");
    assert.equal(inbox.notifications[0].payload.reason,"Avería");
  }
});
