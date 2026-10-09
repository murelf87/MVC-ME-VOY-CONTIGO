// Pruebas del visor de auditoría (admin-ops).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPTY_AUDIT_FILTER, actionLabel, actorName, advancedFilterCount, dayEndIso, dayStartIso, hasAnyFilter, metadataRows, parseSpanishDate, validateAuditFilter } from "./audit";

describe("fechas de Madrid", () => {
  it("lee varias formas y rechaza fechas que no existen", () => {
    assert.deepEqual(parseSpanishDate("05/10/2026"), { year: 2026, month: 10, day: 5 });
    assert.deepEqual(parseSpanishDate("5-10-2026"), { year: 2026, month: 10, day: 5 });
    assert.deepEqual(parseSpanishDate("2026-10-05"), { year: 2026, month: 10, day: 5 });
    assert.equal(parseSpanishDate("31/02/2026"), null);
    assert.equal(parseSpanishDate("ayer"), null);
    assert.equal(parseSpanishDate("05/10/1999"), null);
  });
  it("día natural de Madrid en UTC (horario de verano y de invierno)", () => {
    assert.equal(dayStartIso({ year: 2026, month: 10, day: 5 }), "2026-10-04T22:00:00.000Z");
    assert.equal(dayEndIso({ year: 2026, month: 10, day: 5 }), "2026-10-05T21:59:59.999Z");
    assert.equal(dayStartIso({ year: 2026, month: 12, day: 15 }), "2026-12-14T23:00:00.000Z");
  });
});

describe("filtros", () => {
  it("sin filtros no envía nada", () => {
    const v = validateAuditFilter(EMPTY_AUDIT_FILTER);
    assert.deepEqual(v, { ok: true, query: { actorUserId: null, action: null, entityType: null, entityId: null, from: null, to: null } });
    assert.equal(hasAnyFilter(EMPTY_AUDIT_FILTER), false);
  });
  it("el preajuste fija la acción por prefijo y la acción escrita manda sobre él", () => {
    const preset = validateAuditFilter({ ...EMPTY_AUDIT_FILTER, preset: "tariffs" });
    assert.equal(preset.ok && preset.query.action, "admin.tariff*");
    const typed = validateAuditFilter({ ...EMPTY_AUDIT_FILTER, preset: "tariffs", action: "admin.legal.published" });
    assert.equal(typed.ok && typed.query.action, "admin.legal.published");
  });
  it("valida acción, persona, entidad y fechas", () => {
    const v = validateAuditFilter({ ...EMPTY_AUDIT_FILTER, action: "admin tariff", actorUserId: "123", entityType: "tariff version", entityId: "a b", from: "10/10/2026", to: "01/10/2026" });
    assert.equal(v.ok, false);
    if (!v.ok) {
      assert.match(v.errors.action ?? "", /admin\.tariff_draft\.saved/);
      assert.match(v.errors.actorUserId ?? "", /UUID/);
      assert.match(v.errors.entityType ?? "", /guiones bajos/);
      assert.match(v.errors.entityId ?? "", /letras, números y guiones/);
      assert.match(v.errors.to ?? "", /anterior a «desde»/);
    }
  });
  it("convierte fechas a instantes y pasa el UUID a minúsculas", () => {
    const v = validateAuditFilter({ ...EMPTY_AUDIT_FILTER, actorUserId: "A1D4F7C2-9E3B-4C58-B2D6-0F1E2D3C4B12", from: "05/10/2026", to: "05/10/2026" });
    assert.equal(v.ok, true);
    if (v.ok) {
      assert.equal(v.query.actorUserId, "a1d4f7c2-9e3b-4c58-b2d6-0f1e2d3c4b12");
      assert.equal(v.query.from, "2026-10-04T22:00:00.000Z");
      assert.equal(v.query.to, "2026-10-05T21:59:59.999Z");
    }
  });
  it("cuenta filtros avanzados", () => {
    assert.equal(advancedFilterCount({ ...EMPTY_AUDIT_FILTER, action: "x", from: "05/10/2026" }), 2);
    assert.equal(hasAnyFilter({ ...EMPTY_AUDIT_FILTER, preset: "legal" }), true);
  });
});

describe("presentación", () => {
  it("etiqueta acciones conocidas y deja las demás con su código", () => {
    assert.equal(actionLabel("admin.tariff_draft.saved"), "Borrador de tarifa guardado");
    assert.equal(actionLabel("algo.nuevo"), null);
  });
  it("lista los metadatos y marca los ocultos", () => {
    const rows = metadataRows({ purpose: "identity_review", ttlSeconds: 120, contact: "[oculto]", nested: { a: 1 }, nothing: null });
    assert.deepEqual(rows, [
      { key: "purpose", value: "identity_review", hidden: false },
      { key: "ttlSeconds", value: "120", hidden: false },
      { key: "contact", value: "[oculto]", hidden: true },
      { key: "nested", value: '{"a":1}', hidden: false },
      { key: "nothing", value: "—", hidden: false },
    ]);
  });
  it("nombre de quien actuó", () => {
    assert.equal(actorName({ actor: null }, "Sistema", "Persona"), "Sistema");
    assert.equal(actorName({ actor: { id: "x", displayName: null } }, "Sistema", "Persona"), "Persona");
    assert.equal(actorName({ actor: { id: "x", displayName: "Lucía Ramos" } }, "Sistema", "Persona"), "Lucía Ramos");
  });
});
