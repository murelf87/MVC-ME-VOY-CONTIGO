import type { Pool } from "pg";
import { writeAudit } from "../../lib/audit.js";
import { notify } from "../../lib/notify.js";
import {
  ensureParticipants,
  groupVisibilitySql,
  resolveAccess,
  type ConversationAccess,
  type GroupAccess
} from "./chat-access.js";
import { groupTitle, loadRouteInfo, messagePreview, type MessageKind } from "./chat-inbox.js";
import {
  containsNul,
  decodeCursor,
  encodeCursor,
  iso,
  isoOrNull,
  loadPublicUsers,
  pageLimit,
  tx,
  type Queryable
} from "./common.js";
import type { CommsConfig } from "./config.js";
import { err } from "./errors.js";

export type ReceiptState = "sent" | "delivered" | "read";

export type MessageReceiptDto = {
  state: ReceiptState;
  recipientCount: number;
  deliveredCount: number;
  readCount: number;
};

export type ChatLocationDto = { lat: number; lng: number; label: string | null };

export type ChatMessageDto = {
  id: string;
  seq: number;
  conversationId: string;
  senderId: string;
  senderName: string;
  mine: boolean;
  kind: MessageKind;
  body: string | null;
  location: ChatLocationDto | null;
  hidden: boolean;
  receipt: MessageReceiptDto | null;
  createdAt: string;
};

export type ChatMessagePageDto = { items: ChatMessageDto[]; nextCursor: string | null; lastReadSeq: number };

const DELETED_USER_NAME = "Usuario eliminado";

/* ───────────── Lectura de filas ───────────── */

export type MessageRow = {
  id: string;
  seq: string;
  sender_user_id: string;
  kind: MessageKind;
  body: string;
  location_lat: number | null;
  location_lng: number | null;
  location_label: string | null;
  hidden_at: Date | null;
  created_at: Date;
  sender_name: string | null;
  sender_status: string | null;
};

type FetchOptions = { before?: number; after?: number; limit: number };

/** Mensajes visibles para `userId` en la conversación (descendente por `seq`, salvo con `after`, que es ascendente). */
export async function fetchMessageRows(db: Queryable, access: ConversationAccess, userId: string, opts: FetchOptions): Promise<MessageRow[]> {
  const params: unknown[] = [];
  let table: string;
  let where: string;
  if (access.kind === "direct") {
    params.push(access.party.tripId, access.party.driverUserId, access.party.passengerUserId);
    table = "trip_direct_messages";
    where = `m.trip_id = $1 and ((m.sender_user_id = $2 and m.recipient_user_id = $3) or (m.sender_user_id = $3 and m.recipient_user_id = $2))`;
  } else {
    params.push(access.conversation.id, userId, access.visibleFrom);
    table = "chat_group_messages";
    where = `m.conversation_id = $1 and ${groupVisibilitySql("$2", "$3")}`;
  }
  if (opts.before !== undefined) {
    params.push(String(opts.before));
    where += ` and m.seq < $${params.length}::bigint`;
  }
  if (opts.after !== undefined) {
    params.push(String(opts.after));
    where += ` and m.seq > $${params.length}::bigint`;
  }
  params.push(opts.limit);
  const order = opts.after !== undefined ? "asc" : "desc";
  const result = await db.query<MessageRow>(
    `select m.id, m.seq::text as seq, m.sender_user_id, m.kind, m.body, m.location_lat, m.location_lng, m.location_label,
            m.hidden_at, m.created_at, p.display_name as sender_name, u.status as sender_status
       from ${table} m
       join app_users u on u.id = m.sender_user_id
       left join profiles p on p.user_id = m.sender_user_id
      where ${where}
      order by m.seq ${order}
      limit $${params.length}`,
    params
  );
  return result.rows;
}

type Pointer = { delivered: number; read: number };
const NO_POINTER: Pointer = { delivered: 0, read: 0 };

