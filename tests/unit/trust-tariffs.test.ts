import test from "node:test";
import assert from "node:assert/strict";
import { DomainError } from "../../src/errors.js";
import { loadTrustConfig } from "../../src/modules/trust/config.js";
import { MAX_BPS, MAX_CENTS_FIELD, MAX_RATE_MICROS_PER_KM, computeTariffExample, validateDraft } from "../../src/modules/trust/tariffs.js";

const PENDING = { cents: null, currency: "EUR", status: "pending_definition" };
const illustrative = (cents: number) => ({ cents, currency: "EUR", status: "illustrative" });

test("trust/tariffs: ejemplo con tarifa pero sin comisiones definidas (lámina 40: 0,30 €/km × 18 km)", () => {
  const example = computeTariffExample({ distanceMeters: 18_000, ratePerKmMicros: 300_000, passengerCommissionBps: null, driverCommissionBps: null });
  assert.deepEqual(example, {
    distanceMeters: 18_000,
    ratePerKmMicros: 300_000,
    contribution: illustrative(540),
    passengerCommission: PENDING,
    driverCommission: PENDING,
    passengerTotal: PENDING,
    driverNet: PENDING,
    disclaimer: "Antes de gestión y del límite de gastos compartidos.",
    roundingRule: "half_up_cents"
  });
});

test("trust/tariffs: propuesta 0,18 €/km con 10 % / 10 % (lámina 40b)", () => {
  const example = computeTariffExample({ distanceMeters: 18_000, ratePerKmMicros: 180_000, passengerCommissionBps: 1_000, driverCommissionBps: 1_000 });
  assert.deepEqual(
    [example.contribution, example.passengerCommission, example.passengerTotal, example.driverCommission, example.driverNet],
    [illustrative(324), illustrative(32), illustrative(356), illustrative(32), illustrative(292)]
  );
});

test("trust/tariffs: con solo una comisión definida solo se calcula su lado", () => {
  const passengerOnly = computeTariffExample({ distanceMeters: 18_000, ratePerKmMicros: 180_000, passengerCommissionBps: 1_000, driverCommissionBps: null });
  assert.deepEqual(passengerOnly.passengerCommission, illustrative(32));
  assert.deepEqual(passengerOnly.passengerTotal, illustrative(356));
  assert.deepEqual(passengerOnly.driverCommission, PENDING);
  assert.deepEqual(passengerOnly.driverNet, PENDING);

  const driverOnly = computeTariffExample({ distanceMeters: 18_000, ratePerKmMicros: 180_000, passengerCommissionBps: null, driverCommissionBps: 1_000 });
  assert.deepEqual(driverOnly.driverCommission, illustrative(32));
  assert.deepEqual(driverOnly.driverNet, illustrative(292));
  assert.deepEqual(driverOnly.passengerCommission, PENDING);
  assert.deepEqual(driverOnly.passengerTotal, PENDING);
});

test("trust/tariffs: sin tarifa todo el ejemplo queda «por definir»", () => {
  const example = computeTariffExample({ distanceMeters: 18_000, ratePerKmMicros: null, passengerCommissionBps: 1_000, driverCommissionBps: 1_000 });
  for (const key of ["contribution", "passengerCommission", "driverCommission", "passengerTotal", "driverNet"] as const) {
    assert.deepEqual(example[key], PENDING, key);
  }
});

test("trust/tariffs: redondeo mitad hacia arriba en céntimos (aportación y comisiones)", () => {
  // 1 m a 5 €/km = 0,5 céntimos → 1.
  assert.deepEqual(computeTariffExample({ distanceMeters: 1, ratePerKmMicros: 5_000_000, passengerCommissionBps: null, driverCommissionBps: null }).contribution, illustrative(1));
  // 1 m a 4,9 €/km = 0,49 céntimos → 0.
  assert.deepEqual(computeTariffExample({ distanceMeters: 1, ratePerKmMicros: 4_900_000, passengerCommissionBps: null, driverCommissionBps: null }).contribution, illustrative(0));
  // 1 km a 0,05 €/km = 5 céntimos; 10 % = 0,5 → 1 (mitad hacia arriba); 9,99 % = 0,4995 → 0.
  const half = computeTariffExample({ distanceMeters: 1_000, ratePerKmMicros: 50_000, passengerCommissionBps: 1_000, driverCommissionBps: 999 });
  assert.deepEqual(half.contribution, illustrative(5));
  assert.deepEqual(half.passengerCommission, illustrative(1));
  assert.deepEqual(half.driverCommission, illustrative(0));
});

