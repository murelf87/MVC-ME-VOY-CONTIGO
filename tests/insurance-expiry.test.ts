import test from "node:test";
import assert from "node:assert/strict";
import { detectInsuranceExpiryFromText } from "../src/documents/insurance-expiry-detector.js";

test("detects Spanish insurance expiry near vencimiento keyword", () => {
  const result = detectInsuranceExpiryFromText(
    "Póliza de seguro. Fecha de inicio 01/01/2026. Vencimiento 31/12/2026.",
    new Date("2026-10-08T00:00:00Z")
  );
  assert.ok(result);
  assert.equal(result.expiresOn, "2026-12-31");
  assert.ok(result.confidence >= 0.9);
});

test("supports ISO dates and prefers keyword context", () => {
  const result = detectInsuranceExpiryFromText(
    "Emitido 2026-01-02. Válido hasta 2027-01-02.",
    new Date("2026-10-08T00:00:00Z")
  );
  assert.ok(result);
  assert.equal(result.expiresOn, "2027-01-02");
});

test("returns null when OCR text contains no date", () => {
  assert.equal(
    detectInsuranceExpiryFromText("Seguro del vehículo sin fecha legible"),
    null
  );
});
