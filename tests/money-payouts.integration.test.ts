/**
 * Módulo money · liquidaciones mensuales a conductores (pantalla 33 «Liquidación mensual» y panel de finanzas) y métodos de pago.
 *
 * Importes: fixtures de prueba (no son tarifas). El proveedor es el `StubPaymentProvider` de pruebas; el abono solo pasa a
 * `paid` con un evento firmado del proveedor.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { DisabledPaymentProvider } from "../src/modules/money/provider/disabled.js";
import {
  accountNet,
  apiCall,
  buildTestApp,
  completeTrip,
  countRows,
  createActor,
  createTestPool,
  ensureTariff,
  ledgerImbalance,
  newKey,
  paidBooking,
  payoutEvent,
  postWebhook,
  providerPayoutRef,
  resetMoneyData,
  scalar,
  seedPayableRequest,
  seedTrip,
  seedWorld,
  StubPaymentProvider,
  succeededEvent,
  TEST_QUOTE,
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

const generate = (period: string, key: string = newKey(), target: FastifyInstance = app, actor: Actor | null = world.finance) =>
  apiCall(target, actor, "POST", "/v1/admin/payout-runs", { period }, key);
const executeRun = (payoutId: string, key: string = newKey(), target: FastifyInstance = app) =>
  apiCall(target, world.finance, "POST", `/v1/admin/payout-runs/${payoutId}/execute`, undefined, key);
const addPayoutAccount = (actor: Actor, token = "tok_iban_4589") =>
  apiCall(app, actor, "POST", "/v1/me/payment-methods", { purpose: "payout", providerToken: token });

/** Una segunda conductora con su vehículo; sirve de `world` para `paidBooking`. */
async function secondDriverWorld(): Promise<World> {
  const pedro = await createActor(pool, "Pedro Ruiz Soto", ["driver", "passenger"]);
  const vehicleId = (
    await pool.query<{ id: string }>(
      `insert into vehicles(driver_user_id,make,model,plate,passenger_seats,review_status,documentation_status,vehicle_photo_status,insurance_status,insurance_expires_on)
       values($1,'Renault','Clio','5678-DEF',3,'approved','approved','approved','approved',current_date+30) returning id`,
      [pedro.id]
    )
  ).rows[0]!.id;
  return { ...world, ana: pedro, vehicleId };
}

let passengerCounter = 0;
async function freshPassenger(): Promise<Actor> {
  passengerCounter += 1;
  return createActor(pool, `Viajero ${passengerCounter}`, ["passenger"]);
}

/** Reserva pagada cuyo viaje se completó en `completedAt`. */
async function completedBooking(completedAt: string, driverWorld: World = world, passenger?: Actor): Promise<PaidBooking> {
  const booking = await paidBooking(pool, app, driverWorld, { passenger: passenger ?? (await freshPassenger()) });
  await completeTrip(pool, booking.tripId, completedAt);
  return booking;
}

/** Fixture SQL: devolución abierta por otro módulo (origen «other») sobre una reserva ya completada. */
async function openRefundFor(booking: PaidBooking, driverId: string): Promise<string> {
  return (
    await pool.query<{ id: string }>(
      `insert into refund_requests(origin,status,request_id,booking_id,payment_id,trip_id,passenger_user_id,driver_user_id,paid_cents,policy_status)
       values('other','pending_review',$1,$2,$3,$4,$5,$6,1100,'pending_review') returning id`,
      [booking.requestId, booking.bookingId, booking.paymentId, booking.tripId, booking.passenger.id, driverId]
    )
  ).rows[0]!.id;
}

async function approveRefund(refundId: string, approvedCents: number) {
  const result = await apiCall(app, world.finance, "POST", `/v1/admin/refund-proposals/${refundId}/approve`, {
    approvedCents,
    note: "Prueba de liquidaciones"
  });
  assert.equal(result.response.statusCode, 200, result.response.body);
}

/** Genera, registra la cuenta, pide el abono y confirma con evento firmado. Devuelve el id de la liquidación. */
async function payOut(period: string, driver: Actor = world.ana, expectedCents?: number): Promise<string> {
  const generated = await generate(period);
  assert.equal(generated.response.statusCode, 201, generated.response.body);
  const run = (generated.json.created as any[]).find(r => r.driver.id === driver.id);
  assert.ok(run, `sin liquidación para ${driver.name}`);
  if ((await apiCall(app, driver, "GET", "/v1/me/payment-methods?purpose=payout")).json.items.length === 0) {
    assert.equal((await addPayoutAccount(driver)).response.statusCode, 201);
  }
  const executed = await executeRun(run.id);
  assert.equal(executed.response.statusCode, 200, executed.response.body);
  const ref = await providerPayoutRef(pool, run.id);
  const hook = await postWebhook(app, [payoutEvent("paid", ref, expectedCents ?? run.net.cents)]);
  assert.equal(hook.statusCode, 200, hook.body);
  assert.equal(hook.json().results[0].result, "applied");
  return run.id as string;
}

/* ═════════════════════════ Generación de liquidaciones ═════════════════════════ */

