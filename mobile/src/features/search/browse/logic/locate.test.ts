// Pruebas de los estados de «Usar mi ubicación» (search-browse).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GeocodeResult } from "@/api/types";
import { locateProblem, pickMunicipalityResult, statusForFailure, statusForPermission } from "./locate";

function result(formattedAddress: string, types: string[]): GeocodeResult {
  return { provider: "test", placeId: formattedAddress, formattedAddress, location: { latitude: 37.3, longitude: -5.9 }, types };
}

describe("estado de la ubicación", () => {
  it("traduce los permisos del sistema", () => {
    assert.equal(statusForPermission("granted"), "idle");
    assert.equal(statusForPermission("denied"), "denied");
    assert.equal(statusForPermission("blocked"), "blocked");
    assert.equal(statusForPermission("unavailable"), "failed");
  });

  it("traduce los fallos de lectura del GPS", () => {
    assert.equal(statusForFailure("permission_denied"), "denied");
    assert.equal(statusForFailure("permission_blocked"), "blocked");
    assert.equal(statusForFailure("services_disabled"), "servicesOff");
    assert.equal(statusForFailure("timeout"), "failed");
    assert.equal(statusForFailure("unavailable"), "failed");
  });
});

describe("locateProblem", () => {
  it("no hay problema en reposo ni localizando", () => {
    assert.equal(locateProblem("idle"), null);
    assert.equal(locateProblem("locating"), null);
  });

  it("siempre ofrece una salida: permitir, ajustes o reintentar", () => {
    const denied = locateProblem("denied");
    assert.equal(denied?.canAllow, true);
    const blocked = locateProblem("blocked");
    assert.equal(blocked?.needsSettings, true);
    assert.equal(blocked?.canAllow, false);
    assert.equal(locateProblem("servicesOff")?.canRetry, true);
    assert.equal(locateProblem("failed")?.canRetry, true);
    for (const status of ["denied", "blocked", "servicesOff", "failed"] as const) {
      const problem = locateProblem(status);
      assert.ok(problem && problem.title.length > 0 && problem.message.length > 0);
    }
  });
});

describe("pickMunicipalityResult", () => {
  it("prefiere el municipio a la calle", () => {
    const street = result("Calle Real, 12, Montequinto", ["street_address"]);
    const town = result("Montequinto, Dos Hermanas", ["locality", "political"]);
    assert.equal(pickMunicipalityResult([street, town]), town);
    assert.equal(pickMunicipalityResult([street]), street);
    assert.equal(pickMunicipalityResult([]), null);
  });
});
