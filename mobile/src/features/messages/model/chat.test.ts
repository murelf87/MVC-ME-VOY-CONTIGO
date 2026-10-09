// Pruebas de la lógica pura del hilo de chat, la bandeja y la llamada (slice messages).
// Ejecutar:  cd mobile && node --import tsx --test "src/features/messages/**/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMessage, ChatMessagePage, ConversationSummary, PeerCallContact } from "@/api/types";
import { callStateOf, dialableNumber } from "./call";
import {
  EMPTY_THREAD,
  addPending,
  appendNewer,
  applyRead,
  buildTimeline,
  confirmPending,
  dropPending,
  failPending,
  hasSendingPending,
  loadFirstPage,
  locationLines,
  maxSeq,
  mergeMessages,
  offlineFailures,
  prependOlder,
  receiptStatus,
  retryPending,
  unreadIncomingCount,
  unreadUpToSeq,
  type MessageEntry,
  type ThreadState,
} from "./chat";
import { badgeText, emptyCopy, isSearchTooShort, normalizeSearch, previewOf } from "./inbox";

const ME = "11111111-1111-4111-8111-111111111111";
const ANA = "22222222-2222-4222-8222-222222222222";
const CONV = "33333333-3333-4333-8333-333333333333";

function msg(seq: number, overrides: Partial<ChatMessage> = {}): ChatMessage {
  const mine = overrides.mine ?? false;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    seq,
    conversationId: CONV,
    senderId: mine ? ME : ANA,
    senderName: mine ? "Miguel Torres" : "Ana García López",
    mine,
    kind: "text",
    body: `mensaje ${seq}`,
    location: null,
    hidden: false,
    receipt: mine ? { state: "sent", recipientCount: 1, deliveredCount: 0, readCount: 0 } : null,
    createdAt: `2026-10-05T05:${String(10 + seq).padStart(2, "0")}:00.000Z`,
    ...overrides,
  };
}

function page(items: ChatMessage[], nextCursor: string | null = null, lastReadSeq = 0): ChatMessagePage {
  return { items, nextCursor, lastReadSeq };
}

// 05:17 UTC = 07:17 en Madrid (verano) → todas las marcas de msg() caen hoy
const NOW = Date.parse("2026-10-05T05:17:00.000Z");
const OPTIONS = { nowMs: NOW, isGroup: false, myUserId: ME, myName: "Miguel Torres" };

describe("mezcla de páginas", () => {
  it("ordena por seq y no repite mensajes", () => {
    const merged = mergeMessages([msg(3), msg(1)], [msg(2), msg(3)]);
    assert.deepEqual(
      merged.map((m) => m.seq),
      [1, 2, 3],
    );
  });

  it("la versión nueva de un mensaje sustituye a la anterior (acuses)", () => {
    const before = msg(1, { mine: true });
    const after = msg(1, { mine: true, receipt: { state: "read", recipientCount: 1, deliveredCount: 1, readCount: 1 } });
    const merged = mergeMessages([before], [after]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.receipt?.state, "read");
  });

  it("la primera página fija el cursor de anteriores y el puntero de lectura", () => {
    const state = loadFirstPage(EMPTY_THREAD, page([msg(5), msg(6)], "cursor-1", 4));
    assert.equal(state.olderCursor, "cursor-1");
    assert.equal(state.lastReadSeq, 4);
    assert.equal(state.loaded, true);
    assert.equal(maxSeq(state), 6);
  });

  it("los mensajes anteriores se anteponen y mueven el cursor", () => {
    let state = loadFirstPage(EMPTY_THREAD, page([msg(5), msg(6)], "cursor-1", 6));
    state = prependOlder(state, page([msg(3), msg(4)], null, 6));
    assert.deepEqual(
      state.messages.map((m) => m.seq),
      [3, 4, 5, 6],
    );
    assert.equal(state.olderCursor, null);
  });

  it("el sondeo afterSeq añade los nuevos sin tocar el cursor de los antiguos", () => {
    let state = loadFirstPage(EMPTY_THREAD, page([msg(5), msg(6)], "cursor-1", 6));
    state = appendNewer(state, page([msg(7)], null, 6));
    assert.equal(state.olderCursor, "cursor-1");
    assert.equal(maxSeq(state), 7);
  });

  it("un sondeo vacío devuelve el mismo estado (sin repintar)", () => {
    const state = loadFirstPage(EMPTY_THREAD, page([msg(5)], null, 5));
    assert.equal(appendNewer(state, page([], null, 5)), state);
  });
});

