import test from "node:test";
import assert from "node:assert/strict";
import { REDACTED, isSensitiveKey, redactMetadata } from "../../src/modules/trust/redaction.js";

test("trust/redaction: reconoce claves personales en camelCase, snake_case y con separadores", () => {
  for (const key of [
    "phone", "userPhone", "user_phone", "telefono", "email", "contactEmail", "correo",
    "name", "firstName", "displayName", "address", "direccion",
    "ip", "ipAddress", "ip_hash_source", "token", "accessToken", "password", "authorization", "cookie", "signature",
    "storageKey", "storage_key", "signedUrl", "url", "key",
    "lat", "lng", "latitude", "longitude", "coords", "location",
    "contact", "iban", "dni", "nif", "passport"
  ]) {
    assert.equal(isSensitiveKey(key), true, `${key} debería ocultarse`);
  }
});

test("trust/redaction: no oculta claves operativas (la auditoría sigue siendo útil)", () => {
  for (const key of [
    "purpose", "ttlSeconds", "ownerUserId", "tripId", "bookingId", "count", "windowMinutes", "thresholdCount",
    "requestId", "reason", "status", "kind", "version", "decision", "item", "hasReason", "approvalReference",
    "monkey", "keyword", "pipeline", "tripod"
  ]) {
    assert.equal(isSensitiveKey(key), false, `${key} no debería ocultarse`);
  }
});

test("trust/redaction: lo que no es un objeto no produce metadatos", () => {
  for (const input of [null, undefined, "texto", 5, true, [1, 2, 3]]) {
    assert.deepEqual(redactMetadata(input), { value: {}, redactions: 0 });
  }
});

test("trust/redaction: oculta por nombre de clave y cuenta cada ocultación", () => {
  const result = redactMetadata({
    purpose: "identity_review",
    ttlSeconds: 120,
    ownerUserId: "3f6c1d4e-8a52-4c2b-9b1e-6d0a7e5c1a01",
    contact: "Ana López",
    phone: "+34600111222"
  });
  assert.deepEqual(result.value, {
    purpose: "identity_review",
    ttlSeconds: 120,
    ownerUserId: "3f6c1d4e-8a52-4c2b-9b1e-6d0a7e5c1a01",
    contact: REDACTED,
    phone: REDACTED
  });
  assert.equal(result.redactions, 2);
});

test("trust/redaction: oculta por forma del valor dentro de textos libres (correo, teléfono, IPv4)", () => {
  const result = redactMetadata({
    note: "Llamar al 600 111 222 o escribir a ana@example.com desde 192.168.1.10",
    international: "Contacto +34 600 111 222 confirmado"
  });
  assert.equal(result.value.note, `Llamar al ${REDACTED} o escribir a ${REDACTED} desde ${REDACTED}`);
  assert.equal(result.value.international, `Contacto ${REDACTED} confirmado`);
  assert.equal(result.redactions, 4);
});

test("trust/redaction: los UUID completos se conservan y los números y booleanos no se tocan", () => {
  const id = "c4a1f9e0-6b2d-4e57-8c3a-7d1e2f3a4b05";
  const result = redactMetadata({ documentId: id, count: 5, ok: true, none: null, price: 324 });
  assert.deepEqual(result.value, { documentId: id, count: 5, ok: true, none: null, price: 324 });
  assert.equal(result.redactions, 0);
});

test("trust/redaction: recorre arrays y objetos anidados", () => {
  const result = redactMetadata({
    items: [{ phone: "x", id: "a" }, { nested: { email: "ana@example.com", ok: 1 } }],
    list: ["escríbeme a ana@example.com", "sin datos"]
  });
  assert.deepEqual(result.value, {
    items: [{ phone: REDACTED, id: "a" }, { nested: { email: REDACTED, ok: 1 } }],
    list: [`escríbeme a ${REDACTED}`, "sin datos"]
  });
  assert.equal(result.redactions, 3);
});

test("trust/redaction: limita profundidad (6 niveles) y tamaño (50 elementos)", () => {
  const deep = redactMetadata({ a: { b: { c: { d: { e: { f: { g: "deep" } } } } } } });
  assert.deepEqual(deep.value, { a: { b: { c: { d: { e: { f: "[…]" } } } } } });

  const many = redactMetadata({ list: Array.from({ length: 60 }, (_, i) => i) });
  assert.equal((many.value.list as number[]).length, 50);

  const bigObject: Record<string, number> = {};
  for (let i = 0; i < 60; i += 1) bigObject[`k${i}`] = i;
  assert.equal(Object.keys(redactMetadata(bigObject).value).length, 50);
});

test("trust/redaction: el resultado no contiene ningún dato personal del ejemplo del contrato", () => {
  const { value, redactions } = redactMetadata({
    purpose: "identity_review",
    ttlSeconds: 120,
    ownerUserId: "3f6c1d4e-8a52-4c2b-9b1e-6d0a7e5c1a01",
    contact: "ana@example.com"
  });
  assert.equal(redactions, 1);
  assert.doesNotMatch(JSON.stringify(value), /ana@example\.com/);
});
