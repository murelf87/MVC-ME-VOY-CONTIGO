import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { listStaffRoles, grantRole, revokeRole, runCli } from "../scripts/grant-role.js";
import { maskPhone } from "../src/modules/trust/common.js";
import { eraseUserTrustData, exportUserTrustData, listUserTrustStorageKeys, registerTrustDataRights } from "../src/modules/trust/public.js";
import {
  FakeStorage,
  type SeededUser,
  type StaffWorld,
  acceptPrivateCheckNotice,
  auditCount,
  buildTrustApp,
  call,
  createPool,
  hasTable,
  lastAudit,
  resetDatabase,
  seedProvince,
  seedStaffWorld,
  seedTrip,
  seedUser,
  seedVehicle,
  uploadFlow
} from "./trust-helpers.js";

/**
 * Visor de auditoría (filtros, cursor, redacción de datos personales), atención al cliente del personal (tablas de comms),
 * CLI `scripts/grant-role.ts` (única vía para dar acceso al panel) y derechos sobre los datos (exportación y eliminación).
 * Las pruebas que necesitan tablas de otros módulos se omiten si la base no las tiene (`mvc_trust_full` las trae todas).
 */

const NOW = new Date("2026-10-09T13:41:00.000Z");
const ROOT = path.resolve(".");

const pool = createPool();
let app: FastifyInstance;
let storage: FakeStorage;
let world: StaffWorld;
let hasSupport = false;
let hasCommsExport = false;

before(async () => {
  await pool.query("select 1 from audit_events limit 1");
  hasSupport = (await hasTable(pool, "support_tickets")) && (await hasTable(pool, "support_ticket_messages")) && (await hasTable(pool, "support_attachments"));
  hasCommsExport = (await hasTable(pool, "data_export_requests")) && (await hasTable(pool, "user_settings")) && (await hasTable(pool, "user_blocks"));
});
beforeEach(async () => {
  await resetDatabase(pool);
  const built = await buildTrustApp(pool, { now: () => NOW });
  app = built.app;
  storage = built.storage as FakeStorage;
  world = await seedStaffWorld(pool);
});
after(async () => {
  await app?.close();
  await pool.end();
});

const events = (query: Record<string, string | number> = {}, as: SeededUser | null = world.admin) =>
  call(app, "GET", "/v1/admin/audit-events", { as, query });

type AuditSeed = {
  actor?: string | null;
  action: string;
  entityType?: string;
  entityId?: string | null;
  requestId?: string | null;
  metadata?: unknown;
  createdAt?: string;
};
async function insertAudit(seed: AuditSeed): Promise<void> {
  await pool.query(
    `insert into audit_events(actor_user_id, action, entity_type, entity_id, request_id, metadata, created_at)
     values($1,$2,$3,$4,$5,$6::jsonb, coalesce($7::timestamptz, now()))`,
    [seed.actor ?? null, seed.action, seed.entityType ?? "thing", seed.entityId ?? null, seed.requestId ?? null, JSON.stringify(seed.metadata ?? {}), seed.createdAt ?? null]
  );
}

/* ═══════════════════════════════ Visor de auditoría ═══════════════════════════════ */

test("auditoría: filtros por persona, acción exacta o con prefijo, entidad y fechas; más recientes primero; el comodín no se cuela", async () => {
  const U1 = crypto.randomUUID();
  await insertAudit({ actor: world.admin.id, action: "admin.review.decision", entityType: "user", entityId: U1, requestId: "req-1", createdAt: "2026-03-01T09:00:00Z", metadata: { decision: "approve" } });
  await insertAudit({ actor: world.admin.id, action: "admin.tariff.published", entityType: "tariff_version", entityId: "tv-1", createdAt: "2026-03-01T09:05:00Z" });
  await insertAudit({ actor: world.support.id, action: "admin.support.ticket_viewed", entityType: "support_ticket", entityId: "tk-1", createdAt: "2026-03-01T09:10:00Z" });
  await insertAudit({ actor: world.rider.id, action: "legal.accepted", entityType: "legal_document", entityId: "ld-1", createdAt: "2026-03-01T09:15:00Z" });
  await insertAudit({ actor: null, action: "admin.role.granted", entityType: "user", entityId: U1, createdAt: "2026-03-01T09:20:00Z", metadata: { role: "support_admin", via: "cli" } });
  await insertAudit({ actor: world.admin.id, action: "user_photo.submitted", entityType: "user_photo", createdAt: "2026-03-01T09:25:00Z" });
  await insertAudit({ actor: world.admin.id, action: "userXphoto.submitted", entityType: "user_photo", createdAt: "2026-03-01T09:30:00Z" });

  const all = await events({ from: "2026-03-01T00:00:00Z", to: "2026-03-02T00:00:00Z" });
  assert.equal(all.status, 200);
  assert.equal(all.headers["cache-control"], "no-store");
  assert.deepEqual(all.body.items.map((i: any) => i.action), [
    "userXphoto.submitted", "user_photo.submitted", "admin.role.granted", "legal.accepted", "admin.support.ticket_viewed", "admin.tariff.published", "admin.review.decision"
  ]);
  assert.equal(all.body.nextCursor, null);
  const decision = all.body.items.find((i: any) => i.action === "admin.review.decision");
  assert.deepEqual(
    { actor: decision.actor, entityType: decision.entityType, entityId: decision.entityId, requestId: decision.requestId, createdAt: decision.createdAt, metadata: decision.metadata, redactions: decision.redactions },
    { actor: { id: world.admin.id, displayName: "Lucía Ramos" }, entityType: "user", entityId: U1, requestId: "req-1", createdAt: "2026-03-01T09:00:00.000Z", metadata: { decision: "approve" }, redactions: 0 }
  );
  assert.equal(all.body.items.find((i: any) => i.action === "admin.role.granted").actor, null, "los eventos del sistema/CLI no tienen autor");
  assert.match(all.body.items[0].id, /^\d+$/);

  const window = { from: "2026-03-01T00:00:00Z", to: "2026-03-02T00:00:00Z" };
  const actions = async (extra: Record<string, string>) => (await events({ ...window, ...extra })).body.items.map((i: any) => i.action);
  assert.deepEqual(await actions({ action: "admin.review.decision" }), ["admin.review.decision"]);
  assert.deepEqual(await actions({ action: "admin.*" }), ["admin.role.granted", "admin.support.ticket_viewed", "admin.tariff.published", "admin.review.decision"]);
  assert.deepEqual(await actions({ action: "admin.*", entityType: "user" }), ["admin.role.granted", "admin.review.decision"]);
  assert.deepEqual(await actions({ action: "admin.*", actorUserId: world.support.id }), ["admin.support.ticket_viewed"]);
  assert.deepEqual(await actions({ actorUserId: world.rider.id }), ["legal.accepted"]);
  assert.deepEqual(await actions({ entityType: "support_ticket", entityId: "tk-1" }), ["admin.support.ticket_viewed"]);
  assert.deepEqual(await actions({ entityId: U1 }), ["admin.role.granted", "admin.review.decision"]);
  assert.deepEqual(await actions({ action: "user_photo*" }), ["user_photo.submitted"], "el guion bajo es literal, no un comodín de LIKE");
  assert.deepEqual(await actions({ action: "adm*" }), ["admin.role.granted", "admin.support.ticket_viewed", "admin.tariff.published", "admin.review.decision"]);
  assert.deepEqual(await actions({ actorUserId: crypto.randomUUID() }), []);

  // rango de fechas: «from» inclusivo, «to» exclusivo
  const between = await events({ from: "2026-03-01T09:05:00Z", to: "2026-03-01T09:20:00Z" });
  assert.deepEqual(between.body.items.map((i: any) => i.action), ["legal.accepted", "admin.support.ticket_viewed", "admin.tariff.published"]);

  // la propia consulta queda registrada, con los filtros usados
  const viewed = await lastAudit(pool, "admin.audit_log.viewed");
  assert.equal(viewed?.actor_user_id, world.admin.id);
  assert.deepEqual(viewed?.metadata.filters, {
    actorUserId: null, action: null, entityType: null, entityId: null,
    from: "2026-03-01T09:05:00Z", to: "2026-03-01T09:20:00Z"
  });
  assert.equal(viewed?.metadata.returned, 3);
});

