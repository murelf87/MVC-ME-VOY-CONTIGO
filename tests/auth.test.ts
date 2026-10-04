import test from "node:test";
import assert from "node:assert/strict";
import { normalizeE164, normalizeRequestedRoles } from "../src/auth/phone.js";
import { createRawSessionToken, hashSessionToken, readBearerToken } from "../src/auth/session.js";

test("phone normalization accepts E.164 and harmless formatting", () => {
  assert.equal(normalizeE164(" +34 600-111-222 "), "+34600111222");
});

test("phone normalization never guesses a country code", () => {
  assert.throws(() => normalizeE164("600111222"), /E\.164/);
});

test("self-service roles cannot escalate to admin", () => {
  assert.deepEqual(normalizeRequestedRoles(["driver", "passenger", "driver"]), ["driver", "passenger"]);
  assert.throws(() => normalizeRequestedRoles(["admin"]), /Only passenger and driver/);
});

test("session tokens are high entropy and only hashes are persisted", () => {
  const a = createRawSessionToken();
  const b = createRawSessionToken();
  assert.match(a, /^mvc_sess_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.match(hashSessionToken(a), /^[0-9a-f]{64}$/);
  assert.notEqual(hashSessionToken(a), a);
});

test("bearer parser rejects non-MVC tokens", () => {
  const token = createRawSessionToken();
  assert.equal(readBearerToken(`Bearer ${token}`), token);
  assert.throws(() => readBearerToken("Bearer abc"), /Invalid authentication token/);
});