describe("lectura", () => {
  it("marca hasta el último mensaje recibido sin leer, ignorando los propios", () => {
    const state = loadFirstPage(EMPTY_THREAD, page([msg(1), msg(2, { mine: true }), msg(3)], null, 1));
    assert.equal(unreadUpToSeq(state), 3);
    assert.equal(unreadIncomingCount(state), 1);
  });

  it("no hay nada que marcar cuando todo está leído", () => {
    const state = loadFirstPage(EMPTY_THREAD, page([msg(1), msg(2)], null, 2));
    assert.equal(unreadUpToSeq(state), null);
  });

  it("el puntero nunca retrocede", () => {
    const state = loadFirstPage(EMPTY_THREAD, page([msg(1), msg(2)], null, 2));
    assert.equal(applyRead(state, 1), state);
    assert.equal(applyRead(state, 5).lastReadSeq, 5);
  });

  it("los mensajes retirados por moderación no cuentan como sin leer", () => {
    const state = loadFirstPage(EMPTY_THREAD, page([msg(1, { hidden: true, body: null })], null, 0));
    assert.equal(unreadIncomingCount(state), 0);
    assert.equal(unreadUpToSeq(state), null);
  });
});

describe("envío optimista", () => {
  const base: ThreadState = loadFirstPage(EMPTY_THREAD, page([msg(1), msg(2)], null, 2));

  it("el mensaje en vuelo aparece al final como «pending»", () => {
    const state = addPending(base, { clientMessageId: "c1", kind: "text", body: "Hola", nowMs: NOW });
    const timeline = buildTimeline(state, OPTIONS).filter((e): e is MessageEntry => e.type === "message");
    const last = timeline[timeline.length - 1];
    assert.equal(last?.status, "pending");
    assert.equal(last?.text, "Hola");
    assert.equal(hasSendingPending(state), true);
  });

  it("no duplica el mismo clientMessageId", () => {
    const once = addPending(base, { clientMessageId: "c1", kind: "text", body: "Hola", nowMs: NOW });
    assert.equal(addPending(once, { clientMessageId: "c1", kind: "text", body: "Hola", nowMs: NOW }), once);
  });

  it("al confirmarse, el mensaje en vuelo se sustituye por el del servidor", () => {
    const sending = addPending(base, { clientMessageId: "c1", kind: "text", body: "Hola", nowMs: NOW });
    const confirmed = confirmPending(sending, "c1", msg(3, { mine: true, body: "Hola" }));
    assert.equal(confirmed.pending.length, 0);
    assert.equal(confirmed.messages.length, 3);
  });

  it("si el sondeo ya trajo el mensaje, confirmar no lo duplica", () => {
    const sending = addPending(base, { clientMessageId: "c1", kind: "text", body: "Hola", nowMs: NOW });
    const polled = appendNewer(sending, page([msg(3, { mine: true, body: "Hola" })], null, 2));
    const confirmed = confirmPending(polled, "c1", msg(3, { mine: true, body: "Hola" }));
    assert.equal(confirmed.messages.filter((m) => m.body === "Hola").length, 1);
    assert.equal(confirmed.pending.length, 0);
  });

  it("un fallo deja el mensaje como «failed» y reintentar lo devuelve a «sending» con la misma clave", () => {
    const sending = addPending(base, { clientMessageId: "c1", kind: "text", body: "Hola", nowMs: NOW });
    const failed = failPending(sending, "c1", "offline", null);
    assert.equal(failed.pending[0]?.status, "failed");
    assert.equal(offlineFailures(failed).length, 1);
    const retrying = retryPending(failed, "c1");
    assert.equal(retrying.pending[0]?.status, "sending");
    assert.equal(retrying.pending[0]?.clientMessageId, "c1");
    assert.equal(offlineFailures(retrying).length, 0);
  });

  it("un rechazo del servidor no se reenvía solo", () => {
    const failed = failPending(addPending(base, { clientMessageId: "c1", kind: "text", body: "x", nowMs: NOW }), "c1", "rejected", "INVALID_CHAT_MESSAGE");
    assert.equal(offlineFailures(failed).length, 0);
    assert.equal(failed.pending[0]?.errorCode, "INVALID_CHAT_MESSAGE");
  });

  it("eliminar un mensaje fallido lo quita de la lista", () => {
    const failed = failPending(addPending(base, { clientMessageId: "c1", kind: "text", body: "x", nowMs: NOW }), "c1", "unknown", null);
    assert.equal(dropPending(failed, "c1").pending.length, 0);
  });

  it("un mensaje de ubicación en vuelo conserva sus coordenadas", () => {
    const state = addPending(base, {
      clientMessageId: "c2",
      kind: "location",
      body: "Aparcamiento P1 · Isla Mágica",
      location: { lat: 37.4167, lng: -6.0027, label: "Aparcamiento P1 · Isla Mágica" },
      nowMs: NOW,
    });
    assert.equal(state.pending[0]?.location?.lat, 37.4167);
  });
});