async function loadPointers(db: Queryable, conversationId: string, userIds: string[]): Promise<Map<string, Pointer>> {
  const out = new Map<string, Pointer>();
  if (userIds.length === 0) return out;
  const rows = await db.query<{ user_id: string; delivered: string; read: string }>(
    `select user_id, last_delivered_seq::text as delivered, last_read_seq::text as read
       from chat_participants where conversation_id = $1 and user_id = any($2::uuid[])`,
    [conversationId, userIds]
  );
  for (const row of rows.rows) out.set(row.user_id, { delivered: Number(row.delivered), read: Number(row.read) });
  return out;
}

async function loadBlockedWith(db: Queryable, userId: string): Promise<Set<string>> {
  const rows = await db.query<{ other: string }>(
    `select case when blocker_user_id = $1 then blocked_user_id else blocker_user_id end as other
       from user_blocks where blocker_user_id = $1 or blocked_user_id = $1`,
    [userId]
  );
  return new Set(rows.rows.map(row => row.other));
}

/** Personas que ven un mensaje de grupo enviado por `senderId` en `createdAt`. */
function groupRecipients(access: GroupAccess, senderId: string, createdAt: Date, blockedWithSender: Set<string>): string[] {
  const driverId = access.conversation.driver_user_id;
  const out: string[] = [];
  if (senderId !== driverId && !blockedWithSender.has(driverId)) out.push(driverId);
  for (const [passengerId, since] of access.membership.passengers) {
    if (passengerId === senderId) continue;
    if (since.getTime() > createdAt.getTime()) continue;
    if (blockedWithSender.has(passengerId)) continue;
    out.push(passengerId);
  }
  return out;
}

function receiptOf(recipients: number, delivered: number, read: number): MessageReceiptDto {
  const deliveredCount = Math.max(delivered, read);
  const state: ReceiptState =
    recipients > 0 && read >= recipients ? "read" : recipients > 0 && deliveredCount >= recipients ? "delivered" : "sent";
  return { state, recipientCount: recipients, deliveredCount, readCount: read };
}

function senderNameOf(row: MessageRow): string {
  if (row.sender_status === "deleted") return DELETED_USER_NAME;
  return row.sender_name?.trim() || "Usuario MVC";
}

export async function toMessageDtos(db: Queryable, access: ConversationAccess, userId: string, rows: MessageRow[]): Promise<ChatMessageDto[]> {
  const mineRows = rows.filter(row => row.sender_user_id === userId);
  const receipts = new Map<string, MessageReceiptDto>();
  if (mineRows.length > 0) {
    if (access.kind === "direct") {
      const pointer = (await loadPointers(db, access.conversation.id, [access.peerUserId])).get(access.peerUserId) ?? NO_POINTER;
      for (const row of mineRows) {
        const seq = Number(row.seq);
        receipts.set(row.id, receiptOf(1, seq <= pointer.delivered ? 1 : 0, seq <= pointer.read ? 1 : 0));
      }
    } else {
      const memberIds = [access.conversation.driver_user_id, ...access.membership.passengers.keys()].filter(id => id !== userId);
      const [pointers, blocked] = await Promise.all([loadPointers(db, access.conversation.id, memberIds), loadBlockedWith(db, userId)]);
      for (const row of mineRows) {
        const seq = Number(row.seq);
        const recipients = groupRecipients(access, userId, row.created_at, blocked);
        let delivered = 0;
        let read = 0;
        for (const recipient of recipients) {
          const pointer = pointers.get(recipient) ?? NO_POINTER;
          if (seq <= pointer.delivered) delivered += 1;
          if (seq <= pointer.read) read += 1;
        }
        receipts.set(row.id, receiptOf(recipients.length, delivered, read));
      }
    }
  }
  return rows.map(row => {
    const hidden = row.hidden_at !== null;
    const mine = row.sender_user_id === userId;
    const hasLocation = row.kind === "location" && row.location_lat !== null && row.location_lng !== null;
    return {
      id: row.id,
      seq: Number(row.seq),
      conversationId: access.conversation.id,
      senderId: row.sender_user_id,
      senderName: senderNameOf(row),
      mine,
      kind: row.kind,
      body: hidden ? null : row.body,
      location:
        !hidden && hasLocation ? { lat: Number(row.location_lat), lng: Number(row.location_lng), label: row.location_label } : null,
      hidden,
      receipt: mine ? (receipts.get(row.id) ?? null) : null,
      createdAt: iso(row.created_at)
    };
  });
}

