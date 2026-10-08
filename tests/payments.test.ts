import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { DomainError } from "../src/errors.js";
import { parseStripeEvent,verifyStripeSignature } from "../src/payments/stripe-adapter.js";

const SECRET="whsec_test_only_not_a_real_secret";
const sign=(body:string,t:number,secret=SECRET)=>
  `t=${t},v1=${crypto.createHmac("sha256",secret).update(`${t}.${body}`).digest("hex")}`;
const code=(c:string)=>(e:unknown)=>e instanceof DomainError&&e.code===c;

test("a correctly signed Stripe body passes, a tampered or old one does not",()=>{
  const body=JSON.stringify({id:"evt_1"});
  const now=1_800_000_000;
  verifyStripeSignature(Buffer.from(body),sign(body,now),SECRET,now);
  assert.throws(()=>verifyStripeSignature(Buffer.from(body+" "),sign(body,now),SECRET,now),code("WEBHOOK_SIGNATURE_INVALID"));
  assert.throws(()=>verifyStripeSignature(Buffer.from(body),sign(body,now,"other"),SECRET,now),code("WEBHOOK_SIGNATURE_INVALID"));
  assert.throws(()=>verifyStripeSignature(Buffer.from(body),sign(body,now-301),SECRET,now),code("WEBHOOK_SIGNATURE_EXPIRED"));
  assert.throws(()=>verifyStripeSignature(Buffer.from(body),undefined,SECRET,now),code("WEBHOOK_SIGNATURE_MISSING"));
  // Stripe may send several v1 signatures during secret rotation; any valid one is enough.
  verifyStripeSignature(Buffer.from(body),`${sign(body,now,"old")},v1=${sign(body,now).split("v1=")[1]}`,SECRET,now);
});

test("Stripe events map onto MVC's provider-neutral events",()=>{
  const pay=parseStripeEvent({id:"evt_p",type:"payment_intent.succeeded",created:1_800_000_000,
    data:{object:{id:"pi_1",amount:99,amount_received:99,currency:"eur",metadata:{requestId:"r1"}}}});
  assert.deepEqual(pay.internal,{type:"payment.succeeded",providerPaymentId:"pi_1",amountCents:99,requestId:"r1"});
  assert.equal(pay.occurredAt,new Date(1_800_000_000_000).toISOString());

  const ref=parseStripeEvent({id:"evt_r",type:"refund.updated",created:1,data:{object:{id:"re_1",amount:45,currency:"eur",status:"succeeded",payment_intent:"pi_1"}}});
  assert.deepEqual(ref.internal,{type:"refund.succeeded",providerPaymentId:"pi_1",providerRefundId:"re_1",amountCents:45});
  const pending=parseStripeEvent({id:"evt_r2",type:"refund.created",created:1,data:{object:{id:"re_2",amount:45,currency:"eur",status:"pending",payment_intent:"pi_1"}}});
  assert.equal(pending.internal,null);

  const dis=parseStripeEvent({id:"evt_d",type:"charge.dispute.closed",created:1,data:{object:{id:"dp_1",amount:99,status:"lost",payment_intent:"pi_1",reason:"fraudulent"}}});
  assert.equal((dis.internal as any).status,"lost");

  assert.equal(parseStripeEvent({id:"evt_x",type:"customer.created",created:1,data:{object:{id:"cus_1"}}}).internal,null);
  assert.throws(()=>parseStripeEvent({id:"evt_u",type:"payment_intent.succeeded",created:1,data:{object:{id:"pi",amount:1,currency:"usd"}}}),
    code("WEBHOOK_CURRENCY_UNSUPPORTED"));
  assert.throws(()=>parseStripeEvent({id:"evt_f",type:"payment_intent.succeeded",created:1,data:{object:{id:"pi",amount:1.5,currency:"eur"}}}),
    code("WEBHOOK_PAYLOAD_INVALID"));
});
