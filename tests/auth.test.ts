import test from "node:test";
import assert from "node:assert/strict";
import { assertPasswordPolicy, hashPassword, maskEmail, normalizeEmail, verifyPassword } from "../src/auth/credentials.js";
import { normalizeRequestedRoles } from "../src/auth/roles.js";
import { createRawSessionToken, hashSessionToken, readBearerToken } from "../src/auth/session.js";

test("emails are normalized and malformed ones rejected", () => {
  assert.equal(normalizeEmail("  Marina@Example.ES "), "marina@example.es");
  assert.throws(() => normalizeEmail("marina@"), /not valid/);
  assert.throws(() => normalizeEmail("sin arroba"), /not valid/);
  assert.equal(maskEmail("marina@example.es"), "ma••••@example.es");
});

test("passwords are hashed with a fresh salt and short or trivial ones are refused", async () => {
  const a = await hashPassword("correcto caballo bateria");
  const b = await hashPassword("correcto caballo bateria");
  assert.match(a, /^scrypt\$32768\$8\$1\$/);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("correcto caballo bateria", a), true);
  assert.equal(await verifyPassword("correcto caballo bateri", a), false);
  assert.throws(() => assertPasswordPolicy("corta"), /between/);
  assert.throws(() => assertPasswordPolicy("1234567890"), /easy/);
  assert.throws(() => assertPasswordPolicy("aaaaaaaaaaaa"), /easy/);
  assertPasswordPolicy("una frase larga");
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