async function readPointer(db: Queryable, conversationId: string, userId: string): Promise<number> {
  const result = await db.query<{ last_read_seq: string }>(
    `select last_read_seq::text as last_read_seq from chat_participants where conversation_id = $1 and user_id = $2`,
    [conversationId, userId]
  );
  return Number(result.rows[0]?.last_read_seq ?? 0);
}

/* ───────────── Listado ───────────── */

export async function listMessages(
  pool: Pool,
  userId: string,
  conversationId: string,
  input: { limit?: number; cursor?: string; afterSeq?: number }
): Promise<ChatMessagePageDto> {
  if (input.cursor !== undefined && input.afterSeq !== undefined) {
    throw err("VALIDATION_ERROR", 400, "Usa «cursor» o «afterSeq», no los dos a la vez.");
  }
  const access = await resolveAccess(pool, userId, conversationId);
  await ensureParticipants(pool, userId, [conversationId]);
  const limit = pageLimit(input.limit, 30, 100);

  let rows: MessageRow[];
  let nextCursor: string | null = null;
  if (input.afterSeq !== undefined) {
    rows = await fetchMessageRows(pool, access, userId, { after: input.afterSeq, limit });
  } else {
    const before = input.cursor ? Number(decodeCursor(input.cursor, { s: "number" }).s) : undefined;
    const fetched = await fetchMessageRows(pool, access, userId, { ...(before !== undefined ? { before } : {}), limit: limit + 1 });
    const hasMore = fetched.length > limit;
    rows = fetched.slice(0, limit).reverse();
    const oldest = rows[0];
    nextCursor = hasMore && oldest ? encodeCursor({ s: Number(oldest.seq) }) : null;
  }

  // La app ha recibido estos mensajes: pasan a «entregado» para quien los envió.
  let maxIncoming = 0;
  for (const row of rows) if (row.sender_user_id !== userId) maxIncoming = Math.max(maxIncoming, Number(row.seq));
  if (maxIncoming > 0) {
    await pool.query(
      `update chat_participants set last_delivered_seq = greatest(last_delivered_seq, $3::bigint)
        where conversation_id = $1 and user_id = $2 and last_delivered_seq < $3::bigint`,
      [conversationId, userId, String(maxIncoming)]
    );
  }
  const items = await toMessageDtos(pool, access, userId, rows);
  return { items, nextCursor, lastReadSeq: await readPointer(pool, conversationId, userId) };
}

/* ───────────── Envío ───────────── */

export type SendMessageInput = {
  clientMessageId: string;
  kind?: MessageKind | undefined;
  body?: string | undefined;
  location?: { lat: number; lng: number; label?: string | undefined } | undefined;
};

export type ValidatedMessage = {
  kind: MessageKind;
  body: string;
  lat: number | null;
  lng: number | null;
  label: string | null;
};

