/**
 * Conversaciones y mensajes del backend en memoria (docs/contracts/comms.md §2): bandeja, cabecera del chat, mensajes con
 * acuses (`sent|delivered|read`), envío idempotente por `clientMessageId`, marcar leído, «Llamar a Ana» y apertura de un chat
 * de reserva. Reglas de acceso y punteros: `access.ts`.
 *
 * SIMULACIÓN: solo existe en la vista previa. Los errores usan los códigos estables del contrato (§14).
 */
import type {
  ChatMessage,
  ChatMessagePage,
  ConversationDetail,
  ConversationLastMessage,
  ConversationPage,
  ConversationSummary,
  ConversationUnreadCount,
  MarkConversationReadResponse,
  Money,
  PeerCallContact,
  TripCategory,
} from "@/api/types";
import type { PreviewDb, PreviewRouter, TripRow } from "@/preview";
import { fail, fold, iso, isoReq, moneyIllustrative, moneyPending, publicUser, reply, uuidParam, writeAudit } from "@/preview";
import {
  accessOf,
  accessibleConversations,
  directConversationId,
  findConversation,
  markDelivered,
  markRead,
  membersOf,
  otherPartyOf,
  pointersOf,
  receiptOf,
  roleOf,
  seatsOfBooking,
  unreadCountOf,
  visibleMessages,
  type Access,
  type Conversation,
  type DirectConversation,
  type GroupConversation,
  type RawMessage,
} from "./access";
import { tablesOf, type GroupMessageRow } from "./rows";

/** Subtítulo de una conversación directa: «Ruta al trabajo · Sevilla». */
const CATEGORY_SUBTITLE: Record<TripCategory, string> = {
  work: "Ruta al trabajo",
  university: "Universidad",
  fp_academies: "FP y academias",
  hospital: "Hospital",
  sport: "Deporte",
  other: "Otros trayectos",
};

/** Título de un grupo de ruta: «Ruta Sevilla · Trabajo». */
const CATEGORY_GROUP: Record<TripCategory, string> = {
  work: "Trabajo",
  university: "Universidad",
  fp_academies: "FP",
  hospital: "Hospital",
  sport: "Deporte",
  other: "Otros",
};

const PREVIEW_MAX = 140;
const LOCATION_FALLBACK = "Ubicación compartida";
/** Ventana de «Llamar a Ana» (comms §2.9): 12 h antes de la salida hasta 3 h después de la llegada estimada o del final. */
const CALL_BEFORE_MS = 12 * 3_600_000;
const CALL_AFTER_MS = 3 * 3_600_000;

// ── Utilidades ───────────────────────────────────────────────────────────────────────────────────────────────────

function tripOf(conversation: Conversation): Readonly<TripRow> {
  return conversation.kind === "direct" ? conversation.trip : conversation.anchor;
}

function provinceNameOf(db: PreviewDb, trip: Readonly<TripRow>): string | null {
  return db.provinces.get(trip.province_id)?.name ?? null;
}

function stopLabel(db: PreviewDb, tripId: string, which: "origin" | "destination"): string | null {
  const stops = db.tripStops.filter((s) => s.trip_id === tripId).sort((a, b) => a.seq - b.seq);
  const stop = which === "origin" ? stops[0] : stops[stops.length - 1];
  return stop?.label ?? null;
}

