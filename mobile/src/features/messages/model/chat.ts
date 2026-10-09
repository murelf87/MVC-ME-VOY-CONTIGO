/**
 * Lógica pura del hilo de un chat (pantalla 26): mezcla de páginas del servidor, mensajes en vuelo (envío optimista),
 * reintentos idempotentes, punteros de lectura y línea de tiempo lista para pintar. Sin React ni red: se prueba en Node.
 *
 * Reglas del contrato (docs/contracts/comms.md §2.6–§2.8):
 *  - Los mensajes llegan en orden cronológico ascendente y se identifican por `id` y `seq` (creciente por conversación).
 *  - `cursor` trae mensajes MÁS ANTIGUOS; `afterSeq` trae los posteriores a un `seq` (sondeo).
 *  - Un envío lleva un `clientMessageId` (uuid): repetirlo con el mismo contenido NO duplica el mensaje.
 *  - El puntero de lectura nunca retrocede.
 */
import type { ChatLocation, ChatMessage, ChatMessageKind, ChatMessagePage, MessageReceipt } from "@/api/types";
import { formatDayRelative, formatTime, toCivilParts } from "@/i18n";
import type { MessageDeliveryStatus } from "@/ui";

// ── Estado del hilo ──────────────────────────────────────────────────────────────────────────────────────────────

export type PendingStatus = "sending" | "failed";
/** Por qué falló un envío: sin red (se reintenta solo al volver), rechazado por el servidor (no se reintenta solo) o desconocido. */
export type PendingFailure = "offline" | "rejected" | "unknown";

/** Mensaje propio que todavía no ha confirmado el servidor. */
export interface PendingMessage {
  clientMessageId: string;
  kind: ChatMessageKind;
  body: string;
  location: ChatLocation | null;
  createdAtMs: number;
  status: PendingStatus;
  failure: PendingFailure | null;
  /** Código de error del servidor (`INVALID_CHAT_MESSAGE`…) si lo hubo. */
  errorCode: string | null;
}

export interface ThreadState {
  /** Mensajes confirmados por el servidor: orden ascendente por `seq`, sin repetidos. */
  messages: readonly ChatMessage[];
  /** Mensajes propios en vuelo o fallidos, en orden de creación. */
  pending: readonly PendingMessage[];
  /** Cursor para pedir los mensajes anteriores (`null` = ya no hay más). */
  olderCursor: string | null;
  /** Último `seq` que yo he leído según el servidor. */
  lastReadSeq: number;
  /** Se ha cargado al menos la primera página. */
  loaded: boolean;
}

export const EMPTY_THREAD: ThreadState = { messages: [], pending: [], olderCursor: null, lastReadSeq: 0, loaded: false };

function bySeq(a: ChatMessage, b: ChatMessage): number {
  return a.seq - b.seq;
}

/** Mezcla listas de mensajes: por `id`, gana la versión más reciente (los acuses cambian); orden por `seq`. */
export function mergeMessages(current: readonly ChatMessage[], incoming: readonly ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(bySeq);
}

/** Primera página (o recarga completa): sustituye los mensajes confirmados y conserva los que siguen en vuelo. */
export function loadFirstPage(state: ThreadState, page: ChatMessagePage): ThreadState {
  const messages = mergeMessages([], page.items);
  return {
    ...state,
    messages,
    olderCursor: page.nextCursor,
    lastReadSeq: Math.max(state.lastReadSeq, page.lastReadSeq),
    loaded: true,
  };
}

/** Página de mensajes anteriores (`cursor`): se antepone sin tocar el resto. */
export function prependOlder(state: ThreadState, page: ChatMessagePage): ThreadState {
  return {
    ...state,
    messages: mergeMessages(state.messages, page.items),
    olderCursor: page.nextCursor,
    lastReadSeq: Math.max(state.lastReadSeq, page.lastReadSeq),
  };
}

/** Sondeo `afterSeq`: añade los nuevos y actualiza los acuses de los que ya estaban. No toca el cursor de los antiguos. */
export function appendNewer(state: ThreadState, page: ChatMessagePage): ThreadState {
  if (page.items.length === 0 && page.lastReadSeq <= state.lastReadSeq) return state;
  return {
    ...state,
    messages: mergeMessages(state.messages, page.items),
    lastReadSeq: Math.max(state.lastReadSeq, page.lastReadSeq),
  };
}

export function maxSeq(state: ThreadState): number {
  let max = 0;
  for (const message of state.messages) if (message.seq > max) max = message.seq;
  return max;
}

/** Cuántos de los mensajes más recientes se vuelven a pedir en cada sondeo para refrescar sus acuses. */
export const RECEIPT_LOOKBACK = 30;

