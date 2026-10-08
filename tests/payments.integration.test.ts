import test,{after,before,beforeEach} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import type { AuthPrincipal } from "../src/auth/session.js";
import { DomainError } from "../src/errors.js";
import type { ParsedProviderEvent } from "../src/payments/types.js";
import { adminActivateCancellationPolicy,adminCreateCancellationPolicy,cancelOwnRideRequest } from "../src/services/cancellation-service.js";
import { driverBalances } from "../src/services/ledger-service.js";
import {
  adminPaymentsOverview,ingestProviderEvent,myEarnings,preparePayouts,retryDeferredEvents
} from "../src/services/payments-service.js";
import { createRideRequest,decideRideRequest } from "../src/services/request-service.js";
import { adminApproveTariff,adminCreateTariff } from "../src/services/tariff-service.js";
import { completeOwnedTrip,startOwnedTrip } from "../src/services/trip-execution-service.js";

const {Pool}=pg;
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
const pool=new Pool({connectionString:databaseUrl});

function auth(userId:string,roles:any[]):AuthPrincipal{
  return {sessionId:crypto.randomUUID(),userId,roles,expiresAt:new Date(Date.now()+3600000).toISOString()};
}
const code=(c:string)=>(e:unknown)=>e instanceof DomainError&&e.code===c;
let seq=0;
const at=(offsetS=0)=>new Date(Date.now()+offsetS*1000).toISOString();
const ev=(internal:ParsedProviderEvent["internal"],occurredAt=at()):ParsedProviderEvent=>
  ({eventId:`evt_${++seq}_${crypto.randomUUID()}`,eventType:"test.mapped",occurredAt,objectId:null,internal});

const RULES={
  passenger:[
    {minMinutesBeforeDeparture:1440,refundContributionBps:10000,refundPassengerFeeBps:0},
    {minMinutesBeforeDeparture:0,refundContributionBps:5000,refundPassengerFeeBps:0}
  ],
  passengerAfterStart:{refundContributionBps:0,refundPassengerFeeBps:0},
  driver:{refundContributionBps:10000,refundPassengerFeeBps:10000},
  platform:{refundContributionBps:10000,refundPassengerFeeBps:10000},
  forceMajeure:{refundContributionBps:10000,refundPassengerFeeBps:10000}
};

/** Trip of 10 road km; tariff 0.09 €/km, 10 % passenger and 5 % driver commission => 90 + 9 = 99 cents, driver net 85. */
async function seed(){
  const ids:string[]=[];
  for(const name of ["Ana","Luis","Fina"]){
    const id=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
    await pool.query(`insert into profiles(user_id,display_name,public_photo_status,identity_status) values($1,$2,'approved','verified')`,[id,name]);
    ids.push(id);
  }
  const [driver,passenger,finance]=ids as [string,string,string];
  const province=(await pool.query(`
    insert into provinces(code,name,source_name,geom) values('PAY','Pay','integration-test',
      ST_Multi(ST_GeomFromText('POLYGON((0 0,10 0,10 10,0 10,0 0))',4326))) returning id`)).rows[0].id;
  const vehicle=(await pool.query(`
    insert into vehicles(driver_user_id,make,model,plate,passenger_seats,review_status,documentation_status,
      vehicle_photo_status,insurance_status,insurance_expires_on)
    values($1,'T','C','PAY-1',4,'approved','approved','approved','approved',current_date+30) returning id`,[driver])).rows[0].id;
  const trip=(await pool.query(`
    insert into trips(driver_user_id,vehicle_id,province_id,category,kind,leg,status,offered_seats,departure_at,
      origin_geom,destination_geom,route_geom,route_distance_m,route_duration_s,route_provider,route_provider_ref)
    values($1,$2,$3,'work','single','outbound','draft',3,now()+interval '2 hours',
      ST_SetSRID(ST_Point(1,1),4326),ST_SetSRID(ST_Point(9,9),4326),
      ST_GeomFromText('LINESTRING(1 1,9 9)',4326),10000,900,'integration-test','pay-route') returning id`,[driver,vehicle,province])).rows[0].id;
  await pool.query(`insert into trip_stops(trip_id,seq,kind,geom) values
    ($1,0,'origin',ST_SetSRID(ST_Point(1,1),4326)),($1,1,'destination',ST_SetSRID(ST_Point(9,9),4326))`,[trip]);
  await pool.query(`insert into trip_segments(trip_id,seq,from_stop_seq,to_stop_seq,distance_m,duration_s,capacity)
    values($1,0,0,1,10000,900,3)`,[trip]);
  await pool.query(`update trips set status='published' where id=$1`,[trip]);
  const fin=auth(finance,["finance_admin"]);
  const t=await adminCreateTariff(pool,fin,{rateMicrosPerKm:90000,passengerCommissionBps:1000,driverCommissionBps:500});
  await adminApproveTariff(pool,fin,t.id);
  const p=await adminCreateCancellationPolicy(pool,fin,{rules:RULES});
  await adminActivateCancellationPolicy(pool,fin,p.id);
  const req=await createRideRequest(pool,auth(passenger,["passenger"]),{tripId:trip,fromSegmentSeq:0,toSegmentSeq:1});
  const decided=await decideRideRequest(pool,auth(driver,["driver"]),req.id,"accept");
  assert.equal(decided.quote?.passenger_total_cents,99);
  return {driver,passenger,finance,fin,trip,requestId:req.id as string};
}

