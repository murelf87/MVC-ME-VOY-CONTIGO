import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AuthPrincipal } from "../auth/session.js";
import { requireAnyRole } from "../auth/session.js";
import { DomainError } from "../errors.js";
import { createRideRequest, decideRideRequest } from "./request-service.js";
import { publishTrip } from "./trip-service.js";

const MAX_HORIZON_WEEKS=8;

async function tx<T>(pool:Pool,fn:(c:PoolClient)=>Promise<T>):Promise<T>{
  const client=await pool.connect();
  try{
    await client.query("begin");
    const out=await fn(client);
    await client.query("commit");
    return out;
  }catch(e){
    await client.query("rollback");
    throw e;
  }finally{
    client.release();
  }
}

function validWeekdays(days:number[]):number[]{
  const set=[...new Set(days)].sort();
  if(!set.length||set.some(d=>!Number.isInteger(d)||d<1||d>7)){
    throw new DomainError("INVALID_WEEKDAYS","Weekdays must be ISO numbers 1 (Monday) to 7 (Sunday)");
  }
  return set;
}

/**
 * Turns one of the driver's trips into a weekly series. The template's
 * verified route, stops and segments are copied to every occurrence; each
 * occurrence is then published through the normal checks, so a series
 * never bypasses vehicle, identity or province validation.
 */
export async function createTripSeries(
  pool:Pool,principal:AuthPrincipal,
  input:{tripId:string;weekdays:number[];endsOn?:string|null;horizonWeeks?:number}
){
  requireAnyRole(principal,["driver"]);
  const weekdays=validWeekdays(input.weekdays);
  const t=(await pool.query(`
    select id,driver_user_id,status,departure_at,series_id from trips where id=$1`,[input.tripId])).rows[0];
  if(!t) throw new DomainError("TRIP_NOT_FOUND","Trip not found",404);
  if(t.driver_user_id!==principal.userId) throw new DomainError("TRIP_NOT_OWNED","Only the driver can repeat this trip",403);
  if(t.series_id) throw new DomainError("TRIP_ALREADY_IN_SERIES","This trip already repeats",409);
  if(!["draft","published"].includes(t.status)||!t.departure_at){
    throw new DomainError("TRIP_NOT_REPEATABLE","Only an upcoming trip with a departure time can repeat",409);
  }
  if(input.endsOn&&!/^\d{4}-\d{2}-\d{2}$/.test(input.endsOn)){
    throw new DomainError("INVALID_END_DATE","endsOn must be YYYY-MM-DD");
  }

  const series=await tx(pool,async client=>{
    const s=await client.query(`
      insert into trip_series(driver_user_id,template_trip_id,weekdays,local_time,timezone,starts_on,ends_on)
      select $1,t.id,$3::smallint[],(t.departure_at at time zone 'Europe/Madrid')::time,'Europe/Madrid',
             (t.departure_at at time zone 'Europe/Madrid')::date,$4::date
        from trips t where t.id=$2
      returning *`,[principal.userId,t.id,weekdays,input.endsOn??null]);
    await client.query(`update trips set series_id=$2,kind='recurring',updated_at=now() where id=$1`,[t.id,s.rows[0].id]);
    await client.query(`
      insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
      values($1,'trip_series.created','trip_series',$2,$3)`,[principal.userId,s.rows[0].id,{templateTripId:t.id,weekdays}]);
    return s.rows[0];
  });
  const materialized=await materializeSeries(pool,series.id,input.horizonWeeks??4);
  return {series,...materialized};
}

/**
 * Creates and publishes missing occurrences up to the horizon. Idempotent:
 * the unique (series_id, departure_at) index makes repeated runs no-ops, so
 * it can run from a scheduler as well as on demand.
 */
