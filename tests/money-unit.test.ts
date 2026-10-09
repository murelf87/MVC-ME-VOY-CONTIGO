/**
 * Módulo money · pruebas unitarias (sin base de datos): firma de webhooks, reparto proporcional, detección de PAN,
 * motor de política de cancelación, transiciones de pago, claves idempotentes, recibos HTML y proveedor desactivado.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { DomainError } from "../src/errors.js";
import { buildChargeLines, allocateProRata, parseBreakdown, type PaymentBreakdown } from "../src/modules/money/ledger/ledger-service.js";
import { evaluatePolicy, parseRules, policyRef, refundShare, type LoadedPolicy } from "../src/modules/money/cancellations/policy-engine.js";
import { decidePaymentTransition } from "../src/modules/money/payments/event-service.js";
import { looksLikeCardNumber, methodMaskedLabel } from "../src/modules/money/payments/methods-service.js";
import { decodeCursor, encodeCursor, clampLimit, monthToFirstDay } from "../src/modules/money/lib/db.js";
import { parseIdempotencyKey, stableStringify } from "../src/modules/money/lib/idempotency.js";
import { deterministicUuid, providerIdempotencyKey } from "../src/modules/money/lib/ids.js";
import { centsToMoney, formatEuros } from "../src/modules/money/lib/people.js";
import { buildPaymentProvider, DisabledPaymentProvider } from "../src/modules/money/provider/index.js";
import {
  computeHmacSha256Hex,
  DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
  verifyHmacSha256Signature
} from "../src/modules/money/provider/webhook-signature.js";
import { renderReceiptHtml, type ReceiptDto } from "../src/modules/money/reports/receipt-service.js";

/** PRNG determinista (mulberry32) para pruebas de propiedades reproducibles. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function throwsCode(fn: () => unknown, code: string, status?: number): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof DomainError, `se esperaba DomainError, llegó ${String(error)}`);
    assert.equal(error.code, code);
    if (status !== undefined) assert.equal(error.statusCode, status);
    return true;
  });
}

/* ───────────────────────── Firma HMAC del webhook ───────────────────────── */

describe("verifyHmacSha256Signature", () => {
  const secret = "whsec_unit_test";
  const body = Buffer.from('{"events":[{"id":"evt_1"}]}', "utf8");
  const now = 1_800_000_000;
  const sign = (t: number, b = body, s = secret) => `t=${t},v1=${computeHmacSha256Hex(s, t, b)}`;

  it("acepta una firma correcta dentro de la ventana", () => {
    verifyHmacSha256Signature({ secret, rawBody: body, header: sign(now), nowSeconds: now });
    verifyHmacSha256Signature({ secret, rawBody: body, header: sign(now - 299), nowSeconds: now });
    verifyHmacSha256Signature({ secret, rawBody: body, header: sign(now + 299), nowSeconds: now });
  });

  it("rechaza SIEMPRE si no hay secreto (503), incluso con una firma «válida» calculada con clave vacía", () => {
    for (const empty of [undefined, ""]) {
      throwsCode(
        () => verifyHmacSha256Signature({ secret: empty, rawBody: body, header: sign(now, body, ""), nowSeconds: now }),
        "PAYMENTS_WEBHOOK_NOT_CONFIGURED",
        503
      );
    }
  });

  it("rechaza firma ausente, formato inválido, hex inválido, secreto distinto o cuerpo manipulado (401)", () => {
    const cases: Array<[string, string | undefined, Buffer?]> = [
      ["ausente", undefined],
      ["vacía", ""],
      ["sin t", `v1=${computeHmacSha256Hex(secret, now, body)}`],
      ["sin v1", `t=${now}`],
      ["t no numérico", `t=ahora,v1=${computeHmacSha256Hex(secret, now, body)}`],
      ["v1 no hex", `t=${now},v1=${"z".repeat(64)}`],
      ["v1 corto", `t=${now},v1=abcd`],
      ["secreto distinto", sign(now, body, "otro")],
      ["cuerpo manipulado", sign(now), Buffer.from('{"events":[{"id":"evt_2"}]}', "utf8")],
      ["marca de tiempo alterada", `t=${now + 1},v1=${computeHmacSha256Hex(secret, now, body)}`]
    ];
    for (const [label, header, otherBody] of cases) {
      assert.throws(
        () => verifyHmacSha256Signature({ secret, rawBody: otherBody ?? body, header, nowSeconds: now }),
        (error: unknown) => error instanceof DomainError && error.code === "WEBHOOK_SIGNATURE_INVALID" && error.statusCode === 401,
        label
      );
    }
  });

  it("rechaza marcas de tiempo fuera de la tolerancia (reenvíos antiguos y futuros)", () => {
    for (const offset of [DEFAULT_WEBHOOK_TOLERANCE_SECONDS + 1, -(DEFAULT_WEBHOOK_TOLERANCE_SECONDS + 1), 86_400, -86_400]) {
      throwsCode(
        () => verifyHmacSha256Signature({ secret, rawBody: body, header: sign(now + offset), nowSeconds: now }),
        "WEBHOOK_SIGNATURE_INVALID",
        401
      );
    }
    // La tolerancia es configurable
    verifyHmacSha256Signature({ secret, rawBody: body, header: sign(now - 1000), nowSeconds: now, toleranceSeconds: 1200 });
  });

  it("permite rotar el secreto: basta que UNA de las firmas v1 coincida", () => {
    const old = computeHmacSha256Hex("secreto-viejo", now, body);
    const current = computeHmacSha256Hex(secret, now, body);
    verifyHmacSha256Signature({ secret, rawBody: body, header: `t=${now},v1=${old},v1=${current}`, nowSeconds: now });
    throwsCode(
      () => verifyHmacSha256Signature({ secret, rawBody: body, header: `t=${now},v1=${old},v1=${old}`, nowSeconds: now }),
      "WEBHOOK_SIGNATURE_INVALID"
    );
  });
});