describe("línea de tiempo", () => {
  it("si todo ocurre hoy no hay separadores de día (lámina 26)", () => {
    const state = loadFirstPage(EMPTY_THREAD, page([msg(1), msg(2, { mine: true })]));
    assert.equal(buildTimeline(state, OPTIONS).some((e) => e.type === "day"), false);
  });

  it("con mensajes de otro día, cada día lleva su separador", () => {
    const yesterday = msg(1, { createdAt: "2026-10-04T16:30:00.000Z" });
    const state = loadFirstPage(EMPTY_THREAD, page([yesterday, msg(2)]));
    const days = buildTimeline(state, OPTIONS).filter((e) => e.type === "day");
    assert.deepEqual(
      days.map((d) => (d.type === "day" ? d.label : "")),
      ["Ayer", "Hoy"],
    );
  });

  it("las horas se muestran en horario de Madrid", () => {
    const state = loadFirstPage(EMPTY_THREAD, page([msg(1, { createdAt: "2026-10-05T05:18:00.000Z" })]));
    const entry = buildTimeline(state, OPTIONS)[0];
    assert.equal(entry?.type === "message" ? entry.time : "", "07:18");
  });

  it("los mensajes propios llevan los ticks según el acuse; los recibidos no llevan estado", () => {
    const read = msg(2, { mine: true, receipt: { state: "read", recipientCount: 1, deliveredCount: 1, readCount: 1 } });
    const delivered = msg(3, { mine: true, receipt: { state: "delivered", recipientCount: 1, deliveredCount: 1, readCount: 0 } });
    const state = loadFirstPage(EMPTY_THREAD, page([msg(1), read, delivered, msg(4, { mine: true })]));
    const statuses = buildTimeline(state, OPTIONS).map((e) => (e.type === "message" ? e.status : "día"));
    assert.deepEqual(statuses, [null, "read", "delivered", "sent"]);
  });

  it("en grupos solo el primer mensaje seguido de una persona enseña su nombre", () => {
    const state = loadFirstPage(EMPTY_THREAD, page([msg(1), msg(2), msg(3, { mine: true })]));
    const entries = buildTimeline(state, { ...OPTIONS, isGroup: true }).filter((e): e is MessageEntry => e.type === "message");
    assert.deepEqual(
      entries.map((e) => e.showSender),
      [true, false, false],
    );
  });

  it("fuera de grupos no se enseña el nombre", () => {
    const state = loadFirstPage(EMPTY_THREAD, page([msg(1)]));
    const entry = buildTimeline(state, OPTIONS)[0];
    assert.equal(entry?.type === "message" ? entry.showSender : null, false);
  });
});

describe("acuses y ubicaciones", () => {
  it("sin acuse equivale a «enviado»", () => {
    assert.equal(receiptStatus(null), "sent");
    assert.equal(receiptStatus({ state: "delivered", recipientCount: 1, deliveredCount: 1, readCount: 0 }), "delivered");
    assert.equal(receiptStatus({ state: "read", recipientCount: 1, deliveredCount: 1, readCount: 1 }), "read");
  });

  it("la etiqueta de una ubicación se trocea por «·» en título y líneas", () => {
    assert.deepEqual(locationLines("Aparcamiento P1 · Isla Mágica · Sevilla", "Ubicación"), {
      title: "Aparcamiento P1",
      lines: ["Isla Mágica", "Sevilla"],
    });
    assert.deepEqual(locationLines(null, "Ubicación compartida"), { title: "Ubicación compartida", lines: [] });
  });
});

