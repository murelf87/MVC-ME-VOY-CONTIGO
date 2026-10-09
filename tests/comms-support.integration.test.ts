import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { loadCommsConfig } from "../src/modules/comms/config.js";
import { cleanupSupportUploads } from "../src/modules/comms/jobs.js";
import { getShareLiveLocationInTrip } from "../src/modules/comms/settings.js";
import {
  DisabledStorage,
  FakeEraser,
  FakeStorage,
  JPEG_BYTES,
  NOT_AN_IMAGE,
  PNG_BYTES,
  SEVILLA,
  buildCommsApp,
  clientFor,
  createPool,
  daysAfter,
  keysOf,
  seedBooking,
  seedTrip,
  seedUser,
  seedWorld,
  truncateAll,
  type Client,
  type World
} from "./comms-support.js";

/**
 * Centro de ayuda (pantalla 35) y Ajustes (pantalla 34). BD de pruebas propia: mvc_comms.
 */
const uuid = () => crypto.randomUUID();
const expectKeys = (value: unknown, expected: string[]) => assert.deepEqual(keysOf(value), [...expected].sort());

const TICKET_KEYS = [
  "id", "reference", "category", "status", "bodyPreview", "tripId", "bookingId", "attachmentCount", "hasStaffReply",
  "lastActivityAt", "createdAt", "body", "messages", "closedAt"
];
const MESSAGE_KEYS = ["id", "authorType", "authorName", "body", "attachments", "createdAt"];
const ATTACHMENT_KEYS = ["id", "contentType", "sizeBytes", "createdAt"];

