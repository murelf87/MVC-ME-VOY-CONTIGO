import test,{after,before,beforeEach} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import type { AuthPrincipal } from "../src/auth/session.js";
import { DomainError } from "../src/errors.js";
import {
  adminListReports,
  adminUpdateReport,
  createIncidentReport,
  listOwnBlocks,
  rateBooking,
  ratingSummary
} from "../src/services/feedback-service.js";

const {Pool}=pg;
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
const pool=new Pool({connectionString:databaseUrl});

function auth(userId:string,roles:any[]):AuthPrincipal{
  return {sessionId:crypto.randomUUID(),userId,roles,expiresAt:new Date(Date.now()+3600000).toISOString()};
}
const code=(c:string)=>(e:unknown)=>e instanceof DomainError&&e.code===c;

async function seed(tripStatus="completed",bookingStatus="completed"){
  const ids:string[]=[];
  for(let i=0;i<4;i++){
    const id=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
    await pool.query(`insert into profiles(user_id,display_name) values($1,$2)`,[id,`U${i}`]);
    ids.push(id);
  }
  const [driver,passenger,otherPassenger,stranger]=ids as [string,string,string,string];
  const province=(await pool.query(`
    insert into provinces(code,name,source_name,geom)
    values('FBK','Feedback Province','integration-test',
      ST_Multi(ST_GeomFromText('POLYGON((0 0,10 0,10 10,0 10,0 0))',4326)))
    returning id`)).rows[0].id;
  const vehicle=(await pool.query(`
    insert into vehicles(driver_user_id,make,model,plate,passenger_seats)
    values($1,'Test','Car','FBK-1',4) returning id`,[driver])).rows[0].id;
  const trip=(await pool.query(`
    insert into trips(driver_user_id,vehicle_id,province_id,category,kind,leg,status,offered_seats)
    values($1,$2,$3,'work','single','outbound',$4,4) returning id`,[driver,vehicle,province,tripStatus])).rows[0].id;
  const bookings:string[]=[];
  for(const p of [passenger,otherPassenger]){
    const request=(await pool.query(`
      insert into ride_requests(trip_id,passenger_user_id,from_segment_seq,to_segment_seq,status)
      values($1,$2,0,1,'confirmed') returning id`,[trip,p])).rows[0].id;
    bookings.push((await pool.query(`
      insert into bookings(request_id,provider_payment_id,amount_cents,status)
      values($1,$2,100,$3) returning id`,[request,`fb-${crypto.randomUUID()}`,bookingStatus])).rows[0].id);
  }
  return {driver,passenger,otherPassenger,stranger,trip,booking:bookings[0] as string};
}

before(async()=>{await pool.query("select 1 from trip_ratings limit 1")});
beforeEach(async()=>{
  await pool.query(`
    truncate table incident_reports,trip_ratings,trip_direct_messages,user_blocks,audit_events,
      bookings,seat_holds,ride_requests,trip_segments,trip_stops,trips,vehicles,profiles,user_roles,
      app_users,provinces restart identity cascade`);
});
after(async()=>{await pool.end()});

test("driver and passenger rate each other once after a completed trip",async()=>{
  const s=await seed();
  await rateBooking(pool,auth(s.passenger,["passenger"]),{bookingId:s.booking,score:5,comment:"Puntual"});
  await rateBooking(pool,auth(s.driver,["driver"]),{bookingId:s.booking,score:4});
  await assert.rejects(()=>rateBooking(pool,auth(s.passenger,["passenger"]),{bookingId:s.booking,score:1}),code("RATING_ALREADY_SUBMITTED"));
  assert.deepEqual(await ratingSummary(pool,s.driver),{userId:s.driver,count:1,average:5});
  assert.deepEqual(await ratingSummary(pool,s.passenger),{userId:s.passenger,count:1,average:4});
  assert.equal((await ratingSummary(pool,s.stranger)).average,null);
});

test("ratings are closed before completion and to outsiders",async()=>{
  const s=await seed("draft","confirmed");
  await assert.rejects(()=>rateBooking(pool,auth(s.passenger,["passenger"]),{bookingId:s.booking,score:5}),code("RATING_NOT_AVAILABLE"));
  await assert.rejects(()=>rateBooking(pool,auth(s.otherPassenger,["passenger"]),{bookingId:s.booking,score:5}),code("BOOKING_NOT_PARTICIPANT"));
  await assert.rejects(()=>rateBooking(pool,auth(s.passenger,["passenger"]),{bookingId:s.booking,score:6}),code("INVALID_RATING"));
});

test("passenger reports the driver and blocks them in one step",async()=>{
  const s=await seed();
  const r=await createIncidentReport(pool,auth(s.passenger,["passenger"]),{
    tripId:s.trip,reportedUserId:s.driver,category:"behaviour",description:"Conducción temeraria en la autovía",blockUser:true
  });
  assert.equal(r.status,"open");
  const blocks=await listOwnBlocks(pool,auth(s.passenger,["passenger"]));
  assert.equal(blocks[0].user_id,s.driver);
  const audit=await pool.query(`select action from audit_events where entity_id=$1`,[r.id]);
  assert.equal(audit.rows[0].action,"incident_report.created");
});

test("reports are limited to trip participants and passengers cannot report each other",async()=>{
  const s=await seed();
  await assert.rejects(()=>createIncidentReport(pool,auth(s.stranger,["passenger"]),{
    tripId:s.trip,reportedUserId:s.driver,category:"other",description:"No estaba en este viaje"
  }),code("TRIP_NOT_PARTICIPANT"));
  await assert.rejects(()=>createIncidentReport(pool,auth(s.passenger,["passenger"]),{
    tripId:s.trip,reportedUserId:s.otherPassenger,category:"other",description:"Otro pasajero del coche"
  }),code("REPORTED_USER_NOT_IN_TRIP"));
  const byDriver=await createIncidentReport(pool,auth(s.driver,["driver"]),{
    tripId:s.trip,reportedUserId:s.passenger,category:"no_show",description:"No se presentó en la parada"
  });
  assert.equal(byDriver.category,"no_show");
});

test("only support admins review reports, and closing needs a note",async()=>{
  const s=await seed();
  const r=await createIncidentReport(pool,auth(s.passenger,["passenger"]),{
    tripId:s.trip,category:"vehicle",description:"El cinturón trasero no funcionaba"
  });
  await assert.rejects(()=>adminListReports(pool,auth(s.driver,["driver"])),code("AUTH_FORBIDDEN"));
  const support=auth(s.stranger,["support_admin"]);
  assert.equal((await adminListReports(pool,support,"open")).length,1);
  await assert.rejects(()=>adminUpdateReport(pool,support,{reportId:r.id,status:"resolved"}),code("RESOLUTION_NOTE_REQUIRED"));
  const done=await adminUpdateReport(pool,support,{reportId:r.id,status:"resolved",note:"Conductor avisado; revisión del vehículo"});
  assert.equal(done.status,"resolved");
  await assert.rejects(()=>adminUpdateReport(pool,support,{reportId:r.id,status:"reviewing"}),code("REPORT_CLOSED"));
});
