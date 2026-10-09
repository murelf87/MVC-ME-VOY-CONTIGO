// Pruebas de los documentos legales (admin-ops): edición, validación y publicación con referencia de revisión legal.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canPublish, emptySection, groupByKind, sectionsToDrafts, splitBullets, splitParagraphs, validateLegalDraft, validatePublish } from "./legal";

const NOW = Date.parse("2026-10-05T07:17:00+02:00");

describe("secciones", () => {
  it("separa párrafos por línea en blanco y viñetas por línea", () => {
    assert.deepEqual(splitParagraphs("Uno.\n\nDos\ncontinúa.\n\n\n  Tres. "), ["Uno.", "Dos\ncontinúa.", "Tres."]);
    assert.deepEqual(splitBullets("- Una\n• Dos\n\n  * Tres  \nCuatro"), ["Una", "Dos", "Tres", "Cuatro"]);
  });
  it("ida y vuelta entre contrato y borrador de edición", () => {
    const drafts = sectionsToDrafts([{ heading: "1. Objeto", paragraphs: ["A", "B"], bullets: ["x", "y"] }]);
    assert.deepEqual(drafts, [{ heading: "1. Objeto", paragraphs: "A\n\nB", bullets: "x\ny" }]);
  });
});

describe("validación del borrador", () => {
  it("un documento válido produce el cuerpo del contrato", () => {
    const v = validateLegalDraft("terms", "  Términos y condiciones  ", [{ heading: " 1. Objeto ", paragraphs: "Texto uno.\n\nTexto dos.", bullets: "" }]);
    assert.equal(v.ok, true);
    if (v.ok) {
      assert.deepEqual(v.input, { kind: "terms", title: "Términos y condiciones", sections: [{ heading: "1. Objeto", paragraphs: ["Texto uno.", "Texto dos."], bullets: [] }] });
    }
  });
  it("exige título, secciones, encabezado y contenido", () => {
    const v = validateLegalDraft("privacy", "ab", [emptySection()]);
    assert.equal(v.ok, false);
    if (!v.ok) {
      assert.match(v.errors.title ?? "", /entre 3 y 200/);
      assert.match(v.errors.perSection[0]?.heading ?? "", /encabezado/);
      assert.match(v.errors.perSection[0]?.general ?? "", /al menos un párrafo o una viñeta/);
    }
    const none = validateLegalDraft("privacy", "Política", []);
    assert.equal(none.ok, false);
    if (!none.ok) assert.match(none.errors.sections ?? "", /entre 1 y 60 secciones/);
  });
  it("limita la longitud de párrafos y viñetas", () => {
    const v = validateLegalDraft("privacy", "Política", [{ heading: "H", paragraphs: "x".repeat(5001), bullets: "y".repeat(1001) }]);
    assert.equal(v.ok, false);
    if (!v.ok) {
      assert.match(v.errors.perSection[0]?.paragraphs ?? "", /párrafos/);
      assert.match(v.errors.perSection[0]?.bullets ?? "", /viñetas/);
    }
  });
});

describe("publicar", () => {
  it("nunca sin la referencia de la revisión legal", () => {
    for (const reference of ["", "  ", "ab"]) {
      const v = validatePublish(reference, "", NOW);
      assert.equal(v.ok, false, `«${reference}»`);
      if (!v.ok) assert.match(v.errors.reference ?? "", /revisión legal/);
    }
  });
  it("con referencia válida y sin fecha rige desde ahora", () => {
    const v = validatePublish(" Revisión legal 2026-11-02 ", "", NOW);
    assert.deepEqual(v, { ok: true, request: { legalReviewReference: "Revisión legal 2026-11-02" } });
  });
  it("la fecha de entrada en vigor es opcional, válida y no pasada", () => {
    const ok = validatePublish("Revisión 12/2026", "05/11/2026", NOW);
    assert.equal(ok.ok && ok.request.effectiveFrom, "2026-11-04T23:00:00.000Z");
    const today = validatePublish("Revisión 12/2026", "05/10/2026", NOW);
    assert.equal(today.ok, true);
    const past = validatePublish("Revisión 12/2026", "04/10/2026", NOW);
    assert.equal(past.ok, false);
    if (!past.ok) assert.match(past.errors.effectiveFrom ?? "", /anterior a hoy/);
    assert.equal(validatePublish("Revisión 12/2026", "mañana", NOW).ok, false);
  });
  it("solo los borradores pendientes de revisión se publican", () => {
    assert.equal(canPublish("draft_pending_legal_review"), true);
    assert.equal(canPublish("published"), false);
    assert.equal(canPublish("retired"), false);
  });
});

describe("agrupación", () => {
  it("por tipo y de la versión más reciente a la más antigua", () => {
    const groups = groupByKind([
      { kind: "privacy" as const, version: 1 },
      { kind: "terms" as const, version: 1 },
      { kind: "terms" as const, version: 3 },
      { kind: "terms" as const, version: 2 },
    ]);
    assert.deepEqual(groups.map((g) => g.kind), ["terms", "privacy"]);
    assert.deepEqual(groups[0]?.items.map((i) => i.version), [3, 2, 1]);
  });
});
