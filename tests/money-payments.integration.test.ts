/**
 * Módulo money · pagos: proveedor desactivado (por defecto), intentos de pago idempotentes, webhook firmado
 * (duplicados, desorden, pago tardío → compensación, sin sobre-reserva), autorización.
 *
 * Los importes (1.100 céntimos, etc.) son cifras de prueba, NO tarifas. El proveedor «stubpay» es solo de pruebas.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, afterEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { DisabledPaymentProvider } from "../src/modules/money/provider/disabled.js";
import {
  addQuote,
  approveTariff,
  bearer,
  buildTestApp,
  createIntent,
  createTestPool,
  draftTariff,
  newKey,
  nextEventId,
  payRequest,
  postWebhook,
  resetMoneyData,
  scalar,
  seedPayableRequest,
  seedTrip,
  seedWorld,
  signedWebhookHeaders,
  StubPaymentProvider,
  succeededEvent,
  TEST_QUOTE,
  TEST_WEBHOOK_SECRET,
  type StubWebhookEvent,
  type World
} from "./money-support.js";

const pool = createTestPool();
let world: World;

before(async () => {
  await pool.query("select 1 from payments limit 1");
});
after(async () => {
  await pool.end();
});
beforeEach(async () => {
  await resetMoneyData(pool);
  world = await seedWorld(pool);
});

async function count(table: string, where = "true", params: unknown[] = []): Promise<number> {
  return Number(await scalar<string>(pool, `select count(*)::text from ${table} where ${where}`, params));
}

async function ledgerImbalance(): Promise<number> {
  return Number(
    await scalar<string>(
      pool,
      `select coalesce(sum(abs(s)),0)::text from (select sum(amount_cents) s from ledger_entries group by transaction_id) t`
    )
  );
}

/* ═════════════════════════ 1. Proveedor desactivado (comportamiento por defecto) ═════════════════════════ */

describe("proveedor de pagos desactivado (PAYMENTS_PROVIDER=disabled)", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildTestApp(pool, new DisabledPaymentProvider());
  });
  afterEach(async () => {
    await app.close();
  });

  it("«Estado y pago»: no se puede pagar, se explica por qué y no inventa importes sin tarifa", async () => {
    const trip = await seedTrip(pool, world);
    const { requestId } = await seedPayableRequest(pool, trip, world.miguel); // sin tarifa aprobada
    const response = await app.inject({ method: "GET", url: `/v1/ride-requests/${requestId}/payment`, headers: bearer(world.miguel) });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.requestId, requestId);
    assert.equal(body.requestStatus, "payment_pending");
    assert.equal(body.canPay, false);
    assert.equal(body.cannotPayReason.code, "PAYMENTS_PROVIDER_DISABLED");
    assert.equal(body.availability.enabled, false);
    assert.equal(body.availability.status, "provider_disabled");
    assert.equal(body.availability.message, "Pagos aún no disponibles");
    assert.deepEqual(body.availability.chargeMethods, []);
    assert.ok(body.methods.every((m: { available: boolean }) => m.available === false));
    assert.deepEqual(body.savedMethods, []);
    assert.equal(body.summary.total.status, "pending_definition");
    assert.equal(body.summary.total.cents, null);
    assert.equal(body.summary.contribution.status, "pending_definition");
    assert.equal(body.hold.status, "active");
    assert.ok(body.hold.secondsRemaining > 0 && body.hold.secondsRemaining <= 600);
    assert.equal(body.driver.id, world.ana.id);
    assert.equal(body.driver.displayName, "Ana García López");
    assert.equal(body.trip.originLabel, "Sevilla Centro");
    assert.equal(body.trip.destinationLabel, "Isla Mágica");
    assert.equal(body.payment, null);
    assert.equal(body.bookingId, null);
  });

  it("con tarifa aprobada el importe se muestra pero el pago sigue bloqueado por el proveedor", async () => {
    const tariff = await approveTariff(pool);
    const trip = await seedTrip(pool, world);
    const { requestId } = await seedPayableRequest(pool, trip, world.miguel, { tariffId: tariff });
    const response = await app.inject({ method: "GET", url: `/v1/ride-requests/${requestId}/payment`, headers: bearer(world.miguel) });
    const body = response.json();
    assert.equal(body.summary.total.status, "defined");
    assert.equal(body.summary.total.cents, 1100);
    assert.equal(body.summary.total.currency, "EUR");
    assert.equal(body.summary.platformFee.cents, 100);
    assert.equal(body.summary.tariffVersion, 1);
    assert.equal(body.canPay, false);
    assert.equal(body.cannotPayReason.code, "PAYMENTS_PROVIDER_DISABLED");
  });

  it("crear el intento responde 409 PAYMENTS_PROVIDER_DISABLED, sin tocar la base de datos ni guardar la clave", async () => {
    const tariff = await approveTariff(pool);
    const trip = await seedTrip(pool, world);
    const { requestId } = await seedPayableRequest(pool, trip, world.miguel, { tariffId: tariff });
    const first = await createIntent(app, world.miguel, requestId, "apple_pay");
    assert.equal(first.response.statusCode, 409);
    assert.equal(first.json.error.code, "PAYMENTS_PROVIDER_DISABLED");
    assert.ok(first.json.requestId);
    assert.equal(await count("payments"), 0);
    assert.equal(await count("bookings"), 0);
    assert.equal(await count("idempotency_keys"), 0, "los errores no se guardan como respuesta repetible");
    const ride = await scalar<string>(pool, `select status::text from ride_requests where id=$1`, [requestId]);
    assert.equal(ride, "payment_pending");
  });

  it("aunque tampoco haya tarifa aprobada, con el proveedor desactivado manda PAYMENTS_PROVIDER_DISABLED", async () => {
    const trip = await seedTrip(pool, world);
    const { requestId } = await seedPayableRequest(pool, trip, world.miguel);
    const attempt = await createIntent(app, world.miguel, requestId);
    assert.equal(attempt.response.statusCode, 409);
    assert.equal(attempt.json.error.code, "PAYMENTS_PROVIDER_DISABLED");
  });

  it("métodos de pago: lista vacía, añadir → 409, dato de tarjeta en crudo → 400 y nunca se guarda", async () => {
    const list = await app.inject({ method: "GET", url: "/v1/me/payment-methods", headers: bearer(world.miguel) });
    assert.equal(list.statusCode, 200);
    assert.deepEqual(list.json().items, []);
    assert.equal(list.json().availability.enabled, false);

    const add = await app.inject({
      method: "POST",
      url: "/v1/me/payment-methods",
      headers: { ...bearer(world.miguel), "idempotency-key": newKey() },
      payload: { purpose: "charge", providerToken: "tok_card_visa_4242" }
    });
    assert.equal(add.statusCode, 409);
    assert.equal(add.json().error.code, "PAYMENTS_PROVIDER_DISABLED");

    for (const raw of ["4242424242424242", "4242 4242 4242 4242", "4242-4242-4242-4242"]) {
      const rejected = await app.inject({
        method: "POST",
        url: "/v1/me/payment-methods",
        headers: { ...bearer(world.miguel), "idempotency-key": newKey() },
        payload: { purpose: "charge", providerToken: raw }
      });
      assert.equal(rejected.statusCode, 400, `PAN ${raw}`);
      assert.equal(rejected.json().error.code, "RAW_CARD_DATA_REJECTED");
      assert.ok(!rejected.body.includes("4242424242424242"), "la respuesta no repite el dato");
    }
    assert.equal(await count("payment_methods"), 0);
    assert.equal(await count("idempotency_keys"), 0, "un PAN rechazado no se guarda ni siquiera en la caché de idempotencia");
  });

  it("webhook: con el proveedor desactivado se rechaza SIEMPRE (503), aunque venga firmado", async () => {
    const body = JSON.stringify({ events: [{ id: "evt_x", object: "payment", type: "succeeded", ref: "pi_x", amountCents: 1100 }] });
    const signed = await app.inject({ method: "POST", url: "/v1/webhooks/payments", headers: signedWebhookHeaders(body), payload: body });
    assert.equal(signed.statusCode, 503);
    assert.equal(signed.json().error.code, "PAYMENTS_WEBHOOK_NOT_CONFIGURED");
    const unsigned = await app.inject({
      method: "POST",
      url: "/v1/webhooks/payments",
      headers: { "content-type": "application/json" },
      payload: body
    });
    assert.equal(unsigned.statusCode, 503);
    assert.equal(await count("payment_events"), 0);
  });

  it("jamás aparece un pago ni una reserva sin evento firmado del proveedor", async () => {
    const tariff = await approveTariff(pool);
    const trip = await seedTrip(pool, world);
    const { requestId } = await seedPayableRequest(pool, trip, world.miguel, { tariffId: tariff });
    await createIntent(app, world.miguel, requestId);
    await app.inject({ method: "GET", url: `/v1/ride-requests/${requestId}/payment`, headers: bearer(world.miguel) });
    assert.equal(await count("payments"), 0);
    assert.equal(await count("bookings"), 0);
    assert.equal(await count("ledger_transactions"), 0);
    assert.equal(await count("receipts"), 0);
  });

  it("cuentas de cobro del conductor: no se pueden añadir con el proveedor desactivado", async () => {
    const list = await app.inject({ method: "GET", url: "/v1/me/payment-methods?purpose=payout", headers: bearer(world.ana) });
    assert.equal(list.statusCode, 200);
    assert.deepEqual(list.json().items, []);
    const add = await app.inject({
      method: "POST",
      url: "/v1/me/payment-methods",
      headers: { ...bearer(world.ana), "idempotency-key": newKey() },
      payload: { purpose: "payout", providerToken: "tok_iban_1234" }
    });
    assert.equal(add.statusCode, 409);
    assert.equal(add.json().error.code, "PAYMENTS_PROVIDER_DISABLED");
  });
});