describe("bandeja", () => {
  const base: ConversationSummary = {
    id: CONV,
    kind: "direct",
    title: "Ana",
    subtitle: "Ruta al trabajo · Sevilla",
    peer: null,
    memberCount: null,
    myRole: "passenger",
    category: "work",
    provinceName: "Sevilla",
    tripId: null,
    bookingId: null,
    lastMessage: null,
    unreadCount: 0,
    lastActivityAt: "2026-10-05T05:12:00.000Z",
  };

  it("la búsqueda exige entre 2 y 60 caracteres", () => {
    assert.equal(normalizeSearch(" a "), null);
    assert.equal(normalizeSearch("  Ana   García "), "Ana García");
    assert.equal(normalizeSearch("x".repeat(80))?.length, 60);
    assert.equal(isSearchTooShort("a"), true);
    assert.equal(isSearchTooShort(""), false);
    assert.equal(isSearchTooShort("ab"), false);
  });

  it("la insignia se acota a 99+", () => {
    assert.equal(badgeText(3), "3");
    assert.equal(badgeText(100), "99+");
  });

  it("sin mensajes la fila invita a escribir; lo mío lleva «Tú: » solo en directos", () => {
    assert.match(previewOf(base), /Escribe para coordinar/);
    const mine = { ...base, lastMessage: { id: "x", kind: "text" as const, preview: "Vale", senderId: ME, mine: true, createdAt: base.lastActivityAt } };
    assert.equal(previewOf(mine), "Tú: Vale");
    assert.equal(previewOf({ ...mine, kind: "group" }), "Vale");
  });

  it("los estados vacíos por pestaña y búsqueda tienen texto propio", () => {
    assert.equal(emptyCopy("all", null), null);
    assert.match(emptyCopy("groups", null)?.message ?? "", /grupo/);
    assert.match(emptyCopy("all", "Ana")?.message ?? "", /«Ana»/);
  });
});

describe("llamar a la otra persona", () => {
  const now = Date.parse("2026-10-05T05:17:00.000Z");
  const contact = (overrides: Partial<PeerCallContact>): PeerCallContact => ({
    available: false,
    reason: "OUTSIDE_TRIP_WINDOW",
    peerFirstName: "Ana",
    phoneE164: null,
    availableFrom: "2026-10-04T17:25:00.000Z",
    availableUntil: "2026-10-05T08:45:00.000Z",
    ...overrides,
  });

  it("mientras no responde el servidor, está cargando", () => {
    assert.deepEqual(callStateOf(undefined, now), { kind: "loading" });
  });

  it("dentro de la ventana, hay número", () => {
    const state = callStateOf(contact({ available: true, reason: null, phoneE164: "+34600111222" }), now);
    assert.deepEqual(state, { kind: "available", name: "Ana", phoneE164: "+34600111222" });
  });

  it("disponible sin número no deja llamar", () => {
    assert.equal(callStateOf(contact({ available: true, reason: null, phoneE164: null }), now).kind, "unavailable");
  });

  it("antes de la ventana explica cuándo podrá llamar", () => {
    const state = callStateOf(contact({ availableFrom: "2026-10-05T17:25:00.000Z", availableUntil: "2026-10-06T08:45:00.000Z" }), now);
    assert.equal(state.kind, "unavailable");
    assert.match(state.kind === "unavailable" ? state.explanation : "", /Podrás llamar a Ana hoy a las 19:25/);
  });

  it("después de la ventana dice que solo es durante el viaje", () => {
    const state = callStateOf(contact({ availableFrom: "2026-10-04T10:00:00.000Z", availableUntil: "2026-10-04T12:00:00.000Z" }), now);
    assert.match(state.kind === "unavailable" ? state.explanation : "", /solo está disponible durante el viaje/);
  });

  it("llamadas desactivadas o persona sin teléfono tienen su texto", () => {
    const disabled = callStateOf(contact({ reason: "PEER_CALL_DISABLED" }), now);
    assert.match(disabled.kind === "unavailable" ? disabled.explanation : "", /no están disponibles por ahora/);
    const gone = callStateOf(contact({ reason: "PEER_UNAVAILABLE" }), now);
    assert.match(gone.kind === "unavailable" ? gone.explanation : "", /ya no tiene un teléfono/);
  });

  it("el número se limpia de espacios antes de marcar", () => {
    assert.equal(dialableNumber("+34 600 111 222"), "+34600111222");
  });
});