describe("comms · centro de ayuda y ajustes", () => {
  let pool: pg.Pool;
  let storage: FakeStorage;
  let app: FastifyInstance;
  let world: World;
  let ana: Client;
  let miguel: Client;
  let laura: Client;
  let tripA: string;
  let tripB: string;
  let bookingMiguelA: string;
  let bookingLauraB: string;

  before(async () => {
    pool = createPool();
    storage = new FakeStorage();
    app = await buildCommsApp(pool, { privateStorage: storage });
  });

  after(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    storage.objects.clear();
    await truncateAll(pool);
    world = await seedWorld(pool);
    tripA = (await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, { departureAt: daysAfter(new Date(), 1) })).tripId;
    tripB = (
      await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, {
        departureAt: daysAfter(new Date(), 2), stops: [SEVILLA.santaJusta, SEVILLA.universidad], category: "university"
      })
    ).tripId;
    await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, { status: "draft" });
    bookingMiguelA = (await seedBooking(pool, tripA, world.miguel)).bookingId!;
    bookingLauraB = (await seedBooking(pool, tripB, world.laura)).bookingId!;
    ana = await clientFor(app, pool, world.ana);
    miguel = await clientFor(app, pool, world.miguel);
    laura = await clientFor(app, pool, world.laura);
  });

  /** Sube (en el almacenamiento simulado) y completa una imagen; devuelve el id del adjunto. */
  async function uploadImage(client: Client, bytes: Uint8Array = PNG_BYTES, contentType = "image/png"): Promise<string> {
    const intent = await client.post("/v1/me/support/uploads/intents", { contentType, sizeBytes: bytes.byteLength });
    assert.equal(intent.status, 201, intent.raw);
    const key = new URL(intent.body.uploadUrl).pathname.slice(1);
    storage.put(key, bytes, contentType);
    const done = await client.post(`/v1/me/support/uploads/${intent.body.intentId}/complete`);
    assert.equal(done.status, 201, done.raw);
    return done.body.id;
  }

  async function ticketOf(client: Client, body = "El conductor no apareció en el punto de recogida", extra: Record<string, unknown> = {}) {
    const response = await client.post("/v1/me/support/tickets", { category: "trip_issue", body, ...extra });
    assert.equal(response.status, 201, response.raw);
    return response.body;
  }

  it("selector de viaje: solo los viajes en los que participé, del más reciente al más antiguo y sin borradores", async () => {
    const miguelTrips = await miguel.get("/v1/me/support/trips");
    assert.equal(miguelTrips.status, 200);
    expectKeys(miguelTrips.body, ["items", "nextCursor"]);
    assert.equal(miguelTrips.body.items.length, 1);
    expectKeys(miguelTrips.body.items[0], ["tripId", "bookingId", "role", "departureAt", "originLabel", "destinationLabel", "status"]);
    assert.equal(miguelTrips.body.items[0].tripId, tripA);
    assert.equal(miguelTrips.body.items[0].bookingId, bookingMiguelA);
    assert.equal(miguelTrips.body.items[0].role, "passenger");
    assert.equal(miguelTrips.body.items[0].originLabel, "Sevilla Centro");
    assert.equal(miguelTrips.body.items[0].destinationLabel, "Aparcamiento P1 · Isla Mágica");

    const anaTrips = await ana.get("/v1/me/support/trips");
    assert.deepEqual(anaTrips.body.items.map((t: { tripId: string }) => t.tripId), [tripB, tripA], "más reciente primero y sin el borrador");
    assert.ok(anaTrips.body.items.every((t: { role: string; bookingId: string | null }) => t.role === "driver" && t.bookingId === null));

    const paged = await ana.get("/v1/me/support/trips?limit=1");
    assert.equal(paged.body.items.length, 1);
    assert.ok(paged.body.nextCursor);
    const next = await ana.get(`/v1/me/support/trips?limit=1&cursor=${encodeURIComponent(paged.body.nextCursor)}`);
    assert.deepEqual(next.body.items.map((t: { tripId: string }) => t.tripId), [tripA]);
    assert.equal(next.body.nextCursor, null);

    const carlos = await clientFor(app, pool, await seedUser(pool, "Carlos Ruiz"));
    assert.deepEqual((await carlos.get("/v1/me/support/trips")).body.items, []);
    assert.equal((await app.inject({ method: "GET", url: "/v1/me/support/trips" })).statusCode, 401);
  });

  it("enviar una consulta: forma exacta, referencia legible, viaje y reserva propios, contador 0/500 e idempotencia", async () => {
    const created = await miguel.post(
      "/v1/me/support/tickets",
      { category: "trip_issue", body: "  El conductor no apareció en el punto de recogida  ", tripId: tripA, bookingId: bookingMiguelA },
      { "idempotency-key": "11111111-1111-4111-8111-111111111111" }
    );
    assert.equal(created.status, 201, created.raw);
    expectKeys(created.body, TICKET_KEYS);
    assert.match(created.body.reference, /^MVC-\d{4}-\d{6}$/);
    assert.equal(created.body.status, "open");
    assert.equal(created.body.category, "trip_issue");
    assert.equal(created.body.body, "El conductor no apareció en el punto de recogida", "se recorta el texto");
    assert.equal(created.body.bodyPreview, created.body.body);
    assert.equal(created.body.tripId, tripA);
    assert.equal(created.body.bookingId, bookingMiguelA);
    assert.equal(created.body.hasStaffReply, false);
    assert.equal(created.body.attachmentCount, 0);
    assert.equal(created.body.closedAt, null);
    assert.equal(created.body.messages.length, 1);
    expectKeys(created.body.messages[0], MESSAGE_KEYS);
    assert.equal(created.body.messages[0].authorType, "user");
    assert.equal(created.body.messages[0].authorName, "Miguel Torres");
    assert.equal(created.body.messages[0].body, created.body.body);

    // Repetir la misma petición devuelve la misma consulta; con otro contenido, 409.
    const replay = await miguel.post(
      "/v1/me/support/tickets",
      { category: "trip_issue", body: "El conductor no apareció en el punto de recogida", tripId: tripA, bookingId: bookingMiguelA },
      { "idempotency-key": "11111111-1111-4111-8111-111111111111" }
    );
    assert.equal(replay.status, 200);
    assert.equal(replay.body.id, created.body.id);
    const conflict = await miguel.post(
      "/v1/me/support/tickets",
      { category: "payment_issue", body: "Otra cosa distinta" },
      { "idempotency-key": "11111111-1111-4111-8111-111111111111" }
    );
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, "SUPPORT_IDEMPOTENCY_CONFLICT");
    assert.equal((await pool.query(`select count(*)::int as n from support_tickets`)).rows[0].n, 1);
    assert.equal((await pool.query(`select action from audit_events where action = 'support.ticket.created'`)).rowCount, 1);

    // Contador 0/500: 500 exactos sí; 501 no.
    assert.equal((await miguel.post("/v1/me/support/tickets", { category: "account_profile", body: "x".repeat(500) })).status, 201);
    const tooLong = await miguel.post("/v1/me/support/tickets", { category: "account_profile", body: "x".repeat(501) });
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.body.error.code, "VALIDATION_ERROR");
    for (const body of ["", "     ", "hola\u0000mundo"]) {
      const bad = await miguel.post("/v1/me/support/tickets", { category: "payment_issue", body });
      assert.equal(bad.status, 400, JSON.stringify(body));
      assert.equal(bad.body.error.code, "VALIDATION_ERROR");
    }
    assert.equal((await miguel.post("/v1/me/support/tickets", { category: "otra", body: "hola" })).status, 400);
    assert.equal((await miguel.post("/v1/me/support/tickets", { body: "sin categoría" })).status, 400);
    assert.equal((await miguel.post("/v1/me/support/tickets", { category: "payment_issue", body: "hola", tripId: "no-uuid" })).status, 400);
    // La categoría de pago y de perfil no exigen viaje.
    const payment = await miguel.post("/v1/me/support/tickets", { category: "payment_issue", body: "Me han cobrado dos veces" });
    assert.equal(payment.status, 201);
    assert.equal(payment.body.tripId, null);
  });

  it("vincular viaje o reserva: solo los propios (403 SUPPORT_LINK_FORBIDDEN) y coherentes entre sí", async () => {
    const forbidden = async (client: Client, extra: Record<string, unknown>) => {
      const response = await client.post("/v1/me/support/tickets", { category: "trip_issue", body: "Problema con el viaje", ...extra });
      assert.equal(response.status, 403, JSON.stringify(extra));
      assert.equal(response.body.error.code, "SUPPORT_LINK_FORBIDDEN");
    };
    await forbidden(miguel, { bookingId: bookingLauraB });
    await forbidden(miguel, { tripId: tripB });
    await forbidden(miguel, { tripId: tripB, bookingId: bookingMiguelA });
    await forbidden(miguel, { bookingId: uuid() });
    await forbidden(miguel, { tripId: uuid() });
    await forbidden(laura, { bookingId: bookingMiguelA });
    assert.equal((await pool.query(`select count(*)::int as n from support_tickets`)).rows[0].n, 0, "ninguna consulta se crea a medias");

    // Ana (conductora) puede vincular su propio viaje y la reserva de un pasajero en él.
    const asDriver = await ana.post("/v1/me/support/tickets", { category: "trip_issue", body: "El pasajero canceló tarde", tripId: tripA, bookingId: bookingMiguelA });
    assert.equal(asDriver.status, 201, asDriver.raw);
    // Solo con la reserva basta: el viaje se deduce.
    const bookingOnly = await laura.post("/v1/me/support/tickets", { category: "trip_issue", body: "Llegué tarde", bookingId: bookingLauraB });
    assert.equal(bookingOnly.body.tripId, tripB);
  });

  it("autorización: nadie ve, responde, cierra ni descarga adjuntos de las consultas de otra persona", async () => {
    const attachmentId = await uploadImage(miguel);
    const ticket = await ticketOf(miguel, "Consulta privada de Miguel", { attachmentIds: [attachmentId] });

    for (const attempt of [
      () => laura.get(`/v1/me/support/tickets/${ticket.id}`),
      () => laura.post(`/v1/me/support/tickets/${ticket.id}/replies`, { body: "Me cuelo" }),
      () => laura.post(`/v1/me/support/tickets/${ticket.id}/close`),
      () => ana.get(`/v1/me/support/tickets/${ticket.id}`)
    ]) {
      const response = await attempt();
      assert.equal(response.status, 404);
      assert.equal(response.body.error.code, "SUPPORT_TICKET_NOT_FOUND");
      assert.ok(!response.raw.includes("Consulta privada"));
    }
    const download = await laura.get(`/v1/me/support/attachments/${attachmentId}/download`);
    assert.equal(download.status, 404);
    assert.equal(download.body.error.code, "SUPPORT_ATTACHMENT_NOT_FOUND");
    assert.deepEqual((await laura.get("/v1/me/support/tickets")).body.items, []);
    const row = await pool.query(`select status, closed_at from support_tickets where id = $1`, [ticket.id]);
    assert.equal(row.rows[0].status, "open");
    assert.equal(row.rows[0].closed_at, null);
    assert.equal((await pool.query(`select count(*)::int as n from support_ticket_messages where ticket_id = $1`, [ticket.id])).rows[0].n, 1);

    // Un id mal formado o inexistente responde igual que uno ajeno (no se revela si existe).
    assert.equal((await miguel.get(`/v1/me/support/tickets/${uuid()}`)).status, 404);
    assert.equal((await miguel.get(`/v1/me/support/tickets/xx`)).status, 400);
    assert.equal((await app.inject({ method: "GET", url: `/v1/me/support/tickets/${ticket.id}` })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/v1/me/support/tickets", payload: { category: "trip_issue", body: "x" } })).statusCode, 401);
  });

  it("listado: solo mis consultas, por última actividad, filtro por estado y paginación estable", async () => {
    const first = await ticketOf(miguel, "Primera consulta");
    const second = await ticketOf(miguel, "Segunda consulta");
    const third = await ticketOf(miguel, "Tercera consulta");
    await ticketOf(laura, "Consulta de Laura");
    await pool.query(`update support_tickets set created_at = now() - interval '3 hours', last_user_message_at = now() - interval '3 hours' where id = $1`, [first.id]);
    await pool.query(`update support_tickets set created_at = now() - interval '2 hours', last_user_message_at = now() - interval '2 hours' where id = $1`, [second.id]);
    await pool.query(`update support_tickets set created_at = now() - interval '1 hours', last_user_message_at = now() - interval '1 hours' where id = $1`, [third.id]);

    const all = await miguel.get("/v1/me/support/tickets");
    assert.equal(all.status, 200);
    expectKeys(all.body, ["items", "nextCursor"]);
    assert.deepEqual(all.body.items.map((t: { id: string }) => t.id), [third.id, second.id, first.id]);
    expectKeys(all.body.items[0], TICKET_KEYS.filter(key => !["body", "messages", "closedAt"].includes(key)));

    // Una respuesta del equipo sube la consulta al principio y la marca como respondida.
    await pool.query(`insert into support_ticket_messages(ticket_id, author_type, body) values($1,'staff','Hemos revisado tu viaje')`, [first.id]);
    const answered = await miguel.get("/v1/me/support/tickets?status=answered");
    assert.deepEqual(answered.body.items.map((t: { id: string }) => t.id), [first.id]);
    assert.equal(answered.body.items[0].hasStaffReply, true);
    assert.equal((await miguel.get("/v1/me/support/tickets")).body.items[0].id, first.id);
    assert.equal((await miguel.get("/v1/me/support/tickets?status=open")).body.items.length, 2);
    assert.equal((await miguel.get("/v1/me/support/tickets?status=closed")).body.items.length, 0);
    assert.equal((await miguel.get("/v1/me/support/tickets?status=archivada")).status, 400);

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 5; guard += 1) {
      const page = await miguel.get(`/v1/me/support/tickets?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      seen.push(...page.body.items.map((t: { id: string }) => t.id));
      cursor = page.body.nextCursor;
      if (!cursor) break;
    }
    assert.deepEqual(seen, [first.id, third.id, second.id]);
    assert.equal((await miguel.get("/v1/me/support/tickets?cursor=basura")).body.error.code, "INVALID_CURSOR");
  });

  it("hilo de la consulta: respuesta del equipo (respondida + aviso), respuesta del usuario (vuelve a abierta), cierre y consulta cerrada", async () => {
    const ticket = await ticketOf(miguel);
    assert.equal(ticket.status, "open");

    // El equipo (módulo trust) inserta su respuesta: el disparador mueve el estado y avisa a la persona.
    await pool.query(`insert into support_ticket_messages(ticket_id, author_type, author_user_id, body) values($1,'staff',$2,'Gracias por avisarnos. Hemos contactado con la conductora.')`, [ticket.id, world.ana]);
    const answered = await miguel.get(`/v1/me/support/tickets/${ticket.id}`);
    assert.equal(answered.body.status, "answered");
    assert.equal(answered.body.hasStaffReply, true);
    assert.equal(answered.body.messages.length, 2);
    assert.equal(answered.body.messages[1].authorType, "staff");
    assert.equal(answered.body.messages[1].authorName, "Equipo MVC");
    const notice = await miguel.get("/v1/notifications");
    const supportNotice = notice.body.items.find((n: { kind: string }) => n.kind === "support_reply");
    assert.ok(supportNotice, "aviso de respuesta de soporte");
    assert.equal(supportNotice.essential, true);
    assert.equal(supportNotice.data.ticketId, ticket.id);

    // Responder: 1–1000 caracteres; la consulta vuelve a abierta.
    const reply = await miguel.post(`/v1/me/support/tickets/${ticket.id}/replies`, { body: "Sigo esperando noticias" });
    assert.equal(reply.status, 201, reply.raw);
    expectKeys(reply.body, TICKET_KEYS);
    assert.equal(reply.body.status, "open");
    assert.equal(reply.body.messages.length, 3);
    assert.equal(reply.body.messages[2].authorType, "user");
    assert.equal((await miguel.post(`/v1/me/support/tickets/${ticket.id}/replies`, { body: "r".repeat(1000) })).status, 201);
    assert.equal((await miguel.post(`/v1/me/support/tickets/${ticket.id}/replies`, { body: "r".repeat(1001) })).status, 400);
    assert.equal((await miguel.post(`/v1/me/support/tickets/${ticket.id}/replies`, { body: "   " })).status, 400);
    assert.equal((await miguel.post(`/v1/me/support/tickets/${ticket.id}/replies`, {})).status, 400);

    // Cerrar es idempotente y no se puede reabrir; el equipo tampoco la reabre al contestar.
    const closed = await miguel.post(`/v1/me/support/tickets/${ticket.id}/close`);
    assert.equal(closed.status, 200);
    assert.equal(closed.body.status, "closed");
    assert.ok(closed.body.closedAt);
    const closedAgain = await miguel.post(`/v1/me/support/tickets/${ticket.id}/close`);
    assert.equal(closedAgain.body.closedAt, closed.body.closedAt);
    assert.equal((await pool.query(`select 1 from audit_events where action = 'support.ticket.closed'`)).rowCount, 1);
    const afterClose = await miguel.post(`/v1/me/support/tickets/${ticket.id}/replies`, { body: "¿Puedo escribir todavía?" });
    assert.equal(afterClose.status, 409);
    assert.equal(afterClose.body.error.code, "SUPPORT_TICKET_CLOSED");
    await pool.query(`insert into support_ticket_messages(ticket_id, author_type, body) values($1,'staff','Cerramos el caso')`, [ticket.id]);
    assert.equal((await miguel.get(`/v1/me/support/tickets/${ticket.id}`)).body.status, "closed");
  });

  it("topes: 5 consultas al día, 10 abiertas a la vez y 20 mensajes al día por consulta", async () => {
    for (let i = 1; i <= 5; i += 1) await ticketOf(miguel, `Consulta número ${i}`);
    const daily = await miguel.post("/v1/me/support/tickets", { category: "payment_issue", body: "Una más" });
    assert.equal(daily.status, 429);
    assert.equal(daily.body.error.code, "SUPPORT_TICKET_LIMIT");
    assert.equal(daily.body.error.details.limit, "daily");
    // Otra persona no se ve afectada.
    assert.equal((await laura.post("/v1/me/support/tickets", { category: "payment_issue", body: "La mía" })).status, 201);

    // Abiertas: 10 consultas antiguas abiertas bloquean una nueva aunque no haya enviado ninguna hoy.
    const sofia = await seedUser(pool, "Sofía Navarro");
    const other = await clientFor(app, pool, sofia);
    await pool.query(
      `insert into support_tickets(user_id, category, body, created_at, last_user_message_at)
       select $1, 'account_profile', 'Consulta antigua ' || g, now() - interval '5 days', now() - interval '5 days' from generate_series(1, 10) g`,
      [sofia]
    );
    const openLimit = await other.post("/v1/me/support/tickets", { category: "account_profile", body: "Otra más" });
    assert.equal(openLimit.status, 429);
    assert.equal(openLimit.body.error.details.limit, "open");
    // Cerrar una libera el cupo.
    const oldest = (await pool.query<{ id: string }>(`select id from support_tickets where user_id = $1 order by id limit 1`, [sofia])).rows[0]!.id;
    assert.equal((await other.post(`/v1/me/support/tickets/${oldest}/close`)).status, 200);
    assert.equal((await other.post("/v1/me/support/tickets", { category: "account_profile", body: "Ahora sí" })).status, 201);

    // Mensajes por consulta.
    const ticket = await ticketOf(laura, "Para el tope de mensajes");
    await pool.query(
      `insert into support_ticket_messages(ticket_id, author_type, author_user_id, body) select $1, 'user', $2, 'msg ' || g from generate_series(1, 19) g`,
      [ticket.id, world.laura]
    );
    const spam = await laura.post(`/v1/me/support/tickets/${ticket.id}/replies`, { body: "mensaje 21" });
    assert.equal(spam.status, 429);
    assert.equal(spam.body.error.details.limit, "replies");
  });

  it("imágenes: intención de subida, subida real al almacenamiento, completar con comprobación de tamaño, tipo y contenido", async () => {
    const intent = await miguel.post("/v1/me/support/uploads/intents", { contentType: "image/png", sizeBytes: PNG_BYTES.byteLength });
    assert.equal(intent.status, 201, intent.raw);
    expectKeys(intent.body, ["intentId", "uploadUrl", "headers", "expiresAt"]);
    assert.deepEqual(intent.body.headers, { "content-type": "image/png" });
    const key = new URL(intent.body.uploadUrl).pathname.slice(1);
    assert.match(key, new RegExp(`^users/${world.miguel}/support/${intent.body.intentId}\\.png$`));

    // Completar antes de subir: el servidor no tiene el archivo.
    const missing = await miguel.post(`/v1/me/support/uploads/${intent.body.intentId}/complete`);
    assert.equal(missing.status, 409);
    assert.equal(missing.body.error.code, "UPLOAD_OBJECT_MISSING");

    // Tamaño distinto del declarado.
    storage.put(key, new Uint8Array([...PNG_BYTES, 1, 2, 3]), "image/png");
    const wrongSize = await miguel.post(`/v1/me/support/uploads/${intent.body.intentId}/complete`);
    assert.equal(wrongSize.status, 422);
    assert.equal(wrongSize.body.error.code, "UPLOADED_FILE_SIZE_MISMATCH");

    // Tipo declarado por el almacenamiento distinto.
    storage.put(key, PNG_BYTES, "application/pdf");
    assert.equal((await miguel.post(`/v1/me/support/uploads/${intent.body.intentId}/complete`)).body.error.code, "UPLOADED_FILE_TYPE_MISMATCH");

    // Contenido que no es una imagen aunque se declare PNG.
    const fake = await miguel.post("/v1/me/support/uploads/intents", { contentType: "image/png", sizeBytes: NOT_AN_IMAGE.byteLength });
    storage.put(new URL(fake.body.uploadUrl).pathname.slice(1), NOT_AN_IMAGE, "image/png");
    const notImage = await miguel.post(`/v1/me/support/uploads/${fake.body.intentId}/complete`);
    assert.equal(notImage.status, 422);
    assert.equal(notImage.body.error.code, "UPLOADED_FILE_TYPE_MISMATCH");
    // Un JPEG presentado como PNG tampoco vale.
    const swapped = await miguel.post("/v1/me/support/uploads/intents", { contentType: "image/png", sizeBytes: JPEG_BYTES.byteLength });
    storage.put(new URL(swapped.body.uploadUrl).pathname.slice(1), JPEG_BYTES, "image/png");
    assert.equal((await miguel.post(`/v1/me/support/uploads/${swapped.body.intentId}/complete`)).body.error.code, "UPLOADED_FILE_TYPE_MISMATCH");

    // Correcto.
    storage.put(key, PNG_BYTES, "image/png");
    const done = await miguel.post(`/v1/me/support/uploads/${intent.body.intentId}/complete`);
    assert.equal(done.status, 201, done.raw);
    expectKeys(done.body, ATTACHMENT_KEYS);
    assert.equal(done.body.contentType, "image/png");
    assert.equal(done.body.sizeBytes, PNG_BYTES.byteLength);
    const again = await miguel.post(`/v1/me/support/uploads/${intent.body.intentId}/complete`);
    assert.equal(again.status, 200);
    assert.equal(again.body.id, done.body.id);
    const stored = await pool.query(`select sha256, owner_user_id from support_attachments where id = $1`, [done.body.id]);
    assert.equal(stored.rows[0].sha256, crypto.createHash("sha256").update(PNG_BYTES).digest("hex"));
    assert.equal(stored.rows[0].owner_user_id, world.miguel);

    // Validación de la intención: tipo y tamaño fuera de política se rechazan antes de firmar nada.
    const before = storage.uploadUrlCalls.length;
    for (const body of [
      { contentType: "application/pdf", sizeBytes: 100 },
      { contentType: "image/svg+xml", sizeBytes: 100 },
      { contentType: "image/png", sizeBytes: 0 },
      { contentType: "image/png", sizeBytes: 10 * 1024 * 1024 + 1 },
      { contentType: "image/png", sizeBytes: 1.5 },
      { contentType: "image/png" }
    ]) {
      const response = await miguel.post("/v1/me/support/uploads/intents", body);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.equal(response.body.error.code, "VALIDATION_ERROR");
    }
    assert.equal(storage.uploadUrlCalls.length, before, "no se firma nada para una petición inválida");
    assert.equal((await miguel.post("/v1/me/support/uploads/intents", { contentType: "image/heic", sizeBytes: 5_000_000 })).status, 201);
    assert.equal((await miguel.post("/v1/me/support/uploads/intents", { contentType: "image/png", sizeBytes: 10 * 1024 * 1024 })).status, 201, "10 MiB exactos");
  });

  it("imágenes: una subida ajena, caducada o duplicada no se puede completar; el cupo de imágenes sin enviar está acotado", async () => {
    const intent = await miguel.post("/v1/me/support/uploads/intents", { contentType: "image/png", sizeBytes: PNG_BYTES.byteLength });
    storage.put(new URL(intent.body.uploadUrl).pathname.slice(1), PNG_BYTES, "image/png");
    const foreign = await laura.post(`/v1/me/support/uploads/${intent.body.intentId}/complete`);
    assert.equal(foreign.status, 404);
    assert.equal(foreign.body.error.code, "UPLOAD_INTENT_NOT_FOUND");
    assert.equal((await pool.query(`select 1 from support_attachments`)).rowCount, 0);
    assert.equal((await miguel.post(`/v1/me/support/uploads/${uuid()}/complete`)).status, 404);

    await pool.query(`update support_upload_intents set expires_at = now() - interval '1 minute' where id = $1`, [intent.body.intentId]);
    const expired = await miguel.post(`/v1/me/support/uploads/${intent.body.intentId}/complete`);
    assert.equal(expired.status, 410);
    assert.equal(expired.body.error.code, "UPLOAD_INTENT_EXPIRED");

    // Cupo: 12 pendientes como máximo (las caducadas no cuentan).
    await pool.query(`delete from support_upload_intents`);
    for (let i = 0; i < 12; i += 1) {
      assert.equal((await miguel.post("/v1/me/support/uploads/intents", { contentType: "image/jpeg", sizeBytes: 2048 })).status, 201);
    }
    const capped = await miguel.post("/v1/me/support/uploads/intents", { contentType: "image/jpeg", sizeBytes: 2048 });
    assert.equal(capped.status, 422);
    assert.equal(capped.body.error.code, "SUPPORT_ATTACHMENT_LIMIT");
    assert.equal((await laura.post("/v1/me/support/uploads/intents", { contentType: "image/jpeg", sizeBytes: 2048 })).status, 201, "el cupo es por persona");
  });

  it("adjuntar a una consulta: hasta 4, solo propias y sin reutilizar; descarga firmada solo para quien las subió", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push(await uploadImage(miguel, i % 2 ? JPEG_BYTES : PNG_BYTES, i % 2 ? "image/jpeg" : "image/png"));

    // Más de 4 en una sola consulta: se rechaza (el esquema ya limita a 4) y no se crea nada.
    const five = await miguel.post("/v1/me/support/tickets", { category: "trip_issue", body: "Cinco imágenes", attachmentIds: ids });
    assert.equal(five.status, 400);
    assert.equal((await pool.query(`select 1 from support_tickets`)).rowCount, 0);

    // Un adjunto ajeno o inexistente invalida toda la consulta (nada queda a medias).
    const lauraImage = await uploadImage(laura);
    const foreign = await miguel.post("/v1/me/support/tickets", { category: "trip_issue", body: "Con imagen ajena", attachmentIds: [ids[0], lauraImage] });
    assert.equal(foreign.status, 422);
    assert.equal(foreign.body.error.code, "SUPPORT_ATTACHMENT_INVALID");
    assert.equal((await miguel.post("/v1/me/support/tickets", { category: "trip_issue", body: "Con imagen inventada", attachmentIds: [uuid()] })).body.error.code, "SUPPORT_ATTACHMENT_INVALID");
    assert.equal((await pool.query(`select 1 from support_tickets`)).rowCount, 0);
    assert.equal((await pool.query(`select 1 from support_attachments where ticket_id is not null`)).rowCount, 0);

    const created = await miguel.post("/v1/me/support/tickets", {
      category: "trip_issue", body: "Foto del punto de recogida", attachmentIds: [ids[0], ids[1], ids[2], ids[3]]
    });
    assert.equal(created.status, 201, created.raw);
    assert.equal(created.body.attachmentCount, 4);
    assert.equal(created.body.messages[0].attachments.length, 4);
    expectKeys(created.body.messages[0].attachments[0], ATTACHMENT_KEYS);

    // Un adjunto ya enviado no se puede reutilizar en otra consulta.
    const reuse = await miguel.post("/v1/me/support/tickets", { category: "trip_issue", body: "Misma foto", attachmentIds: [ids[0]] });
    assert.equal(reuse.status, 422);
    assert.equal(reuse.body.error.code, "SUPPORT_ATTACHMENT_INVALID");

    // Respuesta con imagen.
    const reply = await miguel.post(`/v1/me/support/tickets/${created.body.id}/replies`, { body: "Y otra foto", attachmentIds: [ids[4]] });
    assert.equal(reply.status, 201, reply.raw);
    assert.equal(reply.body.attachmentCount, 5);
    assert.equal(reply.body.messages[1].attachments.length, 1);
    assert.equal(reply.body.messages[1].attachments[0].id, ids[4]);

    // Descarga: URL firmada de la clave privada, solo para la propietaria, y queda auditada.
    const download = await miguel.get(`/v1/me/support/attachments/${ids[0]}/download`);
    assert.equal(download.status, 200);
    expectKeys(download.body, ["url", "expiresAt"]);
    assert.match(download.body.url, /^https:\/\/download\.invalid\/users\/.+\/support\/.+\.png/);
    assert.equal((await laura.get(`/v1/me/support/attachments/${ids[0]}/download`)).status, 404);
    assert.equal((await pool.query(`select 1 from audit_events where action = 'support.attachment.downloaded' and actor_user_id = $1`, [world.miguel])).rowCount, 1);
    // Las claves de almacenamiento nunca viajan al cliente.
    assert.ok(!JSON.stringify(created.body).includes("users/"));
  });

  it("sin almacenamiento privado configurado: las imágenes dan 503 claro y la consulta sin imágenes sigue funcionando", async () => {
    const disabledApp = await buildCommsApp(pool, { privateStorage: new DisabledStorage() });
    const nullApp = await buildCommsApp(pool, { privateStorage: null });
    try {
      for (const target of [disabledApp, nullApp]) {
        const client = await clientFor(target, pool, world.miguel);
        const intent = await client.post("/v1/me/support/uploads/intents", { contentType: "image/png", sizeBytes: 1000 });
        assert.equal(intent.status, 503);
        assert.equal(intent.body.error.code, "PRIVATE_STORAGE_NOT_CONFIGURED");
        assert.equal((await client.post(`/v1/me/support/uploads/${uuid()}/complete`)).status, 503);
        const ticket = await client.post("/v1/me/support/tickets", { category: "account_profile", body: "No puedo adjuntar fotos" });
        assert.equal(ticket.status, 201);
      }
      assert.equal((await pool.query(`select 1 from support_upload_intents`)).rowCount, 0);
    } finally {
      await disabledApp.close();
      await nullApp.close();
    }
  });

  it("limpieza: las subidas abandonadas y los adjuntos nunca enviados se borran del almacenamiento; los enviados se conservan", async () => {
    const eraser = new FakeEraser(storage);
    const deps = { pool, config: loadCommsConfig({}), storage, eraser };

    const abandoned = await miguel.post("/v1/me/support/uploads/intents", { contentType: "image/png", sizeBytes: 100 });
    const abandonedKey = new URL(abandoned.body.uploadUrl).pathname.slice(1);
    storage.put(abandonedKey, PNG_BYTES, "image/png");
    const unlinked = await uploadImage(miguel);
    const linked = await uploadImage(miguel);
    await ticketOf(miguel, "Con una imagen", { attachmentIds: [linked] });
    const unlinkedKey = (await pool.query<{ storage_key: string }>(`select storage_key from support_attachments where id = $1`, [unlinked])).rows[0]!.storage_key;
    const linkedKey = (await pool.query<{ storage_key: string }>(`select storage_key from support_attachments where id = $1`, [linked])).rows[0]!.storage_key;

    // Hoy no hay nada que limpiar.
    assert.deepEqual(await cleanupSupportUploads(deps), { intents: 0, attachments: 0 });

    // Una subida caducada hace 2 h sigue dentro de la gracia de 24 h: todavía no se limpia.
    await pool.query(`update support_upload_intents set expires_at = now() - interval '2 hours' where id = $1`, [abandoned.body.intentId]);
    assert.deepEqual(await cleanupSupportUploads(deps), { intents: 0, attachments: 0 });
    await pool.query(`update support_upload_intents set expires_at = now() - interval '26 hours' where id = $1`, [abandoned.body.intentId]);
    await pool.query(`update support_attachments set created_at = now() - interval '8 days' where id = any($1::uuid[])`, [[unlinked, linked]]);
    const result = await cleanupSupportUploads(deps);
    assert.deepEqual(result, { intents: 1, attachments: 1 });
    assert.ok(eraser.deleted.includes(abandonedKey));
    assert.ok(eraser.deleted.includes(unlinkedKey));
    assert.ok(!eraser.deleted.includes(linkedKey), "la imagen enviada con una consulta no se toca");
    assert.ok(storage.objects.has(linkedKey));
    assert.equal((await pool.query(`select 1 from support_attachments where id = $1`, [unlinked])).rowCount, 0);
    assert.equal((await pool.query(`select 1 from support_attachments where id = $1`, [linked])).rowCount, 1);

    // Sin borrado de objetos disponible no se pierde el rastro de lo que hay que borrar.
    const noEraser = await miguel.post("/v1/me/support/uploads/intents", { contentType: "image/png", sizeBytes: 100 });
    await pool.query(`update support_upload_intents set expires_at = now() - interval '30 hours' where id = $1`, [noEraser.body.intentId]);
    assert.deepEqual(await cleanupSupportUploads({ ...deps, eraser: null }), { intents: 0, attachments: 0 });
    assert.equal((await pool.query(`select 1 from support_upload_intents where id = $1`, [noEraser.body.intentId])).rowCount, 1);
  });

  it("ajustes: valores por defecto, cambios parciales, validación y aislamiento entre personas", async () => {
    const initial = await miguel.get("/v1/me/settings");
    assert.equal(initial.status, 200);
    expectKeys(initial.body, ["shareLiveLocationInTrip", "fontScale", "language", "updatedAt", "account"]);
    expectKeys(initial.body.account, ["userId", "displayName", "photoUrl", "roles", "phoneE164", "pendingDeletion"]);
    assert.equal(initial.body.shareLiveLocationInTrip, true);
    assert.equal(initial.body.fontScale, "normal");
    assert.equal(initial.body.language, "es");
    assert.equal(initial.body.updatedAt, null);
    assert.equal(initial.body.account.userId, world.miguel);
    assert.equal(initial.body.account.displayName, "Miguel Torres");
    assert.equal(initial.body.account.phoneE164, "+34600333444");
    assert.deepEqual(initial.body.account.roles, ["passenger"]);
    assert.equal(initial.body.account.pendingDeletion, null);
    assert.equal((await ana.get("/v1/me/settings")).body.account.roles.includes("driver"), true);

    assert.equal(await getShareLiveLocationInTrip(pool, world.miguel), true);
    const changed = await miguel.patch("/v1/me/settings", { shareLiveLocationInTrip: false });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.shareLiveLocationInTrip, false);
    assert.equal(changed.body.fontScale, "normal", "un cambio parcial no toca lo demás");
    assert.ok(changed.body.updatedAt);
    assert.equal(await getShareLiveLocationInTrip(pool, world.miguel), false, "lo lee el módulo de viaje en vivo");
    assert.equal(await getShareLiveLocationInTrip(pool, world.laura), true, "no afecta a otras personas");
    const font = await miguel.patch("/v1/me/settings", { fontScale: "extra_large" });
    assert.equal(font.body.fontScale, "extra_large");
    assert.equal(font.body.shareLiveLocationInTrip, false);
    assert.equal((await miguel.get("/v1/me/settings")).body.fontScale, "extra_large");
    assert.equal((await laura.get("/v1/me/settings")).body.fontScale, "normal");
    assert.equal((await pool.query(`select 1 from audit_events where action = 'settings.updated' and actor_user_id = $1`, [world.miguel])).rowCount, 2);

    for (const body of [{}, { fontScale: "gigante" }, { language: "en" }, { shareLiveLocationInTrip: "sí" }]) {
      const response = await miguel.patch("/v1/me/settings", body);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.equal(response.body.error.code, "VALIDATION_ERROR");
    }
    assert.equal((await app.inject({ method: "GET", url: "/v1/me/settings" })).statusCode, 401);
  });
});
