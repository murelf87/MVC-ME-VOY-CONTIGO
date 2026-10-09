// Pruebas de los estados del mapa de inicio (search-browse).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MapCar, MapCarsResponse } from "@/api/types";
import { DEFAULT_MAP_FILTER, type MapFilter } from "./mapCars";
import { deriveMapView, type MapViewInput } from "./mapView";

function car(id: string): MapCar {
  return {
    tripId: id,
    category: "work",
    state: "scheduled",
    position: { lat: 37.38, lng: -5.98, precision: "approximate", source: "origin", recordedAt: null, stale: false, ageSeconds: null },
    seatsAvailable: 2,
    seatsOffered: 3,
    full: false,
    departureAt: "2026-10-05T06:05:00.000Z",
    originLabel: "Montequinto",
    destinationLabel: "Universidad de Sevilla",
  };
}

function response(cars: MapCar[], truncated = false): MapCarsResponse {
  return { provinceId: "p", generatedAt: "2026-10-05T05:17:00.000Z", cars, truncated };
}

function input(overrides: Partial<MapViewInput> = {}): MapViewInput {
  return {
    provinces: { isLoading: false, isError: false, isOffline: false, count: 1 },
    hasProvince: true,
    cars: { data: response([car("a")]), isLoading: false, isError: false, isOffline: false, failedToRefresh: false, error: null },
    filter: DEFAULT_MAP_FILTER,
    ...overrides,
  };
}

const noCars = { data: undefined, isLoading: false, isError: false, isOffline: false, failedToRefresh: false, error: null };

describe("deriveMapView · provincias", () => {
  it("sin provincia activa: cargando, error (con o sin red) o ninguna disponible", () => {
    const base = { hasProvince: false, cars: noCars };
    assert.deepEqual(deriveMapView(input({ ...base, provinces: { isLoading: true, isError: false, isOffline: false, count: 0 } })).overlay, { kind: "loading" });
    assert.deepEqual(deriveMapView(input({ ...base, provinces: { isLoading: false, isError: true, isOffline: false, count: 0 } })).overlay, {
      kind: "provincesError",
      offline: false,
    });
    assert.deepEqual(deriveMapView(input({ ...base, provinces: { isLoading: false, isError: false, isOffline: true, count: 0 } })).overlay, {
      kind: "provincesError",
      offline: true,
    });
    assert.deepEqual(deriveMapView(input({ ...base, provinces: { isLoading: false, isError: false, isOffline: false, count: 0 } })).overlay, {
      kind: "noProvinces",
    });
  });
});

describe("deriveMapView · coches", () => {
  it("con coches y todo bien no pinta nada encima", () => {
    assert.deepEqual(deriveMapView(input()), { overlay: { kind: "none" }, notice: { kind: "none" } });
  });

  it("primera carga: «cargando»; sin conexión o con error sin datos: su propia tarjeta", () => {
    assert.equal(deriveMapView(input({ cars: { ...noCars, isLoading: true } })).overlay.kind, "loading");
    assert.equal(deriveMapView(input({ cars: { ...noCars, isOffline: true, isError: false } })).overlay.kind, "carsOffline");
    const failed = deriveMapView(input({ cars: { ...noCars, isError: true, error: new Error("x") } }));
    assert.equal(failed.overlay.kind, "carsError");
  });

  it("sin datos y sin estado conocido sigue «cargando» (nunca un mapa vacío falso)", () => {
    assert.equal(deriveMapView(input({ cars: noCars })).overlay.kind, "loading");
  });

  it("sin coches: vacío, y «filtrado» solo si hay algún filtro puesto", () => {
    const empty = { ...noCars, data: response([]) };
    assert.deepEqual(deriveMapView(input({ cars: empty })).overlay, { kind: "empty", filtered: false });
    const filtered: MapFilter = { ...DEFAULT_MAP_FILTER, onlyWithSeats: true };
    assert.deepEqual(deriveMapView(input({ cars: empty, filter: filtered })).overlay, { kind: "empty", filtered: true });
    const byCategory: MapFilter = { ...DEFAULT_MAP_FILTER, category: "sport" };
    assert.deepEqual(deriveMapView(input({ cars: empty, filter: byCategory })).overlay, { kind: "empty", filtered: true });
  });

  it("con datos de antes y sin red: se ven los coches y un aviso «sin conexión»", () => {
    const view = deriveMapView(input({ cars: { ...noCars, data: response([car("a")]), isOffline: true } }));
    assert.deepEqual(view, { overlay: { kind: "none" }, notice: { kind: "offlineCached" } });
  });

  it("si falla la actualización con red, avisa de que no está al día", () => {
    const view = deriveMapView(input({ cars: { ...noCars, data: response([car("a")]), failedToRefresh: true } }));
    assert.equal(view.notice.kind, "staleRefresh");
  });

  it("una lista recortada lo dice (solo si no hay un aviso peor)", () => {
    assert.equal(deriveMapView(input({ cars: { ...noCars, data: response([car("a")], true) } })).notice.kind, "truncated");
    const both = deriveMapView(input({ cars: { ...noCars, data: response([car("a")], true), failedToRefresh: true } }));
    assert.equal(both.notice.kind, "staleRefresh");
  });

  it("vacío y sin conexión: la tarjeta de vacío y el aviso de caché a la vez", () => {
    const view = deriveMapView(input({ cars: { ...noCars, data: response([]), isOffline: true } }));
    assert.equal(view.overlay.kind, "empty");
    assert.equal(view.notice.kind, "offlineCached");
  });
});
