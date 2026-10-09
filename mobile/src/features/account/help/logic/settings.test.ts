// Pruebas de la lógica pura de «Ajustes» (slice account · paquete account-help).
// Ejecutar:  cd mobile && node --import tsx --test "src/features/account/**/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UserSettings } from "@/api/types";
import {
  FONT_SCALE_ORDER,
  applySettingsPatch,
  fontScaleLabel,
  fontScaleOptions,
  formatPhoneDisplay,
  isEmptyPatch,
  mergePatches,
  revertFailedPatch,
  roleLine,
  serverFontScaleWins,
} from "./settings";

const base: UserSettings = {
  shareLiveLocationInTrip: true,
  fontScale: "normal",
  language: "es",
  updatedAt: null,
  account: {
    userId: "3f6b1c1e-9a4a-4f0e-8c59-6f1d2a7b1001",
    displayName: "Ana García",
    photoUrl: null,
    roles: ["driver", "passenger"],
    phoneE164: "+34600123456",
    pendingDeletion: null,
  },
};

describe("roleLine", () => {
  it("usa los literales de la lámina 34", () => {
    assert.equal(roleLine(["driver", "passenger"]), "Conductora y pasajera");
    assert.equal(roleLine(["passenger", "driver"]), "Conductora y pasajera");
    assert.equal(roleLine(["driver"]), "Conductora");
    assert.equal(roleLine(["passenger"]), "Pasajera");
  });
  it("el personal de MVC y una cuenta sin roles tienen su propia línea", () => {
    assert.equal(roleLine(["admin", "support_admin"]), "Equipo de MVC");
    assert.equal(roleLine([]), "Cuenta de MVC");
  });
});

describe("formatPhoneDisplay", () => {
  it("da formato al móvil español como en la lámina", () => {
    assert.equal(formatPhoneDisplay("+34600123456"), "+34 600 123 456");
  });
  it("deja intacto un prefijo que no es español y no inventa un número", () => {
    assert.equal(formatPhoneDisplay("+447911123456"), "+447911123456");
    assert.equal(formatPhoneDisplay(null), null);
    assert.equal(formatPhoneDisplay("  "), null);
  });
});

describe("tamaños de letra", () => {
  it("están en el orden de la lámina y tienen texto en español", () => {
    assert.deepEqual([...FONT_SCALE_ORDER], ["small", "normal", "large", "extra_large"]);
    assert.deepEqual(fontScaleOptions().map((o) => o.label), ["Pequeño", "Normal", "Grande", "Muy grande"]);
    assert.equal(fontScaleLabel("normal"), "Normal");
  });
});

describe("cambios optimistas de ajustes", () => {
  it("applySettingsPatch cambia solo lo pedido y no toca la cuenta", () => {
    const next = applySettingsPatch(base, { shareLiveLocationInTrip: false });
    assert.equal(next.shareLiveLocationInTrip, false);
    assert.equal(next.fontScale, "normal");
    assert.equal(next.account, base.account);
    assert.equal(base.shareLiveLocationInTrip, true, "no muta el original");
  });
  it("mergePatches: lo más reciente gana en cada campo", () => {
    const merged = mergePatches({ fontScale: "large", shareLiveLocationInTrip: true }, { fontScale: "small" });
    assert.deepEqual(merged, { fontScale: "small", shareLiveLocationInTrip: true });
    assert.equal(isEmptyPatch({}), true);
    assert.equal(isEmptyPatch({ fontScale: "large" }), false);
  });
  it("revertFailedPatch deshace lo que falló salvo lo que se volvió a cambiar después", () => {
    const optimistic = applySettingsPatch(base, { shareLiveLocationInTrip: false, fontScale: "large" });
    const reverted = revertFailedPatch(optimistic, base, { shareLiveLocationInTrip: false, fontScale: "large" }, { fontScale: "extra_large" });
    assert.equal(reverted.shareLiveLocationInTrip, true, "el interruptor vuelve al valor confirmado");
    assert.equal(reverted.fontScale, "large", "el tamaño ya se había cambiado de nuevo: se conserva el más reciente");
  });
});

describe("serverFontScaleWins", () => {
  it("unos ajustes sin guardar nunca (updatedAt null) no pisan la elección local", () => {
    assert.equal(serverFontScaleWins({ updatedAt: null }), false);
    assert.equal(serverFontScaleWins({ updatedAt: "2026-10-05T05:35:00.000Z" }), true);
  });
});
