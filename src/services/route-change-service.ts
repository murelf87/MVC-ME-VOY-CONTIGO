import type { Pool, PoolClient } from "pg";
import type { AuthPrincipal } from "../auth/session.js";
import { requireAnyRole } from "../auth/session.js";
import { DomainError } from "../errors.js";
import { computeProvinceCompliantSegmentPlan } from "../maps/province-route-service.js";
import type { GeoJsonLineString, LatLng, RouteProvider } from "../maps/types.js";
import { displayName, notify } from "./notification-service.js";
import { snapshotQuoteForRequest } from "./tariff-service.js";
import { tripProgress } from "./trip-progress-service.js";

/**
 * A passenger asks to be picked up off the published route, before departure or with the car
 * already moving (master prompt sections 11 and 12). The server inserts the two points where they
 * add the least distance, recomputes the whole route with the real provider inside the province,
 * and checks the trip's own maximum detour and seat capacity on every affected segment.
 * Nothing changes until the driver accepts and every confirmed passenger whose pickup or arrival
 * moves beyond the trip's flexibility has accepted too. There is no automatic surcharge: the new
 * passenger's price comes from the approved tariff over their own road meters, and earlier
 * passengers keep the amount they already agreed.
 */

const PROPOSAL_TTL_S=600;
const HOLD_TTL_S=600;

type PlanStop={latitude:number;longitude:number;kind:string;label:string|null;oldSeq:number|null};
type PlanSegment={distanceM:number;durationS:number;capacity:number};
export type RouteChangePlan={
  stops:PlanStop[];
  segments:PlanSegment[];
  route:{geometry:GeoJsonLineString;distanceM:number;durationS:number;provider:string;providerRef:string};
};

async function tx<T>(pool:Pool,fn:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await pool.connect();
  try{
    await client.query("begin");
    const value=await fn(client);
    await client.query("commit");
    return value;
  }catch(error){
    await client.query("rollback");
    throw error;
  }finally{
    client.release();
  }
}

function haversine(a:LatLng,b:LatLng){
  const r=6371000,t=Math.PI/180;
  const dLa=(b.latitude-a.latitude)*t,dLo=(b.longitude-a.longitude)*t;
  const h=Math.sin(dLa/2)**2+Math.cos(a.latitude*t)*Math.cos(b.latitude*t)*Math.sin(dLo/2)**2;
  return 2*r*Math.asin(Math.sqrt(h));
}

function point(v:any,label:string):LatLng{
  const lat=Number(v?.latitude),lng=Number(v?.longitude);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<-90||lat>90||lng<-180||lng>180){
    throw new DomainError("INVALID_ROUTE_CHANGE_POINT",`${label} is not a valid coordinate`);
  }
  return {latitude:lat,longitude:lng};
}

function label(v:unknown):string|null{
  if(v==null) return null;
  const s=String(v).trim().slice(0,200);
  return s||null;
}

/** Occupied seats per current segment seq: active holds plus confirmed or completed bookings. */
async function occupancy(db:Pool|PoolClient,tripId:string):Promise<Map<number,number>>{
  const rows=(await db.query<{seq:number;occupied:number}>(`
    select s.seq,
      (select count(*)::int from seat_holds h join ride_requests r on r.id=h.request_id
        where r.trip_id=$1 and h.status='active' and h.expires_at>now()
          and r.from_segment_seq<=s.seq and r.to_segment_seq>s.seq)
      +(select count(*)::int from bookings b join ride_requests r on r.id=b.request_id
        where r.trip_id=$1 and b.status in ('confirmed','completed')
          and r.from_segment_seq<=s.seq and r.to_segment_seq>s.seq) as occupied
      from trip_segments s where s.trip_id=$1`,[tripId])).rows;
  return new Map(rows.map(r=>[r.seq,r.occupied]));
}

/** Old segment that a new segment lies on: the one starting at the last original stop at or before it. */
function oldSegmentOf(plan:RouteChangePlan,newSeq:number):number{
  for(let i=newSeq;i>=0;i--){
    const o=plan.stops[i]!.oldSeq;
    if(o!=null) return o;
  }
  return 0;
}

function assertSeats(plan:RouteChangePlan,from:number,to:number,occ:Map<number,number>){
  for(let i=from;i<to;i++){
    const seg=plan.segments[i]!;
    if((occ.get(oldSegmentOf(plan,i))??0)>=seg.capacity){
      throw new DomainError("NO_CAPACITY_ON_SEGMENT","No seat capacity on at least one affected segment",409);
    }
  }
}

