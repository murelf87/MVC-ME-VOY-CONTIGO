/**
 * Módulo money · «Mis pagos y cobros» (pantallas 33a/33b), cobros del conductor derivados del libro mayor y planes (pantalla 32).
 *
 * Importes: fixtures de prueba (no son tarifas). El proveedor es el `StubPaymentProvider` de pruebas; con
 * `DisabledPaymentProvider` se comprueba el comportamiento real actual (proveedor desactivado).
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { DisabledPaymentProvider } from "../src/modules/money/provider/disabled.js";
import {
  addQuote,
  apiCall,
  buildTestApp,
  completeTrip,
  createActor,
  createIntent,
  createTestPool,
  draftTariff,
  ensureTariff,
  nextEventId,
  paidBooking,
  postWebhook,
  providerRefundRef,
  refundEvent,
  resetMoneyData,
  scalar,
  seedPayableRequest,
  seedTrip,
  seedWorld,
  StubPaymentProvider,
  type Actor,
  type PaidBooking,
  type World
} from "./money-support.js";

const pool = createTestPool();
let world: World;
let stub: StubPaymentProvider;
let app: FastifyInstance;
let disabledApp: FastifyInstance;

before(async () => {
  await pool.query("select 1 from payout_runs limit 1");
});
after(async () => {
  await pool.end();
});
beforeEach(async () => {
  await resetMoneyData(pool);
  world = await seedWorld(pool);
  stub = new StubPaymentProvider();
  app = await buildTestApp(pool, stub);
  disabledApp = await buildTestApp(pool, new DisabledPaymentProvider());
});
afterEach(async () => {
  await app.close();
  await disabledApp.close();
});

const MONEY = (cents: number | null) =>
  cents === null ? { cents: null, currency: "EUR", status: "pending_definition" } : { cents, currency: "EUR", status: "defined" };

const monthOfTrip = (tripId: string) =>
  scalar<string>(pool, `select to_char(departure_at at time zone 'Europe/Madrid','YYYY-MM') from trips where id=$1`, [tripId]);

async function cancelAndRefund(booking: PaidBooking, approvedCents: number | null, execute: boolean) {
  const cancelled = await apiCall(app, booking.passenger, "POST", `/v1/bookings/${booking.bookingId}/cancel`, { reason: "schedule_change" });
  assert.equal(cancelled.response.statusCode, 200, cancelled.response.body);
  const refundId = cancelled.json.refund.id as string;
  if (approvedCents !== null) {
    const approved = await apiCall(app, world.finance, "POST", `/v1/admin/refund-proposals/${refundId}/approve`, {
      approvedCents,
      note: "Prueba de informes"
    });
    assert.equal(approved.response.statusCode, 200, approved.response.body);
    if (execute) {
      const ref = await providerRefundRef(pool, refundId);
      const hook = await postWebhook(app, [refundEvent("succeeded", ref, booking.providerRef, approvedCents)]);
      assert.equal(hook.statusCode, 200, hook.body);
    }
  }
  return refundId;
}

type OpenPayment = { tripId: string; requestId: string; paymentId: string; providerRef: string };

/** Solicitud con cotización definida e intento de pago creado (`requires_action`). */
async function openPayment(passenger: Actor, options: { departureInterval?: string } = {}): Promise<OpenPayment> {
  const tariff = await ensureTariff(pool);
  const tripId = await seedTrip(pool, world, options.departureInterval ? { departureInterval: options.departureInterval } : {});
  const { requestId } = await seedPayableRequest(pool, tripId, passenger, { tariffId: tariff });
  const intent = await createIntent(app, passenger, requestId);
  assert.equal(intent.response.statusCode, 201, intent.response.body);
  const paymentId = intent.json.payment.id as string;
  const providerRef = await scalar<string>(pool, `select provider_payment_ref from payments where id=$1`, [paymentId]);
  return { tripId, requestId, paymentId, providerRef };
}

async function paymentEvent(type: "failed" | "expired", ref: string) {
  const hook = await postWebhook(app, [{ id: nextEventId(), object: "payment", type, ref, failureCode: type === "failed" ? "card_declined" : null }]);
  assert.equal(hook.statusCode, 200, hook.body);
}

const passengerSummary = (actor: Actor | null, month?: string, target: FastifyInstance = app) =>
  apiCall(target, actor, "GET", `/v1/me/payments/passenger-summary${month ? `?month=${month}` : ""}`);
