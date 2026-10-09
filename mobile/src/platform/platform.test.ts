import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { guessImageMime } from "./imageMime";
import {
  buildDirectionsUrl,
  buildMailtoUrl,
  buildMapsUrl,
  isSafeExternalUrl,
  isValidCoordinate,
  normalizePhoneForDialing,
} from "./linkBuilders";
import { APPROXIMATE_ACCURACY_M, classifyPrecision, createPositionThrottle, distanceMeters } from "./locationMath";
import { canRequest, guardPermission, isGranted, needsSettings, PERMISSION_UNAVAILABLE, toPermissionResult } from "./permissions";

describe("toPermissionResult", () => {
  it("concedido", () => {
    assert.deepEqual(toPermissionResult({ status: "granted", granted: true, canAskAgain: true }), { status: "granted", canAskAgain: true, undetermined: false });
    assert.equal(toPermissionResult({ granted: true }).status, "granted");
  });

  it("nunca preguntado = denied pero se puede pedir", () => {
    const result = toPermissionResult({ status: "undetermined", granted: false, canAskAgain: true });
    assert.deepEqual(result, { status: "denied", canAskAgain: true, undetermined: true });
    assert.equal(canRequest(result), true);
    assert.equal(needsSettings(result), false);
  });

  it("denegado una vez pero con diálogo disponible (Android) = denied", () => {
    const result = toPermissionResult({ status: "denied", granted: false, canAskAgain: true });
    assert.equal(result.status, "denied");
    assert.equal(result.undetermined, false);
    assert.equal(canRequest(result), true);
  });

  it("denegado sin poder volver a preguntar = blocked → Ajustes", () => {
    const result = toPermissionResult({ status: "denied", granted: false, canAskAgain: false });
    assert.equal(result.status, "blocked");
    assert.equal(needsSettings(result), true);
    assert.equal(canRequest(result), false);
    assert.equal(isGranted(result), false);
  });

  it("sin canAskAgain asumimos que se puede preguntar", () => {
    assert.equal(toPermissionResult({ status: "denied" }).status, "denied");
  });
});

describe("guardPermission", () => {
  it("una excepción nativa se convierte en unavailable", async () => {
    const result = await guardPermission(async () => {
      throw new Error("módulo nativo ausente");
    });
    assert.deepEqual(result, PERMISSION_UNAVAILABLE);
    assert.equal(canRequest(result), false);
    assert.equal(needsSettings(result), false);
  });

  it("traduce la respuesta cuando todo va bien", async () => {
    assert.equal((await guardPermission(async () => ({ status: "granted", granted: true }))).status, "granted");
  });
});

describe("ubicación: cálculos", () => {
  const plazaNueva = { latitude: 37.3886, longitude: -5.9953 };

  it("distanceMeters coincide con una distancia conocida (Sevilla → Dos Hermanas ≈ 12 km)", () => {
    const dosHermanas = { latitude: 37.2828, longitude: -5.9208 };
    const d = distanceMeters(plazaNueva, dosHermanas);
    assert.ok(d > 11_000 && d < 14_500, `distancia inesperada: ${d}`);
    assert.equal(distanceMeters(plazaNueva, plazaNueva), 0);
    assert.ok(Math.abs(distanceMeters(plazaNueva, dosHermanas) - distanceMeters(dosHermanas, plazaNueva)) < 1e-6);
  });

  it("100 m al norte ≈ 100 m", () => {
    const north = { latitude: plazaNueva.latitude + 100 / 111_195, longitude: plazaNueva.longitude };
    assert.ok(Math.abs(distanceMeters(plazaNueva, north) - 100) < 1);
  });

  it("clasifica la precisión", () => {
    assert.equal(classifyPrecision(12, false), "precise");
    assert.equal(classifyPrecision(null, false), "precise");
    assert.equal(classifyPrecision(APPROXIMATE_ACCURACY_M + 1, false), "approximate");
    assert.equal(classifyPrecision(5, true), "approximate");
  });

  it("el regulador deja pasar la primera lectura y respeta el intervalo mínimo", () => {
    const accept = createPositionThrottle({ minIntervalMs: 5_000 });
    assert.equal(accept({ ...plazaNueva, timestamp: 0 }), true);
    assert.equal(accept({ ...plazaNueva, timestamp: 4_999 }), false);
    assert.equal(accept({ ...plazaNueva, timestamp: 5_000 }), true);
    assert.equal(accept({ ...plazaNueva, timestamp: 9_000 }), false);
    assert.equal(accept({ ...plazaNueva, timestamp: 10_000 }), true);
  });

  it("con minDistanceM exige moverse, salvo que venza el latido", () => {
    const accept = createPositionThrottle({ minIntervalMs: 1_000, minDistanceM: 50, heartbeatMs: 20_000 });
    assert.equal(accept({ ...plazaNueva, timestamp: 0 }), true);
    assert.equal(accept({ ...plazaNueva, timestamp: 2_000 }), false, "quieto y sin latido");
    const moved = { latitude: plazaNueva.latitude + 0.001, longitude: plazaNueva.longitude };
    assert.equal(accept({ ...moved, timestamp: 3_000 }), true, "se movió ~111 m");
    assert.equal(accept({ ...moved, timestamp: 10_000 }), false);
    assert.equal(accept({ ...moved, timestamp: 23_000 }), true, "venció el latido");
  });
});

