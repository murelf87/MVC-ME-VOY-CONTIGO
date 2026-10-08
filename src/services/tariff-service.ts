import type { Pool, PoolClient } from "pg";
import type { AuthPrincipal } from "../auth/session.js";
import { requireAnyRole } from "../auth/session.js";
import { DomainError } from "../errors.js";
import { buildBreakdown, contributionForRoadDistance, roundHalfUp } from "../domain/money.js";

type Db=Pool|PoolClient;
const FINANCE=["admin","finance_admin"] as const;

export type Tariff={
  id:string;version:number;rate_micros_per_km:number;passenger_commission_bps:number;
  driver_commission_bps:number;shared_cost_cap_cents:number|null;
};

function bps(cents:number,b:number){ return Number(roundHalfUp(BigInt(cents)*BigInt(b),10000n)); }

/** Pure quote from routed meters and a tariff; processing and taxes stay 0 until the payment provider and tax advice define them. */
export function quoteFromTariff(tariff:Tariff,roadDistanceM:number){
  let contribution=contributionForRoadDistance(roadDistanceM,tariff.rate_micros_per_km);
  if(tariff.shared_cost_cap_cents!=null) contribution=Math.min(contribution,tariff.shared_cost_cap_cents);
  return buildBreakdown({
    contributionCents:contribution,
    passengerCommissionCents:bps(contribution,tariff.passenger_commission_bps),
    driverCommissionCents:bps(contribution,tariff.driver_commission_bps)
  });
}

export async function activeTariff(db:Db):Promise<Tariff|null>{
  const q=await db.query(`
    select id,version,rate_micros_per_km,passenger_commission_bps,driver_commission_bps,shared_cost_cap_cents
      from tariff_versions where status='approved' and (effective_from is null or effective_from<=now())`);
  return q.rows[0]??null;
}

/** Real road meters of the passenger's own segment range, not the whole trip. */
export async function rangeDistance(db:Db,tripId:string,fromSeq:number,toSeq:number):Promise<number>{
  const q=await db.query(`
    select coalesce(sum(distance_m),0)::int as m,count(*)::int as n
      from trip_segments where trip_id=$1 and seq>=$2 and seq<$3`,[tripId,fromSeq,toSeq]);
  if(q.rows[0].n!==toSeq-fromSeq||q.rows[0].n<1) throw new DomainError("INVALID_SEGMENT_RANGE","Segment range is invalid");
  return q.rows[0].m;
}

export async function quoteRange(db:Db,tripId:string,fromSeq:number,toSeq:number){
  const roadDistanceM=await rangeDistance(db,tripId,fromSeq,toSeq);
  const tariff=await activeTariff(db);
  if(!tariff) return {available:false as const,reason:"TARIFF_NOT_APPROVED",roadDistanceM};
  return {available:true as const,tariffVersion:tariff.version,tariffId:tariff.id,roadDistanceM,...quoteFromTariff(tariff,roadDistanceM)};
}

/** Freezes the price at acceptance time so later tariff changes never alter an agreed amount. */
export async function snapshotQuoteForRequest(client:PoolClient,requestId:string){
  const r=(await client.query(`select trip_id,from_segment_seq,to_segment_seq from ride_requests where id=$1`,[requestId])).rows[0];
  if(!r) return null;
  const q=await quoteRange(client,r.trip_id,r.from_segment_seq,r.to_segment_seq);
  if(!q.available) return null;
  const ins=await client.query(`
    insert into quote_snapshots(request_id,tariff_version_id,road_distance_m,contribution_cents,
      passenger_commission_cents,driver_commission_cents,processing_cents,taxes_cents,
      passenger_total_cents,driver_net_cents,from_segment_seq,to_segment_seq)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    on conflict (request_id) where request_id is not null do nothing
    returning *`,
    [requestId,q.tariffId,q.roadDistanceM,q.contributionCents,q.passengerCommissionCents,q.driverCommissionCents,
     q.processingCents,q.taxesCents,q.passengerTotalCents,q.driverNetCents,r.from_segment_seq,r.to_segment_seq]);
  return ins.rows[0]??null;
}