test("auditoría: filtros inválidos → 422 AUDIT_FILTER_INVALID (o 400 de forma); cursor estable sin duplicados; solo administración", async () => {
  for (let i = 0; i < 7; i += 1) {
    await insertAudit({ actor: world.admin.id, action: "admin.summary.viewed", entityType: "summary", createdAt: `2026-03-02T10:0${i}:00Z` });
  }
  const bad: Array<[Record<string, string>, string]> = [
    [{ action: "tiene espacios" }, "action"],
    [{ action: "100%" }, "action"],
    [{ action: "*" }, "action"],
    [{ entityType: "con espacio" }, "entityType"],
    [{ from: "no-es-fecha" }, "from"],
    [{ to: "mañana" }, "to"],
    [{ from: "2026-03-03T00:00:00Z", to: "2026-03-02T00:00:00Z" }, "from"],
    [{ from: "2026-03-03T00:00:00Z", to: "2026-03-03T00:00:00Z" }, "from"]
  ];
  for (const [query, field] of bad) {
    const res = await events(query);
    assert.equal(res.status, 422, JSON.stringify(query));
    assert.equal(res.body.error.code, "AUDIT_FILTER_INVALID");
    assert.equal(res.body.error.details.fields[0].field, field);
  }
  assert.equal((await events({ actorUserId: "no-es-uuid" })).status, 400);
  assert.equal((await events({ limit: 0 })).status, 400);
  assert.equal((await events({ limit: 51 })).status, 400);
  assert.equal((await events({ cursor: "basura" })).body.error.code, "CURSOR_INVALID");
  assert.equal((await events({ cursor: Buffer.from(JSON.stringify({ id: "abc" })).toString("base64url") })).body.error.code, "CURSOR_INVALID");
  assert.equal(await auditCount(pool, "admin.audit_log.viewed"), 0, "una consulta inválida no cuenta como consulta realizada");

  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page: any = await events({ action: "admin.summary.viewed", limit: 3, ...(cursor ? { cursor } : {}) });
    assert.ok(page.body.items.length <= 3);
    seen.push(...page.body.items.map((i: any) => i.id));
    cursor = page.body.nextCursor;
    pages += 1;
  } while (cursor && pages < 6);
  assert.equal(pages, 3);
  assert.equal(new Set(seen).size, 7);
  assert.deepEqual([...seen].sort((a, b) => Number(b) - Number(a)), seen, "ids estrictamente decrecientes");

  for (const who of [world.finance, world.support, world.verification, world.rider, world.driver]) assert.equal((await events({}, who)).status, 403);
  assert.equal((await events({}, null)).status, 401);
});

test("auditoría: oculta datos personales por nombre de clave y por forma del valor, y cuenta las ocultaciones", async () => {
  const id = crypto.randomUUID();
  await insertAudit({
    actor: world.admin.id,
    action: "admin.test.redaction",
    entityType: "thing",
    createdAt: "2026-03-03T09:00:00Z",
    metadata: {
      phone: "+34600111222",
      Email: "ana@example.com",
      displayName: "Ana López",
      storageKey: "users/abc/trust/selfie/x.jpg",
      signedUrl: "https://download.invalid/x?sig=1",
      ip_hash: "9f2b",
      requestIp: "192.168.1.10",
      authorization: "Bearer mvc_sess_secreto",
      lat: 37.38,
      lng: -5.98,
      location: { x: 1 },
      note: "Llamó al 600 111 222 y escribió a ana@example.com desde 10.0.0.7",
      nested: { deeper: { phoneNumber: "+34 611 222 333", fine: "valor normal", count: 3, ok: true, none: null } },
      list: ["+34 622 333 444", "texto seguro", { telefono: "611222333", userId: id }],
      userId: id,
      amountCents: 356,
      status: "approved"
    }
  });
  const res = await events({ action: "admin.test.redaction" });
  assert.equal(res.status, 200);
  const item = res.body.items[0];
  assert.equal(item.actor.displayName, "Lucía Ramos", "el nombre del personal que actúa sí se muestra");
  const m = item.metadata;
  for (const key of ["phone", "Email", "displayName", "storageKey", "signedUrl", "ip_hash", "requestIp", "authorization", "lat", "lng", "location"]) {
    assert.equal(m[key], "[oculto]", key);
  }
  assert.equal(m.note, "Llamó al [oculto] y escribió a [oculto] desde [oculto]");
  assert.deepEqual(m.nested, { deeper: { phoneNumber: "[oculto]", fine: "valor normal", count: 3, ok: true, none: null } });
  assert.deepEqual(m.list, ["[oculto]", "texto seguro", { telefono: "[oculto]", userId: id }]);
  assert.equal(m.userId, id, "los UUID de entidades se conservan para poder seguir el rastro");
  assert.deepEqual([m.amountCents, m.status], [356, "approved"]);
  // 11 claves de primer nivel + `phoneNumber` anidado + `telefono` dentro de la lista = 13 por nombre;
  // 3 en el texto libre (teléfono, correo, IP) + 1 en el elemento de la lista con forma de teléfono = 4 por forma del valor
  assert.equal(item.redactions, 13 + 4, "claves ocultas por nombre + valores ocultos por su forma");
  for (const secret of ["600111222", "600 111 222", "ana@example.com", "192.168.1.10", "10.0.0.7", "mvc_sess_secreto", "users/abc", "download.invalid", "611 222 333", "622 333 444"]) {
    assert.ok(!res.raw.includes(secret), `la respuesta no debe contener ${secret}`);
  }
});

test("auditoría: lo que hace el personal queda en el registro con autor y petición, y ver el registro también se registra", async () => {
  assert.equal((await call(app, "GET", "/v1/admin/summary", { as: world.finance })).status, 200);
  assert.equal((await call(app, "GET", "/v1/admin/operations", { as: world.support })).status, 200);
  assert.equal((await call(app, "GET", "/v1/admin/tariffs", { as: world.support })).status, 403);
  const res = await events({ action: "admin.*" });
  const byAction = Object.fromEntries(res.body.items.map((i: any) => [i.action, i]));
  assert.equal(byAction["admin.summary.viewed"].actor.id, world.finance.id);
  assert.equal(byAction["admin.operations.viewed"].actor.id, world.support.id);
  assert.equal(byAction["admin.access_denied"].actor.id, world.support.id, "el acceso denegado también deja rastro");
  assert.deepEqual(
    { resource: byAction["admin.access_denied"].metadata.resource, method: byAction["admin.access_denied"].metadata.method },
    { resource: "tariffs", method: "GET" }
  );
  for (const item of Object.values<any>(byAction)) assert.ok(item.requestId, `${item.action} guarda el identificador de la petición`);
  const again = await events({ action: "admin.audit_log.viewed" });
  assert.equal(again.body.items.length, 1);
  assert.equal(again.body.items[0].actor.id, world.admin.id);
});

/* ═══════════════════════════════ Atención al cliente (personal) ═══════════════════════════════ */

