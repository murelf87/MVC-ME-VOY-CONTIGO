// Pruebas de «Estado y pago» (16): fases, cuenta atrás, bloqueos y resumen. El modelo no decide nada: traduce al servidor.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Money, PaymentSummary, RequestPaymentContext, RideRequestDetail, RideRequestStatus, TripQuote, WeeklyReservation } from "@/api/types";
import { buildStatusModel, defaultMethod, holdSecondsLeft, methodOptions, phaseOf, summaryOf } from "./statusModel";

const money = (cents: number | null, status: Money["status"]): Money => ({ cents, currency: "EUR", status });
const PENDING = money(null, "pending_definition");
const plain = (text: string): string => text.replace(/ /g, " ");

function ride(status: RideRequestStatus, hold: { remaining: number; active: boolean } | null = null): RideRequestDetail {
  return {
    id: "r1",
    status,
    trip: { driver: { id: "u1", displayName: "Ana García", firstName: "Ana" } },
    hold: hold === null ? null : { expiresAt: "2026-10-05T06:00:00.000Z", remainingSeconds: hold.remaining, active: hold.active },
    booking: status === "confirmed" ? { id: "b1" } : null,
  } as unknown as RideRequestDetail;
}

function context(over: Partial<RequestPaymentContext> = {}): RequestPaymentContext {
  const summary: PaymentSummary = {
    contribution: money(600, "illustrative"),
    platformFee: PENDING,
    processing: PENDING,
    taxes: PENDING,
    total: PENDING,
    tariffVersion: null,
    quoteSnapshotId: null,
  };
  return {
    requestId: "r1",
    requestStatus: "payment_pending",
    methods: [
      { kind: "apple_pay", available: true },
      { kind: "google_pay", available: false },
      { kind: "card", available: true },
    ],
    summary,
    canPay: true,
    cannotPayReason: null,
    payment: null,
    ...over,
  } as unknown as RequestPaymentContext;
}

const base = { secondsLeft: 892, platform: "ios" as const, method: null };

describe("fase de la pantalla", () => {
  it("aceptada con hold vigente → «Solicitud aceptada» con cuenta atrás; sin hold → «ha caducado»", () => {
    assert.equal(phaseOf("payment_pending", true, true, null), "accepted");
    assert.equal(phaseOf("payment_pending", false, true, null), "hold_expired");
    assert.equal(phaseOf("expired", false, false, null), "expired");
    assert.equal(phaseOf("expired", false, true, null), "hold_expired");
    assert.equal(phaseOf("confirmed", false, true, null), "confirmed");
    assert.equal(phaseOf("payment_pending", true, true, "partially_confirmed"), "partial");
  });

  it("aceptada ≠ confirmada: la lámina 16 pinta «Aceptada» como paso actual y «Pago»/«Confirmada» sin hacer", () => {
    const model = buildStatusModel({ ride: ride("payment_pending", { remaining: 892, active: true }), weekly: null, context: context() }, base);
    assert.equal(model.phase, "accepted");
    assert.deepEqual(model.stepStates, ["reached", "complete", "upcoming", "upcoming"]);
    assert.equal(model.hold?.text, "14:52");
    assert.equal(model.banner.title, "¡Solicitud aceptada!");
    assert.equal(model.banner.message, "Ana ha aceptado tu solicitud.");
    assert.equal(model.confirmed, null);
  });

  it("pendiente de respuesta: ningún cobro y se puede retirar", () => {
    const model = buildStatusModel({ ride: ride("pending"), weekly: null, context: null }, { ...base, secondsLeft: null });
    assert.equal(model.phase, "waiting");
    assert.equal(model.canWithdraw, true);
    assert.equal(model.showPayment, false);
    assert.equal(model.canPay, false);
    assert.match(model.banner.message, /No se realiza ningún cobro todavía/);
  });

  it("confirmada solo con reserva; rechazada y caducada no enseñan pago", () => {
    assert.equal(buildStatusModel({ ride: ride("confirmed"), weekly: null, context: null }, base).confirmed?.bookingId, "b1");
    for (const status of ["rejected", "cancelled", "expired", "payment_late"] as const) {
      const model = buildStatusModel({ ride: ride(status), weekly: null, context: context() }, { ...base, secondsLeft: null });
      assert.equal(model.showPayment, false, status);
      assert.equal(model.canPay, false, status);
    }
  });

  it("pago tardío: no hay reserva y se dice sin prometer nada más", () => {
    const model = buildStatusModel({ ride: ride("payment_late"), weekly: null, context: null }, { ...base, secondsLeft: null });
    assert.equal(model.phase, "payment_late");
    assert.equal(model.confirmed, null);
    assert.match(model.banner.message, /no se ha creado ninguna reserva/);
  });
});