test("trust/tariffs: tarifa 0 es válida y da importes 0", () => {
  const zero = computeTariffExample({ distanceMeters: 10_000, ratePerKmMicros: 0, passengerCommissionBps: 1_000, driverCommissionBps: 1_000 });
  assert.deepEqual([zero.contribution, zero.passengerCommission, zero.passengerTotal, zero.driverNet], [illustrative(0), illustrative(0), illustrative(0), illustrative(0)]);
});

test("trust/tariffs: el ejemplo nunca emite «defined» (solo illustrative o pending_definition)", () => {
  const rates = [null, 0, 180_000, 300_000, MAX_RATE_MICROS_PER_KM];
  const bps = [null, 0, 1_000, MAX_BPS];
  for (const rate of rates) {
    for (const passenger of bps) {
      for (const driver of bps) {
        const ex = computeTariffExample({ distanceMeters: 12_345, ratePerKmMicros: rate, passengerCommissionBps: passenger, driverCommissionBps: driver });
        for (const key of ["contribution", "passengerCommission", "driverCommission", "passengerTotal", "driverNet"] as const) {
          assert.ok(["illustrative", "pending_definition"].includes(ex[key].status), `${key} ${rate}/${passenger}/${driver}`);
          assert.equal(ex[key].cents === null, ex[key].status === "pending_definition");
        }
      }
    }
  }
});

function invalidFields(call: () => unknown): string[] {
  try {
    call();
  } catch (error) {
    assert.ok(error instanceof DomainError);
    assert.equal(error.code, "TARIFF_INVALID");
    assert.equal(error.statusCode, 422);
    return (error.details as { fields: Array<{ field: string }> }).fields.map(f => f.field);
  }
  assert.fail("debería haber lanzado TARIFF_INVALID");
}

test("trust/tariffs: el ejemplo valida distancia, tarifa y comisiones", () => {
  const base = { distanceMeters: 18_000, ratePerKmMicros: 300_000, passengerCommissionBps: 1_000, driverCommissionBps: 1_000 };
  assert.deepEqual(invalidFields(() => computeTariffExample({ ...base, distanceMeters: 0 })), ["distanceMeters"]);
  assert.deepEqual(invalidFields(() => computeTariffExample({ ...base, distanceMeters: 2_000_001 })), ["distanceMeters"]);
  assert.deepEqual(invalidFields(() => computeTariffExample({ ...base, distanceMeters: 1.5 })), ["distanceMeters"]);
  assert.deepEqual(invalidFields(() => computeTariffExample({ ...base, ratePerKmMicros: -1 })), ["ratePerKmMicros"]);
  assert.deepEqual(invalidFields(() => computeTariffExample({ ...base, ratePerKmMicros: MAX_RATE_MICROS_PER_KM + 1 })), ["ratePerKmMicros"]);
  assert.deepEqual(invalidFields(() => computeTariffExample({ ...base, passengerCommissionBps: MAX_BPS + 1 })), ["passengerCommissionBps"]);
  assert.deepEqual(invalidFields(() => computeTariffExample({ ...base, driverCommissionBps: 0.5 })), ["driverCommissionBps"]);
  assert.deepEqual(
    invalidFields(() => computeTariffExample({ distanceMeters: 0, ratePerKmMicros: -1, passengerCommissionBps: -1, driverCommissionBps: -1 })),
    ["distanceMeters", "ratePerKmMicros", "passengerCommissionBps", "driverCommissionBps"]
  );
});

test("trust/tariffs: validateDraft acepta «por definir» (null) y valores en rango", () => {
  assert.deepEqual(validateDraft({ ratePerKmMicros: null, passengerCommissionBps: null, driverCommissionBps: null, premiumMonthlyCents: null }), []);
  assert.deepEqual(
    validateDraft({
      ratePerKmMicros: 180_000, passengerCommissionBps: 1_000, driverCommissionBps: 1_000, premiumMonthlyCents: 299, sharedCostCapCents: 2_000, notes: "Propuesta 40b"
    }),
    []
  );
  assert.deepEqual(
    validateDraft({ ratePerKmMicros: 0, passengerCommissionBps: 0, driverCommissionBps: MAX_BPS, premiumMonthlyCents: MAX_CENTS_FIELD, sharedCostCapCents: 0, notes: null }),
    []
  );
});

