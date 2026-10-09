/**
 * Servidor simulado de mensajes: bandeja de la lámina 25, chat de la lámina 26, acuses, envío idempotente, marcar leído,
 * «Llamar a Ana», bloqueo, reserva cancelada, grupos y paginación. Se ejecuta con
 * `node --import tsx --test "src/features/messages/**\/*.test.ts"` (desde `mobile/`).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SEED_USER_IDS } from "@/preview";
import { createApi, asArray, asRecord, num, str, testRuntime, tokenFor } from "@/preview/testing/harness";
import { WORLD } from "./world";

const CLOCK_INBOX = "2026-10-05T07:17:00+02:00";
const CLOCK_CHAT = "2026-10-05T07:22:00+02:00";

function world(seed: string, clock: string = CLOCK_CHAT) {
  const rt = testRuntime({ profile: "passenger", seed, clock });
  const api = createApi(rt);
  return { rt, api, miguel: tokenFor(rt, "miguel"), ana: tokenFor(rt, "ana"), laura: tokenFor(rt, "laura") };
}

type World = ReturnType<typeof world>;

async function listConversations(w: World, query = ""): Promise<{ items: Array<Record<string, unknown>>; nextCursor: unknown; unreadTotal: unknown }> {
  const res = await w.api("GET", `/v1/conversations${query}`, { token: w.miguel });
  assert.equal(res.status, 200, res.text);
  const body = asRecord(res.body);
  return { items: asArray(body.items).map((item) => asRecord(item)), nextCursor: body.nextCursor, unreadTotal: body.unreadTotal };
}

async function conversationId(w: World, title: string): Promise<string> {
  const { items } = await listConversations(w);
  const found = items.find((item) => item.title === title);
  assert.ok(found, `No hay una conversación «${title}»`);
  return str(found.id);
}

describe("GET /v1/conversations (lámina 25)", () => {
  it("lista las cuatro conversaciones de la lámina con sus textos, horas e insignias", async () => {
    const w = world("messages-inbox", CLOCK_INBOX);
    const page = await listConversations(w);
    assert.deepEqual(
      page.items.map((item) => item.title),
      ["Ana", "Ruta Sevilla · Trabajo", "Miguel", "Laura"],
    );
    assert.deepEqual(
      page.items.map((item) => item.subtitle),
      ["Ruta al trabajo · Sevilla", null, "Universidad · Sevilla", "Hospital · Sevilla"],
    );
    assert.deepEqual(
      page.items.map((item) => item.unreadCount),
      [2, 3, 0, 0],
    );
    assert.deepEqual(
      page.items.map((item) => asRecord(item.lastMessage).preview),
      ["Perfecto, nos vemos en el aparcamiento.", "Ana: Salgo en 5 min. Nos vemos en P1.", "Genial, gracias por la info.", "¿Sigues con plazas?"],
    );
    assert.equal(page.unreadTotal, 5);
    assert.equal(page.nextCursor, null);
    assert.deepEqual(
      page.items.map((item) => item.kind),
      ["direct", "group", "direct", "direct"],
    );
    assert.equal(page.items[1]?.memberCount, 4);
    assert.equal(asRecord(page.items[0]?.lastMessage).createdAt, "2026-10-05T05:12:00.000Z");
    assert.equal(asRecord(page.items[1]?.lastMessage).createdAt, "2026-10-05T04:58:00.000Z");
  });

  it("filtra por pestañas y busca por nombre, título del grupo y texto de los mensajes", async () => {
    const w = world("messages-inbox", CLOCK_INBOX);
    assert.deepEqual(
      (await listConversations(w, "?filter=bookings")).items.map((item) => item.title),
      ["Ana", "Miguel", "Laura"],
    );
    assert.deepEqual(
      (await listConversations(w, "?filter=groups")).items.map((item) => item.title),
      ["Ruta Sevilla · Trabajo"],
    );
    assert.deepEqual(
      (await listConversations(w, "?q=laura")).items.map((item) => item.title),
      ["Laura"],
    );
    assert.deepEqual(
      (await listConversations(w, `?q=${encodeURIComponent("ruta sevilla")}`)).items.map((item) => item.title),
      ["Ruta Sevilla · Trabajo"],
    );
    assert.deepEqual(
      (await listConversations(w, `?q=${encodeURIComponent("gracias por la info")}`)).items.map((item) => item.title),
      ["Miguel"],
    );
    const none = await listConversations(w, "?q=zzzz");
    assert.deepEqual(none.items, []);
    assert.equal(none.unreadTotal, 5);
  });

  it("rechaza una búsqueda corta o un cursor mal formado y exige sesión", async () => {
    const w = world("messages-inbox", CLOCK_INBOX);
    assert.equal((await w.api("GET", "/v1/conversations?q=a", { token: w.miguel })).status, 400);
    const badCursor = await w.api("GET", "/v1/conversations?cursor=xx", { token: w.miguel });
    assert.equal(badCursor.status, 400);
    assert.equal(asRecord(asRecord(badCursor.body).error).code, "INVALID_CURSOR");
    assert.equal((await w.api("GET", "/v1/conversations")).status, 401);
  });

  it("bandeja vacía: sin reservas no hay conversaciones", async () => {
    const w = world("messages-inbox-empty", CLOCK_INBOX);
    const page = await listConversations(w);
    assert.deepEqual(page.items, []);
    assert.equal(page.unreadTotal, 0);
    assert.equal(page.nextCursor, null);
  });

  it("pagina con cursor sin repetir ni saltarse conversaciones", async () => {
    const w = world("messages-inbox-many", CLOCK_INBOX);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = cursor === null ? "?limit=7" : `?limit=7&cursor=${encodeURIComponent(cursor)}`;
      const page = await listConversations(w, query);
      seen.push(...page.items.map((item) => str(item.id)));
      cursor = typeof page.nextCursor === "string" ? page.nextCursor : null;
      pages += 1;
    } while (cursor !== null && pages < 20);
    assert.ok(pages >= 3, `se esperaban varias páginas, hubo ${pages}`);
    assert.equal(new Set(seen).size, seen.length, "hay conversaciones repetidas entre páginas");
    const all = await listConversations(w, "?limit=50");
    assert.deepEqual(seen, all.items.map((item) => str(item.id)));
    assert.ok(seen.length > 20);
  });
});

describe("GET /v1/conversations/unread-count", () => {
  it("cuenta no leídos por tipo y baja al marcar leído", async () => {
    const w = world("messages-inbox", CLOCK_INBOX);
    const before = await w.api("GET", "/v1/conversations/unread-count", { token: w.miguel });
    assert.deepEqual(before.body, { total: 5, direct: 2, groups: 3, conversationsWithUnread: 2 });
    const id = await conversationId(w, "Ana");
    const read = await w.api("POST", `/v1/conversations/${id}/read`, { token: w.miguel });
    assert.equal(read.status, 200, read.text);
    assert.equal(asRecord(read.body).unreadCount, 0);
    const after = await w.api("GET", "/v1/conversations/unread-count", { token: w.miguel });
    assert.deepEqual(after.body, { total: 3, direct: 0, groups: 3, conversationsWithUnread: 1 });
  });
});

describe("GET /v1/conversations/:id (lámina 26)", () => {
  it("devuelve la cabecera con la reserva, el punto de recogida y el aporte ilustrativo", async () => {
    const w = world("messages-chat");
    const id = await conversationId(w, "Ana");
    const res = await w.api("GET", `/v1/conversations/${id}`, { token: w.miguel });
    assert.equal(res.status, 200, res.text);
    const detail = asRecord(res.body);
    assert.equal(detail.title, "Ana");
    assert.equal(detail.myRole, "passenger");
    assert.deepEqual(asRecord(detail.booking).seats, 2);
    assert.equal(asRecord(detail.booking).status, "confirmed");
    const trip = asRecord(detail.trip);
    assert.equal(trip.departureAt, "2026-10-05T05:25:00.000Z");
    assert.equal(trip.arrivalEstimateAt, "2026-10-05T05:45:00.000Z");
    assert.equal(trip.originLabel, "Sevilla Centro");
    assert.equal(trip.destinationLabel, "Isla Mágica");
    assert.equal(asRecord(detail.pickupPoint).label, "Aparcamiento P1 · Isla Mágica");
    assert.deepEqual(detail.contribution, { cents: 400, currency: "EUR", status: "illustrative" });
    assert.equal(detail.members, null);
  });

  it("en un grupo no hay reserva propia y trae los miembros", async () => {
    const w = world("messages-chat");
    const id = await conversationId(w, "Ruta Sevilla · Trabajo");
    const detail = asRecord((await w.api("GET", `/v1/conversations/${id}`, { token: w.miguel })).body);
    assert.equal(detail.kind, "group");
    assert.equal(detail.booking, null);
    assert.equal(detail.trip, null);
    assert.equal(detail.routeLabel, "Sevilla Centro → Isla Mágica");
    const members = asArray(detail.members).map((member) => asRecord(member));
    assert.equal(members.length, 4);
    assert.equal(members.filter((member) => member.role === "driver").length, 1);
  });

  it("una persona ajena recibe 404 y un id inexistente también", async () => {
    const w = world("messages-chat");
    const id = await conversationId(w, "Ana");
    const hugo = tokenFor(w.rt, "carlos");
    const foreign = await w.api("GET", `/v1/conversations/${id}`, { token: hugo });
    assert.equal(foreign.status, 404);
    assert.equal(asRecord(asRecord(foreign.body).error).code, "CONVERSATION_NOT_FOUND");
    const missing = await w.api("GET", "/v1/conversations/6a1c0d52-3b1e-4c8a-9d21-0a5e7f10aa99", { token: w.miguel });
    assert.equal(missing.status, 404);
  });
});

describe("mensajes y acuses", () => {
  it("devuelve los cuatro mensajes en orden, con los míos leídos por Ana y la ubicación", async () => {
    const w = world("messages-chat");
    const id = await conversationId(w, "Ana");
    const res = await w.api("GET", `/v1/conversations/${id}/messages`, { token: w.miguel });
    assert.equal(res.status, 200, res.text);
    const page = asRecord(res.body);
    const items = asArray(page.items).map((item) => asRecord(item));
    assert.deepEqual(
      items.map((item) => item.createdAt),
      ["2026-10-05T05:18:00.000Z", "2026-10-05T05:20:00.000Z", "2026-10-05T05:20:00.000Z", "2026-10-05T05:21:00.000Z"],
    );
    assert.deepEqual(
      items.map((item) => item.mine),
      [false, true, true, false],
    );
    assert.deepEqual(
      items.map((item) => item.kind),
      ["text", "text", "location", "text"],
    );
    assert.deepEqual(asRecord(items[1]?.receipt).state, "read");
    assert.deepEqual(asRecord(items[2]?.receipt).state, "read");
    assert.equal(items[0]?.receipt, null);
    assert.equal(asRecord(items[2]?.location).label, "Aparcamiento P1 · Isla Mágica · Sevilla");
    assert.equal(page.nextCursor, null);
    assert.equal(page.lastReadSeq, 0);
    const seqs = items.map((item) => num(item.seq));
    assert.deepEqual([...seqs].sort((a, b) => a - b), seqs);
  });

  it("envía con clientMessageId idempotente (201, luego 200) y detecta el conflicto (409)", async () => {
    const w = world("messages-chat");
    const id = await conversationId(w, "Ana");
    const clientMessageId = "11111111-2222-4333-8444-555555555555";
    const first = await w.api("POST", `/v1/conversations/${id}/messages`, { token: w.miguel, body: { clientMessageId, body: "  Ya voy de camino  " } });
    assert.equal(first.status, 201, first.text);
    assert.equal(asRecord(first.body).body, "Ya voy de camino");
    assert.equal(asRecord(asRecord(first.body).receipt).state, "sent");
    const again = await w.api("POST", `/v1/conversations/${id}/messages`, { token: w.miguel, body: { clientMessageId, body: "Ya voy de camino" } });
    assert.equal(again.status, 200);
    assert.equal(asRecord(again.body).id, asRecord(first.body).id);
    const conflict = await w.api("POST", `/v1/conversations/${id}/messages`, { token: w.miguel, body: { clientMessageId, body: "Otra cosa" } });
    assert.equal(conflict.status, 409);
    assert.equal(asRecord(asRecord(conflict.body).error).code, "CHAT_IDEMPOTENCY_CONFLICT");
  });

  it("valida el contenido: vacío, demasiado largo o ubicación fuera de rango", async () => {
    const w = world("messages-chat");
    const id = await conversationId(w, "Ana");
    const empty = await w.api("POST", `/v1/conversations/${id}/messages`, { token: w.miguel, body: { clientMessageId: "11111111-2222-4333-8444-555555555551", body: "   " } });
    assert.equal(empty.status, 422);
    assert.equal(asRecord(asRecord(empty.body).error).code, "INVALID_CHAT_MESSAGE");
    const long = await w.api("POST", `/v1/conversations/${id}/messages`, { token: w.miguel, body: { clientMessageId: "11111111-2222-4333-8444-555555555552", body: "a".repeat(2001) } });
    assert.equal(long.status, 422);
    const place = await w.api("POST", `/v1/conversations/${id}/messages`, {
      token: w.miguel,
      body: { clientMessageId: "11111111-2222-4333-8444-555555555553", kind: "location", location: { lat: 123, lng: 0 } },
    });
    assert.equal(place.status, 422);
    assert.equal(asRecord(asRecord(place.body).error).code, "INVALID_LOCATION");
  });

  it("el acuse pasa de enviado a entregado cuando Ana consulta y a leído cuando lo marca", async () => {
    const w = world("messages-chat");
    const id = await conversationId(w, "Ana");
    const sent = await w.api("POST", `/v1/conversations/${id}/messages`, { token: w.miguel, body: { clientMessageId: "11111111-2222-4333-8444-555555555554", body: "Llego en 2 minutos" } });
    const messageId = str(asRecord(sent.body).id);
    const receipts = async (): Promise<string> => {
      const page = await w.api("GET", `/v1/conversations/${id}/messages?limit=100`, { token: w.miguel });
      const item = asArray(asRecord(page.body).items)
        .map((entry) => asRecord(entry))
        .find((entry) => entry.id === messageId);
      return str(asRecord(asRecord(item).receipt).state);
    };
    assert.equal(await receipts(), "sent");
    await w.api("GET", `/v1/conversations/${id}/messages?limit=100`, { token: w.ana });
    assert.equal(await receipts(), "delivered");
    await w.api("POST", `/v1/conversations/${id}/read`, { token: w.ana });
    assert.equal(await receipts(), "read");
  });

  it("afterSeq devuelve solo lo posterior y excluye cursor a la vez", async () => {
    const w = world("messages-chat");
    const id = await conversationId(w, "Ana");
    const all = asArray(asRecord((await w.api("GET", `/v1/conversations/${id}/messages`, { token: w.miguel })).body).items).map((item) => asRecord(item));
    const lastSeq = num(all[all.length - 1]?.seq);
    const nothing = await w.api("GET", `/v1/conversations/${id}/messages?afterSeq=${lastSeq}`, { token: w.miguel });
    assert.deepEqual(asRecord(nothing.body).items, []);
    assert.equal(asRecord(nothing.body).nextCursor, null);
    const tail = await w.api("GET", `/v1/conversations/${id}/messages?afterSeq=${num(all[1]?.seq)}`, { token: w.miguel });
    assert.equal(asArray(asRecord(tail.body).items).length, 2);
    const both = await w.api("GET", `/v1/conversations/${id}/messages?afterSeq=1&cursor=m1.9`, { token: w.miguel });
    assert.equal(both.status, 400);
  });

  it("pagina hacia atrás con el cursor de los mensajes más antiguos", async () => {
    const w = world("messages-chat");
    const id = await conversationId(w, "Ana");
    const first = asRecord((await w.api("GET", `/v1/conversations/${id}/messages?limit=2`, { token: w.miguel })).body);
    assert.equal(asArray(first.items).length, 2);
    assert.equal(typeof first.nextCursor, "string");
    const second = asRecord((await w.api("GET", `/v1/conversations/${id}/messages?limit=2&cursor=${encodeURIComponent(str(first.nextCursor))}`, { token: w.miguel })).body);
    assert.equal(asArray(second.items).length, 2);
    assert.equal(second.nextCursor, null);
    const firstSeqs = asArray(first.items).map((item) => num(asRecord(item).seq));
    const secondSeqs = asArray(second.items).map((item) => num(asRecord(item).seq));
    assert.ok(Math.max(...secondSeqs) < Math.min(...firstSeqs));
  });

  it("marcar leído sube lastReadSeq y deja sin no leídos; un upToSeq negativo es un error", async () => {
    const w = world("messages-chat");
    const id = await conversationId(w, "Ana");
    const bad = await w.api("POST", `/v1/conversations/${id}/read`, { token: w.miguel, body: { upToSeq: -3 } });
    assert.equal(bad.status, 400);
    const read = asRecord((await w.api("POST", `/v1/conversations/${id}/read`, { token: w.miguel })).body);
    assert.equal(read.unreadCount, 0);
    assert.ok(num(read.lastReadSeq) > 0);
  });
});

describe("«Llamar a Ana»", () => {
  it("revela el teléfono dentro de la ventana del viaje", async () => {
    const w = world("messages-chat");
    const id = await conversationId(w, "Ana");
    const res = asRecord((await w.api("GET", `/v1/conversations/${id}/call-contact`, { token: w.miguel })).body);
    assert.equal(res.available, true);
    assert.equal(res.reason, null);
    assert.equal(res.peerFirstName, "Ana");
    assert.equal(res.phoneE164, "+34611000101");
  });

  it("fuera de la ventana no entrega el teléfono y dice cuándo se abre", async () => {
    const w = world("messages-chat-early");
    const id = await conversationId(w, "Ana");
    const res = asRecord((await w.api("GET", `/v1/conversations/${id}/call-contact`, { token: w.miguel })).body);
    assert.equal(res.available, false);
    assert.equal(res.reason, "OUTSIDE_TRIP_WINDOW");
    assert.equal(res.phoneE164, null);
    assert.equal(typeof res.availableFrom, "string");
  });

  it("los grupos no tienen llamada", async () => {
    const w = world("messages-chat");
    const id = await conversationId(w, "Ruta Sevilla · Trabajo");
    const res = await w.api("GET", `/v1/conversations/${id}/call-contact`, { token: w.miguel });
    assert.equal(res.status, 400);
    assert.equal(asRecord(asRecord(res.body).error).code, "CALL_NOT_SUPPORTED_FOR_GROUPS");
  });
});

describe("acceso", () => {
  it("un bloqueo cierra el chat con 403 CHAT_BLOCKED y desaparece de la bandeja", async () => {
    const w = world("messages-chat");
    const id = await conversationId(w, "Ana");
    const blocked = world("messages-chat-blocked");
    const res = await blocked.api("GET", `/v1/conversations/${id}/messages`, { token: blocked.miguel });
    assert.equal(res.status, 403);
    assert.equal(asRecord(asRecord(res.body).error).code, "CHAT_BLOCKED");
    const titles = (await listConversations(blocked)).items.map((item) => item.title);
    assert.ok(!titles.includes("Ana"));
    assert.ok(!titles.includes("Ruta Sevilla · Trabajo"));
  });

  it("una reserva cancelada cierra el chat con 403 CHAT_FORBIDDEN", async () => {
    const open = world("messages-chat");
    const id = await conversationId(open, "Ana");
    const closed = world("messages-chat-closed");
    const res = await closed.api("GET", `/v1/conversations/${id}`, { token: closed.miguel });
    assert.equal(res.status, 403);
    assert.equal(asRecord(asRecord(res.body).error).code, "CHAT_FORBIDDEN");
    assert.ok(!(await listConversations(closed)).items.some((item) => item.title === "Ana"));
  });

  it("abre el chat de una reserva con POST /v1/conversations/direct (201 la primera vez, 200 después)", async () => {
    const w = world("messages-chat");
    const body = { tripId: WORLD.tripIsla, peerUserId: SEED_USER_IDS.ana };
    const first = await w.api("POST", "/v1/conversations/direct", { token: w.miguel, body });
    assert.ok(first.status === 200 || first.status === 201, first.text);
    const second = await w.api("POST", "/v1/conversations/direct", { token: w.miguel, body });
    assert.equal(second.status, 200);
    assert.equal(asRecord(second.body).title, "Ana");
    const self = await w.api("POST", "/v1/conversations/direct", { token: w.miguel, body: { ...body, peerUserId: SEED_USER_IDS.miguel } });
    assert.equal(self.status, 400);
    assert.equal(asRecord(asRecord(self.body).error).code, "CHAT_SELF_FORBIDDEN");
    const stranger = await w.api("POST", "/v1/conversations/direct", { token: w.miguel, body: { ...body, peerUserId: SEED_USER_IDS.carlos } });
    assert.equal(stranger.status, 403);
  });

  it("un mensaje en el grupo lo ven todos los miembros y lo lee cada uno por separado", async () => {
    const w = world("messages-chat");
    const id = await conversationId(w, "Ruta Sevilla · Trabajo");
    const sent = await w.api("POST", `/v1/conversations/${id}/messages`, { token: w.laura, body: { clientMessageId: "11111111-2222-4333-8444-555555555560", body: "Hoy llevo yo el café" } });
    assert.equal(sent.status, 201, sent.text);
    const mine = asArray(asRecord((await w.api("GET", `/v1/conversations/${id}/messages?limit=100`, { token: w.miguel })).body).items).map((item) => asRecord(item));
    assert.equal(mine[mine.length - 1]?.body, "Hoy llevo yo el café");
    assert.equal(mine[mine.length - 1]?.mine, false);
    const unread = (await listConversations(w)).items.find((item) => item.title === "Ruta Sevilla · Trabajo");
    assert.ok(num(unread?.unreadCount) >= 1);
  });
});

describe("estado de la vista previa", () => {
  it("el mundo de la bandeja arranca con el reloj de la lámina", async () => {
    const w = world("messages-inbox", CLOCK_INBOX);
    assert.equal(new Date(w.rt.db.nowMs()).toISOString(), "2026-10-05T05:17:00.000Z");
  });
});
