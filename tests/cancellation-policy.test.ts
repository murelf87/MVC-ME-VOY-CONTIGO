import test from "node:test";
import assert from "node:assert/strict";
import { DomainError } from "../src/errors.js";
import { computeRefund, parseCancellationRules } from "../src/domain/cancellation-policy.js";

// Example figures for tests only; real figures come from an approved policy version.
const rules=parseCancellationRules({
  passenger:[
    {minMinutesBeforeDeparture:0,refundContributionBps:0,refundPassengerFeeBps:0},
    {minMinutesBeforeDeparture:1440,refundContributionBps:10000,refundPassengerFeeBps:0},
    {minMinutesBeforeDeparture:120,refundContributionBps:5000,refundPassengerFeeBps:0}
  ],
  passengerAfterStart:{refundContributionBps:0,refundPassengerFeeBps:0},
  driver:{refundContributionBps:10000,refundPassengerFeeBps:10000},
  platform:{refundContributionBps:10000,refundPassengerFeeBps:10000},
  forceMajeure:{refundContributionBps:10000,refundPassengerFeeBps:5000}
});

test("passenger tiers are sorted and chosen by minutes before departure",()=>{
  const base={actor:"passenger" as const,tripStarted:false,paidCents:1010,passengerFeeCents:10};
  assert.deepEqual(computeRefund(rules,{...base,minutesBeforeDeparture:2000}),{ruleApplied:"passenger[0]",refundCents:1000,retainedCents:10});
  assert.deepEqual(computeRefund(rules,{...base,minutesBeforeDeparture:300}),{ruleApplied:"passenger[1]",refundCents:500,retainedCents:510});
  assert.deepEqual(computeRefund(rules,{...base,minutesBeforeDeparture:30}),{ruleApplied:"passenger[2]",refundCents:0,retainedCents:1010});
  assert.equal(computeRefund(rules,{...base,minutesBeforeDeparture:-10}).ruleApplied,"passenger[2]");
});

test("driver, force majeure and started trips use their own rules",()=>{
  const base={tripStarted:false,minutesBeforeDeparture:10,paidCents:1010,passengerFeeCents:10};
  assert.equal(computeRefund(rules,{...base,actor:"driver"}).refundCents,1010);
  assert.equal(computeRefund(rules,{...base,actor:"force_majeure"}).refundCents,1005);
  assert.equal(computeRefund(rules,{...base,actor:"passenger",tripStarted:true,minutesBeforeDeparture:5000}).ruleApplied,"passengerAfterStart");
});

test("rounding is half up to the cent and refund plus retained equals paid",()=>{
  const r=computeRefund(rules,{actor:"passenger",tripStarted:false,minutesBeforeDeparture:300,paidCents:333,passengerFeeCents:0});
  assert.equal(r.refundCents,167);
  assert.equal(r.refundCents+r.retainedCents,333);
});

test("invalid rules are rejected",()=>{
  const bad=(x:unknown)=>assert.throws(()=>parseCancellationRules(x),(e:unknown)=>e instanceof DomainError&&e.code==="INVALID_POLICY_RULES");
  bad(null);
  bad({passenger:[]});
  bad({...{passenger:[{minMinutesBeforeDeparture:60,refundContributionBps:1,refundPassengerFeeBps:1}]}});
  bad({passenger:[{minMinutesBeforeDeparture:0,refundContributionBps:10001,refundPassengerFeeBps:0}]});
});