export async function adminListTariffs(pool:Pool,principal:AuthPrincipal){
  requireAnyRole(principal,FINANCE);
  return (await pool.query(`
    select id,version,status,rate_micros_per_km,passenger_commission_bps,driver_commission_bps,
           shared_cost_cap_cents,effective_from,notes,created_at,approved_at,retired_at
      from tariff_versions order by version desc`)).rows;
}

export async function adminCreateTariff(pool:Pool,principal:AuthPrincipal,input:{
  rateMicrosPerKm:number;passengerCommissionBps:number;driverCommissionBps:number;
  sharedCostCapCents?:number|null;notes?:string|null
}){
  requireAnyRole(principal,FINANCE);
  const ints:[string,number,number,number][]=[
    ["rateMicrosPerKm",input.rateMicrosPerKm,0,10_000_000],
    ["passengerCommissionBps",input.passengerCommissionBps,0,10000],
    ["driverCommissionBps",input.driverCommissionBps,0,10000]
  ];
  for(const [k,v,min,max] of ints){
    if(!Number.isInteger(v)||v<min||v>max) throw new DomainError("INVALID_TARIFF",`${k} must be an integer between ${min} and ${max}`);
  }
  if(input.sharedCostCapCents!=null&&(!Number.isInteger(input.sharedCostCapCents)||input.sharedCostCapCents<0)){
    throw new DomainError("INVALID_TARIFF","sharedCostCapCents must be a non-negative integer");
  }
  const client=await pool.connect();
  try{
    await client.query("begin");
    await client.query(`lock table tariff_versions in share row exclusive mode`);
    const next=(await client.query(`select coalesce(max(version),0)+1 as v from tariff_versions`)).rows[0].v;
    const r=await client.query(`
      insert into tariff_versions(version,status,rate_micros_per_km,passenger_commission_bps,driver_commission_bps,
        shared_cost_cap_cents,notes,created_by)
      values($1,'draft',$2,$3,$4,$5,$6,$7) returning *`,
      [next,input.rateMicrosPerKm,input.passengerCommissionBps,input.driverCommissionBps,input.sharedCostCapCents??null,
       input.notes?.trim()||null,principal.userId]);
    await client.query(`
      insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
      values($1,'tariff.created','tariff',$2,$3)`,[principal.userId,r.rows[0].id,{version:next}]);
    await client.query("commit");
    return r.rows[0];
  }catch(e){
    await client.query("rollback");
    throw e;
  }finally{
    client.release();
  }
}

export async function adminApproveTariff(pool:Pool,principal:AuthPrincipal,tariffId:string){
  requireAnyRole(principal,FINANCE);
  const client=await pool.connect();
  try{
    await client.query("begin");
    const t=(await client.query(`select * from tariff_versions where id=$1 for update`,[tariffId])).rows[0];
    if(!t) throw new DomainError("TARIFF_NOT_FOUND","Tariff not found",404);
    if(t.status!=="draft") throw new DomainError("TARIFF_NOT_DRAFT","Only draft tariffs can be approved",409);
    if(t.rate_micros_per_km==null) throw new DomainError("TARIFF_HAS_NO_RATE","Tariff has no rate",409);
    await client.query(`update tariff_versions set status='retired',retired_at=now() where status='approved'`);
    const r=await client.query(`
      update tariff_versions set status='approved',approved_by=$2,approved_at=now() where id=$1 returning *`,[tariffId,principal.userId]);
    await client.query(`
      insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
      values($1,'tariff.approved','tariff',$2,$3)`,[principal.userId,tariffId,{version:t.version}]);
    await client.query("commit");
    return r.rows[0];
  }catch(e){
    await client.query("rollback");
    throw e;
  }finally{
    client.release();
  }
}
