/**
 * Módulo money · libro mayor (invariantes en la base de datos y a lo largo del ciclo de vida de un pago) y recibos
 * (justificantes NO fiscales, inmutables, con numeración correlativa sin huecos).
 *
 * Importes: fixtures de prueba (no son tarifas). El proveedor es el `StubPaymentProvider` de pruebas.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { allocateProRata, postLedger, postPayout } from "../src/modules/money/ledger/ledger-service.js";
import { issueReceipt } from "../src/modules/money/reports/receipt-service.js";
import {
  accountNet,
  apiCall,
  bearer,
  buildTestApp,
  completeTrip,
  countRows,
  createActor,
  createIntent,
  createTestPool,
  ensureTariff,
  inTransaction,
  ledgerImbalance,
  madridYear,
  mulberry32,
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
  succeededEvent,
  TEST_QUOTE,
  type Actor,
  type PaidBooking,
  type TestQuote,
  type World
} from "./money-support.js";

const pool = createTestPool();
let world: World;
let stub: StubPaymentProvider;
let app: FastifyInstance;

before(async () => {
  await pool.query("select 1 from ledger_entries limit 1");
});
after(async () => {
  await pool.end();
});
beforeEach(async () => {
  await resetMoneyData(pool);
  world = await seedWorld(pool);
  stub = new StubPaymentProvider();
  app = await buildTestApp(pool, stub);
});
afterEach(async () => {
  await app.close();
});

type PgError = { code?: string; message?: string; constraint?: string };
const isPg = (code: string, text?: RegExp) => (error: unknown): boolean => {
  const e = error as PgError;
  return e.code === code && (text === undefined || text.test(e.message ?? ""));
};

async function newTransactionId(client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ id: string }> }> }, key: string) {
  const result = await client.query(`insert into ledger_transactions(tx_key,kind) values($1,'adjustment') returning id`, [key]);
  return result.rows[0]!.id;
}

/** Reserva pagada y cancelada por el pasajero → propuesta de devolución `pending_review`. */
async function cancelledBooking(options: { passenger?: Actor; quote?: Partial<TestQuote> } = {}) {
  const booking = await paidBooking(pool, app, world, {
    ...(options.passenger ? { passenger: options.passenger } : {}),
    ...(options.quote ? { quote: options.quote } : {})
  });
  const cancelled = await apiCall(app, booking.passenger, "POST", `/v1/bookings/${booking.bookingId}/cancel`, { reason: "schedule_change" });
  assert.equal(cancelled.response.statusCode, 200, cancelled.response.body);
  return { booking, refundId: cancelled.json.refund.id as string };
}

async function approveRefund(refundId: string, approvedCents: number) {
  const result = await apiCall(app, world.finance, "POST", `/v1/admin/refund-proposals/${refundId}/approve`, {
    approvedCents,
    note: "Prueba de libro mayor"
  });
  assert.equal(result.response.statusCode, 200, result.response.body);
  return result;
}

async function confirmRefund(booking: PaidBooking, refundId: string, cents: number) {
  const ref = await providerRefundRef(pool, refundId);
  const hook = await postWebhook(app, [refundEvent("succeeded", ref, booking.providerRef, cents)]);
  assert.equal(hook.statusCode, 200, hook.body);
}

/* ═════════════════════════ Invariantes del libro en la base de datos ═════════════════════════ */

