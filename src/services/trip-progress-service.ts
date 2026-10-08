import type { Pool, PoolClient } from "pg";
import type { AuthPrincipal } from "../auth/session.js";
import { DomainError } from "../errors.js";
import { displayName, notify } from "./notification-service.js";

type Db=Pool|PoolClient;

/** A position older than this is shown as "last seen", never as live, and gives no ETA. */
export const LIVE_FRESH_SECONDS=60;
export const ARRIVING_ETA_S=120;
export const ARRIVING_DISTANCE_M=500;

export type StopProgress={
  seq:number;kind:string;label:string|null;latitude:number;longitude:number;
  passed:boolean;etaS:number|null;roadDistanceM:number|null;
};
export type TripProgress={
  status:string;
  live:boolean;
  stale:boolean;
  recordedAt:string|null;
  ageSeconds:number|null;
  /** Last stop the car has already gone past; -1 while it has not left the origin. */
  passedStopSeq:number;
  /** 0..1 position of the car along route_geom, when known. */
  carFraction:number|null;
  stops:StopProgress[];
};

/**
 * Where the car is along its own route, and the remaining road distance and time to every stop ahead.
 * Distance and time come from the provider's per-segment figures, prorated inside the current segment.
 * Traffic changes these figures; it never changes any price.
 */
export async function tripProgress(db:Db,tripId:string):Promise<TripProgress>{
  const trip=(await db.query(`select status::text from trips where id=$1`,[tripId])).rows[0];
  if(!trip) throw new DomainError("TRIP_NOT_FOUND","Trip not found",404);
  const stops=(await db.query<{seq:number;kind:string;label:string|null;lat:number;lng:number;f:number|null}>(`
    select st.seq,st.kind,st.label,ST_Y(st.geom) as lat,ST_X(st.geom) as lng,
           ST_LineLocatePoint(t.route_geom,st.geom) as f
      from trip_stops st join trips t on t.id=st.trip_id
     where st.trip_id=$1 order by st.seq`,[tripId])).rows;
  const segs=(await db.query<{distance_m:number;duration_s:number}>(
    `select distance_m,duration_s from trip_segments where trip_id=$1 order by seq`,[tripId])).rows;
  const car=(await db.query<{f:number|null;recorded_at:Date;age:number}>(`
    select ST_LineLocatePoint(t.route_geom,l.geom) as f,l.recorded_at,
           greatest(0,extract(epoch from now()-l.recorded_at))::int as age
      from trip_live_state l join trips t on t.id=l.trip_id
     where l.trip_id=$1`,[tripId])).rows[0];

  const active=trip.status==="active";
  const carF=active&&car?.f!=null?Number(car.f):null;
  const stale=!active||!car||car.age>LIVE_FRESH_SECONDS;
  let passed=-1;
  if(carF!=null){
    for(const s of stops) if(s.f!=null&&Number(s.f)<carF) passed=Math.max(passed,s.seq);
  }
  if(trip.status==="completed") passed=stops.length-1;

  const out:StopProgress[]=stops.map(s=>({
    seq:s.seq,kind:s.kind,label:s.label,latitude:Number(s.lat),longitude:Number(s.lng),
    passed:s.seq<=passed,etaS:null,roadDistanceM:null
  }));
  if(active&&carF!=null&&!stale){
    let t=0,d=0;
    if(passed>=0&&passed<segs.length){
      const a=Number(stops[passed]?.f??0),b=Number(stops[passed+1]?.f??1);
      const ratio=b>a?Math.min(1,Math.max(0,(b-carF)/(b-a))):1;
      t+=segs[passed]!.duration_s*ratio;
      d+=segs[passed]!.distance_m*ratio;
    }
    for(let i=passed+1;i<out.length;i++){
      if(i>passed+1){ t+=segs[i-1]!.duration_s; d+=segs[i-1]!.distance_m; }
      out[i]!.etaS=Math.round(t);
      out[i]!.roadDistanceM=Math.round(d);
    }
  }
  return {
    status:trip.status,
    live:active&&!stale,
    stale:active&&stale,
    recordedAt:car?new Date(car.recorded_at).toISOString():null,
    ageSeconds:car?car.age:null,
    passedStopSeq:passed,
    carFraction:carF,
    stops:out
  };
}