function newIndexOf(plan:RouteChangePlan,oldSeq:number):number{
  const i=plan.stops.findIndex(s=>s.oldSeq===oldSeq);
  if(i<0) throw new Error(`stop ${oldSeq} missing from plan`);
  return i;
}

async function loadTrip(db:Pool|PoolClient,tripId:string,lock=false){
  const t=(await db.query(`
    select id,driver_user_id,status::text,province_id,route_version,max_detour_m,flexibility_minutes,
           route_distance_m,route_duration_s
      from trips where id=$1 ${lock?"for update":""}`,[tripId])).rows[0];
  if(!t) throw new DomainError("TRIP_NOT_FOUND","Trip not found",404);
  return t;
}

/** Cheapest insertion of pickup and drop-off among the stops still ahead, then a real provider route. */
export async function planRouteChange(
  pool:Pool,provider:RouteProvider,tripId:string,pickup:LatLng,dropoff:LatLng
){
  const trip=await loadTrip(pool,tripId);
  if(!["published","active"].includes(trip.status)){
    throw new DomainError("TRIP_NOT_BOOKABLE","Trip is not bookable",409);
  }
  if(!trip.max_detour_m){
    throw new DomainError("DETOUR_NOT_ALLOWED","The driver does not accept detours on this trip",409);
  }
  const progress=await tripProgress(pool,tripId);
  if(trip.status==="active"){
    if(!progress.live){
      throw new DomainError("LIVE_POSITION_STALE","The car's position is not recent enough to accept a pickup while moving",409);
    }
    const f=(await pool.query(`select ST_LineLocatePoint(route_geom,ST_SetSRID(ST_Point($2,$3),4326)) as f from trips where id=$1`,
      [tripId,pickup.longitude,pickup.latitude])).rows[0].f;
    if(progress.carFraction!=null&&Number(f)<=progress.carFraction){
      throw new DomainError("PICKUP_ALREADY_PASSED","The car has already gone past this pickup point",409);
    }
  }
  const stops=(await pool.query(`
    select seq,kind,label,ST_Y(geom) as latitude,ST_X(geom) as longitude
      from trip_stops where trip_id=$1 order by seq`,[tripId])).rows
    .map(s=>({...s,latitude:Number(s.latitude),longitude:Number(s.longitude)}));
  const segments=(await pool.query(`select seq,capacity from trip_segments where trip_id=$1 order by seq`,[tripId])).rows;
  if(stops.length<2||segments.length!==stops.length-1){
    throw new DomainError("TRIP_ROUTE_INCOMPLETE","Trip has no complete stop and segment plan",409);
  }

  const first=Math.max(0,progress.passedStopSeq);
  const last=stops.length-2;
  if(first>last) throw new DomainError("PICKUP_ALREADY_PASSED","The car has already passed every possible pickup point",409);
  const d=(a:LatLng,b:LatLng)=>haversine(a,b);
  let best:{a:number;b:number;cost:number}|null=null;
  for(let a=first;a<=last;a++){
    for(let b=a;b<=last;b++){
      const sa=stops[a]!,sa1=stops[a+1]!,sb=stops[b]!,sb1=stops[b+1]!;
      const cost=a===b
        ?d(sa,pickup)+d(pickup,dropoff)+d(dropoff,sa1)-d(sa,sa1)
        :d(sa,pickup)+d(pickup,sa1)-d(sa,sa1)+d(sb,dropoff)+d(dropoff,sb1)-d(sb,sb1);
      if(!best||cost<best.cost) best={a,b,cost};
    }
  }
  const {a,b}=best!;
  const planStops:PlanStop[]=[];
  for(const s of stops){
    planStops.push({latitude:s.latitude,longitude:s.longitude,kind:s.kind,label:s.label,oldSeq:s.seq});
    if(s.seq===a) planStops.push({...pickup,kind:"pickup",label:null,oldSeq:null});
    if(s.seq===b) planStops.push({...dropoff,kind:"dropoff",label:null,oldSeq:null});
  }
  const pickupSeq=planStops.findIndex(s=>s.kind==="pickup"&&s.oldSeq==null);
  const dropoffSeq=planStops.findIndex(s=>s.kind==="dropoff"&&s.oldSeq==null);

  const routed=await computeProvinceCompliantSegmentPlan(pool,provider,{
    provinceId:trip.province_id,
    origin:planStops[0]!,
    destination:planStops[planStops.length-1]!,
    intermediates:planStops.slice(1,-1)
  });
  const plan:RouteChangePlan={
    stops:planStops,
    segments:[],
    route:{
      geometry:routed.route.geometry,
      distanceM:routed.route.distanceMeters,
      durationS:routed.route.durationSeconds,
      provider:routed.route.provider,
      providerRef:routed.route.providerRef
    }
  };
  plan.segments=routed.segments.map((s,i)=>({
    distanceM:s.distanceMeters,
    durationS:s.durationSeconds,
    capacity:segments[oldSegmentOf(plan,i)]!.capacity
  }));

  const addedDistanceM=Math.max(0,plan.route.distanceM-trip.route_distance_m);
  const addedDurationS=Math.max(0,plan.route.durationS-trip.route_duration_s);
  if(addedDistanceM>trip.max_detour_m){
    throw new DomainError("DETOUR_TOO_LONG","The detour exceeds the maximum the driver accepts",422,
      {addedDistanceM,maxDetourM:trip.max_detour_m});
  }
  assertSeats(plan,pickupSeq,dropoffSeq,await occupancy(pool,tripId));
  return {trip,plan,pickupSeq,dropoffSeq,addedDistanceM,addedDurationS};
}

