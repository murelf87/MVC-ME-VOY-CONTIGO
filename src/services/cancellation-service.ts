import type { Pool, PoolClient } from "pg";
import type { AuthPrincipal } from "../auth/session.js";
import { requireAnyRole } from "../auth/session.js";
import { DomainError } from "../errors.js";
import { computeRefund, parseCancellationRules } from "../domain/cancellation-policy.js";

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

type Actor="passenger"|"driver"|"platform"|"force_majeure";

/**
 * Records the cancellation of one paid booking under the policy version the
 * passenger accepted when paying. Payments are not wired to a provider yet,
 * so a computed refund stays "pending_provider" until the provider executes it.
 */
async function cancelBooking(
  client:PoolClient,
  booking:{id:string;amount_cents:number;cancellation_policy_version_id:string|null;request_id:string},
  ctx:{actor:Actor;userId:string|null;reason:string|null;tripStarted:boolean;departureAt:Date|null;bookingStatus:"cancelled"|"driver_cancelled"}
){
  const minutes=ctx.departureAt?Math.floor((ctx.departureAt.getTime()-Date.now())/60000):null;
  let policyId=booking.cancellation_policy_version_id;
  let refund:{ruleApplied:string;refundCents:number;retainedCents:number}|null=null;
  if(policyId){
    const p=await client.query(`select rules from cancellation_policy_versions where id=$1`,[policyId]);
    const quote=await client.query(`
      select passenger_commission_cents from quote_snapshots where request_id=$1
       order by created_at desc limit 1`,[booking.request_id]);
    refund=computeRefund(parseCancellationRules(p.rows[0].rules),{
      actor:ctx.actor,tripStarted:ctx.tripStarted,minutesBeforeDeparture:minutes,
      paidCents:booking.amount_cents,passengerFeeCents:quote.rows[0]?.passenger_commission_cents??0
    });
  }
  const refundStatus=booking.amount_cents===0?"not_applicable":refund?"pending_provider":"pending_policy";
  await client.query(`update bookings set status=$2,updated_at=now() where id=$1`,[booking.id,ctx.bookingStatus]);
  const row=await client.query(`
    insert into booking_cancellations(booking_id,actor,cancelled_by_user_id,reason,trip_started,
      minutes_before_departure,policy_version_id,rule_applied,paid_cents,refund_cents,retained_cents,refund_status)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    returning id,booking_id,actor,rule_applied,paid_cents,refund_cents,retained_cents,refund_status,created_at`,
    [booking.id,ctx.actor,ctx.userId,ctx.reason,ctx.tripStarted,minutes,policyId,refund?.ruleApplied??null,
     booking.amount_cents,refund?.refundCents??null,refund?.retainedCents??null,refundStatus]);
  return row.rows[0];
}

export async function cancelOwnRideRequest(
  pool:Pool,
  principal:AuthPrincipal,
  input:{requestId:string;reason?:string|null}
){
  requireAnyRole(principal,["passenger"]);
  const reason=input.reason?.trim()||null;
  return tx(pool,async client=>{
    const r=(await client.query(`select * from ride_requests where id=$1 for update`,[input.requestId])).rows[0];
    if(!r) throw new DomainError("REQUEST_NOT_FOUND","Ride request not found",404);
    if(r.passenger_user_id!==principal.userId) throw new DomainError("REQUEST_NOT_OWNED","Not your request",403);
    const trip=(await client.query(`select status,departure_at from trips where id=$1 for update`,[r.trip_id])).rows[0];

    let cancellation=null;
    if(["pending","accepted","payment_pending"].includes(r.status)){
      await client.query(`
        update seat_holds set status='released',released_at=now()
         where request_id=$1 and status='active'`,[r.id]);
    }else if(r.status==="confirmed"){
      const b=(await client.query(`select * from bookings where request_id=$1 for update`,[r.id])).rows[0];
      if(!b||b.status!=="confirmed") throw new DomainError("REQUEST_NOT_CANCELLABLE","Booking cannot be cancelled",409);
      if(b.picked_up_at) throw new DomainError("CANCEL_AFTER_PICKUP","You are already on board",409);
      if(trip.status==="completed") throw new DomainError("REQUEST_NOT_CANCELLABLE","Trip already completed",409);
      cancellation=await cancelBooking(client,b,{
        actor:"passenger",userId:principal.userId,reason,tripStarted:trip.status==="active",
        departureAt:trip.departure_at?new Date(trip.departure_at):null,bookingStatus:"cancelled"
      });
    }else{
      throw new DomainError("REQUEST_NOT_CANCELLABLE","This request can no longer be cancelled",409);
    }

    await client.query(`update ride_requests set status='cancelled',updated_at=now() where id=$1`,[r.id]);
    await client.query(`
      insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
      values($1,'ride_request.cancelled','ride_request',$2,$3)`,
      [principal.userId,r.id,{previousStatus:r.status,cancellationId:cancellation?.id??null}]);
    return {requestId:r.id,status:"cancelled",cancellation};
  });
}

