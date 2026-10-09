import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fromItemFilter,
  fromRoleFilter,
  itemFilterOptions,
  itemFilterValue,
  roleFilterOptions,
  roleFilterValue,
  sortOptions,
} from "./queueOptions";

describe("queueOptions", () => {
  it("el selector de elemento ofrece «Todos» y los cuatro elementos revisables, en el orden del panel", () => {
    assert.deepEqual(
      itemFilterOptions().map((o) => o.value),
      ["all", "identity", "driver_license", "profile_photo", "private_check"],
    );
    assert.equal(itemFilterOptions()[0]?.label, "Todos");
    assert.equal(itemFilterOptions()[2]?.label, "Permiso de conducir");
  });

  it("el selector de rol distingue conductores y pasajeros", () => {
    assert.deepEqual(
      roleFilterOptions().map((o) => o.value),
      ["all", "driver", "passenger"],
    );
  });

  it("el orden empieza por «Más recientes» y explica las dos opciones", () => {
    const options = sortOptions();
    assert.deepEqual(
      options.map((o) => o.value),
      ["recent", "oldest"],
    );
    assert.equal(options[0]?.label, "Más recientes");
    assert.ok(options.every((o) => (o.description ?? "") !== ""));
  });

  it("«todos» equivale a no filtrar, en los dos sentidos", () => {
    assert.equal(fromItemFilter("all"), null);
    assert.equal(fromItemFilter("identity"), "identity");
    assert.equal(itemFilterValue(null), "all");
    assert.equal(itemFilterValue("profile_photo"), "profile_photo");
    assert.equal(fromRoleFilter("all"), null);
    assert.equal(fromRoleFilter("driver"), "driver");
    assert.equal(roleFilterValue(null), "all");
    assert.equal(roleFilterValue("passenger"), "passenger");
  });
});
