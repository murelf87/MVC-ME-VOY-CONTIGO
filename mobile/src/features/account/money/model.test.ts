// Pruebas de la lógica pura del paquete «pagos y cobros».
// Ejecutar:  cd mobile && node --import tsx --test "src/features/account/money/**/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Money, PublicUser } from "@/api/types/common";
import type { DriverEarningItem, MoneyTripRef, PassengerPaymentItem, PaymentMethod, Receipt, RefundView } from "@/api/types/money";
import {
  amountView,
  anyIllustrative,
  commissionParagraphs,
  commissionValue,
  driverMovement,
  earningStateChip,
  isCurrentMonth,
  isMonthKey,
  methodStatusChip,
  methodSubtitle,
  monthKeyOf,
  monthLongLabel,
  monthName,
  nextPayoutView,
  overviewMovements,
  passengerMovement,
  paymentStateChip,
  payoutRowSubtitle,
  pendingTitle,
  percentFromBps,
  receiptShareText,
  recentMonthKeys,
  refundChip,
  refundIsOpen,
  refundTracking,
  scheduleText,
  shiftMonth,
  sortMethods,
  toCollectTitle,
  tripDateText,
  tripRouteText,
  withPerson,
} from "./model";

const NOW = Date.parse("2026-10-05T07:17:00+02:00");
const pending: Money = { cents: null, currency: "EUR", status: "pending_definition" };
const defined = (cents: number): Money => ({ cents, currency: "EUR", status: "defined" });
const illustrative = (cents: number): Money => ({ cents, currency: "EUR", status: "illustrative" });

function person(first: string, displayName = first): PublicUser {
  return { id: `user-${first}`, displayName, firstName: first, photoUrl: null, ratingAverage: null, ratingCount: 0 };
}

function trip(departureAt: string | null, origin: string | null = "Sevilla", destination: string | null = "Camas"): MoneyTripRef {
  return { tripId: "trip-1", departureAt, originLabel: origin, destinationLabel: destination };
}

describe("meses", () => {
  it("el mes natural se calcula en hora de Madrid", () => {
    assert.equal(monthKeyOf("2026-10-31T23:30:00Z"), "2026-11"); // 00:30 del 1 de noviembre en Madrid
    assert.equal(monthKeyOf(NOW), "2026-10");
    assert.equal(monthKeyOf("no es una fecha"), "");
  });

  it("valida las claves YYYY-MM", () => {
    assert.equal(isMonthKey("2026-10"), true);
    assert.equal(isMonthKey("2026-13"), false);
    assert.equal(isMonthKey("2026-1"), false);
    assert.equal(isMonthKey("octubre"), false);
  });

  it("desplaza meses cruzando años", () => {
    assert.equal(shiftMonth("2026-01", -1), "2025-12");
    assert.equal(shiftMonth("2026-12", 1), "2027-01");
    assert.equal(shiftMonth("2026-10", -22), "2024-12");
    assert.equal(shiftMonth("mal", 3), "mal");
  });

  it("lista los últimos meses del más reciente al más antiguo", () => {
    const months = recentMonthKeys(NOW, 4);
    assert.deepEqual(months, ["2026-10", "2026-09", "2026-08", "2026-07"]);
    assert.equal(recentMonthKeys(NOW).length, 12);
    assert.deepEqual(recentMonthKeys("basura", 3), []);
  });

  it("nombra el mes con o sin año según el año actual", () => {
    assert.equal(monthName("2026-09", NOW), "septiembre");
    assert.equal(monthName("2025-05", NOW), "mayo de 2025");
    assert.equal(monthLongLabel("2026-09"), "Septiembre de 2026");
    assert.equal(monthName("xx", NOW), "");
  });

  it("los títulos de las tarjetas cambian al mirar otro mes", () => {
    assert.equal(isCurrentMonth("2026-10", NOW), true);
    assert.equal(pendingTitle("2026-10", NOW), "Pendiente este mes");
    assert.equal(pendingTitle("2026-09", NOW), "Pendiente en septiembre");
    assert.equal(toCollectTitle("2026-10", NOW), "A cobrar este mes");
    assert.equal(toCollectTitle("2025-12", NOW), "A cobrar en diciembre de 2025");
  });
});