test("soporte: sin las tablas de comms todo responde 503 SUPPORT_UNAVAILABLE (y solo a quien tiene permiso)", async t => {
  if (hasSupport) return t.skip("esta base sí tiene las tablas de soporte: lo cubren las pruebas siguientes");
  const id = crypto.randomUUID();
  const requests: Array<[("GET" | "POST"), string, unknown]> = [
    ["GET", "/v1/admin/support/tickets", undefined],
    ["GET", `/v1/admin/support/tickets/${id}`, undefined],
    ["POST", `/v1/admin/support/tickets/${id}/reply`, { body: "Hola" }],
    ["POST", `/v1/admin/support/tickets/${id}/assign`, { assignee: "me" }],
    ["POST", `/v1/admin/support/tickets/${id}/close`, undefined],
    ["POST", `/v1/admin/support/attachments/${id}/access`, undefined]
  ];
  for (const [method, url, body] of requests) {
    for (const who of [world.admin, world.support]) {
      const res = await call(app, method, url, { as: who, ...(body !== undefined ? { body } : {}) });
      assert.deepEqual([res.status, res.body.error.code], [503, "SUPPORT_UNAVAILABLE"], `${method} ${url}`);
    }
    for (const who of [world.finance, world.verification, world.rider]) {
      assert.equal((await call(app, method, url, { as: who, ...(body !== undefined ? { body } : {}) })).status, 403, `${method} ${url}`);
    }
  }
  assert.equal(await auditCount(pool, "admin.support.tickets_listed"), 0, "sin datos no se audita una lectura que no ocurrió");
});

type TicketSeed = {
  userId: string;
  category?: "trip_issue" | "payment_issue" | "account_profile";
  status?: "open" | "answered" | "closed";
  body?: string;
  lastUserMessageAt?: string;
  assignedTo?: string | null;
  tripId?: string | null;
};

async function seedTicket(seed: TicketSeed): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `insert into support_tickets(user_id, category, body, trip_id, assigned_to_user_id, last_user_message_at, created_at)
     values($1,$2,$3,$4,$5, coalesce($6::timestamptz, now()), coalesce($6::timestamptz, now())) returning id`,
    [seed.userId, seed.category ?? "trip_issue", seed.body ?? "No encuentro al conductor en el punto de recogida", seed.tripId ?? null, seed.assignedTo ?? null, seed.lastUserMessageAt ?? null]
  );
  const id = row.rows[0]!.id;
  // el estado final se fija sin pasar por los disparadores de mensajes
  const status = seed.status ?? "open";
  if (status !== "open") await pool.query(`update support_tickets set status = $2 where id = $1`, [id, status]);
  return id;
}
async function seedMessage(ticketId: string, authorType: "user" | "staff", authorId: string, body: string, at: string): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `insert into support_ticket_messages(ticket_id, author_type, author_user_id, body, created_at) values($1,$2,$3,$4,$5::timestamptz) returning id`,
    [ticketId, authorType, authorId, body, at]
  );
  return row.rows[0]!.id;
}
async function seedAttachment(input: { ownerId: string; ticketId: string | null; messageId?: string | null; provider?: string; key?: string }): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `insert into support_attachments(owner_user_id, ticket_id, message_id, storage_provider, storage_key, content_type, size_bytes, sha256)
     values($1,$2,$3,$4,$5,'image/jpeg',2048,$6) returning id`,
    [input.ownerId, input.ticketId, input.messageId ?? null, input.provider ?? "fake", input.key ?? `support/${crypto.randomUUID()}/foto.jpg`, crypto.randomBytes(32).toString("hex")]
  );
  return row.rows[0]!.id;
}

test("soporte: cola de consultas con filtros, contadores, vista previa y paginación estable; solo administración y soporte", async t => {
  if (!hasSupport) return t.skip("la base no tiene las tablas de soporte (módulo comms no migrado)");
  const long = "x".repeat(300);
  const same = "2026-10-09T10:00:00.123456Z"; // mismo instante para dos consultas: el cursor desempata por id
  const a = await seedTicket({ userId: world.rider.id, category: "trip_issue", lastUserMessageAt: same, body: long });
  const b = await seedTicket({ userId: world.driver.id, category: "payment_issue", lastUserMessageAt: same });
  const c = await seedTicket({ userId: world.rider.id, category: "account_profile", status: "answered", lastUserMessageAt: "2026-10-09T09:00:00Z", assignedTo: world.support.id });
  const d = await seedTicket({ userId: world.driver.id, category: "trip_issue", status: "closed", lastUserMessageAt: "2026-10-08T09:00:00Z" });
  const e = await seedTicket({ userId: world.rider.id, category: "trip_issue", lastUserMessageAt: "2026-10-09T11:00:00Z", assignedTo: world.admin.id });
  await seedMessage(a, "user", world.rider.id, "Primer mensaje", "2026-10-09T10:00:00Z");
  await seedAttachment({ ownerId: world.rider.id, ticketId: a });

  const open = await call(app, "GET", "/v1/admin/support/tickets", { as: world.support });
  assert.equal(open.status, 200);
  assert.equal(open.headers["cache-control"], "no-store");
  assert.deepEqual(open.body.counts, { open: 3, answered: 1, closed: 1 }, "los contadores no dependen del filtro");
  assert.equal(open.body.items.length, 3);
  assert.equal(open.body.items[0].id, e, "la más reciente primero");
  const first = open.body.items.find((i: any) => i.id === a);
  assert.deepEqual(
    { status: first.status, category: first.category, categoryLabel: first.categoryLabel, waitingForStaff: first.waitingForStaff, assignedTo: first.assignedTo, messageCount: first.messageCount, attachmentCount: first.attachmentCount },
    { status: "open", category: "trip_issue", categoryLabel: "Problema con un viaje", waitingForStaff: true, assignedTo: null, messageCount: 1, attachmentCount: 1 }
  );
  assert.equal(first.preview.length, 138);
  assert.ok(first.preview.endsWith("…"));
  assert.deepEqual(first.user, { id: world.rider.id, displayName: "Miguel Torres", firstName: "Miguel", photoUrl: null });
  assert.match(first.reference, /^MVC-\d{4}-\d{6}$/);
  assert.doesNotMatch(open.raw, /\+34\d{6,}/, "ni teléfonos");

  const ids = async (query: Record<string, string>) => (await call(app, "GET", "/v1/admin/support/tickets", { as: world.admin, query })).body.items.map((i: any) => i.id);
  assert.deepEqual(await ids({ status: "answered" }), [c]);
  assert.deepEqual(await ids({ status: "closed" }), [d]);
  assert.equal((await ids({ status: "all" })).length, 5);
  assert.deepEqual((await ids({ status: "all", category: "payment_issue" })), [b]);
  assert.deepEqual(await ids({ status: "all", assigned: "me" }), [e], "«me» es quien consulta (administración)");
  assert.deepEqual((await ids({ status: "all", assigned: "unassigned" })).sort(), [a, b, d].sort());
  assert.deepEqual((await call(app, "GET", "/v1/admin/support/tickets", { as: world.support, query: { status: "all", assigned: "me" } })).body.items.map((i: any) => i.id), [c]);
  assert.equal((await call(app, "GET", "/v1/admin/support/tickets", { as: world.support, query: { status: "answered" } })).body.items[0].assignedTo.displayName, "Íñigo Pérez");

  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page: any = await call(app, "GET", "/v1/admin/support/tickets", { as: world.support, query: { status: "all", limit: 2, ...(cursor ? { cursor } : {}) } });
    seen.push(...page.body.items.map((i: any) => i.id));
    cursor = page.body.nextCursor;
    pages += 1;
  } while (cursor && pages < 6);
  assert.equal(pages, 3);
  assert.deepEqual([...seen].sort(), [a, b, c, d, e].sort(), "ninguna consulta se repite ni se pierde (incluidas las dos con el mismo instante)");

  assert.equal((await call(app, "GET", "/v1/admin/support/tickets", { as: world.admin, query: { cursor: "basura" } })).body.error.code, "CURSOR_INVALID");
  for (const bad of [{ status: "todas" }, { category: "otra" }, { assigned: "alguien" }, { limit: 0 }]) {
    assert.equal((await call(app, "GET", "/v1/admin/support/tickets", { as: world.admin, query: bad })).status, 400, JSON.stringify(bad));
  }
  const mine = await call(app, "GET", "/v1/admin/support/tickets", { as: world.support, query: { status: "all", assigned: "me" } });
  assert.equal(mine.status, 200);
  assert.deepEqual((await lastAudit(pool, "admin.support.tickets_listed"))?.metadata, { status: "all", category: null, assigned: "me", returned: 1 });
  for (const who of [world.finance, world.verification, world.rider, world.driver]) {
    assert.equal((await call(app, "GET", "/v1/admin/support/tickets", { as: who })).status, 403);
  }
  assert.equal((await call(app, "GET", "/v1/admin/support/tickets")).status, 401);
});