export async function requestRouteChange(
  pool:Pool,provider:RouteProvider|null,principal:AuthPrincipal,
  input:{tripId:string;pickup:LatLng;dropoff:LatLng;pickupLabel?:string|null;dropoffLabel?:string|null}
){
  requireAnyRole(principal,["passenger"]);
  if(!provider) throw new DomainError("MAPS_PROVIDER_UNAVAILABLE","A real routing provider is not configured",503);
  const pickup=point(input.pickup,"pickup"),dropoff=point(input.dropoff,"dropoff");
  const trip=await loadTrip(pool,input.tripId);
  if(trip.driver_user_id===principal.userId){
    throw new DomainError("DRIVER_CANNOT_REQUEST_OWN_TRIP","Driver cannot request a seat on their own trip",409);
  }
  const already=await pool.query(`
    select 1 from ride_requests where trip_id=$1 and passenger_user_id=$2
       and status in ('pending','accepted','payment_pending','confirmed') limit 1`,[input.tripId,principal.userId]);
  if(already.rowCount) throw new DomainError("ALREADY_ON_TRIP","You already have an open request on this trip",409);

  const p=await planRouteChange(pool,provider,input.tripId,pickup,dropoff);
  p.plan.stops[p.pickupSeq]!.label=label(input.pickupLabel);
  p.plan.stops[p.dropoffSeq]!.label=label(input.dropoffLabel);

  return tx(pool,async client=>{
    try{
      const row=(await client.query(`
        insert into route_change_proposals(
          trip_id,requester_user_id,base_route_version,pickup_geom,dropoff_geom,pickup_label,dropoff_label,
          pickup_stop_seq,dropoff_stop_seq,plan,added_distance_m,added_duration_s,expires_at)
        values($1,$2,$3,ST_SetSRID(ST_Point($4,$5),4326),ST_SetSRID(ST_Point($6,$7),4326),$8,$9,
          $10,$11,$12::jsonb,$13,$14,now()+make_interval(secs=>$15))
        returning id,status,added_distance_m,added_duration_s,expires_at`,
        [input.tripId,principal.userId,p.trip.route_version,pickup.longitude,pickup.latitude,
         dropoff.longitude,dropoff.latitude,label(input.pickupLabel),label(input.dropoffLabel),
         p.pickupSeq,p.dropoffSeq,JSON.stringify(p.plan),p.addedDistanceM,p.addedDurationS,PROPOSAL_TTL_S])).rows[0];
      await client.query(`
        insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
        values($1,'route_change.requested','route_change',$2,$3::jsonb)`,
        [principal.userId,row.id,JSON.stringify({tripId:input.tripId,addedDistanceM:p.addedDistanceM,addedDurationS:p.addedDurationS})]);
      await notify(client,p.trip.driver_user_id,"route_change.requested",input.tripId,{
        proposalId:row.id,passengerName:await displayName(client,principal.userId),
        addedDistanceM:p.addedDistanceM,addedDurationS:p.addedDurationS
      });
      return row;
    }catch(error:any){
      if(error?.code==="23505") throw new DomainError("DUPLICATE_OPEN_ROUTE_CHANGE","You already asked this driver for a detour",409);
      throw error;
    }
  });
}

