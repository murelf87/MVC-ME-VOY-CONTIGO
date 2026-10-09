// Pruebas de la lógica del código de recogida (driver-ops).
// Ejecutar:  cd mobile && node --import tsx --test "src/features/driver/**/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeConsole, passenger, eta } from "./consoleFixture";
import {
  DEFAULT_MAX_ATTEMPTS,
  attemptsFromDetails,
  canSubmitCode,
  isCompleteCode,
  missingDigits,
  nextPendingAfter,
  pendingPickups,
  pickupContext,
  sanitizeCode,
} from "./pickup";

describe("código tecleado", () => {
  it("solo cifras y como mucho 6", () => {
    assert.equal(sanitizeCode("12a3-4 56789"), "123456");
    assert.equal(sanitizeCode(""), "");
    assert.equal(sanitizeCode("abc"), "");
  });
  it("completo = 6 cifras exactas", () => {
    assert.equal(isCompleteCode("123456"), true);
    assert.equal(isCompleteCode("12345"), false);
    assert.equal(isCompleteCode("1234567"), false);
    assert.equal(isCompleteCode("12345a"), false);
  });
  it("cuántas faltan", () => {
    assert.equal(missingDigits(""), 6);
    assert.equal(missingDigits("1234"), 2);
    assert.equal(missingDigits("123456"), 0);
  });
  it("solo se envía completo, sin petición en curso y con conexión", () => {
    assert.equal(canSubmitCode("123456", { pending: false, offline: false }), true);
    assert.equal(canSubmitCode("12345", { pending: false, offline: false }), false);
    assert.equal(canSubmitCode("123456", { pending: true, offline: false }), false);
    assert.equal(canSubmitCode("123456", { pending: false, offline: true }), false);
  });
});

describe("qué pantalla corresponde", () => {
  const laura = passenger("Laura");
  it("código activo → teclear, con los intentos que quedan", () => {
    const ctx = pickupContext(makeConsole({ passengers: [laura] }), laura.bookingId);
    assert.deepEqual(ctx.mode, { kind: "enter", attemptsRemaining: 5 });
    assert.equal(ctx.passenger?.passenger.firstName, "Laura");
  });
  it("reserva que no está en el viaje", () => {
    assert.deepEqual(pickupContext(makeConsole({ passengers: [laura] }), "otra").mode, { kind: "missing_booking" });
  });
  it("viaje sin iniciar o terminado → no está en marcha", () => {
    assert.deepEqual(pickupContext(makeConsole({ status: "published", passengers: [laura] }), laura.bookingId).mode, { kind: "trip_not_live", tripStatus: "published" });
  });
  it("código bloqueado y código sin generar", () => {
    const locked = passenger("L", { code: { status: "locked", attemptsRemaining: 0 } });
    const missing = passenger("M", { code: { status: "not_generated", attemptsRemaining: null } });
    const c = makeConsole({ passengers: [locked, missing] });
    assert.deepEqual(pickupContext(c, locked.bookingId).mode, { kind: "locked" });
    assert.deepEqual(pickupContext(c, missing.bookingId).mode, { kind: "not_generated" });
  });
  it("ya verificada (idempotente): enseña la hora", () => {
    const done = passenger("N", { pickedUp: true, pickedUpAt: "2026-10-05T05:10:00.000Z", code: { status: "verified", attemptsRemaining: null }, etaToPickup: null });
    assert.deepEqual(pickupContext(makeConsole({ passengers: [done] }), done.bookingId).mode, { kind: "already_verified", at: "2026-10-05T05:10:00.000Z" });
  });
  it("no presentado, completado y cancelado no admiten recogida", () => {
    const ns = passenger("A", { bookingStatus: "no_show" });
    const cp = passenger("B", { bookingStatus: "completed" });
    const cx = passenger("C", { bookingStatus: "driver_cancelled" });
    const c = makeConsole({ status: "completed", passengers: [ns, cp, cx] });
    assert.deepEqual(pickupContext(c, ns.bookingId).mode, { kind: "not_eligible", reason: "no_show" });
    assert.deepEqual(pickupContext(c, cp.bookingId).mode, { kind: "not_eligible", reason: "completed" });
    assert.deepEqual(pickupContext(c, cx.bookingId).mode, { kind: "not_eligible", reason: "cancelled" });
  });
});

describe("recogidas pendientes", () => {
  it("la de menor ETA primero y las ya recogidas fuera", () => {
    const a = passenger("A", { etaToPickup: eta("2026-10-05T05:30:00.000Z") });
    const b = passenger("B", { etaToPickup: eta("2026-10-05T05:20:00.000Z") });
    const done = passenger("D", { pickedUp: true, pickedUpAt: "2026-10-05T05:10:00.000Z", etaToPickup: null });
    const c = makeConsole({ passengers: [a, done, b] });
    assert.deepEqual(pendingPickups(c).map((p) => p.passenger.firstName), ["B", "A"]);
    assert.equal(nextPendingAfter(c, b.bookingId)?.passenger.firstName, "A");
    assert.equal(nextPendingAfter(c, "x")?.passenger.firstName, "B");
  });
  it("sin más pendientes → null", () => {
    const only = passenger("Solo");
    assert.equal(nextPendingAfter(makeConsole({ passengers: [only] }), only.bookingId), null);
  });
});

describe("intentos del servidor", () => {
  it("lee attempts y maxAttempts", () => {
    assert.deepEqual(attemptsFromDetails({ attempts: 2, maxAttempts: 5 }), { used: 2, max: 5, remaining: 3 });
    assert.deepEqual(attemptsFromDetails({ attempts: 5, maxAttempts: 5 }), { used: 5, max: 5, remaining: 0 });
  });
  it("sin máximo usa el de por defecto; basura → null", () => {
    assert.deepEqual(attemptsFromDetails({ attempts: 1 }), { used: 1, max: DEFAULT_MAX_ATTEMPTS, remaining: DEFAULT_MAX_ATTEMPTS - 1 });
    assert.equal(attemptsFromDetails(undefined), null);
    assert.equal(attemptsFromDetails({ attempts: "x" }), null);
    assert.equal(attemptsFromDetails("texto"), null);
  });
});
