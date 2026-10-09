// Pruebas de la documentación privada: finalidad, vida de la URL de 120 s y formato (admin-review).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EVIDENCE_TTL_SECONDS, evidencePurpose, evidenceTitle, formatBytes, isImageContentType, remainingSeconds, ttlOf } from "./evidence";

describe("finalidad del acceso", () => {
  it("cada elemento declara por qué se abre la documentación", () => {
    assert.equal(evidencePurpose("identity"), "identity_review");
    assert.equal(evidencePurpose("private_check"), "identity_review");
    assert.equal(evidencePurpose("driver_license"), "license_review");
    assert.equal(evidencePurpose("profile_photo"), "photo_moderation");
  });
});

describe("vida de la URL firmada", () => {
  it("dura 120 segundos", () => {
    assert.equal(EVIDENCE_TTL_SECONDS, 120);
  });

  it("cuenta los segundos que quedan sin bajar de cero", () => {
    const start = 1_000_000;
    const deadline = start + 120_000;
    assert.equal(remainingSeconds(deadline, start), 120);
    assert.equal(remainingSeconds(deadline, start + 500), 120);
    assert.equal(remainingSeconds(deadline, start + 1_500), 119);
    assert.equal(remainingSeconds(deadline, start + 119_001), 1);
    assert.equal(remainingSeconds(deadline, start + 120_000), 0);
    assert.equal(remainingSeconds(deadline, start + 500_000), 0);
  });

  it("usa la vida que declara el servidor y nunca más de 120 s", () => {
    assert.equal(ttlOf(120), 120);
    assert.equal(ttlOf(60), 60);
    assert.equal(ttlOf(600), 120);
    assert.equal(ttlOf(0), 120);
    assert.equal(ttlOf(Number.NaN), 120);
    assert.equal(ttlOf(-5), 120);
  });
});

describe("formato", () => {
  it("reconoce imágenes", () => {
    assert.equal(isImageContentType("image/jpeg"), true);
    assert.equal(isImageContentType("IMAGE/PNG"), true);
    assert.equal(isImageContentType("application/pdf"), false);
  });

  it("tamaños con coma española", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(184 * 1024), "184 KB");
    assert.equal(formatBytes(2048), "2,0 KB");
    assert.equal(formatBytes(Math.round(1.2 * 1024 * 1024)), "1,2 MB");
    assert.equal(formatBytes(-1), "");
    assert.equal(formatBytes(Number.NaN), "");
  });

  it("el título cae al del tipo si el servidor no lo da", () => {
    assert.equal(evidenceTitle({ kind: "private_document", label: "Anverso del DNI" }), "Anverso del DNI");
    assert.equal(evidenceTitle({ kind: "profile_photo", label: "" }), "Foto de perfil");
  });
});