describe("Libro mayor: restricciones y triggers de la base de datos", () => {
  it("una transacción desequilibrada se rechaza al confirmar (MVC_LEDGER_UNBALANCED) y no deja nada", async () => {
    await assert.rejects(
      inTransaction(pool, async client => {
        const id = await newTransactionId(client, "test:unbalanced");
        await client.query(
          `insert into ledger_entries(transaction_id,account,user_id,amount_cents) values($1,'passenger',$2,-100),($1,'platform_revenue',null,90)`,
          [id, world.miguel.id]
        );
      }),
      isPg("23514", /MVC_LEDGER_UNBALANCED/)
    );
    assert.equal(await countRows(pool, "ledger_transactions"), 0);
    assert.equal(await countRows(pool, "ledger_entries"), 0);
  });

  it("una transacción con una sola línea (que no puede sumar 0) no se puede confirmar", async () => {
    await assert.rejects(
      inTransaction(pool, async client => {
        const id = await newTransactionId(client, "test:single-line");
        await client.query(`insert into ledger_entries(transaction_id,account,amount_cents) values($1,'platform_revenue',50)`, [id]);
      }),
      isPg("23514", /MVC_LEDGER_UNBALANCED/)
    );
    assert.equal(await countRows(pool, "ledger_entries"), 0);
  });

  it("una transacción equilibrada de varias líneas se confirma, aunque las líneas lleguen en sentencias distintas de la misma transacción", async () => {
    await inTransaction(pool, async client => {
      const id = await newTransactionId(client, "test:balanced");
      await client.query(`insert into ledger_entries(transaction_id,account,user_id,amount_cents) values($1,'passenger',$2,-1100)`, [id, world.miguel.id]);
      // entre las dos sentencias la transacción está desequilibrada: la comprobación es diferida y solo cuenta al confirmar
      await client.query(
        `insert into ledger_entries(transaction_id,account,user_id,amount_cents) values($1,'driver_payable',$2,950),($1,'platform_revenue',null,150)`,
        [id, world.ana.id]
      );
    });
    assert.equal(await countRows(pool, "ledger_entries"), 3);
    assert.equal(await ledgerImbalance(pool), 0);
    assert.equal(await accountNet(pool, "driver_payable", world.ana.id), 950);
  });

  it("dos desequilibrios que se compensan ENTRE transacciones siguen siendo un error (se comprueba cada transacción)", async () => {
    await assert.rejects(
      inTransaction(pool, async client => {
        const a = await newTransactionId(client, "test:cross-a");
        const b = await newTransactionId(client, "test:cross-b");
        await client.query(`insert into ledger_entries(transaction_id,account,amount_cents) values($1,'platform_revenue',100)`, [a]);
        await client.query(`insert into ledger_entries(transaction_id,account,amount_cents) values($1,'suspense',-100)`, [b]);
      }),
      isPg("23514", /MVC_LEDGER_UNBALANCED/)
    );
    assert.equal(await countRows(pool, "ledger_entries"), 0);
  });

  it("es solo-añadir: UPDATE y DELETE de ledger_entries y ledger_transactions fallan (MVC_APPEND_ONLY_TABLE)", async () => {
    await inTransaction(pool, client =>
      postLedger(client, {
        txKey: "test:adjustment:1",
        kind: "adjustment",
        lines: [
          { account: "suspense", amountCents: 700 },
          { account: "platform_revenue", amountCents: -700 }
        ]
      })
    );
    for (const sql of [
      `update ledger_entries set amount_cents = amount_cents + 1`,
      `delete from ledger_entries`,
      `update ledger_transactions set memo = 'editado'`,
      `delete from ledger_transactions`
    ]) {
      await assert.rejects(pool.query(sql), isPg("55000", /MVC_APPEND_ONLY_TABLE/), sql);
    }
    assert.equal(await countRows(pool, "ledger_entries"), 2);
    assert.equal(await accountNet(pool, "suspense"), 700);
  });

  it("un importe 0, una cuenta desconocida y un tipo desconocido se rechazan", async () => {
    await assert.rejects(
      inTransaction(pool, async client => {
        const id = await newTransactionId(client, "test:zero");
        await client.query(`insert into ledger_entries(transaction_id,account,amount_cents) values($1,'suspense',0)`, [id]);
      }),
      isPg("23514")
    );
    await assert.rejects(
      inTransaction(pool, async client => {
        const id = await newTransactionId(client, "test:account");
        await client.query(`insert into ledger_entries(transaction_id,account,amount_cents) values($1,'caja_negra',10),($1,'suspense',-10)`, [id]);
      }),
      isPg("23514")
    );
    await assert.rejects(pool.query(`insert into ledger_transactions(tx_key,kind) values('test:kind','regalo')`), isPg("23514"));
  });

  it("las cuentas de usuario exigen user_id y las cuentas de la plataforma lo prohíben", async () => {
    await assert.rejects(
      inTransaction(pool, async client => {
        const id = await newTransactionId(client, "test:user-1");
        await client.query(`insert into ledger_entries(transaction_id,account,user_id,amount_cents) values($1,'passenger',null,-5),($1,'platform_revenue',null,5)`, [id]);
      }),
      isPg("23514")
    );
    await assert.rejects(
      inTransaction(pool, async client => {
        const id = await newTransactionId(client, "test:user-2");
        await client.query(`insert into ledger_entries(transaction_id,account,user_id,amount_cents) values($1,'passenger',$2,-5),($1,'platform_revenue',$2,5)`, [id, world.miguel.id]);
      }),
      isPg("23514")
    );
    assert.equal(await countRows(pool, "ledger_entries"), 0);
  });

  it("tx_key es única y de longitud razonable", async () => {
    await pool.query(`insert into ledger_transactions(tx_key,kind) values('test:unique','adjustment')`);
    await assert.rejects(pool.query(`insert into ledger_transactions(tx_key,kind) values('test:unique','adjustment')`), isPg("23505"));
    await assert.rejects(pool.query(`insert into ledger_transactions(tx_key,kind) values('ab','adjustment')`), isPg("23514"));
  });
});

