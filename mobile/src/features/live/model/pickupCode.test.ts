// Pruebas del código de recogida (slice live): estados de la tarjeta, código en memoria y generación automática.
// Ejecutar:  cd mobile && node --import tsx --test "src/features/live/**/*.test.ts"
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { LivePickupCodeState } from "@/api/types";
import {
  attemptsWarning,
  codeCardKind,
  codeDigits,
  currentPlainCode,
  forgetPickupCode,
  readPickupCode,
  rememberPickupCode,
  resetPickupCodes,
  shouldAutoGenerate,
  spokenCode,
  subscribePickupCodes,
} from "./pickupCode";

const BOOKING = "7d9e2c41-8a3f-4b65-b1d0-5e4a9c3f2b88";

function state(overrides: Partial<LivePickupCodeState> = {}): LivePickupCodeState {
  return { status: "active", codeLength: 6, generatedAt: "2026-10-05T05:23:10.000Z", verifiedAt: null, attemptsRemaining: 5, ...overrides };
}

const idle = { tripStatus: "active" as const, phase: "at_pickup" as const, plain: null, generating: false, failed: false };

afterEach(() => resetPickupCodes());

describe("código en memoria", () => {
  it("guarda, lee, avisa a los suscriptores y olvida", () => {
    let calls = 0;
    const off = subscribePickupCodes(() => {
      calls += 1;
    });
    assert.equal(readPickupCode(BOOKING), null);
    rememberPickupCode(BOOKING, "741695", "2026-10-05T05:23:10.000Z");
    assert.deepEqual(readPickupCode(BOOKING), { code: "741695", generatedAt: "2026-10-05T05:23:10.000Z" });
    forgetPickupCode(BOOKING);
    assert.equal(readPickupCode(BOOKING), null);
    forgetPickupCode(BOOKING);
    off();
    rememberPickupCode(BOOKING, "000000", "2026-10-05T05:23:10.000Z");
    assert.equal(calls, 2);
  });

  it("el código guardado solo vale mientras el servidor tenga ESE código activo", () => {
    const stored = { code: "741695", generatedAt: "2026-10-05T05:23:10.000Z" };
    assert.equal(currentPlainCode(stored, state()), "741695");
    assert.equal(currentPlainCode(stored, state({ generatedAt: "2026-10-05T05:23:10Z" })), "741695", "mismo instante con otro formato");
    assert.equal(currentPlainCode(stored, state({ generatedAt: "2026-10-05T05:30:00.000Z" })), null, "se generó otro desde otro móvil");
    assert.equal(currentPlainCode(stored, state({ status: "verified" })), null);
    assert.equal(currentPlainCode(stored, state({ status: "locked" })), null);
    assert.equal(currentPlainCode(stored, state({ status: "not_generated", generatedAt: null })), null);
    assert.equal(currentPlainCode(null, state()), null);
  });
});

describe("tarjeta del código", () => {
  it("ready cuando la app conserva el código vigente", () => {
    assert.equal(codeCardKind({ ...idle, state: state(), plain: "741695" }), "ready");
  });

  it("lost cuando el servidor tiene uno activo pero la app lo perdió: no se recupera, se genera otro", () => {
    assert.equal(codeCardKind({ ...idle, state: state() }), "lost");
  });

  it("generating mientras se genera y cuando aún no existe y el viaje está en marcha", () => {
    assert.equal(codeCardKind({ ...idle, state: state({ status: "not_generated", generatedAt: null }), generating: true }), "generating");
    assert.equal(codeCardKind({ ...idle, state: state({ status: "not_generated", generatedAt: null }) }), "generating");
  });

  it("notStarted si el viaje aún no ha empezado", () => {
    assert.equal(codeCardKind({ ...idle, tripStatus: "published", phase: "scheduled", state: state({ status: "not_generated", generatedAt: null }) }), "notStarted");
  });

  it("verified, locked, error y hidden", () => {
    assert.equal(codeCardKind({ ...idle, phase: "in_vehicle", state: state({ status: "verified", verifiedAt: "2026-10-05T05:25:12.000Z" }) }), "verified");
    assert.equal(codeCardKind({ ...idle, state: state({ status: "locked", attemptsRemaining: 0 }) }), "locked");
    assert.equal(codeCardKind({ ...idle, state: state({ status: "locked", attemptsRemaining: 0 }), failed: true }), "error");
    assert.equal(codeCardKind({ ...idle, state: state({ status: "not_generated", generatedAt: null }), failed: true }), "error");
    assert.equal(codeCardKind({ ...idle, phase: "completed", state: state({ status: "verified" }) }), "hidden");
    assert.equal(codeCardKind({ ...idle, phase: "cancelled", state: state() }), "hidden");
  });
});

describe("generación automática", () => {
  it("solo cuando no hay ningún código y el viaje está en marcha", () => {
    const none = state({ status: "not_generated", generatedAt: null });
    assert.equal(shouldAutoGenerate(none, "active", "driver_en_route"), true);
    assert.equal(shouldAutoGenerate(none, "active", "at_pickup"), true);
    assert.equal(shouldAutoGenerate(none, "published", "scheduled"), false);
    assert.equal(shouldAutoGenerate(none, "active", "in_vehicle"), false);
    assert.equal(shouldAutoGenerate(none, "completed", "completed"), false);
    assert.equal(shouldAutoGenerate(none, "cancelled", "cancelled"), false);
  });

  it("jamás invalida un código activo (aunque la app lo haya perdido) ni uno bloqueado", () => {
    assert.equal(shouldAutoGenerate(state(), "active", "at_pickup"), false);
    assert.equal(shouldAutoGenerate(state({ status: "locked" }), "active", "at_pickup"), false);
    assert.equal(shouldAutoGenerate(state({ status: "verified" }), "active", "in_vehicle"), false);
  });
});

describe("casillas y avisos", () => {
  it("codeDigits reparte el código en `length` casillas y rellena con vacías", () => {
    assert.deepEqual(codeDigits("741695", 6), ["7", "4", "1", "6", "9", "5"]);
    assert.deepEqual(codeDigits("7416", 6), ["7", "4", "1", "6", "", ""]);
    assert.deepEqual(codeDigits(null, 4), ["", "", "", ""]);
    assert.deepEqual(codeDigits("741695", 4), ["7", "4", "1", "6"]);
    assert.deepEqual(codeDigits("12", 0), []);
  });

  it("spokenCode separa los dígitos para lectores de pantalla", () => {
    assert.equal(spokenCode("741695"), "7 4 1 6 9 5");
  });

  it("attemptsWarning solo avisa cuando ya se gastó algún intento", () => {
    assert.equal(attemptsWarning(state({ attemptsRemaining: 5 })), null);
    assert.equal(attemptsWarning(state({ attemptsRemaining: 3 })), 3);
    assert.equal(attemptsWarning(state({ attemptsRemaining: null })), null);
    assert.equal(attemptsWarning(state({ status: "verified", attemptsRemaining: 2 })), null);
  });
});
