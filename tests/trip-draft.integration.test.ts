import test,{after,before,beforeEach} from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import type { AuthPrincipal } from "../src/auth/session.js";
import type { RouteCandidate,RouteComputationRequest,RouteProvider } from "../src/maps/types.js";
import { DomainError } from "../src/errors.js";
import {
  createTripDraftWithServerRoute,
  publishOwnedTrip
} from "../src/services/trip-draft-service.js";

const {Pool}=pg;
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
const pool=new Pool({connectionString:databaseUrl});

class TestProvider implements RouteProvider{
  readonly name="test-route";
  calls:RouteComputationRequest[]=[];
  async computeRoutes(request:RouteComputationRequest):Promise<RouteCandidate[]>{
    this.calls.push(request);
    const o=request.origin,d=request.destination;
    return [{
      provider:this.name,providerRef:`ref-${this.calls.length}`,
      distanceMeters:5000,durationSeconds:600,
      geometry:{type:"LineString",coordinates:[
        [o.longitude,o.latitude],
        [(o.longitude+d.longitude)/2,(o.latitude+d.latitude)/2],
        [d.longitude,d.latitude]
      ]},
      labels:[]
    }];
  }
}

function auth(userId:string):AuthPrincipal{
  return {sessionId:crypto.randomUUID(),userId,roles:["driver"],expiresAt:new Date(Date.now()+3600000).toISOString()};
}

async function seed(){
  const driver=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  const other=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  for(const id of [driver,other]){
    await pool.query(`insert into profiles(user_id,public_photo_status,identity_status) values($1,'approved','verified')`,[id]);
    await pool.query(`insert into user_roles(user_id,role) values($1,'driver')`,[id]);
  }
  const province=(await pool.query(`
    insert into provinces(code,name,source_name,geom)
    values('DRF','Draft Test Province','integration-test',
      ST_Multi(ST_GeomFromText('POLYGON((0 0,10 0,10 10,0 10,0 0))',4326)))
    returning id`)).rows[0].id;
  const vehicle=(await pool.query(`
    insert into vehicles(driver_user_id,make,model,plate,passenger_seats,review_status,documentation_status,vehicle_photo_status,insurance_status,insurance_expires_on)
    values($1,'Seat','Leon','DRF-001',4,'approved','approved','approved','approved',current_date+30) returning id`,[driver])).rows[0].id;
  return {driver,other,province,vehicle};
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

test("server-routed draft stores stops segments distance and provider references",async()=>{
  const s=await seed();
  const provider=new TestProvider();
  const trip=await createTripDraftWithServerRoute(pool,auth(s.driver),provider,{
    vehicleId:s.vehicle,provinceId:s.province,category:"work",leg:"outbound",
    departureAt:new Date(Date.now()+3600000).toISOString(),
    flexibilityMinutes:30,maxDetourM:3000,offeredSeats:3,
    origin:{latitude:1,longitude:1},destination:{latitude:9,longitude:9},
    intermediates:[{latitude:5,longitude:5}]
  });
  assert.equal(trip.status,"draft");
  assert.equal(trip.route_distance_m,10000);
  assert.equal(provider.calls.length,2);

  const stops=await pool.query(`select count(*)::int n from trip_stops where trip_id=$1`,[trip.id]);
  const segments=await pool.query(`select seq,distance_m,capacity from trip_segments where trip_id=$1 order by seq`,[trip.id]);
  assert.equal(stops.rows[0].n,3);
  assert.equal(segments.rowCount,2);
  assert.equal(segments.rows[0].capacity,3);
});

test("draft creation refuses vehicle owned by someone else",async()=>{
  const s=await seed();
  await assert.rejects(
    ()=>createTripDraftWithServerRoute(pool,auth(s.other),new TestProvider(),{
      vehicleId:s.vehicle,provinceId:s.province,category:"work",leg:"outbound",
      departureAt:new Date(Date.now()+3600000).toISOString(),
      flexibilityMinutes:0,maxDetourM:0,offeredSeats:1,
      origin:{latitude:1,longitude:1},destination:{latitude:9,longitude:9}
    }),
    (e:unknown)=>e instanceof DomainError&&e.code==="VEHICLE_NOT_OWNED"
  );
});

test("draft creation blocks when no real maps provider is configured",async()=>{
  const s=await seed();
  await assert.rejects(
    ()=>createTripDraftWithServerRoute(pool,auth(s.driver),null,{
      vehicleId:s.vehicle,provinceId:s.province,category:"work",leg:"outbound",
      departureAt:new Date(Date.now()+3600000).toISOString(),
      flexibilityMinutes:0,maxDetourM:0,offeredSeats:1,
      origin:{latitude:1,longitude:1},destination:{latitude:9,longitude:9}
    }),
    (e:unknown)=>e instanceof DomainError&&e.code==="MAPS_PROVIDER_UNAVAILABLE"
  );
});

test("owner can publish a fully verified server-routed draft",async()=>{
  const s=await seed();
  const trip=await createTripDraftWithServerRoute(pool,auth(s.driver),new TestProvider(),{
    vehicleId:s.vehicle,provinceId:s.province,category:"work",leg:"outbound",
    departureAt:new Date(Date.now()+3600000).toISOString(),
    flexibilityMinutes:15,maxDetourM:1000,offeredSeats:2,
    origin:{latitude:1,longitude:1},destination:{latitude:9,longitude:9}
  });
  await publishOwnedTrip(pool,auth(s.driver),trip.id);
  const row=(await pool.query(`select status from trips where id=$1`,[trip.id])).rows[0];
  assert.equal(row.status,"published");
});

test("non-owner cannot publish another driver's trip",async()=>{
  const s=await seed();
  const trip=await createTripDraftWithServerRoute(pool,auth(s.driver),new TestProvider(),{
    vehicleId:s.vehicle,provinceId:s.province,category:"work",leg:"outbound",
    departureAt:new Date(Date.now()+3600000).toISOString(),
    flexibilityMinutes:15,maxDetourM:1000,offeredSeats:2,
    origin:{latitude:1,longitude:1},destination:{latitude:9,longitude:9}
  });
  await assert.rejects(
    ()=>publishOwnedTrip(pool,auth(s.other),trip.id),
    (e:unknown)=>e instanceof DomainError&&e.code==="TRIP_NOT_OWNED"
  );
});
