// Pruebas de las tarjetas y de la máquina de estados de devoluciones (admin-review).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminBookingRow, AdminRefundItem, Money } from "@/api/types";
import { bookingCardView, cancellationLine, refundActions, refundBanner, refundCardView, refundStage, refundStateLine, refundSteps } from "./refunds";

const defined = (cents: number): Money => ({ cents, currency: "EUR", status: "defined" });
const pending: Money = { cents: null, currency: "EUR", status: "pending_definition" };

function makeRefund(overrides: Partial<AdminRefundItem> = {}): AdminRefundItem {
  return {
    id: "r1",
    status: "pending_review",
    origin: "passenger_cancellation",
    bookingId: "b1",
    requestId: "q1",
    paymentId: "p1",
    paid: defined(500),
    proposedRefund: defined(500),
    approvedRefund: pending,
    platformFee: pending,
    finalPassengerCost: defined(0),
    executionStatus: "not_started",
    policy: { status: "pending_review", version: null, effectiveFrom: null, summary: null },
    createdAt: "2026-10-05T06:26:00.000Z",
    decidedAt: null,
    refundedAt: null,
    passenger: { id: "u1", displayName: "Miguel Torres", firstName: "Miguel", photoUrl: null, ratingAverage: null, ratingCount: 0 },
    driver: null,
    trip: { tripId: "t1", departureAt: "2026-10-05T06:12:00.000Z", originLabel: "Sevilla - Los Bermejales", destinationLabel: "Sevilla - Cartuja (Universidad)" },
    cancelledBy: "passenger",
    cancelledAt: "2026-10-05T06:26:00.000Z",
    cancelReason: null,
    cancelNote: null,
    decision: null,
    ...overrides,
  };
}

describe("refundCardView", () => {
  it("reproduce la tarjeta de la lámina 39a", () => {
    const view = refundCardView(makeRefund());
    assert.equal(view.name, "Miguel Torres");
    assert.equal(view.whenText, "5 oct 2026 · 08:12");
    assert.equal(view.statusLabel, "Cancelada");
    assert.equal(view.statusTone, "red");
    assert.equal(view.origin, "Sevilla - Los Bermejales");
    assert.equal(view.destination, "Sevilla - Cartuja (Universidad)");
    assert.deepEqual(
      view.rows.map((row) => [row.label, row.text, row.pending]),
      [
        ["Importe pagado (pasajero)", "5,00\u00A0€", false],
        ["Devolución propuesta", "5,00\u00A0€", false],
        ["Comisión plataforma (propuesta)", "Por definir", true],
        ["Coste final pasajero", "0,00\u00A0€", false],
      ],
    );
    assert.equal(view.cancellation, "Cancelada por el pasajero · 08:26");
    assert.equal(view.refundLine, null);
    assert.equal(view.refundId, "r1");
  });

  it("sin propuesta todo es «Por definir» y nunca se inventa un importe", () => {
    const view = refundCardView(makeRefund({ proposedRefund: pending, platformFee: pending, finalPassengerCost: pending }));
    assert.deepEqual(
      view.rows.map((row) => row.text),
      ["5,00\u00A0€", "Por definir", "Por definir", "Por definir"],
    );
  });

  it("una devolución decidida añade el importe aprobado y la línea de estado", () => {
    const view = refundCardView(
      makeRefund({ status: "approved", executionStatus: "awaiting_provider", approvedRefund: defined(450), decidedAt: "2026-10-06T08:00:00.000Z" }),
    );
    assert.deepEqual(
      view.rows.map((row) => row.key),
      ["paid", "proposed", "approved", "fee", "final"],
    );
    assert.deepEqual(view.refundLine, { text: "Bloqueada · el proveedor de pago no está disponible", tone: "warning" });
  });

  it("la cancelación del conductor no usa el género", () => {
    const view = refundCardView(makeRefund({ origin: "driver_cancellation", cancelledBy: "driver", cancelledAt: "2026-10-06T15:55:00.000Z" }));
    assert.equal(view.cancellation, "Cancelada por el conductor · 17:55");
  });

  it("una fecha de viaje desconocida no rompe la tarjeta", () => {
    const view = refundCardView(makeRefund({ trip: { tripId: "t", departureAt: null, originLabel: null, destinationLabel: null } }));
    assert.equal(view.whenText, "Viaje sin fecha");
    assert.equal(view.origin, "Lugar sin nombre");
  });
});