describe("Libro mayor: servicio postLedger", () => {
  it("es idempotente por tx_key: la segunda publicación no duplica asientos", async () => {
    const input = {
      txKey: "test:idem:1",
      kind: "adjustment" as const,
      lines: [
        { account: "passenger" as const, userId: world.miguel.id, amountCents: -250 },
        { account: "suspense" as const, amountCents: 250 }
      ]
    };
    const first = await inTransaction(pool, client => postLedger(client, input));
    const second = await inTransaction(pool, client => postLedger(client, input));
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.transactionId, first.transactionId);
    assert.equal(await countRows(pool, "ledger_entries"), 2);
    assert.equal(await accountNet(pool, "suspense"), 250);
  });

  it("publicaciones concurrentes de la misma clave dejan exactamente un asiento", async () => {
    const input = {
      txKey: "test:idem:race",
      kind: "adjustment" as const,
      lines: [
        { account: "passenger" as const, userId: world.miguel.id, amountCents: -90 },
        { account: "suspense" as const, amountCents: 90 }
      ]
    };
    const results = await Promise.all(Array.from({ length: 6 }, () => inTransaction(pool, client => postLedger(client, input))));
    assert.equal(results.filter(r => r.created).length, 1);
    assert.equal(new Set(results.map(r => r.transactionId)).size, 1);
    assert.equal(await countRows(pool, "ledger_entries"), 2);
  });

  it("rechaza en la capa de aplicación entradas inválidas antes de tocar la base de datos", async () => {
    const base = { txKey: "test:invalid", kind: "adjustment" as const };
    await assert.rejects(postLedger(pool, { ...base, lines: [] }), /without lines/);
    await assert.rejects(
      postLedger(pool, { ...base, lines: [{ account: "suspense", amountCents: 10 }, { account: "platform_revenue", amountCents: -9 }] }),
      /does not balance/
    );
    await assert.rejects(
      postLedger(pool, { ...base, lines: [{ account: "suspense", amountCents: 0 }, { account: "platform_revenue", amountCents: 0 }] }),
      /non-zero/
    );
    await assert.rejects(
      postLedger(pool, { ...base, lines: [{ account: "suspense", amountCents: 1.5 }, { account: "platform_revenue", amountCents: -1.5 }] }),
      /non-zero integer/
    );
    await assert.rejects(
      postLedger(pool, { ...base, lines: [{ account: "passenger", amountCents: -5 }, { account: "suspense", amountCents: 5 }] }),
      /requires a user/
    );
    await assert.rejects(
      postLedger(pool, {
        ...base,
        lines: [{ account: "suspense", userId: world.miguel.id, amountCents: -5 }, { account: "platform_revenue", amountCents: 5 }]
      }),
      /forbids a user/
    );
    assert.equal(await countRows(pool, "ledger_transactions"), 0);
  });
});

/* ═════════════════════════ Ciclo de vida de un pago ═════════════════════════ */