/* ───────────────────────── Reparto proporcional ───────────────────────── */

describe("allocateProRata", () => {
  it("casos exactos y de borde", () => {
    assert.deepEqual(allocateProRata(0, [5, 3]), [0, 0]);
    assert.deepEqual(allocateProRata(8, [5, 3]), [5, 3]);
    assert.deepEqual(allocateProRata(4, [5, 3]), [3, 1]);
    assert.deepEqual(allocateProRata(1, [1, 1, 1]), [1, 0, 0], "empate: gana la primera posición");
    assert.deepEqual(allocateProRata(2, [1, 1, 1]), [1, 1, 0]);
    assert.deepEqual(allocateProRata(5, [0, 10]), [0, 5], "una parte sin peso nunca recibe nada");
    assert.deepEqual(allocateProRata(0, []), []);
  });

  it("rechaza importes inválidos o superiores al total disponible", () => {
    assert.throws(() => allocateProRata(9, [5, 3]), /exceeds/);
    assert.throws(() => allocateProRata(-1, [5, 3]), /non-negative/);
    assert.throws(() => allocateProRata(1.5, [5, 3]), /non-negative/);
    assert.throws(() => allocateProRata(Number.NaN, [5, 3]), /non-negative/);
  });

  it("propiedad: suma EXACTA, nunca más que el peso de cada parte, determinista (5.000 casos)", () => {
    const rand = prng(20260709);
    for (let i = 0; i < 5000; i += 1) {
      const count = 1 + Math.floor(rand() * 6);
      const parts = Array.from({ length: count }, () => (rand() < 0.15 ? 0 : Math.floor(rand() * 5000)));
      const total = parts.reduce((a, b) => a + b, 0);
      const amount = Math.floor(rand() * (total + 1));
      const shares = allocateProRata(amount, parts);
      assert.equal(shares.length, parts.length);
      assert.equal(shares.reduce((a, b) => a + b, 0), amount, `suma ${JSON.stringify({ amount, parts })}`);
      shares.forEach((share, index) => {
        assert.ok(Number.isInteger(share) && share >= 0, "entero no negativo");
        assert.ok(share <= parts[index]!, `parte ${index} excede su peso: ${JSON.stringify({ amount, parts, shares })}`);
      });
      assert.deepEqual(allocateProRata(amount, parts), shares, "determinista");
    }
  });
});

/* ───────────────────────── Libro mayor: líneas de un cobro ───────────────────────── */