async function expireStale(db:Pool|PoolClient){
  await db.query(`
    update route_change_proposals set status='expired',decided_at=now()
     where status in ('awaiting_driver','awaiting_passengers') and expires_at<=now()`);
}

async function lockProposal(client:PoolClient,id:string){
  await expireStale(client);
  const p=(await client.query(`select * from route_change_proposals where id=$1 for update`,[id])).rows[0];
  if(!p) throw new DomainError("ROUTE_CHANGE_NOT_FOUND","Route change not found",404);
  return p;
}

async function closeProposal(client:PoolClient,p:any,status:"rejected"|"expired",reason:string,actor:string){
  await client.query(`update route_change_proposals set status=$2,decided_at=now() where id=$1`,[p.id,status]);
  await client.query(`
    insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
    values($1,$2,'route_change',$3,$4::jsonb)`,
    [actor,`route_change.${status}`,p.id,JSON.stringify({reason})]);
  const trip=await loadTrip(client,p.trip_id);
  const asked=(await client.query(`select passenger_user_id from route_change_responses where proposal_id=$1`,[p.id])).rows
    .map(r=>r.passenger_user_id);
  await notify(client,[p.requester_user_id,trip.driver_user_id,...asked].filter(u=>u!==actor),
    "route_change.rejected",p.trip_id,{proposalId:p.id,reason});
}

/** Pickup and arrival delay for each confirmed passenger if the plan were applied. */
async function delaysFor(client:PoolClient,p:any){
  const plan=p.plan as RouteChangePlan;
  const old=(await client.query(`select duration_s from trip_segments where trip_id=$1 order by seq`,[p.trip_id])).rows
    .map(r=>r.duration_s as number);
  const cum=(arr:number[])=>arr.reduce<number[]>((acc,v)=>{acc.push(acc[acc.length-1]!+v);return acc;},[0]);
  const oldCum=cum(old),newCum=cum(plan.segments.map(s=>s.durationS));
  const rows=(await client.query(`
    select b.id as booking_id,r.passenger_user_id,r.from_segment_seq,r.to_segment_seq,b.picked_up_at
      from ride_requests r join bookings b on b.request_id=r.id
     where r.trip_id=$1 and r.status='confirmed' and b.status='confirmed'`,[p.trip_id])).rows;
  return rows.map(r=>{
    const pickupDelay=r.picked_up_at?0:newCum[newIndexOf(plan,r.from_segment_seq)]!-oldCum[r.from_segment_seq]!;
    const arrivalDelay=newCum[newIndexOf(plan,r.to_segment_seq)]!-oldCum[r.to_segment_seq]!;
    return {bookingId:r.booking_id as string,passengerUserId:r.passenger_user_id as string,
      delayS:Math.max(0,Math.round(Math.max(pickupDelay,arrivalDelay)))};
  });
}

export async function decideRouteChange(pool:Pool,principal:AuthPrincipal,id:string,decision:"accept"|"reject"){
  requireAnyRole(principal,["driver"]);
  if(decision!=="accept"&&decision!=="reject") throw new DomainError("INVALID_DECISION","Decision must be accept or reject");
  return tx(pool,async client=>{
    const p=await lockProposal(client,id);
    const trip=await loadTrip(client,p.trip_id,true);
    if(trip.driver_user_id!==principal.userId) throw new DomainError("TRIP_NOT_OWNED","Only the trip driver can decide this detour",403);
    if(p.status!=="awaiting_driver") throw new DomainError("ROUTE_CHANGE_NOT_PENDING","This detour request is no longer waiting for you",409);
    if(decision==="reject"){
      await closeProposal(client,p,"rejected","driver",principal.userId);
      return {id:p.id,status:"rejected"};
    }
    if(trip.route_version!==p.base_route_version){
      await closeProposal(client,p,"expired","route_changed",principal.userId);
      return {id:p.id,status:"expired"};
    }
    const flex=trip.flexibility_minutes*60;
    const material=(await delaysFor(client,p)).filter(d=>d.delayS>flex);
    if(!material.length) return applyProposal(client,p,principal.userId);

    for(const m of material){
      await client.query(`
        insert into route_change_responses(proposal_id,passenger_user_id,booking_id,extra_delay_s)
        values($1,$2,$3,$4)`,[p.id,m.passengerUserId,m.bookingId,m.delayS]);
      await notify(client,m.passengerUserId,"route_change.proposed",p.trip_id,{
        proposalId:p.id,driverName:await displayName(client,trip.driver_user_id),extraDelayS:m.delayS
      });
    }
    await client.query(`
      update route_change_proposals set status='awaiting_passengers',
             expires_at=greatest(expires_at,now()+make_interval(secs=>$2)) where id=$1`,[p.id,PROPOSAL_TTL_S]);
    await client.query(`
      insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
      values($1,'route_change.driver_accepted','route_change',$2,$3::jsonb)`,
      [principal.userId,p.id,JSON.stringify({passengersAsked:material.length})]);
    return {id:p.id,status:"awaiting_passengers",passengersAsked:material.length};
  });
}