const paid=(requestId:string,pi="pi_"+crypto.randomUUID(),amountCents=99)=>
  ({type:"payment.succeeded" as const,providerPaymentId:pi,amountCents,requestId});
const accountTotals=async()=>Object.fromEntries((await pool.query(
  `select account,sum(amount_cents)::int as s from ledger_entries group by account`)).rows.map(r=>[r.account,r.s]));

before(async()=>{await pool.query("select 1 from ledger_entries limit 1")});
beforeEach(async()=>{
  await pool.query(`
    truncate table ledger_entries,ledger_transactions,payment_provider_events,payouts,payment_disputes,
      booking_cancellations,cancellation_policy_versions,user_notifications,audit_events,quote_snapshots,tariff_versions,
      payment_compensations,bookings,seat_holds,ride_requests,trip_segments,trip_stops,trips,vehicles,profiles,
      user_roles,app_users,provinces restart identity cascade`);
});
after(async()=>{await pool.end()});

test("a captured payment books the seat and splits driver net and commissions exactly; a repeat delivery does nothing",async()=>{
  const s=await seed();
  const e=ev(paid(s.requestId,"pi_one"));
  const first=await ingestProviderEvent(pool,"stripe",e,{id:e.eventId});
  assert.equal(first.status,"processed");
  const again=await ingestProviderEvent(pool,"stripe",e,{id:e.eventId});
  assert.equal(again.duplicate,true);
  assert.equal((await pool.query(`select count(*)::int as n from bookings`)).rows[0].n,1);
  assert.deepEqual(await accountTotals(),{provider_clearing:99,driver_pending:-85,platform_revenue:-14});
  assert.deepEqual(await driverBalances(pool,s.driver),{pendingCents:85,availableCents:0,inTransitCents:0});
});

test("a payment for a different amount than the frozen quote is stored as failed and books nothing",async()=>{
  const s=await seed();
  const out=await ingestProviderEvent(pool,"stripe",ev(paid(s.requestId,"pi_bad",50)),{});
  assert.equal(out.status,"failed");
  assert.equal((await pool.query(`select count(*)::int as n from bookings`)).rows[0].n,0);
  const row=(await pool.query(`select last_error from payment_provider_events`)).rows[0];
  assert.match(row.last_error,/PAYMENT_AMOUNT_MISMATCH/);
});

test("completing the trip with the passenger on board makes the driver's share available",async()=>{
  const s=await seed();
  await ingestProviderEvent(pool,"stripe",ev(paid(s.requestId)),{});
  await startOwnedTrip(pool,auth(s.driver,["driver"]),s.trip);
  await pool.query(`update bookings set picked_up_at=now()`);
  await completeOwnedTrip(pool,auth(s.driver,["driver"]),s.trip);
  assert.deepEqual(await driverBalances(pool,s.driver),{pendingCents:0,availableCents:85,inTransitCents:0});
});

