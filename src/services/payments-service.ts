import type { Pool, PoolClient } from "pg";
import type { AuthPrincipal } from "../auth/session.js";
import { requireAnyRole } from "../auth/session.js";
import { DomainError } from "../errors.js";
import type { InternalPaymentEvent, ParsedProviderEvent } from "../payments/types.js";
import {
  driverBalances,postDisputeLost,postPayoutFailed,postPayoutPaid,postPayoutReserve,postRefund,postRelease
} from "./ledger-service.js";
import { confirmProviderPaymentTx } from "./reservation-service.js";

const FINANCE=["admin","finance_admin"] as const;

/** Thrown by a handler when the event depends on something not recorded yet (out-of-order delivery). */
class Defer extends Error {}

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

/** Stores a verified webhook once; a repeated delivery returns the stored row and is not processed again. */
export async function recordProviderEvent(pool:Pool,provider:string,event:ParsedProviderEvent,payload:unknown){
  const ins=await pool.query(`
    insert into payment_provider_events(provider,event_id,event_type,internal_type,object_id,occurred_at,payload,status)
    values($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
    on conflict(provider,event_id) do nothing returning id`,
    [provider,event.eventId,event.eventType,event.internal?.type??null,event.objectId,event.occurredAt,
     JSON.stringify(payload),event.internal?"received":"ignored"]);
  if(ins.rowCount) return {id:Number(ins.rows[0].id),duplicate:false};
  const old=await pool.query(`select id from payment_provider_events where provider=$1 and event_id=$2`,[provider,event.eventId]);
  return {id:Number(old.rows[0].id),duplicate:true};
}

async function handle(client:PoolClient,provider:string,eventId:number,occurredAt:Date,e:InternalPaymentEvent){
  switch(e.type){
    case "payment.succeeded":{
      if(!e.requestId) throw new DomainError("WEBHOOK_PAYLOAD_INVALID","Payment has no requestId metadata");
      return confirmProviderPaymentTx(client,{requestId:e.requestId,providerPaymentId:e.providerPaymentId,amountCents:e.amountCents},eventId);
    }
    case "refund.succeeded":{
      const c=(await client.query(`
        select c.* from booking_cancellations c join bookings b on b.id=c.booking_id
         where b.provider_payment_id=$1 for update of c`,[e.providerPaymentId])).rows[0];
      if(c){
        if(c.refund_status==="completed") return {alreadyCompleted:true};
        if(c.refund_status!=="pending_provider") throw new Defer("cancellation refund not computed yet");
        if(Number(c.refund_cents)!==e.amountCents){
          await client.query(`update booking_cancellations set refund_error=$2 where id=$1`,
            [c.id,`provider refunded ${e.amountCents} but policy says ${c.refund_cents}`]);
          throw new DomainError("REFUND_AMOUNT_MISMATCH","Refunded amount differs from the policy amount",409);
        }
        await client.query(`
          update booking_cancellations set refund_status='completed',provider_refund_id=$2,refunded_at=now(),refund_error=null
           where id=$1`,[c.id,e.providerRefundId]);
        await postRefund(client,c.booking_id,{
          refundCents:e.amountCents,contributionCents:c.refund_contribution_cents,feeCents:c.refund_fee_cents
        },eventId);
        // What the policy let the driver keep becomes payable once the refund is settled.
        await postRelease(client,c.booking_id);
        return {bookingId:c.booking_id};
      }
      const comp=(await client.query(`select * from payment_compensations where provider_payment_id=$1 for update`,[e.providerPaymentId])).rows[0];
      if(comp){
        await client.query(`update payment_compensations set status='completed',provider_refund_id=$2,completed_at=now() where id=$1 and status='pending'`,
          [comp.id,e.providerRefundId]);
        return {compensationId:comp.id};
      }
      throw new Defer("no cancellation or compensation for this payment yet");
    }
    case "refund.failed":{
      const upd=await client.query(`
        update booking_cancellations c set refund_error=$2
          from bookings b where b.id=c.booking_id and b.provider_payment_id=$1 returning c.id`,[e.providerPaymentId,e.reason]);
      if(!upd.rowCount) throw new Defer("refund failure for an unknown cancellation");
      return {cancellationId:upd.rows[0].id};
    }
    case "dispute.changed":{
      const booking=(await client.query(`select id from bookings where provider_payment_id=$1`,[e.providerPaymentId])).rows[0];
      const row=(await client.query(`
        insert into payment_disputes(provider,provider_dispute_id,booking_id,provider_payment_id,amount_cents,status,reason,
          opened_at,closed_at,last_event_at)
        values($8,$1,$2,$3,$4,$5,$6,$7,case when $5<>'open' then $7::timestamptz end,$7)
        on conflict(provider_dispute_id) do update set
          status=excluded.status,amount_cents=excluded.amount_cents,reason=coalesce(excluded.reason,payment_disputes.reason),
          closed_at=case when excluded.status<>'open' then excluded.last_event_at else payment_disputes.closed_at end,
          last_event_at=excluded.last_event_at,booking_id=coalesce(payment_disputes.booking_id,excluded.booking_id)
        where excluded.last_event_at>payment_disputes.last_event_at
        returning id,status,booking_id,amount_cents`,
        [e.providerDisputeId,booking?.id??null,e.providerPaymentId,e.amountCents,e.status,e.reason,occurredAt.toISOString(),provider])).rows[0];
      // An older event arriving after a newer one changes nothing.
      if(!row) return {stale:true};
      if(row.status==="lost") await postDisputeLost(client,row.id,row.booking_id,Number(row.amount_cents),eventId);
      return {disputeId:row.id,status:row.status};
    }
    case "payout.paid":
    case "payout.failed":{
      const p=(await client.query(`
        select * from payouts where (id::text=$1 or provider_payout_id=$2) for update`,[e.payoutId??"",e.providerPayoutId])).rows[0];
      if(!p) throw new Defer("payout not prepared yet");
      if(Number(p.amount_cents)!==e.amountCents) throw new DomainError("PAYOUT_AMOUNT_MISMATCH","Provider payout amount differs",409);
      if(p.status!=="pending_provider") return {payoutId:p.id,status:p.status};
      if(e.type==="payout.paid"){
        await client.query(`update payouts set status='paid',paid_at=$2,provider_payout_id=$3,last_event_at=$2 where id=$1`,
          [p.id,occurredAt.toISOString(),e.providerPayoutId]);
        await postPayoutPaid(client,p,eventId);
      }else{
        await client.query(`update payouts set status='failed',failure_reason=$2,provider_payout_id=$3,last_event_at=$4 where id=$1`,
          [p.id,e.reason,e.providerPayoutId,occurredAt.toISOString()]);
        await postPayoutFailed(client,p,eventId);
      }
      return {payoutId:p.id};
    }
  }
}

