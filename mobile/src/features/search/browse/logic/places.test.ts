// Pruebas de la lógica pura del buscador de lugares (search-browse).
// Ejecutar:  cd mobile && node --import tsx --test "src/features/search/browse/**/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GeocodeResult } from "@/api/types";
import {
  MAX_RECENT_PLACES,
  canSearch,
  describeAddress,
  iconForPlaceTypes,
  isPlaceParam,
  isSamePlace,
  normalizeQuery,
  outsideProvinceCopy,
  parseRecentPlaces,
  placeFromGeocode,
  placeSearchPlaceholder,
  placeSearchTitle,
  rememberPlace,
  resolveReturnTarget,
} from "./places";

const sevilla = { label: "Sevilla", latitude: 37.3891, longitude: -5.9845 };
const montequinto = { label: "Montequinto", latitude: 37.3256, longitude: -5.9396 };

describe("consulta de búsqueda", () => {
  it("normaliza espacios y exige 3 letras como el servidor", () => {
    assert.equal(normalizeQuery("  Dos   Hermanas "), "Dos Hermanas");
    assert.equal(canSearch("  ab "), false);
    assert.equal(canSearch("abc"), true);
    assert.equal(canSearch("a b"), true);
    assert.equal(canSearch("   "), false);
  });
});

describe("describeAddress", () => {
  it("usa el primer tramo como título y quita el país", () => {
    assert.deepEqual(describeAddress("Universidad de Sevilla, C. San Fernando, 4, 41004 Sevilla, España"), {
      title: "Universidad de Sevilla",
      subtitle: "C. San Fernando, 4, 41004 Sevilla",
    });
  });

  it("une la calle con su número de portal", () => {
    assert.deepEqual(describeAddress("Calle Real, 12, 41089 Montequinto, España"), {
      title: "Calle Real, 12",
      subtitle: "41089 Montequinto",
    });
    assert.equal(describeAddress("Av. de la Constitución, s/n, Sevilla").title, "Av. de la Constitución, s/n");
  });

  it("acepta direcciones con un solo tramo o solo el país", () => {
    assert.deepEqual(describeAddress("Sevilla, España"), { title: "Sevilla", subtitle: null });
    assert.deepEqual(describeAddress("Montequinto, Dos Hermanas, Sevilla, España"), {
      title: "Montequinto",
      subtitle: "Dos Hermanas, Sevilla",
    });
    assert.deepEqual(describeAddress("España"), { title: "España", subtitle: null });
    assert.deepEqual(describeAddress(""), { title: "", subtitle: null });
  });
});

describe("placeFromGeocode", () => {
  it("convierte el resultado del geocodificador en un parámetro de navegación", () => {
    const result: GeocodeResult = {
      provider: "preview-sim",
      placeId: "preview-place:montequinto",
      formattedAddress: "Montequinto, Dos Hermanas, Sevilla, España",
      location: { latitude: 37.3256, longitude: -5.9396 },
      types: ["sublocality", "political"],
    };
    assert.deepEqual(placeFromGeocode(result), montequinto);
  });
});

describe("iconForPlaceTypes", () => {
  it("distingue universidades y hospitales", () => {
    assert.equal(iconForPlaceTypes(["university", "establishment"]), "school");
    assert.equal(iconForPlaceTypes(["hospital", "point_of_interest"]), "hospital");
    assert.equal(iconForPlaceTypes(["locality", "political"]), "pin");
    assert.equal(iconForPlaceTypes([]), "pin");
  });
});

describe("isPlaceParam", () => {
  it("valida lo que llega por parámetros de navegación", () => {
    assert.equal(isPlaceParam(sevilla), true);
    assert.equal(isPlaceParam({ ...sevilla, label: "  " }), false);
    assert.equal(isPlaceParam({ ...sevilla, latitude: "37" }), false);
    assert.equal(isPlaceParam({ ...sevilla, latitude: Number.NaN }), false);
    assert.equal(isPlaceParam({ ...sevilla, longitude: 200 }), false);
    assert.equal(isPlaceParam(null), false);
    assert.equal(isPlaceParam(undefined), false);
    assert.equal(isPlaceParam("Sevilla"), false);
  });
});

