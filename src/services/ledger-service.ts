import type { Pool, PoolClient } from "pg";
import { roundHalfUp } from "../domain/money.js";

/**
 * Double-entry mirror of what the payment provider holds. Debits are positive, credits negative,
 * and the database refuses any transaction that does not sum to zero or any later edit.
 * Each posting has an idempotency key, so replaying a webhook or a job never posts twice.
 */
type Db=Pool|PoolClient;
export type LedgerAccount=
  "provider_clearing"|"driver_pending"|"driver_available"|"driver_in_transit"|"platform_revenue"|"dispute_losses";
type Entry={account:LedgerAccount;userId?:string|null;amount:number};
type Kind="capture"|"release"|"refund"|"payout_reserve"|"payout_paid"|"payout_failed"|"dispute_lost"|"dispute_won";

async function post(
  client:PoolClient,kind:Kind,key:string,
  refs:{bookingId?:string|null;payoutId?:string|null;eventId?:string|number|null},
  entries:Entry[]
):Promise<boolean>{
  const lines=entries.filter(e=>e.amount!==0);
  if(!lines.length) return false;
  const txn=await client.query(`
    insert into ledger_transactions(kind,idempotency_key,booking_id,payout_id,provider_event_id)
    values($1,$2,$3,$4,$5) on conflict(idempotency_key) do nothing returning id`,
    [kind,key,refs.bookingId??null,refs.payoutId??null,refs.eventId??null]);
  if(!txn.rowCount) return false;
  for(const e of lines){
    await client.query(`insert into ledger_entries(txn_id,account,user_id,amount_cents) values($1,$2,$3,$4)`,
      [txn.rows[0].id,e.account,e.userId??null,e.amount]);
  }
  return true;
}

async function bookingMoney(client:PoolClient,bookingId:string){
  const row=(await client.query(`
    select b.id,b.amount_cents,t.driver_user_id,q.contribution_cents,q.driver_commission_cents,q.driver_net_cents
      from bookings b join ride_requests r on r.id=b.request_id join trips t on t.id=r.trip_id
      left join quote_snapshots q on q.request_id=r.id
     where b.id=$1`,[bookingId])).rows[0];
  if(!row) throw new Error(`booking ${bookingId} not found`);
  const amount=Number(row.amount_cents);
  // Bookings paid before any tariff snapshot existed have no commission split: the driver is owed all of it.
  const driverNet=row.driver_net_cents==null?amount:Math.min(amount,Number(row.driver_net_cents));
  return {
    amount,driverNet,driver:row.driver_user_id as string,
    contribution:row.contribution_cents==null?amount:Number(row.contribution_cents),
    driverCommission:row.driver_commission_cents==null?0:Number(row.driver_commission_cents)
  };
}

/** Provider captured the passenger's payment for a booking. */
export async function postCapture(client:PoolClient,bookingId:string,eventId?:number|null){
  const m=await bookingMoney(client,bookingId);
  return post(client,"capture",`booking:${bookingId}:capture`,{bookingId,eventId:eventId??null},[
    {account:"provider_clearing",amount:m.amount},
    {account:"driver_pending",userId:m.driver,amount:-m.driverNet},
    {account:"platform_revenue",amount:-(m.amount-m.driverNet)}
  ]);
}

async function pendingForBooking(client:PoolClient,bookingId:string,driver:string){
  const q=await client.query(`
    select coalesce(sum(e.amount_cents),0)::bigint as s
      from ledger_entries e join ledger_transactions t on t.id=e.txn_id
     where t.booking_id=$1 and e.account='driver_pending' and e.user_id=$2`,[bookingId,driver]);
  return Number(q.rows[0].s);
}

/** The trip was completed with this passenger on board: the driver's share becomes payable. */
export async function postRelease(client:PoolClient,bookingId:string){
  const m=await bookingMoney(client,bookingId);
  const owed=-await pendingForBooking(client,bookingId,m.driver);
  if(owed<=0) return false;
  return post(client,"release",`booking:${bookingId}:release`,{bookingId},[
    {account:"driver_pending",userId:m.driver,amount:owed},
    {account:"driver_available",userId:m.driver,amount:-owed}
  ]);
}

/**
 * Provider confirmed a refund. The contribution part comes back from the driver net of the driver
 * commission it carried; the fee part and that commission come back from platform revenue.
 */
export async function postRefund(
  client:PoolClient,bookingId:string,
  refund:{refundCents:number;contributionCents:number|null;feeCents:number|null},eventId?:number|null
){
  const m=await bookingMoney(client,bookingId);
  const total=refund.refundCents;
  const rc=refund.contributionCents??total;
  const commissionBack=m.contribution>0
    ?Number(roundHalfUp(BigInt(m.driverCommission)*BigInt(rc),BigInt(m.contribution))):0;
  const driverBack=Math.max(0,Math.min(total,rc-commissionBack));
  const released=(await client.query(
    `select 1 from ledger_transactions where idempotency_key=$1`,[`booking:${bookingId}:release`])).rowCount;
  return post(client,"refund",`booking:${bookingId}:refund`,{bookingId,eventId:eventId??null},[
    {account:"provider_clearing",amount:-total},
    {account:released?"driver_available":"driver_pending",userId:m.driver,amount:driverBack},
    {account:"platform_revenue",amount:total-driverBack}
  ]);
}

export async function postPayoutReserve(client:PoolClient,payout:{id:string;driver_user_id:string;amount_cents:number|string}){
  const a=Number(payout.amount_cents);
  return post(client,"payout_reserve",`payout:${payout.id}:reserve`,{payoutId:payout.id},[
    {account:"driver_available",userId:payout.driver_user_id,amount:a},
    {account:"driver_in_transit",userId:payout.driver_user_id,amount:-a}
  ]);
}
export async function postPayoutPaid(client:PoolClient,payout:{id:string;driver_user_id:string;amount_cents:number|string},eventId?:number|null){
  const a=Number(payout.amount_cents);
  return post(client,"payout_paid",`payout:${payout.id}:paid`,{payoutId:payout.id,eventId:eventId??null},[
    {account:"driver_in_transit",userId:payout.driver_user_id,amount:a},
    {account:"provider_clearing",amount:-a}
  ]);
}
export async function postPayoutFailed(client:PoolClient,payout:{id:string;driver_user_id:string;amount_cents:number|string},eventId?:number|null){
  const a=Number(payout.amount_cents);
  return post(client,"payout_failed",`payout:${payout.id}:failed`,{payoutId:payout.id,eventId:eventId??null},[
    {account:"driver_in_transit",userId:payout.driver_user_id,amount:a},
    {account:"driver_available",userId:payout.driver_user_id,amount:-a}
  ]);
}

/** Who finally bears a lost dispute is a business decision still pending; until then MVC records it as its own loss. */
export async function postDisputeLost(client:PoolClient,disputeId:string,bookingId:string|null,amountCents:number,eventId?:number|null){
  return post(client,"dispute_lost",`dispute:${disputeId}:lost`,{bookingId,eventId:eventId??null},[
    {account:"provider_clearing",amount:-amountCents},
    {account:"dispute_losses",amount:amountCents}
  ]);
}

export async function driverBalances(db:Db,userId:string){
  const rows=(await db.query<{account:string;s:string}>(`
    select account,coalesce(sum(amount_cents),0)::bigint as s from ledger_entries
     where user_id=$1 group by account`,[userId])).rows;
  const get=(a:string)=>0-Number(rows.find(r=>r.account===a)?.s??0)||0;
  return {pendingCents:get("driver_pending"),availableCents:get("driver_available"),inTransitCents:get("driver_in_transit")};
}
