import test from "node:test";
import assert from "node:assert/strict";
import { buildBreakdown, contributionForRoadDistance, roundHalfUp } from "../src/domain/money.js";

test("roundHalfUp is deterministic with integer arithmetic", () => {
  assert.equal(roundHalfUp(15n, 10n), 2n);
  assert.equal(roundHalfUp(14n, 10n), 1n);
});

test("road contribution uses routed meters and does not activate a tariff", () => {
  assert.equal(contributionForRoadDistance(10_000, 300_000), 300);
  assert.equal(contributionForRoadDistance(12_345, 300_000), 370);
});

test("breakdown keeps components separated", () => {
  assert.deepEqual(buildBreakdown({
    contributionCents: 1000,
    passengerCommissionCents: 10,
    driverCommissionCents: 20,
    processingCents: 30,
    taxesCents: 40
  }), {
    contributionCents: 1000,
    passengerCommissionCents: 10,
    driverCommissionCents: 20,
    processingCents: 30,
    taxesCents: 40,
    passengerTotalCents: 1080,
    driverNetCents: 980
  });
});