export function validateMessage(input: SendMessageInput): ValidatedMessage {
  const kind = input.kind ?? "text";
  if (kind === "text") {
    if (input.location !== undefined) {
      throw err("INVALID_CHAT_MESSAGE", 422, "Un mensaje de texto no puede incluir una ubicación.");
    }
    const body = (input.body ?? "").trim();
    if (body.length < 1 || body.length > 2000) {
      throw err("INVALID_CHAT_MESSAGE", 422, "El mensaje debe tener entre 1 y 2000 caracteres.");
    }
    if (containsNul(body)) throw err("INVALID_CHAT_MESSAGE", 422, "El mensaje contiene caracteres no válidos.");
    return { kind, body, lat: null, lng: null, label: null };
  }
  const location = input.location;
  if (
    !location ||
    !Number.isFinite(location.lat) ||
    !Number.isFinite(location.lng) ||
    location.lat < -90 ||
    location.lat > 90 ||
    location.lng < -180 ||
    location.lng > 180
  ) {
    throw err("INVALID_LOCATION", 422, "La ubicación no es válida: la latitud debe estar entre -90 y 90 y la longitud entre -180 y 180.");
  }
  const label = location.label?.trim() ? location.label.trim() : null;
  if (label !== null && (label.length > 200 || containsNul(label))) {
    throw err("INVALID_LOCATION", 422, "La descripción de la ubicación no puede superar los 200 caracteres.");
  }
  const rawBody = input.body?.trim();
  const body = rawBody ? rawBody : (label ?? "Ubicación compartida");
  if (body.length > 2000 || containsNul(body)) {
    throw err("INVALID_CHAT_MESSAGE", 422, "El mensaje debe tener entre 1 y 2000 caracteres.");
  }
  return { kind, body, lat: location.lat, lng: location.lng, label };
}

type StoredMessage = {
  id: string;
  seq: string;
  conversation_ref: string;
  recipient_user_id: string | null;
  kind: MessageKind;
  body: string;
  location_lat: number | null;
  location_lng: number | null;
  location_label: string | null;
};

async function insertMessage(
  db: Queryable,
  access: ConversationAccess,
  userId: string,
  clientMessageId: string,
  message: ValidatedMessage
): Promise<{ id: string; seq: string } | null> {
  if (access.kind === "direct") {
    const result = await db.query<{ id: string; seq: string }>(
      `insert into trip_direct_messages(trip_id, sender_user_id, recipient_user_id, client_message_id, body, kind, location_lat, location_lng, location_label)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (sender_user_id, client_message_id) do nothing
       returning id, seq::text as seq`,
      [access.party.tripId, userId, access.peerUserId, clientMessageId, message.body, message.kind, message.lat, message.lng, message.label]
    );
    return result.rows[0] ?? null;
  }
  const result = await db.query<{ id: string; seq: string }>(
    `insert into chat_group_messages(conversation_id, sender_user_id, client_message_id, kind, body, location_lat, location_lng, location_label)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (sender_user_id, client_message_id) do nothing
     returning id, seq::text as seq`,
    [access.conversation.id, userId, clientMessageId, message.kind, message.body, message.lat, message.lng, message.label]
  );
  return result.rows[0] ?? null;
}

async function findStored(db: Queryable, access: ConversationAccess, userId: string, clientMessageId: string): Promise<StoredMessage | null> {
  if (access.kind === "direct") {
    const result = await db.query<StoredMessage>(
      `select id, seq::text as seq, trip_id::text as conversation_ref, recipient_user_id, kind, body, location_lat, location_lng, location_label
         from trip_direct_messages where sender_user_id = $1 and client_message_id = $2`,
      [userId, clientMessageId]
    );
    return result.rows[0] ?? null;
  }
  const result = await db.query<StoredMessage>(
    `select id, seq::text as seq, conversation_id::text as conversation_ref, null::uuid as recipient_user_id, kind, body,
            location_lat, location_lng, location_label
       from chat_group_messages where sender_user_id = $1 and client_message_id = $2`,
    [userId, clientMessageId]
  );
  return result.rows[0] ?? null;
}

function sameContent(access: ConversationAccess, stored: StoredMessage, message: ValidatedMessage): boolean {
  const sameRef =
    access.kind === "direct"
      ? stored.conversation_ref === access.party.tripId && stored.recipient_user_id === access.peerUserId
      : stored.conversation_ref === access.conversation.id;
  return (
    sameRef &&
    stored.kind === message.kind &&
    stored.body === message.body &&
    (stored.location_lat ?? null) === message.lat &&
    (stored.location_lng ?? null) === message.lng &&
    (stored.location_label ?? null) === message.label
  );
}

