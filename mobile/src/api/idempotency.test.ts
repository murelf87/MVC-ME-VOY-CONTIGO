import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError, AuthExpiredError, OfflineError, TimeoutError, createAbortError } from "./errors";
import { createIdempotencyChain, isIndeterminateFailure, newIdempotencyKey } from "./idempotency";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newIdempotencyKey", () => {
  it("genera UUID v4 distintos", () => {
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()));
    assert.equal(keys.size, 50);
    for (const key of keys) assert.match(key, UUID_V4);
  });
});

describe("isIndeterminateFailure", () => {
  it("sin red, timeout y 5xx pudieron procesarse en el servidor", () => {
    assert.equal(isIndeterminateFailure(new OfflineError()), true);
    assert.equal(isIndeterminateFailure(new TimeoutError(15_000)), true);
    assert.equal(isIndeterminateFailure(new ApiError("x", "INTERNAL_ERROR", 500)), true);
    assert.equal(isIndeterminateFailure(new ApiError("x", "BAD_GATEWAY", 502)), true);
    assert.equal(isIndeterminateFailure(new ApiError("x", "REQUEST_TIMEOUT", 408)), true);
    assert.equal(isIndeterminateFailure(new Error("fallo raro")), true);
  });

  it("un rechazo claro 4xx, la sesión caducada o una cancelación no lo son", () => {
    assert.equal(isIndeterminateFailure(new ApiError("x", "VALIDATION_ERROR", 422)), false);
    assert.equal(isIndeterminateFailure(new ApiError("x", "NO_CAPACITY_ON_SEGMENT", 409)), false);
    assert.equal(isIndeterminateFailure(new ApiError("x", "RATE_LIMITED", 429)), false);
    assert.equal(isIndeterminateFailure(new AuthExpiredError()), false);
    assert.equal(isIndeterminateFailure(createAbortError()), false);
  });
});

describe("createIdempotencyChain", () => {
  function chainWithCounter() {
    let n = 0;
    return createIdempotencyChain(() => `key-${++n}`);
  }

  it("reutiliza la clave al reintentar las mismas variables tras un fallo indeterminado", () => {
    const chain = chainWithCounter();
    const first = chain.begin({ tripId: "t1", seats: 1 });
    chain.failed(new OfflineError());
    assert.equal(chain.begin({ seats: 1, tripId: "t1" }), first, "el orden de las claves no importa");
    chain.failed(new TimeoutError(15_000));
    assert.equal(chain.begin({ tripId: "t1", seats: 1 }), first);
  });

  it("renueva la clave tras un éxito (otra intención idéntica)", () => {
    const chain = chainWithCounter();
    const first = chain.begin({ a: 1 });
    chain.succeeded();
    assert.notEqual(chain.begin({ a: 1 }), first);
  });

  it("renueva la clave tras un rechazo claro del servidor", () => {
    const chain = chainWithCounter();
    const first = chain.begin({ a: 1 });
    chain.failed(new ApiError("x", "VALIDATION_ERROR", 422));
    assert.notEqual(chain.begin({ a: 1 }), first);
  });

  it("renueva la clave cuando cambian las variables", () => {
    const chain = chainWithCounter();
    const first = chain.begin({ a: 1 });
    chain.failed(new OfflineError());
    assert.notEqual(chain.begin({ a: 2 }), first);
  });

  it("reset olvida la clave pendiente", () => {
    const chain = chainWithCounter();
    const first = chain.begin({ a: 1 });
    chain.failed(new OfflineError());
    chain.reset();
    assert.notEqual(chain.begin({ a: 1 }), first);
  });

  it("admite variables undefined y anidadas", () => {
    const chain = chainWithCounter();
    const first = chain.begin(undefined);
    chain.failed(new OfflineError());
    assert.equal(chain.begin(undefined), first);
    const nested = chain.begin({ stops: [{ lat: 1, lng: 2 }], meta: { b: 1, a: 2 } });
    chain.failed(new OfflineError());
    assert.equal(chain.begin({ meta: { a: 2, b: 1 }, stops: [{ lng: 2, lat: 1 }] }), nested);
  });
});