/** True when the trip can take a pickup at this stop: before departure, or still ahead of a freshly tracked car. */
export async function assertStopAhead(db:Db,tripId:string,stopSeq:number){
  const p=await tripProgress(db,tripId);
  if(p.status!=="active") return p;
  if(!p.live){
    throw new DomainError("LIVE_POSITION_STALE","The car's position is not recent enough to accept a pickup while moving",409);
  }
  if(stopSeq<=p.passedStopSeq){
    throw new DomainError("PICKUP_ALREADY_PASSED","The car has already passed this pickup point",409);
  }
  return p;
}

/** ETA for the driver (every stop) or a confirmed passenger (their pickup and drop-off). */
export async function tripEtaForViewer(pool:Pool,principal:AuthPrincipal,tripId:string){
  const trip=(await pool.query(`select driver_user_id from trips where id=$1`,[tripId])).rows[0];
  if(!trip) throw new DomainError("TRIP_NOT_FOUND","Trip not found",404);
  const isDriver=trip.driver_user_id===principal.userId;
  const mine=(await pool.query(`
    select r.from_segment_seq,r.to_segment_seq,b.picked_up_at
      from ride_requests r join bookings b on b.request_id=r.id
     where r.trip_id=$1 and r.passenger_user_id=$2 and r.status='confirmed' and b.status in ('confirmed','completed')
     limit 1`,[tripId,principal.userId])).rows[0];
  if(!isDriver&&!mine) throw new DomainError("TRIP_ETA_FORBIDDEN","Only the driver and confirmed passengers can see this trip's ETA",403);
  const p=await tripProgress(pool,tripId);
  let me=null;
  if(mine){
    const pickup=p.stops[mine.from_segment_seq],dropoff=p.stops[mine.to_segment_seq];
    me={
      pickupStopSeq:mine.from_segment_seq,
      dropoffStopSeq:mine.to_segment_seq,
      pickedUp:Boolean(mine.picked_up_at),
      pickupEtaS:mine.picked_up_at?null:pickup?.etaS??null,
      pickupDistanceM:mine.picked_up_at?null:pickup?.roadDistanceM??null,
      dropoffEtaS:dropoff?.etaS??null,
      dropoffDistanceM:dropoff?.roadDistanceM??null,
      arriving:!mine.picked_up_at&&pickup?.etaS!=null&&
        (pickup.etaS<=ARRIVING_ETA_S||(pickup.roadDistanceM??Infinity)<=ARRIVING_DISTANCE_M)
    };
  }
  return {...p,stops:isDriver?p.stops:[],me};
}

/** Sends one "your driver is arriving" notice per booking. Runs inside the location write transaction. */
export async function notifyArrivals(client:PoolClient,tripId:string):Promise<number>{
  const p=await tripProgress(client,tripId);
  if(!p.live) return 0;
  const due=(await client.query(`
    select b.id,r.passenger_user_id,r.from_segment_seq,t.driver_user_id
      from bookings b join ride_requests r on r.id=b.request_id join trips t on t.id=r.trip_id
     where r.trip_id=$1 and r.status='confirmed' and b.status='confirmed'
       and b.picked_up_at is null and b.arrival_notified_at is null`,[tripId])).rows;
  let sent=0;
  for(const row of due){
    const stop=p.stops[row.from_segment_seq];
    if(!stop||stop.passed||stop.etaS==null) continue;
    if(stop.etaS>ARRIVING_ETA_S&&(stop.roadDistanceM??Infinity)>ARRIVING_DISTANCE_M) continue;
    const upd=await client.query(
      `update bookings set arrival_notified_at=now() where id=$1 and arrival_notified_at is null`,[row.id]);
    if(!upd.rowCount) continue;
    await notify(client,row.passenger_user_id,"trip.driver_arriving",tripId,{
      driverName:await displayName(client,row.driver_user_id),etaS:stop.etaS,roadDistanceM:stop.roadDistanceM
    });
    sent++;
  }
  return sent;
}
