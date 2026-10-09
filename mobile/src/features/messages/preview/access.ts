/**
 * Quién puede ver qué conversación (docs/contracts/comms.md §2.1), DERIVADO en cada petición de los viajes, solicitudes,
 * reservas y bloqueos del mundo simulado: no hay tabla de conversaciones.
 *
 *  - Directa: «un viaje + un pasajero». Participantes: la conductora del viaje y el pasajero con reserva `confirmed` o
 *    `completed`. Id estable derivado de (viaje, pasajero).
 *  - Grupo de ruta: para viajes recurrentes. Una ruta = misma conductora + provincia + categoría + sentido + origen y destino
 *    (redondeados a ~100 m). Miembros: la conductora (si hay al menos un pasajero) y cada pasajero con reserva `confirmed` en
 *    un viaje `published|active` de la ruta. Un bloqueo conductora↔pasajero lo expulsa; entre pasajeros, no ven los mensajes
 *    del otro.
 *
 * Respuestas de acceso (`accessOf`): `ok` · `not_party` (404 `CONVERSATION_NOT_FOUND`: no eres parte) · `closed` (403
 * `CHAT_FORBIDDEN`: eras parte pero la reserva ya no está vigente) · `blocked` (403 `CHAT_BLOCKED`).
 */
import type { BookingRow, PreviewDb, RideRequestRow, TripRow } from "@/preview";
import { isBlockedEitherWay, stableUuid } from "@/preview";
import type { ReadStateRow } from "./rows";
import { tablesOf } from "./rows";

export interface DirectConversation {
  kind: "direct";
  id: string;
  trip: Readonly<TripRow>;
  request: Readonly<RideRequestRow>;
  /** Reserva vigente (`confirmed` o `completed`); `null` si ya no lo está. */
  booking: Readonly<BookingRow> | null;
  driverId: string;
  passengerId: string;
}

export interface GroupConversation {
  kind: "group";
  id: string;
  key: string;
  driverId: string;
  /** Viaje ancla: el próximo viaje vigente de la ruta; si no hay, el más reciente. */
  anchor: Readonly<TripRow>;
  /** Pasajeros con reserva vigente en la ruta → instante de su primera reserva en ella. */
  passengers: ReadonlyMap<string, number>;
  /** Todas las personas que alguna vez tuvieron una solicitud en la ruta (separa 404 de 403). */
  everPassengers: ReadonlySet<string>;
  /** Comienzo de la conversación (primera reserva de la ruta o, sin ella, creación del viaje ancla). */
  startedAt: number;
}

export type Conversation = DirectConversation | GroupConversation;
export type Access = "ok" | "not_party" | "closed" | "blocked";

// ── Ids ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export function directConversationId(tripId: string, passengerId: string): string {
  return stableUuid(`conversation:direct:${tripId}:${passengerId}`);
}

export function groupConversationId(routeKey: string): string {
  return stableUuid(`conversation:group:${routeKey}`);
}

function round3(value: number): string {
  return (Math.round(value * 1000) / 1000).toFixed(3);
}

/** Ruta = conductora + provincia + categoría + sentido + origen y destino (a ~100 m). */
export function routeKeyOf(trip: Readonly<TripRow>): string {
  return [
    trip.driver_user_id,
    trip.province_id,
    trip.category,
    trip.leg,
    `${round3(trip.origin_lat)},${round3(trip.origin_lng)}`,
    `${round3(trip.destination_lat)},${round3(trip.destination_lng)}`,
  ].join("|");
}

// ── Conversaciones directas ──────────────────────────────────────────────────────────────────────────────────────

function liveBookingOf(db: PreviewDb, request: Readonly<RideRequestRow>): Readonly<BookingRow> | null {
  if (request.status !== "confirmed") return null;
  const booking = db.bookings.find((b) => b.request_id === request.id);
  if (!booking || (booking.status !== "confirmed" && booking.status !== "completed")) return null;
  return booking;
}

function directOf(db: PreviewDb, request: Readonly<RideRequestRow>): DirectConversation | null {
  const trip = db.trips.get(request.trip_id);
  if (!trip) return null;
  return {
    kind: "direct",
    id: directConversationId(trip.id, request.passenger_user_id),
    trip,
    request,
    booking: liveBookingOf(db, request),
    driverId: trip.driver_user_id,
    passengerId: request.passenger_user_id,
  };
}