describe("Libro mayor: asientos del ciclo de vida de un pago", () => {
  it("el cobro confirmado reparte el total: pasajero −1100, conductora +950, MVC +150, y suma 0", async () => {
    const booking = await paidBooking(pool, app, world);
    const lines = (
      await pool.query<{ account: string; user_id: string | null; amount_cents: string; kind: string }>(
        `select e.account, e.user_id, e.amount_cents::text, t.kind
           from ledger_entries e join ledger_transactions t on t.id=e.transaction_id
          where t.payment_id=$1 order by e.id`,
        [booking.paymentId]
      )
    ).rows;
    assert.deepEqual(
      lines.map(l => [l.kind, l.account, l.user_id, Number(l.amount_cents)]),
      [
        ["charge", "passenger", world.miguel.id, -1100],
        ["charge", "driver_payable", world.ana.id, 950],
        ["charge", "platform_revenue", null, 150]
      ]
    );
    assert.equal(await ledgerImbalance(pool), 0);
    // no se asientan líneas de importe 0 (procesamiento / impuestos)
    assert.equal(await countRows(pool, "ledger_entries", "account in ('processing_fees','tax_payable','suspense')"), 0);
    const tx = await pool.query(`select tx_key, booking_id from ledger_transactions where payment_id=$1`, [booking.paymentId]);
    assert.equal(tx.rows[0].tx_key, `charge:${booking.paymentId}`);
    assert.equal(tx.rows[0].booking_id, booking.bookingId);
  });

  it("procesamiento e impuestos con importe > 0 se asientan en sus cuentas y el total sigue sumando 0", async () => {
    await paidBooking(pool, app, world, {
      quote: {
        contributionCents: 1000,
        passengerCommissionCents: 100,
        driverCommissionCents: 50,
        processingCents: 30,
        taxesCents: 21,
        totalCents: 1151,
        driverNetCents: 950
      }
    });
    assert.equal(await accountNet(pool, "passenger", world.miguel.id), -1151);
    assert.equal(await accountNet(pool, "driver_payable", world.ana.id), 950);
    assert.equal(await accountNet(pool, "platform_revenue"), 150);
    assert.equal(await accountNet(pool, "processing_fees"), 30);
    assert.equal(await accountNet(pool, "tax_payable"), 21);
    assert.equal(await ledgerImbalance(pool), 0);
  });

  it("reproducir el mismo evento firmado no duplica el cobro en el libro", async () => {
    const booking = await paidBooking(pool, app, world);
    const before = await countRows(pool, "ledger_entries");
    const replay = await postWebhook(app, [succeededEvent(booking.providerRef, TEST_QUOTE.totalCents)]);
    assert.equal(replay.statusCode, 200);
    assert.equal(await countRows(pool, "ledger_entries"), before);
    assert.equal(await accountNet(pool, "driver_payable", world.ana.id), 950);
  });

  it("devolución parcial aprobada (500 de 1100): reparto proporcional, deuda con el pasajero y pasajero intacto hasta ejecutarse", async () => {
    const { booking, refundId } = await cancelledBooking();
    await approveRefund(refundId, 500);
    // reparto por mayor resto: 500 sobre [950, 150] → conductora −432, MVC −68
    assert.equal(await accountNet(pool, "driver_payable", world.ana.id), 950 - 432);
    assert.equal(await accountNet(pool, "platform_revenue"), 150 - 68);
    assert.equal(await accountNet(pool, "refund_payable", world.miguel.id), 500);
    assert.equal(await accountNet(pool, "passenger", world.miguel.id), -1100);
    assert.equal(await ledgerImbalance(pool), 0);

    await confirmRefund(booking, refundId, 500);
    assert.equal(await accountNet(pool, "refund_payable", world.miguel.id), 0);
    assert.equal(await accountNet(pool, "passenger", world.miguel.id), -600);
    assert.equal(await ledgerImbalance(pool), 0);
  });

  it("devolución íntegra ejecutada: pasajero, deuda y todas las cuentas del cobro quedan a 0", async () => {
    const { booking, refundId } = await cancelledBooking();
    await approveRefund(refundId, 1100);
    await confirmRefund(booking, refundId, 1100);
    for (const account of ["passenger", "driver_payable", "platform_revenue", "refund_payable"]) {
      assert.equal(await accountNet(pool, account), 0, account);
    }
    assert.equal(await ledgerImbalance(pool), 0);
  });

  it("una devolución aprobada pero NO ejecutada deja la deuda abierta y nunca toca al pasajero", async () => {
    const { refundId } = await cancelledBooking();
    await approveRefund(refundId, 300);
    assert.equal(await accountNet(pool, "refund_payable", world.miguel.id), 300);
    assert.equal(await accountNet(pool, "passenger", world.miguel.id), -1100);
    assert.equal(await countRows(pool, "ledger_transactions", "kind='refund_executed'"), 0);
  });

  it("el abono de la liquidación se asienta como driver_payable → external_payout", async () => {
    // (el ciclo completo de liquidaciones se prueba en money-reports.integration.test.ts; aquí, solo el asiento)
    const booking = await paidBooking(pool, app, world);
    await completeTrip(pool, booking.tripId);
    const run = (
      await pool.query<{ id: string }>(
        `insert into payout_runs(driver_user_id,period_month,status,net_cents,bookings_count)
         values($1,date_trunc('month', now() at time zone 'Europe/Madrid')::date,'processing',950,1) returning id`,
        [world.ana.id]
      )
    ).rows[0]!.id;
    await inTransaction(pool, client => postPayout(client, { payoutRunId: run, driverUserId: world.ana.id, amountCents: 950 }));
    assert.equal(await accountNet(pool, "driver_payable", world.ana.id), 0);
    assert.equal(await accountNet(pool, "external_payout", world.ana.id), 950);
    assert.equal(await ledgerImbalance(pool), 0);
  });
});

/* ═════════════════════════ Propiedades con datos aleatorios reproducibles ═════════════════════════ */