describe("isSamePlace", () => {
  it("considera igual lo que está a menos de 60 m", () => {
    assert.equal(isSamePlace(sevilla, { ...sevilla, latitude: sevilla.latitude + 0.0002 }), true);
    assert.equal(isSamePlace(sevilla, { ...sevilla, latitude: sevilla.latitude + 0.001 }), false);
    assert.equal(isSamePlace(sevilla, montequinto), false);
  });
});

describe("lugares recientes", () => {
  it("pone el último primero, sin repetidos y con tope", () => {
    let recent = rememberPlace([], sevilla);
    recent = rememberPlace(recent, montequinto);
    assert.deepEqual(recent, [montequinto, sevilla]);
    recent = rememberPlace(recent, { ...sevilla, label: "Sevilla centro" });
    assert.deepEqual(
      recent.map((place) => place.label),
      ["Sevilla centro", "Montequinto"],
    );
    let many = recent;
    for (let i = 0; i < 12; i += 1) {
      many = rememberPlace(many, { label: `Lugar ${i}`, latitude: 37 + i * 0.05, longitude: -6 });
    }
    assert.equal(many.length, MAX_RECENT_PLACES);
    assert.equal(many[0]?.label, "Lugar 11");
  });

  it("descarta lo corrupto al leer del almacén", () => {
    assert.deepEqual(parseRecentPlaces(null), []);
    assert.deepEqual(parseRecentPlaces({}), []);
    assert.deepEqual(parseRecentPlaces([sevilla, { label: "x" }, 4, null, { ...montequinto, extra: true }]), [sevilla, montequinto]);
    const tooMany = Array.from({ length: 20 }, (_, i) => ({ label: `L${i}`, latitude: 37, longitude: -6 }));
    assert.equal(parseRecentPlaces(tooMany).length, MAX_RECENT_PLACES);
  });
});

describe("fuera de provincia", () => {
  it("usa los literales de la lámina 36a para el destino", () => {
    const copy = outsideProvinceCopy("destination", "Sevilla");
    assert.equal(copy.title, "Destino fuera de provincia");
    assert.match(copy.message, /provincia de Sevilla/);
  });

  it("distingue origen y lugar genérico y tolera no conocer la provincia", () => {
    assert.equal(outsideProvinceCopy("origin", "Sevilla").title, "Origen fuera de provincia");
    assert.equal(outsideProvinceCopy("place", null).title, "Fuera de provincia");
    assert.doesNotMatch(outsideProvinceCopy("place", null).message, /null/);
  });
});

describe("títulos, marcadores de posición y destino de vuelta", () => {
  it("elige título y placeholder según el campo", () => {
    assert.equal(placeSearchTitle("origin"), "Origen");
    assert.equal(placeSearchTitle("destination"), "Destino");
    assert.equal(placeSearchTitle("place"), "Buscar lugar");
    assert.equal(placeSearchTitle("place", "Dirección del destino"), "Dirección del destino");
    assert.equal(placeSearchTitle("place", "   "), "Buscar lugar");
    assert.equal(placeSearchPlaceholder("destination"), "Tu destino");
  });

  it("devuelve origen y destino a DefineRoute y exige returnTo para el lugar genérico", () => {
    assert.deepEqual(resolveReturnTarget("origin", undefined), { route: "DefineRoute", param: "origin" });
    assert.deepEqual(resolveReturnTarget("destination", undefined), { route: "DefineRoute", param: "destination" });
    assert.equal(resolveReturnTarget("place", undefined), null);
    assert.deepEqual(resolveReturnTarget("place", { route: "FavoriteForm", param: "place" }), { route: "FavoriteForm", param: "place" });
    assert.deepEqual(resolveReturnTarget("origin", { route: "Foo", param: "bar" }), { route: "Foo", param: "bar" });
  });
});