/* ═════════════════════════ 2. Intento de pago (proveedor de pruebas) ═════════════════════════ */

describe("intento de pago", () => {
  let app: FastifyInstance;
  let stub: StubPaymentProvider;
  beforeEach(async () => {
    stub = new StubPaymentProvider();
    app = await buildTestApp(pool, stub);
  });
  afterEach(async () => {
    await app.close();
  });

  async function payable(options: Parameters<typeof seedPayableRequest>[3] = {}, capacity = 2) {
    const tariff = await approveTariff(pool);
    const trip = await seedTrip(pool, world, { capacity });
    const seeded = await seedPayableRequest(pool, trip, world.miguel, { tariffId: tariff, ...options });
    return { ...seeded, tripId: trip, tariff };
  }

  it("«Estado y pago» con proveedor activo: se puede pagar y se ofrecen los métodos del proveedor", async () => {
    const { requestId } = await payable();
    const response = await app.inject({ method: "GET", url: `/v1/ride-requests/${requestId}/payment`, headers: bearer(world.miguel) });
    const body = response.json();
    assert.equal(body.canPay, true);
    assert.equal(body.cannotPayReason, null);
    assert.equal(body.availability.enabled, true);
    assert.deepEqual(
      body.methods.map((m: { kind: string; available: boolean }) => [m.kind, m.available]),
      [["apple_pay", true], ["google_pay", true], ["card", true]]
    );
  });

  it("crea el intento con el importe de la cotización del servidor (201), sin reserva ni pagado todavía", async () => {
    const { requestId, holdId } = await payable();
    const { response, json, key } = await createIntent(app, world.miguel, requestId, "apple_pay");
    assert.equal(response.statusCode, 201);
    assert.equal(json.payment.status, "requires_action");
    assert.equal(json.payment.outcome, "awaiting_payment");
    assert.equal(json.payment.amount.cents, 1100);
    assert.equal(json.payment.amount.status, "defined");
    assert.equal(json.payment.bookingId, null);
    assert.equal(json.payment.method.kind, "apple_pay");
    assert.equal(json.clientAction.type, "sdk_payment_sheet");
    assert.match(json.clientAction.clientSecret, /^cs_stub_/);
    assert.equal(stub.calls.createPaymentIntent, 1);
    const sent = [...stub.intents.values()][0]!.input;
    assert.equal(sent.amountCents, 1100);
    assert.equal(sent.currency, "EUR");
    assert.equal(sent.metadata.requestId, requestId);
    assert.equal(sent.metadata.passengerUserId, world.miguel.id);
    assert.ok(sent.idempotencyKey.startsWith("mvc-"), "la clave del proveedor es derivada, no la del cliente");
    assert.notEqual(sent.idempotencyKey, key);
    // El intento NO confirma nada
    assert.equal(await count("bookings"), 0);
    assert.equal(await scalar<string>(pool, `select status::text from ride_requests where id=$1`, [requestId]), "payment_pending");
    assert.equal(await scalar<string>(pool, `select status::text from seat_holds where id=$1`, [holdId]), "active");
    assert.equal(await count("ledger_transactions"), 0);
    assert.equal(await count("receipts"), 0);
    // La auditoría lo registra
    assert.equal(await count("audit_events", "action=$1", ["payment.intent_created"]), 1);
  });

  it("el importe nunca viene del cliente: un campo `amountCents` enviado se ignora", async () => {
    const { requestId } = await payable();
    const response = await app.inject({
      method: "POST",
      url: `/v1/ride-requests/${requestId}/payment-intents`,
      headers: { ...bearer(world.miguel), "idempotency-key": newKey() },
      payload: { method: { kind: "card" }, amountCents: 1, amount: { cents: 1 }, totalCents: 1 }
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().payment.amount.cents, 1100);
    assert.equal([...stub.intents.values()][0]!.input.amountCents, 1100);
  });

  it("es idempotente: mismo Idempotency-Key y cuerpo → misma respuesta, una sola llamada al proveedor", async () => {
    const { requestId } = await payable();
    const key = newKey();
    const first = await createIntent(app, world.miguel, requestId, "card", key);
    const second = await createIntent(app, world.miguel, requestId, "card", key);
    assert.equal(first.response.statusCode, 201);
    assert.equal(second.response.statusCode, 201);
    assert.equal(second.response.headers["idempotency-replayed"], "true");
    assert.equal(first.response.headers["idempotency-replayed"], undefined);
    assert.deepEqual(second.json, first.json);
    assert.equal(stub.calls.createPaymentIntent, 1);
    assert.equal(await count("payments"), 1);
  });

  it("peticiones simultáneas con la misma clave producen un único pago", async () => {
    const { requestId } = await payable();
    const key = newKey();
    const responses = await Promise.all(Array.from({ length: 6 }, () => createIntent(app, world.miguel, requestId, "card", key)));
    assert.ok(responses.every(r => r.response.statusCode === 201));
    assert.equal(new Set(responses.map(r => r.json.payment.id)).size, 1);
    assert.equal(await count("payments"), 1);
    assert.equal(stub.calls.createPaymentIntent, 1);
  });

  it("la misma clave con un cuerpo distinto → 422 IDEMPOTENCY_KEY_REUSED", async () => {
    const { requestId } = await payable();
    const key = newKey();
    await createIntent(app, world.miguel, requestId, "card", key);
    const reused = await createIntent(app, world.miguel, requestId, "apple_pay", key);
    assert.equal(reused.response.statusCode, 422);
    assert.equal(reused.json.error.code, "IDEMPOTENCY_KEY_REUSED");
  });

  it("exige Idempotency-Key válida (400)", async () => {
    const { requestId } = await payable();
    for (const headers of [{}, { "idempotency-key": "x" }, { "idempotency-key": "clave con espacios y ñ" }]) {
      const response = await app.inject({
        method: "POST",
        url: `/v1/ride-requests/${requestId}/payment-intents`,
        headers: { ...bearer(world.miguel), ...headers },
        payload: { method: { kind: "card" } }
      });
      assert.equal(response.statusCode, 400, JSON.stringify(headers));
    }
    assert.equal(await count("payments"), 0);
  });

  it("valida el cuerpo: método desconocido o faltante → 400 VALIDATION_ERROR", async () => {
    const { requestId } = await payable();
    for (const payload of [{}, { method: {} }, { method: { kind: "bitcoin" } }, { method: { kind: "card", paymentMethodId: "no-es-uuid" } }]) {
      const response = await app.inject({
        method: "POST",
        url: `/v1/ride-requests/${requestId}/payment-intents`,
        headers: { ...bearer(world.miguel), "idempotency-key": newKey() },
        payload
      });
      assert.equal(response.statusCode, 400, JSON.stringify(payload));
      assert.equal(response.json().error.code, "VALIDATION_ERROR");
    }
  });

  it("un método no ofrecido por el proveedor se rechaza", async () => {
    const limited = new StubPaymentProvider(TEST_WEBHOOK_SECRET, { chargeMethods: ["card"] });
    const limitedApp = await buildTestApp(pool, limited);
    try {
      const { requestId } = await payable();
      const response = await createIntent(limitedApp, world.miguel, requestId, "apple_pay");
      assert.equal(response.response.statusCode, 409);
      assert.equal(response.json.error.code, "PAYMENT_METHOD_NOT_AVAILABLE");
      assert.equal(limited.calls.createPaymentIntent, 0);
    } finally {
      await limitedApp.close();
    }
  });

  it("con un pago abierto no se permite otro intento (409 PAYMENT_ALREADY_OPEN)", async () => {
    const { requestId } = await payable();
    const first = await createIntent(app, world.miguel, requestId);
    assert.equal(first.response.statusCode, 201);
    const second = await createIntent(app, world.miguel, requestId, "card", newKey());
    assert.equal(second.response.statusCode, 409);
    assert.equal(second.json.error.code, "PAYMENT_ALREADY_OPEN");
    assert.equal(await count("payments"), 1);
    const ctx = await app.inject({ method: "GET", url: `/v1/ride-requests/${requestId}/payment`, headers: bearer(world.miguel) });
    assert.equal(ctx.json().canPay, false);
    assert.equal(ctx.json().cannotPayReason.code, "PAYMENT_ALREADY_OPEN");
    assert.equal(ctx.json().payment.id, first.json.payment.id);
  });

  it("sin tarifa aprobada no hay importe: 409 PAYMENT_AMOUNT_NOT_DEFINED y no se llama al proveedor", async () => {
    const trip = await seedTrip(pool, world);
    const { requestId } = await seedPayableRequest(pool, trip, world.miguel, { tariffId: null });
    const attempt = await createIntent(app, world.miguel, requestId);
    assert.equal(attempt.response.statusCode, 409);
    assert.equal(attempt.json.error.code, "PAYMENT_AMOUNT_NOT_DEFINED");
    assert.equal(stub.calls.createPaymentIntent, 0);
    // Una cotización ligada a una tarifa en BORRADOR tampoco cuenta como importe definido.
    const draft = await draftTariff(pool);
    await addQuote(pool, requestId, draft);
    const again = await createIntent(app, world.miguel, requestId);
    assert.equal(again.response.statusCode, 409);
    assert.equal(again.json.error.code, "PAYMENT_AMOUNT_NOT_DEFINED");
    assert.equal(await count("payments"), 0);
  });

  it("una cotización incoherente (las partes no suman el total) no se cobra", async () => {
    const tariff = await approveTariff(pool);
    const trip = await seedTrip(pool, world);
    const { requestId } = await seedPayableRequest(pool, trip, world.miguel, { tariffId: tariff, quote: { totalCents: 1500 } });
    const attempt = await createIntent(app, world.miguel, requestId);
    assert.equal(attempt.response.statusCode, 409);
    assert.equal(attempt.json.error.code, "PAYMENT_AMOUNT_NOT_DEFINED");
  });

  it("con la reserva provisional caducada → 409 HOLD_EXPIRED", async () => {
    const { requestId, holdId } = await payable();
    await pool.query(`update seat_holds set expires_at = now() - interval '1 minute' where id=$1`, [holdId]);
    const attempt = await createIntent(app, world.miguel, requestId);
    assert.equal(attempt.response.statusCode, 409);
    assert.equal(attempt.json.error.code, "HOLD_EXPIRED");
    assert.equal(stub.calls.createPaymentIntent, 0);
    const ctx = await app.inject({ method: "GET", url: `/v1/ride-requests/${requestId}/payment`, headers: bearer(world.miguel) });
    assert.equal(ctx.json().hold.status, "released");
    assert.equal(ctx.json().hold.secondsRemaining, 0);
    assert.equal(ctx.json().cannotPayReason.code, "HOLD_EXPIRED");
  });

  it("solicitud que no está pendiente de pago → 409 REQUEST_NOT_PAYABLE", async () => {
    const { requestId } = await payable();
    for (const status of ["accepted", "pending", "cancelled", "expired", "rejected"]) {
      await pool.query(`update ride_requests set status=$2::ride_request_status where id=$1`, [requestId, status]).catch(async () => {
        await pool.query(`update ride_requests set status=$2 where id=$1`, [requestId, status]);
      });
      const attempt = await createIntent(app, world.miguel, requestId);
      assert.equal(attempt.response.statusCode, 409, status);
      assert.equal(attempt.json.error.code, "REQUEST_NOT_PAYABLE", status);
    }
    assert.equal(stub.calls.createPaymentIntent, 0);
  });

  it("solo el pasajero de la solicitud: otro usuario y el conductor reciben 404 (no se filtra la existencia)", async () => {
    const { requestId } = await payable();
    for (const actor of [world.lucia, world.ana]) {
      const attempt = await createIntent(app, actor, requestId);
      assert.equal(attempt.response.statusCode, 404, actor.name);
      assert.equal(attempt.json.error.code, "REQUEST_NOT_FOUND");
      const ctx = await app.inject({ method: "GET", url: `/v1/ride-requests/${requestId}/payment`, headers: bearer(actor) });
      assert.equal(ctx.statusCode, 404, actor.name);
    }
    assert.equal(stub.calls.createPaymentIntent, 0);
  });

  it("sin sesión → 401; solicitud inexistente → 404; identificador mal formado → 400", async () => {
    const { requestId } = await payable();
    const noAuth = await app.inject({ method: "GET", url: `/v1/ride-requests/${requestId}/payment` });
    assert.equal(noAuth.statusCode, 401);
    const missing = await app.inject({
      method: "GET",
      url: "/v1/ride-requests/00000000-0000-4000-8000-000000000000/payment",
      headers: bearer(world.miguel)
    });
    assert.equal(missing.statusCode, 404);
    const malformed = await app.inject({ method: "GET", url: "/v1/ride-requests/no-es-uuid/payment", headers: bearer(world.miguel) });
    assert.equal(malformed.statusCode, 400);
    assert.equal(malformed.json().error.code, "VALIDATION_ERROR");
  });

  it("un fallo del proveedor → 502 PAYMENT_PROVIDER_ERROR, no se guarda nada y la misma clave se puede reintentar", async () => {
    const { requestId } = await payable();
    const key = newKey();
    stub.failNext = true;
    const failed = await createIntent(app, world.miguel, requestId, "card", key);
    assert.equal(failed.response.statusCode, 502);
    assert.equal(failed.json.error.code, "PAYMENT_PROVIDER_ERROR");
    assert.ok(!failed.response.body.includes("simulated"), "no se filtran detalles del proveedor");
    assert.equal(await count("payments"), 0);
    assert.equal(await count("idempotency_keys"), 0);
    const retry = await createIntent(app, world.miguel, requestId, "card", key);
    assert.equal(retry.response.statusCode, 201);
    assert.equal(await count("payments"), 1);
  });

  it("el estado del pago solo lo ve su pagador (404 para el resto) y no cambia sin eventos", async () => {
    const { requestId } = await payable();
    const { json } = await createIntent(app, world.miguel, requestId);
    const own = await app.inject({ method: "GET", url: `/v1/payments/${json.payment.id}`, headers: bearer(world.miguel) });
    assert.equal(own.statusCode, 200);
    assert.equal(own.json().status, "requires_action");
    for (const actor of [world.lucia, world.ana, world.finance]) {
      const other = await app.inject({ method: "GET", url: `/v1/payments/${json.payment.id}`, headers: bearer(actor) });
      assert.equal(other.statusCode, 404, actor.name);
      assert.equal(other.json().error.code, "PAYMENT_NOT_FOUND");
    }
    // Sondear no avanza el estado: solo lo hacen los eventos firmados del servidor
    for (let i = 0; i < 3; i++) await app.inject({ method: "GET", url: `/v1/payments/${json.payment.id}`, headers: bearer(world.miguel) });
    const still = await app.inject({ method: "GET", url: `/v1/payments/${json.payment.id}`, headers: bearer(world.miguel) });
    assert.equal(still.json().status, "requires_action");
  });
});

/* ═════════════════════════ 3. Webhook firmado ═════════════════════════ */

describe("webhook de pagos", () => {
  let app: FastifyInstance;
  let stub: StubPaymentProvider;
  beforeEach(async () => {
    stub = new StubPaymentProvider();
    app = await buildTestApp(pool, stub);
  });
  afterEach(async () => {
    await app.close();
  });

  async function openPayment(options: { capacity?: number; passenger?: "miguel" | "lucia" } = {}) {
    const tariff = await approveTariff(pool);
    const trip = await seedTrip(pool, world, { capacity: options.capacity ?? 2 });
    const passenger = options.passenger === "lucia" ? world.lucia : world.miguel;
    const { requestId, holdId } = await seedPayableRequest(pool, trip, passenger, { tariffId: tariff });
    const { json } = await createIntent(app, passenger, requestId);
    const paymentId = json.payment.id as string;
    const providerRef = await scalar<string>(pool, `select provider_payment_ref from payments where id=$1`, [paymentId]);
    return { requestId, holdId, paymentId, providerRef, tripId: trip, tariff, passenger };
  }

  async function paymentState(paymentId: string) {
    const r = await pool.query(
      `select status::text, outcome::text, collected_cents, refunded_cents, booking_id from payments where id=$1`,
      [paymentId]
    );
    return r.rows[0] as { status: string; outcome: string; collected_cents: number | null; refunded_cents: number; booking_id: string | null };
  }

  /* ── Firma ── */

  it("sin firma, firma incorrecta, cuerpo manipulado o marca de tiempo antigua → 401 y no se guarda nada", async () => {
    const { providerRef } = await openPayment();
    const event = succeededEvent(providerRef, 1100);
    const body = JSON.stringify({ events: [event] });
    const attempts: Array<[string, Record<string, string>, string]> = [
      ["sin firma", { "content-type": "application/json" }, body],
      ["secreto equivocado", signedWebhookHeaders(body, { secret: "otro-secreto" }), body],
      ["marca de tiempo antigua", signedWebhookHeaders(body, { timestampSeconds: Math.floor(Date.now() / 1000) - 3600 }), body],
      ["marca de tiempo futura", signedWebhookHeaders(body, { timestampSeconds: Math.floor(Date.now() / 1000) + 3600 }), body],
      ["cuerpo manipulado", signedWebhookHeaders(body), body.replace("1100", "1")],
      ["formato inválido", { "content-type": "application/json", "x-webhook-signature": "esto-no-es-una-firma" }, body],
      ["hex inválido", { "content-type": "application/json", "x-webhook-signature": `t=${Math.floor(Date.now() / 1000)},v1=zz` }, body]
    ];
    for (const [label, headers, payload] of attempts) {
      const response = await app.inject({ method: "POST", url: "/v1/webhooks/payments", headers, payload });
      assert.equal(response.statusCode, 401, label);
      assert.equal(response.json().error.code, "WEBHOOK_SIGNATURE_INVALID", label);
    }
    assert.equal(await count("payment_events"), 0);
    assert.equal(await count("bookings"), 0);
  });

  it("sin secreto configurado se rechaza SIEMPRE (503), aunque el cuerpo esté firmado con una clave vacía", async () => {
    const noSecret = new StubPaymentProvider(null);
    const noSecretApp = await buildTestApp(pool, noSecret);
    try {
      const body = JSON.stringify({ events: [succeededEvent("pi_any", 1100)] });
      for (const headers of [signedWebhookHeaders(body, { secret: "" }), signedWebhookHeaders(body), { "content-type": "application/json" }]) {
        const response = await noSecretApp.inject({ method: "POST", url: "/v1/webhooks/payments", headers, payload: body });
        assert.equal(response.statusCode, 503);
        assert.equal(response.json().error.code, "PAYMENTS_WEBHOOK_NOT_CONFIGURED");
      }
    } finally {
      await noSecretApp.close();
    }
  });

  it("firma válida pero cuerpo no interpretable → 400 WEBHOOK_PAYLOAD_INVALID", async () => {
    const garbage = "esto no es json";
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/payments",
      headers: signedWebhookHeaders(garbage),
      payload: garbage
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "WEBHOOK_PAYLOAD_INVALID");
    const empty = await postWebhook(app, []);
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(empty.json().results, []);
  });

  it("eventos mal formados (importe ausente/negativo/decimal, referencia vacía) → 400 y no se aplica nada", async () => {
    const { providerRef, paymentId } = await openPayment();
    const bad: StubWebhookEvent[] = [
      { id: nextEventId(), object: "payment", type: "succeeded", ref: providerRef },
      { id: nextEventId(), object: "payment", type: "succeeded", ref: providerRef, amountCents: -5 },
      { id: nextEventId(), object: "payment", type: "succeeded", ref: providerRef, amountCents: 10.5 },
      { id: nextEventId(), object: "payment", type: "succeeded", ref: "", amountCents: 1100 },
      { id: "", object: "payment", type: "succeeded", ref: providerRef, amountCents: 1100 }
    ];
    for (const event of bad) {
      const response = await postWebhook(app, [event]);
      assert.equal(response.statusCode, 400, JSON.stringify(event));
      assert.equal(response.json().error.code, "WEBHOOK_PAYLOAD_INVALID");
    }
    assert.equal((await paymentState(paymentId)).status, "requires_action");
    assert.equal(await count("payment_events"), 0);
  });

  it("el cuerpo de la petición es el crudo: un JSON con distinta serialización pero firmado sobre sus bytes se acepta", async () => {
    const { providerRef, paymentId } = await openPayment();
    const event = succeededEvent(providerRef, 1100);
    const pretty = JSON.stringify({ events: [event] }, null, 4);
    const response = await app.inject({ method: "POST", url: "/v1/webhooks/payments", headers: signedWebhookHeaders(pretty), payload: pretty });
    assert.equal(response.statusCode, 200);
    assert.equal((await paymentState(paymentId)).status, "succeeded");
  });

  /* ── Efectos de un pago correcto ── */

  it("`succeeded` firmado confirma la reserva: pago, reserva, hold, solicitud, libro mayor, recibo y avisos", async () => {
    const { requestId, holdId, paymentId, providerRef } = await openPayment();
    const response = await postWebhook(app, [succeededEvent(providerRef, 1100)]);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().results.map((r: { result: string }) => r.result), ["applied"]);

    const payment = await paymentState(paymentId);
    assert.equal(payment.status, "succeeded");
    assert.equal(payment.outcome, "booking_confirmed");
    assert.equal(payment.collected_cents, 1100);
    assert.ok(payment.booking_id);
    assert.equal(await scalar<string>(pool, `select status::text from ride_requests where id=$1`, [requestId]), "confirmed");
    assert.equal(await scalar<string>(pool, `select status::text from seat_holds where id=$1`, [holdId]), "consumed");
    assert.equal(await count("bookings", "request_id=$1", [requestId]), 1);

    // Libro mayor: el pasajero paga 11,00 €; 10,00 − 0,50 al conductor; 1,50 a plataforma; suma cero.
    assert.equal(await ledgerImbalance(), 0);
    const balances = await pool.query(`select account, user_id, sum(amount_cents)::text as cents from ledger_entries group by account, user_id order by account`);
    const byAccount = Object.fromEntries(balances.rows.map(r => [r.account, Number(r.cents)]));
    assert.equal(byAccount["passenger"], -1100);
    assert.equal(byAccount["driver_payable"], 950);
    assert.equal(byAccount["platform_revenue"], 150);

    // Recibo no fiscal
    const receipts = await pool.query(`select number, kind::text, user_id, total_cents::text from receipts`);
    assert.equal(receipts.rowCount, 1);
    assert.match(receipts.rows[0].number, /^MVC-J-\d{4}-\d{6}$/);
    assert.equal(receipts.rows[0].kind, "payment");
    assert.equal(receipts.rows[0].user_id, world.miguel.id);
    assert.equal(receipts.rows[0].total_cents, "1100");

    // Avisos: pasajero y conductor
    const kinds = await pool.query(`select user_id, kind from notifications order by kind`);
    assert.ok(kinds.rows.some(n => n.user_id === world.miguel.id && n.kind === "payment_confirmed"));
    assert.ok(kinds.rows.some(n => n.user_id === world.ana.id && n.kind === "booking_confirmed"));

    // El pasajero lo ve por la API
    const view = await app.inject({ method: "GET", url: `/v1/payments/${paymentId}`, headers: bearer(world.miguel) });
    assert.equal(view.json().status, "succeeded");
    assert.equal(view.json().bookingId, payment.booking_id);
  });

  it("evento duplicado (mismo id) → `duplicate` y NINGÚN efecto repetido", async () => {
    const { providerRef, paymentId } = await openPayment();
    const event = succeededEvent(providerRef, 1100);
    const first = await postWebhook(app, [event]);
    const second = await postWebhook(app, [event]);
    assert.equal(first.json().results[0].result, "applied");
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().results[0].result, "duplicate");
    assert.equal(await count("bookings"), 1);
    assert.equal(await count("ledger_transactions"), 1);
    assert.equal(await count("receipts"), 1);
    assert.equal(await count("notifications", "kind=$1", ["payment_confirmed"]), 1);
    assert.equal(await count("payment_events"), 1);
    assert.equal((await paymentState(paymentId)).status, "succeeded");
  });

  it("el mismo pago notificado dos veces con ids distintos no duplica la reserva ni el asiento contable", async () => {
    const { providerRef } = await openPayment();
    await postWebhook(app, [succeededEvent(providerRef, 1100)]);
    const again = await postWebhook(app, [succeededEvent(providerRef, 1100)]);
    assert.equal(again.json().results[0].result, "ignored");
    assert.equal(again.json().results[0].reason, "stale");
    assert.equal(await count("bookings"), 1);
    assert.equal(await count("ledger_transactions"), 1);
    assert.equal(await count("receipts"), 1);
    assert.equal(await count("payment_compensations"), 0);
  });

  it("peticiones simultáneas con el MISMO evento: una aplica, el resto es duplicado; una sola reserva", async () => {
    const { providerRef } = await openPayment();
    const event = succeededEvent(providerRef, 1100);
    const responses = await Promise.all(Array.from({ length: 8 }, () => postWebhook(app, [event])));
    assert.ok(responses.every(r => r.statusCode === 200));
    const results = responses.map(r => r.json().results[0].result as string).sort();
    assert.deepEqual(results, ["applied", ...Array(7).fill("duplicate")]);
    assert.equal(await count("bookings"), 1);
    assert.equal(await count("ledger_transactions"), 1);
    assert.equal(await ledgerImbalance(), 0);
  });

  it("peticiones simultáneas con eventos DISTINTOS del mismo pago: una sola reserva, sin saldo duplicado", async () => {
    const { providerRef } = await openPayment();
    const responses = await Promise.all(Array.from({ length: 6 }, () => postWebhook(app, [succeededEvent(providerRef, 1100)])));
    assert.ok(responses.every(r => r.statusCode === 200));
    assert.equal(await count("bookings"), 1);
    assert.equal(await count("ledger_transactions", "kind=$1", ["charge"]), 1);
    assert.equal(await count("receipts"), 1);
    assert.equal(await ledgerImbalance(), 0);
  });

  /* ── Orden de eventos ── */

  it("fuera de orden: `processing` y `requires_action` tardíos tras `succeeded` se ignoran", async () => {
    const { providerRef, paymentId } = await openPayment();
    await postWebhook(app, [succeededEvent(providerRef, 1100)]);
    const late = await postWebhook(app, [
      { id: nextEventId(), object: "payment", type: "processing", ref: providerRef },
      { id: nextEventId(), object: "payment", type: "requires_action", ref: providerRef }
    ]);
    assert.deepEqual(late.json().results.map((r: { result: string; reason: string }) => [r.result, r.reason]), [["ignored", "stale"], ["ignored", "stale"]]);
    assert.equal((await paymentState(paymentId)).status, "succeeded");
  });

  it("fuera de orden: `failed` o `expired` posteriores a `succeeded` NO retroceden el pago (conflicto registrado)", async () => {
    const { providerRef, paymentId } = await openPayment();
    await postWebhook(app, [succeededEvent(providerRef, 1100)]);
    const late = await postWebhook(app, [
      { id: nextEventId(), object: "payment", type: "failed", ref: providerRef, failureCode: "card_declined" },
      { id: nextEventId(), object: "payment", type: "expired", ref: providerRef }
    ]);
    assert.deepEqual(late.json().results.map((r: { result: string; reason: string }) => [r.result, r.reason]), [["ignored", "conflict"], ["ignored", "conflict"]]);
    const state = await paymentState(paymentId);
    assert.equal(state.status, "succeeded");
    assert.equal(state.outcome, "booking_confirmed");
    assert.ok(state.booking_id);
    const stored = await pool.query(`select event_type, outcome from payment_events where event_type in ('failed','expired') order by event_type`);
    assert.deepEqual(stored.rows.map(r => r.outcome), ["ignored_conflict", "ignored_conflict"]);
  });

  it("`succeeded` llega ANTES que `processing`: el pago acaba `succeeded` y `processing` se ignora", async () => {
    const { providerRef, paymentId } = await openPayment();
    const response = await postWebhook(app, [
      succeededEvent(providerRef, 1100),
      { id: nextEventId(), object: "payment", type: "processing", ref: providerRef }
    ]);
    assert.deepEqual(response.json().results.map((r: { result: string }) => r.result), ["applied", "ignored"]);
    assert.equal((await paymentState(paymentId)).status, "succeeded");
  });

  it("`processing` normal avanza el pago; un `processing` repetido se ignora", async () => {
    const { providerRef, paymentId } = await openPayment();
    const first = await postWebhook(app, [{ id: nextEventId(), object: "payment", type: "processing", ref: providerRef }]);
    assert.equal(first.json().results[0].result, "applied");
    assert.equal((await paymentState(paymentId)).status, "processing");
    const second = await postWebhook(app, [{ id: nextEventId(), object: "payment", type: "processing", ref: providerRef }]);
    assert.equal(second.json().results[0].result, "ignored");
    const view = await app.inject({ method: "GET", url: `/v1/payments/${paymentId}`, headers: bearer(world.miguel) });
    assert.equal(view.json().status, "processing");
    assert.equal(await count("bookings"), 0, "processing no confirma nada");
  });

  it("`failed`: el pago falla, la reserva NO se crea, el motivo se guarda saneado y se puede reintentar", async () => {
    const { requestId, providerRef, paymentId, holdId } = await openPayment();
    const response = await postWebhook(app, [
      { id: nextEventId(), object: "payment", type: "failed", ref: providerRef, failureCode: "Card Declined!" }
    ]);
    assert.equal(response.json().results[0].result, "applied");
    const state = await paymentState(paymentId);
    assert.equal(state.status, "failed");
    assert.equal(state.outcome, "failed");
    const code = await scalar<string>(pool, `select failure_code from payments where id=$1`, [paymentId]);
    assert.match(code, /^[a-z0-9_.-]+$/);
    assert.equal(await count("bookings"), 0);
    assert.equal(await scalar<string>(pool, `select status::text from seat_holds where id=$1`, [holdId]), "active");
    assert.equal(await scalar<string>(pool, `select status::text from ride_requests where id=$1`, [requestId]), "payment_pending");
    const retry = await createIntent(app, world.miguel, requestId, "card", newKey());
    assert.equal(retry.response.statusCode, 201, "tras un fallo se puede pagar de nuevo mientras dure la reserva provisional");
    assert.notEqual(retry.json.payment.id, paymentId);
  });

  it("`expired` marca el pago como caducado y libera el intento", async () => {
    const { requestId, providerRef, paymentId } = await openPayment();
    await postWebhook(app, [{ id: nextEventId(), object: "payment", type: "expired", ref: providerRef }]);
    assert.equal((await paymentState(paymentId)).status, "expired");
    const retry = await createIntent(app, world.miguel, requestId, "card", newKey());
    assert.equal(retry.response.statusCode, 201);
  });

  it("`failed` seguido de `succeeded` real (el cobro llegó): el dinero cobrado manda y se confirma la reserva", async () => {
    const { requestId, providerRef, paymentId } = await openPayment();
    await postWebhook(app, [{ id: nextEventId(), object: "payment", type: "failed", ref: providerRef, failureCode: "timeout" }]);
    const response = await postWebhook(app, [succeededEvent(providerRef, 1100)]);
    assert.equal(response.json().results[0].result, "applied");
    const state = await paymentState(paymentId);
    assert.equal(state.status, "succeeded");
    assert.equal(state.outcome, "booking_confirmed");
    assert.equal(await scalar<string>(pool, `select status::text from ride_requests where id=$1`, [requestId]), "confirmed");
  });

  /* ── Pago tardío y sin sobre-reserva ── */

  it("PAGO TARDÍO (reserva provisional caducada): se cobra pero NO se crea reserva; compensación + propuesta de devolución íntegra", async () => {
    const { requestId, holdId, providerRef, paymentId } = await openPayment();
    await pool.query(`update seat_holds set expires_at = now() - interval '2 minutes' where id=$1`, [holdId]);
    const response = await postWebhook(app, [succeededEvent(providerRef, 1100)]);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().results[0].result, "applied");
    assert.equal(response.json().results[0].reason, "compensation_created");

    const state = await paymentState(paymentId);
    assert.equal(state.status, "succeeded");
    assert.equal(state.outcome, "late_payment");
    assert.equal(state.booking_id, null);
    assert.equal(await count("bookings"), 0, "NO hay reserva");
    assert.equal(await scalar<string>(pool, `select status::text from ride_requests where id=$1`, [requestId]), "payment_late");
    assert.equal(await scalar<string>(pool, `select status::text from seat_holds where id=$1`, [holdId]), "released");

    const compensation = await pool.query(`select * from payment_compensations where request_id=$1`, [requestId]);
    assert.equal(compensation.rowCount, 1);
    assert.equal(compensation.rows[0].status, "pending");

    const refund = await pool.query(`select origin, status, paid_cents, proposed_cents, approved_cents, decision_basis, policy_status from refund_requests where payment_id=$1`, [paymentId]);
    assert.equal(refund.rowCount, 1);
    assert.equal(refund.rows[0].origin, "late_payment");
    assert.equal(refund.rows[0].status, "pending_review", "ningún reembolso automático: lo decide Finanzas");
    assert.equal(refund.rows[0].paid_cents, 1100);
    assert.equal(refund.rows[0].proposed_cents, 1100);
    assert.equal(refund.rows[0].approved_cents, null);
    assert.equal(refund.rows[0].decision_basis, null, "la base de la decisión se fija al decidir, no al proponer");
    assert.equal(refund.rows[0].policy_status, "pending_review");

    // Dinero cobrado sin reserva: queda en suspenso, no como ingreso ni deuda con el conductor
    assert.equal(await ledgerImbalance(), 0);
    const accounts = await pool.query(`select account, sum(amount_cents)::text as cents from ledger_entries group by account order by account`);
    const byAccount = Object.fromEntries(accounts.rows.map(r => [r.account, Number(r.cents)]));
    assert.equal(byAccount["suspense"], 1100);
    assert.equal(byAccount["passenger"], -1100);
    assert.equal(byAccount["platform_revenue"], undefined);
    assert.equal(byAccount["driver_payable"], undefined);
    assert.equal(await count("receipts", "kind=$1", ["payment"]), 0, "sin reserva no hay justificante de viaje");

    // El pasajero ve «pendiente de devolución» y se le avisa
    assert.equal(await count("notifications", "user_id=$1 and kind=$2", [world.miguel.id, "payment_late_refund_pending"]), 1);
    const view = await app.inject({ method: "GET", url: `/v1/payments/${paymentId}`, headers: bearer(world.miguel) });
    assert.equal(view.json().outcome, "late_payment");
    assert.equal(view.json().bookingId, null);
  });

  it("pago tardío con la solicitud ya expirada → `late_payment`, solicitud `payment_late`, compensación y propuesta íntegra", async () => {
    const { requestId, providerRef, paymentId } = await openPayment();
    await pool.query(`update ride_requests set status='expired' where id=$1`, [requestId]);
    await pool.query(`update seat_holds set status='released' where request_id=$1`, [requestId]);
    const response = await postWebhook(app, [succeededEvent(providerRef, 1100)]);
    assert.equal(response.json().results[0].reason, "compensation_created");
    assert.equal((await paymentState(paymentId)).outcome, "late_payment");
    assert.equal(await scalar<string>(pool, `select status::text from ride_requests where id=$1`, [requestId]), "payment_late");
    assert.equal(await count("bookings"), 0);
    assert.equal(await count("payment_compensations"), 1);
    assert.equal(await count("refund_requests", "origin=$1 and status=$2", ["late_payment", "pending_review"]), 1);
  });

  it("pago tardío con la solicitud CANCELADA → `request_not_payable`: compensación y devolución propuesta, la solicitud sigue cancelada", async () => {
    const { requestId, providerRef, paymentId } = await openPayment();
    await pool.query(`update ride_requests set status='cancelled' where id=$1`, [requestId]);
    await pool.query(`update seat_holds set status='released' where request_id=$1`, [requestId]);
    const response = await postWebhook(app, [succeededEvent(providerRef, 1100)]);
    assert.equal(response.json().results[0].reason, "compensation_created");
    assert.equal((await paymentState(paymentId)).outcome, "request_not_payable");
    assert.equal(await scalar<string>(pool, `select status::text from ride_requests where id=$1`, [requestId]), "cancelled");
    assert.equal(await count("bookings"), 0);
    const refund = await pool.query(`select origin, status, proposed_cents from refund_requests where payment_id=$1`, [paymentId]);
    assert.deepEqual(refund.rows.map(r => [r.origin, r.status, r.proposed_cents]), [["late_payment", "pending_review", 1100]]);
  });

  it("SIN SOBRE-RESERVA: con 1 plaza, el pago tardío del primero no desplaza al segundo, que ya reservó", async () => {
    const tariff = await approveTariff(pool);
    const trip = await seedTrip(pool, world, { capacity: 1 });
    const miguel = await seedPayableRequest(pool, trip, world.miguel, { tariffId: tariff, from: 0, to: 2 });
    const { json: miguelIntent } = await createIntent(app, world.miguel, miguel.requestId);
    const miguelRef = await scalar<string>(pool, `select provider_payment_ref from payments where id=$1`, [miguelIntent.payment.id]);
    // La reserva provisional de Miguel caduca; la plaza queda libre y la coge Lucía, que paga a tiempo.
    await pool.query(`update seat_holds set status='released', expires_at = now() - interval '1 minute' where id=$1`, [miguel.holdId]);
    await pool.query(`update ride_requests set status='expired' where id=$1`, [miguel.requestId]);
    const lucia = await seedPayableRequest(pool, trip, world.lucia, { tariffId: tariff, from: 0, to: 2 });
    const luciaPaid = await payRequest(pool, app, world.lucia, lucia.requestId);
    assert.ok(luciaPaid.bookingId);

    // Llega tarde el pago de Miguel
    const late = await postWebhook(app, [succeededEvent(miguelRef, 1100)]);
    assert.equal(late.statusCode, 200);
    assert.equal(late.json().results[0].reason, "compensation_created");
    const bookingsOnTrip = `select count(*)::text from bookings b join ride_requests r on r.id=b.request_id where r.trip_id=$1`;
    assert.equal(Number(await scalar<string>(pool, bookingsOnTrip, [trip])), 1, "una sola reserva para una sola plaza");
    assert.equal(
      await scalar<string>(pool, `select r.passenger_user_id from bookings b join ride_requests r on r.id=b.request_id where r.trip_id=$1`, [trip]),
      world.lucia.id
    );
    assert.equal(await count("payment_compensations"), 1);
    assert.equal(await ledgerImbalance(), 0);
  });

  it("SIN SOBRE-RESERVA bajo concurrencia: dos cobros del MISMO intento de reserva llegan a la vez → una reserva y una compensación", async () => {
    const { requestId, providerRef: firstRef } = await openPayment();
    // El primer intento caduca, el pasajero abre un segundo; ambos cobros acaban llegando casi a la vez.
    await postWebhook(app, [{ id: nextEventId(), object: "payment", type: "expired", ref: firstRef }]);
    const second = await createIntent(app, world.miguel, requestId, "card", newKey());
    const secondRef = await scalar<string>(pool, `select provider_payment_ref from payments where id=$1`, [second.json.payment.id]);
    const responses = await Promise.all([
      postWebhook(app, [succeededEvent(firstRef, 1100)]),
      postWebhook(app, [succeededEvent(secondRef, 1100)])
    ]);
    assert.ok(responses.every(r => r.statusCode === 200), responses.map(r => r.body).join("\n"));
    assert.equal(await count("bookings"), 1, "nunca dos reservas para una solicitud");
    assert.equal(await count("payment_compensations"), 1);
    assert.equal(await count("ledger_transactions", "kind=$1", ["charge"]), 1);
    assert.equal(await count("ledger_transactions", "kind=$1", ["charge_unallocated"]), 1);
    assert.equal(await ledgerImbalance(), 0);
    const outcomes = await pool.query(`select outcome::text from payments order by outcome`);
    assert.deepEqual(outcomes.rows.map(r => r.outcome), ["booking_confirmed", "duplicate_payment"]);
  });

  it("DUPLICADO: un segundo cobro de una solicitud ya reservada genera compensación con devolución propuesta", async () => {
    const { requestId, providerRef: firstRef, paymentId: firstId } = await openPayment();
    // Primer intento: caduca en el proveedor, el pasajero reintenta y paga el segundo.
    await postWebhook(app, [{ id: nextEventId(), object: "payment", type: "expired", ref: firstRef }]);
    const second = await createIntent(app, world.miguel, requestId, "card", newKey());
    assert.equal(second.response.statusCode, 201);
    const secondRef = await scalar<string>(pool, `select provider_payment_ref from payments where id=$1`, [second.json.payment.id]);
    await postWebhook(app, [succeededEvent(secondRef, 1100)]);
    assert.equal(await count("bookings"), 1);

    // El primer cobro "caducado" resulta haber salido adelante: llega su `succeeded`.
    const dup = await postWebhook(app, [succeededEvent(firstRef, 1100)]);
    assert.equal(dup.json().results[0].reason, "compensation_created");
    assert.equal(await count("bookings"), 1, "sigue habiendo UNA reserva");
    const first = await paymentState(firstId);
    assert.equal(first.outcome, "duplicate_payment");
    assert.equal(first.booking_id, null);
    const refund = await pool.query(`select origin, status, proposed_cents from refund_requests where payment_id=$1`, [firstId]);
    assert.equal(refund.rowCount, 1);
    assert.equal(refund.rows[0].status, "pending_review");
    assert.equal(refund.rows[0].proposed_cents, 1100);
    assert.equal(await ledgerImbalance(), 0);
  });

  it("IMPORTE DISTINTO: lo cobrado no coincide con la cotización → revisión manual, sin reserva ni propuesta automática", async () => {
    const { requestId, providerRef, paymentId } = await openPayment();
    const response = await postWebhook(app, [succeededEvent(providerRef, 1000)]);
    assert.equal(response.json().results[0].reason, "compensation_created");
    const state = await paymentState(paymentId);
    assert.equal(state.outcome, "amount_mismatch");
    assert.equal(state.collected_cents, 1000, "se registra lo realmente cobrado");
    assert.equal(await count("bookings"), 0);
    assert.equal(await scalar<string>(pool, `select status::text from ride_requests where id=$1`, [requestId]), "payment_pending");
    const refund = await pool.query(`select status, paid_cents, proposed_cents from refund_requests where payment_id=$1`, [paymentId]);
    assert.equal(refund.rowCount, 1);
    assert.equal(refund.rows[0].status, "pending_review");
    assert.equal(refund.rows[0].paid_cents, 1000);
    assert.equal(refund.rows[0].proposed_cents, null, "sin propuesta automática en un descuadre");
    assert.equal(await ledgerImbalance(), 0);
    assert.equal(await count("notifications", "user_id=$1 and kind=$2", [world.miguel.id, "payment_under_review"]), 1);
  });

  it("MONEDA distinta de EUR → también revisión manual (no se confirma)", async () => {
    const { providerRef, paymentId } = await openPayment();
    await postWebhook(app, [succeededEvent(providerRef, 1100, { currency: "USD" })]);
    assert.equal((await paymentState(paymentId)).outcome, "amount_mismatch");
    assert.equal(await count("bookings"), 0);
  });

  it("objeto DESCONOCIDO → 409 PAYMENT_UNKNOWN sin guardar el evento; el reintento tras existir el intento se aplica", async () => {
    const tariff = await approveTariff(pool);
    const trip = await seedTrip(pool, world);
    const { requestId } = await seedPayableRequest(pool, trip, world.miguel, { tariffId: tariff });
    // El proveedor entrega el evento antes de que este servidor haya guardado el intento (carrera real); la primera referencia
    // que genera el proveedor de pruebas es `pi_stub_1`.
    const event = succeededEvent("pi_stub_1", 1100);
    const unknown = await postWebhook(app, [event]);
    assert.equal(unknown.statusCode, 409);
    assert.equal(unknown.json().error.code, "PAYMENT_UNKNOWN");
    assert.equal(await count("payment_events"), 0, "el evento no queda marcado como visto: el proveedor reintentará");
    assert.equal(await count("bookings"), 0);

    const { response } = await createIntent(app, world.miguel, requestId);
    assert.equal(response.statusCode, 201);
    const retried = await postWebhook(app, [event]);
    assert.equal(retried.statusCode, 200);
    assert.equal(retried.json().results[0].result, "applied");
    assert.equal(await count("bookings"), 1);
    assert.equal(await count("payment_events"), 1);
  });

  it("un evento normalizado con otro proveedor distinto del configurado → 400 y no se aplica", async () => {
    const mismatch = Object.assign(Object.create(stub), {
      verifyAndParseWebhook: (raw: Buffer, headers: Record<string, string | string[] | undefined>) =>
        stub.verifyAndParseWebhook(raw, headers).map(e => ({ ...e, provider: "otro-proveedor" }))
    }) as StubPaymentProvider;
    const mismatchApp = await buildTestApp(pool, mismatch);
    try {
      const response = await postWebhook(mismatchApp, [succeededEvent("pi_stub_1", 1100)]);
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error.code, "WEBHOOK_PAYLOAD_INVALID");
      assert.equal(await count("payment_events"), 0);
    } finally {
      await mismatchApp.close();
    }
  });

  it("un lote con varios eventos se procesa en orden y cada uno es atómico", async () => {
    const { providerRef, paymentId } = await openPayment();
    const response = await postWebhook(app, [
      { id: nextEventId(), object: "payment", type: "processing", ref: providerRef },
      succeededEvent(providerRef, 1100),
      { id: nextEventId(), object: "payment", type: "failed", ref: providerRef }
    ]);
    assert.deepEqual(response.json().results.map((r: { result: string; reason?: string }) => [r.result, r.reason ?? null]), [
      ["applied", null],
      ["applied", null],
      ["ignored", "conflict"]
    ]);
    assert.equal((await paymentState(paymentId)).status, "succeeded");
  });

  it("el webhook no exige sesión (servidor a servidor) y no acepta peticiones sin cuerpo", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/webhooks/payments" });
    assert.ok([400, 401].includes(response.statusCode), `status ${response.statusCode}`);
    assert.equal(await count("payment_events"), 0);
  });

  it("el cuerpo del webhook tiene límite de tamaño (413)", async () => {
    const huge = "x".repeat(300 * 1024);
    const response = await app.inject({ method: "POST", url: "/v1/webhooks/payments", headers: signedWebhookHeaders(huge), payload: huge });
    assert.equal(response.statusCode, 413);
  });
});

