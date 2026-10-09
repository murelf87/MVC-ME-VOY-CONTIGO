import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addStop, canAddStop, emptyDraft, hasErrors, moveStop, planBody, planKey, pointsOf, publishBody, removeStop, replacePoint, shortPlaceName, toggleOptional, validateRouteForm, type RouteDraft } from "./routeDraft";

const A = { label: "Palomares del Río", lat: 37.31, lng: -6.05 };
const B = { label: "Sevilla (Trabajo)", lat: 37.39, lng: -5.98 };
const M = { label: "Mairena del Aljarafe", lat: 37.34, lng: -6.06 };
const N = { label: "Gelves", lat: 37.33, lng: -6.02 };

const base = (): RouteDraft => ({ ...emptyDraft("d1", 3), origin: A, destination: B, outboundLocal: "07:00" });

describe("formulario de ruta (18)", () => {
  it("nombre corto: sin paréntesis ni resto de dirección", () => {
    assert.equal(shortPlaceName("Sevilla (Trabajo)"), "Sevilla");
    assert.equal(shortPlaceName("Av. de la Palmera, Sevilla"), "Av. de la Palmera");
    assert.equal(shortPlaceName(null), "");
  });
  it("lo mínimo: origen, destino y hora de salida", () => {
    const errors = validateRouteForm(emptyDraft("d", 3), 3);
    assert.deepEqual(Object.keys(errors).sort(), ["destination", "origin", "outbound"]);
    assert.equal(hasErrors(validateRouteForm(base(), 3)), false);
  });
  it("origen = destino sin paradas no vale; con una parada sí", () => {
    const same = { ...base(), destination: { ...A } };
    assert.ok(validateRouteForm(same, 3).destination);
    assert.equal(validateRouteForm({ ...same, stops: [M] }, 3).destination, undefined);
  });
  it("puntual exige día; la vuelta sale después de la ida; plazas ≤ las del vehículo", () => {
    assert.ok(validateRouteForm({ ...base(), frequency: "one_off" }, 3).date);
    assert.ok(validateRouteForm({ ...base(), returnLocal: "06:30" }, 3).return);
    assert.equal(validateRouteForm({ ...base(), returnLocal: "15:00" }, 3).return, undefined);
    assert.ok(validateRouteForm({ ...base(), seats: 4 }, 3).seats);
    assert.equal(validateRouteForm({ ...base(), seats: 4 }, null).seats, undefined);
  });
  it("cuerpos del plan y de la publicación", () => {
    const draft = { ...base(), stops: [M], returnLocal: "15:00" as const };
    const plan = planBody(draft, "p1");
    assert.equal(plan?.stops?.length, 1);
    assert.equal(plan?.departureLocal, "07:00");
    const pub = publishBody({ ...draft, frequency: "one_off", date: "2026-10-07" }, "v1", "p1");
    assert.equal(pub?.startDate, "2026-10-07");
    assert.equal(pub?.returnLocal, "15:00");
    assert.equal(publishBody(emptyDraft("x", 3), "v", "p"), null);
    assert.equal(publishBody({ ...draft, frequency: "daily_workdays" }, "v1", "p1")?.startDate, undefined);
  });
});

describe("paradas (19)", () => {
  it("añadir va justo antes del destino; máximo 10", () => {
    let d = addStop(addStop(base(), M), N);
    assert.deepEqual(pointsOf(d).map((p) => p.label), ["Palomares del Río", "Mairena del Aljarafe", "Gelves", "Sevilla (Trabajo)"]);
    for (let i = 0; i < 12; i += 1) d = addStop(d, M);
    assert.equal(d.stops.length, 10);
    assert.equal(canAddStop(d), false);
  });
  it("mover, quitar y cambiar", () => {
    const d = addStop(addStop(base(), M), N);
    assert.deepEqual(moveStop(d, 0, 1).stops.map((s) => s.label), ["Gelves", "Mairena del Aljarafe"]);
    assert.equal(moveStop(d, 0, -1), d, "la primera parada no sube más");
    assert.deepEqual(removeStop(d, 0).stops.map((s) => s.label), ["Gelves"]);
    assert.equal(replacePoint(d, 0, N).origin?.label, "Gelves");
    assert.equal(replacePoint(d, 3, N).destination?.label, "Gelves");
    assert.equal(replacePoint(d, 1, B).stops[0]?.label, "Sevilla (Trabajo)");
  });
  it("«opcional» se conserva al cambiar el sitio y entra en la clave del plan", () => {
    const d = toggleOptional(addStop(base(), M), 0);
    assert.equal(d.stops[0]?.optional, true);
    assert.equal(replacePoint(d, 1, N).stops[0]?.optional, true);
    assert.notEqual(planKey(d), planKey(addStop(base(), M)));
  });
});