test("a refund that arrives before the cancellation waits, then settles with the policy split",async()=>{
  const s=await seed();
  await ingestProviderEvent(pool,"stripe",ev(paid(s.requestId,"pi_ref")),{});
  // Two hours before departure the policy refunds 50 % of the 90 cent contribution and none of the fee.
  const early=await ingestProviderEvent(pool,"stripe",ev({type:"refund.succeeded",providerPaymentId:"pi_ref",providerRefundId:"re_1",amountCents:45}),{});
  assert.equal(early.status,"deferred");
  const c=await cancelOwnRideRequest(pool,auth(s.passenger,["passenger"]),{requestId:s.requestId});
  assert.equal(c.cancellation?.refund_cents,45);
  const retried=await retryDeferredEvents(pool);
  assert.equal(retried[0]!.status,"processed");
  const row=(await pool.query(`select refund_status,provider_refund_id from booking_cancellations`)).rows[0];
  assert.deepEqual(row,{refund_status:"completed",provider_refund_id:"re_1"});
  // 45 back: 42 from the driver (45 minus the 3 cent commission it carried) and 3 from MVC.
  assert.deepEqual(await accountTotals(),{provider_clearing:54,driver_pending:0,driver_available:-43,platform_revenue:-11});
  const o=await adminPaymentsOverview(pool,s.fin);
  assert.equal(o.ledgerBalanced,true);
  assert.equal(o.reconciliation.matches,true);
});

test("dispute events applied out of order end in the newest state and post a lost dispute once",async()=>{
  const s=await seed();
  await ingestProviderEvent(pool,"stripe",ev(paid(s.requestId,"pi_dis")),{});
  const lost={type:"dispute.changed" as const,providerDisputeId:"dp_1",providerPaymentId:"pi_dis",amountCents:99,status:"lost" as const,reason:"fraudulent"};
  await ingestProviderEvent(pool,"stripe",ev(lost,at(60)),{});
  await ingestProviderEvent(pool,"stripe",ev({...lost,status:"open"},at(0)),{});
  await ingestProviderEvent(pool,"stripe",ev(lost,at(90)),{});
  const d=(await pool.query(`select status from payment_disputes`)).rows;
  assert.deepEqual(d,[{status:"lost"}]);
  assert.equal((await accountTotals()).dispute_losses,99);
});

test("monthly payouts reserve the available balance once and settle when the provider confirms",async()=>{
  const s=await seed();
  await ingestProviderEvent(pool,"stripe",ev(paid(s.requestId)),{});
  await startOwnedTrip(pool,auth(s.driver,["driver"]),s.trip);
  await pool.query(`update bookings set picked_up_at=now()`);
  await completeOwnedTrip(pool,auth(s.driver,["driver"]),s.trip);

  const now=new Date();
  const thisMonth=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  await assert.rejects(()=>preparePayouts(pool,s.fin,thisMonth),code("PAYOUT_PERIOD_NOT_CLOSED"));
  await assert.rejects(()=>preparePayouts(pool,auth(s.driver,["driver"]),"2026-01"),code("AUTH_FORBIDDEN"));
  const prep=await preparePayouts(pool,s.fin,"2026-01");
  assert.equal(prep.created.length,1);
  assert.equal(prep.created[0]!.amountCents,85);
  assert.equal((await preparePayouts(pool,s.fin,"2026-01")).created.length,0);
  assert.deepEqual(await driverBalances(pool,s.driver),{pendingCents:0,availableCents:0,inTransitCents:85});

  await ingestProviderEvent(pool,"stripe",ev({type:"payout.paid",providerPayoutId:"po_1",payoutId:prep.created[0]!.id,amountCents:85,reason:null}),{});
  assert.deepEqual(await driverBalances(pool,s.driver),{pendingCents:0,availableCents:0,inTransitCents:0});
  const mine=await myEarnings(pool,auth(s.driver,["driver"]));
  assert.equal(mine.payouts[0]!.status,"paid");
  const o=await adminPaymentsOverview(pool,s.fin);
  assert.equal(o.reconciliation.matches,true);
  assert.equal(o.reconciliation.providerClearingCents,14);
});