/** Una conversación por (viaje, pasajero): se toma la solicitud más reciente, que es la vigente si la hay. */
function directConversations(db: PreviewDb): DirectConversation[] {
  const byId = new Map<string, DirectConversation>();
  for (const request of db.rideRequests.all()) {
    if (request.status === "pending" || request.status === "accepted" || request.status === "payment_pending" || request.status === "payment_late") continue;
    const conversation = directOf(db, request);
    if (!conversation) continue;
    const previous = byId.get(conversation.id);
    if (!previous || (previous.booking === null && conversation.booking !== null)) byId.set(conversation.id, conversation);
  }
  return [...byId.values()];
}

// ── Grupos de ruta ───────────────────────────────────────────────────────────────────────────────────────────────

function groupConversations(db: PreviewDb): GroupConversation[] {
  const routes = new Map<string, Array<Readonly<TripRow>>>();
  for (const trip of db.trips.all()) {
    if (trip.kind !== "recurring" || trip.status === "draft") continue;
    const key = routeKeyOf(trip);
    const list = routes.get(key);
    if (list) list.push(trip);
    else routes.set(key, [trip]);
  }
  const out: GroupConversation[] = [];
  const now = db.nowMs();
  for (const [key, trips] of routes) {
    const tripIds = new Set(trips.map((t) => t.id));
    const live = new Set(trips.filter((t) => t.status === "published" || t.status === "active").map((t) => t.id));
    const passengers = new Map<string, number>();
    const ever = new Set<string>();
    let startedAt = Math.min(...trips.map((t) => t.created_at));
    for (const request of db.rideRequests.all()) {
      if (!tripIds.has(request.trip_id)) continue;
      ever.add(request.passenger_user_id);
      if (request.status !== "confirmed" || !live.has(request.trip_id)) continue;
      const booking = db.bookings.find((b) => b.request_id === request.id);
      if (!booking || booking.status !== "confirmed") continue;
      const first = passengers.get(request.passenger_user_id);
      if (first === undefined || booking.created_at < first) passengers.set(request.passenger_user_id, booking.created_at);
      startedAt = Math.min(startedAt, booking.created_at);
    }
    const sorted = [...trips].sort((a, b) => (a.departure_at ?? 0) - (b.departure_at ?? 0));
    const upcoming = sorted.find((t) => (t.status === "published" || t.status === "active") && (t.departure_at ?? 0) >= now - 6 * 3_600_000);
    const anchor = upcoming ?? sorted[sorted.length - 1];
    const driverId = anchor?.driver_user_id;
    if (!anchor || !driverId) continue;
    out.push({ kind: "group", id: groupConversationId(key), key, driverId, anchor, passengers, everPassengers: ever, startedAt });
  }
  return out;
}

// ── Consulta y acceso ────────────────────────────────────────────────────────────────────────────────────────────

/** Conversación por id (aunque la persona ya no tenga acceso): `undefined` si no existe. */
export function findConversation(db: PreviewDb, id: string): Conversation | undefined {
  for (const request of db.rideRequests.all()) {
    const trip = db.trips.get(request.trip_id);
    if (!trip || directConversationId(trip.id, request.passenger_user_id) !== id) continue;
    // varias solicitudes del mismo (viaje, pasajero): se prefiere la vigente
    const candidates = db.rideRequests.filter((r) => r.trip_id === trip.id && r.passenger_user_id === request.passenger_user_id);
    const live = candidates.find((r) => liveBookingOf(db, r) !== null) ?? candidates[candidates.length - 1] ?? request;
    return directOf(db, live) ?? undefined;
  }
  return groupConversations(db).find((g) => g.id === id);
}

export function isParty(conversation: Conversation, userId: string): boolean {
  if (conversation.kind === "direct") return userId === conversation.driverId || userId === conversation.passengerId;
  return userId === conversation.driverId || conversation.everPassengers.has(userId);
}

/** Pasajeros de un grupo que siguen dentro (sin bloqueo con la conductora). */
function activePassengers(db: PreviewDb, conversation: GroupConversation): string[] {
  return [...conversation.passengers.keys()].filter((id) => !isBlockedEitherWay(db, conversation.driverId, id));
}

/** Personas con acceso ahora mismo, conductora incluida. Un grupo sin pasajeros no tiene miembros. */
export function membersOf(db: PreviewDb, conversation: Conversation): string[] {
  if (conversation.kind === "direct") {
    if (conversation.booking === null || isBlockedEitherWay(db, conversation.driverId, conversation.passengerId)) return [];
    return [conversation.driverId, conversation.passengerId];
  }
  const passengers = activePassengers(db, conversation);
  return passengers.length === 0 ? [] : [conversation.driverId, ...passengers];
}