describe("Liquidaciones: generación mensual (panel de finanzas)", () => {
  it("una liquidación borrador por conductora y mes con solo las reservas COMPLETADAS de ese mes natural de Madrid", async () => {
    const pedroWorld = await secondDriverWorld();
    const pedro = pedroWorld.ana;
    const julyA = await completedBooking("2026-07-05T10:00:00Z");
    const julyB = await completedBooking("2026-07-20T10:00:00Z");
    // frontera de mes en Europe/Madrid (UTC+2 en verano): 22:30Z del 30/06 ya es 01/07 en Madrid; 22:30Z del 31/07 ya es 01/08
    const boundaryIn = await completedBooking("2026-06-30T22:30:00Z");
    const boundaryOut = await completedBooking("2026-07-31T22:30:00Z");
    const june = await completedBooking("2026-06-15T10:00:00Z");
    const notCompleted = await paidBooking(pool, app, world, { passenger: await freshPassenger() });
    const cancelled = await paidBooking(pool, app, world, { passenger: await freshPassenger() });
    assert.equal((await apiCall(app, cancelled.passenger, "POST", `/v1/bookings/${cancelled.bookingId}/cancel`, { reason: "other" })).response.statusCode, 200);
    const pedroJuly = await completedBooking("2026-07-12T10:00:00Z", pedroWorld);

    const generated = await generate("2026-07");
    assert.equal(generated.response.statusCode, 201, generated.response.body);
    assert.equal(generated.json.period, "2026-07");
    assert.equal(generated.json.skipped, 0);
    const created = generated.json.created as any[];
    assert.equal(created.length, 2);

    const anaRun = created.find(r => r.driver.id === world.ana.id);
    const pedroRun = created.find(r => r.driver.id === pedro.id);
    assert.equal(anaRun.status, "draft");
    assert.equal(anaRun.period, "2026-07");
    assert.deepEqual(anaRun.net, MONEY(950 * 3), "julioA + julioB + frontera de entrada");
    assert.equal(anaRun.bookingsCount, 3);
    assert.equal(anaRun.scheduledFor, null, "el calendario de abonos no está aprobado: «Por definir»");
    assert.equal(anaRun.paidAt, null);
    assert.equal(anaRun.failureCode, null);
    assert.equal(anaRun.driver.firstName, "Ana");
    assert.deepEqual(pedroRun.net, MONEY(950));
    assert.equal(pedroRun.bookingsCount, 1);

    const items = await pool.query<{ driver_user_id: string; booking_id: string }>(
      `select r.driver_user_id, i.booking_id from payout_run_items i join payout_runs r on r.id=i.payout_run_id`
    );
    const anaItems = items.rows.filter(i => i.driver_user_id === world.ana.id).map(i => i.booking_id);
    assert.deepEqual(new Set(anaItems), new Set([julyA.bookingId, julyB.bookingId, boundaryIn.bookingId]));
    for (const excluded of [boundaryOut, june, notCompleted, cancelled]) {
      assert.ok(!items.rows.some(i => i.booking_id === excluded.bookingId), `no debe estar: ${excluded.bookingId}`);
    }
    assert.deepEqual(items.rows.filter(i => i.driver_user_id === pedro.id).map(i => i.booking_id), [pedroJuly.bookingId]);

    // el mes de agosto SÍ recoge la frontera de salida
    const august = await generate("2026-08");
    assert.equal(august.json.created.length, 1);
    assert.deepEqual(august.json.created[0].net, MONEY(950));

    assert.equal(await countRows(pool, "audit_events", "action='payout.run_created'"), 3);
    assert.equal(await ledgerImbalance(pool), 0);
    // generar no mueve dinero
    assert.equal(await countRows(pool, "ledger_transactions", "kind='payout'"), 0);
  });

  it("es idempotente: la misma clave devuelve lo mismo (replay) y otra clave no crea nada nuevo", async () => {
    await completedBooking("2026-07-05T10:00:00Z");
    const key = newKey();
    const first = await generate("2026-07", key);
    const replay = await generate("2026-07", key);
    assert.equal(first.response.statusCode, 201);
    assert.equal(replay.response.statusCode, 201);
    assert.equal(replay.response.headers["idempotency-replayed"], "true");
    assert.equal(first.response.headers["idempotency-replayed"], undefined);
    assert.deepEqual(replay.json, first.json);

    const again = await generate("2026-07");
    assert.equal(again.response.statusCode, 201);
    assert.deepEqual(again.json.created, []);
    assert.equal(await countRows(pool, "payout_runs"), 1);
    assert.equal(await countRows(pool, "payout_run_items"), 1);
  });

  it("una reserva completada DESPUÉS de generar el mes no entra en la liquidación existente (se omite la conductora)", async () => {
    await completedBooking("2026-07-05T10:00:00Z");
    assert.equal((await generate("2026-07")).json.created.length, 1);
    const late = await completedBooking("2026-07-30T10:00:00Z");
    const again = await generate("2026-07");
    assert.deepEqual(again.json.created, []);
    assert.equal(again.json.skipped, 1);
    assert.equal(await countRows(pool, "payout_run_items", "booking_id=$1", [late.bookingId]), 0);
    // sigue «Por cobrar» en el libro: el dinero no se pierde, pero necesita una liquidación de ajuste (decisión pendiente)
    const detail = await apiCall(app, world.ana, "GET", `/v1/me/earnings/${late.bookingId}`);
    assert.equal(detail.json.state, "available");
  });

  it("generaciones simultáneas del mismo periodo producen una sola liquidación por conductora", async () => {
    await completedBooking("2026-07-05T10:00:00Z");
    const results = await Promise.all([generate("2026-07"), generate("2026-07"), generate("2026-07")]);
    assert.deepEqual(results.map(r => r.response.statusCode), [201, 201, 201]);
    assert.equal(results.reduce((n, r) => n + (r.json.created as any[]).length, 0), 1);
    assert.equal(await countRows(pool, "payout_runs"), 1);
    assert.equal(await countRows(pool, "payout_run_items"), 1);
  });

  it("validación: periodo obligatorio y con formato AAAA-MM, Idempotency-Key obligatoria, otra operación con la misma clave → 422", async () => {
    for (const body of [{}, { period: "2026-13" }, { period: "julio" }, { period: "2026-7" }, { period: 202607 }]) {
      const r = await apiCall(app, world.finance, "POST", "/v1/admin/payout-runs", body as Record<string, unknown>);
      assert.equal(r.response.statusCode, 400, JSON.stringify(body));
      assert.equal(r.json.error.code, "VALIDATION_ERROR");
    }
    const noKey = await apiCall(app, world.finance, "POST", "/v1/admin/payout-runs", { period: "2026-07" }, null);
    assert.equal(noKey.response.statusCode, 400);
    assert.equal(noKey.json.error.code, "IDEMPOTENCY_KEY_REQUIRED");
    const key = newKey();
    assert.equal((await generate("2026-07", key)).response.statusCode, 201);
    const reused = await generate("2026-08", key);
    assert.equal(reused.response.statusCode, 422);
    assert.equal(reused.json.error.code, "IDEMPOTENCY_KEY_REUSED");
  });

  it("sin reservas completadas con importe positivo no se crea ninguna liquidación", async () => {
    await paidBooking(pool, app, world); // confirmada, no completada
    const r = await generate("2026-07");
    assert.deepEqual(r.json, { period: "2026-07", created: [], skipped: 0 });
    assert.equal(await countRows(pool, "payout_runs"), 0);
  });
});

/* ═════════════════════════ Vista de la conductora ═════════════════════════ */

