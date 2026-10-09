// Pruebas de la lógica de compartir la ubicación del conductor (driver-ops).
// Ejecutar:  cd mobile && node --import tsx --test "src/features/driver/**/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DriverFix } from "../types";
import { deriveMotion, monotonicRecordedAt, sharingCard, statusForFailure, statusForPermission, toLocationBody } from "./sharing";

const fix = (overrides: Partial<DriverFix> = {}): DriverFix => ({
  latitude: 37.33,
  longitude: -5.93,
  accuracyM: 6.04,
  recordedAtMs: Date.parse("2026-10-05T05:17:00.000Z"),
  speedMps: null,
  headingDegrees: null,
  ...overrides,
});

describe("permiso y fallos → estado", () => {
  it("granted busca posición; sin preguntar pide permiso", () => {
    assert.equal(statusForPermission({ status: "granted", canAskAgain: true, undetermined: false }), "searching");
    assert.equal(statusForPermission({ status: "denied", canAskAgain: true, undetermined: true }), "needs_permission");
    assert.equal(statusForPermission({ status: "denied", canAskAgain: true, undetermined: false }), "denied");
    assert.equal(statusForPermission({ status: "blocked", canAskAgain: false, undetermined: false }), "blocked");
    assert.equal(statusForPermission({ status: "denied", canAskAgain: false, undetermined: false }), "blocked");
    assert.equal(statusForPermission({ status: "unavailable", canAskAgain: false, undetermined: false }), "services_off");
  });
  it("cada fallo de la plataforma tiene su estado", () => {
    assert.equal(statusForFailure("permission_denied"), "denied");
    assert.equal(statusForFailure("permission_blocked"), "blocked");
    assert.equal(statusForFailure("services_disabled"), "services_off");
    assert.equal(statusForFailure("timeout"), "searching");
    assert.equal(statusForFailure("unavailable"), "searching");
  });
});

describe("tarjeta de ubicación", () => {
  const ctx = { signal: "live" as const, ageText: null, sendFailed: false };
  it("sin viaje en curso no se ve", () => {
    assert.equal(sharingCard("inactive", ctx).visible, false);
  });
  it("siempre hay una salida: seguir sin compartir", () => {
    for (const status of ["needs_permission", "denied", "blocked", "services_off"] as const) {
      assert.ok(sharingCard(status, ctx).actions.includes("continue_without"), status);
    }
  });
  it("cada estado con tarjeta lleva su icono", () => {
    assert.equal(sharingCard("blocked", ctx).icon, "lock");
    assert.equal(sharingCard("services_off", ctx).icon, "gpsOff");
    assert.equal(sharingCard("paused", ctx).icon, "pause");
    assert.equal(sharingCard("sharing", { signal: "stale", ageText: null, sendFailed: false }).icon, "signal");
    assert.equal(sharingCard("sharing", { signal: "live", ageText: null, sendFailed: true }).icon, "offline");
  });
  it("bloqueado lleva a Ajustes; GPS apagado también", () => {
    assert.ok(sharingCard("blocked", ctx).actions.includes("settings"));
    assert.ok(sharingCard("services_off", ctx).actions.includes("settings"));
    assert.ok(sharingCard("paused", ctx).actions.includes("resume"));
  });
  it("compartiendo: sin tarjeta si el servidor te ve, ámbar si no", () => {
    const ok = sharingCard("sharing", ctx);
    assert.equal(ok.tone, "green");
    assert.equal(ok.ok, true);
    assert.equal(ok.visible, false);
    assert.equal(sharingCard("sharing", { signal: "stale", ageText: "hace 2 min", sendFailed: false }).ok, false);
    const stale = sharingCard("sharing", { signal: "stale", ageText: "hace 2 min", sendFailed: false });
    assert.equal(stale.tone, "amber");
    assert.match(stale.detail ?? "", /hace 2 min/);
    assert.equal(sharingCard("sharing", { signal: "live", ageText: null, sendFailed: true }).tone, "amber");
    assert.equal(sharingCard("sharing", { signal: "none", ageText: null, sendFailed: false }).tone, "blue");
  });
});

describe("velocidad y rumbo", () => {
  it("usa los del sistema si los hay", () => {
    const m = deriveMotion(fix(), fix({ speedMps: 9.04, headingDegrees: 45, recordedAtMs: fix().recordedAtMs + 5000 }));
    assert.deepEqual(m, { speedMps: 9, headingDegrees: 45 });
  });
  it("si no, los deduce de las dos últimas posiciones", () => {
    const a = fix();
    const b = fix({ latitude: 37.3301, recordedAtMs: a.recordedAtMs + 5000 }); // ~11 m al norte en 5 s
    const m = deriveMotion(a, b);
    assert.ok(m.speedMps !== null && m.speedMps > 2 && m.speedMps < 2.5, String(m.speedMps));
    assert.ok(m.headingDegrees !== null && (m.headingDegrees < 1 || m.headingDegrees > 359));
  });
  it("parado: sin rumbo; sin tiempo entre medidas: lo que traiga", () => {
    const a = fix();
    assert.equal(deriveMotion(a, fix({ recordedAtMs: a.recordedAtMs + 5000 })).headingDegrees, null);
    assert.deepEqual(deriveMotion(a, fix({ speedMps: 3 })), { speedMps: 3, headingDegrees: null });
    assert.deepEqual(deriveMotion(null, fix({ speedMps: 3, headingDegrees: 10 })), { speedMps: 3, headingDegrees: 10 });
  });
});

describe("cuerpo de la petición", () => {
  it("campos obligatorios y opcionales redondeados", () => {
    const body = toLocationBody(fix({ speedMps: 9.04, headingDegrees: 360 }), "evt-1");
    assert.equal(body.eventId, "evt-1");
    assert.equal(body.recordedAt, "2026-10-05T05:17:00.000Z");
    assert.equal(body.accuracyM, 6);
    assert.equal(body.speedMps, 9);
    assert.equal(body.headingDegrees, 0);
  });
  it("recorta a los rangos del servidor y omite lo que no hay", () => {
    const body = toLocationBody(fix({ latitude: 95, longitude: -200, accuracyM: 99999, speedMps: 500, headingDegrees: -10 }), "evt-2");
    assert.equal(body.latitude, 90);
    assert.equal(body.longitude, -180);
    assert.equal(body.accuracyM, 10000);
    assert.equal(body.speedMps, 150);
    assert.equal(body.headingDegrees, 350);
    const bare = toLocationBody(fix({ accuracyM: null }), "evt-3");
    assert.equal("accuracyM" in bare, false);
    assert.equal("speedMps" in bare, false);
    assert.equal("headingDegrees" in bare, false);
  });
});

describe("marca de tiempo", () => {
  it("nunca retrocede ni se repite", () => {
    assert.equal(monotonicRecordedAt(1000, null), 1000);
    assert.equal(monotonicRecordedAt(2000, 1000), 2000);
    assert.equal(monotonicRecordedAt(1000, 1000), 1001);
    assert.equal(monotonicRecordedAt(900, 1000), 1001);
  });
});