test("a failed payout returns the money to the driver's available balance",async()=>{
  const s=await seed();
  await ingestProviderEvent(pool,"stripe",ev(paid(s.requestId)),{});
  await startOwnedTrip(pool,auth(s.driver,["driver"]),s.trip);
  await pool.query(`update bookings set picked_up_at=now()`);
  await completeOwnedTrip(pool,auth(s.driver,["driver"]),s.trip);
  const prep=await preparePayouts(pool,s.fin,"2026-02");
  await ingestProviderEvent(pool,"stripe",ev({type:"payout.failed",providerPayoutId:"po_2",payoutId:prep.created[0]!.id,amountCents:85,reason:"account_closed"}),{});
  assert.deepEqual(await driverBalances(pool,s.driver),{pendingCents:0,availableCents:85,inTransitCents:0});
});

test("the ledger refuses edits and unbalanced transactions",async()=>{
  const s=await seed();
  await ingestProviderEvent(pool,"stripe",ev(paid(s.requestId)),{});
  await assert.rejects(()=>pool.query(`update ledger_entries set amount_cents=1`),/MVC_LEDGER_IMMUTABLE/);
  await assert.rejects(()=>pool.query(`delete from ledger_entries`),/MVC_LEDGER_IMMUTABLE/);
  const client=await pool.connect();
  try{
    await client.query("begin");
    const t=(await client.query(`insert into ledger_transactions(kind,idempotency_key) values('capture','bad') returning id`)).rows[0].id;
    await client.query(`insert into ledger_entries(txn_id,account,amount_cents) values($1,'provider_clearing',5)`,[t]);
    await assert.rejects(()=>client.query("commit"),/MVC_LEDGER_UNBALANCED/);
  }finally{
    await client.query("rollback").catch(()=>{});
    client.release();
  }
});

test("the webhook endpoint verifies the signature on the raw body before storing anything",async()=>{
  const {default:Fastify}=await import("fastify");
  const {registerPaymentRoutes}=await import("../src/routes/payment-routes.js");
  const secret="whsec_test_only_not_a_real_secret";
  const s=await seed();
  const app=Fastify();
  await registerPaymentRoutes(app,pool,{paymentsProvider:"stripe",stripeWebhookSecret:secret} as any);
  const off=Fastify();
  await registerPaymentRoutes(off,pool,{paymentsProvider:"disabled"} as any);
  try{
    const body=JSON.stringify({id:"evt_http_1",type:"payment_intent.succeeded",created:Math.floor(Date.now()/1000),
      data:{object:{id:"pi_http",amount:99,amount_received:99,currency:"eur",metadata:{requestId:s.requestId}}}});
    const t=Math.floor(Date.now()/1000);
    const sig=`t=${t},v1=${crypto.createHmac("sha256",secret).update(`${t}.${body}`).digest("hex")}`;
    const bad=await app.inject({method:"POST",url:"/v1/payments/webhooks/stripe",payload:body,
      headers:{"content-type":"application/json","stripe-signature":sig.replace(/.$/,c=>c==="0"?"1":"0")}});
    assert.equal(bad.statusCode,400);
    assert.equal((await pool.query(`select count(*)::int as n from payment_provider_events`)).rows[0].n,0);
    const ok=await app.inject({method:"POST",url:"/v1/payments/webhooks/stripe",payload:body,
      headers:{"content-type":"application/json","stripe-signature":sig}});
    assert.equal(ok.statusCode,200);
    assert.equal(ok.json().status,"processed");
    assert.equal((await pool.query(`select count(*)::int as n from bookings where provider_payment_id='pi_http'`)).rows[0].n,1);
    const disabled=await off.inject({method:"POST",url:"/v1/payments/webhooks/stripe",payload:body,
      headers:{"content-type":"application/json","stripe-signature":sig}});
    assert.equal(disabled.statusCode,503);
  }finally{
    await app.close();
    await off.close();
  }
});