describe("buildChargeLines / parseBreakdown", () => {
  const breakdown = (over: Partial<PaymentBreakdown> = {}): PaymentBreakdown => {
    const base = { contributionCents: 1000, passengerCommissionCents: 100, driverCommissionCents: 50, processingCents: 0, taxesCents: 0 };
    const merged = { ...base, ...over };
    return {
      ...merged,
      totalCents: over.totalCents ?? merged.contributionCents + merged.passengerCommissionCents + merged.processingCents + merged.taxesCents
    };
  };

  it("el cobro reparte el total y suma exactamente cero", () => {
    const lines = buildChargeLines({ passengerUserId: "p", driverUserId: "d", breakdown: breakdown() });
    assert.equal(lines.reduce((a, l) => a + l.amountCents, 0), 0);
    const by = Object.fromEntries(lines.map(l => [l.account, l.amountCents]));
    assert.deepEqual(by, { passenger: -1100, driver_payable: 950, platform_revenue: 150 });
  });

  it("propiedad: cualquier desglose coherente suma cero (2.000 casos)", () => {
    const rand = prng(42);
    for (let i = 0; i < 2000; i += 1) {
      const contribution = Math.floor(rand() * 20_000);
      const b = breakdown({
        contributionCents: contribution,
        passengerCommissionCents: Math.floor(rand() * 2000),
        driverCommissionCents: Math.floor(rand() * (contribution + 1)),
        processingCents: Math.floor(rand() * 100),
        taxesCents: Math.floor(rand() * 400)
      });
      const lines = buildChargeLines({ passengerUserId: "p", driverUserId: "d", breakdown: b });
      assert.equal(lines.reduce((a, l) => a + l.amountCents, 0), 0, JSON.stringify(b));
      assert.ok(lines.every(l => l.amountCents !== 0), "no se publican líneas a cero");
    }
  });

  it("parseBreakdown rechaza desgloses incoherentes", () => {
    assert.throws(() => parseBreakdown({ ...breakdown(), totalCents: 1 }), /does not add up/);
    assert.throws(() => parseBreakdown({ ...breakdown(), driverCommissionCents: 5000 }), /driver commission/);
    assert.throws(() => parseBreakdown({ ...breakdown(), contributionCents: -1 }), /invalid payment breakdown/);
    assert.throws(() => parseBreakdown({ ...breakdown(), contributionCents: 10.5 }), /invalid payment breakdown/);
    assert.throws(() => parseBreakdown(null), /invalid payment breakdown/);
    assert.deepEqual(parseBreakdown(breakdown()), breakdown());
  });
});

/* ───────────────────────── Datos de tarjeta en crudo ───────────────────────── */

describe("looksLikeCardNumber", () => {
  it("detecta números de tarjeta válidos (Luhn) con o sin separadores", () => {
    for (const pan of [
      "4242424242424242",
      "4242 4242 4242 4242",
      "4242-4242-4242-4242",
      "4000056655665556",
      "5555555555554444",
      "378282246310005",
      "6011111111111117",
      "4111111111111111",
      "4012888888881881"
    ]) {
      assert.equal(looksLikeCardNumber(pan), true, pan);
    }
  });

  it("no confunde tokens del proveedor ni números cortos/largos/no Luhn", () => {
    for (const token of [
      "tok_card_visa_4242",
      "pm_1QXyZAbCdEfGhIjK",
      "tok_iban_1234",
      "4242424242424241", // no cumple Luhn
      "123456789012", // 12 dígitos
      "12345678901234567890", // 20 dígitos
      "",
      "abcdefghijklmnop"
    ]) {
      assert.equal(looksLikeCardNumber(token), false, token);
    }
  });

  it("máscara visible: solo marca/últimos 4 dígitos, nunca el número", () => {
    assert.match(methodMaskedLabel("card", "4242", "ES"), /4242/);
    assert.ok(!methodMaskedLabel("card", "4242", "ES").includes("4242424242"));
    assert.ok(methodMaskedLabel("apple_pay", null, null).length > 0);
  });
});

/* ───────────────────────── Política de cancelación ───────────────────────── */