export async function respondRouteChange(pool:Pool,principal:AuthPrincipal,id:string,decision:"accept"|"reject"){
  requireAnyRole(principal,["passenger"]);
  if(decision!=="accept"&&decision!=="reject") throw new DomainError("INVALID_DECISION","Decision must be accept or reject");
  return tx(pool,async client=>{
    const p=await lockProposal(client,id);
    await loadTrip(client,p.trip_id,true);
    const mine=(await client.query(`
      select decision from route_change_responses where proposal_id=$1 and passenger_user_id=$2 for update`,
      [id,principal.userId])).rows[0];
    if(!mine) throw new DomainError("ROUTE_CHANGE_NOT_ASKED","This change does not need your answer",403);
    if(p.status!=="awaiting_passengers"||mine.decision!=="pending"){
      throw new DomainError("ROUTE_CHANGE_NOT_PENDING","This change is no longer waiting for your answer",409);
    }
    await client.query(`
      update route_change_responses set decision=$3,decided_at=now()
       where proposal_id=$1 and passenger_user_id=$2`,[id,principal.userId,decision==="accept"?"accepted":"rejected"]);
    if(decision==="reject"){
      await closeProposal(client,p,"rejected","passenger",principal.userId);
      return {id,status:"rejected"};
    }
    const pending=(await client.query(`
      select count(*)::int as n from route_change_responses where proposal_id=$1 and decision<>'accepted'`,[id])).rows[0].n;
    if(pending>0) return {id,status:"awaiting_passengers"};
    return applyProposal(client,p,principal.userId);
  });
}