describe("importes", () => {
  it("un importe sin definir se pinta «Por definir» y --,-- € en los huecos grandes", () => {
    const view = amountView(pending);
    assert.equal(view.text, "Por definir");
    assert.equal(view.hero, "--,-- €");
    assert.equal(view.pending, true);
    assert.equal(view.spoken, "importe por definir");
  });

  it("un importe definido usa céntimos enteros con formato es-ES", () => {
    assert.equal(amountView(defined(1200)).text, "12,00 €");
    assert.equal(amountView(defined(123456)).text, "1.234,56 €");
    assert.equal(amountView(defined(0)).hero, "0,00 €");
  });

  it("un importe ilustrativo se anuncia como tal", () => {
    const view = amountView(illustrative(2400));
    assert.equal(view.illustrative, true);
    assert.equal(view.text, "24,00 €");
    assert.match(view.spoken, /ilustrativo/);
    assert.equal(anyIllustrative([defined(1), illustrative(2)]), true);
    assert.equal(anyIllustrative([defined(1), pending, null, undefined]), false);
  });
});

describe("personas, viajes y fechas", () => {
  it("«Con Ana» usa el nombre de pila", () => {
    assert.equal(withPerson(person("Ana", "Ana García López")), "Con Ana");
    assert.equal(withPerson({ ...person("", "Miguel Torres"), firstName: "" }), "Con Miguel");
    assert.equal(withPerson({ ...person("", ""), firstName: "" }), "Con otra persona");
  });

  it("la ruta se escribe con flecha y tolera etiquetas que faltan", () => {
    assert.equal(tripRouteText(trip(null)), "Sevilla → Camas");
    assert.equal(tripRouteText(trip(null, "Sevilla", null)), "Sevilla");
    assert.equal(tripRouteText(trip(null, null, null)), "Viaje");
    assert.equal(tripRouteText(null), "Viaje");
  });

  it("un viaje de mañana se escribe «Mañana, 07:25»", () => {
    assert.equal(tripDateText(trip("2026-10-06T07:25:00+02:00"), "2026-10-05T07:00:00+02:00", NOW), "Mañana, 07:25");
    assert.equal(tripDateText(trip("2026-10-05T18:30:00+02:00"), "2026-10-04T07:00:00+02:00", NOW), "Hoy, 18:30");
  });

  it("un viaje a partir de pasado mañana se escribe como fecha corta sin hora (lámina 33b: «Vie, 16 may»)", () => {
    const clock = Date.parse("2025-05-14T07:37:00+02:00");
    assert.equal(tripDateText(trip("2025-05-15T07:25:00+02:00"), "2025-05-13T07:00:00+02:00", clock), "Mañana, 07:25");
    assert.equal(tripDateText(trip("2025-05-16T07:25:00+02:00"), "2025-05-13T07:00:00+02:00", clock), "Vie, 16 may");
  });

  it("un viaje pasado se escribe sin hora y el año solo se añade si se pide y no es el actual", () => {
    const past = trip("2025-05-16T08:00:00+02:00");
    assert.equal(tripDateText(past, "2025-05-16T09:00:00+02:00", NOW), "Vie, 16 may");
    assert.equal(tripDateText(past, "2025-05-16T09:00:00+02:00", NOW, { withYear: true }), "Vie, 16 may 2025");
    const thisYear = trip("2026-05-16T08:00:00+02:00");
    assert.equal(tripDateText(thisYear, "2026-05-16T09:00:00+02:00", NOW, { withYear: true }), "Sáb, 16 may");
  });

  it("sin salida del viaje usa la fecha del movimiento", () => {
    assert.equal(tripDateText(trip(null), "2026-10-06T10:00:00+02:00", NOW), "Mañana, 10:00");
    assert.equal(tripDateText(null, "no es fecha", NOW), "");
  });
});

describe("estados de las filas", () => {
  it("«Pendiente» es menta y «Pagado» azul claro, como la lámina 33b", () => {
    assert.deepEqual(paymentStateChip("pending"), { label: "Pendiente", tone: "green" });
    assert.deepEqual(paymentStateChip("paid"), { label: "Pagado", tone: "blue" });
  });

  it("los estados añadidos por producción son honestos", () => {
    assert.deepEqual(paymentStateChip("under_review"), { label: "En revisión", tone: "amber" });
    assert.deepEqual(paymentStateChip("failed"), { label: "Fallido", tone: "red" });
    assert.equal(paymentStateChip("partially_refunded").label, "Devuelto parcialmente");
    assert.equal(paymentStateChip("refunded").label, "Devuelto");
    assert.equal(paymentStateChip("expired").label, "Caducado");
  });

  it("«Cobrado» es verde; «Por cobrar» y «En liquidación» no se presentan como cobrados", () => {
    assert.deepEqual(earningStateChip("paid_out"), { label: "Cobrado", tone: "green" });
    assert.equal(earningStateChip("available").label, "Por cobrar");
    assert.equal(earningStateChip("in_payout").label, "En liquidación");
    assert.equal(earningStateChip("pending").label, "Pendiente");
  });

  it("«Devuelta» exige la confirmación del proveedor", () => {
    const base = { executionStatus: "succeeded" as const };
    assert.equal(refundChip({ ...base, status: "refunded", refundedAt: "2026-10-06T10:00:00.000Z" }).label, "Devuelta");
    assert.equal(refundChip({ ...base, status: "refunded", refundedAt: null }).label, "En trámite");
    assert.equal(refundChip({ ...base, status: "approved", refundedAt: null }).label, "Aprobada");
    assert.equal(refundChip({ ...base, status: "pending_review", refundedAt: null }).label, "En revisión");
    assert.equal(refundChip({ ...base, status: "rejected", refundedAt: null }).tone, "red");
  });

  it("el estado de un método de pago solo avisa cuando no está activo", () => {
    assert.equal(methodStatusChip("active"), null);
    assert.equal(methodStatusChip("requires_action")?.label, "Requiere acción");
    assert.equal(methodStatusChip("expired")?.label, "Caducada");
  });
});

