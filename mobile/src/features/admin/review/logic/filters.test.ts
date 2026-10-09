// Pruebas de los filtros de provincia y periodo (admin-review).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Province } from "@/api/types";
import {
  BOOKING_PERIOD_ORDER,
  PROVINCE_ALL,
  SUMMARY_PERIOD_ORDER,
  bookingPeriodOptions,
  provinceOptions,
  refundPeriodOptions,
  resolveProvince,
  summaryPeriodOptions,
} from "./filters";

const sevilla: Province = { id: "p-41", code: "41", name: "Sevilla" };
const cadiz: Province = { id: "p-11", code: "11", name: "Cádiz" };

describe("resolveProvince", () => {
  it("sin elegir, usa la primera que da el servidor", () => {
    assert.deepEqual(resolveProvince(null, [sevilla, cadiz]), { id: "p-41", code: "41", label: "Sevilla" });
  });
  it("respeta la elección y «todas»", () => {
    assert.deepEqual(resolveProvince("p-11", [sevilla, cadiz]), { id: "p-11", code: "11", label: "Cádiz" });
    assert.deepEqual(resolveProvince(PROVINCE_ALL, [sevilla]), { id: null, code: null, label: "Todas las provincias" });
  });
  it("una provincia que ya no existe, o ninguna, vuelve a «todas»", () => {
    assert.equal(resolveProvince("p-99", [sevilla]).id, null);
    assert.equal(resolveProvince(null, []).id, null);
    assert.equal(resolveProvince(null, undefined).label, "Todas las provincias");
  });
});

describe("opciones", () => {
  it("la lista de provincias empieza por «Todas»", () => {
    assert.deepEqual(provinceOptions([sevilla]), [
      { value: PROVINCE_ALL, label: "Todas las provincias" },
      { value: "p-41", label: "Sevilla" },
    ]);
  });
  it("los periodos tienen etiqueta y mismo orden que el contrato", () => {
    assert.deepEqual(
      refundPeriodOptions().map((option) => option.label),
      ["Últimos 7 días", "Últimos 30 días", "Últimos 90 días", "Último año", "Todo el histórico"],
    );
    assert.deepEqual(bookingPeriodOptions().map((option) => option.value), [...BOOKING_PERIOD_ORDER]);
    assert.deepEqual(
      summaryPeriodOptions().map((option) => option.label),
      ["Hoy", "Ayer", "Últimos 7 días", "Últimos 30 días", "Este mes"],
    );
    assert.deepEqual([...SUMMARY_PERIOD_ORDER], ["today", "yesterday", "last_7_days", "last_30_days", "this_month"]);
  });
});