describe("Liquidaciones: lo que ve la conductora (pantalla 33 «Liquidación mensual»)", () => {
  it("sin liquidaciones: calendario «Por definir», próximo abono sin importe y sin cuenta", async () => {
    const r = await apiCall(app, world.ana, "GET", "/v1/me/payouts");
    assert.equal(r.response.statusCode, 200, r.response.body);
    assert.deepEqual(r.json.items, []);
    assert.equal(r.json.nextCursor, null);
    assert.deepEqual(r.json.schedule, { frequency: "monthly", dayStatus: "pending_definition", dayOfMonth: null });
    assert.deepEqual(r.json.nextPayout, { status: "pending_definition", date: null, amount: MONEY(null) });
    assert.equal(r.json.payoutAccount, null);
    assert.equal(r.json.availability.enabled, true);
  });

  it("con una liquidación borrador: la lista, el próximo abono y el detalle con sus cobros «En liquidación»", async () => {
    const a = await completedBooking("2026-07-05T10:00:00Z");
    const b = await completedBooking("2026-07-20T10:00:00Z");
    const run = (await generate("2026-07")).json.created[0];
    assert.equal((await addPayoutAccount(world.ana)).response.statusCode, 201);

    const list = await apiCall(app, world.ana, "GET", "/v1/me/payouts");
    assert.equal(list.json.items.length, 1);
    assert.deepEqual(list.json.items[0], {
      id: run.id,
      period: "2026-07",
      status: "draft",
      net: MONEY(1900),
      bookingsCount: 2,
      scheduledFor: null,
      paidAt: null,
      failureCode: null,
      createdAt: run.createdAt
    });
    assert.deepEqual(list.json.nextPayout, { status: "pending_definition", date: null, amount: MONEY(1900) });
    assert.equal(list.json.payoutAccount.maskedLabel, "ES** **** **** 4589");

    const detail = await apiCall(app, world.ana, "GET", `/v1/me/payouts/${run.id}`);
    assert.equal(detail.response.statusCode, 200, detail.response.body);
    assert.equal(detail.json.id, run.id);
    assert.deepEqual(new Set(detail.json.items.map((i: any) => i.bookingId)), new Set([a.bookingId, b.bookingId]));
    assert.ok(detail.json.items.every((i: any) => i.state === "in_payout" && i.net.cents === 950));
    assert.equal(detail.json.items.reduce((n: number, i: any) => n + i.net.cents, 0), detail.json.net.cents);
  });

  it("propiedad: cada conductora solo ve sus liquidaciones; el resto, 404 (o lista vacía) y sin sesión 401", async () => {
    const pedroWorld = await secondDriverWorld();
    await completedBooking("2026-07-05T10:00:00Z");
    await completedBooking("2026-07-06T10:00:00Z", pedroWorld);
    const created = (await generate("2026-07")).json.created as any[];
    const anaRun = created.find(r => r.driver.id === world.ana.id);
    const pedroRun = created.find(r => r.driver.id === pedroWorld.ana.id);

    assert.deepEqual((await apiCall(app, world.ana, "GET", "/v1/me/payouts")).json.items.map((r: any) => r.id), [anaRun.id]);
    assert.deepEqual((await apiCall(app, pedroWorld.ana, "GET", "/v1/me/payouts")).json.items.map((r: any) => r.id), [pedroRun.id]);
    for (const other of [pedroWorld.ana, world.miguel, world.finance]) {
      const r = await apiCall(app, other, "GET", `/v1/me/payouts/${anaRun.id}`);
      assert.equal(r.response.statusCode, 404, other.name);
      assert.equal(r.json.error.code, "PAYOUT_NOT_FOUND");
    }
    assert.deepEqual((await apiCall(app, world.miguel, "GET", "/v1/me/payouts")).json.items, []);
    assert.equal((await apiCall(app, null, "GET", "/v1/me/payouts")).response.statusCode, 401);
    assert.equal((await apiCall(app, null, "GET", `/v1/me/payouts/${anaRun.id}`)).response.statusCode, 401);
    assert.equal((await apiCall(app, world.ana, "GET", "/v1/me/payouts/no-es-uuid")).response.statusCode, 400);
  });

  it("listado del panel: filtros por periodo y estado, validación y paginación", async () => {
    await completedBooking("2026-07-05T10:00:00Z");
    await completedBooking("2026-08-05T10:00:00Z");
    await completedBooking("2026-09-05T10:00:00Z");
    for (const period of ["2026-07", "2026-08", "2026-09"]) assert.equal((await generate(period)).response.statusCode, 201);

    const all = await apiCall(app, world.finance, "GET", "/v1/admin/payout-runs");
    assert.equal(all.json.items.length, 3);
    const byPeriod = await apiCall(app, world.finance, "GET", "/v1/admin/payout-runs?period=2026-08");
    assert.deepEqual(byPeriod.json.items.map((r: any) => r.period), ["2026-08"]);
    const drafts = await apiCall(app, world.finance, "GET", "/v1/admin/payout-runs?status=draft");
    assert.equal(drafts.json.items.length, 3);
    const paid = await apiCall(app, world.finance, "GET", "/v1/admin/payout-runs?status=paid");
    assert.deepEqual(paid.json.items, []);

    const one = await apiCall(app, world.finance, "GET", "/v1/admin/payout-runs?limit=2");
    assert.equal(one.json.items.length, 2);
    const two = await apiCall(app, world.finance, "GET", `/v1/admin/payout-runs?limit=2&cursor=${one.json.nextCursor}`);
    assert.equal(two.json.items.length, 1);
    assert.equal(two.json.nextCursor, null);
    assert.equal(new Set([...one.json.items, ...two.json.items].map((r: any) => r.id)).size, 3);

    for (const url of ["/v1/admin/payout-runs?period=2026-13", "/v1/admin/payout-runs?status=pagada", "/v1/admin/payout-runs?limit=500"]) {
      assert.equal((await apiCall(app, world.finance, "GET", url)).response.statusCode, 400, url);
    }
  });
});

/* ═════════════════════════ Pedir el abono al proveedor ═════════════════════════ */