describe("cuenta atrás", () => {
  it("descuenta lo transcurrido desde que llegó la respuesta y nunca baja de 0", () => {
    assert.equal(holdSecondsLeft(892, 1_000, 1_000), 892);
    assert.equal(holdSecondsLeft(892, 1_000, 11_000), 882);
    assert.equal(holdSecondsLeft(5, 0, 60_000), 0);
    assert.equal(holdSecondsLeft(null, 0, 5), null);
  });

  it("al llegar a 0 deja de poder pagar aunque el servidor aún no lo haya marcado", () => {
    const model = buildStatusModel({ ride: ride("payment_pending", { remaining: 10, active: true }), weekly: null, context: context() }, { ...base, secondsLeft: 0 });
    assert.equal(model.phase, "hold_expired");
    assert.equal(model.canPay, false);
  });
});

describe("bloqueos y métodos", () => {
  it("proveedor desactivado: el botón queda bloqueado y se explica por qué (nunca se oculta)", () => {
    const blocked = context({
      canPay: false,
      cannotPayReason: { code: "PAYMENTS_PROVIDER_DISABLED", message: "Pagos aún no disponibles" },
      methods: [
        { kind: "apple_pay", available: false },
        { kind: "google_pay", available: false },
        { kind: "card", available: false },
      ],
    });
    const model = buildStatusModel({ ride: ride("payment_pending", { remaining: 892, active: true }), weekly: null, context: blocked }, base);
    assert.equal(model.canPay, false);
    assert.equal(model.payBlock?.title, "Pagos aún no disponibles");
    assert.equal(model.methods.every((m) => !m.available), true);
  });

  it("importe sin definir: bloquea con su mensaje; pago en curso: se sigue, no se crea otro", () => {
    const amount = buildStatusModel(
      { ride: ride("payment_pending", { remaining: 100, active: true }), weekly: null, context: context({ canPay: false, cannotPayReason: { code: "PAYMENT_AMOUNT_NOT_DEFINED", message: "x" } }) },
      base,
    );
    assert.match(amount.payBlock?.message ?? "", /importe de esta reserva todavía no está definido/);
    const open = buildStatusModel(
      {
        ride: ride("payment_pending", { remaining: 100, active: true }),
        weekly: null,
        context: context({ canPay: false, cannotPayReason: { code: "PAYMENT_ALREADY_OPEN", message: "x" }, payment: { id: "p9", status: "processing" } as RequestPaymentContext["payment"] }),
      },
      base,
    );
    assert.equal(open.openPaymentId, "p9");
    assert.equal(open.canPay, false);
  });

  it("Apple Pay solo en iOS, Google Pay solo en Android, tarjeta en ambos; por defecto el primero disponible", () => {
    assert.deepEqual(methodOptions(context(), "ios").map((m) => m.kind), ["apple_pay", "card"]);
    assert.deepEqual(methodOptions(context(), "android").map((m) => m.kind), ["google_pay", "card"]);
    assert.equal(defaultMethod(methodOptions(context(), "android")), "card", "Google Pay no disponible → tarjeta");
    assert.equal(methodOptions(null, "ios").every((m) => !m.available), true);
  });
});

describe("resumen del pago", () => {
  it("un trayecto con aportación de ejemplo y gestión por definir (lámina 16a)", () => {
    const view = summaryOf(context().summary, null);
    assert.equal(view.heading, "Ejemplo de pago · Importe por definir");
    assert.equal(plain(view.rows[0]?.label ?? ""), "Tu aportación (ejemplo)");
    assert.equal(plain(view.rows[0]?.value ?? ""), "6,00 €");
    assert.equal(view.fee.label, "Gestión MVC · Por definir");
    assert.equal(view.fee.value, "—");
    assert.equal(view.total.value, "Por definir");
  });

  it("reserva semanal: importe semanal del servidor (lámina 16b)", () => {
    const weeklyQuote = {
      weekly: { weekdays: ["mon"], legsPerDay: 2, tripsPerWeek: 10, contributionPerWeek: money(1800, "illustrative"), totalPerWeek: PENDING },
    } as unknown as TripQuote;
    const weekly = { status: "payment_pending", quote: weeklyQuote } as unknown as WeeklyReservation;
    const view = summaryOf(context().summary, weekly);
    assert.equal(view.heading, "Resumen del pago");
    assert.equal(plain(view.rows[0]?.label ?? ""), "Aportación semanal (ejemplo)");
    assert.equal(plain(view.rows[0]?.value ?? ""), "18,00 €");
    assert.equal(view.fee.label, "Gestión MVC");
    assert.equal(view.fee.value, "Por definir");
  });
});