const driverSummary = (actor: Actor | null, month?: string, target: FastifyInstance = app) =>
  apiCall(target, actor, "GET", `/v1/me/payments/driver-summary${month ? `?month=${month}` : ""}`);

/* ═════════════════════════ Pantallas 33a/33b · pasajero ═════════════════════════ */

describe("Resumen de pagos como pasajero (pantallas 33a/33b)", () => {
  it("usuario sin movimientos: 0 € definido, sin filas, sin método y comisión por definir (no hay tarifa aprobada)", async () => {
    const r = await passengerSummary(world.lucia);
    assert.equal(r.response.statusCode, 200, r.response.body);
    assert.match(r.json.month, /^\d{4}-\d{2}$/);
    assert.deepEqual(r.json.pendingThisMonth, MONEY(0));
    assert.equal(r.json.upcomingTripsCount, 0);
    assert.deepEqual(r.json.recent, []);
    assert.equal(r.json.paymentMethod, null);
    assert.deepEqual(r.json.platformCommission, { status: "pending_definition", passengerRateBps: null, driverRateBps: null });
    assert.equal(r.json.availability.enabled, true);
    assert.equal(r.json.availability.status, "enabled");
  });

  it("proveedor desactivado: la disponibilidad lo dice y no se muestra ningún método de pago", async () => {
    const r = await passengerSummary(world.lucia, undefined, disabledApp);
    assert.equal(r.response.statusCode, 200);
    assert.deepEqual(r.json.availability, {
      enabled: false,
      status: "provider_disabled",
      message: "Pagos aún no disponibles",
      chargeMethods: [],
      payoutsEnabled: false,
      refundsEnabled: false
    });
    assert.equal(r.json.paymentMethod, null);
  });

  it("solicitud aceptada sin tarifa aprobada: fila «Pendiente» con importe «Por definir» y el total del mes también", async () => {
    const tripId = await seedTrip(pool, world);
    const { requestId } = await seedPayableRequest(pool, tripId, world.miguel); // sin cotización
    const month = await monthOfTrip(tripId);
    const r = await passengerSummary(world.miguel, month);
    assert.deepEqual(r.json.pendingThisMonth, MONEY(null));
    assert.equal(r.json.recent.length, 1);
    const row = r.json.recent[0];
    assert.equal(row.key, `request:${requestId}`);
    assert.equal(row.kind, "pending_request");
    assert.equal(row.state, "pending");
    assert.equal(row.requestId, requestId);
    assert.equal(row.bookingId, null);
    assert.equal(row.paymentId, null);
    assert.deepEqual(row.amount, MONEY(null));
    assert.equal(row.driver.firstName, "Ana");
    assert.equal(row.trip.originLabel, "Sevilla Centro");
    assert.equal(row.trip.destinationLabel, "Isla Mágica");
  });

  it("una cotización ligada a una tarifa en borrador NO cuenta como importe definido", async () => {
    const tripId = await seedTrip(pool, world);
    const { requestId } = await seedPayableRequest(pool, tripId, world.miguel);
    await addQuote(pool, requestId, await draftTariff(pool));
    const r = await passengerSummary(world.miguel, await monthOfTrip(tripId));
    assert.deepEqual(r.json.pendingThisMonth, MONEY(null));
    assert.deepEqual(r.json.recent[0].amount, MONEY(null));
  });

  it("pendiente del mes: suma los importes definidos, ignora otros meses y pasa a «Por definir» si alguno no tiene importe", async () => {
    const tariff = await ensureTariff(pool);
    const trip1 = await seedTrip(pool, world);
    await seedPayableRequest(pool, trip1, world.miguel, { tariffId: tariff }); // 1100
    const month = await monthOfTrip(trip1);
    assert.deepEqual((await passengerSummary(world.miguel, month)).json.pendingThisMonth, MONEY(1100));

    const trip2 = await seedTrip(pool, world);
    await seedPayableRequest(pool, trip2, world.miguel, {
      tariffId: tariff,
      quote: { contributionCents: 400, passengerCommissionCents: 100, driverCommissionCents: 20, totalCents: 500, driverNetCents: 380 }
    });
    // mismo mes que el primero salvo que el cambio de mes caiga entre ambos viajes (mismo instante de siembra: no ocurre)
    assert.equal(await monthOfTrip(trip2), month);
    assert.deepEqual((await passengerSummary(world.miguel, month)).json.pendingThisMonth, MONEY(1600));

    // un pendiente de otro mes no suma en este
    const farTrip = await seedTrip(pool, world, { departureInterval: "40 days" });
    await seedPayableRequest(pool, farTrip, world.miguel, {
      tariffId: tariff,
      quote: { contributionCents: 600, passengerCommissionCents: 100, driverCommissionCents: 30, totalCents: 700, driverNetCents: 570 }
    });
    const farMonth = await monthOfTrip(farTrip);
    assert.notEqual(farMonth, month);
    assert.deepEqual((await passengerSummary(world.miguel, month)).json.pendingThisMonth, MONEY(1600));
    assert.deepEqual((await passengerSummary(world.miguel, farMonth)).json.pendingThisMonth, MONEY(700));

    // uno sin importe en el mes → no se puede afirmar un total
    const trip3 = await seedTrip(pool, world);
    await seedPayableRequest(pool, trip3, world.miguel);
    assert.deepEqual((await passengerSummary(world.miguel, month)).json.pendingThisMonth, MONEY(null));
  });

  it("con un intento de pago abierto la fila es el pago (no se duplica con la solicitud)", async () => {
    const open = await openPayment(world.miguel);
    const r = await passengerSummary(world.miguel, await monthOfTrip(open.tripId));
    assert.equal(r.json.recent.length, 1);
    assert.equal(r.json.recent[0].key, `payment:${open.paymentId}`);
    assert.equal(r.json.recent[0].kind, "payment");
    assert.equal(r.json.recent[0].state, "pending");
    assert.deepEqual(r.json.recent[0].amount, MONEY(1100));
    assert.deepEqual(r.json.pendingThisMonth, MONEY(1100));
  });

  it("pago confirmado: fila «Pagado», próximo viaje contado, método por defecto visible y comisión definida con tarifa aprobada", async () => {
    const added = await apiCall(app, world.miguel, "POST", "/v1/me/payment-methods", { purpose: "charge", providerToken: "tok_card_visa_4242" });
    assert.equal(added.response.statusCode, 201, added.response.body);
    const booking = await paidBooking(pool, app, world);
    const r = await passengerSummary(world.miguel, await monthOfTrip(booking.tripId));
    assert.deepEqual(r.json.pendingThisMonth, MONEY(0));
    assert.equal(r.json.upcomingTripsCount, 1);
    assert.equal(r.json.recent[0].state, "paid");
    assert.equal(r.json.recent[0].bookingId, booking.bookingId);
    assert.equal(r.json.recent[0].paymentId, booking.paymentId);
    assert.deepEqual(r.json.recent[0].amount, MONEY(1100));
    assert.equal(r.json.paymentMethod.maskedLabel, "•••• 4242");
    assert.equal(r.json.paymentMethod.title, "Tarjeta Visa");
    // tarifa de prueba aprobada por approveTariff: 1000 / 500 puntos básicos
    assert.deepEqual(r.json.platformCommission, { status: "defined", passengerRateBps: 1000, driverRateBps: 500 });
  });

  it("solo muestra las 3 filas más recientes, la más nueva primero", async () => {
    const bookings: PaidBooking[] = [];
    for (let i = 0; i < 4; i += 1) bookings.push(await paidBooking(pool, app, world, { passenger: world.miguel }));
    const r = await passengerSummary(world.miguel, await monthOfTrip(bookings[0]!.tripId));
    assert.equal(r.json.recent.length, 3);
    assert.deepEqual(
      r.json.recent.map((row: any) => row.bookingId),
      [bookings[3]!.bookingId, bookings[2]!.bookingId, bookings[1]!.bookingId]
    );
    assert.equal(r.json.upcomingTripsCount, 4);
  });

  it("mes inválido → 400; sin sesión → 401; el resumen es solo del propio usuario", async () => {
    for (const month of ["2026-13", "2026-00", "26-07", "julio", "2026-7"]) {
      const bad = await passengerSummary(world.miguel, month);
      assert.equal(bad.response.statusCode, 400, month);
      assert.equal(bad.json.error.code, "VALIDATION_ERROR", month);
    }
    assert.equal((await passengerSummary(null)).response.statusCode, 401);
    await paidBooking(pool, app, world);
    const other = await passengerSummary(world.lucia);
    assert.deepEqual(other.json.recent, []);
    assert.equal(other.json.upcomingTripsCount, 0);
  });
});

