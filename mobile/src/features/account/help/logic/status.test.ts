import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { probeFromResult, summarizeService } from "./status";

describe("summarizeService", () => {
  it("sin Internet manda sobre todo lo demás", () => {
    assert.equal(summarizeService({ deviceOnline: false, server: "ok", database: "ok" }), "offline");
  });
  it("mientras se comprueba no afirma nada", () => {
    assert.equal(summarizeService({ deviceOnline: true, server: "checking", database: "unknown" }), "checking");
  });
  it("servidor caído antes que base de datos", () => {
    assert.equal(summarizeService({ deviceOnline: true, server: "down", database: "down" }), "server");
    assert.equal(summarizeService({ deviceOnline: true, server: "ok", database: "down" }), "database");
  });
  it("todo bien solo si responden las dos", () => {
    assert.equal(summarizeService({ deviceOnline: true, server: "ok", database: "ok" }), "ok");
    assert.equal(summarizeService({ deviceOnline: true, server: "ok", database: "unknown" }), "checking");
  });
});

describe("probeFromResult", () => {
  it("traduce cada resultado", () => {
    assert.deepEqual(probeFromResult("ok"), { server: "ok", database: "ok" });
    assert.deepEqual(probeFromResult("not_ready"), { server: "ok", database: "down" });
    assert.deepEqual(probeFromResult("unreachable"), { server: "down", database: "unknown" });
    assert.deepEqual(probeFromResult("offline"), { server: "unknown", database: "unknown" });
  });
});