describe("política de cancelación", () => {
  const breakdown: PaymentBreakdown = {
    contributionCents: 1000,
    passengerCommissionCents: 100,
    driverCommissionCents: 50,
    processingCents: 20,
    taxesCents: 10,
    totalCents: 1130
  };
  const rule = (hours: number, c = 10_000, m = 10_000, p = 10_000, t = 10_000) => ({
    scenario: "passenger_cancellation" as const,
    minHoursBeforeDeparture: hours,
    refundContributionBps: c,
    refundCommissionBps: m,
    refundProcessingBps: p,
    refundTaxesBps: t
  });
  const policy = (rules: ReturnType<typeof rule>[]): LoadedPolicy => ({
    id: "00000000-0000-4000-8000-000000000001",
    version: 3,
    status: "approved",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    summary: "política de pruebas",
    rules
  });

  it("sin política, sin desglose o sin horas → siempre «pending_review» (nunca inventa un importe)", () => {
    assert.deepEqual(evaluatePolicy(null, breakdown, 48, "passenger_cancellation"), { kind: "pending_review" });
    assert.deepEqual(evaluatePolicy(policy([rule(0)]), null, 48, "passenger_cancellation"), { kind: "pending_review" });
    assert.deepEqual(evaluatePolicy(policy([rule(0)]), breakdown, null, "passenger_cancellation"), { kind: "pending_review" });
    assert.deepEqual(policyRef({ kind: "pending_review" }), { status: "pending_review", version: null, effectiveFrom: null, summary: null });
  });

  it("una política que no cubre el caso (ninguna regla aplicable) tampoco decide: revisión humana", () => {
    assert.deepEqual(evaluatePolicy(policy([rule(24)]), breakdown, 2, "passenger_cancellation"), { kind: "pending_review" });
    assert.deepEqual(evaluatePolicy(policy([]), breakdown, 100, "passenger_cancellation"), { kind: "pending_review" });
  });

  it("elige la regla aplicable de mayor umbral y calcula cada componente", () => {
    const p = policy([rule(0, 0, 0, 0, 0), rule(12, 5000, 0, 10_000, 10_000), rule(48, 10_000, 10_000, 10_000, 10_000)]);
    const far = evaluatePolicy(p, breakdown, 72, "passenger_cancellation");
    assert.equal(far.kind, "applied");
    if (far.kind !== "applied") return;
    assert.equal(far.rule.minHoursBeforeDeparture, 48);
    assert.equal(far.refund.totalCents, 1130);
    assert.equal(far.retainedCommissionCents, 0);

    const mid = evaluatePolicy(p, breakdown, 20, "passenger_cancellation");
    assert.equal(mid.kind, "applied");
    if (mid.kind !== "applied") return;
    assert.equal(mid.rule.minHoursBeforeDeparture, 12);
    assert.deepEqual(mid.refund, { contributionCents: 500, commissionCents: 0, processingCents: 20, taxesCents: 10, totalCents: 530 });
    assert.equal(mid.retainedCommissionCents, 100, "la comisión retenida es un DATO de la regla, no una constante del código");

    const near = evaluatePolicy(p, breakdown, 1, "passenger_cancellation");
    assert.equal(near.kind, "applied");
    if (near.kind !== "applied") return;
    assert.equal(near.refund.totalCents, 0);
    assert.equal(near.retainedCommissionCents, 100);
    assert.deepEqual(policyRef(near), {
      status: "approved",
      version: 3,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      summary: "política de pruebas"
    });
  });

  it("el motor NO retiene la comisión por su cuenta: con una regla de devolución total, MVC no retiene nada", () => {
    const outcome = evaluatePolicy(policy([rule(0)]), breakdown, 0, "passenger_cancellation");
    assert.equal(outcome.kind, "applied");
    if (outcome.kind === "applied") {
      assert.equal(outcome.retainedCommissionCents, 0);
      assert.equal(outcome.refund.totalCents, breakdown.totalCents);
    }
  });

  it("refundShare redondea a favor de la persona consumidora y nunca supera el importe", () => {
    assert.equal(refundShare(101, 5000), 51);
    assert.equal(refundShare(1, 1), 1);
    assert.equal(refundShare(0, 5000), 0);
    assert.equal(refundShare(1000, 0), 0);
    assert.equal(refundShare(1000, 10_000), 1000);
    assert.equal(refundShare(1000, 99_999), 1000);
    const rand = prng(7);
    for (let i = 0; i < 2000; i += 1) {
      const cents = Math.floor(rand() * 100_000);
      const bps = Math.floor(rand() * 10_001);
      const share = refundShare(cents, bps);
      assert.ok(share >= 0 && share <= cents);
      assert.ok(share * 10_000 >= cents * bps, "nunca menos que la parte proporcional exacta");
      assert.ok(share * 10_000 - cents * bps < 10_000, "como mucho 1 céntimo de más");
    }
  });

  it("parseRules descarta reglas mal formadas en vez de aplicarlas", () => {
    const good = rule(24, 10_000, 5000, 10_000, 10_000);
    const parsed = parseRules([
      good,
      { ...good, scenario: "driver_cancellation" },
      { ...good, minHoursBeforeDeparture: -1 },
      { ...good, minHoursBeforeDeparture: "24" },
      { ...good, refundContributionBps: 10_001 },
      { ...good, refundTaxesBps: 1.5 },
      { ...good, refundCommissionBps: undefined },
      null,
      "texto",
      42
    ]);
    assert.deepEqual(parsed, [good]);
    assert.deepEqual(parseRules(null), []);
    assert.deepEqual(parseRules({}), []);
  });
});