test("soporte: detalle con hilo y adjuntos, responder, asignar y cerrar; cada acción queda auditada y la persona recibe el aviso", async t => {
  if (!hasSupport) return t.skip("la base no tiene las tablas de soporte (módulo comms no migrado)");
  const ticket = await seedTicket({ userId: world.rider.id, category: "payment_issue", body: "Me han cobrado dos veces el mismo viaje" });
  const m1 = await seedMessage(ticket, "user", world.rider.id, "Me han cobrado dos veces el mismo viaje", "2026-10-09T09:00:00Z");
  const own = await seedAttachment({ ownerId: world.rider.id, ticketId: ticket, messageId: m1 });
  const loose = await seedAttachment({ ownerId: world.rider.id, ticketId: ticket });
  await pool.query(`update support_tickets set status = 'open', last_user_message_at = '2026-10-09T09:00:00Z' where id = $1`, [ticket]);

  const detail = await call(app, "GET", `/v1/admin/support/tickets/${ticket}`, { as: world.support });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.id, ticket);
  assert.equal(detail.body.status, "open");
  assert.deepEqual(detail.body.messages.map((m: any) => [m.authorType, m.body]), [["user", "Me han cobrado dos veces el mismo viaje"]]);
  assert.deepEqual(detail.body.messages[0].author, { id: world.rider.id, displayName: "Miguel Torres" });
  assert.deepEqual(detail.body.messages[0].attachments.map((a: any) => a.id), [own]);
  assert.deepEqual(detail.body.attachments.map((a: any) => a.id), [loose], "los adjuntos sueltos de la consulta van aparte");
  assert.deepEqual(Object.keys(detail.body.attachments[0]).sort(), ["contentType", "createdAt", "id", "sizeBytes"], "ni clave ni proveedor de almacenamiento");
  assert.doesNotMatch(detail.raw, /support\/[0-9a-f-]{36}\/foto\.jpg|storage/);
  assert.equal((await lastAudit(pool, "admin.support.ticket_viewed"))?.entity_id, ticket);
  assert.equal((await call(app, "GET", `/v1/admin/support/tickets/${crypto.randomUUID()}`, { as: world.support })).body.error.code, "TICKET_NOT_FOUND");
  assert.equal((await call(app, "GET", "/v1/admin/support/tickets/no-es-uuid", { as: world.support })).status, 400);

  // responder
  const reply = await call(app, "POST", `/v1/admin/support/tickets/${ticket}/reply`, { as: world.support, body: { body: "  Hola Miguel, ya hemos revisado el cobro.  " } });
  assert.equal(reply.status, 200);
  assert.equal(reply.body.status, "answered", "el disparador de comms pasa la consulta a «answered»");
  assert.ok(reply.body.lastStaffMessageAt);
  assert.equal(reply.body.waitingForStaff, false);
  const staffMessage = reply.body.messages.find((m: any) => m.authorType === "staff");
  assert.equal(staffMessage.body, "Hola Miguel, ya hemos revisado el cobro.");
  assert.deepEqual(staffMessage.author, { id: world.support.id, displayName: "Íñigo Pérez" });
  const notified = await pool.query(`select category, kind, title, data from notifications where user_id = $1 and kind = 'support_reply'`, [world.rider.id]);
  assert.equal(notified.rowCount, 1);
  assert.deepEqual(notified.rows[0].data, { ticketId: ticket });
  const replied = await lastAudit(pool, "admin.support.ticket_replied");
  assert.equal(replied?.actor_user_id, world.support.id);
  assert.equal(replied?.metadata.length, "Hola Miguel, ya hemos revisado el cobro.".length);
  assert.doesNotMatch(JSON.stringify(replied?.metadata), /Hola Miguel/, "la auditoría no copia el contenido del mensaje");
  // la persona vuelve a escribir → la consulta vuelve a la cola
  await seedMessage(ticket, "user", world.rider.id, "Gracias, sigo viendo el cargo", "2026-10-09T12:00:00Z");
  assert.equal((await call(app, "GET", `/v1/admin/support/tickets/${ticket}`, { as: world.admin })).body.status, "open");

  for (const bad of [{ body: "" }, { body: "x".repeat(4001) }, {}, { body: {} }]) {
    const res = await call(app, "POST", `/v1/admin/support/tickets/${ticket}/reply`, { as: world.support, body: bad });
    assert.equal(res.status, 400, JSON.stringify(bad).slice(0, 40));
  }
  const blank = await call(app, "POST", `/v1/admin/support/tickets/${ticket}/reply`, { as: world.support, body: { body: "    " } });
  assert.deepEqual([blank.status, blank.body.error.code], [400, "VALIDATION_ERROR"]);
  assert.equal((await call(app, "POST", `/v1/admin/support/tickets/${crypto.randomUUID()}/reply`, { as: world.support, body: { body: "Hola" } })).body.error.code, "TICKET_NOT_FOUND");
  for (const who of [world.finance, world.verification, world.rider, world.driver]) {
    assert.equal((await call(app, "POST", `/v1/admin/support/tickets/${ticket}/reply`, { as: who, body: { body: "Hola" } })).status, 403);
  }
  assert.equal(await auditCount(pool, "admin.support.ticket_replied"), 1, "solo la respuesta válida deja rastro");

  // asignar
  const assigned = await call(app, "POST", `/v1/admin/support/tickets/${ticket}/assign`, { as: world.support, body: { assignee: "me" } });
  assert.equal(assigned.status, 200);
  assert.deepEqual(assigned.body.assignedTo, { id: world.support.id, displayName: "Íñigo Pérez" });
  assert.deepEqual((await lastAudit(pool, "admin.support.ticket_assigned"))?.metadata, { assignee: "me", previousAssigneeId: null });
  const taken = await call(app, "POST", `/v1/admin/support/tickets/${ticket}/assign`, { as: world.admin, body: { assignee: "me" } });
  assert.equal(taken.body.assignedTo.id, world.admin.id);
  assert.deepEqual((await lastAudit(pool, "admin.support.ticket_assigned"))?.metadata, { assignee: "me", previousAssigneeId: world.support.id });
  const released = await call(app, "POST", `/v1/admin/support/tickets/${ticket}/assign`, { as: world.admin, body: { assignee: "none" } });
  assert.equal(released.body.assignedTo, null);
  assert.equal((await call(app, "POST", `/v1/admin/support/tickets/${ticket}/assign`, { as: world.admin, body: { assignee: "otro" } })).status, 400);
  assert.equal((await call(app, "POST", `/v1/admin/support/tickets/${crypto.randomUUID()}/assign`, { as: world.admin, body: { assignee: "me" } })).body.error.code, "TICKET_NOT_FOUND");

  // cerrar
  const closed = await call(app, "POST", `/v1/admin/support/tickets/${ticket}/close`, { as: world.support });
  assert.equal(closed.status, 200);
  assert.deepEqual([closed.body.status, closed.body.closedBy, closed.body.closedAt !== null], ["closed", "staff", true]);
  assert.deepEqual((await lastAudit(pool, "admin.support.ticket_closed"))?.metadata, { previousStatus: "open" });
  const twice = await call(app, "POST", `/v1/admin/support/tickets/${ticket}/close`, { as: world.support });
  assert.deepEqual([twice.status, twice.body.error.code], [409, "TICKET_ALREADY_CLOSED"]);
  const afterClose = await call(app, "POST", `/v1/admin/support/tickets/${ticket}/reply`, { as: world.support, body: { body: "¿Seguimos?" } });
  assert.deepEqual([afterClose.status, afterClose.body.error.code], [409, "TICKET_CLOSED"]);
  assert.equal((await call(app, "POST", `/v1/admin/support/tickets/${crypto.randomUUID()}/close`, { as: world.support })).body.error.code, "TICKET_NOT_FOUND");
  assert.equal((await call(app, "GET", "/v1/admin/support/tickets", { as: world.support })).body.counts.closed, 1);
  assert.deepEqual((await call(app, "GET", "/v1/admin/support/tickets", { as: world.support })).body.items, [], "una consulta cerrada sale de la cola por defecto");
});

