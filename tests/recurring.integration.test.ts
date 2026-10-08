import test,{after,before,beforeEach} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import type { AuthPrincipal } from "../src/auth/session.js";
import { DomainError } from "../src/errors.js";
import {
  createTripSeries,
  decideWeeklyGroup,
  materializeSeries,
  requestSeriesWeek,
  seriesWeek,
  setSeriesStatus
} from "../src/services/recurring-service.js";

const {Pool}=pg;
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
const pool=new Pool({connectionString:databaseUrl});

function auth(userId:string,roles:any[]):AuthPrincipal{
  return {sessionId:crypto.randomUUID(),userId,roles,expiresAt:new Date(Date.now()+3600000).toISOString()};
}
const code=(c:string)=>(e:unknown)=>e instanceof DomainError&&e.code===c;

/** Monday of the ISO week after next, as YYYY-MM-DD in Europe/Madrid. */
async function mondayInWeeks(n:number){
  return (await pool.query(`select (date_trunc('week',(now() at time zone 'Europe/Madrid')::date)::date + 7*$1)::text as d`,[n])).rows[0].d as string;
}

async function seed(seats=2){
  const ids:string[]=[];
  for(const name of ["Ana","Luis","Eva"]){
    const id=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
    await pool.query(`insert into profiles(user_id,display_name,public_photo_status,identity_status) values($1,$2,'approved','verified')`,[id,name]);
    ids.push(id);
  }
  const [driver,p1,p2]=ids as [string,string,string];
  const province=(await pool.query(`
    insert into provinces(code,name,source_name,geom)
    values('REC','Recurring Province','integration-test',
      ST_Multi(ST_GeomFromText('POLYGON((0 0,10 0,10 10,0 10,0 0))',4326)))
    returning id`)).rows[0].id;
  const vehicle=(await pool.query(`
    insert into vehicles(driver_user_id,make,model,plate,passenger_seats,review_status,documentation_status,
      vehicle_photo_status,insurance_status,insurance_expires_on)
    values($1,'Test','Car','REC-001',4,'approved','approved','approved','approved',current_date+365) returning id`,[driver])).rows[0].id;
  // Template departs Monday of next week at 07:30 Madrid time.
  const monday=await mondayInWeeks(1);
  const trip=(await pool.query(`
    insert into trips(driver_user_id,vehicle_id,province_id,category,kind,leg,status,offered_seats,departure_at,
      origin_geom,destination_geom,route_geom,route_distance_m,route_duration_s,route_provider,route_provider_ref)
    values($1,$2,$3,'work','single','outbound','draft',$4,($5::date + time '07:30') at time zone 'Europe/Madrid',
      ST_SetSRID(ST_Point(1,1),4326),ST_SetSRID(ST_Point(9,9),4326),
      ST_GeomFromText('LINESTRING(1 1,5 5,9 9)',4326),10000,900,'integration-test','rec-route')
    returning id`,[driver,vehicle,province,seats,monday])).rows[0].id;
  await pool.query(`
    insert into trip_stops(trip_id,seq,kind,geom) values
      ($1,0,'origin',ST_SetSRID(ST_Point(1,1),4326)),
      ($1,1,'stop',ST_SetSRID(ST_Point(5,5),4326)),
      ($1,2,'destination',ST_SetSRID(ST_Point(9,9),4326))`,[trip]);
  await pool.query(`
    insert into trip_segments(trip_id,seq,from_stop_seq,to_stop_seq,distance_m,duration_s,capacity)
    values($1,0,0,1,5000,450,$2),($1,1,1,2,5000,450,$2)`,[trip,seats]);
  await pool.query(`update trips set status='published' where id=$1`,[trip]);
  return {driver,p1,p2,trip,monday};
}

before(async()=>{await pool.query("select 1 from trip_series limit 1")});
beforeEach(async()=>{
  await pool.query(`
    truncate table user_notifications,audit_events,bookings,seat_holds,ride_requests,trip_segments,trip_stops,
      trip_series,trips,vehicles,profiles,user_roles,app_users,provinces restart identity cascade`);
});
after(async()=>{await pool.end()});

