import test from "node:test";
import assert from "node:assert/strict";
import { quoteFromTariff } from "../src/services/tariff-service.js";

// Example figures for tests only; real values come from an approved tariff version.
const base={id:"t",version:1,rate_micros_per_km:300000,passenger_commission_bps:100,driver_commission_bps:100,shared_cost_cap_cents:null};

test("quote is computed from the passenger's routed meters with separated components",()=>{
  assert.deepEqual(quoteFromTariff(base,12345),{
    contributionCents:370,passengerCommissionCents:4,driverCommissionCents:4,processingCents:0,taxesCents:0,
    passengerTotalCents:374,driverNetCents:366
  });
});

test("shared cost cap limits the contribution before commissions",()=>{
  const q=quoteFromTariff({...base,shared_cost_cap_cents:500},50000);
  assert.equal(q.contributionCents,500);
  assert.equal(q.passengerTotalCents,505);
});

test("zero rates give a free quote rather than an invented price",()=>{
  const q=quoteFromTariff({...base,rate_micros_per_km:0,passenger_commission_bps:0,driver_commission_bps:0},9000);
  assert.equal(q.passengerTotalCents,0);
});
