// Pruebas de las reglas de alerta en tiempo real (admin-ops).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activeRuleCount, paramsToDraft, ruleSummary, ruleUpdate, sameParams, validateParams } from "./operations";

describe("parámetros de regla", () => {
  it("admite enteros dentro de rango", () => {
    const v = validateParams("unusual_cancellations", { thresholdCount: "5", windowMinutes: "60" });
    assert.deepEqual(v, { ok: true, params: { thresholdCount: 5, windowMinutes: 60 } });
    assert.deepEqual(validateParams("schedule_price_changes", { maxPendingMinutes: "30" }), { ok: true, params: { maxPendingMinutes: 30 } });
  });
  it("rechaza fuera de rango, vacío y decimales con mensaje en español", () => {
    const v = validateParams("route_incidents", { thresholdCount: "0", windowMinutes: "4" });
    assert.equal(v.ok, false);
    if (!v.ok) {
      assert.match(v.errors.thresholdCount ?? "", /entre 1 y 1000/);
      assert.match(v.errors.windowMinutes ?? "", /entre 5 y 1440/);
    }
    for (const bad of ["", "abc", "1,5", "-3", "1441"]) {
      assert.equal(validateParams("schedule_price_changes", { maxPendingMinutes: bad }).ok, false, `«${bad}»`);
    }
  });
  it("convierte a texto y compara", () => {
    assert.deepEqual(paramsToDraft("unusual_cancellations", { thresholdCount: 5, windowMinutes: 60 }), { thresholdCount: "5", windowMinutes: "60" });
    assert.equal(sameParams("unusual_cancellations", { thresholdCount: 5, windowMinutes: 60 }, { thresholdCount: 5, windowMinutes: 60 }), true);
    assert.equal(sameParams("unusual_cancellations", { thresholdCount: 5, windowMinutes: 60 }, { thresholdCount: 6, windowMinutes: 60 }), false);
  });
});

describe("resúmenes y cambios", () => {
  it("resume cada regla en español", () => {
    assert.match(ruleSummary({ kind: "unusual_cancellations", params: { thresholdCount: 5, windowMinutes: 60 } }), /^A partir de 5 cancelaciones en 1 h$/);
    assert.match(ruleSummary({ kind: "route_incidents", params: { thresholdCount: 1, windowMinutes: 60 } }), /1 incidencia en 1 h/);
    assert.match(ruleSummary({ kind: "schedule_price_changes", params: { maxPendingMinutes: 30 } }), /más de 30 min sin respuesta/);
  });
  it("el cambio de una regla solo lleva lo que cambia", () => {
    assert.deepEqual(ruleUpdate("route_incidents", { enabled: false }), { rules: [{ kind: "route_incidents", enabled: false }] });
    assert.deepEqual(ruleUpdate("route_incidents", { params: { thresholdCount: 2, windowMinutes: 30 } }), {
      rules: [{ kind: "route_incidents", params: { thresholdCount: 2, windowMinutes: 30 } }],
    });
  });
  it("cuenta reglas activas", () => {
    const rule = (enabled: boolean) => ({ kind: "route_incidents" as const, label: "", enabled, params: {}, source: "available" as const, sourceNote: null });
    assert.equal(activeRuleCount([rule(true), rule(false), rule(true)]), 2);
  });
});
