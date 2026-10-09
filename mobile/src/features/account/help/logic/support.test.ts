// Pruebas de la lógica pura del Centro de ayuda y las consultas (slice account · paquete account-help).
// Ejecutar:  cd mobile && node --import tsx --test "src/features/account/**/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupportTicketDetail } from "@/api/types";
import {
  MAX_IMAGE_BYTES,
  REPLY_BODY_MAX,
  TICKET_BODY_MAX,
  checkImage,
  describeTripOption,
  formatFileSize,
  hasErrors,
  normalizeImageMime,
  summaryOf,
  ticketCanClose,
  ticketCanReply,
  ticketFilterLabel,
  ticketStatusTone,
  validateReplyBody,
  validateTicketForm,
} from "./support";

describe("validateTicketForm", () => {
  it("exige tipo de consulta y texto, en español", () => {
    const errors = validateTicketForm({ category: null, body: "   " });
    assert.equal(errors.category, "Elige el tipo de consulta.");
    assert.equal(errors.body, "Escribe tu consulta.");
    assert.equal(hasErrors(errors), true);
  });
  it("cuenta el texto recortado: 500 vale, 501 no", () => {
    assert.equal(hasErrors(validateTicketForm({ category: "trip_issue", body: ` ${"a".repeat(TICKET_BODY_MAX)} ` })), false);
    const long = validateTicketForm({ category: "trip_issue", body: "a".repeat(TICKET_BODY_MAX + 1) });
    assert.equal(long.body, "La consulta no puede tener más de 500 caracteres.");
  });
  it("no deja enviar mientras se suben imágenes", () => {
    const errors = validateTicketForm({ category: "payment_issue", body: "Hola", uploadingCount: 1 });
    assert.match(errors.attachments ?? "", /imágenes/);
  });
  it("una consulta completa no tiene errores", () => {
    assert.deepEqual(validateTicketForm({ category: "account_profile", body: "Quiero cambiar mi número", uploadingCount: 0 }), {});
  });
});

describe("validateReplyBody", () => {
  it("1 a 1.000 caracteres", () => {
    assert.equal(validateReplyBody("  "), "Escribe tu respuesta.");
    assert.equal(validateReplyBody("ok"), null);
    assert.equal(validateReplyBody("a".repeat(REPLY_BODY_MAX)), null);
    assert.match(validateReplyBody("a".repeat(REPLY_BODY_MAX + 1)) ?? "", /1\.000/);
  });
});

describe("describeTripOption", () => {
  it("formatea el viaje como en la lámina 35: «Vie, 16 may · Sevilla → Camas»", () => {
    // El 16 de mayo fue viernes en 2025 (en 2026 es sábado): el día de la semana sale de la fecha, no se inventa.
    assert.equal(
      describeTripOption({ departureAt: "2025-05-16T05:30:00.000Z", originLabel: "Sevilla", destinationLabel: "Camas" }),
      "Vie, 16 may · Sevilla → Camas",
    );
    assert.equal(
      describeTripOption({ departureAt: "2026-05-16T05:30:00.000Z", originLabel: "Sevilla", destinationLabel: "Camas" }),
      "Sáb, 16 may · Sevilla → Camas",
    );
  });
  it("sin datos no inventa nada", () => {
    assert.equal(describeTripOption({ departureAt: null, originLabel: null, destinationLabel: "  " }), "Sin fecha · Sin dato → Sin dato");
  });
});

describe("adjuntos", () => {
  it("normaliza el tipo MIME del selector de fotos", () => {
    assert.equal(normalizeImageMime("image/jpg"), "image/jpeg");
    assert.equal(normalizeImageMime("IMAGE/PNG; charset=binary"), "image/png");
    assert.equal(normalizeImageMime("image/heic"), "image/heic");
    assert.equal(normalizeImageMime("application/pdf"), null);
    assert.equal(normalizeImageMime(undefined), null);
  });
  it("comprueba tipo y tamaño (1 byte – 10 MiB)", () => {
    assert.deepEqual(checkImage("image/jpeg", 482_113), { ok: true, contentType: "image/jpeg" });
    assert.deepEqual(checkImage("image/gif", 1000), { ok: false, reason: "type" });
    assert.deepEqual(checkImage("image/png", MAX_IMAGE_BYTES + 1), { ok: false, reason: "size" });
    assert.deepEqual(checkImage("image/png", 0), { ok: false, reason: "size" });
    assert.deepEqual(checkImage("image/png", null), { ok: false, reason: "size" });
    assert.deepEqual(checkImage("image/png", MAX_IMAGE_BYTES), { ok: true, contentType: "image/png" });
  });
  it("tamaños legibles", () => {
    assert.equal(formatFileSize(512), "512 B");
    assert.equal(formatFileSize(482_113), "471 KB");
    assert.equal(formatFileSize(1_572_864), "1,5 MB");
  });
});

describe("estado de una consulta", () => {
  const detail: SupportTicketDetail = {
    id: "f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a01",
    reference: "MVC-2026-000123",
    category: "trip_issue",
    status: "open",
    bodyPreview: "El conductor canceló",
    tripId: null,
    bookingId: null,
    attachmentCount: 0,
    hasStaffReply: false,
    lastActivityAt: "2026-10-05T05:35:00.000Z",
    createdAt: "2026-10-05T05:35:00.000Z",
    body: "El conductor canceló el viaje",
    messages: [],
    closedAt: null,
  };
  it("abierta y respondida admiten respuesta y cierre; cerrada no", () => {
    assert.equal(ticketCanReply(detail), true);
    assert.equal(ticketCanClose({ status: "answered" }), true);
    assert.equal(ticketCanReply({ status: "closed" }), false);
    assert.equal(ticketCanClose({ status: "closed" }), false);
  });
  it("el tono de cada estado", () => {
    assert.equal(ticketStatusTone("open"), "blue");
    assert.equal(ticketStatusTone("answered"), "green");
    assert.equal(ticketStatusTone("closed"), "gray");
  });
  it("summaryOf conserva solo los campos de la lista", () => {
    const summary = summaryOf(detail);
    assert.equal(summary.reference, "MVC-2026-000123");
    assert.equal("messages" in summary, false);
    assert.equal("body" in summary, false);
  });
  it("etiquetas de filtro", () => {
    assert.deepEqual((["all", "open", "answered", "closed"] as const).map(ticketFilterLabel), ["Todas", "Abiertas", "Respondidas", "Cerradas"]);
  });
});