describe("Libro mayor: propiedades (semillas fijas, reproducibles)", () => {
  it("allocateProRata: suma exacta, ninguna parte supera su peso, determinista (5.000 casos)", () => {
    const rng = mulberry32(20260709);
    for (let i = 0; i < 5000; i += 1) {
      const parts = Array.from({ length: 1 + Math.floor(rng() * 5) }, () => Math.floor(rng() * 4000));
      const total = parts.reduce((a, b) => a + b, 0);
      const amount = total === 0 ? 0 : Math.floor(rng() * (total + 1));
      const shares = allocateProRata(amount, parts);
      assert.equal(shares.reduce((a, b) => a + b, 0), amount, `suma ${JSON.stringify({ amount, parts })}`);
      shares.forEach((share, index) => {
        assert.ok(share >= 0 && share <= parts[index]!, `parte ${index} ${JSON.stringify({ amount, parts, shares })}`);
      });
      assert.deepEqual(allocateProRata(amount, parts), shares);
    }
  });

  for (const seed of [20260709, 424242]) {
    it(`pagos y devoluciones aleatorias (semilla ${seed}): cada transacción suma 0 y los saldos por pago cuadran`, async () => {
      const rng = mulberry32(seed);
      const between = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
      type Expected = { paymentId: string; total: number; approved: number; executed: number };
      const expected: Expected[] = [];

      for (let i = 0; i < 8; i += 1) {
        const contribution = between(100, 5000);
        const passengerCommission = between(0, 300);
        const driverCommission = between(0, Math.min(contribution, 200));
        const processing = between(0, 50);
        const taxes = between(0, 80);
        const total = contribution + passengerCommission + processing + taxes;
        const passenger = await createActor(pool, `Pasajero ${i}`, ["passenger"]);
        const booking = await paidBooking(pool, app, world, {
          passenger,
          quote: {
            contributionCents: contribution,
            passengerCommissionCents: passengerCommission,
            driverCommissionCents: driverCommission,
            processingCents: processing,
            taxesCents: taxes,
            totalCents: total,
            driverNetCents: contribution - driverCommission
          }
        });
        const entry: Expected = { paymentId: booking.paymentId, total, approved: 0, executed: 0 };
        expected.push(entry);
        if (rng() < 0.75) {
          const cancelled = await apiCall(app, passenger, "POST", `/v1/bookings/${booking.bookingId}/cancel`, { reason: "other" });
          assert.equal(cancelled.response.statusCode, 200, cancelled.response.body);
          const refundId = cancelled.json.refund.id as string;
          const amount = between(1, total);
          await approveRefund(refundId, amount);
          entry.approved = amount;
          if (rng() < 0.6) {
            await confirmRefund(booking, refundId, amount);
            entry.executed = amount;
          }
        }
      }

      assert.equal(await ledgerImbalance(pool), 0, `semilla ${seed}`);
      const perPayment = await pool.query<{ payment_id: string; passenger: string; held: string; refund_payable: string }>(
        `select t.payment_id,
                coalesce(sum(e.amount_cents) filter (where e.account='passenger'),0)::text as passenger,
                coalesce(sum(e.amount_cents) filter (where e.account in ('driver_payable','platform_revenue','processing_fees','tax_payable','suspense')),0)::text as held,
                coalesce(sum(e.amount_cents) filter (where e.account='refund_payable'),0)::text as refund_payable
           from ledger_entries e join ledger_transactions t on t.id=e.transaction_id
          where t.payment_id is not null group by t.payment_id`
      );
      const byPayment = new Map(perPayment.rows.map(r => [r.payment_id, r]));
      assert.equal(byPayment.size, expected.length);
      for (const e of expected) {
        const row = byPayment.get(e.paymentId)!;
        const tag = `semilla ${seed} pago ${e.paymentId}`;
        assert.equal(Number(row.passenger), -(e.total - e.executed), `${tag}: pasajero`);
        assert.equal(Number(row.held), e.total - e.approved, `${tag}: dinero retenido por MVC`);
        assert.equal(Number(row.refund_payable), e.approved - e.executed, `${tag}: deuda con el pasajero`);
      }
      // ningún componente del cobro queda en negativo por el reparto proporcional
      const negative = await pool.query(
        `select t.payment_id, e.account, e.user_id, sum(e.amount_cents) as balance
           from ledger_entries e join ledger_transactions t on t.id=e.transaction_id
          where t.payment_id is not null and e.account in ('driver_payable','platform_revenue','processing_fees','tax_payable','suspense')
          group by t.payment_id, e.account, e.user_id having sum(e.amount_cents) < 0`
      );
      assert.equal(negative.rowCount, 0, `semilla ${seed}: componentes negativos ${JSON.stringify(negative.rows)}`);
      // a nivel plataforma
      const collected = expected.reduce((s, e) => s + e.total, 0);
      const executed = expected.reduce((s, e) => s + e.executed, 0);
      assert.equal(await accountNet(pool, "passenger"), -(collected - executed));
    });
  }
});

/* ═════════════════════════ Recibos ═════════════════════════ */