function nameOf(db: PreviewDb, userId: string): { full: string; first: string } {
  const user = publicUser(db, userId);
  return { full: user.displayName, first: user.firstName };
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1).trimEnd()}…` : flat;
}

function previewTextOf(db: PreviewDb, conversation: Conversation, message: RawMessage, viewerId: string): string {
  const text = message.kind === "location" ? `Ubicación: ${message.label ?? LOCATION_FALLBACK}` : oneLine(message.body);
  if (conversation.kind !== "group") return text;
  return `${message.senderId === viewerId ? "Tú" : nameOf(db, message.senderId).first}: ${text}`;
}

function lastMessageOf(db: PreviewDb, conversation: Conversation, viewerId: string): ConversationLastMessage | null {
  const visible = visibleMessages(db, conversation, viewerId).filter((m) => !m.hidden);
  const last = visible[visible.length - 1];
  if (!last) return null;
  return {
    id: last.id,
    kind: last.kind,
    preview: previewTextOf(db, conversation, last, viewerId),
    senderId: last.senderId,
    mine: last.senderId === viewerId,
    createdAt: isoReq(last.createdAt),
  };
}

function lastActivityOf(db: PreviewDb, conversation: Conversation, viewerId: string): number {
  const visible = visibleMessages(db, conversation, viewerId).filter((m) => !m.hidden);
  const last = visible[visible.length - 1];
  if (last) return last.createdAt;
  return conversation.kind === "direct" ? (conversation.booking?.created_at ?? conversation.request.updated_at) : conversation.startedAt;
}

// ── Vistas del contrato ──────────────────────────────────────────────────────────────────────────────────────────

export function summaryOf(db: PreviewDb, conversation: Conversation, viewerId: string): ConversationSummary {
  const trip = tripOf(conversation);
  const province = provinceNameOf(db, trip);
  const base = {
    id: conversation.id,
    myRole: roleOf(conversation, viewerId),
    category: trip.category,
    provinceName: province,
    tripId: trip.id,
    lastMessage: lastMessageOf(db, conversation, viewerId),
    unreadCount: unreadCountOf(db, conversation, viewerId),
    lastActivityAt: isoReq(lastActivityOf(db, conversation, viewerId)),
  };
  if (conversation.kind === "direct") {
    const peer = publicUser(db, otherPartyOf(conversation, viewerId));
    return {
      ...base,
      kind: "direct",
      title: peer.firstName,
      subtitle: province === null ? CATEGORY_SUBTITLE[trip.category] : `${CATEGORY_SUBTITLE[trip.category]} · ${province}`,
      peer,
      memberCount: null,
      bookingId: conversation.booking?.id ?? null,
    };
  }
  return {
    ...base,
    kind: "group",
    title: province === null ? `Ruta · ${CATEGORY_GROUP[trip.category]}` : `Ruta ${province} · ${CATEGORY_GROUP[trip.category]}`,
    subtitle: null,
    peer: null,
    memberCount: membersOf(db, conversation).length,
    bookingId: null,
  };
}

/** Aporte del viaje de una reserva: ilustrativo en la vista previa (el backend real solo emite `defined` o `pending_definition`). */
export function contributionOf(booking: { amount_cents: number } | null): Money {
  if (booking === null || booking.amount_cents <= 0) return moneyPending();
  return moneyIllustrative(booking.amount_cents);
}

export function detailOf(db: PreviewDb, conversation: Conversation, viewerId: string): ConversationDetail {
  const summary = summaryOf(db, conversation, viewerId);
  if (conversation.kind === "group") {
    const trip = conversation.anchor;
    const members = membersOf(db, conversation).map((id) => ({
      user: publicUser(db, id),
      role: id === conversation.driverId ? ("driver" as const) : ("passenger" as const),
    }));
    return {
      ...summary,
      trip: null,
      booking: null,
      pickupPoint: null,
      contribution: null,
      routeLabel: `${stopLabel(db, trip.id, "origin") ?? "Origen"} → ${stopLabel(db, trip.id, "destination") ?? "Destino"}`,
      members,
    };
  }
  const { trip, booking, request } = conversation;
  const origin = db.tripStops.get(`${trip.id}:0`);
  const pickup =
    request.pickup_lat !== undefined && request.pickup_lat !== null && request.pickup_lng !== undefined && request.pickup_lng !== null
      ? { label: request.pickup_label ?? null, lat: request.pickup_lat, lng: request.pickup_lng }
      : origin
        ? { label: origin.label, lat: origin.lat, lng: origin.lng }
        : null;
  return {
    ...summary,
    trip: {
      id: trip.id,
      status: trip.status,
      departureAt: iso(trip.departure_at),
      arrivalEstimateAt: trip.departure_at === null ? null : iso(trip.departure_at + trip.route_duration_s * 1000),
      originLabel: stopLabel(db, trip.id, "origin"),
      destinationLabel: stopLabel(db, trip.id, "destination"),
    },
    booking: booking === null ? null : { id: booking.id, status: booking.status === "completed" ? "completed" : "confirmed", seats: seatsOfBooking(db, booking.id) },
    pickupPoint: pickup,
    contribution: contributionOf(booking),
    routeLabel: null,
    members: null,
  };
}

export function messageWire(db: PreviewDb, conversation: Conversation, message: RawMessage, viewerId: string): ChatMessage {
  const mine = message.senderId === viewerId;
  const receipt = mine && !message.hidden ? receiptOf(db, conversation, message) : null;
  return {
    id: message.id,
    seq: message.seq,
    conversationId: conversation.id,
    senderId: message.senderId,
    senderName: nameOf(db, message.senderId).full,
    mine,
    kind: message.kind,
    body: message.hidden ? null : message.body,
    location: message.hidden || message.kind !== "location" || message.lat === null || message.lng === null ? null : { lat: message.lat, lng: message.lng, label: message.label },
    hidden: message.hidden,
    receipt,
    createdAt: isoReq(message.createdAt),
  };
}

// ── Cursores ─────────────────────────────────────────────────────────────────────────────────────────────────────

function invalidCursor(): never {
  return fail("INVALID_CURSOR", "El cursor no es válido.", 400);
}

function encodeListCursor(at: number, id: string): string {
  return `c1.${at}.${id}`;
}

function decodeListCursor(cursor: string): { at: number; id: string } {
  const match = /^c1\.(\d{1,15})\.([0-9a-f-]{36})$/.exec(cursor);
  if (!match) return invalidCursor();
  return { at: Number(match[1]), id: match[2] as string };
}

function encodeMessageCursor(seq: number): string {
  return `m1.${seq}`;
}

function decodeMessageCursor(cursor: string): number {
  const match = /^m1\.(\d{1,12})$/.exec(cursor);
  if (!match) return invalidCursor();
  return Number(match[1]);
}

// ── Acceso ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Convierte el acceso en el error del contrato: 404 si no eres parte, 403 si ya no tienes acceso. */
export function assertAccess(access: Access): void {
  if (access === "not_party") fail("CONVERSATION_NOT_FOUND", "La conversación no existe.", 404);
  if (access === "closed") fail("CHAT_FORBIDDEN", "Este chat ya no está disponible porque la reserva ya no está vigente.", 403);
  if (access === "blocked") fail("CHAT_BLOCKED", "Una de las dos personas ha bloqueado a la otra.", 403);
}

export function requireConversation(db: PreviewDb, conversationId: string, userId: string): Conversation {
  const conversation = findConversation(db, conversationId);
  if (!conversation) return fail("CONVERSATION_NOT_FOUND", "La conversación no existe.", 404);
  assertAccess(accessOf(db, conversation, userId));
  return conversation;
}

// ── Envío ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface IncomingMessage {
  clientMessageId: string;
  kind: "text" | "location";
  body: string | undefined;
  location: { lat: number; lng: number; label?: string | undefined } | undefined;
}

interface Normalised {
  kind: "text" | "location";
  body: string;
  lat: number | null;
  lng: number | null;
  label: string | null;
}

function normalise(input: IncomingMessage): Normalised {
  if (input.kind === "text") {
    const text = (input.body ?? "").trim();
    if (text.length < 1 || text.length > 2000) return fail("INVALID_CHAT_MESSAGE", "El mensaje debe tener entre 1 y 2.000 caracteres.", 422);
    return { kind: "text", body: text, lat: null, lng: null, label: null };
  }
  const place = input.location;
  if (!place || !(place.lat >= -90 && place.lat <= 90) || !(place.lng >= -180 && place.lng <= 180)) {
    return fail("INVALID_LOCATION", "La ubicación no es válida.", 422);
  }
  const label = place.label?.trim() ? place.label.trim().slice(0, 200) : null;
  const body = input.body?.trim() ? input.body.trim().slice(0, 2000) : (label ?? LOCATION_FALLBACK);
  return { kind: "location", body, lat: place.lat, lng: place.lng, label };
}

function sameContent(existing: RawMessage, next: Normalised): boolean {
  return existing.kind === next.kind && existing.body === next.body && existing.lat === next.lat && existing.lng === next.lng && (existing.label ?? null) === next.label;
}

/** Guarda el mensaje y avisa (evento). Devuelve el mensaje y si era un reintento idempotente. */
export function sendMessage(
  db: PreviewDb,
  conversation: Conversation,
  senderId: string,
  input: IncomingMessage,
): { message: RawMessage; duplicate: boolean } {
  const next = normalise(input);
  const previous = visibleMessages(db, conversation, senderId).find((m) => m.senderId === senderId && m.clientMessageId === input.clientMessageId);
  if (previous) {
    if (!sameContent(previous, next)) return fail("CHAT_IDEMPOTENCY_CONFLICT", "Ese identificador ya se usó con otro mensaje.", 409);
    return { message: previous, duplicate: true };
  }
  const now = db.nowMs();
  if (conversation.kind === "direct") {
    const recipientId = otherPartyOf(conversation, senderId);
    const clash = db.messages.find((m) => m.sender_user_id === senderId && m.client_message_id === input.clientMessageId);
    if (clash) return fail("CHAT_IDEMPOTENCY_CONFLICT", "Ese identificador ya se usó con otro mensaje.", 409);
    const row = db.messages.insert({
      id: db.ids.uuid(),
      trip_id: conversation.trip.id,
      sender_user_id: senderId,
      recipient_user_id: recipientId,
      client_message_id: input.clientMessageId,
      body: next.body,
      created_at: now,
      seq: db.ids.seq("trip_direct_messages"),
      kind: next.kind,
      location_lat: next.lat,
      location_lng: next.lng,
      location_label: next.label,
      hidden_at: null,
      hidden_by_user_id: null,
      hidden_reason: null,
    });
    writeAudit(db, { actorUserId: senderId, action: "chat.message.sent", entityType: "trip_direct_message", entityId: row.id, metadata: { tripId: conversation.trip.id, kind: next.kind } });
    db.events.emit("message.sent", { message: row });
    const raw = rawOfDirect(db, conversation, row.id);
    if (!raw) throw new Error("Mensaje recién guardado no encontrado");
    return { message: raw, duplicate: false };
  }
  const clash = tablesOf(db).groupMessages.find((m) => m.sender_user_id === senderId && m.client_message_id === input.clientMessageId);
  if (clash) return fail("CHAT_IDEMPOTENCY_CONFLICT", "Ese identificador ya se usó con otro mensaje.", 409);
  const row: GroupMessageRow = {
    id: db.ids.uuid(),
    conversation_id: conversation.id,
    sender_user_id: senderId,
    client_message_id: input.clientMessageId,
    kind: next.kind,
    body: next.body,
    location_lat: next.lat,
    location_lng: next.lng,
    location_label: next.label,
    hidden_at: null,
    hidden_by_user_id: null,
    hidden_reason: null,
    created_at: now,
    seq: db.ids.seq("chat_group_messages"),
  };
  tablesOf(db).groupMessages.insert(row);
  writeAudit(db, { actorUserId: senderId, action: "chat.group_message.sent", entityType: "chat_group_message", entityId: row.id, metadata: { conversationId: conversation.id } });
  db.events.emit("comms.group_message.sent", { message: row, conversation });
  return {
    message: {
      id: row.id,
      seq: row.seq,
      senderId,
      kind: row.kind,
      body: row.body,
      lat: row.location_lat,
      lng: row.location_lng,
      label: row.location_label,
      hidden: false,
      createdAt: row.created_at,
      clientMessageId: row.client_message_id,
      source: "group",
    },
    duplicate: false,
  };
}

function rawOfDirect(db: PreviewDb, conversation: DirectConversation, messageId: string): RawMessage | undefined {
  return visibleMessages(db, conversation, conversation.driverId).find((m) => m.id === messageId);
}

// ── Llamada ──────────────────────────────────────────────────────────────────────────────────────────────────────

export function callContactOf(db: PreviewDb, conversation: DirectConversation, viewerId: string): PeerCallContact {
  const peerId = otherPartyOf(conversation, viewerId);
  const peer = nameOf(db, peerId);
  const trip = conversation.trip;
  const departure = trip.departure_at;
  const arrival = departure === null ? null : departure + trip.route_duration_s * 1000;
  const from = departure === null ? null : departure - CALL_BEFORE_MS;
  const until = trip.completed_at !== null ? trip.completed_at + CALL_AFTER_MS : arrival === null ? null : arrival + CALL_AFTER_MS;
  const base = { peerFirstName: peer.first, availableFrom: iso(from), availableUntil: iso(until) };
  const peerUser = db.users.get(peerId);
  if (!peerUser || peerUser.status !== "active") return { ...base, available: false, reason: "PEER_UNAVAILABLE", phoneE164: null };
  const now = db.nowMs();
  if (from === null || until === null || now < from || now > until) return { ...base, available: false, reason: "OUTSIDE_TRIP_WINDOW", phoneE164: null };
  writeAudit(db, {
    actorUserId: viewerId,
    action: "chat.peer_call.contact_revealed",
    entityType: "conversation",
    entityId: conversation.id,
    metadata: { peerUserId: peerId },
  });
  return { ...base, available: true, reason: null, phoneE164: peerUser.phone_e164 };
}

// ── Rutas ────────────────────────────────────────────────────────────────────────────────────────────────────────

const openedKey = (conversationId: string): string => `comms.opened:${conversationId}`;

function searchMatches(db: PreviewDb, conversation: Conversation, viewerId: string, summary: ConversationSummary, needle: string): boolean {
  if (fold(summary.title).includes(needle)) return true;
  if (summary.peer !== null && fold(summary.peer.displayName).includes(needle)) return true;
  return visibleMessages(db, conversation, viewerId).some((m) => !m.hidden && fold(m.body).includes(needle));
}

function groupMessageGroup(conversation: Conversation): conversation is GroupConversation {
  return conversation.kind === "group";
}

export function registerConversations(r: PreviewRouter, db: PreviewDb): void {
  r.get<{ Query: { filter?: "all" | "bookings" | "groups"; q?: string; limit?: number; cursor?: string } }>(
    "/v1/conversations",
    {
      summary: "Bandeja de mensajes (pantalla 25)",
      tags: ["comms"],
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            filter: { type: "string", enum: ["all", "bookings", "groups"] },
            q: { type: "string", minLength: 2, maxLength: 60 },
            limit: { type: "integer", minimum: 1, maximum: 50 },
            cursor: { type: "string", minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    (req): ConversationPage => {
      const me = req.auth().userId;
      const filter = req.query.filter ?? "all";
      const limit = req.query.limit ?? 20;
      const needle = req.query.q ? fold(req.query.q.trim()) : null;
      const cursor = req.query.cursor ? decodeListCursor(req.query.cursor) : null;

      const all = accessibleConversations(db, me);
      for (const conversation of all) markDelivered(db, me, conversation);
      const summaries = all.map((conversation) => ({ conversation, summary: summaryOf(db, conversation, me) }));
      const unreadTotal = summaries.reduce((sum, item) => sum + item.summary.unreadCount, 0);

      const listed = summaries
        .filter(({ summary }) => (filter === "all" ? true : filter === "bookings" ? summary.kind === "direct" : summary.kind === "group"))
        .filter(({ conversation, summary }) => needle === null || searchMatches(db, conversation, me, summary, needle))
        .sort((a, b) => {
          const diff = Date.parse(b.summary.lastActivityAt) - Date.parse(a.summary.lastActivityAt);
          return diff !== 0 ? diff : a.summary.id < b.summary.id ? -1 : 1;
        });
      const startAt =
        cursor === null
          ? 0
          : listed.findIndex((item) => {
              const at = Date.parse(item.summary.lastActivityAt);
              return at < cursor.at || (at === cursor.at && item.summary.id > cursor.id);
            });
      const from = startAt < 0 ? listed.length : startAt;
      const page = listed.slice(from, from + limit);
      const last = page[page.length - 1];
      const hasMore = from + limit < listed.length;
      return {
        items: page.map((item) => item.summary),
        nextCursor: hasMore && last ? encodeListCursor(Date.parse(last.summary.lastActivityAt), last.summary.id) : null,
        unreadTotal,
      };
    },
  );

  r.get(
    "/v1/conversations/unread-count",
    { summary: "Contador de mensajes sin leer (insignia de «Mensajes»)", tags: ["comms"] },
    (req): ConversationUnreadCount => {
      const me = req.auth().userId;
      let direct = 0;
      let groups = 0;
      let withUnread = 0;
      for (const conversation of accessibleConversations(db, me)) {
        markDelivered(db, me, conversation);
        const unread = unreadCountOf(db, conversation, me);
        if (unread === 0) continue;
        withUnread += 1;
        if (conversation.kind === "direct") direct += unread;
        else groups += unread;
      }
      return { total: direct + groups, direct, groups, conversationsWithUnread: withUnread };
    },
  );

  r.post<{ Body: { tripId: string; peerUserId: string } }>(
    "/v1/conversations/direct",
    {
      summary: "Abrir (o recuperar) el chat de una reserva",
      tags: ["comms"],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["tripId", "peerUserId"],
          properties: { tripId: { type: "string", format: "uuid" }, peerUserId: { type: "string", format: "uuid" } },
        },
      },
    },
    (req) => {
      const me = req.auth().userId;
      const { tripId, peerUserId } = req.body;
      if (peerUserId === me) fail("CHAT_SELF_FORBIDDEN", "No puedes abrir un chat contigo mismo.", 400);
      const trip = db.trips.get(tripId);
      if (!trip) fail("TRIP_NOT_FOUND", "El viaje no existe.", 404);
      const driverId = trip.driver_user_id;
      const passengerId = me === driverId ? peerUserId : me;
      if (me !== driverId && peerUserId !== driverId) fail("CHAT_FORBIDDEN", "Solo hay chat entre la conductora y un pasajero con reserva.", 403);
      const id = directConversationId(tripId, passengerId);
      const conversation = findConversation(db, id);
      if (!conversation || conversation.kind !== "direct" || conversation.booking === null) {
        fail("CHAT_FORBIDDEN", "Solo hay chat entre la conductora y un pasajero con reserva confirmada.", 403);
      }
      assertAccess(accessOf(db, conversation, me));
      const existed = db.getSetting<boolean>(openedKey(id)) === true || visibleMessages(db, conversation, me).length > 0;
      db.setSetting(openedKey(id), true);
      const detail = detailOf(db, conversation, me);
      return existed ? reply.ok(detail) : reply.created(detail);
    },
  );

  r.get<{ Params: { conversationId: string } }>(
    "/v1/conversations/:conversationId",
    { summary: "Cabecera del chat (pantalla 26)", tags: ["comms"], schema: { params: uuidParam("conversationId") } },
    (req): ConversationDetail => {
      const me = req.auth().userId;
      return detailOf(db, requireConversation(db, req.params.conversationId, me), me);
    },
  );

  r.get<{ Params: { conversationId: string }; Query: { limit?: number; cursor?: string; afterSeq?: number } }>(
    "/v1/conversations/:conversationId/messages",
    {
      summary: "Mensajes de una conversación (cursor ← antiguos · afterSeq → nuevos)",
      tags: ["comms"],
      schema: {
        params: uuidParam("conversationId"),
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100 },
            cursor: { type: "string", minLength: 1, maxLength: 100 },
            afterSeq: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    (req): ChatMessagePage => {
      const me = req.auth().userId;
      const conversation = requireConversation(db, req.params.conversationId, me);
      const { cursor, afterSeq } = req.query;
      if (cursor !== undefined && afterSeq !== undefined) fail("VALIDATION_ERROR", "cursor y afterSeq son excluyentes.", 400);
      const limit = req.query.limit ?? 30;
      const visible = visibleMessages(db, conversation, me);

      let slice: RawMessage[];
      let nextCursor: string | null = null;
      if (afterSeq !== undefined) {
        slice = visible.filter((m) => m.seq > afterSeq).slice(0, limit);
      } else {
        const before = cursor !== undefined ? decodeMessageCursor(cursor) : Number.POSITIVE_INFINITY;
        const older = visible.filter((m) => m.seq < before);
        slice = older.slice(Math.max(0, older.length - limit));
        const first = slice[0];
        if (older.length > slice.length && first) nextCursor = encodeMessageCursor(first.seq);
      }
      markDelivered(db, me, conversation);
      return {
        items: slice.map((m) => messageWire(db, conversation, m, me)),
        nextCursor,
        lastReadSeq: pointersOf(db, me, conversation.id).read,
      };
    },
  );

  r.post<{
    Params: { conversationId: string };
    Body: { clientMessageId: string; kind?: "text" | "location"; body?: string; location?: { lat: number; lng: number; label?: string } };
  }>(
    "/v1/conversations/:conversationId/messages",
    {
      summary: "Enviar un mensaje (idempotente por clientMessageId)",
      tags: ["comms"],
      schema: {
        params: uuidParam("conversationId"),
        body: {
          type: "object",
          additionalProperties: false,
          required: ["clientMessageId"],
          properties: {
            clientMessageId: { type: "string", format: "uuid" },
            kind: { type: "string", enum: ["text", "location"] },
            body: { type: "string", maxLength: 4000 },
            location: {
              type: "object",
              additionalProperties: false,
              required: ["lat", "lng"],
              properties: { lat: { type: "number" }, lng: { type: "number" }, label: { type: "string", maxLength: 200 } },
            },
          },
        },
      },
    },
    (req) => {
      const me = req.auth().userId;
      const conversation = requireConversation(db, req.params.conversationId, me);
      const { clientMessageId, kind, body, location } = req.body;
      const outcome = db.tx(() => sendMessage(db, conversation, me, { clientMessageId, kind: kind ?? "text", body, location }));
      const wire = messageWire(db, conversation, outcome.message, me);
      return outcome.duplicate ? reply.ok(wire) : reply.created(wire);
    },
  );

  r.post<{ Params: { conversationId: string }; Body: { upToSeq?: number } | undefined }>(
    "/v1/conversations/:conversationId/read",
    { summary: "Marcar como leída una conversación", tags: ["comms"], schema: { params: uuidParam("conversationId") } },
    (req): MarkConversationReadResponse => {
      const me = req.auth().userId;
      const conversation = requireConversation(db, req.params.conversationId, me);
      const requested = req.body?.upToSeq;
      if (requested !== undefined && (!Number.isInteger(requested) || requested < 0)) fail("VALIDATION_ERROR", "upToSeq debe ser un entero mayor o igual que 0.", 400);
      const lastReadSeq = markRead(db, me, conversation, requested);
      return { conversationId: conversation.id, lastReadSeq, unreadCount: unreadCountOf(db, conversation, me) };
    },
  );

  r.get<{ Params: { conversationId: string } }>(
    "/v1/conversations/:conversationId/call-contact",
    { summary: "«Llamar a Ana»: teléfono de la otra parte dentro de la ventana del viaje", tags: ["comms"], schema: { params: uuidParam("conversationId") } },
    (req): PeerCallContact => {
      const me = req.auth().userId;
      const conversation = requireConversation(db, req.params.conversationId, me);
      if (groupMessageGroup(conversation)) fail("CALL_NOT_SUPPORTED_FOR_GROUPS", "Las llamadas solo están disponibles en los chats de una reserva.", 400);
      return callContactOf(db, conversation, me);
    },
  );
}
