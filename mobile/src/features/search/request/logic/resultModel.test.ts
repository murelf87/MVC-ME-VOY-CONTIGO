import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PaymentView } from "@/api/types";
import { buildResultModel } from "./resultModel";

const pay = (over: Partial<PaymentView>): PaymentView => ({
  id: "p1",
  requestId: "r1",
  bookingId: null,
  status: "processing",
  outcome: "awaiting_payment",
  amount: { cents: 600, currency: "EUR", status: "illustrative" },
  refunded: { cents: 0, currency: "EUR", status: "illustrative" },
  method: { kind: "apple_pay", maskedLabel: null },
  failureCode: null,
  createdAt: "2026-10-05T06:00:00.000Z",
  updatedAt: "2026-10-05T06:00:00.000Z",
  succeededAt: null,
  ...over,
});

describe("buildResultModel", () => {
  it("pago abierto = pendiente, nunca pagado", () => {
    assert.equal(buildResultModel([pay({})], 1).kind, "pending");
  });
  it("sin respuesta del servidor: pendiente aunque se haya autorizado", () => {
    assert.equal(buildResultModel([], 1, "timeout").kind, "pending");
  });
  it("confirmado solo con booking_confirmed", () => {
    const m = buildResultModel([pay({ status: "succeeded", outcome: "booking_confirmed", bookingId: "b1" })], 1);
    assert.equal(m.kind, "confirmed");
    assert.equal(m.bookingId, "b1");
    assert.equal(m.paid?.method, "Apple Pay");
  });
  it("pago tardío NO es plaza", () => {
    assert.equal(buildResultModel([pay({ status: "succeeded", outcome: "late_payment" })], 1).kind, "late");
  });
  it("tarjeta rechazada permite reintentar", () => {
    const m = buildResultModel([pay({ status: "failed", outcome: "failed", failureCode: "card_declined" })], 1);
    assert.equal(m.kind, "failed");
    assert.equal(m.canRetry, true);
  });
  it("semanal parcial", () => {
    const m = buildResultModel([pay({ status: "succeeded", outcome: "booking_confirmed" }), pay({ id: "p2", status: "failed", outcome: "failed" })], 2);
    assert.equal(m.kind, "partial");
  });
  it("cancelada en la hoja", () => {
    assert.equal(buildResultModel([], 1, "cancelled").kind, "cancelled");
  });
});
