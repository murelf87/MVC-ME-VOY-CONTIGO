/**
 * Servidor simulado de «ajustes, ayuda y datos»: ajustes, soporte (viajes, adjuntos, consultas), exportación de datos y
 * eliminación de cuenta contra el mundo sembrado. Se ejecuta con:
 * `node --import tsx --test "src/features/account/preview/*.test.ts"` (desde `mobile/`).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SEED_IDS } from "@/preview";
import { asArray, asRecord, createApi, num, str, testRuntime, tokenFor } from "@/preview/testing/harness";

type Profile = "new" | "passenger" | "driver";

function world(options: { profile?: Profile; seed?: string; clock?: string } = {}) {
  const rt = testRuntime({ profile: options.profile ?? "driver", seed: options.seed ?? "help-center", ...(options.clock ? { clock: options.clock } : {}) });
  const token = rt.sessionToken();
  const raw = createApi(rt);
  const api = <T = unknown>(method: string, path: string, init: { body?: unknown; headers?: Record<string, string> } = {}) =>
    raw<T>(method, path, { token, ...init });
  return { rt, api, anonymous: raw };
}

function codeOf(body: unknown): string {
  return str(asRecord(asRecord(body).error).code, "error.code");
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);

describe("GET|PATCH /v1/me/settings", () => {
  it("devuelve los ajustes por defecto y los datos de la cuenta de la lámina 34", async () => {
    const { api } = world();
    const res = await api("GET", "/v1/me/settings");
    assert.equal(res.status, 200);
    const body = asRecord(res.body);
    assert.equal(body.shareLiveLocationInTrip, true);
    assert.equal(body.fontScale, "normal");
    assert.equal(body.language, "es");
    assert.equal(body.updatedAt, null);
    const account = asRecord(body.account);
    assert.equal(account.displayName, "Ana García");
    assert.equal(account.phoneE164, "+34600123456");
    assert.equal(account.photoUrl, "preview-asset://avatar/ana");
    assert.deepEqual(account.roles, ["driver", "passenger"]);
    assert.equal(account.pendingDeletion, null);
  });

  it("guarda cambios parciales y los conserva en la lectura siguiente", async () => {
    const { api } = world();
    const first = await api("PATCH", "/v1/me/settings", { body: { fontScale: "large" } });
    assert.equal(first.status, 200);
    assert.equal(asRecord(first.body).fontScale, "large");
    assert.equal(asRecord(first.body).shareLiveLocationInTrip, true);
    assert.notEqual(asRecord(first.body).updatedAt, null);
    const second = await api("PATCH", "/v1/me/settings", { body: { shareLiveLocationInTrip: false } });
    assert.equal(second.status, 200);
    const read = asRecord((await api("GET", "/v1/me/settings")).body);
    assert.equal(read.fontScale, "large");
    assert.equal(read.shareLiveLocationInTrip, false);
  });

  it("rechaza valores fuera del contrato y exige sesión", async () => {
    const { api, anonymous } = world();
    assert.equal((await api("PATCH", "/v1/me/settings", { body: { fontScale: "gigante" } })).status, 400);
    assert.equal((await api("PATCH", "/v1/me/settings", { body: { shareLiveLocationInTrip: "sí" } })).status, 400);
    // como el backend real (Fastify con `removeAdditional`), una propiedad desconocida se ignora sin cambiar nada
    const ignored = await api("PATCH", "/v1/me/settings", { body: { otraCosa: 1 } });
    assert.equal(ignored.status, 200);
    assert.equal(asRecord(ignored.body).updatedAt, null);
    assert.equal((await anonymous("GET", "/v1/me/settings")).status, 401);
  });
});

describe("soporte: viajes del selector", () => {
  it("lista el viaje completado del 16 de mayo de 2025 Sevilla → Camas", async () => {
    const { api } = world();
    const res = await api("GET", "/v1/me/support/trips");
    assert.equal(res.status, 200);
    const items = asArray(asRecord(res.body).items).map((item) => asRecord(item));
    const camas = items.find((item) => item.originLabel === "Sevilla" && item.destinationLabel === "Camas");
    assert.ok(camas, "el viaje a Camas está en el selector");
    assert.equal(camas.role, "driver");
    assert.equal(camas.status, "completed");
    assert.equal(str(camas.departureAt).slice(0, 10), "2025-05-16");
    assert.ok(items.every((item) => item.status !== "draft"), "los borradores no se ofrecen");
  });

  it("al pasajero le salen sus reservas con su rol", async () => {
    const { api } = world({ profile: "passenger" });
    const items = asArray(asRecord((await api("GET", "/v1/me/support/trips")).body).items).map((item) => asRecord(item));
    const camas = items.find((item) => item.destinationLabel === "Camas");
    assert.ok(camas);
    assert.equal(camas.role, "passenger");
    assert.notEqual(camas.bookingId, null);
  });
});

describe("soporte: crear una consulta", () => {
  it("crea la consulta con referencia correlativa, es idempotente y se ve en la lista", async () => {
    const { api } = world();
    const trips = asArray(asRecord((await api("GET", "/v1/me/support/trips")).body).items).map((item) => asRecord(item));
    const camas = trips.find((item) => item.destinationLabel === "Camas");
    assert.ok(camas);
    const input = { category: "trip_issue", body: "  El viaje terminó antes de lo previsto.  ", tripId: str(camas.tripId) };
    const created = await api("POST", "/v1/me/support/tickets", { body: input, headers: { "idempotency-key": "ticket-camas-0001" } });
    assert.equal(created.status, 201);
    const ticket = asRecord(created.body);
    assert.equal(ticket.reference, "MVC-2026-000123");
    assert.equal(ticket.status, "open");
    assert.equal(ticket.body, "El viaje terminó antes de lo previsto.");
    assert.equal(ticket.tripId, camas.tripId);
    assert.equal(asArray(ticket.messages).length, 1);

    const replay = await api("POST", "/v1/me/support/tickets", { body: input, headers: { "idempotency-key": "ticket-camas-0001" } });
    assert.equal(replay.status, 200);
    assert.equal(asRecord(replay.body).id, ticket.id);

    const conflict = await api("POST", "/v1/me/support/tickets", {
      body: { ...input, body: "Otra cosa distinta" },
      headers: { "idempotency-key": "ticket-camas-0001" },
    });
    assert.equal(conflict.status, 409);
    assert.equal(codeOf(conflict.body), "SUPPORT_IDEMPOTENCY_CONFLICT");

    const list = asRecord((await api("GET", "/v1/me/support/tickets")).body);
    const items = asArray(list.items).map((item) => asRecord(item));
    assert.equal(items.length, 1);
    assert.equal(items[0]?.reference, "MVC-2026-000123");
    assert.equal(list.nextCursor, null);
  });

  it("valida el texto y los vínculos", async () => {
    const { api } = world();
    assert.equal((await api("POST", "/v1/me/support/tickets", { body: { category: "trip_issue", body: "" } })).status, 400);
    assert.equal((await api("POST", "/v1/me/support/tickets", { body: { category: "trip_issue", body: "   " } })).status, 400);
    assert.equal((await api("POST", "/v1/me/support/tickets", { body: { category: "trip_issue", body: "x".repeat(501) } })).status, 400);
    assert.equal((await api("POST", "/v1/me/support/tickets", { body: { category: "otra", body: "Hola" } })).status, 400);
    const foreign = await api("POST", "/v1/me/support/tickets", { body: { category: "trip_issue", body: "Hola", tripId: SEED_IDS.trips.carlosWork } });
    assert.equal(foreign.status, 403);
    assert.equal(codeOf(foreign.body), "SUPPORT_LINK_FORBIDDEN");
  });

  it("limita las consultas abiertas", async () => {
    const { api } = world({ seed: "help-tickets-limit" });
    const res = await api("POST", "/v1/me/support/tickets", { body: { category: "account_profile", body: "Una más" } });
    assert.equal(res.status, 429);
    assert.equal(codeOf(res.body), "SUPPORT_TICKET_LIMIT");
  });
});

describe("soporte: adjuntos privados", () => {
  it("intención → subida firmada → completar → consulta con adjunto → URL firmada", async () => {
    const { rt, api } = world();
    const intent = await api("POST", "/v1/me/support/uploads/intents", { body: { contentType: "image/jpeg", sizeBytes: JPEG.byteLength } });
    assert.equal(intent.status, 201);
    const intentBody = asRecord(intent.body);
    const put = await rt.createFetch()(str(intentBody.uploadUrl), { method: "PUT", headers: { "content-type": "image/jpeg" }, body: JPEG });
    assert.equal(put.status, 200);

    const done = await api("POST", `/v1/me/support/uploads/${str(intentBody.intentId)}/complete`);
    assert.equal(done.status, 201);
    const attachment = asRecord(done.body);
    assert.equal(attachment.contentType, "image/jpeg");
    assert.equal(attachment.sizeBytes, JPEG.byteLength);
    const again = await api("POST", `/v1/me/support/uploads/${str(intentBody.intentId)}/complete`);
    assert.equal(again.status, 200);
    assert.equal(asRecord(again.body).id, attachment.id);

    const created = await api("POST", "/v1/me/support/tickets", { body: { category: "account_profile", body: "Mira la captura", attachmentIds: [str(attachment.id)] } });
    assert.equal(created.status, 201);
    const ticket = asRecord(created.body);
    assert.equal(ticket.attachmentCount, 1);
    const firstMessage = asRecord(asArray(ticket.messages)[0]);
    assert.equal(asArray(firstMessage.attachments).length, 1);

    const reuse = await api("POST", "/v1/me/support/tickets", { body: { category: "account_profile", body: "Otra", attachmentIds: [str(attachment.id)] } });
    assert.equal(reuse.status, 422);
    assert.equal(codeOf(reuse.body), "SUPPORT_ATTACHMENT_INVALID");

    const download = await api("GET", `/v1/me/support/attachments/${str(attachment.id)}/download`);
    assert.equal(download.status, 200);
    const link = asRecord(download.body);
    assert.match(str(link.url), /^https:\/\//);
    assert.ok(Date.parse(str(link.expiresAt)) > rt.db.nowMs());
  });

  it("rechaza tipos y tamaños fuera del contrato y avisa si no hay almacenamiento privado", async () => {
    const { api } = world();
    const gif = await api("POST", "/v1/me/support/uploads/intents", { body: { contentType: "image/gif", sizeBytes: 100 } });
    assert.equal(gif.status, 422);
    assert.equal(codeOf(gif.body), "PRIVATE_UPLOAD_TYPE_NOT_ALLOWED");
    const big = await api("POST", "/v1/me/support/uploads/intents", { body: { contentType: "image/png", sizeBytes: 11 * 1024 * 1024 } });
    assert.equal(big.status, 422);
    assert.equal(codeOf(big.body), "PRIVATE_UPLOAD_SIZE_INVALID");

    const off = world({ seed: "help-storage-off" });
    const blocked = await off.api("POST", "/v1/me/support/uploads/intents", { body: { contentType: "image/jpeg", sizeBytes: 1000 } });
    assert.equal(blocked.status, 503);
    assert.equal(codeOf(blocked.body), "PRIVATE_STORAGE_NOT_CONFIGURED");
    const text = await off.api("POST", "/v1/me/support/tickets", { body: { category: "payment_issue", body: "Solo texto" } });
    assert.equal(text.status, 201, "las consultas de solo texto siguen funcionando");
  });

  it("la subida firmada exige que el archivo sea una imagen", async () => {
    const { rt, api } = world();
    const bytes = new TextEncoder().encode("esto no es una imagen");
    const intent = asRecord((await api("POST", "/v1/me/support/uploads/intents", { body: { contentType: "image/png", sizeBytes: bytes.byteLength } })).body);
    const put = await rt.createFetch()(str(intent.uploadUrl), { method: "PUT", headers: { "content-type": "image/png" }, body: bytes });
    assert.equal(put.status, 200);
    const done = await api("POST", `/v1/me/support/uploads/${str(intent.intentId)}/complete`);
    assert.equal(done.status, 422);
    assert.equal(codeOf(done.body), "UPLOADED_FILE_TYPE_MISMATCH");
  });
});

describe("soporte: hilo, respuestas y cierre", () => {
  it("la lista trae abierta, respondida y cerrada, la más reciente primero", async () => {
    const { api } = world({ seed: "help-tickets" });
    const items = asArray(asRecord((await api("GET", "/v1/me/support/tickets")).body).items).map((item) => asRecord(item));
    assert.deepEqual(
      items.map((item) => item.status),
      ["open", "answered", "closed"]
    );
    assert.equal(items[0]?.attachmentCount, 1);
    assert.equal(items[1]?.hasStaffReply, true);
    const onlyClosed = asArray(asRecord((await api("GET", "/v1/me/support/tickets?status=closed")).body).items);
    assert.equal(onlyClosed.length, 1);
    const paged = asRecord((await api("GET", "/v1/me/support/tickets?limit=2")).body);
    assert.equal(asArray(paged.items).length, 2);
    assert.notEqual(paged.nextCursor, null);
    const rest = asRecord((await api("GET", `/v1/me/support/tickets?limit=2&cursor=${encodeURIComponent(str(paged.nextCursor))}`)).body);
    assert.equal(asArray(rest.items).length, 1);
    assert.equal(rest.nextCursor, null);
  });

  it("responder reabre una consulta respondida y cerrar la deja cerrada para siempre", async () => {
    const { api } = world({ seed: "help-tickets" });
    const items = asArray(asRecord((await api("GET", "/v1/me/support/tickets")).body).items).map((item) => asRecord(item));
    const answered = items.find((item) => item.status === "answered");
    assert.ok(answered);
    const id = str(answered.id);

    const detail = asRecord((await api("GET", `/v1/me/support/tickets/${id}`)).body);
    const authors = asArray(detail.messages).map((message) => asRecord(message).authorType);
    assert.deepEqual(authors, ["user", "staff"]);

    const replied = await api("POST", `/v1/me/support/tickets/${id}/replies`, { body: { body: "Gracias, ahora sí lo veo bien." } });
    assert.equal(replied.status, 201);
    assert.equal(asRecord(replied.body).status, "open");
    assert.equal(asArray(asRecord(replied.body).messages).length, 3);

    assert.equal((await api("POST", `/v1/me/support/tickets/${id}/replies`, { body: { body: "" } })).status, 400);
    assert.equal((await api("POST", `/v1/me/support/tickets/${id}/replies`, { body: { body: "x".repeat(1001) } })).status, 400);

    const closed = await api("POST", `/v1/me/support/tickets/${id}/close`);
    assert.equal(closed.status, 200);
    assert.equal(asRecord(closed.body).status, "closed");
    assert.equal((await api("POST", `/v1/me/support/tickets/${id}/close`)).status, 200, "cerrar dos veces no falla");

    const afterClose = await api("POST", `/v1/me/support/tickets/${id}/replies`, { body: { body: "¿Sigue ahí?" } });
    assert.equal(afterClose.status, 409);
    assert.equal(codeOf(afterClose.body), "SUPPORT_TICKET_CLOSED");
  });

  it("nadie ve las consultas de otra persona", async () => {
    const { rt, api } = world({ seed: "help-tickets" });
    const items = asArray(asRecord((await api("GET", "/v1/me/support/tickets")).body).items).map((item) => asRecord(item));
    const id = str(items[0]?.id);
    const res = await createApi(rt)("GET", `/v1/me/support/tickets/${id}`, { token: tokenFor(rt, "laura") });
    assert.equal(res.status, 404);
    assert.equal(codeOf(res.body), "SUPPORT_TICKET_NOT_FOUND");
  });
});

describe("exportación de datos", () => {
  it("pide la copia, avanza en cola → preparando → lista y se descarga con URL firmada", async () => {
    const { rt, api } = world();
    const requested = await api("POST", "/v1/me/data-exports", { headers: { "idempotency-key": "export-0001-aaaa" } });
    assert.equal(requested.status, 202);
    const row = asRecord(requested.body);
    assert.equal(row.status, "queued");
    assert.equal(row.downloadable, false);
    const id = str(row.id);

    const same = await api("POST", "/v1/me/data-exports", { headers: { "idempotency-key": "export-0001-aaaa" } });
    assert.equal(asRecord(same.body).id, id, "la misma clave devuelve la misma solicitud");

    assert.equal(codeOf((await api("GET", `/v1/me/data-exports/${id}/download`)).body), "EXPORT_NOT_READY");

    let status = "queued";
    for (let i = 0; i < 4 && status !== "ready"; i += 1) status = str(asRecord((await api("GET", `/v1/me/data-exports/${id}`)).body).status);
    assert.equal(status, "ready");

    const detail = asRecord((await api("GET", `/v1/me/data-exports/${id}`)).body);
    assert.equal(detail.downloadable, true);
    assert.ok(num(detail.sizeBytes) > 0);
    assert.equal(Date.parse(str(detail.expiresAt)) - Date.parse(str(detail.completedAt)), 7 * 86_400_000);

    const link = asRecord((await api("GET", `/v1/me/data-exports/${id}/download`)).body);
    const file = await rt.createFetch()(str(link.url));
    assert.equal(file.status, 200);
    const json: unknown = JSON.parse(await file.text());
    assert.equal(asRecord(asRecord(json).subject).id, SEED_IDS.users.ana);

    const again = await api("POST", "/v1/me/data-exports");
    assert.equal(again.status, 429);
    assert.equal(codeOf(again.body), "EXPORT_RATE_LIMITED");
  });

  it("una copia caducada responde 410 y se puede pedir otra", async () => {
    const { api } = world({ seed: "help-exports" });
    const items = asArray(asRecord((await api("GET", "/v1/me/data-exports")).body).items).map((item) => asRecord(item));
    assert.deepEqual(
      items.map((item) => item.status),
      ["ready", "expired"]
    );
    const expired = items[1];
    const res = await api("GET", `/v1/me/data-exports/${str(expired?.id)}/download`);
    assert.equal(res.status, 410);
    assert.equal(codeOf(res.body), "EXPORT_EXPIRED");
    const fresh = await api("POST", "/v1/me/data-exports");
    assert.equal(fresh.status, 202);
  });

  it("sin almacenamiento privado la solicitud queda bloqueada con su causa", async () => {
    const { api } = world({ seed: "help-storage-off" });
    const res = await api("POST", "/v1/me/data-exports");
    assert.equal(res.status, 202);
    assert.equal(asRecord(res.body).status, "blocked_storage_disabled");
    assert.equal(asRecord(res.body).errorCode, "PRIVATE_STORAGE_NOT_CONFIGURED");
  });

  it("una exportación en curso sembrada termina sola tras unas lecturas", async () => {
    const { api } = world({ seed: "help-exports-busy" });
    const first = asArray(asRecord((await api("GET", "/v1/me/data-exports")).body).items).map((item) => asRecord(item));
    assert.equal(first[0]?.status, "processing");
    await api("GET", "/v1/me/data-exports");
    const last = asArray(asRecord((await api("GET", "/v1/me/data-exports")).body).items).map((item) => asRecord(item));
    assert.equal(last[0]?.status, "ready");
  });
});

describe("eliminación de cuenta", () => {
  it("a la conductora con viajes publicados se lo impiden con el motivo", async () => {
    const { api } = world();
    const state = asRecord((await api("GET", "/v1/me/account-deletion")).body);
    assert.equal(state.eligible, false);
    assert.equal(state.graceDays, 14);
    assert.equal(state.request, null);
    const blockers = asArray(state.blockers).map((item) => asRecord(item));
    assert.ok(blockers.some((blocker) => blocker.code === "ACTIVE_TRIP_AS_DRIVER" && num(blocker.count) >= 1));
    const plan = asRecord(state.plan);
    assert.ok(asArray(plan.deleted).length > 0 && asArray(plan.anonymised).length > 0 && asArray(plan.retained).length > 0);

    const res = await api("POST", "/v1/me/account-deletion", { body: { confirmation: "ELIMINAR" } });
    assert.equal(res.status, 409);
    assert.equal(codeOf(res.body), "ACCOUNT_DELETION_BLOCKED");
    const details = asRecord(asRecord(asRecord(res.body).error).details);
    assert.ok(asArray(details.blockers).length >= 1);
  });

  it("exige escribir ELIMINAR, programa el plazo de gracia y se puede cancelar", async () => {
    const { api } = world({ profile: "passenger" });
    const state = asRecord((await api("GET", "/v1/me/account-deletion")).body);
    assert.equal(state.eligible, true);

    const wrong = await api("POST", "/v1/me/account-deletion", { body: { confirmation: "eliminar" } });
    assert.equal(wrong.status, 422);
    assert.equal(codeOf(wrong.body), "ACCOUNT_DELETION_CONFIRMATION_REQUIRED");

    const created = await api("POST", "/v1/me/account-deletion", { body: { confirmation: "ELIMINAR", reason: "Ya no uso la app" } });
    assert.equal(created.status, 201);
    const request = asRecord(asRecord(created.body).request);
    assert.equal(request.status, "scheduled");
    assert.equal(Date.parse(str(request.scheduledFor)) - Date.parse(str(request.requestedAt)), 14 * 86_400_000);

    const repeated = await api("POST", "/v1/me/account-deletion", { body: { confirmation: "ELIMINAR" } });
    assert.equal(repeated.status, 200);

    const settings = asRecord(asRecord((await api("GET", "/v1/me/settings")).body).account);
    assert.equal(asRecord(settings.pendingDeletion).requestId, request.id);

    const cancelled = await api("POST", "/v1/me/account-deletion/cancel");
    assert.equal(cancelled.status, 200);
    assert.equal(asRecord(asRecord(cancelled.body).request).status, "cancelled");
    assert.equal(asRecord(asRecord((await api("GET", "/v1/me/settings")).body).account).pendingDeletion, null);

    const none = await api("POST", "/v1/me/account-deletion/cancel");
    assert.equal(none.status, 404);
    assert.equal(codeOf(none.body), "ACCOUNT_DELETION_NOT_FOUND");
  });

  it("la solicitud sembrada en espera pasa a programada cuando ya no hay bloqueos", async () => {
    const blocked = world({ seed: "help-delete-blocked" });
    const state = asRecord((await blocked.api("GET", "/v1/me/account-deletion")).body);
    assert.equal(asRecord(state.request).status, "blocked");
    assert.ok(asArray(asRecord(state.request).blockers).length >= 1);

    const scheduled = world({ profile: "passenger", seed: "help-delete-scheduled" });
    const next = asRecord((await scheduled.api("GET", "/v1/me/account-deletion")).body);
    assert.equal(asRecord(next.request).status, "scheduled");
  });
});
