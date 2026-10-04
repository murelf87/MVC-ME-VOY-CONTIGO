import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlate } from "../src/vehicles/vehicle-service.js";

test("vehicle plate normalization keeps a readable display and stable key", () => {
  assert.deepEqual(normalizePlate(" 1234 abc "), {
    display: "1234 ABC",
    normalized: "1234ABC"
  });
  assert.deepEqual(normalizePlate("SE-1234-AB"), {
    display: "SE-1234-AB",
    normalized: "SE1234AB"
  });
});

test("vehicle plate normalization rejects empty and oversized values", () => {
  assert.throws(() => normalizePlate("-"), /invalid/i);
  assert.throws(() => normalizePlate("A".repeat(30)), /invalid/i);
});
