// Pruebas de la cola «Usuarios y revisión» (admin-review).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminReviewDecisionResult, AdminReviewQueueItem } from "@/api/types";
import {
  DEFAULT_QUEUE_FILTERS,
  decisionOutcome,
  hasActiveFilters,
  pendingItemKeys,
  pendingItemNames,
  roleChip,
  roleFilterText,
  rowAccessory,
  showQuickDecisions,
  statusTone,
  tabOptions,
  validateReason,
} from "./reviewQueue";

const ana: AdminReviewQueueItem = {
  userId: "u1",
  displayName: "Ana López",
  firstName: "Ana",
  photoUrl: null,
  roles: ["driver"],
  tab: "pending",
  statusLabel: "Pendiente",
  submittedAt: "2026-10-05T07:22:45.000Z",
  pendingCount: 2,
  canDecide: true,
  rows: [
    { key: "identity", label: "Identidad · En revisión", state: "in_review", badge: null },
    { key: "driver_license", label: "Permiso de conducir", state: "in_review", badge: "Requiere revisión" },
    { key: "profile_photo", label: "Foto de perfil", state: "approved", badge: null },
  ],
};

describe("roleChip", () => {
  it("rotula por rol, sin género", () => {
    assert.deepEqual(roleChip(["driver"]), { label: "Conductor", icon: "car", a11y: "Conductor" });
    assert.deepEqual(roleChip(["passenger"]), { label: "Pasajero", icon: "person", a11y: "Pasajero" });
  });
  it("quien tiene los dos roles se muestra como conductor", () => {
    assert.equal(roleChip(["passenger", "driver"]).label, "Conductor");
    assert.equal(roleChip(["passenger", "driver"]).a11y, "Conductor y pasajero");
  });
});

describe("rowAccessory", () => {
  it("la insignia manda sobre el estado", () => {
    assert.deepEqual(rowAccessory({ state: "in_review", badge: "Requiere revisión" }), { kind: "badge", text: "Requiere revisión" });
  });
  it("reloj para lo que espera sin insignia, visto para lo aprobado", () => {
    assert.deepEqual(rowAccessory({ state: "in_review", badge: null }), { kind: "clock" });
    assert.deepEqual(rowAccessory({ state: "approved", badge: null }), { kind: "check" });
    assert.deepEqual(rowAccessory({ state: "rejected", badge: null }), { kind: "cross" });
    assert.deepEqual(rowAccessory({ state: "needs_retry", badge: null }), { kind: "retry" });
    assert.deepEqual(rowAccessory({ state: "none", badge: null }), { kind: "none" });
  });
});

describe("estado y elementos pendientes", () => {
  it("tono de la píldora por pestaña", () => {
    assert.equal(statusTone("pending"), "amber");
    assert.equal(statusTone("approved"), "green");
    assert.equal(statusTone("rejected"), "red");
    assert.equal(statusTone("none"), "gray");
  });
  it("lista lo que está en revisión", () => {
    assert.deepEqual(pendingItemKeys(ana), ["identity", "driver_license"]);
    assert.deepEqual(pendingItemNames(ana), ["Identidad", "Permiso de conducir"]);
  });
  it("las decisiones rápidas exigen permiso, que el servidor deje decidir y algo pendiente", () => {
    assert.equal(showQuickDecisions(ana, true), true);
    assert.equal(showQuickDecisions(ana, false), false);
    assert.equal(showQuickDecisions({ canDecide: false, pendingCount: 2 }, true), false);
    assert.equal(showQuickDecisions({ canDecide: true, pendingCount: 0 }, true), false);
  });
});

describe("filtros y pestañas", () => {
  it("por defecto no hay filtros activos", () => {
    assert.equal(hasActiveFilters(DEFAULT_QUEUE_FILTERS), false);
    assert.equal(hasActiveFilters({ ...DEFAULT_QUEUE_FILTERS, role: "driver" }), true);
    assert.equal(hasActiveFilters({ ...DEFAULT_QUEUE_FILTERS, item: "identity" }), true);
  });
  it("el selector de rol enseña «Rol» sin filtro", () => {
    assert.equal(roleFilterText(null), "Rol");
    assert.equal(roleFilterText("driver"), "Conductores");
    assert.equal(roleFilterText("passenger"), "Pasajeros");
  });
  it("solo «Pendientes» lleva contador", () => {
    assert.deepEqual(tabOptions({ pending: 5, approved: 31, rejected: 2 }), [
      { value: "pending", label: "Pendientes", badge: 5 },
      { value: "approved", label: "Aprobados" },
      { value: "rejected", label: "Rechazados" },
    ]);
    assert.deepEqual(tabOptions(undefined)[0], { value: "pending", label: "Pendientes" });
  });
});

describe("validateReason", () => {
  it("exige entre 3 y 1000 caracteres", () => {
    assert.equal(validateReason("ab").ok, false);
    assert.equal(validateReason("   ").ok, false);
    assert.equal(validateReason("x".repeat(1001)).ok, false);
    assert.deepEqual(validateReason("  Foto borrosa  "), { ok: true, reason: "Foto borrosa" });
  });
});

describe("decisionOutcome", () => {
  const summary = null;
  it("todo decidido → éxito según la decisión", () => {
    const result: AdminReviewDecisionResult = {
      userId: "u1",
      summary,
      results: [
        { item: "identity", outcome: "approved", errorCode: null, message: null },
        { item: "driver_license", outcome: "approved", errorCode: null, message: null },
      ],
    };
    assert.deepEqual(decisionOutcome(result, "approved", "Ana López"), { kind: "success", message: "Aprobado: Ana López." });
    assert.equal(decisionOutcome(result, "rejected", "Ana López").message, "Rechazado: Ana López.");
  });
  it("algunos omitidos → aviso parcial", () => {
    const result: AdminReviewDecisionResult = {
      userId: "u1",
      summary,
      results: [
        { item: "identity", outcome: "approved", errorCode: null, message: null },
        { item: "driver_license", outcome: "skipped", errorCode: "NOTHING_TO_REVIEW", message: "x" },
      ],
    };
    const outcome = decisionOutcome(result, "approved", "Ana López");
    assert.equal(outcome.kind, "warning");
    assert.match(outcome.message, /Ana López/);
  });
  it("todo omitido → error con el motivo", () => {
    const result: AdminReviewDecisionResult = {
      userId: "u1",
      summary,
      results: [{ item: "identity", outcome: "skipped", errorCode: "REVIEW_ITEM_INVALID", message: "x" }],
    };
    assert.equal(decisionOutcome(result, "needs_retry", "Ana López").kind, "error");
    assert.equal(decisionOutcome(result, "needs_retry", "Ana López").message, "Esta decisión no se puede aplicar a este elemento.");
  });
});
