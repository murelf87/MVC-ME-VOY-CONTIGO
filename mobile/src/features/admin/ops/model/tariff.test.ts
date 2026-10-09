// Pruebas del formulario de tarifa en borrador (admin-ops, pantalla 40a/40b).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminTariffVersion } from "@/api/types";
import {
  EMPTY_TARIFF_FORM,
  exampleLine,
  exampleRequestFor,
  formFromDraft,
  isDraftComplete,
  isTariffDirty,
  kmText,
  parseDistanceKm,
  tariffLook,
  validateActivation,
  validateTariffForm,
} from "./tariff";

const NBSP = " ";

function draft(patch: Partial<AdminTariffVersion>): AdminTariffVersion {
  return {
    id: "a7b8c9d0-e1f2-4a3b-8c4d-e5f6a7b8c916",
    version: 3,
    status: "draft",
    ratePerKmMicros: 300000,
    passengerCommissionBps: null,
    driverCommissionBps: null,
    sharedCostCapCents: null,
    premiumMonthlyCents: null,
    effectiveFrom: null,
    notes: null,
    approvalReference: null,
    createdAt: "2026-10-04T09:00:00.000Z",
    updatedAt: "2026-10-09T13:20:00.000Z",
    createdBy: null,
    updatedBy: null,
    ...patch,
  };
}

describe("formulario ↔ borrador", () => {
  it("lámina 40a: tarifa 0,30 y todo lo demás por definir", () => {
    const form = formFromDraft(draft({}));
    assert.deepEqual(form, { ...EMPTY_TARIFF_FORM, rate: "0,30" });
    assert.equal(tariffLook(draft({}), false), "pending");
  });
  it("lámina 40b: tarifa 0,18 y comisiones 10 %", () => {
    const d = draft({ ratePerKmMicros: 180000, passengerCommissionBps: 1000, driverCommissionBps: 1000 });
    const form = formFromDraft(d);
    assert.equal(form.rate, "0,18");
    assert.equal(form.driverCommission, "10");
    assert.equal(form.passengerCommission, "10");
    assert.equal(form.premium, "");
    assert.equal(tariffLook(d, false), "inputs");
  });
  it("sin borrador: formulario vacío y aspecto «por definir»", () => {
    assert.deepEqual(formFromDraft(null), EMPTY_TARIFF_FORM);
    assert.equal(tariffLook(null, false), "pending");
  });
  it("definir una comisión desde el selector cambia el aspecto aunque el servidor aún no la tenga", () => {
    assert.equal(tariffLook(draft({}), true), "inputs");
  });
});

describe("validación", () => {
  it("el formulario válido produce el cuerpo completo con enteros", () => {
    const v = validateTariffForm({ rate: "0,18", driverCommission: "10", passengerCommission: "10", premium: "2,99", cap: "", notes: "  Propuesta  " });
    assert.equal(v.valid, true);
    assert.deepEqual(v.input, {
      ratePerKmMicros: 180000,
      passengerCommissionBps: 1000,
      driverCommissionBps: 1000,
      premiumMonthlyCents: 299,
      sharedCostCapCents: null,
      notes: "Propuesta",
    });
  });
  it("todo vacío es válido (todo «Por definir»)", () => {
    const v = validateTariffForm(EMPTY_TARIFF_FORM);
    assert.equal(v.valid, true);
    assert.equal(v.input?.ratePerKmMicros, null);
    assert.equal(v.input?.notes, null);
  });
  it("devuelve un error en español por campo", () => {
    const v = validateTariffForm({ ...EMPTY_TARIFF_FORM, rate: "9", driverCommission: "150", premium: "x", notes: "n".repeat(1001) });
    assert.equal(v.valid, false);
    assert.equal(v.input, null);
    assert.match(v.errors.rate ?? "", /entre 0 y 5 €/);
    assert.match(v.errors.driverCommission ?? "", /entre 0 % y 100 %/);
    assert.match(v.errors.premium ?? "", /importe en euros/);
    assert.match(v.errors.notes ?? "", /1000 caracteres/);
    assert.equal(v.errors.passengerCommission, undefined);
  });
});