/**
 * Un solo aviso `chat_message` sin leer por persona y conversación: los siguientes mensajes actualizan el aviso (`data.count`)
 * en lugar de crear uno nuevo cada vez. Respeta la preferencia «mensajes» (si está desactivada no se crea nada).
 */
async function fanOutChatNotices(
  db: Queryable,
  input: {
    recipients: string[];
    conversationId: string;
    tripId: string | null;
    messageId: string;
    senderFirstName: string;
    groupTitleText: string | null;
    preview: string;
  }
): Promise<void> {
  for (const recipientId of input.recipients) {
    const prefs = await db.query<{ message_notices: boolean }>(
      `select message_notices from notification_preferences where user_id = $1`,
      [recipientId]
    );
    if (prefs.rows[0] && !prefs.rows[0].message_notices) continue;

    await db.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`chat_notice:${recipientId}:${input.conversationId}`]);
    const existing = await db.query<{ id: string; count: number }>(
      `select id, case when (data->>'count') ~ '^[0-9]{1,6}$' then (data->>'count')::int else 1 end as count
         from notifications
        where user_id = $1 and kind = 'chat_message' and read_at is null and delivery_state = 'delivered'
          and data->>'conversationId' = $2
        order by created_at desc, id desc
        limit 1
        for update`,
      [recipientId, input.conversationId]
    );
    const count = (existing.rows[0]?.count ?? 0) + 1;
    const title = input.groupTitleText
      ? count === 1
        ? `Nuevo mensaje en ${input.groupTitleText}`
        : `${count} mensajes nuevos en ${input.groupTitleText}`
      : count === 1
        ? `Nuevo mensaje de ${input.senderFirstName}`
        : `${count} mensajes nuevos de ${input.senderFirstName}`;
    const body = input.groupTitleText ? `${input.senderFirstName}: ${input.preview}` : input.preview;
    const data: Record<string, unknown> = { conversationId: input.conversationId, messageId: input.messageId, count };
    if (input.tripId) data.tripId = input.tripId;

    const row = existing.rows[0];
    if (row) {
      await db.query(
        `update notifications set title = left($2, 160), body = left($3, 600), data = $4::jsonb, created_at = now() where id = $1`,
        [row.id, title, body, JSON.stringify(data)]
      );
    } else {
      await notify(db, {
        userId: recipientId,
        category: "message",
        kind: "chat_message",
        title: title.slice(0, 160),
        body: (body || "Nuevo mensaje").slice(0, 600),
        data
      });
    }
  }
}

