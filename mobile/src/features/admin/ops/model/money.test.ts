// Pruebas de importes y porcentajes de la configuración de tarifas (admin-ops).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  centsToText,
  commissionToText,
  contributionCents,
  formatCapLabel,
  formatCommissionLabel,
  formatPremiumLabel,
  formatRateLabel,
  parseCentsAmount,
  parseCommission,
  parseFixed,
  parseRatePerKm,
  ratePerKmToText,
  roundHalfUp,
} from "./money";

const NBSP = " ";

describe("parseFixed", () => {
  it("lee coma y punto decimales y enteros", () => {
    assert.deepEqual(parseFixed("0,30", 6), { ok: true, value: 300000 });
    assert.deepEqual(parseFixed("0.3", 6), { ok: true, value: 300000 });
    assert.deepEqual(parseFixed("10", 2), { ok: true, value: 1000 });
    assert.deepEqual(parseFixed(" ,5 ", 2), { ok: true, value: 50 });
    assert.deepEqual(parseFixed("5,", 2), { ok: true, value: 500 });
  });
  it("campo vacío = Por definir", () => {
    assert.deepEqual(parseFixed("", 2), { ok: true, value: null });
    assert.deepEqual(parseFixed("   ", 2), { ok: true, value: null });
  });
  it("rechaza lo que no es un número decimal", () => {
    for (const bad of ["abc", "-1", "1e3", "1,2,3", "1..2", ",", ".", "1 000", "0,30 €"]) {
      assert.equal(parseFixed(bad, 2).ok, false, `«${bad}» no debería ser válido`);
    }
  });
  it("distingue demasiados decimales", () => {
    assert.deepEqual(parseFixed("1,234", 2), { ok: false, reason: "decimals" });
  });
});

describe("tarifa por km", () => {
  it("convierte euros a micro-euros enteros", () => {
    assert.deepEqual(parseRatePerKm("0,30"), { ok: true, value: 300000 });
    assert.deepEqual(parseRatePerKm("0,18"), { ok: true, value: 180000 });
    assert.deepEqual(parseRatePerKm("0,3050"), { ok: true, value: 305000 });
    assert.deepEqual(parseRatePerKm("5"), { ok: true, value: 5_000_000 });
    assert.deepEqual(parseRatePerKm(""), { ok: true, value: null });
  });
  it("valida rango y decimales en español", () => {
    const high = parseRatePerKm("5,01");
    assert.equal(high.ok, false);
    if (!high.ok) assert.match(high.message, /entre 0 y 5 €/);
    const many = parseRatePerKm("0,12345");
    assert.equal(many.ok, false);
    if (!many.ok) assert.match(many.message, /4 decimales/);
    const text = parseRatePerKm("tres");
    assert.equal(text.ok, false);
    if (!text.ok) assert.match(text.message, /importe en euros/);
  });
  it("vuelve a texto sin perder cifras", () => {
    assert.equal(ratePerKmToText(300000), "0,30");
    assert.equal(ratePerKmToText(180000), "0,18");
    assert.equal(ratePerKmToText(125000), "0,125");
    assert.equal(ratePerKmToText(5_000_000), "5,00");
    assert.equal(ratePerKmToText(null), "");
  });
});

describe("comisión", () => {
  it("convierte porcentajes a puntos básicos", () => {
    assert.deepEqual(parseCommission("10"), { ok: true, value: 1000 });
    assert.deepEqual(parseCommission("7,5"), { ok: true, value: 750 });
    assert.deepEqual(parseCommission("12,25 %"), { ok: true, value: 1225 });
    assert.deepEqual(parseCommission("100"), { ok: true, value: 10000 });
    assert.deepEqual(parseCommission(""), { ok: true, value: null });
  });
  it("rechaza lo que supera el 100 % o tiene demasiados decimales", () => {
    assert.equal(parseCommission("100,01").ok, false);
    assert.equal(parseCommission("101").ok, false);
    assert.equal(parseCommission("1,234").ok, false);
    assert.equal(parseCommission("diez").ok, false);
  });
  it("vuelve a texto", () => {
    assert.equal(commissionToText(1000), "10");
    assert.equal(commissionToText(750), "7,5");
    assert.equal(commissionToText(1225), "12,25");
    assert.equal(commissionToText(null), "");
  });
});

describe("importes en céntimos", () => {
  it("lee euros", () => {
    assert.deepEqual(parseCentsAmount("2,99", "La cuota"), { ok: true, value: 299 });
    assert.deepEqual(parseCentsAmount("3", "La cuota"), { ok: true, value: 300 });
    assert.deepEqual(parseCentsAmount("2,99 €", "La cuota"), { ok: true, value: 299 });
    assert.deepEqual(parseCentsAmount("", "La cuota"), { ok: true, value: null });
  });
  it("valida rango con el nombre del campo", () => {
    const big = parseCentsAmount("10000,01", "La cuota Premium");
    assert.equal(big.ok, false);
    if (!big.ok) assert.match(big.message, /^La cuota Premium debe estar entre 0 y 10\.000 €/);
    assert.equal(parseCentsAmount("2,999", "La cuota").ok, false);
  });
  it("vuelve a texto con dos decimales", () => {
    assert.equal(centsToText(299), "2,99");
    assert.equal(centsToText(300), "3,00");
    assert.equal(centsToText(null), "");
  });
});

describe("presentación", () => {
  it("rótulos de solo lectura", () => {
    assert.equal(formatRateLabel(300000, "Por definir"), `0,30${NBSP}€/km`);
    assert.equal(formatRateLabel(null, "Por definir"), "Por definir");
    assert.equal(formatCommissionLabel(1000, "Por definir"), `10${NBSP}%`);
    assert.equal(formatCommissionLabel(null, "Por definir"), "Por definir");
    assert.equal(formatPremiumLabel(299, "Por definir"), `2,99${NBSP}€ al mes`);
    assert.equal(formatCapLabel(300, "Sin límite"), `3,00${NBSP}€ por trayecto`);
    assert.equal(formatCapLabel(null, "Sin límite"), "Sin límite");
  });
});

describe("aportación de ejemplo (misma regla que el servidor)", () => {
  it("18 km × 0,30 €/km = 5,40 €", () => {
    assert.equal(contributionCents(300000, 18000), 540);
  });
  it("18 km × 0,18 €/km = 3,24 €", () => {
    assert.equal(contributionCents(180000, 18000), 324);
  });
  it("redondea la mitad hacia arriba y respeta el tope", () => {
    assert.equal(roundHalfUp(5, 10), 1);
    assert.equal(roundHalfUp(4, 10), 0);
    assert.equal(contributionCents(300000, 18000, 400), 400);
  });
  it("la comisión del 10 % sobre 324 son 32 céntimos y el total 356", () => {
    const contribution = contributionCents(180000, 18000);
    const commission = roundHalfUp(contribution * 1000, 10000);
    assert.equal(commission, 32);
    assert.equal(contribution + commission, 356);
    assert.equal(contribution - commission, 292);
  });
});