describe("Liquidaciones: pedir el abono (execute)", () => {
  async function draftRun(): Promise<any> {
    await completedBooking("2026-07-05T10:00:00Z");
    return (await generate("2026-07")).json.created[0];
  }

  it("con el proveedor desactivado: 409 PAYMENTS_PROVIDER_DISABLED y la liquidación sigue en borrador", async () => {
    const run = await draftRun();
    const r = await executeRun(run.id, newKey(), disabledApp);
    assert.equal(r.response.statusCode, 409);
    assert.equal(r.json.error.code, "PAYMENTS_PROVIDER_DISABLED");
    assert.equal(await scalar<string>(pool, `select status from payout_runs where id=$1`, [run.id]), "draft");
    assert.equal(await scalar<string>(pool, `select execution_attempts::text from payout_runs where id=$1`, [run.id]), "0");
  });

  it("liquidación inexistente → 404; sin cuenta de cobro activa → 409 PAYOUT_ACCOUNT_REQUIRED", async () => {
    const run = await draftRun();
    const missing = await executeRun("6f0f1c64-9c1b-4f0e-9a3a-0f2f4c8d9e11");
    assert.equal(missing.response.statusCode, 404);
    assert.equal(missing.json.error.code, "PAYOUT_NOT_FOUND");
    const noAccount = await executeRun(run.id);
    assert.equal(noAccount.response.statusCode, 409);
    assert.equal(noAccount.json.error.code, "PAYOUT_ACCOUNT_REQUIRED");
    assert.equal(stub.calls.createPayout, 0, "no se llama al proveedor sin cuenta de destino");
  });

  it("con cuenta de cobro: pasa a «processing», una sola petición al proveedor con clave derivada, replay y reintento bloqueados", async () => {
    const run = await draftRun();
    assert.equal((await addPayoutAccount(world.ana)).response.statusCode, 201);
    const key = newKey();
    const executed = await executeRun(run.id, key);
    assert.equal(executed.response.statusCode, 200, executed.response.body);
    assert.equal(executed.json.status, "processing");
    assert.equal(executed.json.paidAt, null, "no se marca como abonada sin el evento firmado");
    assert.equal(stub.calls.createPayout, 1);
    const sent = [...stub.payouts.values()][0]!;
    assert.equal(sent.input.amountCents, 950);
    assert.equal(sent.input.destinationMethodRef, "pm_tok_iban_4589");
    assert.equal(sent.input.payoutRunId, run.id);
    assert.match(sent.input.idempotencyKey, /^mvc-payout-[0-9a-f]{40}$/);

    const replay = await executeRun(run.id, key);
    assert.equal(replay.response.headers["idempotency-replayed"], "true");
    assert.deepEqual(replay.json, executed.json);
    assert.equal(stub.calls.createPayout, 1);

    const second = await executeRun(run.id);
    assert.equal(second.response.statusCode, 409);
    assert.equal(second.json.error.code, "PAYOUT_NOT_EXECUTABLE");
    assert.equal(stub.calls.createPayout, 1);
    assert.equal(await countRows(pool, "audit_events", "action='payout.execute_requested'"), 1);
    assert.equal(await accountNet(pool, "external_payout"), 0, "pedir el abono no mueve dinero en el libro");
  });

  it("fallo del proveedor → 502 PAYMENT_PROVIDER_ERROR sin cambios; el reintento con la MISMA clave funciona", async () => {
    const run = await draftRun();
    await addPayoutAccount(world.ana);
    const key = newKey();
    stub.failNext = true;
    const failed = await executeRun(run.id, key);
    assert.equal(failed.response.statusCode, 502);
    assert.equal(failed.json.error.code, "PAYMENT_PROVIDER_ERROR");
    assert.equal(await scalar<string>(pool, `select status from payout_runs where id=$1`, [run.id]), "draft");
    assert.equal(await scalar<string>(pool, `select execution_attempts::text from payout_runs where id=$1`, [run.id]), "0");
    const retry = await executeRun(run.id, key);
    assert.equal(retry.response.statusCode, 200, retry.response.body);
    assert.equal(retry.json.status, "processing");
  });

  it("peticiones de ejecución simultáneas: el proveedor recibe una sola petición de abono", async () => {
    const run = await draftRun();
    await addPayoutAccount(world.ana);
    const results = await Promise.all([executeRun(run.id), executeRun(run.id), executeRun(run.id)]);
    assert.equal(results.filter(r => r.response.statusCode === 200).length, 1);
    assert.equal(results.filter(r => r.response.statusCode === 409).length, 2);
    assert.equal(stub.calls.createPayout, 1);
  });

  it("la cuenta de destino es la predeterminada de la conductora", async () => {
    const run = await draftRun();
    await addPayoutAccount(world.ana, "tok_iban_1111");
    await apiCall(app, world.ana, "POST", "/v1/me/payment-methods", { purpose: "payout", providerToken: "tok_iban_2222", setAsDefault: true });
    assert.equal((await executeRun(run.id)).response.statusCode, 200);
    assert.equal([...stub.payouts.values()][0]!.input.destinationMethodRef, "pm_tok_iban_2222");
  });
});

/* ═════════════════════════ Confirmación del abono (evento firmado) ═════════════════════════ */

