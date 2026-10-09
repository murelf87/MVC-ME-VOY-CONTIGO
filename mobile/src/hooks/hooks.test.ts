import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError, OfflineError } from "@/api/errors";
import { flattenPages } from "./pagination";
import type { QueryState } from "./queryCache";
import { deriveQueryFlags } from "./queryFlags";

function state<T>(patch: Partial<QueryState<T>>): QueryState<T> {
  return { status: "idle", data: undefined, error: null, updatedAt: null, errorUpdatedAt: null, isFetching: false, isInvalidated: false, ...patch };
}

describe("deriveQueryFlags", () => {
  it("idle: nunca pedida", () => {
    const flags = deriveQueryFlags(state({}));
    assert.equal(flags.isIdle, true);
    assert.equal(flags.isLoading, false);
  });

  it("primera carga = isLoading (esqueleto)", () => {
    const flags = deriveQueryFlags(state({ status: "loading", isFetching: true }));
    assert.equal(flags.isLoading, true);
    assert.equal(flags.isRefreshing, false);
    assert.equal(flags.isIdle, false);
  });

  it("revalidando con datos = isRefreshing, no isLoading", () => {
    const flags = deriveQueryFlags(state({ status: "success", data: [1], isFetching: true }));
    assert.equal(flags.isRefreshing, true);
    assert.equal(flags.isLoading, false);
    assert.equal(flags.isFetching, true);
  });

  it("error sin datos = isError", () => {
    const flags = deriveQueryFlags(state({ status: "error", error: new ApiError("x", "INTERNAL_ERROR", 500) }));
    assert.equal(flags.isError, true);
    assert.equal(flags.isOffline, false);
    assert.equal(flags.failedToRefresh, false);
  });

  it("sin red y sin datos = isOffline (no isError)", () => {
    const flags = deriveQueryFlags(state({ status: "offline", error: new OfflineError() }));
    assert.equal(flags.isOffline, true);
    assert.equal(flags.isError, false);
  });

  it("datos + error de revalidación = failedToRefresh, y offline si fue por falta de red", () => {
    const flags = deriveQueryFlags(state({ status: "success", data: "x", error: new OfflineError() }));
    assert.equal(flags.failedToRefresh, true);
    assert.equal(flags.isOffline, true);
    assert.equal(flags.isError, false);
    const other = deriveQueryFlags(state({ status: "success", data: "x", error: new ApiError("x", "INTERNAL_ERROR", 500) }));
    assert.equal(other.failedToRefresh, true);
    assert.equal(other.isOffline, false);
  });

  it("una lista vacía ([]) cuenta como datos", () => {
    const flags = deriveQueryFlags(state({ status: "success", data: [] as number[], isFetching: true }));
    assert.equal(flags.isRefreshing, true);
    assert.equal(flags.isLoading, false);
  });
});

describe("flattenPages", () => {
  it("concatena en orden", () => {
    const pages = [
      { items: [{ id: "a" }, { id: "b" }], nextCursor: "c1" },
      { items: [{ id: "c" }], nextCursor: null },
    ];
    assert.deepEqual(flattenPages(pages).map((item) => item.id), ["a", "b", "c"]);
  });

  it("descarta repetidos por id entre páginas (la lista cambió mientras se paginaba)", () => {
    const pages = [
      { items: [{ id: 1 }, { id: 2 }], nextCursor: "c1" },
      { items: [{ id: 2 }, { id: 3 }], nextCursor: null },
    ];
    assert.deepEqual(flattenPages(pages).map((item) => item.id), [1, 2, 3]);
  });

  it("sin id no se descarta nada", () => {
    const pages = [
      { items: ["x", "y"], nextCursor: "c" },
      { items: ["y"], nextCursor: null },
    ];
    assert.deepEqual(flattenPages(pages), ["x", "y", "y"]);
  });

  it("acepta una función de identidad propia", () => {
    const pages = [
      { items: [{ key: "k1" }, { key: "k2" }], nextCursor: "c" },
      { items: [{ key: "k1" }], nextCursor: null },
    ];
    assert.equal(flattenPages(pages, (item) => item.key).length, 2);
  });

  it("sin páginas = lista vacía", () => {
    assert.deepEqual(flattenPages([]), []);
  });
});