describe("Recibos: emisión, estructura y numeración", () => {
  it("el recibo de pago solo existe tras el evento firmado, nunca antes", async () => {
    const tariff = await ensureTariff(pool);
    const tripId = await seedTrip(pool, world);
    const { requestId } = await seedPayableRequest(pool, tripId, world.miguel, { tariffId: tariff });
    const intent = await createIntent(app, world.miguel, requestId);
    assert.equal(intent.response.statusCode, 201, intent.response.body);

    const before = await apiCall(app, world.miguel, "GET", "/v1/me/receipts");
    assert.deepEqual(before.json, { items: [], nextCursor: null });

    const providerRef = await scalar<string>(pool, `select provider_payment_ref from payments where id=$1`, [intent.json.payment.id]);
    const hook = await postWebhook(app, [succeededEvent(providerRef, TEST_QUOTE.totalCents)]);
    assert.equal(hook.statusCode, 200, hook.body);

    const after = await apiCall(app, world.miguel, "GET", "/v1/me/receipts");
    assert.equal(after.json.items.length, 1);
    assert.equal(after.json.items[0].kind, "payment");
  });

  it("estructura del recibo de pago: número anual, líneas que suman el total, no fiscal y contraparte", async () => {
    const booking = await paidBooking(pool, app, world);
    const year = await madridYear(pool);
    const list = await apiCall(app, world.miguel, "GET", "/v1/me/receipts");
    const summary = list.json.items[0];
    assert.equal(summary.number, `MVC-J-${year}-000001`);
    assert.equal(summary.kind, "payment");
    assert.deepEqual(summary.total, { cents: 1100, currency: "EUR", status: "defined" });
    assert.equal(summary.bookingId, booking.bookingId);
    assert.equal(summary.paymentId, booking.paymentId);
    assert.equal(summary.counterpart.firstName, "Ana");
    assert.equal(summary.trip.originLabel, "Sevilla Centro");
    assert.equal(summary.trip.destinationLabel, "Isla Mágica");

    const detail = await apiCall(app, world.miguel, "GET", `/v1/me/receipts/${summary.id}`);
    assert.equal(detail.response.statusCode, 200, detail.response.body);
    assert.equal(detail.json.fiscalInvoice, false);
    assert.match(detail.json.notice, /no fiscal/i);
    assert.match(detail.json.notice, /No es una factura/);
    assert.deepEqual(
      detail.json.lines.map((l: any) => [l.key, l.amount.cents, l.amount.status]),
      [
        ["contribution", 1000, "defined"],
        ["platform_fee", 100, "defined"]
      ]
    );
    const lineSum = detail.json.lines.reduce((s: number, l: any) => s + l.amount.cents, 0);
    assert.equal(lineSum, detail.json.total.cents);
    // nunca datos del proveedor ni del método de pago
    assert.doesNotMatch(detail.response.body, /pi_stub|cs_stub|tok_|stubpay/);
  });

  it("procesamiento e impuestos aparecen como líneas solo si son mayores que 0", async () => {
    await paidBooking(pool, app, world, {
      quote: {
        contributionCents: 1000,
        passengerCommissionCents: 100,
        driverCommissionCents: 50,
        processingCents: 30,
        taxesCents: 21,
        totalCents: 1151,
        driverNetCents: 950
      }
    });
    const list = await apiCall(app, world.miguel, "GET", "/v1/me/receipts");
    const detail = await apiCall(app, world.miguel, "GET", `/v1/me/receipts/${list.json.items[0].id}`);
    assert.deepEqual(
      detail.json.lines.map((l: any) => [l.key, l.amount.cents]),
      [["contribution", 1000], ["platform_fee", 100], ["processing", 30], ["taxes", 21]]
    );
    assert.equal(detail.json.total.cents, 1151);
  });

  it("el recibo de devolución se emite al confirmar el proveedor (no al aprobar) y es de tipo refund", async () => {
    const { booking, refundId } = await cancelledBooking();
    await approveRefund(refundId, 500);
    const mid = await apiCall(app, world.miguel, "GET", "/v1/me/receipts?kind=refund");
    assert.deepEqual(mid.json.items, [], "aprobada, pero el proveedor aún no ha confirmado");

    await confirmRefund(booking, refundId, 500);
    const done = await apiCall(app, world.miguel, "GET", "/v1/me/receipts?kind=refund");
    assert.equal(done.json.items.length, 1);
    const refundReceipt = done.json.items[0];
    assert.deepEqual(refundReceipt.total, { cents: 500, currency: "EUR", status: "defined" });
    assert.equal(refundReceipt.bookingId, booking.bookingId);
    const detail = await apiCall(app, world.miguel, "GET", `/v1/me/receipts/${refundReceipt.id}`);
    assert.deepEqual(detail.json.lines.map((l: any) => [l.key, l.amount.cents]), [["refund", 500]]);
    assert.match(detail.json.notice, /devolución/i);
    assert.match(detail.json.notice, /No es una factura/);
    // la numeración sigue a la del pago
    const year = await madridYear(pool);
    assert.equal(refundReceipt.number, `MVC-J-${year}-000002`);
  });

  it("filtro por tipo, paginación por cursor sin repetidos y validación de entradas", async () => {
    const { booking, refundId } = await cancelledBooking();
    await approveRefund(refundId, 400);
    await confirmRefund(booking, refundId, 400);

    const all = await apiCall(app, world.miguel, "GET", "/v1/me/receipts");
    assert.deepEqual(all.json.items.map((r: any) => r.kind), ["refund", "payment"], "más reciente primero");
    const onlyPayment = await apiCall(app, world.miguel, "GET", "/v1/me/receipts?kind=payment");
    assert.deepEqual(onlyPayment.json.items.map((r: any) => r.kind), ["payment"]);
    const onlyStatement = await apiCall(app, world.miguel, "GET", "/v1/me/receipts?kind=earning_statement");
    assert.deepEqual(onlyStatement.json.items, []);

    const pageOne = await apiCall(app, world.miguel, "GET", "/v1/me/receipts?limit=1");
    assert.equal(pageOne.json.items.length, 1);
    assert.ok(pageOne.json.nextCursor);
    const pageTwo = await apiCall(app, world.miguel, "GET", `/v1/me/receipts?limit=1&cursor=${pageOne.json.nextCursor}`);
    assert.equal(pageTwo.json.items.length, 1);
    assert.notEqual(pageTwo.json.items[0].id, pageOne.json.items[0].id);
    assert.equal(pageTwo.json.nextCursor, null);

    for (const url of ["/v1/me/receipts?kind=factura", "/v1/me/receipts?limit=0", "/v1/me/receipts?limit=51", "/v1/me/receipts?cursor=%25%25"]) {
      const bad = await apiCall(app, world.miguel, "GET", url);
      assert.equal(bad.response.statusCode, 400, url);
      assert.equal(bad.json.error.code, "VALIDATION_ERROR", url);
    }
  });

  it("solo el propietario ve un recibo: el resto recibe 404 (y sin sesión, 401)", async () => {
    const booking = await paidBooking(pool, app, world);
    const receiptId = (await apiCall(app, world.miguel, "GET", "/v1/me/receipts")).json.items[0].id as string;
    for (const intruder of [world.lucia, world.ana, world.finance, world.admin]) {
      for (const suffix of ["", "/printable"]) {
        const result = await apiCall(app, intruder, "GET", `/v1/me/receipts/${receiptId}${suffix}`);
        assert.equal(result.response.statusCode, 404, `${intruder.name}${suffix}`);
        assert.equal(result.json.error.code, "RECEIPT_NOT_FOUND");
      }
      const list = await apiCall(app, intruder, "GET", "/v1/me/receipts");
      assert.deepEqual(list.json.items, [], `${intruder.name} no ve recibos ajenos en su lista`);
    }
    assert.equal((await apiCall(app, null, "GET", `/v1/me/receipts/${receiptId}`)).response.statusCode, 401);
    assert.equal((await apiCall(app, null, "GET", "/v1/me/receipts")).response.statusCode, 401);
    assert.equal((await apiCall(app, world.miguel, "GET", "/v1/me/receipts/no-es-uuid")).response.statusCode, 400);
    assert.equal((await apiCall(app, world.miguel, "GET", `/v1/me/receipts/${booking.paymentId}`)).response.statusCode, 404, "un id de otro tipo de objeto no resuelve");
  });

  it("la conductora no recibe el recibo de pago del pasajero (solo su resumen de liquidación cuando se abone)", async () => {
    await paidBooking(pool, app, world);
    const driverList = await apiCall(app, world.ana, "GET", "/v1/me/receipts");
    assert.deepEqual(driverList.json.items, []);
  });
});