test("soporte · adjuntos: URL firmada de vida corta tras auditar; sin auditoría no hay URL; no se abren los propios ni los de otro proveedor", async t => {
  if (!hasSupport) return t.skip("la base no tiene las tablas de soporte (módulo comms no migrado)");
  const ticket = await seedTicket({ userId: world.rider.id });
  const key = "support/6f1d/foto-del-cobro.jpg";
  const attachment = await seedAttachment({ ownerId: world.rider.id, ticketId: ticket, key });
  const access = (id: string, as: SeededUser | null = world.support, body: unknown = null) =>
    call(app, "POST", `/v1/admin/support/attachments/${id}/access`, { as, body });

  const res = await access(attachment, world.support, { note: "Comprobar el justificante del cobro" });
  assert.equal(res.status, 200);
  assert.equal(res.body.url, `https://download.invalid/${key}?ttl=120&sig=test`);
  assert.deepEqual([res.body.ttlSeconds, res.body.contentType, res.body.attachmentId], [120, "image/jpeg", attachment]);
  assert.equal(res.body.expiresAt, "2026-10-09T13:43:00.000Z");
  assert.deepEqual(storage.downloadCalls.at(-1), { key, expiresInSeconds: 120 });
  const audit = await lastAudit(pool, "admin.support.attachment_access_url_issued");
  assert.equal(audit?.actor_user_id, world.support.id);
  assert.equal(audit?.entity_id, attachment);
  assert.deepEqual(audit?.metadata, {
    ticketId: ticket, purpose: "support_case", note: "Comprobar el justificante del cobro", ttlSeconds: 120, ownerUserId: world.rider.id, contentType: "image/jpeg"
  });
  assert.doesNotMatch(JSON.stringify(audit?.metadata), /foto-del-cobro/, "la auditoría no guarda la clave de almacenamiento");
  assert.equal((await access(attachment, world.admin)).status, 200, "sin cuerpo también vale");

  // errores tipados
  assert.equal((await access(crypto.randomUUID())).body.error.code, "ATTACHMENT_NOT_FOUND");
  assert.equal((await access("no-es-uuid")).status, 400);
  const unlinked = await seedAttachment({ ownerId: world.rider.id, ticketId: null });
  assert.equal((await access(unlinked)).body.error.code, "ATTACHMENT_NOT_FOUND", "un adjunto sin consulta no es accesible desde el panel");
  const mine = await seedTicket({ userId: world.support.id });
  const ownAttachment = await seedAttachment({ ownerId: world.support.id, ticketId: mine });
  const own = await access(ownAttachment);
  assert.deepEqual([own.status, own.body.error.code], [403, "SELF_REVIEW_FORBIDDEN"]);
  const foreign = await seedAttachment({ ownerId: world.rider.id, ticketId: ticket, provider: "s3" });
  const mismatch = await access(foreign);
  assert.deepEqual([mismatch.status, mismatch.body.error.code], [409, "EVIDENCE_STORAGE_MISMATCH"]);
  assert.equal((await access(attachment, world.finance)).status, 403);
  assert.equal((await access(attachment, world.verification)).status, 403);
  assert.equal((await access(attachment, world.rider)).status, 403);
  assert.equal((await access(attachment, null)).status, 401);
  assert.equal((await call(app, "POST", `/v1/admin/support/attachments/${attachment}/access`, { as: world.support, body: { note: "x".repeat(501) } })).status, 400);

  // almacenamiento desactivado
  const off = await buildTrustApp(pool, { storage: null, now: () => NOW });
  try {
    const disabled = await call(off.app, "POST", `/v1/admin/support/attachments/${attachment}/access`, { as: world.support, body: null });
    assert.deepEqual([disabled.status, disabled.body.error.code], [503, "PRIVATE_STORAGE_DISABLED"]);
  } finally {
    await off.app.close();
  }

  // falla cerrado: si no se puede auditar, la URL no sale
  const issuedBefore = await auditCount(pool, "admin.support.attachment_access_url_issued");
  await pool.query(`
    create or replace function trust_support_test_block() returns trigger language plpgsql as $$
    begin raise exception 'auditoría no disponible'; end $$;
    drop trigger if exists trust_support_test_block_trg on audit_events;
    create trigger trust_support_test_block_trg before insert on audit_events
      for each row when (new.action = 'admin.support.attachment_access_url_issued') execute function trust_support_test_block();
  `);
  try {
    const blocked = await access(attachment);
    assert.equal(blocked.status, 500);
    assert.doesNotMatch(blocked.raw, /download\.invalid|https?:\/\//);
  } finally {
    await pool.query(`drop trigger if exists trust_support_test_block_trg on audit_events; drop function if exists trust_support_test_block();`);
  }
  assert.equal(await auditCount(pool, "admin.support.attachment_access_url_issued"), issuedBefore);
});

/* ═══════════════════════════════ CLI de roles de personal ═══════════════════════════════ */

const staffRolesOf = async (userId: string): Promise<string[]> =>
  (await pool.query<{ role: string }>(`select role::text as role from user_roles where user_id = $1 order by role::text`, [userId])).rows.map(r => r.role);

test("grant-role: conceder un rol de personal escribe en user_roles, audita sin teléfono y surte efecto en la siguiente petición", async () => {
  const lucia = await seedUser(pool, "Elena Ruiz", { roles: ["passenger"] });
  assert.equal((await call(app, "GET", "/v1/admin/me", { as: lucia })).status, 403, "antes de la concesión no hay acceso");

  const dry = await grantRole(pool, lucia.phone, "support_admin", { dryRun: true });
  assert.deepEqual([dry.ok, dry.changed, dry.code], [true, true, "DRY_RUN"]);
  assert.deepEqual(await staffRolesOf(lucia.id), ["passenger"], "la simulación no escribe nada");
  assert.equal(await auditCount(pool, "admin.role.granted"), 0);

  const granted = await grantRole(pool, lucia.phone, "support_admin");
  assert.deepEqual([granted.ok, granted.changed, granted.code, granted.userId], [true, true, "GRANTED", lucia.id]);
  assert.equal(granted.message, `Rol support_admin concedido a ${maskPhone(lucia.phone)}.`);
  assert.ok(!granted.message.includes(lucia.phone), "el mensaje enmascara el teléfono");
  assert.deepEqual(await staffRolesOf(lucia.id), ["passenger", "support_admin"]);
  const audit = await lastAudit(pool, "admin.role.granted");
  assert.equal(audit?.actor_user_id, null);
  assert.equal(audit?.entity_id, lucia.id);
  assert.equal(audit?.metadata.role, "support_admin");
  assert.equal(audit?.metadata.via, "cli");
  assert.equal(typeof audit?.metadata.operator, "string");
  assert.doesNotMatch(JSON.stringify(audit), new RegExp(lucia.phone.replace("+", "\\+")), "ni el teléfono ni el número completo");

  // el mismo token, sin reiniciar nada, ya tiene los permisos de soporte (y solo esos)
  const me = await call(app, "GET", "/v1/admin/me", { as: lucia });
  assert.equal(me.status, 200);
  assert.ok(me.body.roles.includes("support_admin"));
  assert.equal((await call(app, "GET", "/v1/admin/operations", { as: lucia })).status, 200);
  assert.equal((await call(app, "GET", "/v1/admin/tariffs", { as: lucia })).status, 403);

  // idempotente
  const again = await grantRole(pool, lucia.phone, "support_admin");
  assert.deepEqual([again.ok, again.changed, again.code], [true, false, "ALREADY_GRANTED"]);
  assert.equal(await auditCount(pool, "admin.role.granted"), 1);
});

test("grant-role: rechaza lo que no debe — roles que no son de personal, roles desconocidos, teléfonos inválidos, cuentas inexistentes o inactivas", async () => {
  const cases: Array<[string, string, string]> = [
    [world.rider.phone, "passenger", "ROLE_NOT_STAFF"],
    [world.rider.phone, "driver", "ROLE_NOT_STAFF"],
    [world.rider.phone, "superadmin", "ROLE_UNKNOWN"],
    [world.rider.phone, "", "ROLE_UNKNOWN"],
    ["600111222", "admin", "PHONE_INVALID"],
    ["+34 abc", "admin", "PHONE_INVALID"],
    ["+34699999999", "admin", "USER_NOT_FOUND"]
  ];
  for (const [phone, role, code] of cases) {
    const result = await grantRole(pool, phone, role);
    assert.deepEqual([result.ok, result.changed, result.code], [false, false, code], `${phone} ${role}`);
  }
  const suspended = await seedUser(pool, "Cuenta suspendida", { roles: ["passenger"], status: "suspended" });
  const notActive = await grantRole(pool, suspended.phone, "admin");
  assert.deepEqual([notActive.ok, notActive.code], [false, "USER_NOT_ACTIVE"]);
  assert.match(notActive.message, /suspended/);
  assert.deepEqual(await staffRolesOf(suspended.id), ["passenger"]);
  assert.equal(await auditCount(pool, "admin.role.granted"), 0, "ningún intento fallido deja concesiones ni eventos");
  const unknownMsg = (await grantRole(pool, "+34699999999", "admin")).message;
  assert.ok(!unknownMsg.includes("+34699999999"), "ni siquiera los errores repiten el teléfono completo");
  // el teléfono admite espacios y guiones
  const spaced = await grantRole(pool, world.rider.phone.replace(/^\+34/, "+34 ").replace(/(\d{3})(\d{3})(\d{3})$/, "$1-$2-$3"), "verification_admin");
  assert.equal(spaced.code, "GRANTED");
});

test("grant-role: retirar un rol corta el acceso de inmediato; el último admin activo está protegido salvo --force; --dry-run no escribe", async () => {
  // retirar un rol que no es admin
  const revoke = await revokeRole(pool, world.support.phone, "support_admin");
  assert.deepEqual([revoke.ok, revoke.changed, revoke.code], [true, true, "REVOKED"]);
  assert.deepEqual(await staffRolesOf(world.support.id), []);
  assert.equal((await call(app, "GET", "/v1/admin/operations", { as: world.support })).status, 403, "el mismo token ya no entra");
  const audit = await lastAudit(pool, "admin.role.revoked");
  assert.deepEqual([audit?.actor_user_id, audit?.entity_id, audit?.metadata.role, audit?.metadata.via, audit?.metadata.forced], [null, world.support.id, "support_admin", "cli", false]);
  const notGranted = await revokeRole(pool, world.support.phone, "support_admin");
  assert.deepEqual([notGranted.ok, notGranted.changed, notGranted.code], [true, false, "NOT_GRANTED"]);
  assert.equal((await revokeRole(pool, "+34699999999", "admin")).code, "USER_NOT_FOUND");
  assert.equal((await revokeRole(pool, world.rider.phone, "passenger")).code, "ROLE_NOT_STAFF", "los roles de pasajero/conductor no se gestionan aquí");
  assert.equal(await auditCount(pool, "admin.role.revoked"), 1);

  // último admin
  const last = await revokeRole(pool, world.admin.phone, "admin");
  assert.deepEqual([last.ok, last.code], [false, "LAST_ADMIN"]);
  assert.deepEqual(await staffRolesOf(world.admin.id), ["admin"]);
  // un segundo admin SUSPENDIDO no cuenta como relevo
  const sleeping = await seedUser(pool, "Admin suspendido", { roles: ["admin"], status: "suspended" });
  assert.equal((await revokeRole(pool, world.admin.phone, "admin")).code, "LAST_ADMIN");
  // simulación sobre un caso permitido: no escribe
  const second = await seedUser(pool, "Segundo admin", { roles: ["admin"] });
  const dry = await revokeRole(pool, world.admin.phone, "admin", { dryRun: true });
  assert.deepEqual([dry.ok, dry.changed, dry.code], [true, true, "DRY_RUN"]);
  assert.deepEqual(await staffRolesOf(world.admin.id), ["admin"]);
  // con relevo activo se puede retirar sin forzar
  const ok = await revokeRole(pool, world.admin.phone, "admin");
  assert.equal(ok.code, "REVOKED");
  assert.equal((await call(app, "GET", "/v1/admin/me", { as: world.admin })).status, 403);
  // ahora `second` es el último: --force lo permite y queda constancia
  assert.equal((await revokeRole(pool, second.phone, "admin")).code, "LAST_ADMIN");
  const forced = await revokeRole(pool, second.phone, "admin", { force: true });
  assert.equal(forced.code, "REVOKED");
  assert.equal((await lastAudit(pool, "admin.role.revoked"))?.metadata.forced, true);
  void sleeping;
});

test("grant-role: list muestra solo cuentas con roles de personal (teléfonos enmascarados) y admite filtrar por teléfono", async () => {
  const all = await listStaffRoles(pool);
  assert.equal(all.ok, true);
  assert.deepEqual(
    all.entries.map(e => e.roles.join(",")).sort(),
    ["admin", "finance_admin", "support_admin", "verification_admin"],
    "pasajeros y conductores no aparecen"
  );
  for (const entry of all.entries) {
    assert.match(entry.phone ?? "", /^\+34 ••• ••• \d{3}$/);
    assert.equal(entry.status, "active");
  }
  const raw = JSON.stringify(all);
  for (const user of [world.admin, world.finance, world.support, world.verification]) assert.ok(!raw.includes(user.phone));

  await grantRole(pool, world.admin.phone, "finance_admin");
  const one = await listStaffRoles(pool, world.admin.phone);
  assert.deepEqual(one.entries.map(e => e.roles), [["admin", "finance_admin"]]);
  const none = await listStaffRoles(pool, world.rider.phone);
  assert.deepEqual(none.entries.map(e => [e.userId, e.roles]), [[world.rider.id, []]], "una cuenta concreta sin roles se muestra vacía");
  assert.deepEqual((await listStaffRoles(pool, "+34699999999")).entries, []);
  assert.equal((await listStaffRoles(pool, "no-es-un-telefono")).code, "PHONE_INVALID");
});

test("grant-role: línea de comandos — códigos de salida 0 (correcto) · 1 (error) · 2 (uso) y mensajes", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const io = { out: (text: string) => void out.push(text), err: (text: string) => void err.push(text) };
  const run = async (...argv: string[]) => {
    out.length = 0;
    err.length = 0;
    return runCli(argv, pool, io);
  };
  const target = await seedUser(pool, "Persona de prueba", { roles: ["passenger"] });

  assert.equal(await run("grant", target.phone, "finance_admin"), 0);
  assert.match(out[0] ?? "", /^Rol finance_admin concedido a \+34 ••• ••• \d{3}\.$/);
  assert.equal(await run("grant", target.phone, "finance_admin"), 0);
  assert.match(out[0] ?? "", /ya tenía el rol/);
  assert.equal(await run("revoke", target.phone, "finance_admin", "--dry-run"), 0);
  assert.match(out[0] ?? "", /^\[simulación\]/);
  assert.deepEqual(await staffRolesOf(target.id), ["finance_admin", "passenger"]);
  assert.equal(await run("list"), 0);
  assert.ok(out.some(line => line.includes("finance_admin")));
  assert.match(out.at(-1) ?? "", /^\d+ cuenta\(s\)\.$/);
  assert.equal(await run("list", target.phone), 0);

  assert.equal(await run("grant", "+34699999999", "admin"), 1);
  assert.match(err[0] ?? "", /No existe ninguna cuenta/);
  assert.equal(await run("grant", target.phone, "passenger"), 1);
  assert.equal(await run("revoke", world.admin.phone, "admin"), 1);
  assert.match(err[0] ?? "", /último admin/);

  assert.equal(await run(), 2);
  assert.match(err[0] ?? "", /^Uso:/);
  assert.equal(await run("grant", target.phone), 2);
  assert.equal(await run("grant", target.phone, "admin", "extra"), 2);
  assert.equal(await run("promote", target.phone, "admin"), 2);
  assert.equal(await run("list", target.phone, "otro"), 2);
  assert.equal(await run("grant", target.phone, "admin", "--nope"), 2);
  assert.match(err[0] ?? "", /Opción desconocida: --nope/);
});