/** Processes one stored event. Out-of-order events are parked as deferred and retried later. */
export async function processProviderEvent(pool:Pool,id:number){
  const client=await pool.connect();
  try{
    await client.query("begin");
    const ev=(await client.query(`select * from payment_provider_events where id=$1 for update`,[id])).rows[0];
    if(!ev) throw new DomainError("PAYMENT_EVENT_NOT_FOUND","Payment event not found",404);
    if(ev.status==="processed"||ev.status==="ignored"){ await client.query("commit"); return {status:ev.status}; }
    const parsed=ev.payload?.__internal as InternalPaymentEvent|undefined;
    if(!parsed){ await client.query("rollback"); throw new Error("event has no internal mapping stored"); }
    await client.query("savepoint handle");
    let status="processed",error:string|null=null,result:unknown=null;
    try{
      result=await handle(client,ev.provider,id,new Date(ev.occurred_at),parsed);
    }catch(err){
      await client.query("rollback to savepoint handle");
      status=err instanceof Defer?"deferred":"failed";
      error=err instanceof Error?`${(err as any).code??err.name}: ${err.message}`:String(err);
    }
    await client.query(`
      update payment_provider_events set status=$2,attempts=attempts+1,last_error=$3,
             processed_at=case when $2='processed' then now() else processed_at end
       where id=$1`,[id,status,error]);
    await client.query("commit");
    return {status,error,result};
  }catch(error){
    await client.query("rollback").catch(()=>{});
    throw error;
  }finally{
    client.release();
  }
}

export async function ingestProviderEvent(pool:Pool,provider:string,event:ParsedProviderEvent,payload:any){
  const stored=await recordProviderEvent(pool,provider,event,{...payload,__internal:event.internal});
  if(stored.duplicate) return {id:stored.id,duplicate:true};
  if(!event.internal) return {id:stored.id,duplicate:false,status:"ignored"};
  const out=await processProviderEvent(pool,stored.id);
  return {id:stored.id,duplicate:false,status:out.status};
}

/** Retries deferred events in the order they happened at the provider. */
export async function retryDeferredEvents(pool:Pool,limit=100){
  const ids=(await pool.query(`
    select id from payment_provider_events where status='deferred' order by occurred_at,id limit $1`,[limit])).rows;
  const results=[];
  for(const r of ids) results.push({id:Number(r.id),...(await processProviderEvent(pool,Number(r.id)))});
  return results;
}

function monthStart(month:string):string{
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new DomainError("INVALID_MONTH","Month must be YYYY-MM");
  return `${month}-01`;
}

