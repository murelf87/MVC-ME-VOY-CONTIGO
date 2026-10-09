// Pruebas de la derivación de estados del buscador de lugares (search-browse).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GeocodeResult } from "@/api/types";
import { MAX_PLACE_ITEMS, derivePlaceListView, toPlaceItems, type PlaceListInput } from "./placeListView";

function geo(id: string, address: string, types: string[] = ["locality"]): GeocodeResult {
  return { provider: "test", placeId: id, formattedAddress: address, location: { latitude: 37.3, longitude: -5.9 }, types };
}

const idleQuery = { data: undefined, isLoading: false, isIdle: true, isError: false, isOffline: false, error: null };

function input(overrides: Partial<PlaceListInput>): PlaceListInput {
  return {
    text: "mairena",
    debouncedText: "mairena",
    query: idleQuery,
    authRequired: false,
    ...overrides,
  };
}

describe("toPlaceItems", () => {
  it("quita repetidos por placeId, limita y pone icono", () => {
    const items = toPlaceItems([
      geo("a", "Universidad de Sevilla, C. San Fernando, 4, Sevilla, España", ["university"]),
      geo("a", "Universidad de Sevilla, otra"),
      geo("b", "Mairena del Aljarafe, Sevilla, España"),
    ]);
    assert.equal(items.length, 2);
    assert.equal(items[0]?.title, "Universidad de Sevilla");
    assert.equal(items[0]?.icon, "school");
    assert.equal(items[1]?.place.label, "Mairena del Aljarafe");

    const many = Array.from({ length: 20 }, (_, i) => geo(`p${i}`, `Lugar ${i}, Sevilla`));
    assert.equal(toPlaceItems(many).length, MAX_PLACE_ITEMS);
  });
});

describe("derivePlaceListView", () => {
  it("con menos de 3 letras solo da la pista (recientes y ubicación)", () => {
    assert.equal(derivePlaceListView(input({ text: "ma", debouncedText: "ma" })).kind, "hint");
    assert.equal(derivePlaceListView(input({ text: "  ", debouncedText: "" })).kind, "hint");
  });

  it("un invitado busca como cualquiera: solo ve el aviso de cuenta si el servidor contesta 401", () => {
    // Sin 401 el estado depende únicamente de la consulta (aquí, aún sin lanzar: «cargando»).
    assert.equal(derivePlaceListView(input({})).kind, "loading");
    const rejected = { ...idleQuery, isIdle: false, isError: true, error: new Error("401") };
    assert.equal(derivePlaceListView(input({ query: rejected, authRequired: true })).kind, "guest");
    assert.equal(derivePlaceListView(input({ query: rejected })).kind, "error");
  });

  it("mientras escribe o carga muestra «cargando»", () => {
    assert.equal(derivePlaceListView(input({ text: "mairena d", debouncedText: "mairena" })).kind, "loading");
    assert.equal(derivePlaceListView(input({ query: { ...idleQuery, isIdle: false, isLoading: true } })).kind, "loading");
  });

  it("muestra los resultados, o «sin resultados» si la lista viene vacía", () => {
    const ok = derivePlaceListView(
      input({ query: { ...idleQuery, isIdle: false, data: [geo("b", "Mairena del Aljarafe, Sevilla, España")] } }),
    );
    assert.equal(ok.kind, "results");
    assert.equal(ok.kind === "results" ? ok.items.length : -1, 1);
    assert.equal(derivePlaceListView(input({ query: { ...idleQuery, isIdle: false, data: [] } })).kind, "empty");
  });

  it("conserva los resultados aunque la actualización falle", () => {
    const view = derivePlaceListView(
      input({ query: { ...idleQuery, isIdle: false, isOffline: true, error: new Error("offline"), data: [geo("b", "Mairena, Sevilla")] } }),
    );
    assert.equal(view.kind, "results");
  });

  it("distingue sin conexión, sesión requerida y error", () => {
    const failed = { ...idleQuery, isIdle: false, isError: true, error: new Error("x") };
    assert.equal(derivePlaceListView(input({ query: { ...failed, isOffline: true } })).kind, "offline");
    assert.equal(derivePlaceListView(input({ query: failed, authRequired: true })).kind, "guest");
    assert.equal(derivePlaceListView(input({ query: failed })).kind, "error");
  });
});