export async function cancelOwnTrip(
  pool:Pool,
  principal:AuthPrincipal,
  input:{tripId:string;reason:string;forceMajeure?:boolean}
){
  requireAnyRole(principal,["driver"]);
  const reason=input.reason.trim();
  if(reason.length<3) throw new DomainError("CANCEL_REASON_REQUIRED","Tell passengers why the trip is cancelled");
  return tx(pool,async client=>{
    const trip=(await client.query(`select * from trips where id=$1 for update`,[input.tripId])).rows[0];
    if(!trip) throw new DomainError("TRIP_NOT_FOUND","Trip not found",404);
    if(trip.driver_user_id!==principal.userId) throw new DomainError("TRIP_NOT_OWNED","Only the driver can cancel this trip",403);
    if(trip.status==="active") throw new DomainError("TRIP_ALREADY_STARTED","A trip in progress cannot be cancelled; finish it instead",409);
    if(!["draft","published"].includes(trip.status)) throw new DomainError("TRIP_NOT_CANCELLABLE","Trip cannot be cancelled",409);

    const actor:Actor=input.forceMajeure?"force_majeure":"driver";
    const bookings=(await client.query(`
      select b.* from bookings b join ride_requests r on r.id=b.request_id
       where r.trip_id=$1 and b.status='confirmed' for update of b`,[trip.id])).rows;
    const cancellations=[];
    for(const b of bookings){
      cancellations.push(await cancelBooking(client,b,{
        actor,userId:principal.userId,reason,tripStarted:false,
        departureAt:trip.departure_at?new Date(trip.departure_at):null,bookingStatus:"driver_cancelled"
      }));
    }
    await client.query(`
      update seat_holds h set status='released',released_at=now()
        from ride_requests r where h.request_id=r.id and r.trip_id=$1 and h.status='active'`,[trip.id]);
    const affected=await client.query(`
      update ride_requests set status='cancelled',updated_at=now()
       where trip_id=$1 and status in ('pending','accepted','payment_pending','confirmed')
       returning passenger_user_id`,[trip.id]);
    await client.query(`update trips set status='cancelled' where id=$1`,[trip.id]);
    await client.query(`
      insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
      values($1,'trip.cancelled','trip',$2,$3)`,
      [principal.userId,trip.id,{actor,reason,bookings:bookings.length,requests:affected.rowCount}]);
    return {tripId:trip.id,status:"cancelled",affectedPassengers:affected.rowCount,cancellations};
  });
}

const POLICY_ROLES=["admin","finance_admin"] as const;

export async function getActiveCancellationPolicy(pool:Pool){
  const q=await pool.query(`
    select id,version,rules,notes,activated_at from cancellation_policy_versions where status='active'`);
  return q.rows[0]??null;
}

export async function adminListCancellationPolicies(pool:Pool,principal:AuthPrincipal){
  requireAnyRole(principal,POLICY_ROLES);
  return (await pool.query(`
    select id,version,status,rules,notes,created_at,activated_at,retired_at
      from cancellation_policy_versions order by version desc`)).rows;
}

export async function adminCreateCancellationPolicy(
  pool:Pool,principal:AuthPrincipal,input:{rules:unknown;notes?:string|null}
){
  requireAnyRole(principal,POLICY_ROLES);
  const rules=parseCancellationRules(input.rules);
  return tx(pool,async client=>{
    await client.query(`lock table cancellation_policy_versions in share row exclusive mode`);
    const next=(await client.query(`select coalesce(max(version),0)+1 as v from cancellation_policy_versions`)).rows[0].v;
    const r=await client.query(`
      insert into cancellation_policy_versions(version,status,rules,notes,created_by)
      values($1,'draft',$2,$3,$4) returning id,version,status,rules,notes,created_at`,
      [next,rules,input.notes?.trim()||null,principal.userId]);
    await client.query(`
      insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
      values($1,'cancellation_policy.created','cancellation_policy',$2,$3)`,[principal.userId,r.rows[0].id,{version:next}]);
    return r.rows[0];
  });
}

/** Activating retires the previous version; bookings keep the version they accepted. */
export async function adminActivateCancellationPolicy(pool:Pool,principal:AuthPrincipal,policyId:string){
  requireAnyRole(principal,POLICY_ROLES);
  return tx(pool,async client=>{
    const p=(await client.query(`select * from cancellation_policy_versions where id=$1 for update`,[policyId])).rows[0];
    if(!p) throw new DomainError("POLICY_NOT_FOUND","Policy not found",404);
    if(p.status!=="draft") throw new DomainError("POLICY_NOT_DRAFT","Only draft policies can be activated",409);
    await client.query(`
      update cancellation_policy_versions set status='retired',retired_at=now() where status='active'`);
    const r=await client.query(`
      update cancellation_policy_versions set status='active',activated_at=now(),activated_by=$2
       where id=$1 returning id,version,status,activated_at`,[policyId,principal.userId]);
    await client.query(`
      insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
      values($1,'cancellation_policy.activated','cancellation_policy',$2,$3)`,[principal.userId,policyId,{version:p.version}]);
    return r.rows[0];
  });
}

export async function adminListPendingRefunds(pool:Pool,principal:AuthPrincipal){
  requireAnyRole(principal,POLICY_ROLES);
  return (await pool.query(`
    select c.id,c.booking_id,c.actor,c.reason,c.rule_applied,c.paid_cents,c.refund_cents,c.retained_cents,
           c.refund_status,c.created_at,p.version as policy_version
      from booking_cancellations c
      left join cancellation_policy_versions p on p.id=c.policy_version_id
     where c.refund_status in ('pending_policy','pending_provider')
     order by c.created_at asc limit 200`)).rows;
}