/* ───────────────────────── Transiciones de estado de pago ───────────────────────── */

describe("decidePaymentTransition", () => {
  type S = Parameters<typeof decidePaymentTransition>[0];
  type T = Parameters<typeof decidePaymentTransition>[1];
  const expected: Record<S, Record<T, "apply" | "stale" | "conflict">> = {
    requires_action: { requires_action: "stale", processing: "apply", succeeded: "apply", failed: "apply", expired: "apply" },
    processing: { requires_action: "stale", processing: "stale", succeeded: "apply", failed: "apply", expired: "apply" },
    failed: { requires_action: "stale", processing: "stale", succeeded: "apply", failed: "stale", expired: "stale" },
    expired: { requires_action: "stale", processing: "stale", succeeded: "apply", failed: "stale", expired: "stale" },
    succeeded: { requires_action: "stale", processing: "stale", succeeded: "stale", failed: "conflict", expired: "conflict" },
    refunded: { requires_action: "stale", processing: "stale", succeeded: "stale", failed: "conflict", expired: "conflict" }
  };

  for (const [current, row] of Object.entries(expected)) {
    for (const [type, decision] of Object.entries(row)) {
      it(`${current} + ${type} → ${decision}`, () => {
        assert.equal(decidePaymentTransition(current as S, type as T), decision);
      });
    }
  }

  it("un pago ya cobrado jamás retrocede: ni failed ni expired lo aplican", () => {
    for (const status of ["succeeded", "refunded"] as const) {
      for (const type of ["failed", "expired"] as const) assert.notEqual(decidePaymentTransition(status, type), "apply");
    }
  });

  it("un cobro real (`succeeded`) se aplica siempre que el pago no estuviera ya cobrado", () => {
    for (const status of ["requires_action", "processing", "failed", "expired"] as const) {
      assert.equal(decidePaymentTransition(status, "succeeded"), "apply");
    }
  });
});

/* ───────────────────────── Claves, huellas, cursores ───────────────────────── */

