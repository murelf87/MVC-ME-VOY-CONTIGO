import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlanView } from "@/api/types";
import { buildPlanCards, lookOf, withProposalSuffix } from "./plans";

const pending = { cents: null, currency: "EUR" as const, status: "pending_definition" as const };

const free: PlanView = {
  code: "free",
  name: "Cuenta gratuita",
  tagline: "Uso ocasional",
  status: "active",
  features: ["Buscar y reservar plazas", "Guardar destinos y rutina"],
  economicsNote: null,
  availabilityNote: null,
  price: { cents: 0, currency: "EUR", status: "defined" },
};
const premium: PlanView = {
  code: "premium_driver",
  name: "Premium Conductor",
  tagline: "Para rutas regulares",
  status: "proposal",
  features: ["Gestionar tus plazas semanales"],
  economicsNote: { title: "Cuota y comisiones por definir", detail: "Propuesta en fase de estudio." },
  availabilityNote: null,
  price: pending,
};
const membership: PlanView = {
  code: "membership",
  name: "Membresía",
  tagline: "Sin fecha de lanzamiento",
  status: "unavailable",
  features: ["No debería verse"],
  economicsNote: null,
  availabilityNote: "Más opciones y ventajas para usuarios frecuentes.",
  price: pending,
};

describe("tarjetas de planes", () => {
  const cards = buildPlanCards([free, premium, membership], "free");

  it("cuenta gratuita: plan actual, azul, con sus funciones", () => {
    const card = cards[0];
    assert.equal(card?.look, "active");
    assert.equal(card?.current, true);
    assert.equal(card?.icon, "person");
    assert.equal(card?.tag, null);
    assert.deepEqual(card?.features, ["Buscar y reservar plazas", "Guardar destinos y rutina"]);
  });

  it("premium conductor: etiqueta «Propuesta», nota de cuota y no es el plan actual", () => {
    const card = cards[1];
    assert.equal(card?.look, "proposal");
    assert.equal(card?.tag, "Propuesta");
    assert.equal(card?.current, false);
    assert.equal(card?.icon, "car");
    assert.deepEqual(card?.economicsNote, { title: "Cuota y comisiones por definir", detail: "Propuesta en fase de estudio." });
  });

  it("membresía: gris, con sufijo «(Propuesta)», sin funciones y con su nota", () => {
    const card = cards[2];
    assert.equal(card?.look, "unavailable");
    assert.equal(card?.name, "Membresía (Propuesta)");
    assert.deepEqual(card?.features, []);
    assert.equal(card?.availabilityNote, "Más opciones y ventajas para usuarios frecuentes.");
    assert.equal(card?.icon, "crown");
  });

  it("sin plan actual conocido nada se marca como actual", () => {
    assert.deepEqual(buildPlanCards([free, premium], null).map((card) => card.current), [false, false]);
  });

  it("el texto accesible resume la tarjeta", () => {
    assert.ok(cards[1]?.a11yLabel.includes("Cuota y comisiones por definir"));
    assert.ok(cards[0]?.a11yLabel.includes("Tu plan actual"));
  });
});

describe("utilidades", () => {
  it("el sufijo no se duplica", () => {
    assert.equal(withProposalSuffix("Membresía"), "Membresía (Propuesta)");
    assert.equal(withProposalSuffix("Membresía (Propuesta)"), "Membresía (Propuesta)");
  });
  it("aspecto por estado", () => {
    assert.equal(lookOf("active"), "active");
    assert.equal(lookOf("proposal"), "proposal");
    assert.equal(lookOf("unavailable"), "unavailable");
  });
});