test("a weekday series publishes occurrences with the template route and never duplicates them",async()=>{
  const s=await seed();
  const out=await createTripSeries(pool,auth(s.driver,["driver"]),{tripId:s.trip,weekdays:[1,2,3,4,5],horizonWeeks:2});
  assert.ok(out.created.length>=5,`created ${out.created.length}`);
  assert.equal(out.published.length,out.created.length);
  assert.deepEqual(out.failed,[]);
  const times=await pool.query(`
    select distinct to_char(departure_at at time zone 'Europe/Madrid','HH24:MI') as t,
           extract(isodow from departure_at at time zone 'Europe/Madrid')::int as dow
      from trips where series_id=$1`,[out.series.id]);
  assert.ok(times.rows.every(r=>r.t==="07:30"&&r.dow>=1&&r.dow<=5));
  const segs=await pool.query(`select count(*)::int as n from trip_segments where trip_id=$1`,[out.created[0]]);
  assert.equal(segs.rows[0].n,2);
  const again=await materializeSeries(pool,out.series.id,2);
  assert.equal(again.created.length,0,"second run creates nothing");
  await assert.rejects(()=>createTripSeries(pool,auth(s.driver,["driver"]),{tripId:s.trip,weekdays:[1]}),code("TRIP_ALREADY_IN_SERIES"));
});

test("passenger books a whole week; full days are reported, not overbooked",async()=>{
  const s=await seed(1);
  const {series}=await createTripSeries(pool,auth(s.driver,["driver"]),{tripId:s.trip,weekdays:[1,2,3,4,5],horizonWeeks:2});
  const week=await mondayInWeeks(1);
  const days=(await seriesWeek(pool,series.id,week)).trips;
  assert.equal(days.length,5);
  // Eva already holds Wednesday's only seat.
  const wed=days.find((d:any)=>d.dow===3);
  await requestSeriesWeek(pool,auth(s.p2,["passenger"]),{seriesId:series.id,weekStart:week,fromSegmentSeq:0,toSegmentSeq:2,weekdays:[3]});
  const evaGroup=(await pool.query(`select weekly_group_id from ride_requests where passenger_user_id=$1`,[s.p2])).rows[0].weekly_group_id;
  await decideWeeklyGroup(pool,auth(s.driver,["driver"]),{groupId:evaGroup,decision:"accept"});

  const luis=await requestSeriesWeek(pool,auth(s.p1,["passenger"]),{seriesId:series.id,weekStart:week,fromSegmentSeq:0,toSegmentSeq:2});
  assert.equal(luis.results.filter(r=>r.status==="requested").length,4);
  const skipped=luis.results.find(r=>r.status==="skipped");
  assert.equal(skipped?.tripId,wed.id);
  assert.equal(skipped?.code,"NO_CAPACITY_ON_SEGMENT");

  // Asking again for the same week does not create duplicates.
  const again=await requestSeriesWeek(pool,auth(s.p1,["passenger"]),{seriesId:series.id,weekStart:week,fromSegmentSeq:0,toSegmentSeq:2,weekdays:[1,2,4,5]})
    .catch((e:DomainError)=>e);
  assert.ok(again instanceof DomainError&&again.code==="WEEK_NOT_BOOKABLE");

  const decided=await decideWeeklyGroup(pool,auth(s.driver,["driver"]),{groupId:luis.weeklyGroupId,decision:"accept"});
  assert.equal(decided.results.filter((r:any)=>r.status==="accepted").length,4);
  const holds=await pool.query(`
    select count(*)::int as n from seat_holds h join ride_requests r on r.id=h.request_id
     where r.passenger_user_id=$1 and h.status='active'`,[s.p1]);
  assert.equal(holds.rows[0].n,4);
});

test("pausing stops new occurrences; only the owner manages the series",async()=>{
  const s=await seed();
  const {series}=await createTripSeries(pool,auth(s.driver,["driver"]),{tripId:s.trip,weekdays:[6],horizonWeeks:1});
  await assert.rejects(()=>setSeriesStatus(pool,auth(s.p1,["driver"]),{seriesId:series.id,status:"paused"}),code("SERIES_NOT_FOUND"));
  await setSeriesStatus(pool,auth(s.driver,["driver"]),{seriesId:series.id,status:"paused"});
  const out=await materializeSeries(pool,series.id,8);
  assert.equal(out.created.length,0);
  await assert.rejects(()=>decideWeeklyGroup(pool,auth(s.p1,["driver"]),{groupId:crypto.randomUUID(),decision:"accept"}),code("WEEKLY_GROUP_NOT_FOUND"));
});
