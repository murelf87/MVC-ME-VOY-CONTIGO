// Pruebas de «Punto de recogida» (13): propuestas → tarjetas, selección inicial y composición del mapa.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PickupProposal } from "@/api/types";
import { buildPickupMap, initialSelection, proposalA11y, routeUntil, summaryOf, toProposalViews } from "./pickup";

function proposal(over: Partial<PickupProposal> & { id: string; code: string }): PickupProposal {
  return {
    name: "Aparcamiento público",
    address: "Av. Manuel Siurot",
    location: { lat: 37.38, lng: -5.99, precision: "precise" },
    source: "driver_stop",
    walk: { minutes: 4, distanceM: 300, estimated: true },
    detour: { minutes: 2, source: "stop" },
    fromSegmentSeq: 1,
    boardsAt: "2026-10-05T06:00:00.000Z",
    boardsAtLocal: "08:00",
    distanceToDropoffM: 6000,
    recommended: false,
    ...over,
  };
}

const A = proposal({ id: "pp1_a", code: "A", recommended: true });
const B = proposal({
  id: "pp1_b",
  code: "B",
  name: "Av. de la Buhaira",
  address: "(Frente al centro deportivo)",
  location: { lat: 37.375, lng: -5.975, precision: "precise" },
  walk: { minutes: 6, distanceM: 450, estimated: true },
  detour: { minutes: 3, source: "stop" },
  distanceToDropoffM: 4500,
});

describe("toProposalViews", () => {
  it("separa nombre y dirección como las tarjetas de la lámina y compone la línea de detalle", () => {
    const [a, b] = toProposalViews([A, B]);
    assert.equal(a?.title, "Aparcamiento público");
    assert.equal(a?.subtitle, "Av. Manuel Siurot");
    assert.equal(a?.detailLine, "4 min a pie · Desvío +2 min");
    assert.equal(b?.title, "Av. de la Buhaira");
    assert.equal(b?.subtitle, "(Frente al centro deportivo)");
  });
  it("sin nombre usa la dirección; si nombre y dirección coinciden no los repite", () => {
    const [onlyAddress, same] = toProposalViews([
      proposal({ id: "1", code: "A", name: null, address: "Calle Feria 3" }),
      proposal({ id: "2", code: "B", name: "Calle Feria 3", address: "Calle Feria 3" }),
    ]);
    assert.equal(onlyAddress?.title, "Calle Feria 3");
    assert.equal(onlyAddress?.subtitle, null);
    assert.equal(same?.subtitle, null);
  });
  it("solo enseña dos propuestas aunque lleguen más", () => {
    assert.equal(toProposalViews([A, B, proposal({ id: "pp1_c", code: "C" })]).length, 2);
  });
  it("sin nombre ni dirección: «Punto de encuentro en la ruta»", () => {
    const [view] = toProposalViews([proposal({ id: "x", code: "A", name: null, address: null })]);
    assert.equal(view?.title, "Punto de encuentro en la ruta");
  });
});

describe("initialSelection", () => {
  const views = toProposalViews([A, B]);
  it("respeta el punto ya elegido si sigue propuesto", () => assert.equal(initialSelection(views, "pp1_b"), "pp1_b"));
  it("si el elegido ya no existe, usa el recomendado", () => assert.equal(initialSelection(views, "pp1_zzz"), "pp1_a"));
  it("sin recomendado, el primero; sin propuestas, nada", () => {
    assert.equal(initialSelection(toProposalViews([proposal({ id: "q", code: "A" })]), null), "q");
    assert.equal(initialSelection([], "pp1_a"), null);
  });
});

describe("resumen y accesibilidad", () => {
  const [a] = toProposalViews([A]);
  it("summaryOf conserva lo que las pantallas 14–15 enseñan", () => {
    assert.deepEqual(a === undefined ? null : summaryOf(a), {
      code: "A",
      name: "Aparcamiento público",
      address: "Av. Manuel Siurot",
      walkMinutes: 4,
      detourMinutes: 2,
    });
  });
  it("la etiqueta accesible incluye punto, nombre, detalle, recomendado y estado", () => {
    assert.ok(a);
    const label = proposalA11y(a, true);
    assert.match(label, /Punto A/);
    assert.match(label, /Aparcamiento público/);
    assert.match(label, /Recomendado/);
    assert.match(label, /Seleccionado/);
  });
});

describe("routeUntil", () => {
  const line: Array<readonly [number, number]> = [
    [-5.99, 37.4],
    [-5.99, 37.39],
    [-5.99, 37.38],
    [-5.98, 37.37],
  ];
  it("corta en el punto de la ruta más cercano y acaba EXACTAMENTE en el destino", () => {
    const target = { lat: 37.385, lng: -5.9902 };
    const points = routeUntil(line, target);
    assert.deepEqual(points[0], { lat: 37.4, lng: -5.99 });
    assert.deepEqual(points[points.length - 1], target);
    assert.ok(points.length <= 4);
  });
  it("con geometría vacía devuelve solo el destino", () => {
    assert.deepEqual(routeUntil([], { lat: 1, lng: 2 }), [{ lat: 1, lng: 2 }]);
  });
});

describe("buildPickupMap", () => {
  const views = toProposalViews([A, B]);
  const geometry: Array<readonly [number, number]> = [
    [-5.99, 37.4],
    [-5.99, 37.39],
    [-5.99, 37.38],
  ];
  it("lleva coche, pines A y B (el elegido resaltado), ruta, trayecto a pie y las dos etiquetas", () => {
    const origin = { lat: 37.378, lng: -5.985 };
    const model = buildPickupMap({ geometry, views, selectedId: "pp1_a", origin });
    const ids = model.markers.map((m) => m.id);
    assert.deepEqual(ids, ["car", "pickup-A", "pickup-B", "eta", "walk"]);
    const pinA = model.markers.find((m) => m.id === "pickup-A");
    assert.equal(pinA?.kind, "pickupA");
    assert.equal(pinA !== undefined && "selected" in pinA ? pinA.selected : undefined, true);
    assert.deepEqual(model.routes.map((r) => r.kind), ["route", "walk"]);
  });
  it("sin punto de partida no hay trayecto a pie ni etiqueta de minutos", () => {
    const model = buildPickupMap({ geometry, views, selectedId: "pp1_b", origin: null });
    assert.deepEqual(model.routes.map((r) => r.kind), ["route"]);
    assert.ok(!model.markers.some((m) => m.id === "walk"));
  });
  it("si estás en el punto (menos de 40 m) no se dibuja el trayecto a pie", () => {
    const model = buildPickupMap({ geometry, views, selectedId: "pp1_a", origin: { lat: 37.38, lng: -5.99 } });
    assert.ok(!model.routes.some((r) => r.kind === "walk"));
  });
});
