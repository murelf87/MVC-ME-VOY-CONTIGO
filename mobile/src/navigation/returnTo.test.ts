import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { clearPendingReturn, peekPendingReturn, RETURN_TARGET_TTL_MS, setPendingReturn, takePendingReturn, type ReturnTarget } from "./returnTo";

const trip: ReturnTarget = { name: "TripDetail", params: { tripId: "t-1" } };
const request: ReturnTarget = { name: "RequestStatusPayment", params: { requestId: "r-1" } };

afterEach(() => clearPendingReturn());

describe("destino pendiente (returnTo)", () => {
  it("sin nada guardado devuelve null", () => {
    assert.equal(peekPendingReturn(), null);
    assert.equal(takePendingReturn(), null);
  });

  it("peek no consume; take consume", () => {
    setPendingReturn(trip, 1_000);
    assert.deepEqual(peekPendingReturn(1_500), trip);
    assert.deepEqual(peekPendingReturn(1_600), trip);
    assert.deepEqual(takePendingReturn(1_700), trip);
    assert.equal(peekPendingReturn(1_800), null);
  });

  it("un destino nuevo sustituye al anterior", () => {
    setPendingReturn(trip, 1_000);
    setPendingReturn(request, 2_000);
    assert.deepEqual(takePendingReturn(2_100), request);
  });

  it("caduca a los 30 minutos y se olvida", () => {
    setPendingReturn(trip, 10_000);
    assert.deepEqual(peekPendingReturn(10_000 + RETURN_TARGET_TTL_MS), trip);
    assert.equal(peekPendingReturn(10_000 + RETURN_TARGET_TTL_MS + 1), null);
    assert.equal(peekPendingReturn(10_001), null, "una vez caducado no vuelve");
  });

  it("clearPendingReturn lo borra", () => {
    setPendingReturn(trip);
    clearPendingReturn();
    assert.equal(peekPendingReturn(), null);
  });
});