describe("enlaces", () => {
  const target = { latitude: 37.3886, longitude: -5.9953, label: "Plaza Nueva" };

  it("valida coordenadas", () => {
    assert.equal(isValidCoordinate(37.38, -5.99), true);
    assert.equal(isValidCoordinate(91, 0), false);
    assert.equal(isValidCoordinate(0, 181), false);
    assert.equal(isValidCoordinate(Number.NaN, 0), false);
  });

  it("mapas por plataforma", () => {
    assert.equal(buildMapsUrl(target, "ios"), "https://maps.apple.com/?ll=37.388600,-5.995300&q=Plaza%20Nueva");
    assert.equal(buildMapsUrl(target, "android"), "geo:37.388600,-5.995300?q=37.388600,-5.995300(Plaza%20Nueva)");
    assert.equal(buildMapsUrl({ latitude: 37.3886, longitude: -5.9953 }, "web"), "https://www.google.com/maps/search/?api=1&query=37.388600,-5.995300");
    assert.equal(buildMapsUrl({ latitude: 999, longitude: 0 }, "ios"), null);
  });

  it("cómo llegar por plataforma", () => {
    assert.equal(buildDirectionsUrl(target, "ios"), "https://maps.apple.com/?daddr=37.388600,-5.995300&dirflg=d");
    assert.equal(buildDirectionsUrl(target, "android"), "https://www.google.com/maps/dir/?api=1&destination=37.388600,-5.995300&travelmode=driving");
    assert.equal(buildDirectionsUrl({ latitude: 0, longitude: 500 }, "android"), null);
  });

  it("números de teléfono: solo dígitos con + opcional", () => {
    assert.equal(normalizePhoneForDialing("+34 600 11 22 33"), "+34600112233");
    assert.equal(normalizePhoneForDialing("(954) 123-456"), "954123456");
    assert.equal(normalizePhoneForDialing("tel:+34600112233"), null);
    assert.equal(normalizePhoneForDialing("600; DROP"), null);
    assert.equal(normalizePhoneForDialing("123"), null);
    assert.equal(normalizePhoneForDialing(""), null);
  });

  it("solo se abren fuera de la app https y mailto", () => {
    assert.equal(isSafeExternalUrl("https://mvc.example/terminos"), true);
    assert.equal(isSafeExternalUrl("mailto:ayuda@mvc.example"), true);
    assert.equal(isSafeExternalUrl("http://mvc.example"), false);
    assert.equal(isSafeExternalUrl("javascript:alert(1)"), false);
    assert.equal(isSafeExternalUrl("file:///etc/passwd"), false);
    assert.equal(isSafeExternalUrl("intent://scan#Intent;end"), false);
    assert.equal(isSafeExternalUrl("no es una url"), false);
  });

  it("mailto con asunto y cuerpo codificados", () => {
    assert.equal(buildMailtoUrl("ayuda@mvc.example", "Mi viaje", "Hola, ¿qué tal?"), "mailto:ayuda@mvc.example?subject=Mi%20viaje&body=Hola%2C%20%C2%BFqu%C3%A9%20tal%3F");
    assert.equal(buildMailtoUrl("ayuda@mvc.example"), "mailto:ayuda@mvc.example");
    assert.equal(buildMailtoUrl("sin-arroba"), null);
  });
});

describe("guessImageMime", () => {
  it("por extensión, ignorando query y mayúsculas", () => {
    assert.equal(guessImageMime("file:///tmp/foto.JPG"), "image/jpeg");
    assert.equal(guessImageMime("selfie.png?token=1"), "image/png");
    assert.equal(guessImageMime("a.heic"), "image/heic");
    assert.equal(guessImageMime("a.webp#x"), "image/webp");
  });

  it("por defecto image/jpeg", () => {
    assert.equal(guessImageMime(null), "image/jpeg");
    assert.equal(guessImageMime("sin-extension"), "image/jpeg");
    assert.equal(guessImageMime("raro.xyz"), "image/jpeg");
  });
});
