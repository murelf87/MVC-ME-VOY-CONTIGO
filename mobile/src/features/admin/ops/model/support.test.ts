// Pruebas de la cola de atención al cliente (admin-ops).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SUPPORT_FILTER, activeFilterCount, attachmentKind, formatBytes, initialsOf, isDefaultFilter, isMine, ticketTone, validateReply } from "./support";

describe("filtros", () => {
  it("por defecto: abiertas, de cualquiera, de cualquier tipo", () => {
    assert.deepEqual(DEFAULT_SUPPORT_FILTER, { status: "open", assigned: "any", category: "all" });
    assert.equal(isDefaultFilter(DEFAULT_SUPPORT_FILTER), true);
    assert.equal(isDefaultFilter({ ...DEFAULT_SUPPORT_FILTER, status: "closed" }), false);
    assert.equal(activeFilterCount({ status: "open", assigned: "me", category: "payment_issue" }), 2);
    assert.equal(activeFilterCount(DEFAULT_SUPPORT_FILTER), 0);
  });
});

describe("respuesta", () => {
  it("de 1 a 4000 caracteres tras recortar", () => {
    assert.deepEqual(validateReply("  Hola  "), { ok: true, body: "Hola" });
    const empty = validateReply("   ");
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.match(empty.message, /Escribe una respuesta/);
    assert.equal(validateReply("x".repeat(4000)).ok, true);
    const long = validateReply("x".repeat(4001));
    assert.equal(long.ok, false);
    if (!long.ok) assert.match(long.message, /4\.000 caracteres/);
  });
});

describe("presentación", () => {
  it("tonos de estado", () => {
    assert.equal(ticketTone("open"), "amber");
    assert.equal(ticketTone("answered"), "blue");
    assert.equal(ticketTone("closed"), "gray");
  });
  it("adjuntos", () => {
    assert.equal(attachmentKind("image/jpeg"), "image");
    assert.equal(attachmentKind("application/pdf"), "pdf");
    assert.equal(attachmentKind("text/plain"), "other");
    assert.equal(formatBytes(820), "820 B");
    assert.equal(formatBytes(15360), "15 KB");
    assert.equal(formatBytes(2_411_724), "2,3 MB");
    assert.equal(formatBytes(-1), "");
  });
  it("iniciales y asignación a mí", () => {
    assert.equal(initialsOf("Miguel Torres"), "MT");
    assert.equal(initialsOf("Lucía"), "L");
    assert.equal(initialsOf(" "), "?");
    assert.equal(isMine({ assignedTo: { id: "u1", displayName: "A" } }, "u1"), true);
    assert.equal(isMine({ assignedTo: null }, "u1"), false);
    assert.equal(isMine({ assignedTo: { id: "u2", displayName: null } }, null), false);
  });
});
