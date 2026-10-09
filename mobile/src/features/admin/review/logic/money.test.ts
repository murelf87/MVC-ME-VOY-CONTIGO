// Pruebas de importes y validaciones de devolución (admin-review).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { approvalNoteRequired, centsToInput, checkApprovedAmount, checkNote, isPendingMoney, moneyText, parseEuroInput } from "./money";

describe("parseEuroInput", () => {
  it("lee coma y punto decimales", () => {
    assert.equal(parseEuroInput("4,5"), 450);
    assert.equal(parseEuroInput("4.50"), 450);
    assert.equal(parseEuroInput("4,50\u00A0€"), 450);
    assert.equal(parseEuroInput("0,01"), 1);
    assert.equal(parseEuroInput(",5"), 50);
  });

  it("lee enteros y millares", () => {
    assert.equal(parseEuroInput("5"), 500);
    assert.equal(parseEuroInput("1.234,56"), 123456);
    assert.equal(parseEuroInput("1.234"), 123400);
    assert.equal(parseEuroInput("1,234.56"), 123456);
  });

  it("rechaza lo que no es un importe", () => {
    for (const bad of ["", " ", "abc", "-4", "4,555", "1e3", "4,5,6", "1..2", "12.34.5", "9999999999"]) {
      assert.equal(parseEuroInput(bad), null, `«${bad}» no debería ser válido`);
    }
  });

  it("un cero sin decimales se lee como 0 € y lo rechaza la validación del importe", () => {
    assert.equal(parseEuroInput("0,"), 0);
    assert.deepEqual(checkApprovedAmount("0,", 500), { ok: false, reason: "too_low" });
  });
});

describe("checkApprovedAmount", () => {
  it("exige un importe", () => {
    assert.deepEqual(checkApprovedAmount("  ", 500), { ok: false, reason: "required" });
  });
  it("rechaza texto, cero y más de lo devolvible", () => {
    assert.deepEqual(checkApprovedAmount("hola", 500), { ok: false, reason: "invalid" });
    assert.deepEqual(checkApprovedAmount("0", 500), { ok: false, reason: "too_low" });
    assert.deepEqual(checkApprovedAmount("5,01", 500), { ok: false, reason: "too_high" });
  });
  it("acepta de 0,01 al máximo", () => {
    assert.deepEqual(checkApprovedAmount("0,01", 500), { ok: true, cents: 1 });
    assert.deepEqual(checkApprovedAmount("5", 500), { ok: true, cents: 500 });
  });
  it("sin máximo conocido deja decidir al servidor", () => {
    assert.deepEqual(checkApprovedAmount("999", null), { ok: true, cents: 99900 });
  });
});

describe("approvalNoteRequired", () => {
  it("es obligatoria sin política aprobada", () => {
    assert.equal(approvalNoteRequired({ policyApproved: false, proposedCents: 500, approvedCents: 500 }), true);
  });
  it("es obligatoria si cambia el importe propuesto", () => {
    assert.equal(approvalNoteRequired({ policyApproved: true, proposedCents: 500, approvedCents: 300 }), true);
  });
  it("no lo es con política aprobada e importe igual al propuesto", () => {
    assert.equal(approvalNoteRequired({ policyApproved: true, proposedCents: 500, approvedCents: 500 }), false);
  });
  it("es obligatoria si no había propuesta", () => {
    assert.equal(approvalNoteRequired({ policyApproved: true, proposedCents: null, approvedCents: 500 }), true);
  });
});

describe("checkNote", () => {
  it("la recorta y la acepta", () => {
    assert.deepEqual(checkNote("  Criterio caso a caso  ", true), { ok: true, note: "Criterio caso a caso" });
  });
  it("exige nota cuando es obligatoria", () => {
    assert.deepEqual(checkNote("   ", true), { ok: false, reason: "required" });
    assert.deepEqual(checkNote("", false), { ok: true, note: undefined });
  });
  it("limita la longitud", () => {
    assert.deepEqual(checkNote("a".repeat(1001), false), { ok: false, reason: "too_long" });
  });
});

describe("dinero pendiente y texto", () => {
  it("distingue lo definido de lo pendiente", () => {
    assert.equal(isPendingMoney({ cents: null, currency: "EUR", status: "pending_definition" }), true);
    assert.equal(isPendingMoney({ cents: 500, currency: "EUR", status: "defined" }), false);
    assert.equal(moneyText({ cents: null, currency: "EUR", status: "pending_definition" }), "Por definir");
    assert.equal(moneyText({ cents: 500, currency: "EUR", status: "defined" }), "5,00\u00A0€");
  });
  it("precarga el campo con coma", () => {
    assert.equal(centsToInput(450), "4,50");
    assert.equal(centsToInput(5), "0,05");
  });
});