describe("Recibos: versión imprimible", () => {
  it("es HTML autocontenido, sin scripts ni recursos externos, con cabeceras de seguridad", async () => {
    await paidBooking(pool, app, world);
    const receiptId = (await apiCall(app, world.miguel, "GET", "/v1/me/receipts")).json.items[0].id as string;
    const response = await app.inject({ method: "GET", url: `/v1/me/receipts/${receiptId}/printable`, headers: bearer(world.miguel) });
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers["content-type"]), /^text\/html/);
    assert.equal(response.headers["cache-control"], "private, no-store");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.match(String(response.headers["content-security-policy"]), /default-src 'none'/);
    const html = response.body;
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /MVC-J-\d{4}-000001/);
    assert.match(html, /No es una factura/);
    assert.match(html, /Sevilla Centro/);
    assert.match(html, /11,00\s?€/);
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /\b(src|href)=/i);
    assert.doesNotMatch(html, /https?:\/\//i);
  });

  it("escapa los datos variables: etiquetas de parada y nombre de la conductora no inyectan HTML", async () => {
    const tariff = await ensureTariff(pool);
    const tripId = await seedTrip(pool, world);
    await pool.query(`update trip_stops set label=$2 where trip_id=$1 and seq=0`, [tripId, `<script>alert("x")</script> & "Sevilla"`]);
    await pool.query(`update trip_stops set label=$2 where trip_id=$1 and seq=2`, [tripId, `<img src=x onerror=alert(1)>`]);
    await pool.query(`update profiles set display_name=$2 where user_id=$1`, [world.ana.id, `<b>Ana</b> García`]);
    const { requestId } = await seedPayableRequest(pool, tripId, world.miguel, { tariffId: tariff });
    const intent = await createIntent(app, world.miguel, requestId);
    const ref = await scalar<string>(pool, `select provider_payment_ref from payments where id=$1`, [intent.json.payment.id]);
    assert.equal((await postWebhook(app, [succeededEvent(ref, TEST_QUOTE.totalCents)])).statusCode, 200);

    const receiptId = (await apiCall(app, world.miguel, "GET", "/v1/me/receipts")).json.items[0].id as string;
    const html = (await app.inject({ method: "GET", url: `/v1/me/receipts/${receiptId}/printable`, headers: bearer(world.miguel) })).body;
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /<img/i);
    assert.doesNotMatch(html, /<b>/i);
    assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; &quot;Sevilla&quot;/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /Con &lt;b&gt;Ana&lt;\/b&gt;/);
  });
});