export async function sendMessage(
  pool: Pool,
  userId: string,
  conversationId: string,
  input: SendMessageInput,
  config: CommsConfig
): Promise<{ message: ChatMessageDto; created: boolean }> {
  const message = validateMessage(input);
  const access = await resolveAccess(pool, userId, conversationId);

  const outcome = await tx(pool, async client => {
    await ensureParticipants(client, userId, [conversationId]);
    const inserted = await insertMessage(client, access, userId, input.clientMessageId, message);
    if (!inserted) {
      const stored = await findStored(client, access, userId, input.clientMessageId);
      if (!stored) throw new Error("chat message disappeared after conflicting insert");
      if (!sameContent(access, stored, message)) {
        throw err("CHAT_IDEMPOTENCY_CONFLICT", 409, "Ese identificador de mensaje ya se usó con otro contenido.");
      }
      return { seq: stored.seq, created: false };
    }

    // Destinatarios del aviso: la otra parte (directo) o los miembros que pueden ver el mensaje (grupo).
    let recipients: string[];
    let groupTitleText: string | null = null;
    if (access.kind === "direct") {
      recipients = [access.peerUserId];
    } else {
      const blocked = await loadBlockedWith(client, userId);
      recipients = groupRecipients(access, userId, new Date(), blocked);
      const route = (await loadRouteInfo(client, [access.conversation])).get(access.conversation.id);
      groupTitleText = route ? groupTitle(route.provinceName, route.category) : "tu ruta";
    }
    const sender = (await loadPublicUsers(client, [userId], config)).get(userId);
    await fanOutChatNotices(client, {
      recipients,
      conversationId,
      tripId: access.kind === "direct" ? access.party.tripId : null,
      messageId: inserted.id,
      senderFirstName: sender?.firstName ?? "Alguien",
      groupTitleText,
      preview: messagePreview(message.kind, message.body, message.label, false)
    });
    await writeAudit(client, {
      actorUserId: userId,
      action: "chat.message.sent",
      entityType: access.kind === "direct" ? "trip_direct_message" : "chat_group_message",
      entityId: inserted.id,
      metadata: {
        conversationId,
        kind: message.kind,
        ...(access.kind === "direct" ? { tripId: access.party.tripId, recipientUserId: access.peerUserId } : {})
      }
    });
    return { seq: inserted.seq, created: true };
  });

  const rows = await fetchMessageRows(pool, access, userId, { after: Number(outcome.seq) - 1, limit: 1 });
  const first = rows[0];
  if (!first || first.seq !== outcome.seq) throw new Error("sent chat message could not be read back");
  const [dto] = await toMessageDtos(pool, access, userId, [first]);
  if (!dto) throw new Error("sent chat message could not be mapped");
  return { message: dto, created: outcome.created };
}

/* ───────────── Marcar leído ───────────── */

async function maxIncomingSeq(db: Queryable, access: ConversationAccess, userId: string): Promise<number> {
  if (access.kind === "direct") {
    const result = await db.query<{ max: string }>(
      `select coalesce(max(seq), 0)::text as max from trip_direct_messages
        where trip_id = $1 and sender_user_id = $2 and recipient_user_id = $3`,
      [access.party.tripId, access.peerUserId, userId]
    );
    return Number(result.rows[0]?.max ?? 0);
  }
  const result = await db.query<{ max: string }>(
    `select coalesce(max(m.seq), 0)::text as max from chat_group_messages m
      where m.conversation_id = $1 and m.sender_user_id <> $2 and ${groupVisibilitySql("$2", "$3")}`,
    [access.conversation.id, userId, access.visibleFrom]
  );
  return Number(result.rows[0]?.max ?? 0);
}

export async function unreadCountFor(db: Queryable, access: ConversationAccess, userId: string): Promise<number> {
  if (access.kind === "direct") {
    const result = await db.query<{ unread: number }>(
      `select count(*)::int as unread from trip_direct_messages m
        where m.trip_id = $1 and m.sender_user_id = $2 and m.recipient_user_id = $3 and m.hidden_at is null
          and m.seq > coalesce((select cp.last_read_seq from chat_participants cp where cp.conversation_id = $4 and cp.user_id = $3), 0)`,
      [access.party.tripId, access.peerUserId, userId, access.conversation.id]
    );
    return result.rows[0]?.unread ?? 0;
  }
  const result = await db.query<{ unread: number }>(
    `select count(*)::int as unread from chat_group_messages m
      where m.conversation_id = $1 and m.sender_user_id <> $2 and m.hidden_at is null and ${groupVisibilitySql("$2", "$3")}
        and m.seq > coalesce((select cp.last_read_seq from chat_participants cp where cp.conversation_id = $1 and cp.user_id = $2), 0)`,
    [access.conversation.id, userId, access.visibleFrom]
  );
  return result.rows[0]?.unread ?? 0;
}