/** Writes the new stops, segments and route, renumbers every request, and holds the new passenger's seat. */
async function applyProposal(client:PoolClient,p:any,actor:string){
  const plan=p.plan as RouteChangePlan;
  const trip=await loadTrip(client,p.trip_id,true);
  if(!["published","active"].includes(trip.status)||trip.route_version!==p.base_route_version){
    await closeProposal(client,p,"expired","route_changed",actor);
    return {id:p.id,status:"expired"};
  }
  if(trip.status==="active"){
    const progress=await tripProgress(client,p.trip_id);
    const before=plan.stops[p.pickup_stop_seq-1]!.oldSeq!;
    if(!progress.live||progress.passedStopSeq>before){
      await closeProposal(client,p,"expired",progress.live?"pickup_passed":"position_stale",actor);
      return {id:p.id,status:"expired"};
    }
  }
  await client.query(`select id from trip_segments where trip_id=$1 for update`,[p.trip_id]);
  try{
    assertSeats(plan,p.pickup_stop_seq,p.dropoff_stop_seq,await occupancy(client,p.trip_id));
  }catch(error){
    await closeProposal(client,p,"expired","no_capacity",actor);
    return {id:p.id,status:"expired"};
  }

  // The mapping only moves seqs forward, so renumbering from the end never collides with a row not yet moved.
  const requests=(await client.query(`
    select id,from_segment_seq,to_segment_seq from ride_requests where trip_id=$1
     order by from_segment_seq desc,to_segment_seq desc`,[p.trip_id])).rows;
  for(const r of requests){
    const from=newIndexOf(plan,r.from_segment_seq),to=newIndexOf(plan,r.to_segment_seq);
    await client.query(`update ride_requests set from_segment_seq=$2,to_segment_seq=$3 where id=$1`,[r.id,from,to]);
    await client.query(`update quote_snapshots set from_segment_seq=$2,to_segment_seq=$3 where request_id=$1`,[r.id,from,to]);
  }

  await client.query(`delete from trip_segments where trip_id=$1`,[p.trip_id]);
  await client.query(`delete from trip_stops where trip_id=$1`,[p.trip_id]);
  for(let i=0;i<plan.stops.length;i++){
    const s=plan.stops[i]!;
    await client.query(`insert into trip_stops(trip_id,seq,kind,label,geom) values($1,$2,$3,$4,ST_SetSRID(ST_Point($5,$6),4326))`,
      [p.trip_id,i,s.kind,s.label,s.longitude,s.latitude]);
  }
  for(let i=0;i<plan.segments.length;i++){
    const s=plan.segments[i]!;
    await client.query(`
      insert into trip_segments(trip_id,seq,from_stop_seq,to_stop_seq,distance_m,duration_s,capacity)
      values($1,$2,$2,$3,$4,$5,$6)`,[p.trip_id,i,i+1,s.distanceM,s.durationS,s.capacity]);
  }
  await client.query(`
    update trips set route_geom=ST_SetSRID(ST_GeomFromGeoJSON($2),4326)::geometry(LineString,4326),
           route_distance_m=$3,route_duration_s=$4,route_provider=$5,route_provider_ref=$6,
           route_version=route_version+1,updated_at=now()
     where id=$1`,
    [p.trip_id,JSON.stringify(plan.route.geometry),plan.route.distanceM,plan.route.durationS,
     plan.route.provider,plan.route.providerRef]);

  const req=(await client.query(`
    insert into ride_requests(trip_id,passenger_user_id,from_segment_seq,to_segment_seq,status)
    values($1,$2,$3,$4,'payment_pending') returning id`,
    [p.trip_id,p.requester_user_id,p.pickup_stop_seq,p.dropoff_stop_seq])).rows[0];
  const hold=(await client.query(`
    insert into seat_holds(request_id,status,expires_at) values($1,'active',now()+make_interval(secs=>$2))
    returning id,expires_at`,[req.id,HOLD_TTL_S])).rows[0];
  const quote=await snapshotQuoteForRequest(client,req.id);
  await client.query(`
    update route_change_proposals set status='applied',request_id=$2,decided_at=now() where id=$1`,[p.id,req.id]);
  await client.query(`
    insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
    values($1,'route_change.applied','route_change',$2,$3::jsonb)`,
    [actor,p.id,JSON.stringify({requestId:req.id,routeDistanceM:plan.route.distanceM,stops:plan.stops.length})]);
  const asked=(await client.query(`select passenger_user_id from route_change_responses where proposal_id=$1`,[p.id])).rows
    .map(r=>r.passenger_user_id);
  const holdExpiresAt=new Date(hold.expires_at).toISOString();
  await notify(client,p.requester_user_id,"route_change.applied",p.trip_id,{
    proposalId:p.id,requestId:req.id,holdExpiresAt,driverName:await displayName(client,trip.driver_user_id)
  });
  await notify(client,[trip.driver_user_id,...asked].filter(u=>u!==actor),"route_change.applied",p.trip_id,{
    proposalId:p.id,passengerName:await displayName(client,p.requester_user_id)
  });
  return {id:p.id,status:"applied",requestId:req.id,hold:{id:hold.id,expiresAt:holdExpiresAt},quote};
}

const PUBLIC_COLUMNS=`
  rc.id,rc.trip_id,rc.status::text,rc.added_distance_m,rc.added_duration_s,rc.expires_at,rc.created_at,
  rc.pickup_label,rc.dropoff_label,ST_Y(rc.pickup_geom) as pickup_latitude,ST_X(rc.pickup_geom) as pickup_longitude,
  ST_Y(rc.dropoff_geom) as dropoff_latitude,ST_X(rc.dropoff_geom) as dropoff_longitude,rc.request_id`;

