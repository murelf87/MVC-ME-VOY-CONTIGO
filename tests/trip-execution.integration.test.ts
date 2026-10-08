import test,{after,before,beforeEach} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import type { AuthPrincipal } from "../src/auth/session.js";
import { DomainError } from "../src/errors.js";
import {
  completeOwnedTrip,
  generateOwnPickupCode,
  startOwnedTrip,
  verifyPickupCode
} from "../src/services/trip-execution-service.js";

const {Pool}=pg;
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
const pool=new Pool({connectionString:databaseUrl});

function auth(userId:string,roles:any[]):AuthPrincipal{
  return {sessionId:crypto.randomUUID(),userId,roles,expiresAt:new Date(Date.now()+3600000).toISOString()};
}

async function seed(){
  const driver=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  const otherDriver=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  const p1=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  const p2=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  for(const id of [driver,otherDriver,p1,p2]){
    await pool.query(`insert into profiles(user_id,public_photo_status,identity_status) values($1,'approved','verified')`,[id]);
  }
  const province=(await pool.query(`
    insert into provinces(code,name,source_name,geom)
    values('EXE','Execution Province','integration-test',
      ST_Multi(ST_GeomFromText('POLYGON((0 0,10 0,10 10,0 10,0 0))',4326)))
    returning id`)).rows[0].id;
  const vehicle=(await pool.query(`
    insert into vehicles(driver_user_id,make,model,plate,passenger_seats,review_status,documentation_status,vehicle_photo_status,insurance_status,insurance_expires_on)
    values($1,'Test','Car','EXEC-1',4,'approved','approved','approved','approved',current_date+30) returning id`,[driver])).rows[0].id;
  const trip=(await pool.query(`
    insert into trips(driver_user_id,vehicle_id,province_id,category,kind,leg,status,offered_seats,
      origin_geom,destination_geom,route_geom,route_distance_m,route_duration_s,route_provider,route_provider_ref)
    values($1,$2,$3,'work','single','outbound','published',4,
      ST_SetSRID(ST_Point(1,1),4326),ST_SetSRID(ST_Point(9,9),4326),
      ST_GeomFromText('LINESTRING(1 1,9 9)',4326),10000,900,'integration-test','exec-route')
    returning id`,[driver,vehicle,province])).rows[0].id;

  const bookings:any[]=[];
  for(const p of [p1,p2]){
    const request=(await pool.query(`
      insert into ride_requests(trip_id,passenger_user_id,from_segment_seq,to_segment_seq,status)
      values($1,$2,0,1,'confirmed') returning id`,[trip,p])).rows[0].id;
    const booking=(await pool.query(`
      insert into bookings(request_id,provider_payment_id,amount_cents,status)
      values($1,$2,100,'confirmed') returning id`,[request,`exec-pay-${crypto.randomUUID()}`])).rows[0].id;
    bookings.push(booking);
  }
  return {driver,otherDriver,p1,p2,trip,b1:bookings[0],b2:bookings[1]};
}

before(async()=>{await pool.query("select 1 from booking_pickup_codes limit 1")});
beforeEach(async()=>{
  await pool.query(`
    truncate table booking_pickup_codes,trip_direct_messages,user_blocks,trip_live_state,
      trip_location_events,private_documents,audit_events,route_change_responses,
      route_change_proposals,quote_snapshots,tariff_versions,payment_compensations,
      bookings,seat_holds,ride_requests,trip_segments,trip_stops,trips,vehicles,
      profiles,user_roles,auth_sessions,auth_challenges,app_users,province_dataset_imports,
      provinces restart identity cascade`);
});
after(async()=>{await pool.end()});

test("only owning driver can start a published trip",async()=>{
  const s=await seed();
  await assert.rejects(
    ()=>startOwnedTrip(pool,auth(s.otherDriver,["driver"]),s.trip),
    (e:unknown)=>e instanceof DomainError&&e.code==="TRIP_NOT_OWNED"
  );
  const started=await startOwnedTrip(pool,auth(s.driver,["driver"]),s.trip);
  assert.equal(started.status,"active");
});

test("only booked passenger can generate pickup code and raw code is never stored",async()=>{
  const s=await seed();
  await startOwnedTrip(pool,auth(s.driver,["driver"]),s.trip);
  await assert.rejects(
    ()=>generateOwnPickupCode(pool,auth(s.p2,["passenger"]),s.b1),
    (e:unknown)=>e instanceof DomainError&&e.code==="BOOKING_NOT_OWNED"
  );
  const generated=await generateOwnPickupCode(pool,auth(s.p1,["passenger"]),s.b1);
  assert.match(generated.code,/^[0-9]{6}$/);
  const stored=(await pool.query(`select salt,code_hash from booking_pickup_codes where booking_id=$1`,[s.b1])).rows[0];
  assert.notEqual(stored.code_hash,generated.code);
  assert.equal(stored.code_hash.length,64);
});

test("driver verifies pickup code and wrong code increments attempts",async()=>{
  const s=await seed();
  await startOwnedTrip(pool,auth(s.driver,["driver"]),s.trip);
  const generated=await generateOwnPickupCode(pool,auth(s.p1,["passenger"]),s.b1);
  await assert.rejects(
    ()=>verifyPickupCode(pool,auth(s.driver,["driver"]),s.b1,"000000"),
    (e:unknown)=>e instanceof DomainError&&e.code==="PICKUP_CODE_INVALID"
  );
  const attempts=(await pool.query(`select attempts from booking_pickup_codes where booking_id=$1`,[s.b1])).rows[0].attempts;
  assert.equal(attempts,1);
  const verified=await verifyPickupCode(pool,auth(s.driver,["driver"]),s.b1,generated.code);
  assert.equal(verified.alreadyVerified,false);
  const booking=(await pool.query(`select picked_up_at from bookings where id=$1`,[s.b1])).rows[0];
  assert.ok(booking.picked_up_at);
});

test("passenger cannot verify pickup code",async()=>{
  const s=await seed();
  await startOwnedTrip(pool,auth(s.driver,["driver"]),s.trip);
  const generated=await generateOwnPickupCode(pool,auth(s.p1,["passenger"]),s.b1);
  await assert.rejects(
    ()=>verifyPickupCode(pool,auth(s.p1,["passenger"]),s.b1,generated.code),
    (e:unknown)=>e instanceof DomainError&&e.code==="AUTH_FORBIDDEN"
  );
});

test("completing trip marks picked passenger completed and unpicked passenger no_show",async()=>{
  const s=await seed();
  await startOwnedTrip(pool,auth(s.driver,["driver"]),s.trip);
  const generated=await generateOwnPickupCode(pool,auth(s.p1,["passenger"]),s.b1);
  await verifyPickupCode(pool,auth(s.driver,["driver"]),s.b1,generated.code);
  const completed=await completeOwnedTrip(pool,auth(s.driver,["driver"]),s.trip);
  assert.equal(completed.status,"completed");
  const rows=await pool.query(`select id,status from bookings where id=any($1::uuid[]) order by id`,[[s.b1,s.b2]]);
  const byId=new Map(rows.rows.map(r=>[r.id,r.status]));
  assert.equal(byId.get(s.b1),"completed");
  assert.equal(byId.get(s.b2),"no_show");
});