export async function materializeSeries(pool:Pool,seriesId:string,horizonWeeks=4){
  const weeks=Math.min(Math.max(Math.trunc(horizonWeeks),1),MAX_HORIZON_WEEKS);
  const s=(await pool.query(`select * from trip_series where id=$1`,[seriesId])).rows[0];
  if(!s) throw new DomainError("SERIES_NOT_FOUND","Series not found",404);
  if(s.status!=="active") return {created:[] as string[],published:[] as string[],failed:[] as Array<{tripId:string;code:string}>};

  const created:string[]=await tx(pool,async client=>{
    const ins=await client.query(`
      with days as (
        select d::date as day
          from generate_series(current_date, current_date + ($2::int*7), interval '1 day') d
      ),
      wanted as (
        select ((day + s.local_time) at time zone s.timezone) as departure_at
          from days, trip_series s
         where s.id=$1
           and extract(isodow from day)::smallint = any(s.weekdays)
           and day >= s.starts_on
           and (s.ends_on is null or day <= s.ends_on)
      )
      insert into trips(driver_user_id,vehicle_id,province_id,category,kind,leg,status,departure_at,
        flexibility_minutes,max_detour_m,offered_seats,origin_geom,destination_geom,route_geom,
        route_distance_m,route_duration_s,route_provider,route_provider_ref,series_id)
      select t.driver_user_id,t.vehicle_id,t.province_id,t.category,'recurring',t.leg,'draft',w.departure_at,
             t.flexibility_minutes,t.max_detour_m,t.offered_seats,t.origin_geom,t.destination_geom,t.route_geom,
             t.route_distance_m,t.route_duration_s,t.route_provider,t.route_provider_ref,$1
        from wanted w
        join trip_series s on s.id=$1
        join trips t on t.id=s.template_trip_id
       where w.departure_at > now()
      on conflict (series_id,departure_at) where series_id is not null do nothing
      returning id`,[seriesId,weeks]);
    const ids=ins.rows.map(r=>r.id as string);
    for(const id of ids){
      await client.query(`
        insert into trip_stops(trip_id,seq,kind,label,geom)
        select $1,seq,kind,label,geom from trip_stops where trip_id=$2`,[id,s.template_trip_id]);
      await client.query(`
        insert into trip_segments(trip_id,seq,from_stop_seq,to_stop_seq,distance_m,duration_s,capacity)
        select $1,seq,from_stop_seq,to_stop_seq,distance_m,duration_s,capacity from trip_segments where trip_id=$2`,
        [id,s.template_trip_id]);
    }
    return ids;
  });

  // Publish the new occurrences only if the template itself is published.
  const template=(await pool.query(`select status from trips where id=$1`,[s.template_trip_id])).rows[0];
  const published:string[]=[];const failed:Array<{tripId:string;code:string}>=[];
  if(template?.status==="published"||template?.status==="active"||template?.status==="completed"){
    for(const id of created){
      try{ await publishTrip(pool,id); published.push(id); }
      catch(e){ failed.push({tripId:id,code:e instanceof DomainError?e.code:"PUBLISH_FAILED"}); }
    }
  }
  return {created,published,failed};
}

/** Scheduler entry point: keeps every active series filled up to the horizon. */
export async function materializeAllSeries(pool:Pool,horizonWeeks=4){
  const ids=(await pool.query(`select id from trip_series where status='active'`)).rows.map(r=>r.id as string);
  const out=[];
  for(const id of ids) out.push({seriesId:id,...await materializeSeries(pool,id,horizonWeeks)});
  return out;
}

export async function setSeriesStatus(pool:Pool,principal:AuthPrincipal,input:{seriesId:string;status:"active"|"paused"|"ended"}){
  requireAnyRole(principal,["driver"]);
  const r=await pool.query(`
    update trip_series set status=$3,updated_at=now()
     where id=$1 and driver_user_id=$2 and status<>'ended' returning id,status`,[input.seriesId,principal.userId,input.status]);
  if(!r.rowCount) throw new DomainError("SERIES_NOT_FOUND","Series not found or already ended",404);
  await pool.query(`
    insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
    values($1,'trip_series.status_changed','trip_series',$2,$3)`,[principal.userId,input.seriesId,{status:input.status}]);
  if(input.status==="active") await materializeSeries(pool,input.seriesId);
  return r.rows[0];
}

export async function listOwnSeries(pool:Pool,principal:AuthPrincipal){
  requireAnyRole(principal,["driver"]);
  return (await pool.query(`
    select s.id,s.weekdays,s.local_time,s.starts_on,s.ends_on,s.status,s.template_trip_id,
           (select count(*)::int from trips t where t.series_id=s.id and t.status='published' and t.departure_at>now()) as upcoming
      from trip_series s where s.driver_user_id=$1 order by s.created_at desc`,[principal.userId])).rows;
}

