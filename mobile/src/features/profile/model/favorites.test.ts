import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FavoritePlace } from "@/api/types";
import {
  FAVORITES_MAX,
  canAddFavorite,
  defaultNameFor,
  hasFavoriteErrors,
  isEmptyUpdate,
  kindIcon,
  kindLabel,
  nameAfterKindChange,
  placeOfFavorite,
  toCreateBody,
  toUpdateBody,
  validateFavoriteDraft,
  type FavoriteDraft,
} from "./favorites";

const torre = { label: "Torre Sevilla, Sevilla", latitude: 37.4, longitude: -6.0 };

function favorite(overrides: Partial<FavoritePlace> = {}): FavoritePlace {
  return {
    id: "f1",
    kind: "work",
    name: "Trabajo",
    address: "Torre Sevilla, Sevilla",
    location: { lat: 37.4, lng: -6.0 },
    provinceId: "p1",
    createdAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("tipos", () => {
  it("iconos y etiquetas de las láminas", () => {
    assert.equal(kindIcon("work"), "briefcase");
    assert.equal(kindIcon("campus"), "school");
    assert.equal(kindIcon("home"), "home");
    assert.equal(kindLabel("work"), "Trabajo");
    assert.equal(kindLabel("campus"), "Campus");
    assert.equal(kindLabel("home"), "Casa");
    assert.equal(kindLabel("other"), "Otro");
  });
  it("nombre sugerido por tipo", () => {
    assert.equal(defaultNameFor("home"), "Casa");
    assert.equal(defaultNameFor("other"), "");
  });
  it("el nombre sigue al tipo solo si no es propio", () => {
    assert.equal(nameAfterKindChange("", "work", "home"), "Casa");
    assert.equal(nameAfterKindChange("Trabajo", "work", "campus"), "Campus");
    assert.equal(nameAfterKindChange("Casa de mis padres", "home", "work"), "Casa de mis padres");
    assert.equal(nameAfterKindChange("Trabajo", "work", "other"), "");
  });
});

describe("validación", () => {
  const valid: FavoriteDraft = { kind: "work", name: "Trabajo", place: torre };
  it("un borrador correcto no tiene errores", () => {
    assert.equal(hasFavoriteErrors(validateFavoriteDraft(valid)), false);
  });
  it("pide nombre y dirección en español", () => {
    const errors = validateFavoriteDraft({ kind: "work", name: "   ", place: null });
    assert.equal(errors.name, "Escribe un nombre para el destino.");
    assert.equal(errors.place, "Elige la dirección del destino.");
  });
  it("límites de 60 y 200 caracteres", () => {
    assert.equal(validateFavoriteDraft({ ...valid, name: "x".repeat(61) }).name, "El nombre admite hasta 60 caracteres.");
    assert.equal(validateFavoriteDraft({ ...valid, name: "x".repeat(60) }).name, undefined);
    assert.equal(validateFavoriteDraft({ ...valid, place: { ...torre, label: "y".repeat(201) } }).place, "La dirección es demasiado larga. Elige un lugar más concreto.");
  });
});

describe("cuerpos de las peticiones", () => {
  it("crear", () => {
    assert.deepEqual(toCreateBody({ kind: "work", name: "  Trabajo ", place: torre }), {
      kind: "work",
      name: "Trabajo",
      address: "Torre Sevilla, Sevilla",
      lat: 37.4,
      lng: -6.0,
    });
    assert.equal(toCreateBody({ kind: "work", name: "", place: torre }), null);
    assert.equal(toCreateBody({ kind: "work", name: "Trabajo", place: null }), null);
  });
  it("editar envía solo lo que cambió", () => {
    const original = favorite();
    assert.deepEqual(toUpdateBody(original, { kind: "work", name: "Trabajo", place: torre }), {});
    assert.deepEqual(toUpdateBody(original, { kind: "work", name: "Oficina", place: torre }), { name: "Oficina" });
    assert.deepEqual(toUpdateBody(original, { kind: "other", name: "Trabajo", place: torre }), { kind: "other" });
    assert.deepEqual(toUpdateBody(original, { kind: "work", name: "Trabajo", place: { label: "Plaza Nueva, Sevilla", latitude: 37.38, longitude: -5.99 } }), {
      address: "Plaza Nueva, Sevilla",
      lat: 37.38,
      lng: -5.99,
    });
    assert.equal(isEmptyUpdate({}), true);
    assert.equal(isEmptyUpdate({ name: "x" }), false);
  });
  it("el lugar guardado vuelve al formato del buscador", () => {
    assert.deepEqual(placeOfFavorite(favorite()), torre);
  });
});

describe("máximo de destinos", () => {
  it("20 como el servidor", () => {
    assert.equal(FAVORITES_MAX, 20);
    assert.equal(canAddFavorite(19), true);
    assert.equal(canAddFavorite(20), false);
  });
});