describe("Recibos: inmutabilidad y numeración correlativa sin huecos", () => {
  it("un recibo no se puede modificar ni borrar", async () => {
    await paidBooking(pool, app, world);
    await assert.rejects(pool.query(`update receipts set total_cents = 1`), isPg("55000", /MVC_APPEND_ONLY_TABLE/));
    await assert.rejects(pool.query(`delete from receipts`), isPg("55000", /MVC_APPEND_ONLY_TABLE/));
    assert.equal(await scalar<string>(pool, `select total_cents::text from receipts`), "1100");
  });

  it("el formato del número y la unicidad están garantizados por la base de datos", async () => {
    await paidBooking(pool, app, world);
    const row = (await pool.query(`select * from receipts limit 1`)).rows[0];
    await assert.rejects(
      pool.query(
        `insert into receipts(number,user_id,kind,payment_id,total_cents,lines) values('FACTURA-1',$1,'payment',null,5,'[]'::jsonb)`,
        [row.user_id]
      ),
      isPg("23514")
    );
    await assert.rejects(
      pool.query(`insert into receipts(number,user_id,kind,total_cents,lines) values($1,$2,'payment',5,'[]'::jsonb)`, [row.number, row.user_id]),
      isPg("23505")
    );
  });

  it("seis pagos confirmados a la vez producen los números 1..6 exactamente, sin huecos ni repetidos", async () => {
    const tariff = await ensureTariff(pool);
    const refs: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const passenger = await createActor(pool, `Viajero ${i}`, ["passenger"]);
      const tripId = await seedTrip(pool, world);
      const { requestId } = await seedPayableRequest(pool, tripId, passenger, { tariffId: tariff });
      const intent = await createIntent(app, passenger, requestId);
      assert.equal(intent.response.statusCode, 201, intent.response.body);
      refs.push(await scalar<string>(pool, `select provider_payment_ref from payments where id=$1`, [intent.json.payment.id]));
    }
    const responses = await Promise.all(refs.map(ref => postWebhook(app, [succeededEvent(ref, TEST_QUOTE.totalCents)])));
    assert.deepEqual(responses.map(r => r.statusCode), [200, 200, 200, 200, 200, 200], responses.map(r => r.body).join("\n"));

    const year = await madridYear(pool);
    const numbers = (await pool.query<{ number: string }>(`select number from receipts order by number`)).rows.map(r => r.number);
    assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6].map(n => `MVC-J-${year}-${String(n).padStart(6, "0")}`));
    assert.equal(await scalar<number>(pool, `select last_value from receipt_counters where year=$1`, [year]), 6);
  });

  it("una emisión revertida no consume número y reemitir el mismo recibo es idempotente", async () => {
    const { booking, refundId } = await cancelledBooking(); // recibo de pago nº 1
    const input = {
      userId: world.miguel.id,
      kind: "refund" as const,
      paymentId: booking.paymentId,
      bookingId: booking.bookingId,
      refundRequestId: refundId,
      counterpartUserId: world.ana.id,
      totalCents: 500,
      lines: [{ key: "refund" as const, cents: 500 }],
      trip: null
    };
    const year = await madridYear(pool);

    // 1) la transacción que emite el recibo se revierte: ni recibo ni número consumido
    const client = await pool.connect();
    let rolledBackId: string;
    try {
      await client.query("begin");
      rolledBackId = await issueReceipt(client, input);
      await client.query("rollback");
    } finally {
      client.release();
    }
    assert.equal(await countRows(pool, "receipts", "id=$1", [rolledBackId]), 0);
    assert.equal(await scalar<number>(pool, `select last_value from receipt_counters where year=$1`, [year]), 1);

    // 2) confirmada: recibe el nº 2, sin hueco
    const issued = await inTransaction(pool, client2 => issueReceipt(client2, input));
    assert.equal(await scalar<string>(pool, `select number from receipts where id=$1`, [issued]), `MVC-J-${year}-000002`);

    // 3) reemitir el mismo (tipo, objeto) devuelve el existente y no gasta número
    const again = await inTransaction(pool, client3 => issueReceipt(client3, input));
    assert.equal(again, issued);
    assert.equal(await scalar<number>(pool, `select last_value from receipt_counters where year=$1`, [year]), 2);
    assert.equal(await countRows(pool, "receipts"), 2);
  });
});