describe("movimientos", () => {
  const driverRow = (bookingId: string, occurredAt: string): DriverEarningItem => ({
    bookingId,
    passenger: person("Miguel"),
    trip: trip("2025-05-16T08:00:00+02:00", "Sevilla", "Tomares"),
    net: pending,
    state: "paid_out",
    occurredAt,
  });
  const passengerRow = (over: Partial<PassengerPaymentItem>): PassengerPaymentItem => ({
    key: "request:r1",
    kind: "pending_request",
    requestId: "r1",
    bookingId: null,
    paymentId: null,
    driver: person("Ana"),
    trip: trip("2026-10-06T07:25:00+02:00"),
    amount: pending,
    state: "pending",
    occurredAt: "2026-10-05T07:00:00.000Z",
    ...over,
  });

  it("una solicitud sin reserva lleva al estado y pago; con reserva, al detalle de la reserva", () => {
    assert.deepEqual(passengerMovement(passengerRow({})).target, { kind: "request_payment", requestId: "r1" });
    assert.deepEqual(passengerMovement(passengerRow({ bookingId: "b1", kind: "payment", paymentId: "p1", key: "payment:p1" })).target, { kind: "booking", bookingId: "b1" });
  });

  it("un cobro lleva a su detalle y toma el neto del conductor", () => {
    const movement = driverMovement(driverRow("b9", "2025-05-16T10:00:00.000Z"));
    assert.deepEqual(movement.target, { kind: "earning", bookingId: "b9" });
    assert.equal(movement.role, "driver");
    assert.equal(movement.key, "earning:b9");
    assert.equal(movement.chip.label, "Cobrado");
    assert.equal(movement.person.firstName, "Miguel");
  });

  it("el resumen de la lámina 33a trae lo último de cada tipo, del más reciente al más antiguo", () => {
    const merged = overviewMovements([passengerRow({})], [driverRow("b9", "2025-05-16T10:00:00.000Z")]);
    assert.deepEqual(merged.map((m) => m.role), ["passenger", "driver"]);
    const many = overviewMovements(
      [passengerRow({ key: "request:a", occurredAt: "2026-10-01T00:00:00.000Z" }), passengerRow({ key: "request:b", occurredAt: "2026-10-03T00:00:00.000Z" })],
      [driverRow("b1", "2026-10-02T00:00:00.000Z"), driverRow("b2", "2026-10-04T00:00:00.000Z")],
    );
    assert.deepEqual(many.map((m) => m.key), ["earning:b2", "request:b"]);
    assert.deepEqual(overviewMovements([], []), []);
    assert.deepEqual(overviewMovements([], [driverRow("b1", "2026-10-02T00:00:00.000Z")]).map((m) => m.key), ["earning:b1"]);
  });
});

