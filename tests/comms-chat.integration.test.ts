import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { loadCommsConfig, type CommsConfig } from "../src/modules/comms/config.js";
import { getCallContact } from "../src/modules/comms/chat-messages.js";
import { toPublicUser } from "../src/modules/comms/common.js";
import {
  SEVILLA,
  blockUser,
  buildCommsApp,
  clientFor,
  createPool,
  daysAfter,
  hoursAfter,
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
 * Mensajes (pantallas 25 y 26): bandeja, chat de reserva, grupos de ruta, acuses, llamada, bloqueos y denuncias.
 * BD de pruebas propia: mvc_comms.
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const uuid = () => crypto.randomUUID();
const expectKeys = (value: unknown, expected: string[]) => assert.deepEqual(keysOf(value), [...expected].sort());

const SUMMARY_KEYS = [
  "id", "kind", "title", "subtitle", "peer", "memberCount", "myRole", "category", "provinceName", "tripId", "bookingId",
  "lastMessage", "unreadCount", "lastActivityAt"
];
const DETAIL_KEYS = [...SUMMARY_KEYS, "trip", "booking", "pickupPoint", "contribution", "routeLabel", "members"];
const MESSAGE_KEYS = ["id", "seq", "conversationId", "senderId", "senderName", "mine", "kind", "body", "location", "hidden", "receipt", "createdAt"];
const PUBLIC_USER_KEYS = ["id", "displayName", "firstName", "photoUrl", "ratingAverage", "ratingCount"];

describe("comms · mensajes", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let world: World;
  let carlos: string;
  let ana: Client;
  let miguel: Client;
  let laura: Client;
  let carlosClient: Client;
  let tripMon: string;
  let tripTue: string;
  let tripSingle: string;
  const bookings: { miguelMon: string; lauraMon: string; lauraTue: string; miguelSingle: string } = {
    miguelMon: "", lauraMon: "", lauraTue: "", miguelSingle: ""
  };

  before(async () => {
    pool = createPool();
    app = await buildCommsApp(pool);
  });

  after(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(pool);
    world = await seedWorld(pool);
    carlos = await seedUser(pool, "Carlos Ruiz", { phone: "+34600777888" });
    const soon = hoursAfter(new Date(), 30);
    tripMon = (await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, { kind: "recurring", category: "work", departureAt: soon })).tripId;
    tripTue = (await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, { kind: "recurring", category: "work", departureAt: daysAfter(soon, 1) })).tripId;
    tripSingle = (
      await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, {
        kind: "single", category: "university", departureAt: soon, stops: [SEVILLA.santaJusta, SEVILLA.universidad]
      })
    ).tripId;
    bookings.miguelMon = (await seedBooking(pool, tripMon, world.miguel)).bookingId!;
    bookings.lauraMon = (await seedBooking(pool, tripMon, world.laura)).bookingId!;
    bookings.lauraTue = (await seedBooking(pool, tripTue, world.laura)).bookingId!;
    bookings.miguelSingle = (await seedBooking(pool, tripSingle, world.miguel)).bookingId!;
    ana = await clientFor(app, pool, world.ana);
    miguel = await clientFor(app, pool, world.miguel);
    laura = await clientFor(app, pool, world.laura);
    carlosClient = await clientFor(app, pool, carlos);
  });

  async function inbox(client: Client, query = ""): Promise<any> {
    const response = await client.get(`/v1/conversations${query}`);
    assert.equal(response.status, 200, response.raw);
    return response.body;
  }

  async function directOf(client: Client, tripId: string): Promise<string> {
    const body = await inbox(client);
    const found = body.items.find((item: { kind: string; tripId: string }) => item.kind === "direct" && item.tripId === tripId);
    assert.ok(found, "conversación directa no encontrada");
    return found.id;
  }

  async function groupOf(client: Client): Promise<string> {
    const body = await inbox(client);
    const found = body.items.find((item: { kind: string }) => item.kind === "group");
    assert.ok(found, "grupo no encontrado");
    return found.id;
  }

  const say = (client: Client, conversationId: string, body: string, clientMessageId = uuid()) =>
    client.post(`/v1/conversations/${conversationId}/messages`, { clientMessageId, body });

  it("bandeja: conversaciones de reserva y grupo de ruta con las pestañas Todos · Mis reservas · Grupos y la forma exacta del contrato", async () => {
    const all = await inbox(miguel);
    expectKeys(all, ["items", "nextCursor", "unreadTotal"]);
    assert.equal(all.unreadTotal, 0);
    assert.equal(all.items.length, 3, "dos chats de reserva (ruta al trabajo y universidad) y el grupo de la ruta recurrente");
    for (const item of all.items) expectKeys(item, SUMMARY_KEYS);

    const direct = all.items.filter((item: { kind: string }) => item.kind === "direct");
    const group = all.items.find((item: { kind: string }) => item.kind === "group");
    assert.deepEqual(direct.map((item: { tripId: string }) => item.tripId).sort(), [tripMon, tripSingle].sort());
    for (const item of direct) {
      assert.equal(item.title, "Ana");
      assert.equal(item.myRole, "passenger");
      assert.equal(item.memberCount, null);
      assert.equal(item.lastMessage, null);
      expectKeys(item.peer, PUBLIC_USER_KEYS);
      assert.equal(item.peer.id, world.ana);
      assert.equal(item.peer.firstName, "Ana");
      assert.equal(item.peer.displayName, "Ana García López");
      assert.ok(item.bookingId);
    }
    assert.equal(group.title, "Ruta Sevilla · Trabajo");
    assert.equal(group.memberCount, 3, "Ana, Miguel y Laura");
    assert.equal(group.peer, null);
    assert.equal(group.bookingId, null);
    assert.equal(group.subtitle, null);
    assert.equal(group.category, "work");
    assert.equal(group.provinceName, "Sevilla");

    const bookingsTab = await inbox(miguel, "?filter=bookings");
    assert.deepEqual(bookingsTab.items.map((item: { kind: string }) => item.kind), ["direct", "direct"]);
    const groupsTab = await inbox(miguel, "?filter=groups");
    assert.equal(groupsTab.items.length, 1);
    assert.equal(groupsTab.items[0].kind, "group");
    assert.equal((await inbox(miguel, "?filter=all")).items.length, 3);

    // La conductora ve un chat por pasajero y reserva, más el grupo; el grupo cuenta a todas las personas.
    const anaInbox = await inbox(ana);
    assert.equal(anaInbox.items.filter((item: { kind: string }) => item.kind === "direct").length, 4);
    assert.equal(anaInbox.items.filter((item: { kind: string }) => item.kind === "group").length, 1);
    const anaDirect = anaInbox.items.find((item: { kind: string; peer: { id: string } | null }) => item.kind === "direct" && item.peer?.id === world.laura);
    assert.equal(anaDirect.myRole, "driver");

    // Quien no tiene reservas no ve nada.
    assert.deepEqual((await inbox(carlosClient)).items, []);

    const badFilter = await miguel.get("/v1/conversations?filter=archivados");
    assert.equal(badFilter.status, 400);
    assert.equal(badFilter.body.error.code, "VALIDATION_ERROR");
    assert.equal((await miguel.get("/v1/conversations?cursor=%25%25")).body.error.code, "INVALID_CURSOR");
  });

  it("cabecera del chat de reserva: viaje, reserva confirmada, punto de recogida y aporte «por definir» hasta que haya tarifa aprobada", async () => {
    const conversationId = await directOf(miguel, tripMon);
    const detail = await miguel.get(`/v1/conversations/${conversationId}`);
    assert.equal(detail.status, 200);
    expectKeys(detail.body, DETAIL_KEYS);
    assert.equal(detail.body.title, "Ana");
    assert.equal(detail.body.trip.id, tripMon);
    assert.equal(detail.body.trip.status, "published");
    assert.equal(detail.body.trip.originLabel, "Sevilla Centro");
    assert.equal(detail.body.trip.destinationLabel, "Aparcamiento P1 · Isla Mágica");
    assert.ok(detail.body.trip.departureAt);
    assert.ok(detail.body.trip.arrivalEstimateAt);
    assert.deepEqual(detail.body.booking, { id: bookings.miguelMon, status: "confirmed", seats: 1 });
    assert.equal(detail.body.pickupPoint.label, "Sevilla Centro");
    assert.ok(Math.abs(detail.body.pickupPoint.lat - SEVILLA.centro.lat) < 1e-6);
    assert.deepEqual(detail.body.contribution, { cents: null, currency: "EUR", status: "pending_definition" });
    assert.equal(detail.body.members, null);
    assert.equal(detail.body.routeLabel, null);

    // Con una tarifa APROBADA y una cotización de la solicitud, el aporte pasa a estar definido.
    const request = await pool.query<{ id: string }>(`select r.id from ride_requests r where r.trip_id = $1 and r.passenger_user_id = $2`, [tripMon, world.miguel]);
    const tariff = await pool.query<{ id: string }>(
      `insert into tariff_versions(version, status, rate_micros_per_km, passenger_commission_bps, driver_commission_bps, effective_from)
       values(1,'approved',100000,0,0,'2026-01-01T00:00:00Z') returning id`
    );
    await pool.query(
      `insert into quote_snapshots(request_id, tariff_version_id, road_distance_m, contribution_cents, passenger_commission_cents, passenger_total_cents, driver_net_cents)
       values($1,$2,12000,400,0,400,400)`,
      [request.rows[0]!.id, tariff.rows[0]!.id]
    );
    const priced = await miguel.get(`/v1/conversations/${conversationId}`);
    assert.deepEqual(priced.body.contribution, { cents: 400, currency: "EUR", status: "defined" });

    // Una tarifa retirada o en borrador no define el importe.
    await pool.query(`update tariff_versions set status = 'retired' where id = $1`, [tariff.rows[0]!.id]);
    assert.equal((await miguel.get(`/v1/conversations/${conversationId}`)).body.contribution.status, "pending_definition");

    // Cabecera del grupo: ruta y miembros actuales.
    const groupId = await groupOf(miguel);
    const group = await miguel.get(`/v1/conversations/${groupId}`);
    expectKeys(group.body, DETAIL_KEYS);
    assert.equal(group.body.routeLabel, "Sevilla Centro → Aparcamiento P1 · Isla Mágica");
    assert.equal(group.body.trip, null);
    assert.equal(group.body.contribution, null);
    assert.equal(group.body.members.length, 3);
    expectKeys(group.body.members[0], ["user", "role"]);
    assert.deepEqual(
      group.body.members.map((m: { role: string }) => m.role).sort(),
      ["driver", "passenger", "passenger"]
    );
  });

  it("valoración de la otra persona: media de un decimal en bandeja, cabecera y miembros del grupo (si existen las columnas de valoraciones); una persona eliminada no muestra ninguna", async t => {
    // Parte pura (siempre se ejecuta): quien está eliminado no expone valoración ni nombre.
    const deleted = toPublicUser(
      { user_id: world.ana, display_name: "Ana García López", public_photo_key: null, public_photo_status: null, user_status: "deleted", rating_sum: 49, rating_count: 10 },
      { publicMediaBaseUrl: null }
    );
    assert.equal(deleted.displayName, "Usuario eliminado");
    assert.equal(deleted.ratingAverage, null);
    assert.equal(deleted.ratingCount, 0);

    const columns = await pool.query<{ total: number }>(
      `select count(*)::int as total from information_schema.columns
        where table_schema = current_schema() and table_name = 'profiles' and column_name in ('rating_sum','rating_count')`
    );
    if (columns.rows[0]!.total !== 2) {
      return t.skip("esta base no tiene las columnas de valoraciones (migración 030 del módulo live): ratingAverage es null y ratingCount 0, comprobado en las demás pruebas");
    }

    const conversationId = await directOf(miguel, tripMon);
    const peerOf = async () => (await miguel.get(`/v1/conversations/${conversationId}`)).body.peer as { ratingAverage: number | null; ratingCount: number };
    assert.deepEqual(await peerOf().then(peer => [peer.ratingAverage, peer.ratingCount]), [null, 0], "sin valoraciones: null y 0");

    const setRating = async (sum: number, count: number) => {
      const updated = await pool.query(`update profiles set rating_sum = $2, rating_count = $3 where user_id = $1`, [world.ana, sum, count]);
      assert.equal(updated.rowCount, 1);
    };

    // 49 estrellas en 10 valoraciones = 4,9; bandeja, cabecera y grupo coinciden.
    await setRating(49, 10);
    assert.deepEqual(await peerOf().then(peer => [peer.ratingAverage, peer.ratingCount]), [4.9, 10]);
    const listed = (await inbox(miguel)).items.find((item: { kind: string; tripId: string }) => item.kind === "direct" && item.tripId === tripMon);
    assert.deepEqual([listed.peer.ratingAverage, listed.peer.ratingCount], [4.9, 10]);
    const group = await miguel.get(`/v1/conversations/${await groupOf(miguel)}`);
    const anaInGroup = group.body.members.find((member: { user: { id: string } }) => member.user.id === world.ana);
    assert.deepEqual([anaInGroup.user.ratingAverage, anaInGroup.user.ratingCount], [4.9, 10]);

    // Redondeo a un decimal, con la misma aritmética que live y trips: 22/7 = 3,142… → 3,1 · 13/3 = 4,333… → 4,3 · 29/6 = 4,833… → 4,8.
    for (const [sum, count, expected] of [[22, 7, 3.1], [13, 3, 4.3], [29, 6, 4.8], [5, 1, 5]] as const) {
      await setRating(sum, count);
      assert.equal((await peerOf()).ratingAverage, expected, `${sum}/${count}`);
    }
  });

  it("enviar, recibir y acuses: ✓ enviado → ✓✓ entregado → leído; el contador de la bandeja y el aviso «nuevo mensaje» se coalescen", async () => {
    const forMiguel = await directOf(miguel, tripMon);
    const first = await say(ana, forMiguel, "Hola Miguel, salgo a las 07:25 de Sevilla Centro");
    assert.equal(first.status, 201, first.raw);
    expectKeys(first.body, MESSAGE_KEYS);
    assert.equal(first.body.mine, true);
    assert.equal(first.body.kind, "text");
    assert.equal(first.body.senderName, "Ana García López");
    assert.deepEqual(first.body.receipt, { state: "sent", recipientCount: 1, deliveredCount: 0, readCount: 0 });
    assert.equal(first.body.location, null);
    assert.equal(first.body.hidden, false);
    await sleep(5);
    const second = await say(ana, forMiguel, "Te espero en el aparcamiento P1");
    assert.equal(second.status, 201);
    assert.ok(second.body.seq > first.body.seq);

    // Miguel: contador y vista previa en la bandeja (no leído).
    const miguelInbox = await inbox(miguel);
    assert.equal(miguelInbox.unreadTotal, 2);
    const row = miguelInbox.items.find((item: { id: string }) => item.id === forMiguel);
    assert.equal(row.unreadCount, 2);
    assert.equal(row.lastMessage.preview, "Te espero en el aparcamiento P1");
    assert.equal(row.lastMessage.mine, false);
    assert.equal(row.lastMessage.senderId, world.ana);
    assert.deepEqual((await miguel.get("/v1/conversations/unread-count")).body, { total: 2, direct: 2, groups: 0, conversationsWithUnread: 1 });

    // Un solo aviso sin leer por conversación, con contador.
    const notices = await pool.query<{ title: string; data: { count: number; conversationId: string } }>(
      `select title, data from notifications where user_id = $1 and kind = 'chat_message'`, [world.miguel]
    );
    assert.equal(notices.rowCount, 1);
    assert.equal(notices.rows[0]!.data.count, 2);
    assert.equal(notices.rows[0]!.data.conversationId, forMiguel);
    assert.match(notices.rows[0]!.title, /2 mensajes nuevos de Ana/);

    // Al abrir la bandeja los mensajes pasan a «entregado» para Ana.
    let anaView = await ana.get(`/v1/conversations/${forMiguel}/messages`);
    assert.deepEqual(anaView.body.items[0].receipt, { state: "delivered", recipientCount: 1, deliveredCount: 1, readCount: 0 });

    // Miguel abre el chat: orden cronológico ascendente, sin receipt en los ajenos.
    const opened = await miguel.get(`/v1/conversations/${forMiguel}/messages`);
    assert.equal(opened.status, 200);
    expectKeys(opened.body, ["items", "nextCursor", "lastReadSeq"]);
    assert.deepEqual(opened.body.items.map((m: { body: string }) => m.body), ["Hola Miguel, salgo a las 07:25 de Sevilla Centro", "Te espero en el aparcamiento P1"]);
    assert.equal(opened.body.items[0].receipt, null);
    assert.equal(opened.body.items[0].mine, false);
    assert.equal(opened.body.lastReadSeq, 0);

    // Marcar leído: contador a cero, puntero y aviso leído; Ana ve ✓✓ azul.
    const read = await miguel.post(`/v1/conversations/${forMiguel}/read`);
    assert.equal(read.status, 200, read.raw);
    assert.deepEqual(read.body, { conversationId: forMiguel, lastReadSeq: second.body.seq, unreadCount: 0 });
    assert.equal((await inbox(miguel)).unreadTotal, 0);
    assert.equal((await pool.query(`select 1 from notifications where user_id = $1 and kind = 'chat_message' and read_at is null`, [world.miguel])).rowCount, 0);
    anaView = await ana.get(`/v1/conversations/${forMiguel}/messages`);
    assert.ok(anaView.body.items.every((m: { receipt: { state: string } }) => m.receipt.state === "read"));

    // El puntero nunca retrocede ni se adelanta a lo recibido.
    const backwards = await miguel.post(`/v1/conversations/${forMiguel}/read`, { upToSeq: 0 });
    assert.equal(backwards.body.lastReadSeq, second.body.seq);
    const ahead = await miguel.post(`/v1/conversations/${forMiguel}/read`, { upToSeq: 999_999 });
    assert.equal(ahead.body.lastReadSeq, second.body.seq);

    // Contestar: ahora Ana tiene un mensaje sin leer.
    await sleep(5);
    await say(miguel, forMiguel, "Perfecto, ya estoy llegando");
    assert.equal((await inbox(ana)).unreadTotal, 1);
  });

  it("el sondeo de la insignia (unread-count) cuenta chats directos y grupos, marca como entregado sin abrir la bandeja y coincide con ella", async () => {
    // Las ids las obtiene Ana (la remitente): así ni Miguel ni Laura han abierto todavía su bandeja.
    const anaInbox = await inbox(ana);
    const toMiguel = anaInbox.items.find((c: { kind: string; tripId: string; peer: { id: string } | null }) => c.kind === "direct" && c.tripId === tripMon && c.peer?.id === world.miguel).id;
    const group = anaInbox.items.find((c: { kind: string }) => c.kind === "group").id;
    assert.equal((await say(ana, toMiguel, "Salgo a las 07:25")).status, 201);
    assert.equal((await say(ana, toMiguel, "Nos vemos en el aparcamiento P1")).status, 201);
    assert.equal((await say(ana, group, "Aviso para toda la ruta: hoy salimos 5 minutos antes")).status, 201);

    const receiptsOf = async (conversationId: string) =>
      (await ana.get(`/v1/conversations/${conversationId}/messages`)).body.items.map((m: { receipt: { state: string; recipientCount: number; deliveredCount: number } }) => [
        m.receipt.state, m.receipt.recipientCount, m.receipt.deliveredCount
      ]);
    assert.deepEqual(await receiptsOf(toMiguel), [["sent", 1, 0], ["sent", 1, 0]]);
    assert.deepEqual(await receiptsOf(group), [["sent", 2, 0]]);

    // Miguel solo consulta el contador: 2 directos + 1 de grupo, en 2 conversaciones.
    const counters = await miguel.get("/v1/conversations/unread-count");
    assert.equal(counters.status, 200);
    expectKeys(counters.body, ["total", "direct", "groups", "conversationsWithUnread"]);
    assert.deepEqual(counters.body, { total: 3, direct: 2, groups: 1, conversationsWithUnread: 2 });
    assert.deepEqual(await receiptsOf(toMiguel), [["delivered", 1, 1], ["delivered", 1, 1]], "el directo ya está entregado");
    assert.deepEqual(await receiptsOf(group), [["sent", 2, 1]], "en el grupo falta Laura: un acuse parcial no marca «entregado»");

    // Laura consulta el suyo (solo ve el grupo) y completa la entrega del grupo.
    assert.deepEqual((await laura.get("/v1/conversations/unread-count")).body, { total: 1, direct: 0, groups: 1, conversationsWithUnread: 1 });
    assert.deepEqual(await receiptsOf(group), [["delivered", 2, 2]]);

    // Coincide con lo que dice la bandeja completa.
    assert.equal((await inbox(miguel)).unreadTotal, 3);
    assert.equal((await inbox(laura)).unreadTotal, 1);

    // Lo retirado por moderación deja de contar; quien no tiene mensajes nuevos ve ceros.
    await pool.query(`update trip_direct_messages set hidden_at = now() where body = 'Salgo a las 07:25'`);
    assert.deepEqual((await miguel.get("/v1/conversations/unread-count")).body, { total: 2, direct: 1, groups: 1, conversationsWithUnread: 2 });
    assert.deepEqual((await ana.get("/v1/conversations/unread-count")).body, { total: 0, direct: 0, groups: 0, conversationsWithUnread: 0 });
    assert.deepEqual((await carlosClient.get("/v1/conversations/unread-count")).body, { total: 0, direct: 0, groups: 0, conversationsWithUnread: 0 });

    // Tras marcar leído el chat directo, solo queda el grupo.
    assert.equal((await miguel.post(`/v1/conversations/${toMiguel}/read`)).status, 200);
    assert.deepEqual((await miguel.get("/v1/conversations/unread-count")).body, { total: 1, direct: 0, groups: 1, conversationsWithUnread: 1 });
  });

  it("autorización: nadie lee, escribe, marca, llama ni denuncia en un chat que no es suyo (404) y no se crea nada", async () => {
    const miguelChat = await directOf(miguel, tripMon);
    const seeded = await say(ana, miguelChat, "Mensaje privado entre Ana y Miguel");
    const before = await pool.query(`select count(*)::int as n from trip_direct_messages`);

    for (const outsider of [laura, carlosClient]) {
      assert.equal((await outsider.get(`/v1/conversations/${miguelChat}`)).status, 404);
      const read = await outsider.get(`/v1/conversations/${miguelChat}/messages`);
      assert.equal(read.status, 404);
      assert.equal(read.body.error.code, "CONVERSATION_NOT_FOUND");
      assert.ok(!read.raw.includes("Mensaje privado"));
      assert.equal((await say(outsider, miguelChat, "me cuelo")).status, 404);
      assert.equal((await outsider.post(`/v1/conversations/${miguelChat}/read`)).status, 404);
      assert.equal((await outsider.get(`/v1/conversations/${miguelChat}/call-contact`)).status, 404);
      const report = await outsider.post(`/v1/conversations/${miguelChat}/messages/${seeded.body.id}/report`, { reason: "harassment" });
      assert.equal(report.status, 404);
      assert.equal(report.body.error.code, "MESSAGE_NOT_FOUND");
    }
    assert.equal((await pool.query(`select count(*)::int as n from trip_direct_messages`)).rows[0].n, before.rows[0].n);
    assert.equal((await pool.query(`select count(*)::int as n from user_reports`)).rows[0].n, 0);

    // Tampoco aparece en su bandeja, y un id inventado o mal formado se comporta igual.
    assert.ok(!(await inbox(carlosClient)).items.some((item: { id: string }) => item.id === miguelChat));
    assert.equal((await miguel.get(`/v1/conversations/${uuid()}`)).status, 404);
    assert.equal((await miguel.get(`/v1/conversations/no-es-uuid`)).status, 400);
    assert.equal((await app.inject({ method: "GET", url: `/v1/conversations/${miguelChat}/messages` })).statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: `/v1/conversations` })).statusCode, 401);
  });

  it("abrir el chat de una reserva: solo conductor y pasajero con reserva confirmada, sin bloqueos; es idempotente", async () => {
    const created = await ana.post("/v1/conversations/direct", { tripId: tripSingle, peerUserId: world.miguel });
    assert.equal(created.status, 201, created.raw);
    expectKeys(created.body, DETAIL_KEYS);
    assert.equal(created.body.myRole, "driver");
    assert.equal(created.body.peer.id, world.miguel);
    const again = await miguel.post("/v1/conversations/direct", { tripId: tripSingle, peerUserId: world.ana });
    assert.equal(again.status, 200);
    assert.equal(again.body.id, created.body.id);
    assert.equal(again.body.myRole, "passenger");

    const noBooking = await laura.post("/v1/conversations/direct", { tripId: tripSingle, peerUserId: world.ana });
    assert.equal(noBooking.status, 403);
    assert.equal(noBooking.body.error.code, "CHAT_FORBIDDEN");
    const strangers = await carlosClient.post("/v1/conversations/direct", { tripId: tripSingle, peerUserId: world.miguel });
    assert.equal(strangers.status, 403);
    const self = await miguel.post("/v1/conversations/direct", { tripId: tripSingle, peerUserId: world.miguel });
    assert.equal(self.status, 400);
    assert.equal(self.body.error.code, "CHAT_SELF_FORBIDDEN");
    const noTrip = await miguel.post("/v1/conversations/direct", { tripId: uuid(), peerUserId: world.ana });
    assert.equal(noTrip.status, 404);
    assert.equal(noTrip.body.error.code, "TRIP_NOT_FOUND");
    const twoPassengers = await miguel.post("/v1/conversations/direct", { tripId: tripMon, peerUserId: world.laura });
    assert.equal(twoPassengers.status, 403, "dos pasajeros no pueden abrir un chat directo entre ellos");

    await blockUser(pool, world.ana, world.miguel);
    const blocked = await miguel.post("/v1/conversations/direct", { tripId: tripMon, peerUserId: world.ana });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, "CHAT_BLOCKED");
  });

  it("idempotencia y validación al enviar: mismo clientMessageId = mismo mensaje, otro contenido = 409; ubicaciones y límites", async () => {
    const chat = await directOf(miguel, tripMon);
    const id = uuid();
    const sent = await say(miguel, chat, "Voy en la puerta principal", id);
    assert.equal(sent.status, 201);
    const retry = await say(miguel, chat, "Voy en la puerta principal", id);
    assert.equal(retry.status, 200, "un reintento no crea otro mensaje");
    assert.equal(retry.body.id, sent.body.id);
    assert.equal(retry.body.seq, sent.body.seq);
    const conflict = await say(miguel, chat, "Otro texto distinto", id);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, "CHAT_IDEMPOTENCY_CONFLICT");
    assert.equal((await pool.query(`select count(*)::int as n from trip_direct_messages where sender_user_id = $1`, [world.miguel])).rows[0].n, 1);
    assert.equal((await pool.query(`select count(*)::int as n from notifications where user_id = $1 and kind = 'chat_message'`, [world.ana])).rows[0].n, 1);

    // Ubicación (tarjeta del chat): se guarda con su etiqueta; sin etiqueta usa el texto genérico.
    const location = await miguel.post(`/v1/conversations/${chat}/messages`, {
      clientMessageId: uuid(),
      kind: "location",
      location: { lat: 37.4126, lng: -6.0033, label: "Aparcamiento P1 · Isla Mágica" }
    });
    assert.equal(location.status, 201, location.raw);
    assert.equal(location.body.kind, "location");
    assert.deepEqual(location.body.location, { lat: 37.4126, lng: -6.0033, label: "Aparcamiento P1 · Isla Mágica" });
    assert.equal(location.body.body, "Aparcamiento P1 · Isla Mágica");
    assert.equal((await inbox(ana)).items.find((item: { id: string }) => item.id === chat).lastMessage.preview, "Ubicación: Aparcamiento P1 · Isla Mágica");
    const bareLocation = await miguel.post(`/v1/conversations/${chat}/messages`, { clientMessageId: uuid(), kind: "location", location: { lat: 37.39, lng: -5.98 } });
    assert.equal(bareLocation.status, 201);
    assert.equal(bareLocation.body.location.label, null);
    assert.equal(bareLocation.body.body, "Ubicación compartida");
    const anaPreview = (await inbox(ana)).items.find((item: { id: string }) => item.id === chat);
    assert.equal(anaPreview.lastMessage.preview, "Ubicación compartida");
    assert.equal(anaPreview.lastMessage.kind, "location");

    // Inválidos.
    const empty = await say(miguel, chat, "");
    assert.equal(empty.status, 422);
    assert.equal(empty.body.error.code, "INVALID_CHAT_MESSAGE");
    assert.equal((await say(miguel, chat, "    \n  ")).status, 422);
    assert.equal((await say(miguel, chat, "a".repeat(2001))).body.error.code, "INVALID_CHAT_MESSAGE");
    assert.equal((await say(miguel, chat, "hola\u0000mundo")).status, 422);
    const maxOk = await say(miguel, chat, "b".repeat(2000));
    assert.equal(maxOk.status, 201, "2000 caracteres es el máximo permitido");
    const badLat = await miguel.post(`/v1/conversations/${chat}/messages`, { clientMessageId: uuid(), kind: "location", location: { lat: 91, lng: 0 } });
    assert.equal(badLat.status, 422);
    assert.equal(badLat.body.error.code, "INVALID_LOCATION");
    const noLocation = await miguel.post(`/v1/conversations/${chat}/messages`, { clientMessageId: uuid(), kind: "location" });
    assert.equal(noLocation.status, 422);
    const textWithLocation = await miguel.post(`/v1/conversations/${chat}/messages`, { clientMessageId: uuid(), body: "hola", location: { lat: 37, lng: -5 } });
    assert.equal(textWithLocation.status, 422);
    // Notas de voz e imágenes no existen: el tipo se rechaza en la validación.
    const voice = await miguel.post(`/v1/conversations/${chat}/messages`, { clientMessageId: uuid(), kind: "voice", body: "x" });
    assert.equal(voice.status, 400);
    assert.equal(voice.body.error.code, "VALIDATION_ERROR");
    assert.equal((await miguel.post(`/v1/conversations/${chat}/messages`, { body: "sin id" })).status, 400);
    assert.equal((await miguel.post(`/v1/conversations/${chat}/messages`, { clientMessageId: "no-uuid", body: "x" })).status, 400);
  });

  it("paginación de mensajes hacia atrás con cursor, sondeo con afterSeq y mensajes retirados por moderación", async () => {
    const chat = await directOf(miguel, tripMon);
    const ids: string[] = [];
    for (let i = 1; i <= 7; i += 1) {
      const sent = await say(i % 2 ? ana : miguel, chat, `Mensaje ${i}`);
      ids.push(sent.body.id);
    }
    const firstPage = await miguel.get(`/v1/conversations/${chat}/messages?limit=3`);
    assert.deepEqual(firstPage.body.items.map((m: { body: string }) => m.body), ["Mensaje 5", "Mensaje 6", "Mensaje 7"]);
    assert.ok(firstPage.body.nextCursor);
    const secondPage = await miguel.get(`/v1/conversations/${chat}/messages?limit=3&cursor=${encodeURIComponent(firstPage.body.nextCursor)}`);
    assert.deepEqual(secondPage.body.items.map((m: { body: string }) => m.body), ["Mensaje 2", "Mensaje 3", "Mensaje 4"]);
    const lastPage = await miguel.get(`/v1/conversations/${chat}/messages?limit=3&cursor=${encodeURIComponent(secondPage.body.nextCursor)}`);
    assert.deepEqual(lastPage.body.items.map((m: { body: string }) => m.body), ["Mensaje 1"]);
    assert.equal(lastPage.body.nextCursor, null);

    const seq4 = secondPage.body.items[2].seq;
    const polled = await miguel.get(`/v1/conversations/${chat}/messages?afterSeq=${seq4}`);
    assert.deepEqual(polled.body.items.map((m: { body: string }) => m.body), ["Mensaje 5", "Mensaje 6", "Mensaje 7"]);
    assert.equal(polled.body.nextCursor, null);
    const both = await miguel.get(`/v1/conversations/${chat}/messages?afterSeq=1&cursor=${encodeURIComponent(firstPage.body.nextCursor)}`);
    assert.equal(both.status, 400);
    assert.equal(both.body.error.code, "VALIDATION_ERROR");
    assert.equal((await miguel.get(`/v1/conversations/${chat}/messages?cursor=basura`)).body.error.code, "INVALID_CURSOR");

    // Moderación: un mensaje retirado deja de mostrar su contenido y no cuenta como no leído.
    const unreadBefore = (await inbox(miguel)).unreadTotal;
    assert.equal(unreadBefore, 4);
    await pool.query(`update trip_direct_messages set hidden_at = now(), hidden_reason = 'acoso' where id = $1`, [ids[6]]);
    const view = await miguel.get(`/v1/conversations/${chat}/messages?limit=1`);
    assert.equal(view.body.items[0].hidden, true);
    assert.equal(view.body.items[0].body, null);
    assert.ok(!view.raw.includes("Mensaje 7"));
    assert.equal((await inbox(miguel)).unreadTotal, 3);
    const last = (await inbox(miguel)).items.find((item: { id: string }) => item.id === chat);
    assert.equal(last.lastMessage.preview, "Mensaje retirado");
  });

  it("grupo de ruta: solo participantes, vista desde la primera reserva, acuses por miembro y filtros de bloqueo entre pasajeros", async () => {
    const miguelGroup = await groupOf(miguel);
    const lauraGroup = await groupOf(laura);
    const anaGroup = await groupOf(ana);
    assert.equal(miguelGroup, lauraGroup);
    assert.equal(miguelGroup, anaGroup);

    const hello = await say(miguel, miguelGroup, "Buenos días, ¿quedamos en Sevilla Centro?");
    assert.equal(hello.status, 201, hello.raw);
    assert.deepEqual(hello.body.receipt, { state: "sent", recipientCount: 2, deliveredCount: 0, readCount: 0 });
    // Bandeja del grupo: prefijo con el nombre.
    await sleep(5);
    const anaReply = await say(ana, miguelGroup, "Sí, a las 07:25");
    const lauraRow = (await inbox(laura)).items.find((item: { id: string }) => item.id === lauraGroup);
    assert.equal(lauraRow.unreadCount, 2);
    assert.equal(lauraRow.lastMessage.preview, "Ana: Sí, a las 07:25");
    assert.equal((await inbox(ana)).items.find((item: { id: string }) => item.id === anaGroup).lastMessage.preview, "Tú: Sí, a las 07:25");
    assert.deepEqual((await laura.get("/v1/conversations/unread-count")).body, { total: 2, direct: 0, groups: 2, conversationsWithUnread: 1 });

    // Acuse por miembro: Ana lo lee, Laura aún no → ni «entregado» ni «leído» del todo.
    await ana.post(`/v1/conversations/${anaGroup}/read`);
    let mine = await miguel.get(`/v1/conversations/${miguelGroup}/messages`);
    // Laura y Ana abrieron la bandeja (entregado a las dos), pero solo Ana lo ha leído.
    assert.deepEqual(mine.body.items[0].receipt, { state: "delivered", recipientCount: 2, deliveredCount: 2, readCount: 1 });
    await laura.post(`/v1/conversations/${lauraGroup}/read`);
    mine = await miguel.get(`/v1/conversations/${miguelGroup}/messages`);
    assert.deepEqual(mine.body.items[0].receipt, { state: "read", recipientCount: 2, deliveredCount: 2, readCount: 2 });
    assert.equal(mine.body.items[1].receipt, null, "el mensaje de Ana no es mío");

    // Quien no está en la ruta no puede ni verlo ni escribir ni leerlo.
    for (const path of ["", "/messages"]) {
      const response = await carlosClient.get(`/v1/conversations/${miguelGroup}${path}`);
      assert.equal(response.status, 404, path);
    }
    assert.equal((await say(carlosClient, miguelGroup, "intruso")).status, 404);
    assert.equal((await carlosClient.get(`/v1/conversations/${miguelGroup}/call-contact`)).status, 404);

    // Llamar no existe en grupos.
    const call = await miguel.get(`/v1/conversations/${miguelGroup}/call-contact`);
    assert.equal(call.status, 400);
    assert.equal(call.body.error.code, "CALL_NOT_SUPPORTED_FOR_GROUPS");

    // Una pasajera que reserva DESPUÉS solo ve lo posterior a su primera reserva.
    await sleep(30);
    const sofia = await seedUser(pool, "Sofía Navarro", { phone: "+34600999000" });
    await seedBooking(pool, tripTue, sofia);
    await sleep(30);
    await say(ana, miguelGroup, "Bienvenida, Sofía");
    const sofiaClient = await clientFor(app, pool, sofia);
    const sofiaGroup = await groupOf(sofiaClient);
    assert.equal(sofiaGroup, miguelGroup);
    const sofiaMessages = await sofiaClient.get(`/v1/conversations/${sofiaGroup}/messages`);
    assert.deepEqual(sofiaMessages.body.items.map((m: { body: string }) => m.body), ["Bienvenida, Sofía"]);
    assert.equal((await sofiaClient.get(`/v1/conversations/${sofiaGroup}`)).body.members.length, 4);

    // Bloqueo entre dos pasajeros: siguen en el grupo pero no ven los mensajes del otro.
    await say(laura, lauraGroup, "Mensaje de Laura previo al bloqueo");
    const noticeBefore = await pool.query<{ count: string }>(
      `select data->>'count' as count from notifications where user_id = $1 and kind = 'chat_message' and read_at is null`, [world.laura]
    );
    await blockUser(pool, world.laura, world.miguel);
    await say(miguel, miguelGroup, "Mensaje de Miguel posterior al bloqueo");
    const lauraSees = await laura.get(`/v1/conversations/${lauraGroup}/messages`);
    assert.ok(!lauraSees.body.items.some((m: { senderId: string }) => m.senderId === world.miguel), "Laura no ve nada de Miguel");
    assert.ok(lauraSees.body.items.some((m: { senderId: string }) => m.senderId === world.ana));
    const miguelSees = await miguel.get(`/v1/conversations/${miguelGroup}/messages`);
    assert.ok(miguelSees.body.items.some((m: { senderId: string }) => m.senderId === world.miguel));
    assert.ok(!miguelSees.body.items.some((m: { senderId: string }) => m.senderId === world.laura));
    assert.equal((await laura.get(`/v1/conversations/${lauraGroup}`)).status, 200, "sigue siendo miembro");
    // Y Laura no recibe aviso de lo que dice Miguel: el contador del aviso no sube.
    const noticeAfter = await pool.query<{ count: string }>(
      `select data->>'count' as count from notifications where user_id = $1 and kind = 'chat_message' and read_at is null`, [world.laura]
    );
    assert.deepEqual(noticeAfter.rows, noticeBefore.rows);
    void anaReply;
  });

  it("salir del grupo y del chat: reserva cancelada o bloqueo por la conductora retiran el acceso (403) sin borrar el historial de los demás", async () => {
    const miguelGroup = await groupOf(miguel);
    const lauraGroup = await groupOf(laura);
    const lauraChat = await directOf(laura, tripMon);
    await say(laura, lauraGroup, "Yo también voy mañana");
    await say(miguel, miguelGroup, "Genial");
    await say(laura, lauraChat, "Hola Ana, ¿dónde recoges?");

    // Laura cancela sus dos reservas de la ruta.
    await pool.query(`update bookings set status = 'cancelled' where id = any($1::uuid[])`, [[bookings.lauraMon, bookings.lauraTue]]);
    const groupRead = await laura.get(`/v1/conversations/${lauraGroup}/messages`);
    assert.equal(groupRead.status, 403);
    assert.equal(groupRead.body.error.code, "CHAT_FORBIDDEN");
    assert.equal((await say(laura, lauraGroup, "¿sigo aquí?")).status, 403);
    assert.equal((await laura.post(`/v1/conversations/${lauraGroup}/read`)).status, 403);
    const directRead = await laura.get(`/v1/conversations/${lauraChat}`);
    assert.equal(directRead.status, 403);
    assert.equal(directRead.body.error.code, "CHAT_FORBIDDEN");
    assert.equal((await say(ana, lauraChat, "¿Sigues ahí?")).status, 403, "la conductora tampoco puede escribir en un chat sin reserva vigente");
    const lauraInbox = await inbox(laura);
    assert.ok(!lauraInbox.items.some((item: { id: string }) => item.id === lauraGroup || item.id === lauraChat), "ya no aparecen en su bandeja");
    // El grupo sigue vivo para los demás, con una persona menos.
    const miguelDetail = await miguel.get(`/v1/conversations/${miguelGroup}`);
    assert.equal(miguelDetail.body.memberCount, 2);
    assert.ok(!miguelDetail.body.members.some((m: { user: { id: string } }) => m.user.id === world.laura));
    const history = await miguel.get(`/v1/conversations/${miguelGroup}/messages`);
    assert.ok(history.body.items.some((m: { body: string }) => m.body === "Yo también voy mañana"), "el historial no se borra");

    // La conductora bloquea a Miguel: pierde el chat y el grupo con CHAT_BLOCKED.
    const miguelChat = await directOf(miguel, tripMon);
    await blockUser(pool, world.ana, world.miguel);
    for (const id of [miguelChat, miguelGroup]) {
      const response = await miguel.get(`/v1/conversations/${id}/messages`);
      assert.equal(response.status, 403, id);
      assert.equal(response.body.error.code, "CHAT_BLOCKED");
    }
    assert.equal((await say(miguel, miguelChat, "hola")).body.error.code, "CHAT_BLOCKED");
    assert.deepEqual((await inbox(miguel)).items, [], "con la conductora bloqueada no queda ninguna conversación");
    // Un grupo sin pasajeros desaparece también para la conductora.
    await blockUser(pool, world.ana, world.laura);
    await pool.query(`update bookings set status = 'cancelled' where id = $1`, [bookings.miguelMon]);
    assert.ok(!(await inbox(ana)).items.some((item: { kind: string }) => item.kind === "group"));
  });

  it("llamar a Ana: el teléfono solo se entrega dentro de la ventana del viaje, auditado, y nunca en otras respuestas", async () => {
    const chat = await directOf(miguel, tripMon);
    const config = loadCommsConfig({});

    // Viaje dentro de ~30 h: con la ventana por defecto (12 h antes) todavía no.
    const early = await miguel.get(`/v1/conversations/${chat}/call-contact`);
    assert.equal(early.status, 200);
    expectKeys(early.body, ["available", "reason", "peerFirstName", "phoneE164", "availableFrom", "availableUntil"]);
    assert.equal(early.body.available, false);
    assert.equal(early.body.reason, "OUTSIDE_TRIP_WINDOW");
    assert.equal(early.body.phoneE164, null);
    assert.equal(early.body.peerFirstName, "Ana");
    assert.ok(early.body.availableFrom && early.body.availableUntil);

    // Salida en 2 horas → dentro de ventana.
    await pool.query(`update trips set departure_at = now() + interval '2 hours' where id = $1`, [tripMon]);
    const inside = await miguel.get(`/v1/conversations/${chat}/call-contact`);
    assert.equal(inside.body.available, true);
    assert.equal(inside.body.reason, null);
    assert.equal(inside.body.phoneE164, "+34600111222");
    const reveal = await pool.query(`select actor_user_id, metadata from audit_events where action = 'chat.peer_call.contact_revealed'`);
    assert.equal(reveal.rowCount, 1);
    assert.equal(reveal.rows[0].actor_user_id, world.miguel);
    // Ana ve el teléfono de Miguel (la otra parte); Laura, que no es parte de este chat, no puede ni consultarlo.
    const fromAna = await ana.get(`/v1/conversations/${chat}/call-contact`);
    assert.equal(fromAna.body.phoneE164, "+34600333444");
    assert.equal(fromAna.body.peerFirstName, "Miguel");
    assert.equal((await laura.get(`/v1/conversations/${chat}/call-contact`)).status, 404);

    // El teléfono no viaja en ninguna otra respuesta del módulo.
    const everything = [
      (await miguel.get(`/v1/conversations/${chat}`)).raw,
      (await miguel.get("/v1/conversations")).raw,
      (await miguel.get(`/v1/conversations/${chat}/messages`)).raw,
      (await miguel.get("/v1/notifications")).raw,
      (await miguel.get(`/v1/conversations/${await groupOf(miguel)}`)).raw
    ].join("\n");
    assert.ok(!everything.includes("+34600111222"), "el teléfono de Ana no debe filtrarse fuera de call-contact");

    // Después del viaje (completado hace 5 h, ventana de 3 h) → fuera de ventana.
    await pool.query(`update trips set status = 'completed', departure_at = now() - interval '7 hours', started_at = now() - interval '7 hours', completed_at = now() - interval '5 hours' where id = $1`, [tripMon]);
    await pool.query(`update bookings set status = 'completed' where id = $1`, [bookings.miguelMon]);
    const late = await miguel.get(`/v1/conversations/${chat}/call-contact`);
    assert.equal(late.body.available, false);
    assert.equal(late.body.reason, "OUTSIDE_TRIP_WINDOW");

    // Desactivado por configuración y con la otra persona sin teléfono activo.
    await pool.query(`update trips set status = 'active', departure_at = now() - interval '10 minutes', completed_at = null where id = $1`, [tripMon]);
    await pool.query(`update bookings set status = 'confirmed' where id = $1`, [bookings.miguelMon]);
    const disabledConfig: CommsConfig = { ...config, peerCallEnabled: false };
    const disabled = await getCallContact(pool, world.miguel, chat, disabledConfig);
    assert.equal(disabled.available, false);
    assert.equal(disabled.reason, "PEER_CALL_DISABLED");
    assert.equal(disabled.phoneE164, null);
    await pool.query(`update app_users set phone_e164 = null where id = $1`, [world.ana]);
    const noPhone = await miguel.get(`/v1/conversations/${chat}/call-contact`);
    assert.equal(noPhone.body.available, false);
    assert.equal(noPhone.body.reason, "PEER_UNAVAILABLE");
    await pool.query(`update app_users set phone_e164 = '+34600111222', status = 'suspended' where id = $1`, [world.ana]);
    assert.equal((await miguel.get(`/v1/conversations/${chat}/call-contact`)).body.reason, "PEER_UNAVAILABLE");
  });

  it("búsqueda en la bandeja por nombre, ruta y texto de los mensajes (sin mensajes retirados ni de personas bloqueadas)", async () => {
    const chat = await directOf(miguel, tripMon);
    const group = await groupOf(miguel);
    await say(ana, chat, "El aparcamiento tiene barrera");
    await say(laura, group, "Llevo una maleta de cabina");
    const byName = await inbox(miguel, "?q=ana");
    assert.ok(byName.items.some((item: { id: string }) => item.id === chat));
    const byText = await inbox(miguel, "?q=APARCAMIENTO");
    assert.deepEqual(byText.items.map((item: { id: string }) => item.id), [chat]);
    const byGroupText = await inbox(miguel, "?q=maleta");
    assert.deepEqual(byGroupText.items.map((item: { id: string }) => item.id), [group]);
    assert.deepEqual((await inbox(miguel, "?q=zzzzzz")).items, []);
    assert.equal((await miguel.get("/v1/conversations?q=a")).status, 400, "mínimo dos caracteres");
    // Los comodines no se interpretan.
    assert.deepEqual((await inbox(miguel, "?q=%25%25")).items, []);

    await blockUser(pool, world.miguel, world.laura);
    assert.deepEqual((await inbox(miguel, "?q=maleta")).items, [], "el texto de alguien bloqueado no se puede buscar");
    await pool.query(`update trip_direct_messages set hidden_at = now() where body like 'El aparcamiento%'`);
    assert.ok(!(await inbox(miguel, "?q=barrera")).items.some((item: { id: string }) => item.id === chat));
  });

  it("denunciar un mensaje: copia literal como prueba, no se puede denunciar lo propio y repetir es idempotente", async () => {
    const chat = await directOf(miguel, tripMon);
    const offending = await say(ana, chat, "Mensaje que Miguel considera inapropiado");
    const mine = await say(miguel, chat, "Mi propio mensaje");

    const selfReport = await miguel.post(`/v1/conversations/${chat}/messages/${mine.body.id}/report`, { reason: "spam_or_fraud" });
    assert.equal(selfReport.status, 400);
    assert.equal(selfReport.body.error.code, "REPORT_SELF_FORBIDDEN");
    const missing = await miguel.post(`/v1/conversations/${chat}/messages/${uuid()}/report`, { reason: "harassment" });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, "MESSAGE_NOT_FOUND");
    const badReason = await miguel.post(`/v1/conversations/${chat}/messages/${offending.body.id}/report`, { reason: "me_cae_mal" });
    assert.equal(badReason.status, 400);

    const key = uuid();
    const filed = await miguel.post(`/v1/conversations/${chat}/messages/${offending.body.id}/report`, { reason: "inappropriate_content", details: "Lenguaje ofensivo" }, { "idempotency-key": key });
    assert.equal(filed.status, 201, filed.raw);
    expectKeys(filed.body, ["id", "reportedUser", "reason", "details", "tripId", "conversationId", "evidenceCount", "status", "createdAt", "updatedAt", "resolvedAt"]);
    expectKeys(filed.body.reportedUser, PUBLIC_USER_KEYS);
    assert.equal(filed.body.reportedUser.id, world.ana);
    assert.equal(filed.body.status, "open");
    assert.equal(filed.body.evidenceCount, 1);
    assert.equal(filed.body.tripId, tripMon);
    assert.equal(filed.body.conversationId, chat);

    const evidence = await pool.query(`select body, sender_user_id, message_source from user_report_evidence where report_id = $1`, [filed.body.id]);
    assert.deepEqual(evidence.rows, [{ body: "Mensaje que Miguel considera inapropiado", sender_user_id: world.ana, message_source: "direct" }]);
    const replay = await miguel.post(`/v1/conversations/${chat}/messages/${offending.body.id}/report`, { reason: "inappropriate_content", details: "Lenguaje ofensivo" }, { "idempotency-key": key });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.id, filed.body.id);
    const sameKeyOther = await miguel.post(`/v1/conversations/${chat}/messages/${offending.body.id}/report`, { reason: "harassment" }, { "idempotency-key": key });
    assert.equal(sameKeyOther.status, 409);
    assert.equal(sameKeyOther.body.error.code, "REPORT_IDEMPOTENCY_CONFLICT");
    // Sin clave: la misma persona y motivo en 24 h → 409.
    const duplicate = await miguel.post(`/v1/conversations/${chat}/messages/${offending.body.id}/report`, { reason: "inappropriate_content" });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, "REPORT_ALREADY_FILED");
    assert.equal((await pool.query(`select count(*)::int as n from user_reports`)).rows[0].n, 1);

    // Un mensaje retirado ya no se puede denunciar como prueba (no existe para la persona).
    await pool.query(`update trip_direct_messages set hidden_at = now() where id = $1`, [offending.body.id]);
    assert.equal((await miguel.post(`/v1/conversations/${chat}/messages/${offending.body.id}/report`, { reason: "harassment" })).status, 404);

    // La persona denunciada no ve la denuncia ni quién la hizo.
    assert.deepEqual((await ana.get("/v1/me/reports")).body.items, []);
    const mineList = await miguel.get("/v1/me/reports");
    assert.equal(mineList.body.items.length, 1);
    expectKeys(mineList.body, ["items", "nextCursor"]);
    assert.ok(!mineList.raw.includes("resolution"), "la nota interna de resolución nunca se expone");
  });

  it("denunciar a una persona: solo con contexto compartido, con pruebas de la conversación, topes por día y bloqueos listados", async () => {
    const chat = await directOf(miguel, tripMon);
    const group = await groupOf(miguel);
    const a = await say(ana, chat, "Primera prueba");
    const b = await say(ana, chat, "Segunda prueba");
    const fromGroup = await say(laura, group, "Mensaje de grupo");

    // Sin relación → 403; persona inexistente → 404; a uno mismo → 400.
    const unrelated = await carlosClient.post("/v1/me/reports", { reportedUserId: world.miguel, reason: "harassment" });
    assert.equal(unrelated.status, 403);
    assert.equal(unrelated.body.error.code, "REPORT_NOT_RELATED");
    assert.equal((await miguel.post("/v1/me/reports", { reportedUserId: uuid(), reason: "harassment" })).body.error.code, "USER_NOT_FOUND");
    assert.equal((await miguel.post("/v1/me/reports", { reportedUserId: world.miguel, reason: "harassment" })).body.error.code, "REPORT_SELF_FORBIDDEN");

    // Pruebas: sin conversación → 422; de una conversación ajena → 403; mensajes inexistentes → 422; más de 10 → 422.
    const noConversation = await miguel.post("/v1/me/reports", { reportedUserId: world.ana, reason: "unsafe_behavior", evidenceMessageIds: [a.body.id] });
    assert.equal(noConversation.status, 422);
    assert.equal(noConversation.body.error.code, "REPORT_EVIDENCE_INVALID");
    const foreignConversation = await carlosClient.post("/v1/me/reports", { reportedUserId: world.ana, reason: "unsafe_behavior", conversationId: chat, evidenceMessageIds: [a.body.id] });
    assert.equal(foreignConversation.status, 403);
    const fakeEvidence = await miguel.post("/v1/me/reports", { reportedUserId: world.ana, reason: "unsafe_behavior", conversationId: chat, evidenceMessageIds: [uuid()] });
    assert.equal(fakeEvidence.status, 422);
    const tooMany = await miguel.post("/v1/me/reports", { reportedUserId: world.ana, reason: "unsafe_behavior", conversationId: chat, evidenceMessageIds: Array.from({ length: 11 }, uuid) });
    assert.ok([400, 422].includes(tooMany.status));
    const foreignTrip = await miguel.post("/v1/me/reports", { reportedUserId: world.ana, reason: "no_show", tripId: uuid() });
    assert.equal(foreignTrip.status, 403);
    // Mensaje de otro de los dos (Laura) como prueba contra Ana → inválido.
    const wrongSender = await miguel.post("/v1/me/reports", { reportedUserId: world.ana, reason: "unsafe_behavior", conversationId: group, evidenceMessageIds: [fromGroup.body.id] });
    assert.equal(wrongSender.status, 422);

    const ok = await miguel.post("/v1/me/reports", {
      reportedUserId: world.ana, reason: "unsafe_behavior", details: "Conducción temeraria", tripId: tripMon, conversationId: chat, evidenceMessageIds: [a.body.id, b.body.id]
    });
    assert.equal(ok.status, 201, ok.raw);
    assert.equal(ok.body.evidenceCount, 2);
    // También una denuncia contra otra pasajera con una prueba del grupo.
    const groupReport = await miguel.post("/v1/me/reports", { reportedUserId: world.laura, reason: "spam_or_fraud", conversationId: group, evidenceMessageIds: [fromGroup.body.id] });
    assert.equal(groupReport.status, 201, groupReport.raw);
    assert.equal((await pool.query(`select message_source from user_report_evidence where report_id = $1`, [groupReport.body.id])).rows[0].message_source, "group");

    // Tope diario: 10 denuncias en 24 h.
    await pool.query(
      `insert into user_reports(reporter_user_id, reported_user_id, reason) select $1, $2, 'other' from generate_series(1, 8)`,
      [world.miguel, world.laura]
    );
    const limited = await miguel.post("/v1/me/reports", { reportedUserId: world.ana, reason: "no_show" });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, "REPORT_RATE_LIMITED");

    // Bloqueos: lista propia con la persona bloqueada.
    await blockUser(pool, world.miguel, carlos);
    await blockUser(pool, carlos, world.miguel);
    const blocks = await miguel.get("/v1/me/blocks");
    assert.equal(blocks.status, 200);
    expectKeys(blocks.body, ["items", "nextCursor"]);
    assert.equal(blocks.body.items.length, 1);
    expectKeys(blocks.body.items[0], ["user", "blockedAt"]);
    expectKeys(blocks.body.items[0].user, PUBLIC_USER_KEYS);
    assert.equal(blocks.body.items[0].user.id, carlos);
    assert.equal((await ana.get("/v1/me/blocks")).body.items.length, 0, "cada persona solo ve sus propios bloqueos");
  });
});
