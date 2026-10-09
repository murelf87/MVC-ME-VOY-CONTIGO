// Pruebas del expediente: decisiones permitidas, expediente propio, vehículos e historial (admin-review).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminDossierEvent, AdminDossierItem, AdminDossierVehicle } from "@/api/types";
import { dossierItemView, historyView, isOwnDossier, reasonOptionsFor, stateLabel, stateTone, vehicleView } from "./dossier";

function makeItem(overrides: Partial<AdminDossierItem> = {}): AdminDossierItem {
  return {
    key: "driver_license",
    label: "Permiso de conducir",
    state: "in_review",
    badge: "Requiere revisión",
    submittedAt: "2026-10-05T06:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    reason: null,
    evidence: [{ kind: "private_document", id: "e1", label: "", contentType: "image/jpeg", sizeBytes: 188_416, submittedAt: "2026-10-05T06:00:00.000Z", status: "pending" }],
    allowedDecisions: ["approved", "rejected"],
    reasonOptions: [
      { code: "DOCUMENT_REVIEW_REJECTED", label: "Documento no válido", decisions: ["rejected"] },
      { code: "FACE_OUT_OF_FRAME", label: "Rostro fuera del marco", decisions: ["needs_retry"] },
    ],
    ...overrides,
  };
}

describe("estado de un elemento", () => {
  it("cada estado tiene tono y etiqueta", () => {
    assert.equal(stateTone("in_review"), "amber");
    assert.equal(stateTone("approved"), "green");
    assert.equal(stateTone("rejected"), "red");
    assert.equal(stateTone("needs_retry"), "orange");
    assert.equal(stateTone("none"), "gray");
    assert.equal(stateLabel("in_review"), "En revisión");
    assert.equal(stateLabel("needs_retry"), "Nueva captura solicitada");
  });
});

describe("dossierItemView", () => {
  it("ofrece las decisiones del servidor a quien puede escribir", () => {
    const view = dossierItemView(makeItem(), { canWrite: true, isOwn: false });
    assert.deepEqual(view.decisions, ["approved", "rejected"]);
    assert.equal(view.decisionsBlockedReason, null);
    assert.equal(view.evidence[0]?.label, "Documento privado");
    assert.equal(view.evidence[0]?.meta, "184 KB · 5 oct 2026 · 08:00");
    assert.equal(view.submitted, "Entregado: 5 oct 2026 · 08:00");
  });

  it("un rol de solo lectura ve el elemento pero no puede decidir, y se le dice por qué", () => {
    const view = dossierItemView(makeItem(), { canWrite: false, isOwn: false });
    assert.deepEqual(view.decisions, []);
    assert.equal(view.decisionsBlockedReason, "Tu rol puede consultar este elemento, pero no decidir sobre él.");
  });

  it("nadie decide sobre su propio expediente", () => {
    const view = dossierItemView(makeItem(), { canWrite: true, isOwn: true });
    assert.deepEqual(view.decisions, []);
    assert.match(view.decisionsBlockedReason ?? "", /propio expediente/);
  });

  it("recuerda quién decidió y por qué", () => {
    const view = dossierItemView(
      makeItem({ state: "rejected", badge: null, decidedAt: "2026-10-05T08:30:00.000Z", decidedBy: { id: "s1", displayName: "Lucía Ramos" }, reason: "Documento ilegible", allowedDecisions: [] }),
      { canWrite: true, isOwn: false },
    );
    assert.equal(view.decided, "Decidido por Lucía Ramos · 5 oct 2026 · 10:30");
    assert.equal(view.reason, "Motivo: Documento ilegible");
    assert.deepEqual(view.decisions, []);
  });

  it("un elemento sin entrega lo dice", () => {
    const view = dossierItemView(makeItem({ state: "none", badge: null, submittedAt: null, evidence: [], allowedDecisions: [] }), { canWrite: true, isOwn: false });
    assert.equal(view.submitted, "Sin entrega");
    assert.deepEqual(view.evidence, []);
  });
});

describe("reasonOptionsFor", () => {
  it("filtra los motivos por decisión", () => {
    const item = makeItem();
    assert.deepEqual(reasonOptionsFor(item, "rejected").map((option) => option.code), ["DOCUMENT_REVIEW_REJECTED"]);
    assert.deepEqual(reasonOptionsFor(item, "needs_retry").map((option) => option.code), ["FACE_OUT_OF_FRAME"]);
    assert.deepEqual(reasonOptionsFor(item, "approved"), []);
  });
});

describe("expediente propio", () => {
  it("compara el id de la persona con el de quien mira", () => {
    assert.equal(isOwnDossier({ user: { id: "u1" } as never }, "u1"), true);
    assert.equal(isOwnDossier({ user: { id: "u1" } as never }, "u2"), false);
    assert.equal(isOwnDossier({ user: { id: "u1" } as never }, null), false);
    assert.equal(isOwnDossier({ user: { id: "u1" } as never }, undefined), false);
  });
});

describe("vehículos", () => {
  const vehicle: AdminDossierVehicle = {
    id: "v1",
    label: "Seat Arona gris",
    plate: "1234 MBC",
    reviewStatus: "pending",
    documentationStatus: "approved",
    vehiclePhotoStatus: "pending",
    insuranceStatus: "approved",
    reviewEndpoint: "/v1/admin/vehicles/v1/review",
  };

  it("solo se decide lo pendiente", () => {
    const view = vehicleView(vehicle, { canWrite: true, isOwn: false });
    assert.deepEqual(
      view.areas.map((area) => [area.area, area.decidable, area.statusLabel]),
      [
        ["vehicle", true, "Pendiente"],
        ["documentation", false, "Aprobado"],
      ],
    );
    assert.equal(view.plate, "1234 MBC");
  });

  it("sin permiso de escritura o en el expediente propio no hay nada que decidir", () => {
    assert.equal(vehicleView(vehicle, { canWrite: false, isOwn: false }).areas.some((area) => area.decidable), false);
    assert.equal(vehicleView(vehicle, { canWrite: true, isOwn: true }).areas.some((area) => area.decidable), false);
  });
});

describe("historial", () => {
  it("va del más reciente al más antiguo", () => {
    const events: AdminDossierEvent[] = [
      { at: "2026-10-01T10:00:00.000Z", action: "photo.submitted", actor: null, summary: "Foto enviada" },
      { at: "2026-10-05T10:00:00.000Z", action: "identity.approved", actor: { id: "s1", displayName: "Lucía Ramos" }, summary: "Identidad aprobada" },
    ];
    const view = historyView(events);
    assert.deepEqual(view.map((entry) => entry.summary), ["Identidad aprobada", "Foto enviada"]);
    assert.equal(view[0]?.actor, "por Lucía Ramos");
    assert.equal(view[1]?.actor, null);
  });
});
