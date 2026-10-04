import test from "node:test";
import assert from "node:assert/strict";
import {
  generateOpaqueToken,
  hashOtp,
  hashToken,
  normalizePhoneE164,
  parseBearer,
  secureEqualHex
} from "../src/auth/auth-utils.js";

test("E.164 phone validation accepts valid and rejects invalid", () => {
  assert.equal(normalizePhoneE164("+34600111222"), "+34600111222");
  assert.throws(() => normalizePhoneE164("600111222"), /E.164/);
});

test("OTP hashes compare using exact salt/code", () => {
  const a = hashOtp("salt-a", "123456");
  const b = hashOtp("salt-a", "123456");
  const c = hashOtp("salt-b", "123456");
  assert.equal(secureEqualHex(a,b), true);
  assert.equal(secureEqualHex(a,c), false);
});

test("opaque session tokens are random and only hashes are persisted", () => {
  const a = generateOpaqueToken();
  const b = generateOpaqueToken();
  assert.notEqual(a,b);
  assert.match(a,/^[A-Za-z0-9_-]+$/);
  assert.equal(hashToken(a).length,64);
});

test("Bearer parser rejects malformed authorization headers", () => {
  assert.equal(parseBearer("Bearer abc"), "abc");
  assert.throws(() => parseBearer("Basic abc"), /Invalid Authorization/);
});