test("trust/tariffs: validateDraft señala cada campo fuera de rango por su nombre", () => {
  const fields = (input: Parameters<typeof validateDraft>[0]) => validateDraft(input).map(e => e.field);
  const ok = { ratePerKmMicros: 1, passengerCommissionBps: 1, driverCommissionBps: 1, premiumMonthlyCents: 1 };
  assert.deepEqual(fields({ ...ok, ratePerKmMicros: -1 }), ["ratePerKmMicros"]);
  assert.deepEqual(fields({ ...ok, ratePerKmMicros: MAX_RATE_MICROS_PER_KM + 1 }), ["ratePerKmMicros"]);
  assert.deepEqual(fields({ ...ok, passengerCommissionBps: MAX_BPS + 1 }), ["passengerCommissionBps"]);
  assert.deepEqual(fields({ ...ok, driverCommissionBps: -1 }), ["driverCommissionBps"]);
  assert.deepEqual(fields({ ...ok, premiumMonthlyCents: MAX_CENTS_FIELD + 1 }), ["premiumMonthlyCents"]);
  assert.deepEqual(fields({ ...ok, sharedCostCapCents: MAX_CENTS_FIELD + 1 }), ["sharedCostCapCents"]);
  assert.deepEqual(fields({ ...ok, notes: "x".repeat(1_001) }), ["notes"]);
  assert.deepEqual(fields({ ...ok, ratePerKmMicros: 0.5 }), ["ratePerKmMicros"]);
  assert.deepEqual(fields({ ...ok, ratePerKmMicros: Number.NaN }), ["ratePerKmMicros"]);
  assert.deepEqual(fields({ ...ok, notes: `${" ".repeat(1_500)}ok` }), []);
});

test("trust/config: por defecto la economía NO está activada y el resto toma valores seguros", () => {
  assert.deepEqual(loadTrustConfig({}), {
    economicsActivation: "disabled",
    signedUrlTtlSeconds: 120,
    ownPreviewTtlSeconds: 300,
    publicPhotoTtlSeconds: 900,
    ipHashPepper: undefined,
    vehicleActivityFreshnessSeconds: 600
  });
});

test("trust/config: ECONOMICS_ACTIVATION solo admite exactamente «disabled» o «enabled»", () => {
  assert.equal(loadTrustConfig({ ECONOMICS_ACTIVATION: "enabled" }).economicsActivation, "enabled");
  assert.equal(loadTrustConfig({ ECONOMICS_ACTIVATION: "disabled" }).economicsActivation, "disabled");
  for (const value of ["ENABLED", "true", "1", "yes", "on", "", " enabled", "enabled "]) {
    assert.throws(() => loadTrustConfig({ ECONOMICS_ACTIVATION: value }), /ECONOMICS_ACTIVATION/, JSON.stringify(value));
  }
});

test("trust/config: los TTL y la frescura se validan como enteros dentro de rango", () => {
  const cfg = loadTrustConfig({
    TRUST_SIGNED_URL_TTL_SECONDS: "60",
    TRUST_OWN_PREVIEW_TTL_SECONDS: "600",
    TRUST_PUBLIC_PHOTO_TTL_SECONDS: "1800",
    TRUST_VEHICLE_ACTIVITY_FRESHNESS_SECONDS: "300"
  });
  assert.deepEqual(
    [cfg.signedUrlTtlSeconds, cfg.ownPreviewTtlSeconds, cfg.publicPhotoTtlSeconds, cfg.vehicleActivityFreshnessSeconds],
    [60, 600, 1800, 300]
  );
  // Vacío = valor por defecto.
  assert.equal(loadTrustConfig({ TRUST_SIGNED_URL_TTL_SECONDS: "" }).signedUrlTtlSeconds, 120);
  for (const [name, bad] of [
    ["TRUST_SIGNED_URL_TTL_SECONDS", "29"],
    ["TRUST_SIGNED_URL_TTL_SECONDS", "301"],
    ["TRUST_OWN_PREVIEW_TTL_SECONDS", "59"],
    ["TRUST_OWN_PREVIEW_TTL_SECONDS", "901"],
    ["TRUST_PUBLIC_PHOTO_TTL_SECONDS", "3601"],
    ["TRUST_VEHICLE_ACTIVITY_FRESHNESS_SECONDS", "59"],
    ["TRUST_SIGNED_URL_TTL_SECONDS", "abc"],
    ["TRUST_SIGNED_URL_TTL_SECONDS", "90.5"]
  ] as const) {
    assert.throws(() => loadTrustConfig({ [name]: bad }), new RegExp(name), `${name}=${bad}`);
  }
});

test("trust/config: el pepper de IP se recorta y un valor en blanco equivale a «sin pepper»", () => {
  assert.equal(loadTrustConfig({ TRUST_IP_HASH_PEPPER: "  secreto  " }).ipHashPepper, "secreto");
  assert.equal(loadTrustConfig({ TRUST_IP_HASH_PEPPER: "   " }).ipHashPepper, undefined);
  assert.equal(loadTrustConfig({}).ipHashPepper, undefined);
});