describe("cambios sin guardar", () => {
  it("«0,3» y «0,30» son el mismo valor", () => {
    const base = formFromDraft(draft({}));
    assert.equal(isTariffDirty({ ...base, rate: "0,3" }, base), false);
    assert.equal(isTariffDirty({ ...base, rate: "0,31" }, base), true);
    assert.equal(isTariffDirty({ ...base, notes: " " }, base), false);
    assert.equal(isTariffDirty({ ...base, notes: "x" }, base), true);
  });
  it("un texto no válido cuenta como cambio", () => {
    const base = formFromDraft(draft({}));
    assert.equal(isTariffDirty({ ...base, rate: "abc" }, base), true);
  });
});

describe("ejemplo", () => {
  it("solo se pide con campos válidos", () => {
    const ok = exampleRequestFor({ ...EMPTY_TARIFF_FORM, rate: "0,30" }, 18000);
    assert.deepEqual(ok, { distanceMeters: 18000, ratePerKmMicros: 300000, passengerCommissionBps: null, driverCommissionBps: null });
    assert.equal(exampleRequestFor({ ...EMPTY_TARIFF_FORM, rate: "x" }, 18000), null);
    assert.equal(exampleRequestFor(EMPTY_TARIFF_FORM, 0), null);
    assert.equal(exampleRequestFor(EMPTY_TARIFF_FORM, 2_000_001), null);
  });
  it("distancias y rótulos", () => {
    assert.equal(kmText(18000), "18");
    assert.equal(kmText(18500), "18,5");
    assert.equal(kmText(18040), "18,04");
    assert.equal(parseDistanceKm("18"), 18000);
    assert.equal(parseDistanceKm("18,5"), 18500);
    assert.equal(parseDistanceKm("0"), null);
    assert.equal(parseDistanceKm("abc"), null);
    assert.equal(parseDistanceKm("2001"), null);
    assert.equal(exampleLine(18000, 300000, "tarifa por definir"), `18${NBSP}km × 0,30${NBSP}€/km`);
    assert.equal(exampleLine(18000, null, "tarifa por definir"), `18${NBSP}km × tarifa por definir`);
  });
});

describe("borrador completo", () => {
  it("exige tarifa y las dos comisiones", () => {
    assert.equal(isDraftComplete(null), false);
    assert.equal(isDraftComplete(draft({})), false);
    assert.equal(isDraftComplete(draft({ passengerCommissionBps: 1000, driverCommissionBps: 1000 })), true);
    assert.equal(isDraftComplete(draft({ passengerCommissionBps: 1000, driverCommissionBps: null })), false);
  });
});

describe("activación", () => {
  const NOW = Date.parse("2026-10-05T07:17:00+02:00");
  it("pide referencia y fecha futura", () => {
    const empty = validateActivation("", "", NOW);
    assert.equal(empty.ok, false);
    if (!empty.ok) {
      assert.ok(empty.errors.reference);
      assert.ok(empty.errors.effectiveFrom);
    }
    const past = validateActivation("ACTA-1", "05/10/2026", NOW);
    assert.equal(past.ok, false);
    if (!past.ok) assert.match(past.errors.effectiveFrom ?? "", /futura/);
  });
  it("devuelve la petición con la medianoche de Madrid", () => {
    const ok = validateActivation("  ACTA-2026-11  ", "10/11/2026", NOW);
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.request.approvalReference, "ACTA-2026-11");
      assert.equal(ok.request.effectiveFrom, "2026-11-09T23:00:00.000Z");
    }
  });
  it("rechaza referencias demasiado largas y fechas imposibles", () => {
    const long = validateActivation("x".repeat(301), "10/11/2026", NOW);
    assert.equal(long.ok, false);
    const bad = validateActivation("ACTA-1", "31/02/2027", NOW);
    assert.equal(bad.ok, false);
  });
});