export async function listTripRouteChanges(pool:Pool,principal:AuthPrincipal,tripId:string){
  requireAnyRole(principal,["driver"]);
  const trip=await loadTrip(pool,tripId);
  if(trip.driver_user_id!==principal.userId) throw new DomainError("TRIP_NOT_OWNED","Only the trip driver can view detour requests",403);
  await expireStale(pool);
  return (await pool.query(`
    select ${PUBLIC_COLUMNS},pp.display_name as passenger_display_name,
           (select count(*)::int from route_change_responses x where x.proposal_id=rc.id and x.decision='pending') as answers_pending
      from route_change_proposals rc left join profiles pp on pp.user_id=rc.requester_user_id
     where rc.trip_id=$1 and (rc.status in ('awaiting_driver','awaiting_passengers') or rc.created_at>now()-interval '1 day')
     order by rc.created_at desc`,[tripId])).rows;
}

export async function listOwnRouteChanges(pool:Pool,principal:AuthPrincipal){
  requireAnyRole(principal,["passenger"]);
  await expireStale(pool);
  const requested=(await pool.query(`
    select ${PUBLIC_COLUMNS},dp.display_name as driver_display_name,t.departure_at
      from route_change_proposals rc join trips t on t.id=rc.trip_id
      left join profiles dp on dp.user_id=t.driver_user_id
     where rc.requester_user_id=$1 and (rc.status in ('awaiting_driver','awaiting_passengers') or rc.created_at>now()-interval '1 day')
     order by rc.created_at desc`,[principal.userId])).rows;
  const toAnswer=(await pool.query(`
    select ${PUBLIC_COLUMNS},x.extra_delay_s,x.decision,dp.display_name as driver_display_name,
           pp.display_name as passenger_display_name
      from route_change_responses x join route_change_proposals rc on rc.id=x.proposal_id
      join trips t on t.id=rc.trip_id
      left join profiles dp on dp.user_id=t.driver_user_id
      left join profiles pp on pp.user_id=rc.requester_user_id
     where x.passenger_user_id=$1 and rc.status='awaiting_passengers' and x.decision='pending'
     order by rc.created_at`,[principal.userId])).rows;
  return {requested,toAnswer};
}

/** Trips whose route passes close enough to both points for a detour within the driver's own limit. */
export async function searchDetourCandidates(pool:Pool,input:{
  provinceId:string;origin:LatLng;destination:LatLng;limit?:number
}){
  const o=point(input.origin,"origin"),d=point(input.destination,"destination");
  const rows=(await pool.query(`
    with q as (select ST_SetSRID(ST_Point($2,$3),4326) as o,ST_SetSRID(ST_Point($4,$5),4326) as d)
    select t.id as trip_id,t.status::text,t.departure_at,t.max_detour_m,t.offered_seats,
           p.display_name as driver_display_name,
           round(ST_Distance(t.route_geom::geography,q.o::geography))::int as pickup_off_route_m,
           round(ST_Distance(t.route_geom::geography,q.d::geography))::int as dropoff_off_route_m
      from trips t cross join q
      join vehicles v on v.id=t.vehicle_id
      left join profiles p on p.user_id=t.driver_user_id
     where t.province_id=$1 and t.max_detour_m>0
       and v.vehicle_photo_status='approved' and v.insurance_status='approved'
       and v.insurance_expires_on>=current_date
       and ST_LineLocatePoint(t.route_geom,q.o) < ST_LineLocatePoint(t.route_geom,q.d)
       -- Going there and back roughly doubles the off-route distance.
       and 2*(ST_Distance(t.route_geom::geography,q.o::geography)+ST_Distance(t.route_geom::geography,q.d::geography))<=t.max_detour_m
       and (
         (t.status='published' and t.departure_at>=now()-interval '5 minutes')
         or (t.status='active' and exists(
           select 1 from trip_live_state l where l.trip_id=t.id and l.recorded_at>now()-interval '60 seconds'
              and ST_LineLocatePoint(t.route_geom,q.o)>ST_LineLocatePoint(t.route_geom,l.geom)))
       )
     order by t.departure_at nulls last limit $6`,
    [input.provinceId,o.longitude,o.latitude,d.longitude,d.latitude,input.limit??20])).rows;
  return rows.map(r=>({
    tripId:r.trip_id,inProgress:r.status==="active",
    departureAt:r.departure_at?new Date(r.departure_at).toISOString():null,
    driverDisplayName:r.driver_display_name,maxDetourM:r.max_detour_m,
    pickupOffRouteM:r.pickup_off_route_m,dropoffOffRouteM:r.dropoff_off_route_m
  }));
}
