import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatNationalSpanishPhone, maskPhoneE164, normalizePhoneE164 } from "./phone";

describe("normalizePhoneE164", () => {
  it("móviles españoles con distintos formatos", () => {
    for (const input of ["612345678", "612 345 678", "+34 612-345-678", "0034612345678", " (+34) 612 345 678 "]) {
      assert.deepEqual(normalizePhoneE164(input), { ok: true, e164: "+34612345678" }, input);
    }
    assert.deepEqual(normalizePhoneE164("712345678"), { ok: true, e164: "+34712345678" });
  });
  it("rechaza vacío, basura y fijos españoles", () => {
    assert.deepEqual(normalizePhoneE164("   "), { ok: false, reason: "empty" });
    assert.deepEqual(normalizePhoneE164("abc"), { ok: false, reason: "invalid" });
    assert.deepEqual(normalizePhoneE164("6123"), { ok: false, reason: "invalid" });
    assert.deepEqual(normalizePhoneE164("954123456"), { ok: false, reason: "not_spanish_mobile" });
    assert.deepEqual(normalizePhoneE164("+34 9541234567"), { ok: false, reason: "not_spanish_mobile" });
  });
  it("acepta otros países con prefijo explícito (E.164 genérico)", () => {
    assert.deepEqual(normalizePhoneE164("+44 7700 900123"), { ok: true, e164: "+447700900123" });
    assert.deepEqual(normalizePhoneE164("0044 7700900123"), { ok: true, e164: "+447700900123" });
  });
});

describe("máscara y formato", () => {
  it("maskPhoneE164 como en la lámina «Confirma tu móvil»", () => {
    assert.equal(maskPhoneE164("+34612345678"), "+34 612 *** 678");
    assert.equal(maskPhoneE164("+447700900123"), "+447 *** 123");
    assert.equal(maskPhoneE164("+1234"), "+1234");
  });
  it("formatNationalSpanishPhone", () => {
    assert.equal(formatNationalSpanishPhone("+34612345678"), "612 345 678");
    assert.equal(formatNationalSpanishPhone("+447700900123"), "+447700900123");
  });
});