describe("Mis pagos como pasajero · «Ver todos» (estados y filtros)", () => {
  type Scenario = { pending: OpenPayment; failed: OpenPayment; expired: OpenPayment; paid: PaidBooking; partial: PaidBooking; review: PaidBooking; refunded: PaidBooking };

  async function allStates(): Promise<Scenario> {
    const miguel = world.miguel;
    const pending = await openPayment(miguel);
    const failed = await openPayment(miguel);
    await paymentEvent("failed", failed.providerRef);
    const expired = await openPayment(miguel);
    await paymentEvent("expired", expired.providerRef);
    const paid = await paidBooking(pool, app, world, { passenger: miguel });
    const partial = await paidBooking(pool, app, world, { passenger: miguel });
    await cancelAndRefund(partial, 500, true);
    const review = await paidBooking(pool, app, world, { passenger: miguel });
    await cancelAndRefund(review, null, false);
    const refunded = await paidBooking(pool, app, world, { passenger: miguel });
    await cancelAndRefund(refunded, 1100, true);
    return { pending, failed, expired, paid, partial, review, refunded };
  }

  it("cada estado aparece una vez, con el filtro correcto", async () => {
    const s = await allStates();
    const byState = async (state: string) => (await apiCall(app, world.miguel, "GET", `/v1/me/payments?state=${state}`)).json.items as any[];

    assert.deepEqual((await byState("paid")).map(i => i.paymentId), [s.paid.paymentId]);
    assert.deepEqual((await byState("partially_refunded")).map(i => i.paymentId), [s.partial.paymentId]);
    assert.deepEqual((await byState("under_review")).map(i => i.paymentId), [s.review.paymentId]);
    assert.deepEqual((await byState("refunded")).map(i => i.paymentId), [s.refunded.paymentId]);
    assert.deepEqual((await byState("failed")).map(i => i.paymentId), [s.failed.paymentId]);
    assert.deepEqual((await byState("expired")).map(i => i.paymentId), [s.expired.paymentId]);

    // pendientes: el pago abierto + las dos solicitudes cuyo intento falló/caducó (siguen pudiéndose pagar)
    const pending = await byState("pending");
    assert.equal(pending.length, 3);
    assert.deepEqual(
      new Set(pending.map(i => i.key)),
      new Set([`payment:${s.pending.paymentId}`, `request:${s.failed.requestId}`, `request:${s.expired.requestId}`])
    );

    const all = (await apiCall(app, world.miguel, "GET", "/v1/me/payments")).json;
    assert.equal(all.items.length, 9);
    assert.equal(all.nextCursor, null);
    // los importes de pagos devueltos siguen siendo lo cobrado
    assert.deepEqual((await byState("refunded"))[0].amount, MONEY(1100));
  });

  it("paginación por cursor: sin repetidos ni huecos y de más reciente a más antiguo", async () => {
    await allStates();
    const keys: string[] = [];
    const stamps: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: { json: Record<string, any> } = await apiCall(app, world.miguel, "GET", `/v1/me/payments?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      for (const item of page.json.items as any[]) {
        keys.push(item.key);
        stamps.push(item.occurredAt);
      }
      cursor = page.json.nextCursor as string | null;
      pages += 1;
      assert.ok(pages <= 6, "demasiadas páginas: el cursor no avanza");
    } while (cursor);
    assert.equal(keys.length, 9);
    assert.equal(new Set(keys).size, 9);
    assert.equal(pages, 5);
    assert.deepEqual([...stamps].sort().reverse(), stamps, "orden descendente por fecha");
  });

  it("validación de filtros y visibilidad: nadie ve los pagos de otro; la conductora no ve el pago del pasajero", async () => {
    await paidBooking(pool, app, world);
    for (const url of ["/v1/me/payments?state=pagado", "/v1/me/payments?limit=99", "/v1/me/payments?cursor=%25"]) {
      const bad = await apiCall(app, world.miguel, "GET", url);
      assert.equal(bad.response.statusCode, 400, url);
      assert.equal(bad.json.error.code, "VALIDATION_ERROR", url);
    }
    assert.equal((await apiCall(app, null, "GET", "/v1/me/payments")).response.statusCode, 401);
    for (const other of [world.lucia, world.ana, world.finance]) {
      const list = await apiCall(app, other, "GET", "/v1/me/payments");
      assert.deepEqual(list.json.items, [], other.name);
    }
  });
});

/* ═════════════════════════ Pantallas 33a/33b · conductor ═════════════════════════ */

describe("Resumen de cobros como conductor (pantalla 33a)", () => {
  it("conductora sin viajes: 0 € definido, sin filas y próximo abono «Por definir»", async () => {
    const r = await driverSummary(world.ana);
    assert.equal(r.response.statusCode, 200, r.response.body);
    assert.deepEqual(r.json.toCollectThisMonth, MONEY(0));
    assert.equal(r.json.completedTripsCount, 0);
    assert.deepEqual(r.json.nextPayout, { status: "pending_definition", date: null, amount: MONEY(null) });
    assert.deepEqual(r.json.recent, []);
    assert.equal(r.json.payoutAccount, null);
    assert.deepEqual(r.json.platformCommission, { status: "pending_definition", passengerRateBps: null, driverRateBps: null });
  });

  it("viaje pagado pero aún no completado: no hay nada «A cobrar» y el cobro figura como Pendiente", async () => {
    const booking = await paidBooking(pool, app, world);
    const r = await driverSummary(world.ana);
    assert.deepEqual(r.json.toCollectThisMonth, MONEY(0));
    assert.equal(r.json.completedTripsCount, 0);
    assert.equal(r.json.recent.length, 1);
    assert.equal(r.json.recent[0].bookingId, booking.bookingId);
    assert.equal(r.json.recent[0].state, "pending");
    assert.deepEqual(r.json.recent[0].net, MONEY(950));
  });

  it("viaje completado: 950 € A cobrar este mes (aportación − comisión del conductor), «Por cobrar» y próximo abono sin fecha", async () => {
    const booking = await paidBooking(pool, app, world);
    await completeTrip(pool, booking.tripId);
    const r = await driverSummary(world.ana);
    assert.deepEqual(r.json.toCollectThisMonth, MONEY(950));
    assert.equal(r.json.completedTripsCount, 1);
    assert.equal(r.json.recent[0].state, "available");
    assert.equal(r.json.recent[0].passenger.firstName, "Miguel");
    assert.deepEqual(r.json.nextPayout, { status: "pending_definition", date: null, amount: MONEY(950) });
    assert.deepEqual(r.json.platformCommission, { status: "defined", passengerRateBps: 1000, driverRateBps: 500 });
    // otro mes: nada
    const other = await driverSummary(world.ana, "2026-01");
    assert.deepEqual(other.json.toCollectThisMonth, MONEY(0));
    assert.equal(other.json.completedTripsCount, 0);
    // un pasajero que no conduce no ve cobros
    const passenger = await driverSummary(world.miguel);
    assert.deepEqual(passenger.json.toCollectThisMonth, MONEY(0));
    assert.deepEqual(passenger.json.recent, []);
  });

  it("una reserva completada SIN asientos de libro (economía no activada) deja el importe en «Por definir», nunca en 0", async () => {
    const tripId = await seedTrip(pool, world);
    const { requestId } = await seedPayableRequest(pool, tripId, world.miguel);
    await pool.query(`update ride_requests set status='confirmed' where id=$1`, [requestId]);
    await pool.query(`insert into bookings(request_id,provider_payment_id,amount_cents,status) values($1,'legacy-pay-1',400,'completed')`, [requestId]);
    await completeTrip(pool, tripId);
    const r = await driverSummary(world.ana);
    assert.deepEqual(r.json.toCollectThisMonth, MONEY(null));
    assert.equal(r.json.completedTripsCount, 1);
    assert.deepEqual(r.json.recent, [], "sin libro no se inventa ningún cobro");
  });

  it("con la cuenta de cobro registrada (proveedor activo) la muestra enmascarada; desactivado, no", async () => {
    const added = await apiCall(app, world.ana, "POST", "/v1/me/payment-methods", { purpose: "payout", providerToken: "tok_iban_4589" });
    assert.equal(added.response.statusCode, 201, added.response.body);
    const r = await driverSummary(world.ana);
    assert.equal(r.json.payoutAccount.maskedLabel, "ES** **** **** 4589");
    assert.equal(r.json.payoutAccount.title, "Cuenta bancaria");
    assert.doesNotMatch(r.response.body, /tok_iban|pm_tok/);
    const disabled = await driverSummary(world.ana, undefined, disabledApp);
    assert.equal(disabled.json.payoutAccount, null);
    assert.equal(disabled.json.availability.enabled, false);
  });

  it("validaciones: mes inválido 400, sin sesión 401", async () => {
    assert.equal((await driverSummary(world.ana, "2026-99")).response.statusCode, 400);
    assert.equal((await driverSummary(null)).response.statusCode, 401);
  });
});

describe("Cobros del conductor (Ver todos y detalle)", () => {
  async function completedBooking(passenger: Actor, completedAt: string): Promise<PaidBooking> {
    const booking = await paidBooking(pool, app, world, { passenger });
    await completeTrip(pool, booking.tripId, completedAt);
    return booking;
  }
  const earnings = (actor: Actor | null, query = "") => apiCall(app, actor, "GET", `/v1/me/earnings${query}`);

  it("estados Pendiente, Por cobrar, En liquidación y Cobrado según la reserva y la liquidación", async () => {
    const pendingOne = await paidBooking(pool, app, world, { passenger: world.miguel });
    const availableOne = await completedBooking(world.lucia, "2026-08-10T10:00:00Z");
    const inPayoutPassenger = await createActor(pool, "Pasajero Julio", ["passenger"]);
    const inPayout = await completedBooking(inPayoutPassenger, "2026-07-10T10:00:00Z");
    const paidOutPassenger = await createActor(pool, "Pasajero Junio", ["passenger"]);
    const paidOut = await completedBooking(paidOutPassenger, "2026-06-10T10:00:00Z");

    for (const period of ["2026-06", "2026-07"]) {
      const generated = await apiCall(app, world.finance, "POST", "/v1/admin/payout-runs", { period });
      assert.equal(generated.response.statusCode, 201, generated.response.body);
    }
    // la de junio se abona (cuenta de cobro + ejecución + evento firmado)
    await apiCall(app, world.ana, "POST", "/v1/me/payment-methods", { purpose: "payout", providerToken: "tok_iban_4589" });
    const juneRun = (await apiCall(app, world.finance, "GET", "/v1/admin/payout-runs?period=2026-06")).json.items[0];
    const executed = await apiCall(app, world.finance, "POST", `/v1/admin/payout-runs/${juneRun.id}/execute`);
    assert.equal(executed.response.statusCode, 200, executed.response.body);
    const payoutRef = await scalar<string>(pool, `select provider_payout_ref from payout_runs where id=$1`, [juneRun.id]);
    const paid = await postWebhook(app, [{ id: nextEventId(), object: "payout", type: "paid", ref: payoutRef, amountCents: 950 }]);
    assert.equal(paid.statusCode, 200, paid.body);

    const states = new Map<string, string>((await earnings(world.ana)).json.items.map((i: any) => [i.bookingId, i.state]));
    assert.equal(states.get(pendingOne.bookingId), "pending");
    assert.equal(states.get(availableOne.bookingId), "available");
    assert.equal(states.get(inPayout.bookingId), "in_payout");
    assert.equal(states.get(paidOut.bookingId), "paid_out");

    for (const [state, expected] of [
      ["pending", pendingOne],
      ["available", availableOne],
      ["in_payout", inPayout],
      ["paid_out", paidOut]
    ] as const) {
      const filtered = await earnings(world.ana, `?state=${state}`);
      assert.deepEqual(filtered.json.items.map((i: any) => i.bookingId), [expected.bookingId], state);
    }
    assert.equal((await earnings(world.ana, "?state=cobrado")).response.statusCode, 400);

    // el detalle de la liquidación pagada apunta a su liquidación
    const detail = await apiCall(app, world.ana, "GET", `/v1/me/earnings/${paidOut.bookingId}`);
    assert.equal(detail.json.payoutId, juneRun.id);
    assert.equal(detail.json.state, "paid_out");
  });

  it("las reservas canceladas, canceladas por la conductora y no-show NO se listan como cobros", async () => {
    const cancelled = await paidBooking(pool, app, world, { passenger: world.miguel });
    assert.equal((await apiCall(app, world.miguel, "POST", `/v1/bookings/${cancelled.bookingId}/cancel`, { reason: "other" })).response.statusCode, 200);
    const byDriver = await paidBooking(pool, app, world, { passenger: world.lucia });
    assert.equal((await apiCall(app, world.ana, "POST", `/v1/bookings/${byDriver.bookingId}/driver-cancel`, { reason: "vehicle_issue" })).response.statusCode, 200);
    const noShowPassenger = await createActor(pool, "No Show", ["passenger"]);
    const noShow = await paidBooking(pool, app, world, { passenger: noShowPassenger });
    await pool.query(`update bookings set status='no_show' where id=$1`, [noShow.bookingId]);
    const kept = await paidBooking(pool, app, world, { passenger: await createActor(pool, "Se Queda", ["passenger"]) });

    const list = await earnings(world.ana);
    assert.deepEqual(list.json.items.map((i: any) => i.bookingId), [kept.bookingId]);
    for (const hidden of [cancelled, byDriver, noShow]) {
      const detail = await apiCall(app, world.ana, "GET", `/v1/me/earnings/${hidden.bookingId}`);
      assert.equal(detail.response.statusCode, 404, hidden.bookingId);
    }
  });

  it("detalle: aportación, comisión del conductor y neto; nunca comisión del pasajero, total, método ni pago", async () => {
    const booking = await paidBooking(pool, app, world);
    await completeTrip(pool, booking.tripId);
    const detail = await apiCall(app, world.ana, "GET", `/v1/me/earnings/${booking.bookingId}`);
    assert.equal(detail.response.statusCode, 200, detail.response.body);
    assert.deepEqual(detail.json.lines, {
      contribution: MONEY(1000),
      driverCommission: MONEY(50),
      refundAdjustments: MONEY(0),
      net: MONEY(950)
    });
    assert.equal(detail.json.payoutId, null);
    assert.deepEqual(Object.keys(detail.json).sort(), ["bookingId", "lines", "net", "occurredAt", "passenger", "payoutId", "state", "trip"]);
    assert.doesNotMatch(detail.response.body, /passengerCommission|platform|processing|taxes|total|paymentId|providerPaymentRef|apple_pay|card/i);
    assert.equal(detail.json.passenger.firstName, "Miguel");
    assert.equal(detail.json.passenger.photoUrl, null);
  });

  it("una devolución aprobada sobre una reserva completada se refleja como ajuste y baja el neto", async () => {
    const booking = await paidBooking(pool, app, world);
    await completeTrip(pool, booking.tripId);
    // devolución abierta por otro módulo (origen «other»): fixture SQL, igual que haría una incidencia
    const refundId = (
      await pool.query<{ id: string }>(
        `insert into refund_requests(origin,status,request_id,booking_id,payment_id,trip_id,passenger_user_id,driver_user_id,paid_cents,policy_status)
         values('other','pending_review',$1,$2,$3,$4,$5,$6,1100,'pending_review') returning id`,
        [booking.requestId, booking.bookingId, booking.paymentId, booking.tripId, world.miguel.id, world.ana.id]
      )
    ).rows[0]!.id;
    const approved = await apiCall(app, world.finance, "POST", `/v1/admin/refund-proposals/${refundId}/approve`, { approvedCents: 500, note: "Incidencia en el trayecto" });
    assert.equal(approved.response.statusCode, 200, approved.response.body);

    const detail = await apiCall(app, world.ana, "GET", `/v1/me/earnings/${booking.bookingId}`);
    assert.deepEqual(detail.json.lines.refundAdjustments, MONEY(432));
    assert.deepEqual(detail.json.lines.net, MONEY(518));
    assert.deepEqual(detail.json.net, MONEY(518));
    const summary = await driverSummary(world.ana);
    assert.deepEqual(summary.json.toCollectThisMonth, MONEY(518));
  });

  it("una reserva devuelta íntegramente (neto 0) deja de ser un cobro", async () => {
    const booking = await paidBooking(pool, app, world);
    await completeTrip(pool, booking.tripId);
    const refundId = (
      await pool.query<{ id: string }>(
        `insert into refund_requests(origin,status,request_id,booking_id,payment_id,trip_id,passenger_user_id,driver_user_id,paid_cents,policy_status)
         values('other','pending_review',$1,$2,$3,$4,$5,$6,1100,'pending_review') returning id`,
        [booking.requestId, booking.bookingId, booking.paymentId, booking.tripId, world.miguel.id, world.ana.id]
      )
    ).rows[0]!.id;
    assert.equal(
      (await apiCall(app, world.finance, "POST", `/v1/admin/refund-proposals/${refundId}/approve`, { approvedCents: 1100, note: "Reembolso íntegro" })).response.statusCode,
      200
    );
    assert.deepEqual((await earnings(world.ana)).json.items, []);
    assert.deepEqual((await driverSummary(world.ana)).json.toCollectThisMonth, MONEY(0));
  });

  it("paginación por cursor y propiedad: solo la conductora del viaje ve y consulta sus cobros", async () => {
    const bookings: PaidBooking[] = [];
    for (let i = 0; i < 3; i += 1) {
      const passenger = await createActor(pool, `Pasajero ${i}`, ["passenger"]);
      bookings.push(await completedBooking(passenger, `2026-08-0${i + 1}T10:00:00Z`));
    }
    const first = await earnings(world.ana, "?limit=2");
    assert.equal(first.json.items.length, 2);
    assert.ok(first.json.nextCursor);
    const second = await earnings(world.ana, `?limit=2&cursor=${first.json.nextCursor}`);
    assert.equal(second.json.items.length, 1);
    assert.equal(second.json.nextCursor, null);
    const seen = [...first.json.items, ...second.json.items].map((i: any) => i.bookingId);
    assert.equal(new Set(seen).size, 3);
    assert.deepEqual(seen, [bookings[2]!.bookingId, bookings[1]!.bookingId, bookings[0]!.bookingId], "más reciente primero");

    assert.equal((await earnings(null)).response.statusCode, 401);
    for (const other of [world.miguel, world.lucia, world.finance]) {
      assert.deepEqual((await earnings(other)).json.items, [], other.name);
      const detail = await apiCall(app, other, "GET", `/v1/me/earnings/${bookings[0]!.bookingId}`);
      assert.equal(detail.response.statusCode, 404, other.name);
      assert.equal(detail.json.error.code, "BOOKING_NOT_FOUND");
    }
    assert.equal((await apiCall(app, world.ana, "GET", "/v1/me/earnings/no-es-uuid")).response.statusCode, 400);
  });
});

/* ═════════════════════════ Pantalla 32 · Planes MVC ═════════════════════════ */

describe("Planes MVC (pantalla 32)", () => {
  it("catálogo público: gratuito activo, Premium Conductor «Propuesta» sin precio y Membresía no disponible", async () => {
    const r = await apiCall(app, null, "GET", "/v1/plans");
    assert.equal(r.response.statusCode, 200, r.response.body);
    const items = r.json.items as any[];
    assert.deepEqual(items.map(p => [p.code, p.status]), [
      ["free", "active"],
      ["premium_driver", "proposal"],
      ["membership", "unavailable"]
    ]);
    const [free, premium, membership] = items;
    assert.deepEqual(free.price, MONEY(0));
    assert.ok(free.features.length >= 3);
    assert.equal(free.economicsNote, null);

    assert.deepEqual(premium.price, MONEY(null), "el precio de Premium no está decidido");
    assert.equal(premium.economicsNote.title, "Cuota y comisiones por definir");
    assert.ok(premium.features.length >= 3);

    assert.deepEqual(membership.price, MONEY(null));
    assert.match(membership.availabilityNote, /no está disponible por el momento/);
    assert.deepEqual(membership.features, []);
  });

  it("el catálogo es idéntico con el proveedor activado o desactivado y no depende de la sesión", async () => {
    const a = await apiCall(app, null, "GET", "/v1/plans");
    const b = await apiCall(disabledApp, world.miguel, "GET", "/v1/plans");
    assert.deepEqual(a.json, b.json);
  });

  it("mi plan: gratuito, activo y no contratable; exige sesión", async () => {
    assert.equal((await apiCall(app, null, "GET", "/v1/me/plan")).response.statusCode, 401);
    for (const actor of [world.miguel, world.ana, world.finance]) {
      const r = await apiCall(app, actor, "GET", "/v1/me/plan");
      assert.deepEqual(r.json, { planCode: "free", status: "active", purchasable: false }, actor.name);
    }
  });

  it("no existe ninguna forma de contratar un plan: ninguna ruta de compra responde", async () => {
    const attempts: Array<["POST" | "DELETE" | "GET", string]> = [
      ["POST", "/v1/plans"],
      ["POST", "/v1/plans/premium_driver"],
      ["POST", "/v1/plans/premium_driver/purchase"],
      ["POST", "/v1/plans/premium_driver/subscribe"],
      ["POST", "/v1/plans/checkout"],
      ["POST", "/v1/me/plan"],
      ["POST", "/v1/me/subscription"],
      ["POST", "/v1/subscriptions"],
      ["GET", "/v1/me/subscription"],
      ["DELETE", "/v1/me/plan"]
    ];
    for (const [method, url] of attempts) {
      const r = await apiCall(app, world.miguel, method, url, method === "POST" ? { plan: "premium_driver" } : undefined);
      assert.equal(r.response.statusCode, 404, `${method} ${url}`);
    }
    const plans = await pool.query(`select code, status from plans order by position`);
    assert.deepEqual(plans.rows.map(p => [p.code, p.status]), [["free", "active"], ["premium_driver", "proposal"], ["membership", "unavailable"]]);
  });

  it("sin emitir recibos ni asientos de ningún plan", async () => {
    await apiCall(app, world.miguel, "GET", "/v1/plans");
    await apiCall(app, world.miguel, "GET", "/v1/me/plan");
    assert.equal(Number(await scalar<string>(pool, `select count(*)::text from ledger_entries`)), 0);
    assert.equal(Number(await scalar<string>(pool, `select count(*)::text from receipts`)), 0);
  });
});

