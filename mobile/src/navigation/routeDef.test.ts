import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ComponentType } from "react";
import { getRouteAccess, getRouteNames, getRouteSlice, hasRoute, registerRouteIndex } from "./routeIndex";
import { assembleRoutes, defineRoute, toRouteCatalog, type RouteDef } from "./routeDef";

// Los componentes no se ejecutan en estas pruebas: basta una referencia.
const Screen = (() => null) as unknown as ComponentType<never>;

function route(name: string, extra: Partial<RouteDef> = {}): RouteDef {
  return { name: name as RouteDef["name"], component: Screen, ...extra };
}

describe("assembleRoutes", () => {
  it("añade el slice y el acceso por defecto (auth)", () => {
    const routes = assembleRoutes([{ slice: "search", routes: [route("MapHome", { access: "public" }), route("ReviewRequest")] }]);
    assert.deepEqual(
      routes.map((r) => [r.name, r.slice, r.access]),
      [
        ["MapHome", "search", "public"],
        ["ReviewRequest", "search", "auth"],
      ],
    );
  });

  it("conserva el orden de los grupos y de las rutas", () => {
    const routes = assembleRoutes([
      { slice: "a", routes: [route("Welcome"), route("SignIn")] },
      { slice: "b", routes: [route("MapHome")] },
    ]);
    assert.deepEqual(
      routes.map((r) => r.name),
      ["Welcome", "SignIn", "MapHome"],
    );
  });

  it("falla con un mensaje claro si dos slices declaran el mismo nombre", () => {
    assert.throws(
      () =>
        assembleRoutes([
          { slice: "auth", routes: [route("Welcome")] },
          { slice: "search", routes: [route("Welcome")] },
        ]),
      /«Welcome».*«auth».*«search»/,
    );
  });

  it("falla si un mismo slice repite un nombre", () => {
    assert.throws(() => assembleRoutes([{ slice: "auth", routes: [route("Welcome"), route("Welcome")] }]), /«Welcome»/);
  });

  it("no muta las definiciones originales", () => {
    const original = route("Welcome");
    assembleRoutes([{ slice: "auth", routes: [original] }]);
    assert.equal("slice" in original, false);
    assert.equal(original.access, undefined);
  });
});

describe("defineRoute", () => {
  it("devuelve la definición tal cual (la comprobación es solo de tipos)", () => {
    const result = defineRoute({ name: "Welcome", component: () => null, access: "public", screen: "01" });
    assert.equal(result.name, "Welcome");
    assert.equal(result.access, "public");
    assert.equal(result.screen, "01");
  });
});

describe("toRouteCatalog", () => {
  it("incluye solo los campos definidos", () => {
    const catalog = toRouteCatalog(
      assembleRoutes([
        {
          slice: "search",
          routes: [route("MapHome", { access: "public", screen: "09", title: "Mapa", previewParams: null }), route("TripResults", { previewParams: { criteria: { x: 1 } } }), route("DefineRoute")],
        },
      ]),
    );
    assert.deepEqual(catalog[0], { name: "MapHome", slice: "search", access: "public", screen: "09", title: "Mapa", params: null });
    assert.deepEqual(catalog[1], { name: "TripResults", slice: "search", access: "auth", params: { criteria: { x: 1 } } });
    assert.deepEqual(catalog[2], { name: "DefineRoute", slice: "search", access: "auth" });
  });
});

describe("índice de rutas", () => {
  it("responde por nombre y se reemplaza entero al registrar", () => {
    registerRouteIndex(assembleRoutes([{ slice: "auth", routes: [route("Welcome", { access: "public" }), route("ProfilePhoto")] }]));
    assert.deepEqual(getRouteNames(), ["Welcome", "ProfilePhoto"]);
    assert.equal(hasRoute("Welcome"), true);
    assert.equal(hasRoute("Otra"), false);
    assert.equal(getRouteAccess("Welcome"), "public");
    assert.equal(getRouteAccess("ProfilePhoto"), "auth");
    assert.equal(getRouteAccess("Otra"), undefined);
    assert.equal(getRouteSlice("ProfilePhoto"), "auth");

    registerRouteIndex(assembleRoutes([{ slice: "search", routes: [route("MapHome", { access: "public" })] }]));
    assert.deepEqual(getRouteNames(), ["MapHome"]);
    assert.equal(hasRoute("Welcome"), false);
  });
});