describe("comisión y próximo abono", () => {
  it("sin definir se escribe «Por definir»", () => {
    assert.equal(commissionValue({ status: "pending_definition", passengerRateBps: null, driverRateBps: null }, "passenger"), "Por definir");
    assert.equal(commissionValue({ status: "pending_definition", passengerRateBps: null, driverRateBps: null }, "both"), "Por definir");
  });

  it("definida se muestra como porcentaje es-ES", () => {
    const info = { status: "defined" as const, passengerRateBps: 1000, driverRateBps: 750 };
    assert.equal(commissionValue(info, "passenger"), "10 %");
    assert.equal(commissionValue(info, "driver"), "7,5 %");
    assert.equal(commissionValue(info, "both"), "10 % · 7,5 %");
    assert.equal(commissionValue({ ...info, driverRateBps: 1000 }, "both"), "10 %");
    assert.equal(percentFromBps(1250), "12,5 %");
  });

  it("la hoja de comisión no inventa porcentajes", () => {
    assert.deepEqual(commissionParagraphs({ status: "pending_definition", passengerRateBps: 1000, driverRateBps: 750 }, "both"), [
      "MVC todavía no ha definido la comisión de la plataforma. Cuando se apruebe, la verás aquí y en el desglose de cada pago antes de confirmarlo.",
    ]);
    const info = { status: "defined" as const, passengerRateBps: 1000, driverRateBps: 750 };
    // Según el ICU de la plataforma el espacio antes de «%» es normal o no separable: se compara sin esa diferencia.
    const plain = (lines: string[]): string[] => lines.map((line) => line.replace(/\u00a0/g, " "));
    assert.deepEqual(plain(commissionParagraphs(info, "passenger").slice(0, 1)), ["Comisión al pasajero: 10 %"]);
    assert.deepEqual(plain(commissionParagraphs(info, "driver").slice(0, 1)), ["Comisión al conductor: 7,5 %"]);
    assert.equal(commissionParagraphs(info, "both").length, 3);
    // Definida pero sin la tasa del rol pedido: vuelve al texto de «por definir».
    assert.equal(commissionParagraphs({ status: "defined", passengerRateBps: null, driverRateBps: 750 }, "passenger").length, 1);
  });

  it("el próximo abono sin calendario es «Por definir»", () => {
    const view = nextPayoutView({ status: "pending_definition", date: null, amount: pending });
    assert.equal(view.value, "Por definir");
    assert.match(view.explanation, /calendario de abonos todavía no está definido/);
  });

  it("programado muestra la fecha prevista y no lo presenta como cobrado", () => {
    const view = nextPayoutView({ status: "scheduled", date: "2026-11-10", amount: defined(4800) });
    assert.equal(view.value, "10 nov 2026");
    assert.match(view.explanation, /Previsto para el 10 nov 2026/);
    assert.match(view.explanation, /solo cuenta como cobrado cuando/);
  });

  it("en proceso", () => {
    const view = nextPayoutView({ status: "processing", date: null, amount: defined(4800) });
    assert.equal(view.value, "En proceso");
  });
});

describe("métodos de pago", () => {
  const method = (over: Partial<PaymentMethod>): PaymentMethod => ({
    id: "m1",
    purpose: "charge",
    kind: "card",
    brand: "Visa",
    last4: "4242",
    country: "ES",
    expMonth: 8,
    expYear: 2028,
    title: "Tarjeta Visa",
    maskedLabel: "•••• 4242",
    isDefault: false,
    status: "active",
    createdAt: "2026-09-01T10:00:00.000Z",
    ...over,
  });

  it("el subtítulo añade la caducidad solo en tarjetas", () => {
    assert.equal(methodSubtitle(method({})), "•••• 4242 · Caduca 08/28");
    assert.equal(methodSubtitle(method({ kind: "bank_account", expMonth: null, expYear: null, maskedLabel: "ES** **** **** 4589" })), "ES** **** **** 4589");
  });

  it("el predeterminado va primero y después el más reciente", () => {
    const sorted = sortMethods([
      method({ id: "a", createdAt: "2026-01-01T00:00:00.000Z" }),
      method({ id: "b", createdAt: "2026-03-01T00:00:00.000Z" }),
      method({ id: "c", createdAt: "2026-02-01T00:00:00.000Z", isDefault: true }),
    ]);
    assert.deepEqual(sorted.map((m) => m.id), ["c", "b", "a"]);
  });
});