/* ═════════════════════════ 4. Autorización de datos de pago ═════════════════════════ */

describe("autorización: nadie ve los pagos de otros", () => {
  let app: FastifyInstance;
  let stub: StubPaymentProvider;
  beforeEach(async () => {
    stub = new StubPaymentProvider();
    app = await buildTestApp(pool, stub);
  });
  afterEach(async () => {
    await app.close();
  });

  it("pagos, resúmenes, recibos y métodos son por usuario; el conductor ve sus cobros, no el pago del pasajero", async () => {
    const tariff = await approveTariff(pool);
    const trip = await seedTrip(pool, world);
    const { requestId } = await seedPayableRequest(pool, trip, world.miguel, { tariffId: tariff });
    const { paymentId, bookingId } = await payRequest(pool, app, world.miguel, requestId);

    const receiptId = await scalar<string>(pool, `select id from receipts where payment_id=$1`, [paymentId]);

    // Miguel lo ve todo
    const mine = await app.inject({ method: "GET", url: "/v1/me/payments", headers: bearer(world.miguel) });
    assert.equal(mine.statusCode, 200);
    assert.ok(mine.json().items.length >= 1);
    const ownReceipt = await app.inject({ method: "GET", url: `/v1/me/receipts/${receiptId}`, headers: bearer(world.miguel) });
    assert.equal(ownReceipt.statusCode, 200);

    // Lucía y los administradores no ven nada por las rutas personales
    for (const actor of [world.lucia, world.finance, world.admin, world.support]) {
      const list = await app.inject({ method: "GET", url: "/v1/me/payments", headers: bearer(actor) });
      assert.equal(list.statusCode, 200);
      assert.deepEqual(list.json().items, [], `${actor.name} no tiene pagos propios`);
      const receipt = await app.inject({ method: "GET", url: `/v1/me/receipts/${receiptId}`, headers: bearer(actor) });
      assert.equal(receipt.statusCode, 404, actor.name);
      const printable = await app.inject({ method: "GET", url: `/v1/me/receipts/${receiptId}/printable`, headers: bearer(actor) });
      assert.equal(printable.statusCode, 404, actor.name);
      const payment = await app.inject({ method: "GET", url: `/v1/payments/${paymentId}`, headers: bearer(actor) });
      assert.equal(payment.statusCode, 404, actor.name);
      const preview = await app.inject({ method: "GET", url: `/v1/bookings/${bookingId}/cancellation-preview`, headers: bearer(actor) });
      assert.equal(preview.statusCode, 404, actor.name);
    }

    // El conductor ve el cobro en sus ganancias, nunca el pago ni el justificante del pasajero
    const earnings = await app.inject({ method: "GET", url: "/v1/me/earnings", headers: bearer(world.ana) });
    assert.equal(earnings.statusCode, 200);
    assert.equal(earnings.json().items.length, 1);
    const driverPayments = await app.inject({ method: "GET", url: "/v1/me/payments", headers: bearer(world.ana) });
    assert.deepEqual(driverPayments.json().items, []);
    const driverReceipt = await app.inject({ method: "GET", url: `/v1/me/receipts/${receiptId}`, headers: bearer(world.ana) });
    assert.equal(driverReceipt.statusCode, 404);
  });

  it("los métodos de pago de un usuario no se pueden borrar ni ver por otro", async () => {
    const add = await app.inject({
      method: "POST",
      url: "/v1/me/payment-methods",
      headers: { ...bearer(world.miguel), "idempotency-key": newKey() },
      payload: { purpose: "charge", providerToken: "tok_card_visa_4242" }
    });
    assert.equal(add.statusCode, 201);
    const methodId = add.json().id as string;
    assert.equal(add.json().last4, "4242");
    assert.equal(add.json().maskedLabel.includes("4242"), true);
    const listOther = await app.inject({ method: "GET", url: "/v1/me/payment-methods", headers: bearer(world.lucia) });
    assert.deepEqual(listOther.json().items, []);
    const del = await app.inject({ method: "DELETE", url: `/v1/me/payment-methods/${methodId}`, headers: bearer(world.lucia) });
    assert.equal(del.statusCode, 404);
    assert.equal(await count("payment_methods", "status<>$1", ["removed"]), 1);
    const delOwn = await app.inject({ method: "DELETE", url: `/v1/me/payment-methods/${methodId}`, headers: bearer(world.miguel) });
    assert.equal(delOwn.statusCode, 200);
    assert.deepEqual(delOwn.json(), { removed: true });
    assert.deepEqual(stub.detached, ["pm_tok_card_visa_4242"]);
  });

  it("todas las rutas personales exigen sesión (401 sin Bearer)", async () => {
    const routes: Array<[string, string]> = [
      ["GET", "/v1/me/payments"],
      ["GET", "/v1/me/payments/passenger-summary"],
      ["GET", "/v1/me/payments/driver-summary"],
      ["GET", "/v1/me/earnings"],
      ["GET", "/v1/me/payment-methods"],
      ["GET", "/v1/me/receipts"],
      ["GET", "/v1/me/payouts"],
      ["GET", "/v1/me/refunds"],
      ["GET", "/v1/me/plan"],
      ["GET", "/v1/admin/refund-proposals"],
      ["GET", "/v1/admin/payout-runs"]
    ];
    for (const [method, url] of routes) {
      const response = await app.inject({ method: method as "GET", url });
      assert.equal(response.statusCode, 401, `${method} ${url}`);
      assert.equal(response.json().error.code, "AUTH_REQUIRED", `${method} ${url}`);
    }
  });
});

// El valor TEST_QUOTE se importa para documentar las cifras de prueba usadas en este fichero.
assertTestQuote();
function assertTestQuote(): void {
  assert.equal(TEST_QUOTE.totalCents, TEST_QUOTE.contributionCents + TEST_QUOTE.passengerCommissionCents + TEST_QUOTE.processingCents + TEST_QUOTE.taxesCents);
}