export async function markConversationRead(
  pool: Pool,
  userId: string,
  conversationId: string,
  upToSeq?: number
): Promise<{ conversationId: string; lastReadSeq: number; unreadCount: number }> {
  const access = await resolveAccess(pool, userId, conversationId);
  await ensureParticipants(pool, userId, [conversationId]);
  const incoming = await maxIncomingSeq(pool, access, userId);
  // El puntero nunca supera lo ya recibido (no se puede «leer por adelantado») ni retrocede.
  const target = Math.min(upToSeq ?? incoming, incoming);
  if (target > 0) {
    await pool.query(
      `update chat_participants
          set last_read_seq = greatest(last_read_seq, $3::bigint), last_delivered_seq = greatest(last_delivered_seq, $3::bigint)
        where conversation_id = $1 and user_id = $2`,
      [conversationId, userId, String(target)]
    );
  }
  const lastReadSeq = await readPointer(pool, conversationId, userId);
  const unreadCount = await unreadCountFor(pool, access, userId);
  if (unreadCount === 0) {
    // Al leer todo, el aviso «Nuevo mensaje» de esta conversación también se da por visto.
    await pool.query(
      `update notifications set read_at = now()
        where user_id = $1 and kind = 'chat_message' and read_at is null and data->>'conversationId' = $2`,
      [userId, conversationId]
    );
  }
  return { conversationId, lastReadSeq, unreadCount };
}

/* ───────────── «Llamar a Ana» ───────────── */

export type PeerCallContactDto = {
  available: boolean;
  reason: "PEER_CALL_DISABLED" | "OUTSIDE_TRIP_WINDOW" | "PEER_UNAVAILABLE" | null;
  peerFirstName: string;
  phoneE164: string | null;
  availableFrom: string | null;
  availableUntil: string | null;
};

export async function getCallContact(
  pool: Pool,
  userId: string,
  conversationId: string,
  config: CommsConfig,
  now: Date = new Date()
): Promise<PeerCallContactDto> {
  const access = await resolveAccess(pool, userId, conversationId);
  if (access.kind !== "direct") {
    throw err("CALL_NOT_SUPPORTED_FOR_GROUPS", 400, "Solo puedes llamar desde un chat de reserva, no desde un grupo.");
  }
  const peer = (await loadPublicUsers(pool, [access.peerUserId], config)).get(access.peerUserId);
  const peerFirstName = peer?.firstName ?? "Usuario";

  const trip = await pool.query<{ departure_at: Date | null; route_duration_s: number | null; completed_at: Date | null }>(
    `select departure_at, route_duration_s, completed_at from trips where id = $1`,
    [access.party.tripId]
  );
  const row = trip.rows[0];
  let from: Date | null = null;
  let until: Date | null = null;
  if (row?.departure_at) {
    from = new Date(row.departure_at.getTime() - config.peerCallWindowBeforeMinutes * 60_000);
    const tripEnd = row.completed_at ?? new Date(row.departure_at.getTime() + (row.route_duration_s ?? 3600) * 1000);
    until = new Date(tripEnd.getTime() + config.peerCallWindowAfterMinutes * 60_000);
  }
  const unavailable = (reason: NonNullable<PeerCallContactDto["reason"]>): PeerCallContactDto => ({
    available: false,
    reason,
    peerFirstName,
    phoneE164: null,
    availableFrom: isoOrNull(from),
    availableUntil: isoOrNull(until)
  });

  if (!config.peerCallEnabled) return unavailable("PEER_CALL_DISABLED");
  if (!from || !until || now < from || now > until) return unavailable("OUTSIDE_TRIP_WINDOW");

  const phone = await pool.query<{ phone_e164: string | null }>(
    `select phone_e164 from app_users where id = $1 and status = 'active'`,
    [access.peerUserId]
  );
  const phoneE164 = phone.rows[0]?.phone_e164 ?? null;
  if (!phoneE164) return unavailable("PEER_UNAVAILABLE");

  await writeAudit(pool, {
    actorUserId: userId,
    action: "chat.peer_call.contact_revealed",
    entityType: "chat_conversation",
    entityId: conversationId,
    metadata: { tripId: access.party.tripId, peerUserId: access.peerUserId }
  });
  return {
    available: true,
    reason: null,
    peerFirstName,
    phoneE164,
    availableFrom: iso(from),
    availableUntil: iso(until)
  };
}