describe("Liquidaciones: el abono solo se confirma con un evento firmado", () => {
  async function processingRun(): Promise<{ run: any; ref: string }> {
    await completedBooking("2026-07-05T10:00:00Z", world, world.miguel);
    await completedBooking("2026-07-20T10:00:00Z", world, world.lucia);
    const run = (await generate("2026-07")).json.created[0];
    await addPayoutAccount(world.ana);
    assert.equal((await executeRun(run.id)).response.statusCode, 200);
    return { run, ref: await providerPayoutRef(pool, run.id) };
  }
  /** «applied», «duplicate» o «ignored:<motivo>» (stale | conflict | unsupported). */
  const resultOf = (response: { json: () => any }): string => {
    const r = response.json().results[0] as { result: string; reason?: string };
    return r.reason ? `${r.result}:${r.reason}` : r.result;
  };

  it("payout.paid con el importe exacto: liquidación pagada, asiento, resumen de liquidación, aviso y cobros «Cobrado»", async () => {
    const { run, ref } = await processingRun();
    const hook = await postWebhook(app, [payoutEvent("paid", ref, 1900)]);
    assert.equal(hook.statusCode, 200, hook.body);
    assert.equal(resultOf(hook), "applied");

    const row = (await pool.query(`select status, paid_at, failure_code from payout_runs where id=$1`, [run.id])).rows[0];
    assert.equal(row.status, "paid");
    assert.ok(row.paid_at);
    assert.equal(row.failure_code, null);
    assert.equal(await accountNet(pool, "driver_payable", world.ana.id), 0);
    assert.equal(await accountNet(pool, "external_payout", world.ana.id), 1900);
    assert.equal(await ledgerImbalance(pool), 0);
    assert.equal(await scalar<string>(pool, `select tx_key from ledger_transactions where kind='payout'`), `payout:${run.id}`);

    const receipts = await apiCall(app, world.ana, "GET", "/v1/me/receipts?kind=earning_statement");
    assert.equal(receipts.json.items.length, 1);
    assert.deepEqual(receipts.json.items[0].total, MONEY(1900));
    assert.equal(receipts.json.items[0].counterpart, null);
    assert.equal(receipts.json.items[0].trip, null);
    const detail = await apiCall(app, world.ana, "GET", `/v1/me/receipts/${receipts.json.items[0].id}`);
    assert.deepEqual(
      detail.json.lines.map((l: any) => [l.key, l.amount.cents]),
      [["contribution", 2000], ["driver_commission", 100], ["refund_adjustments", 0], ["net", 1900]]
    );
    assert.match(detail.json.notice, /No es una factura ni una autofactura/);
    assert.equal(detail.json.fiscalInvoice, false);

    const notification = await pool.query(`select category, kind, data from notifications where user_id=$1 and kind='payout_paid'`, [world.ana.id]);
    assert.equal(notification.rowCount, 1);
    assert.equal(notification.rows[0].category, "payment");
    assert.equal(notification.rows[0].data.payoutRunId, run.id);

    const earnings = await apiCall(app, world.ana, "GET", "/v1/me/earnings?state=paid_out");
    assert.equal(earnings.json.items.length, 2);
    const mine = await apiCall(app, world.ana, "GET", "/v1/me/payouts");
    assert.equal(mine.json.items[0].status, "paid");
    assert.ok(mine.json.items[0].paidAt);
    assert.deepEqual(mine.json.nextPayout, { status: "pending_definition", date: null, amount: MONEY(null) });
    assert.equal(await countRows(pool, "audit_events", "action='payout.paid'"), 1);
  });

  it("importe distinto: se ignora (conflicto) y la liquidación NO se marca como pagada", async () => {
    const { run, ref } = await processingRun();
    const event = payoutEvent("paid", ref, 1899);
    const hook = await postWebhook(app, [event]);
    assert.equal(hook.statusCode, 200);
    assert.equal(resultOf(hook), "ignored:conflict");
    const stored = await pool.query(`select outcome, detail from payment_events where provider_event_id=$1`, [event.id]);
    assert.equal(stored.rows[0].outcome, "ignored_conflict");
    assert.equal(stored.rows[0].detail.reason, "amount_mismatch");
    assert.equal(stored.rows[0].detail.eventCents, 1899);
    assert.equal(await scalar<string>(pool, `select status from payout_runs where id=$1`, [run.id]), "processing");
    assert.equal(await countRows(pool, "ledger_transactions", "kind='payout'"), 0);
    assert.equal(await countRows(pool, "receipts", "kind='earning_statement'"), 0);
  });

  it("referencia desconocida → 409 PAYMENT_UNKNOWN y no se guarda el evento (el proveedor reintentará)", async () => {
    await processingRun();
    const hook = await postWebhook(app, [payoutEvent("paid", "po_desconocido", 1900)]);
    assert.equal(hook.statusCode, 409);
    assert.equal(hook.json().error.code, "PAYMENT_UNKNOWN");
    assert.equal(await countRows(pool, "payment_events", "provider_event_id like 'evt_po_%'"), 0);
  });

  it("evento duplicado → 'duplicate'; otro paid posterior → 'ignored:stale'; el dinero se asienta una sola vez", async () => {
    const { ref } = await processingRun();
    const event = payoutEvent("paid", ref, 1900);
    assert.equal(resultOf(await postWebhook(app, [event])), "applied");
    assert.equal(resultOf(await postWebhook(app, [event])), "duplicate");
    assert.equal(resultOf(await postWebhook(app, [payoutEvent("paid", ref, 1900)])), "ignored:stale");
    assert.equal(await countRows(pool, "ledger_transactions", "kind='payout'"), 1);
    assert.equal(await accountNet(pool, "external_payout"), 1900);
    assert.equal(await countRows(pool, "receipts", "kind='earning_statement'"), 1);
  });

  it("payout.paid sobre una liquidación que aún es borrador (nadie pidió el abono) se ignora", async () => {
    await completedBooking("2026-07-05T10:00:00Z");
    const run = (await generate("2026-07")).json.created[0];
    await pool.query(`update payout_runs set provider_payout_ref='po_forzado' where id=$1`, [run.id]);
    const hook = await postWebhook(app, [payoutEvent("paid", "po_forzado", 950)]);
    assert.equal(resultOf(hook), "ignored:conflict");
    assert.equal(await scalar<string>(pool, `select status from payout_runs where id=$1`, [run.id]), "draft");
    assert.equal(await accountNet(pool, "external_payout"), 0);
  });

  it("payout.failed deja la liquidación en «failed» con el código saneado; se puede volver a pedir con otra petición y luego pagar", async () => {
    const { run, ref } = await processingRun();
    const failed = await postWebhook(app, [payoutEvent("failed", ref, 1900, { failureCode: "Account Closed!" })]);
    assert.equal(resultOf(failed), "applied");
    const view = await apiCall(app, world.ana, "GET", `/v1/me/payouts/${run.id}`);
    assert.equal(view.json.status, "failed");
    assert.equal(view.json.failureCode, "account_closed_");
    assert.equal(await accountNet(pool, "external_payout"), 0);
    const next = await apiCall(app, world.ana, "GET", "/v1/me/payouts");
    assert.deepEqual(next.json.nextPayout, { status: "pending_definition", date: null, amount: MONEY(1900) });

    // reintento: otra petición al proveedor (clave derivada distinta) y nueva referencia
    const again = await executeRun(run.id);
    assert.equal(again.response.statusCode, 200, again.response.body);
    assert.equal(again.json.status, "processing");
    assert.equal(again.json.failureCode, null);
    assert.equal(stub.calls.createPayout, 2);
    const keys = [...stub.payouts.keys()];
    assert.equal(new Set(keys).size, 2, "un reintento tras fallo es otra petición idempotente");
    const newRef = await providerPayoutRef(pool, run.id);
    assert.notEqual(newRef, ref);
    assert.equal(resultOf(await postWebhook(app, [payoutEvent("paid", newRef, 1900)])), "applied");
    assert.equal(await scalar<string>(pool, `select status from payout_runs where id=$1`, [run.id]), "paid");
    assert.equal(await accountNet(pool, "external_payout"), 1900);
  });

  it("payout.failed duplicado o sobre una liquidación ya fallida se ignora", async () => {
    const { ref } = await processingRun();
    const event = payoutEvent("failed", ref, 1900, { failureCode: "rejected" });
    assert.equal(resultOf(await postWebhook(app, [event])), "applied");
    assert.equal(resultOf(await postWebhook(app, [event])), "duplicate");
    assert.equal(resultOf(await postWebhook(app, [payoutEvent("failed", ref, 1900, { failureCode: "rejected" })])), "ignored:stale");
  });

  it("un payout.failed tardío tras payout.paid no revierte el abono", async () => {
    const { run, ref } = await processingRun();
    assert.equal(resultOf(await postWebhook(app, [payoutEvent("paid", ref, 1900)])), "applied");
    assert.equal(resultOf(await postWebhook(app, [payoutEvent("failed", ref, 1900, { failureCode: "late" })])), "ignored:conflict");
    assert.equal(await scalar<string>(pool, `select status from payout_runs where id=$1`, [run.id]), "paid");
  });
});

/* ═════════════════════════ Recobros sobre abonos ya enviados ═════════════════════════ */