test("grant-role: ejecutado de verdad (proceso aparte) solo necesita DATABASE_URL y no deja puertas traseras", async () => {
  const target = await seedUser(pool, "Persona de proceso", { roles: ["passenger"] });
  const exec = (...args: string[]) =>
    spawnSync(process.execPath, ["--import", "tsx", path.join(ROOT, "scripts/grant-role.ts"), ...args], {
      cwd: ROOT,
      env: { PATH: process.env.PATH ?? "", DATABASE_URL: process.env.DATABASE_URL ?? "" },
      encoding: "utf8",
      timeout: 60_000
    });
  const granted = exec("grant", target.phone, "verification_admin");
  assert.equal(granted.status, 0, granted.stderr);
  assert.match(granted.stdout, /Rol verification_admin concedido/);
  assert.ok(!granted.stdout.includes(target.phone));
  assert.deepEqual(await staffRolesOf(target.id), ["passenger", "verification_admin"]);
  assert.equal((await call(app, "GET", "/v1/admin/me", { as: target })).status, 200);

  const listed = exec("list");
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, new RegExp(`${target.id}\\s+\\+34 ••• ••• \\d{3}\\s+active\\s+verification_admin`));

  const failed = exec("grant", "+34699999999", "admin");
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /No existe ninguna cuenta/);
  const usage = exec();
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /Uso:/);
  const noDb = spawnSync(process.execPath, ["--import", "tsx", path.join(ROOT, "scripts/grant-role.ts"), "list"], {
    cwd: ROOT,
    env: { PATH: process.env.PATH ?? "" },
    encoding: "utf8",
    timeout: 60_000
  });
  assert.notEqual(noDb.status, 0);
  assert.match(noDb.stderr, /DATABASE_URL/);

  // No hay forma de obtener acceso por la API: ni roles propios de personal ni endpoint de arranque
  const self = await call(app, "PUT", "/v1/me/roles", { as: world.rider, body: { roles: ["admin"] } });
  assert.ok([400, 422].includes(self.status), `PUT /v1/me/roles con admin → ${self.status}`);
  assert.deepEqual(await staffRolesOf(world.rider.id), ["passenger"]);
  for (const url of ["/v1/admin/bootstrap", "/v1/admin/setup", "/v1/admin/grant", "/v1/admin/login"]) {
    assert.equal((await call(app, "POST", url, { as: world.rider, body: {} })).status, 404, url);
  }
});

