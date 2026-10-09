// Pruebas de la elección de provincia activa (search-browse).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Province } from "@/api/types";
import { pickActiveProvince } from "./province";

const sevilla: Province = { id: "prov-se", code: "SE", name: "Sevilla" };
const cadiz: Province = { id: "prov-ca", code: "CA", name: "Cádiz" };

describe("pickActiveProvince", () => {
  it("usa la elegida si sigue disponible", () => {
    assert.equal(pickActiveProvince([sevilla, cadiz], "prov-ca"), cadiz);
  });

  it("cae a la primera si no hay elección o la elegida ya no existe", () => {
    assert.equal(pickActiveProvince([sevilla, cadiz], null), sevilla);
    assert.equal(pickActiveProvince([sevilla, cadiz], "prov-xx"), sevilla);
  });

  it("devuelve null sin provincias", () => {
    assert.equal(pickActiveProvince([], "prov-se"), null);
  });
});
