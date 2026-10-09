/**
 * Servidor simulado de «pagos y cobros»: resúmenes, listas paginadas, métodos de pago, justificantes, liquidaciones y
 * devoluciones contra el mundo sembrado. Se ejecuta con:
 * `node --import tsx --test "src/features/account/preview/money.test.ts"` (desde `mobile/`).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asArray, asRecord, createApi, num, str, testRuntime, tokenFor } from "@/preview/testing/harness";

type Profile = "new" | "passenger" | "driver";

const MAY_14 = "2025-05-14T07:37:00+02:00";
const MAY_15 = "2025-05-15T07:37:00+02:00";

function world(options: { profile?: Profile; seed?: string; clock?: string; user?: "ana" | "miguel" | "laura" } = {}) {
  const rt = testRuntime({ profile: options.profile ?? "passenger", seed: options.seed ?? "money-con-importes", ...(options.clock ? { clock: options.clock } : {}) });
  const token = options.user !== undefined ? tokenFor(rt, options.user) : rt.sessionToken();
  const raw = createApi(rt);
  const api = <T = unknown>(method: string, path: string, init: { body?: unknown; headers?: Record<string, string> } = {}) =>
    raw<T>(method, path, { token, ...init });
  return { rt, api, anonymous: raw };
}

function codeOf(body: unknown): string {
  return str(asRecord(asRecord(body).error).code, "error.code");
}

const RANDOM_UUID = "7b0f3c1e-5d2a-4f6b-9a1c-0d3e5f7a9b1c";

describe("GET /v1/me/payments/passenger-summary", () => {
  it("lámina 33b: 24,00 € ilustrativos pendientes este mes, 2 próximos viajes y las dos filas", async () => {
    const { api } = world({ clock: MAY_14 });
    const res = await api("GET", "/v1/me/payments/passenger-summary");
    assert.equal(res.status, 200);
    const body = asRecord(res.body);
    assert.equal(body.month, "2025-05");
    const pending = asRecord(body.pendingThisMonth);
    assert.equal(pending.cents, 2400);
    assert.equal(pending.status, "illustrative");
    assert.equal(body.upcomingTripsCount, 2);
    const recent = asArray(body.recent).map((item) => asRecord(item));
    assert.equal(recent.length, 2);
    assert.equal(recent[0]?.state, "pending");
    assert.equal(recent[0]?.kind, "pending_request");
    assert.equal(recent[1]?.state, "paid");
    assert.equal(recent[1]?.kind, "payment");
    assert.equal(asRecord(recent[0]?.driver).firstName, "Ana");
    assert.equal(asRecord(asRecord(recent[0]?.trip)).originLabel, "Sevilla");
    assert.equal(asRecord(asRecord(recent[0]?.trip)).destinationLabel, "Camas");
    const method = asRecord(body.paymentMethod);
    assert.equal(method.maskedLabel, "ES** **** **** 4589");
    assert.equal(asRecord(body.platformCommission).status, "pending_definition");
    assert.equal(asRecord(body.availability).enabled, true);
  });

  it("lámina 33a: sin tarifa los importes son «Por definir», nunca un importe inventado", async () => {
    const { api } = world({ seed: "money-resumen", clock: "2025-05-19T09:41:00+02:00" });
    const body = asRecord((await api("GET", "/v1/me/payments/passenger-summary")).body);
    const pending = asRecord(body.pendingThisMonth);
    assert.equal(pending.cents, null);
    assert.equal(pending.status, "pending_definition");
    assert.equal(body.upcomingTripsCount, 2);
    for (const item of asArray(body.recent).map((row) => asRecord(row))) {
      assert.equal(asRecord(item.amount).status, "pending_definition");
      assert.equal(asRecord(item.amount).cents, null);
    }
  });

  it("sin pagos: 0,00 € definido (no «por definir») y nada que listar", async () => {
    const { api } = world({ seed: "money-vacio" });
    const body = asRecord((await api("GET", "/v1/me/payments/passenger-summary")).body);
    assert.deepEqual(body.pendingThisMonth, { cents: 0, status: "defined", currency: "EUR" });
    assert.equal(body.upcomingTripsCount, 0);
    assert.deepEqual(body.recent, []);
    assert.equal(body.paymentMethod, null);
  });

  it("estado real actual: proveedor desactivado y mensaje «Pagos aún no disponibles»", async () => {
    const { api } = world({ seed: "money-sin-proveedor" });
    const body = asRecord((await api("GET", "/v1/me/payments/passenger-summary")).body);
    const availability = asRecord(body.availability);
    assert.equal(availability.enabled, false);
    assert.equal(availability.status, "provider_disabled");
    assert.equal(availability.message, "Pagos aún no disponibles");
    assert.deepEqual(availability.chargeMethods, []);
    assert.equal(body.paymentMethod, null);
  });

  it("valida el mes (YYYY-MM) y exige sesión", async () => {
    const { api, anonymous } = world();
    assert.equal((await api("GET", "/v1/me/payments/passenger-summary?month=2025-13")).status, 400);
    assert.equal((await api("GET", "/v1/me/payments/passenger-summary?month=mayo")).status, 400);
    assert.equal((await api("GET", "/v1/me/payments/passenger-summary?month=2025-04")).status, 200);
    assert.equal((await anonymous("GET", "/v1/me/payments/passenger-summary")).status, 401);
  });

  it("un mes sin viajes devuelve 0,00 € definido y cero viajes", async () => {
    const { api } = world({ clock: MAY_14 });
    const body = asRecord((await api("GET", "/v1/me/payments/passenger-summary?month=2025-03")).body);
    assert.equal(body.month, "2025-03");
    assert.equal(asRecord(body.pendingThisMonth).cents, 0);
    assert.equal(body.upcomingTripsCount, 0);
  });
});

describe("GET /v1/me/payments/driver-summary", () => {
  it("lámina 34b: 48,00 € a cobrar, 4 viajes y los cuatro últimos cobros", async () => {
    const { api } = world({ profile: "driver", clock: MAY_15 });
    const res = await api("GET", "/v1/me/payments/driver-summary");
    assert.equal(res.status, 200);
    const body = asRecord(res.body);
    const toCollect = asRecord(body.toCollectThisMonth);
    assert.equal(toCollect.cents, 4800);
    assert.equal(toCollect.status, "illustrative");
    assert.equal(body.completedTripsCount, 4);
    const next = asRecord(body.nextPayout);
    assert.equal(next.status, "pending_definition");
    assert.equal(next.date, null);
    const recent = asArray(body.recent).map((item) => asRecord(item));
    assert.equal(recent.length, 4);
    assert.deepEqual(
      recent.map((item) => asRecord(asRecord(item.trip)).destinationLabel),
      ["Tomares", "Bormujos", "Camas", "San Juan"],
    );
    assert.ok(recent.every((item) => item.state === "paid_out"));
    assert.equal(asRecord(body.payoutAccount).maskedLabel, "ES** **** **** 4589");
  });

  it("la persona cuenta en su propio mundo: otra cuenta no ve los cobros de Ana", async () => {
    const { api } = world({ profile: "driver", clock: MAY_15, user: "laura" });
    const body = asRecord((await api("GET", "/v1/me/payments/driver-summary")).body);
    assert.equal(body.completedTripsCount, 0);
    assert.deepEqual(body.recent, []);
  });
});

describe("listas paginadas: pagos y cobros", () => {
  it("recorre las 42 filas del historial largo con el cursor, sin repetir ni perder ninguna", async () => {
    const { api } = world({ seed: "money-historial-largo" });
    const keys: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const path: string = cursor === null ? "/v1/me/payments?limit=20" : `/v1/me/payments?limit=20&cursor=${encodeURIComponent(cursor)}`;
      const res = await api("GET", path);
      assert.equal(res.status, 200);
      const body = asRecord(res.body);
      for (const item of asArray(body.items)) keys.push(str(asRecord(item).key));
      cursor = body.nextCursor === null || body.nextCursor === undefined ? null : str(body.nextCursor);
      pages += 1;
      assert.ok(pages < 10, "no debe haber más páginas de las esperadas");
    } while (cursor !== null);
    assert.equal(keys.length, 42);
    assert.equal(new Set(keys).size, 42);
    assert.equal(pages, 3);
  });

  it("filtra por estado y valida el filtro y el límite", async () => {
    const { api } = world({ seed: "money-historial-largo" });
    const failed = asRecord((await api("GET", "/v1/me/payments?state=failed")).body);
    const items = asArray(failed.items).map((item) => asRecord(item));
    assert.ok(items.length > 0);
    assert.ok(items.every((item) => item.state === "failed"));
    assert.equal((await api("GET", "/v1/me/payments?state=hecho")).status, 400);
    assert.equal((await api("GET", "/v1/me/payments?limit=0")).status, 400);
    assert.equal((await api("GET", "/v1/me/payments?limit=51")).status, 400);
  });

  it("los cobros del conductor se filtran por estado", async () => {
    const { api } = world({ profile: "driver", seed: "money-historial-largo", user: "ana" });
    const all = asRecord((await api("GET", "/v1/me/earnings?limit=50")).body);
    const available = asRecord((await api("GET", "/v1/me/earnings?state=available&limit=50")).body);
    assert.ok(asArray(all.items).length > 0);
    assert.ok(asArray(available.items).map((item) => asRecord(item)).every((item) => item.state === "available"));
  });
});

describe("GET /v1/me/earnings/{bookingId}", () => {
  it("devuelve el desglose y un neto coherente; otra cuenta o un id inexistente reciben 404", async () => {
    const { api } = world({ profile: "driver", clock: MAY_15 });
    const list = asRecord((await api("GET", "/v1/me/earnings")).body);
    const first = asRecord(asArray(list.items)[0]);
    const detail = await api("GET", `/v1/me/earnings/${str(first.bookingId)}`);
    assert.equal(detail.status, 200);
    const lines = asRecord(asRecord(detail.body).lines);
    assert.equal(asRecord(lines.net).cents, 1200);
    assert.equal(asRecord(lines.contribution).status, "illustrative");
    assert.notEqual(asRecord(detail.body).payoutId, null);

    const other = world({ profile: "driver", clock: MAY_15, user: "laura" });
    assert.equal((await other.api("GET", `/v1/me/earnings/${str(first.bookingId)}`)).status, 404);
    const missing = await api("GET", `/v1/me/earnings/${RANDOM_UUID}`);
    assert.equal(missing.status, 404);
    assert.equal(codeOf(missing.body), "BOOKING_NOT_FOUND");
    assert.equal((await api("GET", "/v1/me/earnings/no-es-un-uuid")).status, 400);
  });
});

describe("métodos de pago", () => {
  const headers = (key: string) => ({ "idempotency-key": `test-${key}-0001` });

  it("con el proveedor desactivado el alta responde 409 PAYMENTS_PROVIDER_DISABLED y no guarda nada", async () => {
    const { api } = world({ seed: "money-sin-proveedor" });
    const res = await api("POST", "/v1/me/payment-methods", { headers: headers("k-1"), body: { purpose: "charge", providerToken: "tok_sim_visa_4242" } });
    assert.equal(res.status, 409);
    assert.equal(codeOf(res.body), "PAYMENTS_PROVIDER_DISABLED");
    const list = asRecord((await api("GET", "/v1/me/payment-methods")).body);
    assert.deepEqual(list.items, []);
    assert.equal(asRecord(list.availability).enabled, false);
  });

  it("un número de tarjeta nunca se acepta ni se guarda: 400 RAW_CARD_DATA_REJECTED", async () => {
    const { api } = world({ seed: "money-vacio" });
    for (const token of ["4242424242424242", "4242 4242 4242 4242", "4242-4242-4242-4242"]) {
      const res = await api("POST", "/v1/me/payment-methods", { headers: headers(`k-${token.length}`), body: { purpose: "charge", providerToken: token } });
      assert.equal(res.status, 400, token);
      assert.equal(codeOf(res.body), "RAW_CARD_DATA_REJECTED");
    }
    assert.deepEqual(asRecord((await api("GET", "/v1/me/payment-methods")).body).items, []);
  });

  it("exige Idempotency-Key y valida el cuerpo", async () => {
    const { api } = world({ seed: "money-vacio" });
    const noKey = await api("POST", "/v1/me/payment-methods", { body: { purpose: "charge", providerToken: "tok_sim_visa_4242" } });
    assert.equal(noKey.status, 400);
    assert.equal(codeOf(noKey.body), "IDEMPOTENCY_KEY_REQUIRED");
    assert.equal((await api("POST", "/v1/me/payment-methods", { headers: headers("k-2"), body: { purpose: "otro", providerToken: "tok_sim_visa_4242" } })).status, 400);
    assert.equal((await api("POST", "/v1/me/payment-methods", { headers: headers("k-3"), body: { purpose: "charge" } })).status, 400);
    const unknown = await api("POST", "/v1/me/payment-methods", { headers: headers("k-4"), body: { purpose: "charge", providerToken: "tok_desconocido" } });
    assert.equal(unknown.status, 409);
    assert.equal(codeOf(unknown.body), "PAYMENT_METHOD_NOT_AVAILABLE");
  });

  it("añade, reintenta con la misma clave sin duplicar, cambia el predeterminado y lo reasigna al quitarlo", async () => {
    const { api } = world({ seed: "money-vacio" });
    const first = await api("POST", "/v1/me/payment-methods", { headers: headers("k-visa"), body: { purpose: "charge", providerToken: "tok_sim_visa_4242" } });
    assert.equal(first.status, 201);
    const visa = asRecord(first.body);
    assert.equal(visa.kind, "card");
    assert.equal(visa.brand, "Visa");
    assert.equal(visa.maskedLabel, "•••• 4242");
    assert.equal(visa.isDefault, true);
    assert.equal(JSON.stringify(first.body).includes("tok_sim"), false, "el token del proveedor no se expone");

    const retry = await api("POST", "/v1/me/payment-methods", { headers: headers("k-visa"), body: { purpose: "charge", providerToken: "tok_sim_visa_4242" } });
    assert.equal(asRecord(retry.body).id, visa.id);

    const second = await api("POST", "/v1/me/payment-methods", {
      headers: headers("k-master"),
      body: { purpose: "charge", providerToken: "tok_sim_mastercard_4444", setAsDefault: true },
    });
    assert.equal(second.status, 201);
    const master = asRecord(second.body);
    assert.equal(master.isDefault, true);
    const afterAdd = asArray(asRecord((await api("GET", "/v1/me/payment-methods?purpose=charge")).body).items).map((item) => asRecord(item));
    assert.equal(afterAdd.length, 2);
    assert.deepEqual(afterAdd.filter((item) => item.isDefault).map((item) => item.brand), ["Mastercard"]);

    const removed = await api("DELETE", `/v1/me/payment-methods/${str(master.id)}`);
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body, { removed: true });
    const afterRemove = asArray(asRecord((await api("GET", "/v1/me/payment-methods")).body).items).map((item) => asRecord(item));
    assert.equal(afterRemove.length, 1);
    assert.equal(afterRemove[0]?.isDefault, true);
    assert.equal(afterRemove[0]?.brand, "Visa");

    const again = await api("DELETE", `/v1/me/payment-methods/${str(master.id)}`);
    assert.equal(again.status, 404);
    assert.equal(codeOf(again.body), "PAYMENT_METHOD_NOT_FOUND");
  });

  it("una cuenta bancaria sirve para cobrar y una tarjeta no", async () => {
    const { api } = world({ profile: "driver", seed: "money-vacio", user: "ana" });
    const card = await api("POST", "/v1/me/payment-methods", { headers: headers("k-pc"), body: { purpose: "payout", providerToken: "tok_sim_visa_4242" } });
    assert.equal(card.status, 409);
    assert.equal(codeOf(card.body), "PAYMENT_METHOD_NOT_AVAILABLE");
    const bank = await api("POST", "/v1/me/payment-methods", { headers: headers("k-pb"), body: { purpose: "payout", providerToken: "tok_sim_sepa_4589" } });
    assert.equal(bank.status, 201);
    assert.equal(asRecord(bank.body).kind, "bank_account");
    const asCharge = await api("POST", "/v1/me/payment-methods", { headers: headers("k-cb"), body: { purpose: "charge", providerToken: "tok_sim_sepa_4589" } });
    assert.equal(asCharge.status, 201);
    assert.equal(asRecord(asCharge.body).kind, "sepa_debit");
  });

  it("no se puede quitar el método de otra cuenta", async () => {
    const { rt, api } = world({ seed: "money-historial-largo" });
    const visa = asArray(asRecord((await api("GET", "/v1/me/payment-methods?purpose=charge")).body).items).map((item) => asRecord(item))[0];
    assert.ok(visa);
    const raw = createApi(rt);
    const res = await raw("DELETE", `/v1/me/payment-methods/${str(visa.id)}`, { token: tokenFor(rt, "laura") });
    assert.equal(res.status, 404);
  });
});

describe("justificantes", () => {
  it("lista paginada con filtro por tipo, numeración correlativa y sin facturas", async () => {
    const { api } = world({ seed: "money-historial-largo" });
    const all = asRecord((await api("GET", "/v1/me/receipts?limit=50")).body);
    const items = asArray(all.items).map((item) => asRecord(item));
    assert.ok(items.length >= 3);
    assert.ok(items.every((item) => /^MVC-J-\d{4}-\d{6}$/.test(str(item.number))));
    const numbers = items.map((item) => str(item.number)).sort();
    assert.equal(new Set(numbers).size, numbers.length);
    const refunds = asRecord((await api("GET", "/v1/me/receipts?kind=refund")).body);
    assert.ok(asArray(refunds.items).map((item) => asRecord(item)).every((item) => item.kind === "refund"));
    assert.equal((await api("GET", "/v1/me/receipts?kind=factura")).status, 400);
  });

  it("detalle estructurado: no fiscal, con líneas y total", async () => {
    const { api } = world({ seed: "money-historial-largo" });
    const first = asRecord(asArray(asRecord((await api("GET", "/v1/me/receipts?kind=payment")).body).items)[0]);
    const res = await api("GET", `/v1/me/receipts/${str(first.id)}`);
    assert.equal(res.status, 200);
    const receipt = asRecord(res.body);
    assert.equal(receipt.fiscalInvoice, false);
    assert.ok(asArray(receipt.lines).length >= 2);
    assert.match(str(receipt.notice), /no fiscal/i);
    assert.equal(asRecord(receipt.total).status, asRecord(first.total).status);
  });

  it("versión imprimible: documento HTML autocontenido con el aviso de justificante no fiscal y el texto escapado", async () => {
    const { api } = world({ seed: "money-historial-largo" });
    const first = asRecord(asArray(asRecord((await api("GET", "/v1/me/receipts?kind=payment")).body).items)[0]);
    const res = await api("GET", `/v1/me/receipts/${str(first.id)}/printable`);
    assert.equal(res.status, 200);
    const html = typeof res.body === "string" ? res.body : res.text;
    assert.match(html, /<!doctype html>/i);
    assert.ok(html.includes(str(first.number)));
    assert.match(html, /no es una factura|no fiscal/i);
    assert.equal(/<script/i.test(html), false);
  });

  it("404 para recibos de otra cuenta o inexistentes", async () => {
    const { rt, api } = world({ seed: "money-historial-largo" });
    const first = asRecord(asArray(asRecord((await api("GET", "/v1/me/receipts")).body).items)[0]);
    const raw = createApi(rt);
    for (const suffix of ["", "/printable"]) {
      const foreign = await raw("GET", `/v1/me/receipts/${str(first.id)}${suffix}`, { token: tokenFor(rt, "laura") });
      assert.equal(foreign.status, 404);
      assert.equal(codeOf(foreign.body), "RECEIPT_NOT_FOUND");
      const missing = await api("GET", `/v1/me/receipts/${RANDOM_UUID}${suffix}`);
      assert.equal(missing.status, 404);
    }
  });
});

describe("liquidaciones", () => {
  it("lista con calendario «por definir», próximo abono sin fecha y cuenta de cobro", async () => {
    const { api } = world({ profile: "driver", clock: MAY_15 });
    const res = await api("GET", "/v1/me/payouts");
    assert.equal(res.status, 200);
    const body = asRecord(res.body);
    const items = asArray(body.items).map((item) => asRecord(item));
    assert.equal(items.length, 2);
    assert.ok(items.every((item) => item.status === "paid"));
    const schedule = asRecord(body.schedule);
    assert.equal(schedule.frequency, "monthly");
    assert.equal(schedule.dayStatus, "pending_definition");
    assert.equal(schedule.dayOfMonth, null);
    assert.equal(asRecord(body.nextPayout).status, "pending_definition");
    assert.equal(asRecord(body.payoutAccount).kind, "bank_account");
  });

  it("detalle con los viajes incluidos; otra cuenta recibe 404", async () => {
    const { api } = world({ profile: "driver", clock: MAY_15 });
    const first = asRecord(asArray(asRecord((await api("GET", "/v1/me/payouts")).body).items)[0]);
    const detail = asRecord((await api("GET", `/v1/me/payouts/${str(first.id)}`)).body);
    assert.equal(asArray(detail.items).length, num(first.bookingsCount));
    const other = world({ profile: "driver", clock: MAY_15, user: "laura" });
    const foreign = await other.api("GET", `/v1/me/payouts/${str(first.id)}`);
    assert.equal(foreign.status, 404);
    assert.equal(codeOf(foreign.body), "PAYOUT_NOT_FOUND");
  });
});

describe("devoluciones", () => {
  it("«Devuelta» solo con confirmación del proveedor; el resto sigue en revisión, aprobada, en trámite o rechazada", async () => {
    const { api } = world({ seed: "money-historial-largo" });
    const res = await api("GET", "/v1/me/refunds?limit=50");
    assert.equal(res.status, 200);
    const items = asArray(asRecord(res.body).items).map((item) => asRecord(item));
    assert.equal(items.length, 7);
    const statuses = new Set(items.map((item) => item.status));
    for (const status of ["pending_review", "approved", "executing", "refunded", "rejected", "failed", "not_applicable"]) {
      assert.ok(statuses.has(status), `falta el estado ${status}`);
    }
    for (const item of items) {
      if (item.status === "refunded") {
        assert.notEqual(item.refundedAt, null);
        assert.equal(item.executionStatus, "succeeded");
      } else {
        assert.equal(item.refundedAt, null);
      }
    }
    const pending = items.find((item) => item.status === "pending_review");
    assert.equal(asRecord(pending?.approvedRefund).status, "pending_definition");
  });

  it("sin devoluciones, lista vacía", async () => {
    const { api } = world({ seed: "money-vacio" });
    const body = asRecord((await api("GET", "/v1/me/refunds")).body);
    assert.deepEqual(body.items, []);
  });
});