/* ═══════════════════════════════ Derechos sobre los datos (RGPD) ═══════════════════════════════ */

async function seedUserWithTrustData(user: SeededUser, target: FastifyInstance, files: FakeStorage) {
  assert.equal((await uploadFlow(target, files, user, "photo")).complete.status, 200);
  assert.equal((await acceptPrivateCheckNotice(target, user)).status, 201);
  const capture = await uploadFlow(target, files, user, "selfie");
  assert.equal(capture.complete.status, 200, JSON.stringify(capture.complete.body));
  const photo = (await pool.query(`select id, storage_key from trust_profile_photos where user_id = $1`, [user.id])).rows[0];
  await pool.query(`update trust_profile_photos set reason_note = 'Nota interna: parece una foto de otra persona' where id = $1`, [photo.id]);
  await pool.query(`update trust_identity_checks set reason_note = 'Nota interna sobre la comprobación' where user_id = $1`, [user.id]);
}

test("derechos de datos: la exportación incluye estados, fechas y versiones aceptadas, y no incluye imágenes, claves, notas internas ni hashes", async () => {
  const built = await buildTrustApp(pool, { now: () => NOW, trustConfig: { ipHashPepper: "pepper-de-prueba" } });
  try {
    const files = built.storage as FakeStorage;
    await seedUserWithTrustData(world.rider, built.app, files);
    const other = await seedUser(pool, "Otra Persona", { roles: ["passenger"] });
    await seedUserWithTrustData(other, built.app, files);
    const keys = (await pool.query<{ k: string }>(`select storage_key as k from trust_profile_photos where user_id = $1`, [world.rider.id])).rows.map(r => r.k);

    const exported = await exportUserTrustData(pool, world.rider.id);
    assert.equal(exported.profilePhotos.length, 1);
    assert.deepEqual(Object.keys(exported.profilePhotos[0]!).sort(), ["decidedAt", "id", "reasonCode", "status", "submittedAt"]);
    assert.equal(exported.profilePhotos[0]!.status, "in_review");
    assert.equal(exported.privateCheck?.state, "in_review");
    assert.equal(exported.privateCheck?.attemptsUsed, 1);
    assert.equal(exported.privateCheck?.attempts.length, 1);
    assert.equal(exported.privateCheck?.attempts[0]?.attemptNo, 1);
    assert.equal(typeof exported.privateCheck?.attempts[0]?.privacyNoticeVersionAccepted, "number", "consta la versión del aviso aceptada");
    assert.ok(exported.legalAcceptances.length >= 1);
    const acceptance = exported.legalAcceptances.find(a => a.kind === "private_check_notice");
    assert.deepEqual([acceptance?.context, acceptance?.documentStatus, acceptance?.ipHashStored], ["private_check", "draft_pending_legal_review", true]);
    assert.ok(exported.uploadsRequested >= 2);
    assert.equal(exported.notes.length, 2);

    const text = JSON.stringify(exported);
    for (const secret of [...keys, "storage", "Nota interna", world.rider.phone, "pepper-de-prueba", "sha256"]) {
      assert.ok(!text.includes(secret), `la exportación no debe contener «${secret}»`);
    }
    const dbHash = (await pool.query<{ h: string }>(`select ip_hash as h from trust_legal_acceptances where user_id = $1 and ip_hash is not null limit 1`, [world.rider.id])).rows[0]!.h;
    assert.ok(!text.includes(dbHash), "el hash de IP no sale: solo se indica que existe");
    // lo de otra persona nunca aparece
    const otherKeys = (await pool.query<{ k: string }>(`select storage_key as k from trust_profile_photos where user_id = $1`, [other.id])).rows.map(r => r.k);
    for (const k of otherKeys) assert.ok(!text.includes(k));

    // sin datos: estructura vacía honesta
    const empty = await exportUserTrustData(pool, world.driver.id);
    assert.deepEqual([empty.profilePhotos, empty.privateCheck, empty.legalAcceptances, empty.uploadsRequested], [[], null, [], 0]);
  } finally {
    await built.app.close();
  }
});