/**
 * `afterSeq` del siguiente sondeo. Un sondeo normal pide «lo posterior al último que tengo»; pero los ticks de MIS
 * mensajes (✓ enviado → ✓✓ entregado → ✓✓ azul leído) cambian en mensajes que ya tengo y que el servidor no vuelve a
 * mandar. Por eso se pide desde justo antes del mensaje propio más antiguo, de entre los últimos `RECEIPT_LOOKBACK`,
 * cuyo acuse todavía no es «leído». Si no hay ninguno, desde el último `seq` conocido.
 */
export function pollFromSeq(state: ThreadState): number {
  const recent = state.messages.slice(-RECEIPT_LOOKBACK);
  for (const message of recent) {
    if (message.mine && !message.hidden && (message.receipt === null || message.receipt.state !== "read")) {
      return Math.max(0, message.seq - 1);
    }
  }
  return maxSeq(state);
}

/** Mayor `seq` de un mensaje RECIBIDO (no mío) posterior al puntero de lectura; `null` si no hay nada que marcar. */
export function unreadUpToSeq(state: ThreadState): number | null {
  let up: number | null = null;
  for (const message of state.messages) {
    if (message.mine || message.hidden) continue;
    if (message.seq > state.lastReadSeq && (up === null || message.seq > up)) up = message.seq;
  }
  return up;
}

export function unreadIncomingCount(state: ThreadState): number {
  let count = 0;
  for (const message of state.messages) {
    if (!message.mine && !message.hidden && message.seq > state.lastReadSeq) count += 1;
  }
  return count;
}

/** Aplica la respuesta de `POST …/read` (el puntero nunca retrocede). */
export function applyRead(state: ThreadState, lastReadSeq: number): ThreadState {
  return lastReadSeq > state.lastReadSeq ? { ...state, lastReadSeq } : state;
}

// ── Envío optimista ──────────────────────────────────────────────────────────────────────────────────────────────

export interface NewPending {
  clientMessageId: string;
  kind: ChatMessageKind;
  body: string;
  location?: ChatLocation | null;
  nowMs: number;
}

export function addPending(state: ThreadState, input: NewPending): ThreadState {
  if (state.pending.some((p) => p.clientMessageId === input.clientMessageId)) return state;
  const pending: PendingMessage = {
    clientMessageId: input.clientMessageId,
    kind: input.kind,
    body: input.body,
    location: input.location ?? null,
    createdAtMs: input.nowMs,
    status: "sending",
    failure: null,
    errorCode: null,
  };
  return { ...state, pending: [...state.pending, pending] };
}

/** El servidor confirmó el envío: el mensaje en vuelo se sustituye por el confirmado (sin duplicar si el sondeo ya lo trajo). */
export function confirmPending(state: ThreadState, clientMessageId: string, message: ChatMessage): ThreadState {
  return {
    ...state,
    messages: mergeMessages(state.messages, [message]),
    pending: state.pending.filter((p) => p.clientMessageId !== clientMessageId),
  };
}

export function failPending(state: ThreadState, clientMessageId: string, failure: PendingFailure, errorCode: string | null): ThreadState {
  return {
    ...state,
    pending: state.pending.map((p) => (p.clientMessageId === clientMessageId ? { ...p, status: "failed", failure, errorCode } : p)),
  };
}

/** Reintento: el mismo `clientMessageId` vuelve a «enviando» (el servidor no lo duplicará aunque la primera llegara). */
export function retryPending(state: ThreadState, clientMessageId: string): ThreadState {
  return {
    ...state,
    pending: state.pending.map((p) => (p.clientMessageId === clientMessageId ? { ...p, status: "sending", failure: null, errorCode: null } : p)),
  };
}

export function dropPending(state: ThreadState, clientMessageId: string): ThreadState {
  return { ...state, pending: state.pending.filter((p) => p.clientMessageId !== clientMessageId) };
}

/** Mensajes que fallaron solo por falta de red: se reenvían solos al volver la conexión. */
export function offlineFailures(state: ThreadState): PendingMessage[] {
  return state.pending.filter((p) => p.status === "failed" && p.failure === "offline");
}

export function hasSendingPending(state: ThreadState): boolean {
  return state.pending.some((p) => p.status === "sending");
}

// ── Acuses ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** `MessageReceipt` → ticks de la burbuja: enviado ✓ · entregado ✓✓ gris · leído ✓✓ azul. */
export function receiptStatus(receipt: MessageReceipt | null): MessageDeliveryStatus {
  if (receipt === null) return "sent";
  if (receipt.state === "read") return "read";
  if (receipt.state === "delivered") return "delivered";
  return "sent";
}

// ── Línea de tiempo ──────────────────────────────────────────────────────────────────────────────────────────────

export interface DayEntry {
  type: "day";
  key: string;
  label: string;
}

export interface MessageEntry {
  type: "message";
  key: string;
  side: "incoming" | "outgoing";
  senderId: string;
  senderName: string;
  kind: ChatMessageKind;
  /** Texto del mensaje (para una ubicación, su etiqueta). */
  text: string;
  location: ChatLocation | null;
  hidden: boolean;
  /** `07:18`. */
  time: string;
  /** Solo en mensajes propios. */
  status: MessageDeliveryStatus | null;
  /** `null` mientras sea un mensaje en vuelo. */
  messageId: string | null;
  clientMessageId: string | null;
  seq: number | null;
  /** En grupos, el primer mensaje seguido de una misma persona enseña su nombre. */
  showSender: boolean;
}

