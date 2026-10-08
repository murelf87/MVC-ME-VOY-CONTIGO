import test,{after,before,beforeEach} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import type { AuthPrincipal } from "../src/auth/session.js";
import { DomainError } from "../src/errors.js";
import { createRideRequest, decideRideRequest, listOwnRideRequests } from "../src/services/request-service.js";
import { confirmProviderPayment } from "../src/services/reservation-service.js";
import { adminApproveTariff, adminCreateTariff, quoteRange } from "../src/services/tariff-service.js";

const {Pool}=pg;
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
const pool=new Pool({connectionString:databaseUrl});

function auth(userId:string,roles:any[]):AuthPrincipal{
  return {sessionId:crypto.randomUUID(),userId,roles,expiresAt:new Date(Date.now()+3600000).toISOString()};
}
const code=(c:string)=>(e:unknown)=>e instanceof DomainError&&e.code===c;
// Example figures for tests only.
const T1={rateMicrosPerKm:300000,passengerCommissionBps:100,driverCommissionBps:100};

async function seed(){
  const ids:string[]=[];
  for(let i=0;i<3;i++){
    const id=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
    await pool.query(`insert into profiles(user_id,public_photo_status,identity_status) values($1,'approved','verified')`,[id]);
    ids.push(id);
  }
  const [driver,p1,finance]=ids as [string,string,string];
  const province=(await pool.query(`
    insert into provinces(code,name,source_name,geom)
    values('TAR','Tariff Province','integration-test',
      ST_Multi(ST_GeomFromText('POLYGON((0 0,10 0,10 10,0 10,0 0))',4326)))
    returning id`)).rows[0].id;
  const vehicle=(await pool.query(`
    insert into vehicles(driver_user_id,make,model,plate,passenger_seats,review_status,documentation_status)
    values($1,'Test','Car','TAR-001',2,'approved','approved') returning id`,[driver])).rows[0].id;
  const trip=(await pool.query(`
    insert into trips(driver_user_id,vehicle_id,province_id,category,kind,leg,status,offered_seats,departure_at,
      origin_geom,destination_geom,route_geom,route_distance_m,route_duration_s,route_provider,route_provider_ref)
    values($1,$2,$3,'work','single','outbound','published',2,now()+interval '1 day',
      ST_SetSRID(ST_Point(1,1),4326),ST_SetSRID(ST_Point(9,9),4326),
      ST_GeomFromText('LINESTRING(1 1,5 5,9 9)',4326),20000,1800,'integration-test','tariff-route')
    returning id`,[driver,vehicle,province])).rows[0].id;
  await pool.query(`
    insert into trip_segments(trip_id,seq,from_stop_seq,to_stop_seq,distance_m,duration_s,capacity)
    values($1,0,0,1,12345,900,2),($1,1,1,2,7655,900,2)`,[trip]);
  return {driver,p1,finance,trip};
}

before(async()=>{await pool.query("select 1 from tariff_versions limit 1")});
beforeEach(async()=>{
  await pool.query(`
    truncate table user_notifications,quote_snapshots,tariff_versions,audit_events,bookings,seat_holds,ride_requests,
      trip_segments,trip_stops,trips,vehicles,profiles,user_roles,app_users,provinces restart identity cascade`);
});
after(async()=>{await pool.end()});

test("without an approved tariff there is no price, only the routed distance",async()=>{
  const s=await seed();
  const q=await quoteRange(pool,s.trip,0,1);
  assert.deepEqual(q,{available:false,reason:"TARIFF_NOT_APPROVED",roadDistanceM:12345});
});

test("only finance approves tariffs and the quote uses the passenger's own segments",async()=>{
  const s=await seed();
  await assert.rejects(()=>adminCreateTariff(pool,auth(s.driver,["driver"]),T1),code("AUTH_FORBIDDEN"));
  const t=await adminCreateTariff(pool,auth(s.finance,["finance_admin"]),T1);
  assert.equal((await quoteRange(pool,s.trip,0,1)).available,false,"draft does not apply");
  await adminApproveTariff(pool,auth(s.finance,["finance_admin"]),t.id);
  const q=await quoteRange(pool,s.trip,0,1);
  assert.ok(q.available);
  assert.equal(q.passengerTotalCents,374);
  const whole=await quoteRange(pool,s.trip,0,2);
  assert.ok(whole.available&&whole.roadDistanceM===20000);
});

test("price is frozen at acceptance and payment must match it",async()=>{
  const s=await seed();
  const t=await adminCreateTariff(pool,auth(s.finance,["finance_admin"]),T1);
  await adminApproveTariff(pool,auth(s.finance,["finance_admin"]),t.id);
  const r=await createRideRequest(pool,auth(s.p1,["passenger"]),{tripId:s.trip,fromSegmentSeq:0,toSegmentSeq:1});
  const accepted=await decideRideRequest(pool,auth(s.driver,["driver"]),r.id,"accept");
  assert.equal((accepted as any).quote.passenger_total_cents,374);

  // A newer tariff does not change what was agreed.
  const t2=await adminCreateTariff(pool,auth(s.finance,["finance_admin"]),{...T1,rateMicrosPerKm:500000});
  await adminApproveTariff(pool,auth(s.finance,["finance_admin"]),t2.id);
  const mine=await listOwnRideRequests(pool,auth(s.p1,["passenger"]));
  assert.equal(mine[0].quote_total_cents,374);

  await assert.rejects(()=>confirmProviderPayment(pool,{requestId:r.id,providerPaymentId:`p-${crypto.randomUUID()}`,amountCents:100}),code("PAYMENT_AMOUNT_MISMATCH"));
  const ok=await confirmProviderPayment(pool,{requestId:r.id,providerPaymentId:`p-${crypto.randomUUID()}`,amountCents:374});
  assert.equal(ok.status,"confirmed");
  const approved=await pool.query(`select version,status from tariff_versions order by version`);
  assert.deepEqual(approved.rows,[{version:1,status:"retired"},{version:2,status:"approved"}]);
});