describe("Liquidaciones: devoluciones sobre dinero ya abonado se compensan en la siguiente liquidación", () => {
  it("julio abonado (950), devolución aprobada de 550 → saldo −475; agosto elegible 950 → se abonan 475", async () => {
    const july = await completedBooking("2026-07-15T10:00:00Z");
    await payOut("2026-07");
    assert.equal(await accountNet(pool, "driver_payable", world.ana.id), 0);

    await approveRefund(await openRefundFor(july, world.ana.id), 550);
    assert.equal(await accountNet(pool, "driver_payable", world.ana.id), -475, "reparto proporcional de 550 sobre [950, 150]");

    await completedBooking("2026-08-10T10:00:00Z");
    const generated = await generate("2026-08");
    assert.equal(generated.response.statusCode, 201, generated.response.body);
    const run = generated.json.created[0];
    assert.deepEqual(run.net, MONEY(475), "950 elegibles − 475 de recobro");
    assert.equal(run.bookingsCount, 1);
    const audit = await pool.query(`select metadata from audit_events where action='payout.run_created' and entity_id=$1`, [run.id]);
    assert.equal(audit.rows[0].metadata.eligibleCents, 950);
    assert.equal(audit.rows[0].metadata.netCents, 475);

    const mine = await apiCall(app, world.ana, "GET", "/v1/me/payouts");
    assert.deepEqual(mine.json.nextPayout, { status: "pending_definition", date: null, amount: MONEY(475) });

    // se abona: el libro queda exactamente a cero y lo abonado = lo cobrado − lo devuelto
    const ref = await (async () => {
      assert.equal((await executeRun(run.id)).response.statusCode, 200);
      return providerPayoutRef(pool, run.id);
    })();
    assert.equal((await postWebhook(app, [payoutEvent("paid", ref, 475)])).statusCode, 200);
    assert.equal(await accountNet(pool, "driver_payable", world.ana.id), 0);
    assert.equal(await accountNet(pool, "external_payout", world.ana.id), 950 + 475);
    assert.equal(await ledgerImbalance(pool), 0);
  });

  it("si el recobro iguala o supera lo elegible no se genera liquidación (nunca se abona más de lo que el libro debe)", async () => {
    const july = await completedBooking("2026-07-15T10:00:00Z");
    await payOut("2026-07");
    await approveRefund(await openRefundFor(july, world.ana.id), 1100);
    assert.equal(await accountNet(pool, "driver_payable", world.ana.id), -950);

    const august = await completedBooking("2026-08-10T10:00:00Z");
    const generated = await generate("2026-08");
    assert.deepEqual(generated.json, { period: "2026-08", created: [], skipped: 1 });
    assert.equal(await countRows(pool, "payout_runs", "period_month='2026-08-01'"), 0);
    assert.equal(await accountNet(pool, "driver_payable", world.ana.id), 0, "el recobro consume la aportación de agosto");
    assert.equal(await countRows(pool, "payout_run_items", "booking_id=$1", [august.bookingId]), 0);
  });

  it("las liquidaciones abiertas reservan saldo: no se puede generar de más aunque haya dos meses elegibles", async () => {
    await completedBooking("2026-07-05T10:00:00Z");
    await completedBooking("2026-08-05T10:00:00Z");
    const julyRun = (await generate("2026-07")).json.created[0];
    const augustRun = (await generate("2026-08")).json.created[0];
    assert.deepEqual(julyRun.net, MONEY(950));
    assert.deepEqual(augustRun.net, MONEY(950));
    const reserved = Number(await scalar<string>(pool, `select sum(net_cents)::text from payout_runs where status in ('draft','processing','failed')`));
    assert.equal(reserved, 1900);
    assert.equal(await accountNet(pool, "driver_payable", world.ana.id), 1900);
  });
});

/* ═════════════════════════ Métodos de pago ═════════════════════════ */

