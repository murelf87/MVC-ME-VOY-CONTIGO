// Pruebas de las liquidaciones (admin-ops): periodos y estados.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canExecute, countByStatus, payoutTone, periodLabel, recentPeriods, validatePeriod } from "./payouts";

const NOW = Date.parse("2026-10-05T07:17:00+02:00");

describe("periodo", () => {
  it("admite 2026-10 y 10/2026", () => {
    assert.deepEqual(validatePeriod("2026-10"), { ok: true, period: "2026-10" });
    assert.deepEqual(validatePeriod("10/2026"), { ok: true, period: "2026-10" });
    assert.deepEqual(validatePeriod("9-2026"), { ok: true, period: "2026-09" });
  });
  it("rechaza lo que no es un mes", () => {
    for (const bad of ["", "2026-13", "13/2026", "octubre", "2026", "2026-1", "1999-10"]) {
      assert.equal(validatePeriod(bad).ok, false, `«${bad}»`);
    }
  });
  it("los últimos meses, del actual hacia atrás, cruzando de año", () => {
    assert.deepEqual(recentPeriods(NOW, 3), ["2026-10", "2026-09", "2026-08"]);
    assert.deepEqual(recentPeriods(Date.parse("2026-02-10T12:00:00+01:00"), 4), ["2026-02", "2026-01", "2025-12", "2025-11"]);
  });
  it("etiqueta en español", () => {
    assert.equal(periodLabel("2026-10"), "octubre de 2026");
    assert.equal(periodLabel("2026-01"), "enero de 2026");
    assert.equal(periodLabel("raro"), "raro");
  });
});

describe("estados", () => {
  it("solo generadas o fallidas se pueden enviar al proveedor", () => {
    assert.equal(canExecute({ status: "draft" }), true);
    assert.equal(canExecute({ status: "failed" }), true);
    for (const status of ["processing", "paid", "cancelled"] as const) assert.equal(canExecute({ status }), false);
  });
  it("tonos y recuentos", () => {
    assert.equal(payoutTone("paid"), "green");
    assert.equal(payoutTone("processing"), "amber");
    assert.equal(payoutTone("failed"), "red");
    assert.deepEqual(countByStatus([{ status: "draft" }, { status: "draft" }, { status: "paid" }]), { draft: 2, processing: 0, paid: 1, failed: 0, cancelled: 0 });
  });
});