/** Upcoming published occurrences of a series in one ISO week (Monday date). */
export async function seriesWeek(pool:Pool,seriesId:string,weekStart:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw new DomainError("INVALID_WEEK","weekStart must be YYYY-MM-DD");
  const s=(await pool.query(`select id,weekdays,local_time,status,timezone from trip_series where id=$1`,[seriesId])).rows[0];
  if(!s) throw new DomainError("SERIES_NOT_FOUND","Series not found",404);
  const trips=(await pool.query(`
    select id,departure_at,status,extract(isodow from departure_at at time zone $3)::int as dow from trips
     where series_id=$1 and status='published' and departure_at>now()
       and (departure_at at time zone $3)::date >= date_trunc('week',$2::date)::date
       and (departure_at at time zone $3)::date <  date_trunc('week',$2::date)::date + 7
     order by departure_at`,[seriesId,weekStart,s.timezone])).rows;
  return {series:s,trips};
}

/**
 * Books the same seat range on every bookable occurrence of one week. Each
 * occurrence is requested in its own transaction with the usual capacity
 * locks, so a full day is reported back instead of failing the whole week,
 * and the open-request unique index stops double bookings.
 */
export async function requestSeriesWeek(
  pool:Pool,principal:AuthPrincipal,
  input:{seriesId:string;weekStart:string;fromSegmentSeq:number;toSegmentSeq:number;weekdays?:number[]}
){
  requireAnyRole(principal,["passenger"]);
  const {trips}=await seriesWeek(pool,input.seriesId,input.weekStart);
  const only=input.weekdays?.length?new Set(validWeekdays(input.weekdays)):null;
  const groupId=crypto.randomUUID();
  const results:Array<{tripId:string;departureAt:string;status:"requested"|"skipped";code?:string;requestId?:string}>=[];
  for(const t of trips){
    if(only&&!only.has(t.dow)) continue;
    try{
      const r=await createRideRequest(pool,principal,{tripId:t.id,fromSegmentSeq:input.fromSegmentSeq,toSegmentSeq:input.toSegmentSeq});
      await pool.query(`update ride_requests set weekly_group_id=$2 where id=$1`,[r.id,groupId]);
      results.push({tripId:t.id,departureAt:new Date(t.departure_at).toISOString(),status:"requested",requestId:r.id});
    }catch(e){
      if(!(e instanceof DomainError)) throw e;
      results.push({tripId:t.id,departureAt:new Date(t.departure_at).toISOString(),status:"skipped",code:e.code});
    }
  }
  if(!results.some(r=>r.status==="requested")){
    throw new DomainError("WEEK_NOT_BOOKABLE","No occurrence of that week could be requested",409,{results});
  }
  return {weeklyGroupId:groupId,results};
}

/** Driver accepts or rejects a passenger's whole week at once; each day keeps its own capacity check. */
export async function decideWeeklyGroup(
  pool:Pool,principal:AuthPrincipal,input:{groupId:string;decision:"accept"|"reject"}
){
  requireAnyRole(principal,["driver"]);
  const reqs=(await pool.query(`
    select r.id,r.trip_id,t.driver_user_id from ride_requests r join trips t on t.id=r.trip_id
     where r.weekly_group_id=$1 and r.status='pending' order by t.departure_at`,[input.groupId])).rows;
  if(!reqs.length) throw new DomainError("WEEKLY_GROUP_NOT_FOUND","No pending requests in that week",404);
  if(reqs.some(r=>r.driver_user_id!==principal.userId)) throw new DomainError("TRIP_NOT_OWNED","Not your trips",403);
  const results=[];
  for(const r of reqs){
    try{
      await decideRideRequest(pool,principal,r.id,input.decision);
      results.push({requestId:r.id,tripId:r.trip_id,status:input.decision==="accept"?"accepted":"rejected"});
    }catch(e){
      if(!(e instanceof DomainError)) throw e;
      results.push({requestId:r.id,tripId:r.trip_id,status:"failed",code:e.code});
    }
  }
  return {results};
}