describe("claves idempotentes y utilidades", () => {
  it("stableStringify ignora el orden de claves y los undefined, pero no el contenido", () => {
    assert.equal(stableStringify({ b: 1, a: { d: [1, 2], c: null } }), stableStringify({ a: { c: null, d: [1, 2] }, b: 1 }));
    assert.equal(stableStringify({ a: 1, b: undefined }), stableStringify({ a: 1 }));
    assert.notEqual(stableStringify({ a: [1, 2] }), stableStringify({ a: [2, 1] }));
    assert.notEqual(stableStringify({ a: "1" }), stableStringify({ a: 1 }));
    assert.equal(stableStringify(undefined), "null");
  });

  it("parseIdempotencyKey acepta 8–128 caracteres [A-Za-z0-9_-] y rechaza lo demás (400)", () => {
    assert.equal(parseIdempotencyKey("abcd1234"), "abcd1234");
    assert.equal(parseIdempotencyKey("5b0f6f0e-9a53-4d2d-b3a1-0f2fd9c0f1a1"), "5b0f6f0e-9a53-4d2d-b3a1-0f2fd9c0f1a1");
    assert.equal(parseIdempotencyKey(["abcd1234", "otra"]), "abcd1234");
    for (const bad of [undefined, "", "corta", "con espacios aqui", "ñandú-1234567", "x".repeat(129), "a/b/c/d/e/f"]) {
      throwsCode(() => parseIdempotencyKey(bad), "IDEMPOTENCY_KEY_REQUIRED", 400);
    }
  });

  it("deterministicUuid: estable, con formato v5 y sensible a la entrada", () => {
    const a = deterministicUuid("user-1:key-1");
    assert.equal(a, deterministicUuid("user-1:key-1"));
    assert.notEqual(a, deterministicUuid("user-1:key-2"));
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("providerIdempotencyKey: estable, acotada y sin filtrar los datos de entrada", () => {
    const key = providerIdempotencyKey("pay", "usuario@example.com", "clave");
    assert.equal(key, providerIdempotencyKey("pay", "usuario@example.com", "clave"));
    assert.notEqual(key, providerIdempotencyKey("pay", "usuario@example.com", "clave2"));
    assert.notEqual(key, providerIdempotencyKey("refund", "usuario@example.com", "clave"));
    assert.match(key, /^mvc-pay-[0-9a-f]{40}$/);
    assert.ok(!key.includes("usuario"));
    assert.notEqual(providerIdempotencyKey("x", "ab", "c"), providerIdempotencyKey("x", "a", "bc"), "separador entre partes");
  });

  it("cursores: ida y vuelta, y rechazo de cursores manipulados (400)", () => {
    const cursor = { t: "2026-07-01T10:00:00.000Z", k: "00000000-0000-4000-8000-000000000001" };
    assert.deepEqual(decodeCursor(encodeCursor(cursor)), cursor);
    assert.equal(decodeCursor(undefined), null);
    for (const bad of ["!!!", Buffer.from("no-json").toString("base64url"), Buffer.from('{"t":"x","k":"y"}').toString("base64url"), Buffer.from('{"t":1}').toString("base64url")]) {
      throwsCode(() => decodeCursor(bad), "VALIDATION_ERROR", 400);
    }
  });

  it("clampLimit y monthToFirstDay", () => {
    assert.equal(clampLimit(undefined), 20);
    assert.equal(clampLimit(0), 20);
    assert.equal(clampLimit(-3), 20);
    assert.equal(clampLimit(1000), 50);
    assert.equal(clampLimit(7), 7);
    assert.equal(monthToFirstDay(undefined), null);
    assert.equal(monthToFirstDay("2026-07"), "2026-07-01");
    for (const bad of ["2026-13", "2026-00", "26-07", "2026-7", "julio", "2026-07-01"]) throwsCode(() => monthToFirstDay(bad), "VALIDATION_ERROR", 400);
  });

  it("centsToMoney nunca inventa un cero y formatEuros usa formato español", () => {
    assert.deepEqual(centsToMoney(null), { cents: null, currency: "EUR", status: "pending_definition" });
    assert.deepEqual(centsToMoney(undefined), { cents: null, currency: "EUR", status: "pending_definition" });
    assert.deepEqual(centsToMoney(0), { cents: 0, currency: "EUR", status: "defined" });
    assert.deepEqual(centsToMoney(1100), { cents: 1100, currency: "EUR", status: "defined" });
    assert.equal(formatEuros(1100).replace(/\s/g, " "), "11,00 €");
    assert.equal(formatEuros(5).replace(/\s/g, " "), "0,05 €");
    assert.equal(formatEuros(123_456_789).replace(/\s/g, " "), "1.234.567,89 €");
  });
});

/* ───────────────────────── Recibos ───────────────────────── */

describe("renderReceiptHtml", () => {
  const receipt = (over: Partial<ReceiptDto> = {}): ReceiptDto => ({
    id: "00000000-0000-4000-8000-0000000000aa",
    number: "MVC-J-2026-000001",
    kind: "payment",
    issuedAt: "2026-07-01T10:30:00.000Z",
    total: { cents: 1100, currency: "EUR", status: "defined" },
    trip: { tripId: "00000000-0000-4000-8000-0000000000bb", departureAt: "2026-07-02T08:00:00.000Z", originLabel: "Sevilla Centro", destinationLabel: "Isla Mágica" },
    counterpart: { id: "u", displayName: "Ana García López", firstName: "Ana", photoUrl: null, ratingAverage: null, ratingCount: 0 },
    bookingId: null,
    paymentId: null,
    fiscalInvoice: false,
    lines: [
      { key: "contribution", amount: { cents: 1000, currency: "EUR", status: "defined" } },
      { key: "platform_fee", amount: { cents: 100, currency: "EUR", status: "defined" } }
    ],
    notice: "Justificante no fiscal.",
    ...over
  });

  it("incluye número, importes en euros, ruta y aviso no fiscal", () => {
    const html = renderReceiptHtml(receipt());
    assert.match(html, /^<!doctype html>/);
    assert.ok(html.includes("MVC-J-2026-000001"));
    assert.ok(html.includes("11,00 €"));
    assert.ok(html.includes("10,00 €"));
    assert.ok(html.includes("Sevilla Centro"));
    assert.ok(html.includes("Isla Mágica") || html.includes("Isla M"));
    assert.ok(html.includes("Justificante no fiscal."));
    assert.ok(html.includes("Con Ana"));
  });

  it("escapa TODO texto de usuario y nunca emite scripts ni recursos externos", () => {
    const evil = '<script>alert(1)</script>"><img src=x onerror=alert(2)>';
    const html = renderReceiptHtml(
      receipt({
        number: "MVC-J-2026-000002",
        trip: { tripId: "t", departureAt: null, originLabel: evil, destinationLabel: evil },
        counterpart: { id: "u", displayName: evil, firstName: evil, photoUrl: null, ratingAverage: null, ratingCount: 0 },
        notice: evil
      })
    );
    assert.ok(!/<script/i.test(html), "sin etiquetas script");
    assert.ok(!/<img/i.test(html), "sin etiquetas img");
    assert.ok(!html.includes("onerror=alert(2)>"), "atributos peligrosos escapados");
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(!/(src|href)=["']?https?:/i.test(html), "sin recursos externos");
  });

  it("un importe sin definir se muestra como «Por definir», nunca como 0", () => {
    const html = renderReceiptHtml(receipt({ total: { cents: null, currency: "EUR", status: "pending_definition" } }));
    assert.ok(html.includes("Por definir"));
  });
});

/* ───────────────────────── Proveedor desactivado y configuración ───────────────────────── */

describe("proveedor desactivado y configuración", () => {
  const withEnv = <T>(env: Record<string, string | undefined>, fn: () => T): T => {
    const saved: Record<string, string | undefined> = {};
    for (const key of Object.keys(env)) {
      saved[key] = process.env[key];
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
    try {
      return fn();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  };

  it("por defecto PAYMENTS_PROVIDER=disabled y no hay secreto de webhook", () => {
    const config = withEnv({ DATABASE_URL: "postgres://x/y", PAYMENTS_PROVIDER: undefined, PAYMENTS_WEBHOOK_SECRET: undefined }, () => loadConfig());
    assert.equal(config.paymentsProvider, "disabled");
    assert.equal(config.paymentsWebhookSecret, undefined);
    const provider = buildPaymentProvider(config);
    assert.equal(provider.name, "disabled");
    assert.equal(provider.enabled, false);
    assert.deepEqual(provider.capabilities, { chargeMethods: [], payouts: false, refunds: false });
  });

  it("no se puede activar un proveedor que no existe: cualquier otro valor aborta el arranque", () => {
    for (const value of ["stripe", "adyen", "mangopay", "fake", "test", "enabled", "DISABLED"]) {
      assert.throws(
        () => withEnv({ DATABASE_URL: "postgres://x/y", PAYMENTS_PROVIDER: value }, () => loadConfig()),
        /PAYMENTS_PROVIDER must be disabled/,
        value
      );
    }
  });

  it("un secreto de webhook vacío cuenta como ausente", () => {
    const config = withEnv({ DATABASE_URL: "postgres://x/y", PAYMENTS_WEBHOOK_SECRET: "" }, () => loadConfig());
    assert.equal(config.paymentsWebhookSecret, undefined);
  });

  it("TODA operación del proveedor desactivado responde 409 PAYMENTS_PROVIDER_DISABLED; los webhooks 503", () => {
    const provider = new DisabledPaymentProvider();
    const ops: Array<[string, () => unknown]> = [
      ["createPaymentIntent", () => provider.createPaymentIntent()],
      ["refundPayment", () => provider.refundPayment()],
      ["attachMethod", () => provider.attachMethod()],
      ["detachMethod", () => provider.detachMethod()],
      ["createPayout", () => provider.createPayout()]
    ];
    for (const [name, op] of ops) {
      assert.throws(op, (error: unknown) => error instanceof DomainError && error.code === "PAYMENTS_PROVIDER_DISABLED" && error.statusCode === 409, name);
    }
    throwsCode(() => provider.verifyAndParseWebhook(), "PAYMENTS_WEBHOOK_NOT_CONFIGURED", 503);
  });
});