describe("seguimiento de devoluciones", () => {
  const refund = (over: Partial<RefundView>): RefundView => ({
    id: "f1",
    status: "pending_review",
    origin: "passenger_cancellation",
    bookingId: "b1",
    requestId: "r1",
    paymentId: "p1",
    paid: defined(400),
    proposedRefund: pending,
    approvedRefund: pending,
    platformFee: pending,
    finalPassengerCost: pending,
    executionStatus: "not_started",
    policy: { status: "pending_review", version: null, effectiveFrom: null, summary: null },
    createdAt: "2026-10-05T06:26:00.000Z",
    decidedAt: null,
    refundedAt: null,
    ...over,
  });

  it("en revisión: nada decidido ni pedido al proveedor", () => {
    const steps = refundTracking(refund({}));
    assert.deepEqual(steps.map((s) => s.state), ["done", "current", "upcoming", "upcoming"]);
    assert.equal(refundIsOpen(refund({})), true);
  });

  it("aprobada con el proveedor desactivado: queda pendiente de pedirse, no devuelta", () => {
    const steps = refundTracking(refund({ status: "approved", executionStatus: "awaiting_provider", decidedAt: "2026-10-06T09:00:00.000Z" }));
    assert.deepEqual(steps.map((s) => s.state), ["done", "done", "done", "current"]);
    assert.match(steps[3]?.detail ?? "", /Falta pedirla al proveedor/);
  });

  it("pedida al proveedor: falta su confirmación", () => {
    const steps = refundTracking(refund({ status: "executing", executionStatus: "submitted", decidedAt: "2026-10-06T09:00:00.000Z" }));
    assert.equal(steps[3]?.state, "current");
    assert.match(steps[3]?.detail ?? "", /Falta su confirmación/);
  });

  it("solo la confirmación del proveedor completa el último paso", () => {
    const confirmed = refundTracking(
      refund({ status: "refunded", executionStatus: "succeeded", decidedAt: "2026-10-06T09:00:00.000Z", refundedAt: "2026-10-07T09:00:00.000Z" }),
    );
    assert.equal(confirmed[3]?.state, "done");
    assert.match(confirmed[3]?.detail ?? "", /Confirmada por el proveedor el 7 oct 2026/);
    const unconfirmed = refundTracking(refund({ status: "refunded", executionStatus: "succeeded", decidedAt: "2026-10-06T09:00:00.000Z", refundedAt: null }));
    assert.equal(unconfirmed[3]?.state, "current");
    assert.equal(refundIsOpen(refund({ status: "refunded" })), false);
  });

  it("rechazada, fallida y no aplicable", () => {
    const rejected = refundTracking(refund({ status: "rejected", decidedAt: "2026-10-06T09:00:00.000Z" }));
    assert.deepEqual(rejected.map((s) => s.state), ["done", "done", "failed", "skipped"]);
    const failed = refundTracking(refund({ status: "failed", executionStatus: "failed", decidedAt: "2026-10-06T09:00:00.000Z" }));
    assert.equal(failed[3]?.state, "failed");
    const none = refundTracking(refund({ status: "not_applicable" }));
    assert.deepEqual(none.map((s) => s.state), ["done", "done", "skipped", "skipped"]);
  });
});

describe("justificantes y liquidaciones", () => {
  const receipt: Receipt = {
    id: "rc1",
    number: "MVC-J-2026-000012",
    kind: "payment",
    issuedAt: "2026-10-09T13:39:41.000Z",
    total: illustrative(1800),
    trip: trip("2026-10-12T05:25:00.000Z", "Sevilla Centro", "Isla Mágica"),
    counterpart: person("Ana", "Ana García López"),
    bookingId: "b1",
    paymentId: "p1",
    fiscalInvoice: false,
    lines: [
      { key: "contribution", amount: illustrative(1800) },
      { key: "platform_fee", amount: pending },
    ],
    notice: "Justificante de pago no fiscal emitido por MVC. No es una factura.",
  };

  it("el texto compartible incluye el aviso legal del servidor y marca lo ilustrativo", () => {
    const text = receiptShareText(receipt);
    assert.match(text, /MVC-J-2026-000012/);
    assert.match(text, /Pago de viaje/);
    assert.match(text, /Con Ana · Sevilla Centro → Isla Mágica/);
    assert.match(text, /Aportación al viaje: 18,00 € \(ilustrativo\)/);
    assert.match(text, /Gestión MVC: Por definir/);
    assert.match(text, /Total pagado: 18,00 € \(ilustrativo\)/);
    assert.match(text, /No es una factura\.$/);
  });

  it("una liquidación pendiente de calendario no inventa fecha ni abono", () => {
    assert.equal(payoutRowSubtitle(4, "draft", null, null), "4 viajes · Fecha por definir");
    assert.equal(payoutRowSubtitle(1, "processing", "2026-11-10", null), "1 viaje · Prevista 10 nov 2026");
    assert.equal(payoutRowSubtitle(4, "paid", "2026-11-10", "2026-11-12T09:00:00.000Z"), "4 viajes · Abonada el 12 nov 2026");
    assert.equal(payoutRowSubtitle(2, "cancelled", null, null), "2 viajes");
  });

  it("el calendario de abonos sin definir se dice tal cual", () => {
    assert.equal(scheduleText({ dayStatus: "pending_definition", dayOfMonth: null }), "Una vez al mes, día por definir");
    assert.equal(scheduleText({ dayStatus: "defined", dayOfMonth: 10 }), "Una vez al mes, el día 10");
  });
});