test("derechos de datos: eliminación — claves de almacenamiento listadas, filas borradas, aceptaciones conservadas sin hash de IP, otras cuentas intactas", async () => {
  const built = await buildTrustApp(pool, { now: () => NOW, trustConfig: { ipHashPepper: "pepper-de-prueba" } });
  try {
    const files = built.storage as FakeStorage;
    await seedUserWithTrustData(world.rider, built.app, files);
    const other = await seedUser(pool, "Otra Persona", { roles: ["passenger"] });
    await seedUserWithTrustData(other, built.app, files);

    const keys = await listUserTrustStorageKeys(pool, world.rider.id);
    assert.equal(keys.length, 2, "foto y selfie (las intenciones comparten clave con lo subido)");
    for (const k of keys) assert.ok(k.startsWith(`users/${world.rider.id}/`), k);
    assert.deepEqual(await listUserTrustStorageKeys(pool, world.driver.id), []);

    const acceptancesBefore = Number((await pool.query(`select count(*)::int as n from trust_legal_acceptances where user_id = $1`, [world.rider.id])).rows[0].n);
    const otherBefore = JSON.stringify(await exportUserTrustData(pool, other.id));

    const client = await pool.connect();
    let counts: Record<string, number>;
    try {
      await client.query("begin");
      counts = await eraseUserTrustData(client, world.rider.id);
      await client.query("commit");
    } finally {
      client.release();
    }
    assert.deepEqual(counts, {
      identityCheckAttemptsDeleted: 1,
      identityChecksDeleted: 1,
      profilePhotosDeleted: 1,
      uploadIntentsDeleted: 2,
      legalAcceptancesIpHashRemoved: acceptancesBefore
    });
    for (const table of ["trust_profile_photos", "trust_identity_check_attempts", "trust_identity_checks"]) {
      assert.equal((await pool.query(`select count(*)::int as n from ${table} where user_id = $1`, [world.rider.id])).rows[0].n, 0, table);
    }
    assert.equal((await pool.query(`select count(*)::int as n from trust_upload_intents where owner_user_id = $1`, [world.rider.id])).rows[0].n, 0);
    const retained = await pool.query(`select ip_hash from trust_legal_acceptances where user_id = $1`, [world.rider.id]);
    assert.equal(retained.rowCount, acceptancesBefore, "las aceptaciones se conservan como prueba del consentimiento");
    assert.ok(retained.rows.every(r => r.ip_hash === null), "pero sin el hash de la IP");
    assert.equal(JSON.stringify(await exportUserTrustData(pool, other.id)), otherBefore, "los datos de otras cuentas no cambian");
    assert.deepEqual(await listUserTrustStorageKeys(pool, world.rider.id), []);
    // es idempotente
    const client2 = await pool.connect();
    try {
      await client2.query("begin");
      const zero = await eraseUserTrustData(client2, world.rider.id);
      await client2.query("commit");
      assert.deepEqual(Object.values(zero), [0, 0, 0, 0, 0]);
    } finally {
      client2.release();
    }
  } finally {
    await built.app.close();
  }
});

test("derechos de datos: el módulo se registra en el registro de comms (exportación y eliminación) y su contribución es utilizable", async t => {
  let registry: typeof import("../src/modules/comms/registry.js");
  try {
    registry = await import("../src/modules/comms/registry.js");
  } catch {
    return t.skip("el módulo comms no está disponible en este árbol");
  }
  assert.equal(await registerTrustDataRights(), true);
  const contributor = registry.getExportContributors().find(c => c.name === "trust");
  const step = registry.getErasureSteps().find(s => s.name === "trust");
  assert.ok(contributor && step, "contribuidor de exportación y paso de eliminación registrados con el nombre «trust»");
  const sectionUser = await seedUser(pool, "Con datos", { roles: ["passenger"] });
  const section = (await contributor.build(pool, sectionUser.id)) as { profilePhotos: unknown[]; notes: string[] };
  assert.deepEqual(section.profilePhotos, []);
  assert.equal(section.notes.length, 2);
  assert.deepEqual(await step.storageKeys?.(pool, sectionUser.id), []);
  // registrar dos veces sustituye, no duplica
  await registerTrustDataRights();
  assert.equal(registry.getExportContributors().filter(c => c.name === "trust").length, 1);
  assert.equal(registry.getErasureSteps().filter(s => s.name === "trust").length, 1);
});

test("derechos de datos: la exportación completa de comms incluye la sección «trust» (y ya no figura como pendiente)", async t => {
  if (!hasCommsExport) return t.skip("la base no tiene las tablas de comms (se necesita mvc_trust_full)");
  let exporter: typeof import("../src/modules/comms/data-export.js");
  let configModule: typeof import("../src/modules/comms/config.js");
  try {
    exporter = await import("../src/modules/comms/data-export.js");
    configModule = await import("../src/modules/comms/config.js");
  } catch {
    return t.skip("el módulo comms no está disponible en este árbol");
  }
  assert.equal(await registerTrustDataRights(), true);
  const built = await buildTrustApp(pool, { now: () => NOW });
  try {
    await seedUserWithTrustData(world.rider, built.app, built.storage as FakeStorage);
    const file = (await exporter.buildUserDataExport(pool, world.rider.id, configModule.loadCommsConfig({}), NOW)) as {
      modules: Record<string, any>;
      notIncluded: Array<{ section: string }>;
    };
    assert.ok(file.modules.trust, "sección trust presente");
    assert.equal(file.modules.trust.profilePhotos.length, 1);
    assert.equal(file.modules.trust.privateCheck.state, "in_review");
    assert.ok(!file.notIncluded.some(item => /identidad|fotos de perfil|textos legales/i.test(item.section)), "ya no consta como pendiente");
    assert.doesNotMatch(JSON.stringify(file.modules.trust), /Nota interna|users\/[0-9a-f-]{36}\/trust/);
  } finally {
    await built.app.close();
  }
});

test("derechos de datos: la eliminación de comms ejecuta el paso de trust y borra sus filas antes de anonimizar", async t => {
  if (!hasCommsExport) return t.skip("la base no tiene las tablas de comms (se necesita mvc_trust_full)");
  let registry: typeof import("../src/modules/comms/registry.js");
  try {
    registry = await import("../src/modules/comms/registry.js");
  } catch {
    return t.skip("el módulo comms no está disponible en este árbol");
  }
  await registerTrustDataRights();
  const built = await buildTrustApp(pool, { now: () => NOW });
  try {
    await seedUserWithTrustData(world.rider, built.app, built.storage as FakeStorage);
    const step = registry.getErasureSteps().find(s => s.name === "trust")!;
    const keys = (await step.storageKeys?.(pool, world.rider.id)) ?? [];
    assert.equal(keys.length, 2);
    const client = await pool.connect();
    try {
      await client.query("begin");
      const counts = await step.run(client, world.rider.id);
      await client.query("commit");
      assert.equal((counts as Record<string, number>).profilePhotosDeleted, 1);
    } finally {
      client.release();
    }
    assert.equal((await pool.query(`select count(*)::int as n from trust_profile_photos where user_id = $1`, [world.rider.id])).rows[0].n, 0);
  } finally {
    await built.app.close();
  }
  void seedTrip;
  void seedVehicle;
  void seedProvince;
});
