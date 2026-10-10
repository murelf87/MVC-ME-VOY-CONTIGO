/**
 * Servidor simulado de «admin» · liquidaciones, documentos legales y atención al cliente, con su RBAC y su auditoría.
 * `node --import tsx --test "src/features/admin/**\/*.test.ts"` (desde `mobile/`).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asArray, asRecord, createApi, num, str, testRuntime, tokenFor } from "@/preview/testing/harness";

function world(seed = "default", as?: "ana" | "miguel") {
  const rt = testRuntime({ profile: "admin", seed });
  const token = as !== undefined ? tokenFor(rt, as) : rt.sessionToken();
  const raw = createApi(rt);
  const api = <T = unknown>(method: string, path: string, init: { body?: unknown; headers?: Record<string, string> } = {}) => raw<T>(method, path, { token, ...init });
  return { rt, api, anonymous: raw };
}

let keyCounter = 0;
function key(): Record<string, string> {
  keyCounter += 1;
  return { "Idempotency-Key": `00000000-0000-4000-8000-${String(keyCounter).padStart(12, "0")}` };
}

function codeOf(body: unknown): string {
  return str(asRecord(asRecord(body).error).code, "error.code");
}

const items = (body: unknown): Array<Record<string, unknown>> => asArray(asRecord(body).items).map((i) => asRecord(i));

describe("liquidaciones · /v1/admin/payout-runs", () => {
  it("lista con personas conductoras y sin proveedor: pedir el abono se bloquea y no se manda nada", async () => {
    const { api } = world();
    const list = await api("GET", "/v1/admin/payout-runs");
    assert.equal(list.status, 200);
    const rows = items(list.body);
    assert.ok(rows.length >= 4);
    assert.ok(rows.every((row) => typeof asRecord(row.driver).displayName === "string"));
    const draft = rows.find((row) => row.status === "draft");
    assert.ok(draft);
    const res = await api("POST", `/v1/admin/payout-runs/${str(draft.id)}/execute`, { headers: key() });
    assert.equal(res.status, 409);
    assert.equal(codeOf(res.body), "PAYMENTS_PROVIDER_DISABLED");
    const after = items((await api("GET", "/v1/admin/payout-runs?status=draft")).body);
    assert.equal(after.length, 1, "sigue en borrador");
  });

  it("filtra por periodo y estado", async () => {
    const { api } = world();
    const failed = items((await api("GET", "/v1/admin/payout-runs?status=failed")).body);
    assert.equal(failed.length, 1);
    assert.equal(failed[0]?.failureCode, "account_rejected");
    const bad = await api("GET", "/v1/admin/payout-runs?period=2026-13");
    assert.equal(bad.status, 400);
  });

  it("generar crea una liquidación por conductor con saldo y no duplica; pedir el abono nunca marca «paid» al instante", async () => {
    const { rt, api } = world("admin-payouts-ready");
    assert.equal(items((await api("GET", "/v1/admin/payout-runs")).body).length, 0);
    const period = new Date(rt.db.nowMs() - 20 * 86_400_000).toISOString().slice(0, 7);
    const generated = await api("POST", "/v1/admin/payout-runs", { body: { period }, headers: key() });
    assert.equal(generated.status, 200);
    const created = asArray(asRecord(generated.body).created).map((row) => asRecord(row));
    assert.equal(created.length, 2);
    assert.ok(created.every((row) => row.status === "draft"));
    const again = asRecord((await api("POST", "/v1/admin/payout-runs", { body: { period }, headers: key() })).body);
    assert.equal(asArray(again.created).length, 0);

    const id = str(created[0]?.id);
    const run = await api("POST", `/v1/admin/payout-runs/${id}/execute`, { headers: key() });
    assert.equal(run.status, 200);
    assert.equal(asRecord(run.body).status, "processing");
    assert.equal(asRecord(run.body).paidAt, null);
    const reExecute = await api("POST", `/v1/admin/payout-runs/${id}/execute`, { headers: key() });
    assert.equal(codeOf(reExecute.body), "PAYOUT_NOT_EXECUTABLE");
    rt.db.clock.advance(30_000);
    const settled = items((await api("GET", "/v1/admin/payout-runs?status=paid")).body);
    assert.equal(settled.length, 1);
    assert.ok(typeof settled[0]?.paidAt === "string");
  });

  it("el proveedor puede rechazar: queda «failed» y el saldo vuelve a estar disponible", async () => {
    const { rt, api } = world("admin-payouts-ready");
    rt.db.setSetting("admin.review.providerOutcome", "failed");
    const period = new Date(rt.db.nowMs() - 20 * 86_400_000).toISOString().slice(0, 7);
    const created = asArray(asRecord((await api("POST", "/v1/admin/payout-runs", { body: { period }, headers: key() })).body).created).map((r) => asRecord(r));
    await api("POST", `/v1/admin/payout-runs/${str(created[0]?.id)}/execute`, { headers: key() });
    rt.db.clock.advance(30_000);
    const failed = items((await api("GET", "/v1/admin/payout-runs?status=failed")).body);
    assert.equal(failed.length, 1);
    assert.equal(failed[0]?.failureCode, "provider_rejected");
  });

  it("sin cuenta de cobro: 409 PAYOUT_ACCOUNT_REQUIRED", async () => {
    const { api } = world("admin-payouts-no-account");
    const draft = items((await api("GET", "/v1/admin/payout-runs?status=draft")).body)[0];
    assert.ok(draft);
    const res = await api("POST", `/v1/admin/payout-runs/${str(draft.id)}/execute`, { headers: key() });
    assert.equal(res.status, 409);
    assert.equal(codeOf(res.body), "PAYOUT_ACCOUNT_REQUIRED");
  });

  it("exige Idempotency-Key, sesión y rol de finanzas", async () => {
    const { api, anonymous } = world();
    assert.equal((await api("POST", "/v1/admin/payout-runs", { body: { period: "2026-09" } })).status, 400);
    assert.equal((await anonymous("GET", "/v1/admin/payout-runs")).status, 401);
    const driver = await world("default", "ana").api("GET", "/v1/admin/payout-runs");
    assert.equal(driver.status, 403);
  });

  it("paginación con cursor", async () => {
    const { api } = world("admin-payouts-many");
    const first = asRecord((await api("GET", "/v1/admin/payout-runs?limit=10")).body);
    assert.equal(asArray(first.items).length, 10);
    assert.ok(typeof first.nextCursor === "string");
    const next = asRecord((await api("GET", `/v1/admin/payout-runs?limit=50&cursor=${encodeURIComponent(str(first.nextCursor))}`)).body);
    assert.equal(asArray(next.items).length, 15);
  });
});

describe("documentos legales · /v1/admin/legal/documents", () => {
  it("lista las versiones: todas en borrador pendiente de revisión legal y sin validez", async () => {
    const { api } = world();
    const res = await api("GET", "/v1/admin/legal/documents");
    assert.equal(res.status, 200);
    const rows = items(res.body);
    assert.ok(rows.length >= 4);
    assert.ok(rows.every((row) => row.pendingLegalReview === true && row.legallyEffective === false));
  });

  it("publicar sin referencia de revisión legal es 422; con referencia retira la versión anterior", async () => {
    const { api } = world("admin-legal-published");
    const terms = items((await api("GET", "/v1/admin/legal/documents")).body).filter((row) => row.kind === "terms");
    assert.deepEqual(terms.map((row) => row.status), ["draft_pending_legal_review", "published"]);
    const draft = terms[0];
    assert.ok(draft);
    const missing = await api("POST", `/v1/admin/legal/documents/${str(draft.id)}/publish`, { body: {} });
    assert.equal(missing.status, 422);
    assert.equal(codeOf(missing.body), "LEGAL_REVIEW_REFERENCE_REQUIRED");
    const ok = await api("POST", `/v1/admin/legal/documents/${str(draft.id)}/publish`, { body: { legalReviewReference: "REV-2026-014" } });
    assert.equal(ok.status, 200);
    assert.equal(asRecord(ok.body).legallyEffective, true);
    const after = items((await api("GET", "/v1/admin/legal/documents")).body).filter((row) => row.kind === "terms");
    assert.deepEqual(after.map((row) => row.status), ["published", "retired"]);
    const again = await api("POST", `/v1/admin/legal/documents/${str(draft.id)}/publish`, { body: { legalReviewReference: "REV-2026-014" } });
    assert.equal(codeOf(again.body), "LEGAL_ALREADY_PUBLISHED");
    const audit = JSON.stringify((await api("GET", "/v1/admin/audit-events?action=admin.legal_document.published")).body);
    assert.ok(audit.includes("REV-2026-014"));
  });

  it("crear una versión nueva valida el texto y nace pendiente de revisión legal", async () => {
    const { api } = world();
    const bad = await api("POST", "/v1/admin/legal/documents", { body: { kind: "privacy", title: " ", sections: [{ heading: "A", paragraphs: ["x"], bullets: [] }] } });
    assert.equal(bad.status, 422);
    assert.equal(codeOf(bad.body), "LEGAL_CONTENT_INVALID");
    const empty = await api("POST", "/v1/admin/legal/documents", { body: { kind: "privacy", title: "Privacidad", sections: [{ heading: "A", paragraphs: [], bullets: [] }] } });
    assert.equal(empty.status, 422);
    const ok = await api("POST", "/v1/admin/legal/documents", { body: { kind: "privacy", title: "Política de privacidad", sections: [{ heading: "Quién es el responsable", paragraphs: ["MVC."], bullets: ["Contacto."] }] } });
    assert.equal(ok.status, 201);
    const doc = asRecord(ok.body);
    assert.equal(doc.version, 2);
    assert.equal(doc.status, "draft_pending_legal_review");
    assert.equal(doc.legallyEffective, false);
    assert.equal(typeof doc.contentSha256, "string");
  });

  it("solo Administración: otros roles reciben 403", async () => {
    const res = await world("default", "ana").api("GET", "/v1/admin/legal/documents");
    assert.equal(res.status, 403);
  });
});

describe("atención al cliente · /v1/admin/support/tickets", () => {
  it("cola con contadores globales por estado y las que esperan al equipo", async () => {
    const { api } = world();
    const res = await api("GET", "/v1/admin/support/tickets");
    assert.equal(res.status, 200);
    const body = asRecord(res.body);
    assert.deepEqual(body.counts, { open: 3, answered: 2, closed: 1 });
    const rows = items(body);
    assert.equal(rows.length, 3);
    assert.ok(rows.every((row) => row.waitingForStaff === true));
    assert.ok(rows.every((row) => /^MVC-\d{4}-\d{6}$/.test(str(row.reference))));
    const mine = items((await api("GET", "/v1/admin/support/tickets?status=all&assigned=me")).body);
    assert.ok(mine.length >= 1 && mine.every((row) => asRecord(row.assignedTo).id !== undefined));
  });

  it("responder pasa a «answered», se asigna a quien responde, y cerrar impide responder", async () => {
    const { api } = world();
    const open = items((await api("GET", "/v1/admin/support/tickets?status=open&assigned=unassigned")).body)[0];
    assert.ok(open);
    const id = str(open.id);
    const empty = await api("POST", `/v1/admin/support/tickets/${id}/reply`, { body: { body: "   " } });
    assert.equal(empty.status, 422);
    const reply = await api("POST", `/v1/admin/support/tickets/${id}/reply`, { body: { body: "Hola, ya lo estamos revisando." } });
    assert.equal(reply.status, 200);
    const detail = asRecord(reply.body);
    assert.equal(detail.status, "answered");
    assert.ok(detail.assignedTo !== null);
    const messages = asArray(detail.messages).map((m) => asRecord(m));
    assert.equal(messages[messages.length - 1]?.authorType, "staff");
    const closed = await api("POST", `/v1/admin/support/tickets/${id}/close`);
    assert.equal(asRecord(closed.body).status, "closed");
    assert.equal(asRecord(closed.body).closedBy, "staff");
    assert.equal(codeOf((await api("POST", `/v1/admin/support/tickets/${id}/reply`, { body: { body: "Otra" } })).body), "TICKET_CLOSED");
    assert.equal(codeOf((await api("POST", `/v1/admin/support/tickets/${id}/close`)).body), "TICKET_ALREADY_CLOSED");
  });

  it("asignar y liberar", async () => {
    const { api } = world();
    const open = items((await api("GET", "/v1/admin/support/tickets?assigned=unassigned")).body)[0];
    assert.ok(open);
    const mine = asRecord((await api("POST", `/v1/admin/support/tickets/${str(open.id)}/assign`, { body: { assignee: "me" } })).body);
    assert.ok(mine.assignedTo !== null);
    const free = asRecord((await api("POST", `/v1/admin/support/tickets/${str(open.id)}/assign`, { body: { assignee: "none" } })).body);
    assert.equal(free.assignedTo, null);
  });

  it("el adjunto se abre con URL firmada de vida corta y deja auditoría", async () => {
    const { api } = world();
    const open = items((await api("GET", "/v1/admin/support/tickets?status=open")).body).find((row) => num(row.attachmentCount) > 0);
    assert.ok(open);
    const detail = asRecord((await api("GET", `/v1/admin/support/tickets/${str(open.id)}`)).body);
    const message = asRecord(asArray(detail.messages)[0]);
    const attachmentId = str(asRecord(asArray(message.attachments)[0]).id);
    const access = await api("POST", `/v1/admin/support/attachments/${attachmentId}/access`, { body: { note: "Revisar captura" } });
    assert.equal(access.status, 200);
    assert.equal(asRecord(access.body).ttlSeconds, 120);
    assert.ok(str(asRecord(access.body).url).startsWith("https://storage.mvc-preview.invalid/"));
    const audit = JSON.stringify((await api("GET", "/v1/admin/audit-events?action=admin.support_attachment.*")).body);
    assert.ok(audit.includes("access_url_issued"));
  });

  it("almacenamiento desactivado y centro de ayuda no disponible se dicen claro", async () => {
    const off = world("admin-support-storage-off").api;
    const open = items((await off("GET", "/v1/admin/support/tickets?status=open")).body).find((row) => num(row.attachmentCount) > 0);
    assert.ok(open);
    const detail = asRecord((await off("GET", `/v1/admin/support/tickets/${str(open.id)}`)).body);
    const attachmentId = str(asRecord(asArray(asRecord(asArray(detail.messages)[0]).attachments)[0]).id);
    const res = await off("POST", `/v1/admin/support/attachments/${attachmentId}/access`, { body: {} });
    assert.equal(res.status, 503);
    assert.equal(codeOf(res.body), "PRIVATE_STORAGE_DISABLED");
    const unavailable = await world("admin-support-off").api("GET", "/v1/admin/support/tickets");
    assert.equal(unavailable.status, 503);
    assert.equal(codeOf(unavailable.body), "SUPPORT_UNAVAILABLE");
    const none = asRecord((await world("admin-support-empty").api("GET", "/v1/admin/support/tickets")).body);
    assert.deepEqual(none.counts, { open: 0, answered: 0, closed: 0 });
  });

  it("rol de finanzas o verificación sin acceso: 403; sin sesión: 401", async () => {
    const { anonymous } = world();
    assert.equal((await anonymous("GET", "/v1/admin/support/tickets")).status, 401);
    assert.equal((await world("default", "ana").api("GET", "/v1/admin/support/tickets")).status, 403);
    assert.equal((await world("admin-ops-finance-only").api("GET", "/v1/admin/support/tickets")).status, 403);
  });

  it("paginación con cursor", async () => {
    const { api } = world("admin-support-many");
    const first = asRecord((await api("GET", "/v1/admin/support/tickets?status=all&limit=20")).body);
    assert.equal(asArray(first.items).length, 20);
    const next = asRecord((await api("GET", `/v1/admin/support/tickets?status=all&limit=50&cursor=${encodeURIComponent(str(first.nextCursor))}`)).body);
    assert.equal(asArray(next.items).length, 16);
  });
});