/**
 * Monthly driver payouts. Reserves each driver's available balance for the given past month.
 * Sending the transfer needs the provider; until then every payout stays pending_provider.
 */
export async function preparePayouts(pool:Pool,principal:AuthPrincipal,month:string){
  requireAnyRole(principal,FINANCE);
  const period=monthStart(month);
  return tx(pool,async client=>{
    const open=(await client.query(`select ($1::date < date_trunc('month',now() at time zone 'Europe/Madrid')::date) as past`,[period])).rows[0].past;
    if(!open) throw new DomainError("PAYOUT_PERIOD_NOT_CLOSED","Payouts can only be prepared for a month that has ended",409);
    const drivers=(await client.query(`
      select user_id,-sum(amount_cents)::bigint as available from ledger_entries
       where account='driver_available' group by user_id having -sum(amount_cents)>0`)).rows;
    const created=[];
    for(const d of drivers){
      const p=(await client.query(`
        insert into payouts(driver_user_id,period_month,amount_cents,created_by) values($1,$2,$3,$4)
        on conflict(driver_user_id,period_month) do nothing returning *`,[d.user_id,period,d.available,principal.userId])).rows[0];
      if(!p) continue;
      await postPayoutReserve(client,p);
      created.push({id:p.id,driverUserId:p.driver_user_id,amountCents:Number(p.amount_cents),status:p.status});
    }
    await client.query(`
      insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
      values($1,'payouts.prepared','payout_period',null,$2::jsonb)`,[principal.userId,JSON.stringify({period,count:created.length})]);
    return {period,created};
  });
}

export async function myEarnings(pool:Pool,principal:AuthPrincipal,providerConfigured=false){
  requireAnyRole(principal,["driver"]);
  const balances=await driverBalances(pool,principal.userId);
  const payouts=(await pool.query(`
    select id,period_month::text,amount_cents,status,paid_at,failure_reason from payouts
     where driver_user_id=$1 order by period_month desc limit 12`,[principal.userId])).rows
    .map(p=>({...p,amount_cents:Number(p.amount_cents)}));
  return {...balances,payouts,schedule:"monthly",providerConfigured};
}

export async function adminPaymentsOverview(pool:Pool,principal:AuthPrincipal,providerConfigured=false){
  requireAnyRole(principal,FINANCE);
  const events=(await pool.query(`select status,count(*)::int as n from payment_provider_events group by status`)).rows;
  const problems=(await pool.query(`
    select id,provider,event_type,status,attempts,last_error,occurred_at from payment_provider_events
     where status in ('deferred','failed') order by occurred_at limit 50`)).rows;
  const accounts=(await pool.query(`
    select account,coalesce(sum(amount_cents),0)::bigint as total from ledger_entries group by account`)).rows
    .map(r=>({account:r.account,totalCents:Number(r.total)}));
  const ledgerSum=accounts.reduce((s,a)=>s+a.totalCents,0);
  const disputes=(await pool.query(`
    select id,provider_dispute_id,booking_id,amount_cents,status,reason,opened_at,closed_at from payment_disputes
     order by last_event_at desc limit 50`)).rows;
  const payouts=(await pool.query(`
    select p.id,p.period_month::text,p.amount_cents,p.status,p.failure_reason,p.paid_at,pr.display_name as driver_display_name
      from payouts p left join profiles pr on pr.user_id=p.driver_user_id order by p.period_month desc,p.created_at desc limit 100`)).rows
    .map(p=>({...p,amount_cents:Number(p.amount_cents)}));
  // Reconciliation: what bookings say was captured, minus settled refunds and payouts, must equal provider_clearing.
  const expected=(await pool.query(`
    select coalesce((select sum(amount_cents) from bookings b where exists(
             select 1 from ledger_transactions t where t.booking_id=b.id and t.kind='capture')),0)
         - coalesce((select sum(refund_cents) from booking_cancellations where refund_status='completed'),0)
         - coalesce((select sum(amount_cents) from payouts where status='paid'),0)
         - coalesce((select sum(amount_cents) from payment_disputes where status='lost'),0) as expected`)).rows[0].expected;
  const clearing=accounts.find(a=>a.account==="provider_clearing")?.totalCents??0;
  const unposted=(await pool.query(`
    select count(*)::int as n from bookings b
     where b.amount_cents>0 and not exists(select 1 from ledger_transactions t where t.booking_id=b.id and t.kind='capture')`)).rows[0].n;
  return {
    providerConfigured,
    events,problems,accounts,ledgerBalanced:ledgerSum===0,
    reconciliation:{providerClearingCents:clearing,expectedCents:Number(expected),matches:clearing===Number(expected),bookingsWithoutCapture:unposted},
    disputes,payouts
  };
}
