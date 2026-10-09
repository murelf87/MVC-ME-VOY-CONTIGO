// Pruebas del «Detalle de la aportación» (15): composición por trayecto (15a) y semanal (15b), «Por definir» y «ejemplo».
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Money, TripQuote } from "@/api/types";
import { NBSP } from "@/i18n";
import { buildQuoteView, formatRatePerKm } from "./quoteView";

const eur = (cents: number, status: Money["status"] = "illustrative"): Money => ({ cents, currency: "EUR", status });
const pending: Money = { cents: null, currency: "EUR", status: "pending_definition" };

function quote(over: Partial<TripQuote> = {}): TripQuote {
  return {
    state: "pending_definition",
    tariff: { state: "approved", version: 1 },
    basis: { roadDistanceM: 6000, rateMicrosPerKm: 1_000_000 },
    contribution: eur(600),
    managementFee: pending,
    total: pending,
    weekly: null,
    lockedAt: null,
    ...over,
  };
}

describe("formatRatePerKm", () => {
  it("céntimos exactos: 300000 µ€/km → «0,30 €/km»", () => {
    assert.equal(formatRatePerKm(300_000), `0,30${NBSP}€/km`);
  });
  it("fracciones de céntimo: 132500 µ€/km → «0,1325 €/km»", () => {
    assert.equal(formatRatePerKm(132_500), `0,1325${NBSP}€/km`);
  });
  it("mantiene dos decimales mínimo: 125000 µ€/km → «0,125 €/km»", () => {
    assert.equal(formatRatePerKm(125_000), `0,125${NBSP}€/km`);
  });
});

describe("buildQuoteView · por trayecto (lámina 15a)", () => {
  const view = buildQuoteView(quote(), 6000);
  it("rotula el bloque como ejemplo y enseña el importe orientativo", () => {
    assert.equal(view.layout, "perTrip");
    assert.equal(view.heading, "Detalle de la aportación (ejemplo)");
    assert.equal(view.lines.length, 1);
    assert.equal(view.lines[0]?.label, "Aportación según recorrido");
    assert.equal(view.lines[0]?.caption, `Ejemplo orientativo (6${NBSP}km)`);
    assert.equal(view.lines[0]?.value, `6,00${NBSP}€`);
  });
  it("Gestión MVC y el total quedan «Por definir» mientras la comisión no exista", () => {
    assert.deepEqual(view.fee, { label: "Gestión MVC · Por definir", value: null, illustrative: false });
    assert.equal(view.total.label, "Total antes de confirmar");
    assert.equal(view.total.value, "Por definir");
    assert.equal(view.pending, true);
    assert.equal(view.illustrative, true);
  });
});

describe("buildQuoteView · semanal (lámina 15b)", () => {
  const weeklyQuote = quote({
    basis: { roadDistanceM: 6000, rateMicrosPerKm: 300_000 },
    contribution: eur(180),
    weekly: {
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      legsPerDay: 2,
      tripsPerWeek: 10,
      contributionPerWeek: eur(1800),
      totalPerWeek: pending,
    },
  });
  const view = buildQuoteView(weeklyQuote, 6000);
  it("enseña tarifa, importe por trayecto y por semana con las frases de la lámina", () => {
    assert.equal(view.layout, "weekly");
    assert.deepEqual(
      view.lines.map((line) => line.label),
      [`Ejemplo · 0,30${NBSP}€/km`, `6${NBSP}km por trayecto · 1,80${NBSP}€`, `5${NBSP}días, ida y vuelta · 18,00${NBSP}€/semana`],
    );
  });
  it("el total pendiente dice «Pendiente de tarifa final · Por definir»", () => {
    assert.equal(view.total.label, "Total · Pendiente de tarifa final");
    assert.equal(view.total.value, "Por definir");
    assert.equal(view.fee.label, "Gestión MVC · Por definir");
  });
  it("con tarifa aprobada y todo definido no habla de ejemplo ni de pendiente", () => {
    const defined = buildQuoteView(
      quote({
        state: "defined",
        basis: { roadDistanceM: 6000, rateMicrosPerKm: 300_000 },
        contribution: eur(180, "defined"),
        managementFee: eur(18, "defined"),
        total: eur(198, "defined"),
        weekly: {
          weekdays: ["mon", "wed"],
          legsPerDay: 1,
          tripsPerWeek: 2,
          contributionPerWeek: eur(360, "defined"),
          totalPerWeek: eur(396, "defined"),
        },
      }),
      6000,
    );
    assert.equal(defined.heading, "Detalle de la aportación");
    assert.equal(defined.illustrative, false);
    assert.equal(defined.pending, false);
    assert.equal(defined.lines[0]?.label, `Tarifa · 0,30${NBSP}€/km`);
    assert.equal(defined.lines[2]?.label, `2${NBSP}días, solo ida · 3,60${NBSP}€/semana`);
    assert.equal(defined.fee.value, `0,18${NBSP}€`);
    assert.equal(defined.total.label, "Total por semana");
    assert.equal(defined.total.value, `3,96${NBSP}€`);
  });
});

describe("buildQuoteView · sin tarifa aprobada", () => {
  it("por trayecto: todo «Por definir»", () => {
    const view = buildQuoteView(
      quote({ tariff: { state: "none_approved", version: null }, basis: { roadDistanceM: 6000, rateMicrosPerKm: null }, contribution: pending }),
      6000,
    );
    assert.equal(view.heading, "Detalle de la aportación");
    assert.equal(view.lines[0]?.value, "Por definir");
    assert.equal(view.lines[0]?.caption, `Según recorrido (6${NBSP}km)`);
    assert.equal(view.total.value, "Por definir");
    assert.equal(view.illustrative, false);
  });
  it("semanal: no hay línea de tarifa y cada importe dice «Por definir»", () => {
    const view = buildQuoteView(
      quote({
        tariff: { state: "none_approved", version: null },
        basis: { roadDistanceM: 6000, rateMicrosPerKm: null },
        contribution: pending,
        weekly: {
          weekdays: ["mon", "tue", "wed", "thu", "fri"],
          legsPerDay: 2,
          tripsPerWeek: 10,
          contributionPerWeek: pending,
          totalPerWeek: pending,
        },
      }),
      6000,
    );
    assert.deepEqual(
      view.lines.map((line) => line.label),
      [`6${NBSP}km por trayecto · Por definir`, `5${NBSP}días, ida y vuelta · Por definir`],
    );
  });
});