describe("bookingCardView", () => {
  const row: AdminBookingRow = {
    bookingId: "b1",
    tripId: "t1",
    status: "driver_cancelled",
    statusLabel: "Cancelada",
    passenger: { id: "u1", displayName: "Ana López", firstName: "Ana", photoUrl: null },
    driver: { id: "u2", displayName: "Carlos Ruiz", firstName: "Carlos", photoUrl: null },
    tripDepartureAt: "2026-10-06T15:40:00.000Z",
    route: { originLabel: "Sevilla - Nervión (Trabajo)", destinationLabel: "Sevilla - Montequinto" },
    cancelledBy: "driver",
    cancelledAt: "2026-10-06T15:55:00.000Z",
    money: { amountPaid: defined(450), proposedRefund: pending, platformCommission: pending, finalPassengerCost: pending },
    refund: { status: "pending_definition", actionOwner: "money" },
  };

  it("no ofrece acciones de devolución (pertenecen al módulo de finanzas)", () => {
    const view = bookingCardView(row);
    assert.equal(view.refundId, null);
    assert.equal(view.cancellation, "Cancelada por el conductor · 17:55");
    assert.equal(view.rows[0]?.text, "4,50\u00A0€");
    assert.equal(view.rows[1]?.text, "Por definir");
    assert.deepEqual(view.refundLine, { text: "Devolución por definir", tone: "muted" });
  });

  it("una reserva sin cancelar no lleva línea de cancelación ni de devolución", () => {
    const view = bookingCardView({ ...row, status: "completed", statusLabel: "Completada", cancelledBy: null, cancelledAt: null, refund: { status: "not_applicable", actionOwner: "money" } });
    assert.equal(view.cancellation, null);
    assert.equal(view.refundLine, null);
    assert.equal(view.statusTone, "green");
  });
});

describe("cancellationLine", () => {
  it("cubre los motivos sin cancelador", () => {
    assert.equal(cancellationLine("no_show", null, null), "El pasajero no se presentó");
    assert.equal(cancellationLine("late_payment", null, "2026-10-05T06:26:00.000Z"), "Pago confirmado cuando la plaza ya no estaba retenida · 08:26");
    assert.equal(cancellationLine("force_majeure", null, null), null);
  });
});

describe("máquina de estados", () => {
  it("«aprobada» con el proveedor sin conectar es «Bloqueada», no «devuelta»", () => {
    assert.equal(refundStage("approved", "awaiting_provider"), "approved_blocked");
    assert.equal(refundStage("approved", "not_started"), "approved");
    assert.equal(refundStage("refunded", "succeeded"), "refunded");
    assert.deepEqual(refundStateLine("approved", "awaiting_provider")?.tone, "warning");
  });

  it("solo se puede decidir lo pendiente y reintentar lo bloqueado o fallido", () => {
    assert.deepEqual(refundActions({ status: "pending_review", executionStatus: "not_started" }, true), {
      approve: true,
      reject: true,
      execute: false,
      executeLabel: "Enviar al proveedor de pago",
    });
    assert.equal(refundActions({ status: "approved", executionStatus: "awaiting_provider" }, true).execute, true);
    const failed = refundActions({ status: "failed", executionStatus: "failed" }, true);
    assert.equal(failed.execute, true);
    assert.equal(failed.executeLabel, "Volver a pedirlo al proveedor");
    for (const status of ["executing", "refunded", "rejected", "not_applicable"] as const) {
      const none = refundActions({ status, executionStatus: "submitted" }, true);
      assert.equal(none.approve || none.reject || none.execute, false, status);
    }
  });

  it("sin permiso de escritura no hay ninguna acción", () => {
    const none = refundActions({ status: "pending_review", executionStatus: "not_started" }, false);
    assert.equal(none.approve || none.reject || none.execute, false);
  });

  it("los pasos reflejan el bloqueo y la confirmación", () => {
    const base = { createdAt: "2026-10-05T06:26:00.000Z", decidedAt: "2026-10-06T08:00:00.000Z", refundedAt: null, decision: null };
    const blocked = refundSteps({ ...base, status: "approved", executionStatus: "awaiting_provider" });
    assert.deepEqual(
      blocked.map((step) => step.state),
      ["done", "done", "blocked", "pending"],
    );
    const done = refundSteps({ ...base, status: "refunded", executionStatus: "succeeded", refundedAt: "2026-10-07T09:00:00.000Z" });
    assert.deepEqual(
      done.map((step) => step.state),
      ["done", "done", "done", "done"],
    );
    const rejected = refundSteps({ ...base, status: "rejected", executionStatus: "not_started" });
    assert.equal(rejected[1]?.state, "rejected");
  });

  it("avisos por estado", () => {
    assert.equal(refundBanner({ status: "pending_review", executionStatus: "not_started", refundedAt: null }), null);
    assert.equal(refundBanner({ status: "approved", executionStatus: "awaiting_provider", refundedAt: null })?.kind, "notice");
    assert.equal(refundBanner({ status: "approved", executionStatus: "awaiting_provider", refundedAt: null })?.title, "Bloqueado");
    assert.equal(refundBanner({ status: "refunded", executionStatus: "succeeded", refundedAt: "2026-10-07T09:00:00.000Z" })?.kind, "success");
    assert.equal(refundBanner({ status: "failed", executionStatus: "failed", refundedAt: null })?.kind, "error");
  });
});