export function accessOf(db: PreviewDb, conversation: Conversation, userId: string): Access {
  if (!isParty(conversation, userId)) return "not_party";
  if (conversation.kind === "direct") {
    if (conversation.booking === null) return "closed";
    return isBlockedEitherWay(db, conversation.driverId, conversation.passengerId) ? "blocked" : "ok";
  }
  if (userId === conversation.driverId) return activePassengers(db, conversation).length > 0 ? "ok" : "closed";
  if (isBlockedEitherWay(db, conversation.driverId, userId)) return "blocked";
  return conversation.passengers.has(userId) ? "ok" : "closed";
}

/** Conversaciones accesibles AHORA para la persona. */
export function accessibleConversations(db: PreviewDb, userId: string): Conversation[] {
  const out: Conversation[] = [];
  for (const conversation of directConversations(db)) if (accessOf(db, conversation, userId) === "ok") out.push(conversation);
  for (const conversation of groupConversations(db)) if (accessOf(db, conversation, userId) === "ok") out.push(conversation);
  return out;
}

export function otherPartyOf(conversation: DirectConversation, userId: string): string {
  return userId === conversation.driverId ? conversation.passengerId : conversation.driverId;
}

export function roleOf(conversation: Conversation, userId: string): "driver" | "passenger" {
  return userId === conversation.driverId ? "driver" : "passenger";
}

// ── Plazas de una reserva ────────────────────────────────────────────────────────────────────────────────────────

export const seatsKey = (bookingId: string): string => `comms.seats:${bookingId}`;

/** Plazas que ocupa una reserva: 1 (una plaza por solicitud) salvo que la vista previa fije otra para reproducir una lámina. */
export function seatsOfBooking(db: PreviewDb, bookingId: string): number {
  const stored = db.getSetting<number>(seatsKey(bookingId));
  return typeof stored === "number" && Number.isInteger(stored) && stored >= 1 ? stored : 1;
}

// ── Mensajes ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RawMessage {
  id: string;
  seq: number;
  senderId: string;
  kind: "text" | "location";
  body: string;
  lat: number | null;
  lng: number | null;
  label: string | null;
  hidden: boolean;
  createdAt: number;
  clientMessageId: string;
  source: "direct" | "group";
}

/** Todos los mensajes de la conversación (sin filtrar por quién mira), en orden ascendente de `seq`. */
export function rawMessagesOf(db: PreviewDb, conversation: Conversation): RawMessage[] {
  const out: RawMessage[] = [];
  if (conversation.kind === "direct") {
    const { driverId, passengerId, trip } = conversation;
    for (const m of db.messages.all()) {
      if (m.trip_id !== trip.id) continue;
      const pair =
        (m.sender_user_id === driverId && m.recipient_user_id === passengerId) ||
        (m.sender_user_id === passengerId && m.recipient_user_id === driverId);
      if (!pair) continue;
      out.push({
        id: m.id,
        seq: m.seq ?? 0,
        senderId: m.sender_user_id,
        kind: m.kind ?? "text",
        body: m.body,
        lat: m.location_lat ?? null,
        lng: m.location_lng ?? null,
        label: m.location_label ?? null,
        hidden: (m.hidden_at ?? null) !== null,
        createdAt: m.created_at,
        clientMessageId: m.client_message_id,
        source: "direct",
      });
    }
  } else {
    for (const m of tablesOf(db).groupMessages.all()) {
      if (m.conversation_id !== conversation.id) continue;
      out.push({
        id: m.id,
        seq: m.seq,
        senderId: m.sender_user_id,
        kind: m.kind,
        body: m.body,
        lat: m.location_lat,
        lng: m.location_lng,
        label: m.location_label,
        hidden: m.hidden_at !== null,
        createdAt: m.created_at,
        clientMessageId: m.client_message_id,
        source: "group",
      });
    }
  }
  return out.sort((a, b) => a.seq - b.seq || a.createdAt - b.createdAt);
}

/** Los mensajes que ESTA persona puede ver (grupos: solo desde su primera reserva y sin los de quien bloqueó o la bloqueó). */
export function visibleMessages(db: PreviewDb, conversation: Conversation, viewerId: string): RawMessage[] {
  const all = rawMessagesOf(db, conversation);
  if (conversation.kind === "direct") return all;
  const since = viewerId === conversation.driverId ? 0 : (conversation.passengers.get(viewerId) ?? 0);
  return all.filter((m) => {
    if (m.senderId === viewerId) return true;
    if (m.createdAt < since) return false;
    return !isBlockedEitherWay(db, viewerId, m.senderId);
  });
}