describe("Métodos de pago (tokenizados)", () => {
  const addMethod = (actor: Actor | null, body: Record<string, unknown>, key?: string | null, target: FastifyInstance = app) =>
    apiCall(target, actor, "POST", "/v1/me/payment-methods", body, key === undefined ? newKey() : key);
  const card = (token = "tok_card_visa_4242", extra: Record<string, unknown> = {}) => ({ purpose: "charge", providerToken: token, ...extra });

  it("añadir una tarjeta devuelve solo datos enmascarados y la deja como predeterminada", async () => {
    const r = await addMethod(world.miguel, card());
    assert.equal(r.response.statusCode, 201, r.response.body);
    assert.match(r.json.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(
      { ...r.json, id: "x", createdAt: "x" },
      {
        id: "x",
        purpose: "charge",
        kind: "card",
        brand: "visa",
        last4: "4242",
        country: "ES",
        expMonth: 12,
        expYear: 2031,
        title: "Tarjeta Visa",
        maskedLabel: "•••• 4242",
        isDefault: true,
        status: "active",
        createdAt: "x"
      }
    );
    assert.doesNotMatch(r.response.body, /tok_|pm_|stubpay/);
    const row = (await pool.query(`select provider, provider_method_ref from payment_methods`)).rows[0];
    assert.equal(row.provider, "stubpay");
    assert.equal(row.provider_method_ref, "pm_tok_card_visa_4242");
    assert.equal(await countRows(pool, "audit_events", "action='payment_method.added'"), 1);
  });

  it("la tabla no tiene columnas para PAN, CVV ni IBAN completos, y la base de datos rechaza referencias con forma de número de tarjeta", async () => {
    const columns = (await pool.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name='payment_methods'`)).rows.map(c => c.column_name);
    for (const forbidden of ["pan", "card_number", "number", "cvv", "cvc", "iban", "holder", "holder_name", "secret", "token"]) {
      assert.ok(!columns.includes(forbidden), `columna prohibida: ${forbidden}`);
    }
    await assert.rejects(
      pool.query(
        `insert into payment_methods(user_id,purpose,provider,provider_method_ref,kind) values($1,'charge','stubpay','4242 4242 4242 4242','card')`,
        [world.miguel.id]
      ),
      (error: unknown) => (error as { code?: string }).code === "23514"
    );
    await assert.rejects(
      pool.query(`insert into payment_methods(user_id,purpose,provider,provider_method_ref,kind) values($1,'charge','disabled','pm_x1','card')`, [world.miguel.id]),
      (error: unknown) => (error as { code?: string }).code === "23514",
      "el proveedor «disabled» nunca crea métodos"
    );
  });

  it("el primer método es el predeterminado; los siguientes no, salvo setAsDefault; solo hay uno predeterminado", async () => {
    const a = await addMethod(world.miguel, card("tok_card_visa_4242"));
    const b = await addMethod(world.miguel, card("tok_card_mastercard_5555"));
    assert.equal(a.json.isDefault, true);
    assert.equal(b.json.isDefault, false);
    assert.equal(b.json.title, "Tarjeta Mastercard");
    const c = await addMethod(world.miguel, card("tok_card_amex_0005", { setAsDefault: true }));
    assert.equal(c.json.isDefault, true);
    const list = await apiCall(app, world.miguel, "GET", "/v1/me/payment-methods?purpose=charge");
    assert.deepEqual(list.json.items.map((m: any) => [m.id, m.isDefault]), [[c.json.id, true], [b.json.id, false], [a.json.id, false]]);
    assert.equal(list.json.items.filter((m: any) => m.isDefault).length, 1);
    assert.equal(list.json.availability.enabled, true);
    await assert.rejects(
      pool.query(`update payment_methods set is_default=true where id=$1`, [a.json.id]),
      (error: unknown) => (error as { code?: string }).code === "23505",
      "el índice único impide dos predeterminados"
    );
  });

  it("la lista se filtra por finalidad (por defecto «charge»), solo muestra métodos propios y valida el filtro", async () => {
    await addMethod(world.miguel, card());
    await addMethod(world.ana, { purpose: "payout", providerToken: "tok_iban_4589" });
    assert.equal((await apiCall(app, world.miguel, "GET", "/v1/me/payment-methods")).json.items.length, 1);
    assert.deepEqual((await apiCall(app, world.miguel, "GET", "/v1/me/payment-methods?purpose=payout")).json.items, []);
    const payout = await apiCall(app, world.ana, "GET", "/v1/me/payment-methods?purpose=payout");
    assert.equal(payout.json.items.length, 1);
    assert.equal(payout.json.items[0].kind, "bank_account");
    assert.equal(payout.json.items[0].maskedLabel, "ES** **** **** 4589");
    assert.equal(payout.json.items[0].title, "Cuenta bancaria");
    assert.deepEqual((await apiCall(app, world.lucia, "GET", "/v1/me/payment-methods")).json.items, []);
    assert.equal((await apiCall(app, world.miguel, "GET", "/v1/me/payment-methods?purpose=otro")).response.statusCode, 400);
    assert.equal((await apiCall(app, null, "GET", "/v1/me/payment-methods")).response.statusCode, 401);
  });

  it("quitar el predeterminado promociona el más reciente, desvincula en el proveedor y no se puede repetir", async () => {
    const a = await addMethod(world.miguel, card("tok_card_visa_4242"));
    const b = await addMethod(world.miguel, card("tok_card_mastercard_5555"));
    const c = await addMethod(world.miguel, card("tok_card_amex_0005"));
    const removed = await apiCall(app, world.miguel, "DELETE", `/v1/me/payment-methods/${a.json.id}`);
    assert.equal(removed.response.statusCode, 200);
    assert.deepEqual(removed.json, { removed: true });
    assert.deepEqual(stub.detached, ["pm_tok_card_visa_4242"]);
    const list = await apiCall(app, world.miguel, "GET", "/v1/me/payment-methods");
    assert.deepEqual(list.json.items.map((m: any) => [m.id, m.isDefault]), [[c.json.id, true], [b.json.id, false]]);
    // el registro se conserva (retirado) pero no se muestra
    assert.equal(await scalar<string>(pool, `select status from payment_methods where id=$1`, [a.json.id]), "removed");
    const again = await apiCall(app, world.miguel, "DELETE", `/v1/me/payment-methods/${a.json.id}`);
    assert.equal(again.response.statusCode, 404);
    assert.equal(again.json.error.code, "PAYMENT_METHOD_NOT_FOUND");
    assert.equal(await countRows(pool, "audit_events", "action='payment_method.removed'"), 1);
  });

  it("nadie puede quitar un método ajeno (404) y hacen falta sesión y un id válido", async () => {
    const a = await addMethod(world.miguel, card());
    for (const other of [world.lucia, world.ana, world.finance]) {
      const r = await apiCall(app, other, "DELETE", `/v1/me/payment-methods/${a.json.id}`);
      assert.equal(r.response.statusCode, 404, other.name);
    }
    assert.equal((await apiCall(app, null, "DELETE", `/v1/me/payment-methods/${a.json.id}`)).response.statusCode, 401);
    assert.equal((await apiCall(app, world.miguel, "DELETE", "/v1/me/payment-methods/no-es-uuid")).response.statusCode, 400);
    assert.equal(await scalar<string>(pool, `select status from payment_methods where id=$1`, [a.json.id]), "active");
    assert.deepEqual(stub.detached, []);
  });

  it("idempotencia: misma clave y cuerpo → misma respuesta sin duplicar; otro cuerpo → 422; sin clave → 400", async () => {
    const key = newKey();
    const first = await addMethod(world.miguel, card(), key);
    const replay = await addMethod(world.miguel, card(), key);
    assert.equal(first.response.statusCode, 201);
    assert.equal(replay.response.statusCode, 201);
    assert.equal(replay.response.headers["idempotency-replayed"], "true");
    assert.deepEqual(replay.json, first.json);
    assert.equal(await countRows(pool, "payment_methods"), 1);
    const reused = await addMethod(world.miguel, card("tok_card_visa_4242", { setAsDefault: true }), key);
    assert.equal(reused.response.statusCode, 422);
    assert.equal(reused.json.error.code, "IDEMPOTENCY_KEY_REUSED");
    const noKey = await addMethod(world.miguel, card("tok_card_mastercard_5555"), null);
    assert.equal(noKey.response.statusCode, 400);
    assert.equal(noKey.json.error.code, "IDEMPOTENCY_KEY_REQUIRED");
  });

  it("un token ya registrado (por el mismo usuario u otro) se rechaza y no altera el predeterminado", async () => {
    const first = await addMethod(world.miguel, card());
    const dupSame = await addMethod(world.miguel, card("tok_card_visa_4242", { setAsDefault: true }));
    assert.equal(dupSame.response.statusCode, 409);
    assert.equal(dupSame.json.error.code, "PAYMENT_METHOD_NOT_AVAILABLE");
    const dupOther = await addMethod(world.lucia, card());
    assert.equal(dupOther.response.statusCode, 409);
    assert.equal(dupOther.json.error.code, "PAYMENT_METHOD_NOT_AVAILABLE");
    const list = await apiCall(app, world.miguel, "GET", "/v1/me/payment-methods");
    assert.deepEqual(list.json.items.map((m: any) => [m.id, m.isDefault]), [[first.json.id, true]]);
    assert.deepEqual((await apiCall(app, world.lucia, "GET", "/v1/me/payment-methods")).json.items, []);
  });

  it("un token desconocido para el proveedor, un tipo no admitido para la finalidad y entradas inválidas se rechazan", async () => {
    const unknown = await addMethod(world.miguel, card("tok_inventado_123"));
    assert.equal(unknown.response.statusCode, 409);
    assert.equal(unknown.json.error.code, "PAYMENT_METHOD_NOT_AVAILABLE");
    const cardAsPayout = await addMethod(world.ana, { purpose: "payout", providerToken: "tok_card_visa_4242" });
    assert.equal(cardAsPayout.response.statusCode, 409);
    assert.equal(cardAsPayout.json.error.code, "PAYMENT_METHOD_NOT_AVAILABLE");
    const ibanAsCharge = await addMethod(world.miguel, { purpose: "charge", providerToken: "tok_iban_4589" });
    assert.equal(ibanAsCharge.response.statusCode, 409);
    assert.equal(await countRows(pool, "payment_methods"), 0);
    for (const body of [{}, { purpose: "charge" }, { providerToken: "tok_card_visa_4242" }, { purpose: "otro", providerToken: "tok_card_visa_4242" }, card("ab")]) {
      const bad = await addMethod(world.miguel, body as Record<string, unknown>);
      assert.equal(bad.response.statusCode, 400, JSON.stringify(body));
      assert.equal(bad.json.error.code, "VALIDATION_ERROR");
    }
    assert.equal((await addMethod(null, card())).response.statusCode, 401);
  });

  it("fallo del proveedor → 502 y nada guardado; el reintento con la misma clave funciona", async () => {
    const key = newKey();
    stub.failNext = true;
    const failed = await addMethod(world.miguel, card(), key);
    assert.equal(failed.response.statusCode, 502);
    assert.equal(failed.json.error.code, "PAYMENT_PROVIDER_ERROR");
    assert.equal(await countRows(pool, "payment_methods"), 0);
    const retry = await addMethod(world.miguel, card(), key);
    assert.equal(retry.response.statusCode, 201, retry.response.body);
    // y al desvincular: si el proveedor falla, el método sigue activo
    stub.failNext = true;
    const removeFailed = await apiCall(app, world.miguel, "DELETE", `/v1/me/payment-methods/${retry.json.id}`);
    assert.equal(removeFailed.response.statusCode, 502);
    assert.equal(await scalar<string>(pool, `select status from payment_methods where id=$1`, [retry.json.id]), "active");
  });

  it("un número de tarjeta se rechaza SIEMPRE (400 RAW_CARD_DATA_REJECTED), con proveedor activo o no, y no queda rastro en ninguna tabla", async () => {
    const numbers = ["4242424242424242", "4242 4242 4242 4242", "4242-4242-4242-4242", "378282246310005", "5555555555554444"];
    for (const number of numbers) {
      for (const target of [app, disabledApp]) {
        const r = await addMethod(world.miguel, card(number), undefined, target);
        assert.equal(r.response.statusCode, 400, number);
        assert.equal(r.json.error.code, "RAW_CARD_DATA_REJECTED", number);
        assert.doesNotMatch(r.response.body, /4242|3782|5555/);
      }
    }
    for (const table of ["payment_methods", "idempotency_keys", "audit_events", "notifications", "payment_events"]) {
      const dump = await scalar<string>(pool, `select coalesce(string_agg(to_jsonb(t)::text, ' '), '') from ${table} t`);
      assert.doesNotMatch(dump, /4242\s?4242|424242424242|3782\s?8224|5555\s?5555/, table);
    }
    assert.equal(stub.detached.length, 0);
  });

  it("proveedor desactivado: no se puede añadir ningún método, la lista está vacía y quitar uno heredado no llama al proveedor", async () => {
    const added = await addMethod(world.miguel, card(), undefined, disabledApp);
    assert.equal(added.response.statusCode, 409);
    assert.equal(added.json.error.code, "PAYMENTS_PROVIDER_DISABLED");
    assert.equal(await countRows(pool, "payment_methods"), 0);
    const list = await apiCall(disabledApp, world.miguel, "GET", "/v1/me/payment-methods");
    assert.deepEqual(list.json.items, []);
    assert.equal(list.json.availability.enabled, false);
    assert.equal(list.json.availability.status, "provider_disabled");
    // método heredado de un proveedor anterior: se puede retirar sin proveedor
    const legacy = (
      await pool.query<{ id: string }>(
        `insert into payment_methods(user_id,purpose,provider,provider_method_ref,kind,brand,last4,is_default)
         values($1,'charge','antiguo','pm_antiguo_1','card','visa','1881',true) returning id`,
        [world.miguel.id]
      )
    ).rows[0]!.id;
    const removed = await apiCall(disabledApp, world.miguel, "DELETE", `/v1/me/payment-methods/${legacy}`);
    assert.equal(removed.response.statusCode, 200, removed.response.body);
    assert.equal(await scalar<string>(pool, `select status from payment_methods where id=$1`, [legacy]), "removed");
  });
});

describe("Métodos de pago guardados y pagos de reservas", () => {
  async function payableRequest(passenger: Actor) {
    const tariff = await ensureTariff(pool);
    const tripId = await seedTrip(pool, world);
    const { requestId } = await seedPayableRequest(pool, tripId, passenger, { tariffId: tariff });
    return { tripId, requestId };
  }
  const intentWith = (actor: Actor, requestId: string, method: Record<string, unknown>) =>
    apiCall(app, actor, "POST", `/v1/ride-requests/${requestId}/payment-intents`, { method });

  it("pagar con un método guardado lo asocia al pago, y no se puede quitar mientras el pago esté abierto", async () => {
    const saved = (await apiCall(app, world.miguel, "POST", "/v1/me/payment-methods", { purpose: "charge", providerToken: "tok_card_visa_4242" })).json;
    const { requestId } = await payableRequest(world.miguel);
    const intent = await intentWith(world.miguel, requestId, { kind: "card", paymentMethodId: saved.id });
    assert.equal(intent.response.statusCode, 201, intent.response.body);
    assert.equal(intent.json.payment.method.kind, "card");
    assert.equal(intent.json.payment.method.maskedLabel, "•••• 4242");
    assert.equal(await scalar<string>(pool, `select payment_method_id from payments where id=$1`, [intent.json.payment.id]), saved.id);

    const blocked = await apiCall(app, world.miguel, "DELETE", `/v1/me/payment-methods/${saved.id}`);
    assert.equal(blocked.response.statusCode, 409);
    assert.equal(blocked.json.error.code, "PAYMENT_ALREADY_OPEN");
    assert.deepEqual(stub.detached, []);

    const ref = await scalar<string>(pool, `select provider_payment_ref from payments where id=$1`, [intent.json.payment.id]);
    assert.equal((await postWebhook(app, [succeededEvent(ref, TEST_QUOTE.totalCents)])).statusCode, 200);
    const allowed = await apiCall(app, world.miguel, "DELETE", `/v1/me/payment-methods/${saved.id}`);
    assert.equal(allowed.response.statusCode, 200, allowed.response.body);
    // el pago confirmado conserva su método (histórico) aunque se retire
    assert.equal(await scalar<string>(pool, `select payment_method_id from payments where id=$1`, [intent.json.payment.id]), saved.id);
  });

  it("un método ajeno, de otro tipo, de cobro (payout) o retirado no sirve para pagar (409 PAYMENT_METHOD_NOT_AVAILABLE)", async () => {
    const mine = (await apiCall(app, world.miguel, "POST", "/v1/me/payment-methods", { purpose: "charge", providerToken: "tok_card_visa_4242" })).json;
    const theirs = (await apiCall(app, world.lucia, "POST", "/v1/me/payment-methods", { purpose: "charge", providerToken: "tok_card_mastercard_5555" })).json;
    const payout = (await apiCall(app, world.miguel, "POST", "/v1/me/payment-methods", { purpose: "payout", providerToken: "tok_iban_4589" })).json;
    const removed = (await apiCall(app, world.miguel, "POST", "/v1/me/payment-methods", { purpose: "charge", providerToken: "tok_card_amex_0005" })).json;
    assert.equal((await apiCall(app, world.miguel, "DELETE", `/v1/me/payment-methods/${removed.id}`)).response.statusCode, 200);

    const { requestId } = await payableRequest(world.miguel);
    for (const [label, method] of [
      ["ajeno", { kind: "card", paymentMethodId: theirs.id }],
      ["otro tipo", { kind: "apple_pay", paymentMethodId: mine.id }],
      ["cuenta de cobro", { kind: "card", paymentMethodId: payout.id }],
      ["retirado", { kind: "card", paymentMethodId: removed.id }],
      ["inexistente", { kind: "card", paymentMethodId: "6f0f1c64-9c1b-4f0e-9a3a-0f2f4c8d9e11" }]
    ] as const) {
      const r = await intentWith(world.miguel, requestId, method);
      assert.equal(r.response.statusCode, 409, label);
      assert.equal(r.json.error.code, "PAYMENT_METHOD_NOT_AVAILABLE", label);
    }
    assert.equal(await countRows(pool, "payments"), 0, "ningún intento fallido deja un pago abierto");
    assert.equal(stub.calls.createPaymentIntent, 0, "ni llega al proveedor");
    // con el método correcto sí
    assert.equal((await intentWith(world.miguel, requestId, { kind: "card", paymentMethodId: mine.id })).response.statusCode, 201);
  });
});