export type TimelineEntry = DayEntry | MessageEntry;

export interface TimelineOptions {
  nowMs: number;
  /** En grupos se enseña quién escribe cada bloque de mensajes. */
  isGroup: boolean;
  /** Mi identificador, para los mensajes en vuelo (que no traen `senderId`). */
  myUserId: string | null;
  myName: string;
}

function entryOfMessage(message: ChatMessage, time: string, showSender: boolean): MessageEntry {
  const outgoing = message.mine;
  return {
    type: "message",
    key: `m:${message.id}`,
    side: outgoing ? "outgoing" : "incoming",
    senderId: message.senderId,
    senderName: message.senderName,
    kind: message.kind,
    text: message.body ?? "",
    location: message.location,
    hidden: message.hidden,
    time,
    status: outgoing ? receiptStatus(message.receipt) : null,
    messageId: message.id,
    clientMessageId: null,
    seq: message.seq,
    showSender,
  };
}

function entryOfPending(pending: PendingMessage, time: string, options: TimelineOptions): MessageEntry {
  return {
    type: "message",
    key: `p:${pending.clientMessageId}`,
    side: "outgoing",
    senderId: options.myUserId ?? "me",
    senderName: options.myName,
    kind: pending.kind,
    text: pending.body,
    location: pending.location,
    hidden: false,
    time,
    status: pending.status === "failed" ? "failed" : "pending",
    messageId: null,
    clientMessageId: pending.clientMessageId,
    seq: null,
    showSender: false,
  };
}

/**
 * Mensajes confirmados + en vuelo, con separadores de día. Si TODO ocurre hoy no hay separadores (como la lámina 26);
 * en cuanto hay mensajes de otros días, cada día lleva el suyo («Ayer», «Vie, 2 oct»).
 */
export function buildTimeline(state: ThreadState, options: TimelineOptions): TimelineEntry[] {
  type Raw = { at: string | number; entry: (showSender: boolean) => MessageEntry; senderId: string; mine: boolean };
  const raws: Raw[] = [];
  for (const message of state.messages) {
    raws.push({
      at: message.createdAt,
      senderId: message.senderId,
      mine: message.mine,
      entry: (showSender) => entryOfMessage(message, formatTime(message.createdAt), showSender),
    });
  }
  for (const pending of state.pending) {
    raws.push({
      at: pending.createdAtMs,
      senderId: options.myUserId ?? "me",
      mine: true,
      entry: () => entryOfPending(pending, formatTime(pending.createdAtMs), options),
    });
  }

  const dayOf = (at: string | number): string => {
    const parts = toCivilParts(at);
    return parts === null ? "?" : `${parts.year}-${parts.month}-${parts.day}`;
  };
  const days = new Set(raws.map((raw) => dayOf(raw.at)));
  const todayOnly = days.size <= 1 && raws.every((raw) => formatDayRelative(raw.at, options.nowMs) === "Hoy");

  const timeline: TimelineEntry[] = [];
  let lastDay: string | null = null;
  let lastSender: string | null = null;
  for (const raw of raws) {
    const day = dayOf(raw.at);
    if (!todayOnly && day !== lastDay) {
      timeline.push({ type: "day", key: `d:${day}`, label: formatDayRelative(raw.at, options.nowMs) });
      lastSender = null;
    }
    lastDay = day;
    const showSender = options.isGroup && !raw.mine && raw.senderId !== lastSender;
    timeline.push(raw.entry(showSender));
    lastSender = raw.senderId;
  }
  return timeline;
}

// ── Textos de vista previa y utilidades ──────────────────────────────────────────────────────────────────────────

/** Texto visible de un mensaje en las listas (copiar, denunciar). Una ubicación se resume por su etiqueta. */
export function messageText(entry: Pick<MessageEntry, "kind" | "text" | "hidden" | "location">, fallbackLocation: string): string {
  if (entry.hidden) return "";
  if (entry.kind === "location") return entry.location?.label ?? (entry.text !== "" ? entry.text : fallbackLocation);
  return entry.text;
}

/** Trocea «Aparcamiento P1 · Isla Mágica» en título y líneas para la tarjeta de ubicación (lámina 26). */
export function locationLines(label: string | null, fallback: string): { title: string; lines: string[] } {
  const clean = (label ?? "").trim();
  if (clean === "") return { title: fallback, lines: [] };
  const parts = clean
    .split(/\s*·\s*|\n+/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const [first, ...rest] = parts;
  return { title: first ?? fallback, lines: rest };
}

export function isRetryable(entry: Pick<MessageEntry, "status" | "clientMessageId">): boolean {
  return entry.status === "failed" && entry.clientMessageId !== null;
}
