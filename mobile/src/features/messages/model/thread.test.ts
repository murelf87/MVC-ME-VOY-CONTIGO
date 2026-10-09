// Pruebas del sondeo con acuses (`pollFromSeq`) y del almacén de hilos (`ThreadStore`) del slice messages.
// Ejecutar:  cd mobile && node --import tsx --test "src/features/messages/**/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMessage, ChatMessagePage, MessageReceipt } from "@/api/types";
import { EMPTY_THREAD, RECEIPT_LOOKBACK, addPending, loadFirstPage, pollFromSeq, type ThreadState } from "./chat";
import { ThreadStore } from "./threadStore";

const CONV = "33333333-3333-4333-8333-333333333333";

function receipt(state: MessageReceipt["state"]): MessageReceipt {
  return { state, recipientCount: 1, deliveredCount: state === "sent" ? 0 : 1, readCount: state === "read" ? 1 : 0 };
}

function msg(seq: number, mine: boolean, state: MessageReceipt["state"] = "sent"): ChatMessage {
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    seq,
    conversationId: CONV,
    senderId: mine ? "me" : "ana",
    senderName: mine ? "Miguel" : "Ana",
    mine,
    kind: "text",
    body: `mensaje ${seq}`,
    location: null,
    hidden: false,
    receipt: mine ? receipt(state) : null,
    createdAt: "2026-10-05T05:18:00.000Z",
  };
}

function threadOf(items: ChatMessage[]): ThreadState {
  const page: ChatMessagePage = { items, nextCursor: null, lastReadSeq: 0 };
  return loadFirstPage(EMPTY_THREAD, page);
}

describe("pollFromSeq", () => {
  it("sin mensajes propios pendientes de leer, sondea desde el último seq", () => {
    assert.equal(pollFromSeq(threadOf([msg(1, false), msg(2, true, "read"), msg(3, false)])), 3);
  });

  it("un mensaje propio aún no leído se vuelve a pedir para refrescar sus ticks", () => {
    assert.equal(pollFromSeq(threadOf([msg(1, false), msg(2, true, "delivered"), msg(3, false), msg(4, true, "sent")])), 1);
  });

  it("elige el más antiguo de los no leídos", () => {
    assert.equal(pollFromSeq(threadOf([msg(5, true, "read"), msg(6, true, "sent"), msg(7, true, "sent")])), 5);
  });

  it("solo mira los últimos mensajes: un acuse antiguo sin leer no hace repetir todo el hilo", () => {
    const items: ChatMessage[] = [msg(1, true, "sent")];
    for (let seq = 2; seq <= RECEIPT_LOOKBACK + 10; seq += 1) items.push(msg(seq, false));
    assert.equal(pollFromSeq(threadOf(items)), RECEIPT_LOOKBACK + 10);
  });

  it("un hilo vacío sondea desde 0", () => {
    assert.equal(pollFromSeq(EMPTY_THREAD), 0);
  });
});

describe("ThreadStore", () => {
  it("un chat sin abrir es el hilo vacío de siempre (mismo objeto)", () => {
    const store = new ThreadStore();
    assert.equal(store.get("a"), EMPTY_THREAD);
    assert.equal(store.get("b"), EMPTY_THREAD);
  });

  it("avisa solo a quien mira ese chat y solo si el hilo cambia", () => {
    const store = new ThreadStore();
    let a = 0;
    let b = 0;
    store.subscribe("a", () => (a += 1));
    store.subscribe("b", () => (b += 1));
    store.update("a", (s) => addPending(s, { clientMessageId: "x", kind: "text", body: "hola", nowMs: 1 }));
    store.update("a", (s) => s); // sin cambio
    assert.deepEqual([a, b], [1, 0]);
    assert.equal(store.get("a").pending.length, 1);
  });

  it("darse de baja deja de avisar", () => {
    const store = new ThreadStore();
    let calls = 0;
    const off = store.subscribe("a", () => (calls += 1));
    off();
    store.update("a", (s) => addPending(s, { clientMessageId: "x", kind: "text", body: "hola", nowMs: 1 }));
    assert.equal(calls, 0);
  });

  it("clear() olvida todo y avisa para que las pantallas se vacíen", () => {
    const store = new ThreadStore();
    let calls = 0;
    store.subscribe("a", () => (calls += 1));
    store.update("a", (s) => addPending(s, { clientMessageId: "x", kind: "text", body: "hola", nowMs: 1 }));
    store.clear();
    assert.equal(store.get("a"), EMPTY_THREAD);
    assert.equal(store.size, 0);
    assert.equal(calls, 2);
  });

  it("al pasarse de capacidad descarta los menos recientes, pero nunca uno con un mensaje sin enviar", () => {
    const store = new ThreadStore(2);
    store.update("con-pendiente", (s) => addPending(s, { clientMessageId: "x", kind: "text", body: "sin enviar", nowMs: 1 }));
    store.update("b", () => threadOf([msg(1, false)]));
    store.update("c", () => threadOf([msg(1, false)]));
    store.update("d", () => threadOf([msg(1, false)]));
    assert.equal(store.get("con-pendiente").pending.length, 1);
    assert.equal(store.get("b"), EMPTY_THREAD);
    assert.equal(store.get("d").loaded, true);
  });

  it("no descarta un chat que una pantalla está mirando", () => {
    const store = new ThreadStore(1);
    store.subscribe("visto", () => undefined);
    store.update("visto", () => threadOf([msg(1, false)]));
    store.update("otro", () => threadOf([msg(1, false)]));
    assert.equal(store.get("visto").loaded, true);
  });
});