// ── Punteros de lectura y entrega ────────────────────────────────────────────────────────────────────────────────

export interface Pointers {
  read: number;
  delivered: number;
}

export function pointersOf(db: PreviewDb, userId: string, conversationId: string): Pointers {
  const row = tablesOf(db).readStates.get(`${userId}:${conversationId}`);
  return { read: row?.last_read_seq ?? 0, delivered: Math.max(row?.last_delivered_seq ?? 0, row?.last_read_seq ?? 0) };
}

function writePointers(db: PreviewDb, userId: string, conversationId: string, patch: Partial<Pick<ReadStateRow, "last_read_seq" | "last_delivered_seq">>): void {
  const table = tablesOf(db).readStates;
  const id = `${userId}:${conversationId}`;
  const current = table.get(id);
  const next = {
    last_read_seq: Math.max(current?.last_read_seq ?? 0, patch.last_read_seq ?? 0),
    last_delivered_seq: Math.max(current?.last_delivered_seq ?? 0, patch.last_delivered_seq ?? 0),
    updated_at: db.nowMs(),
  };
  if (current === undefined) table.insert({ id, user_id: userId, conversation_id: conversationId, ...next });
  else if (next.last_read_seq !== current.last_read_seq || next.last_delivered_seq !== current.last_delivered_seq) table.update(id, next);
}

/** La app de la persona consultó la conversación: lo recibido queda «entregado» (los punteros nunca retroceden). */
export function markDelivered(db: PreviewDb, userId: string, conversation: Conversation): void {
  const received = visibleMessages(db, conversation, userId).filter((m) => m.senderId !== userId);
  const top = received.reduce((max, m) => Math.max(max, m.seq), 0);
  if (top > 0) writePointers(db, userId, conversation.id, { last_delivered_seq: top });
}

/** Marca como leído hasta `upToSeq` (por defecto, todo lo recibido). Devuelve el puntero resultante. */
export function markRead(db: PreviewDb, userId: string, conversation: Conversation, upToSeq?: number): number {
  const received = visibleMessages(db, conversation, userId).filter((m) => m.senderId !== userId);
  const top = received.reduce((max, m) => Math.max(max, m.seq), 0);
  const target = upToSeq === undefined ? top : Math.min(upToSeq, top);
  writePointers(db, userId, conversation.id, { last_read_seq: target, last_delivered_seq: top });
  return pointersOf(db, userId, conversation.id).read;
}

/** Fija punteros a mano (siembras): leído y entregado hasta esos `seq`. */
export function setPointers(db: PreviewDb, userId: string, conversationId: string, pointers: Partial<Pointers>): void {
  writePointers(db, userId, conversationId, { last_read_seq: pointers.read ?? 0, last_delivered_seq: pointers.delivered ?? 0 });
}

export function unreadCountOf(db: PreviewDb, conversation: Conversation, viewerId: string): number {
  const pointers = pointersOf(db, viewerId, conversation.id);
  return visibleMessages(db, conversation, viewerId).filter((m) => m.senderId !== viewerId && !m.hidden && m.seq > pointers.read).length;
}

export interface ReceiptCounts {
  state: "sent" | "delivered" | "read";
  recipientCount: number;
  deliveredCount: number;
  readCount: number;
}

/** Acuse de un mensaje PROPIO: entregado/leído cuando todas las demás personas con acceso lo han recibido/leído. */
export function receiptOf(db: PreviewDb, conversation: Conversation, message: RawMessage): ReceiptCounts {
  const recipients = membersOf(db, conversation).filter((id) => id !== message.senderId);
  let delivered = 0;
  let read = 0;
  for (const id of recipients) {
    const pointers = pointersOf(db, id, conversation.id);
    if (pointers.read >= message.seq) read += 1;
    if (pointers.delivered >= message.seq || pointers.read >= message.seq) delivered += 1;
  }
  const state: ReceiptCounts["state"] =
    recipients.length > 0 && read === recipients.length ? "read" : recipients.length > 0 && delivered === recipients.length ? "delivered" : "sent";
  return { state, recipientCount: recipients.length, deliveredCount: delivered, readCount: read };
}
