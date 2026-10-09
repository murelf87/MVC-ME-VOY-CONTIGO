import type { Pool } from "pg";
import { moneyDefined, moneyPending, type MoneyDto } from "../../lib/dto.js";
import {
  blockedBetween,
  ensureDirectConversations,
  ensureGroupConversations,
  ensureParticipants,
  eligibleDirectSql,
  findDirectParty,
  groupVisibilitySql,
  isBlockedPair,
  isGroupMember,
  loadConversation,
  loadGroupMemberships,
  resolveAccess,
  type ConversationRole,
  type ConversationRow,
  type GroupMembership
} from "./chat-access.js";
import {
  CATEGORY_ROUTE_LABEL,
  CATEGORY_SHORT_LABEL,
  decodeCursor,
  encodeCursor,
  iso,
  likePattern,
  loadPublicUsers,
  pageLimit,
  truncate,
  type PublicUserDto,
  type Queryable,
  type TripCategoryCode
} from "./common.js";
import type { CommsConfig } from "./config.js";
import { err } from "./errors.js";

export type MessageKind = "text" | "location";
export type TripStatusCode = "draft" | "published" | "active" | "completed" | "cancelled";

export type ConversationLastMessageDto = {
  id: string;
  kind: MessageKind;
  preview: string;
  senderId: string;
  mine: boolean;
  createdAt: string;
};

export type ConversationSummaryDto = {
  id: string;
  kind: "direct" | "group";
  title: string;
  subtitle: string | null;
  peer: PublicUserDto | null;
  memberCount: number | null;
  myRole: ConversationRole;
  category: TripCategoryCode;
  provinceName: string | null;
  tripId: string | null;
  bookingId: string | null;
  lastMessage: ConversationLastMessageDto | null;
  unreadCount: number;
  lastActivityAt: string;
};

export type ConversationDetailDto = ConversationSummaryDto & {
  trip: {
    id: string;
    status: TripStatusCode;
    departureAt: string | null;
    arrivalEstimateAt: string | null;
    originLabel: string | null;
    destinationLabel: string | null;
  } | null;
  booking: { id: string; status: "confirmed" | "completed"; seats: number } | null;
  pickupPoint: { label: string | null; lat: number; lng: number } | null;
  contribution: MoneyDto | null;
  routeLabel: string | null;
  members: Array<{ user: PublicUserDto; role: ConversationRole }> | null;
};

const DELETED_USER_NAME = "Usuario eliminado";

/** Texto de una línea para filas de bandeja y avisos. */
export function messagePreview(kind: string, body: string | null, label: string | null, hidden: boolean): string {
  if (hidden) return "Mensaje retirado";
  if (kind === "location") return label ? `Ubicación: ${truncate(label, 100)}` : "Ubicación compartida";
  return truncate(body ?? "", 140);
}

/** «Ruta Sevilla · Trabajo» */
export function groupTitle(provinceName: string | null, category: TripCategoryCode): string {
  return provinceName ? `Ruta ${provinceName} · ${CATEGORY_SHORT_LABEL[category]}` : `Ruta · ${CATEGORY_SHORT_LABEL[category]}`;
}

function titleOf(user: PublicUserDto): string {
  return user.displayName === DELETED_USER_NAME ? user.displayName : user.firstName;
}

/* ───────────── Recolección de datos crudos ───────────── */

type DirectRaw = {
  conversation_id: string;
  trip_id: string;
  driver_user_id: string;
  passenger_user_id: string;
  booking_id: string;
  booking_created_at: Date;
  category: TripCategoryCode;
  province_name: string | null;
  peer_id: string;
  lm_id: string | null;
  lm_kind: MessageKind | null;
  lm_body: string | null;
  lm_label: string | null;
  lm_sender: string | null;
  lm_created_at: Date | null;
  lm_hidden_at: Date | null;
  unread: number;
  max_in_seq: string;
};

async function collectDirect(db: Queryable, userId: string, onlyConversationId?: string): Promise<DirectRaw[]> {
  const params: unknown[] = [userId];
  let only = "";
  if (onlyConversationId) {
    params.push(onlyConversationId);
    only = ` and c.id = $2`;
  }
  const rows = await db.query<DirectRaw>(
    `with elig as (
       ${eligibleDirectSql("$1")}
     )
     select c.id as conversation_id, e.trip_id, e.driver_user_id, e.passenger_user_id, e.booking_id, e.booking_created_at,
            t.category, prov.name as province_name, pr.peer_id,
            lm.id as lm_id, lm.kind as lm_kind, lm.body as lm_body, lm.location_label as lm_label,
            lm.sender_user_id as lm_sender, lm.created_at as lm_created_at, lm.hidden_at as lm_hidden_at,
            (select count(*)::int from trip_direct_messages m
              where m.trip_id = e.trip_id and m.recipient_user_id = $1 and m.sender_user_id = pr.peer_id
                and m.seq > coalesce(cp.last_read_seq, 0) and m.hidden_at is null) as unread,
            (select coalesce(max(m.seq), 0) from trip_direct_messages m
              where m.trip_id = e.trip_id and m.recipient_user_id = $1 and m.sender_user_id = pr.peer_id)::text as max_in_seq
       from elig e
       join chat_conversations c on c.kind = 'direct' and c.trip_id = e.trip_id and c.passenger_user_id = e.passenger_user_id
       join trips t on t.id = e.trip_id
       join provinces prov on prov.id = t.province_id
      cross join lateral (select case when e.driver_user_id = $1 then e.passenger_user_id else e.driver_user_id end as peer_id) pr
       left join chat_participants cp on cp.conversation_id = c.id and cp.user_id = $1
       left join lateral (
         select m.id, m.kind, m.body, m.location_label, m.sender_user_id, m.created_at, m.hidden_at
           from trip_direct_messages m
          where m.trip_id = e.trip_id
            and ((m.sender_user_id = e.driver_user_id and m.recipient_user_id = e.passenger_user_id)
              or (m.sender_user_id = e.passenger_user_id and m.recipient_user_id = e.driver_user_id))
          order by m.seq desc limit 1
       ) lm on true
      where true${only}`,
    params
  );
  return rows.rows;
}

type CounterRow = { conversationId: string; unread: number; maxInSeq: number };

/** Solo no leídos y último `seq` recibido de cada chat directo: sin vista previa, perfiles ni provincias (se usa en el sondeo de la insignia). */
async function collectDirectCounters(db: Queryable, userId: string): Promise<CounterRow[]> {
  const rows = await db.query<{ conversation_id: string; unread: number; max_in_seq: string }>(
    `with elig as (
       ${eligibleDirectSql("$1")}
     )
     select c.id as conversation_id,
            (select count(*)::int from trip_direct_messages m
              where m.trip_id = e.trip_id and m.recipient_user_id = $1 and m.sender_user_id = pr.peer_id
                and m.seq > coalesce(cp.last_read_seq, 0) and m.hidden_at is null) as unread,
            (select coalesce(max(m.seq), 0) from trip_direct_messages m
              where m.trip_id = e.trip_id and m.recipient_user_id = $1 and m.sender_user_id = pr.peer_id)::text as max_in_seq
       from elig e
       join chat_conversations c on c.kind = 'direct' and c.trip_id = e.trip_id and c.passenger_user_id = e.passenger_user_id
      cross join lateral (select case when e.driver_user_id = $1 then e.passenger_user_id else e.driver_user_id end as peer_id) pr
       left join chat_participants cp on cp.conversation_id = c.id and cp.user_id = $1`,
    [userId]
  );
  return rows.rows.map(row => ({ conversationId: row.conversation_id, unread: row.unread, maxInSeq: Number(row.max_in_seq) }));
}

type GroupRaw = {
  conversation: ConversationRow;
  membership: GroupMembership;
  myRole: ConversationRole;
  visibleFrom: Date;
  unread: number;
  maxInSeq: number;
  last: {
    id: string;
    kind: MessageKind;
    body: string;
    location_label: string | null;
    sender_user_id: string;
    created_at: Date;
    hidden_at: Date | null;
    sender_name: string | null;
    sender_status: string | null;
  } | null;
};

async function collectGroups(db: Queryable, userId: string, onlyConversationId?: string, withLast = true): Promise<GroupRaw[]> {
  const params: unknown[] = [userId];
  let only = "";
  if (onlyConversationId) {
    params.push(onlyConversationId);
    only = ` and c.id = $2`;
  }
  const candidates = await db.query<ConversationRow>(
    `select c.id, c.kind, c.trip_id, c.driver_user_id, c.passenger_user_id, c.route_key, c.created_at
       from chat_conversations c
      where c.kind = 'group'${only}
        and (c.driver_user_id = $1
          or exists (
            select 1
              from chat_trip_route_keys k
              join trips t on t.id = k.trip_id and t.status in ('published','active')
              join ride_requests r on r.trip_id = t.id and r.status = 'confirmed' and r.passenger_user_id = $1
              join bookings b on b.request_id = r.id and b.status = 'confirmed'
             where k.driver_user_id = c.driver_user_id and k.route_key = c.route_key))`,
    params
  );
  if (candidates.rows.length === 0) return [];
  const memberships = await loadGroupMemberships(db, candidates.rows.map(row => row.id));
  const result: GroupRaw[] = [];
  for (const conversation of candidates.rows) {
    const membership = memberships.get(conversation.id);
    if (!membership || !isGroupMember(membership, conversation.driver_user_id, userId)) continue;
    const isDriver = userId === conversation.driver_user_id;
    const visibleFrom = isDriver ? new Date(0) : (membership.passengers.get(userId) ?? new Date(0));
    const stats = await db.query<{ unread: number; max_in_seq: string }>(
      `select count(*) filter (where m.sender_user_id <> $2 and m.seq > coalesce(
                (select cp.last_read_seq from chat_participants cp where cp.conversation_id = $1 and cp.user_id = $2), 0)
                and m.hidden_at is null)::int as unread,
              coalesce(max(m.seq) filter (where m.sender_user_id <> $2), 0)::text as max_in_seq
         from chat_group_messages m
        where m.conversation_id = $1 and ${groupVisibilitySql("$2", "$3")}`,
      [conversation.id, userId, visibleFrom]
    );
    const last = withLast
      ? await db.query<NonNullable<GroupRaw["last"]>>(
          `select m.id, m.kind, m.body, m.location_label, m.sender_user_id, m.created_at, m.hidden_at,
                  p.display_name as sender_name, u.status as sender_status
             from chat_group_messages m
             join app_users u on u.id = m.sender_user_id
             left join profiles p on p.user_id = m.sender_user_id
            where m.conversation_id = $1 and ${groupVisibilitySql("$2", "$3")}
            order by m.seq desc limit 1`,
          [conversation.id, userId, visibleFrom]
        )
      : { rows: [] as Array<NonNullable<GroupRaw["last"]>> };
    result.push({
      conversation,
      membership,
      myRole: isDriver ? "driver" : "passenger",
      visibleFrom,
      unread: stats.rows[0]?.unread ?? 0,
      maxInSeq: Number(stats.rows[0]?.max_in_seq ?? 0),
      last: last.rows[0] ?? null
    });
  }
  return result;
}

export type RouteInfo = {
  tripId: string;
  category: TripCategoryCode;
  provinceName: string | null;
  originLabel: string | null;
  destinationLabel: string | null;
};

/** Viaje representativo de cada ruta de grupo (prefiere publicado/activo y el más reciente) con su provincia y etiquetas. */
export async function loadRouteInfo(db: Queryable, conversations: ConversationRow[]): Promise<Map<string, RouteInfo>> {
  const out = new Map<string, RouteInfo>();
  if (conversations.length === 0) return out;
  const rows = await db.query<{
    conversation_id: string;
    trip_id: string;
    category: TripCategoryCode;
    province_name: string | null;
    origin_label: string | null;
    destination_label: string | null;
  }>(
    `select c.id as conversation_id, t.id as trip_id, t.category, prov.name as province_name,
            (select s.label from trip_stops s where s.trip_id = t.id and s.kind = 'origin' order by s.seq limit 1) as origin_label,
            (select s.label from trip_stops s where s.trip_id = t.id and s.kind = 'destination' order by s.seq desc limit 1) as destination_label
       from chat_conversations c
       join lateral (
         select t2.id, t2.category, t2.province_id
           from chat_trip_route_keys k
           join trips t2 on t2.id = k.trip_id
          where k.driver_user_id = c.driver_user_id and k.route_key = c.route_key
          order by (t2.status in ('published','active')) desc, t2.departure_at desc nulls last
          limit 1
       ) t on true
       join provinces prov on prov.id = t.province_id
      where c.id = any($1::uuid[])`,
    [conversations.map(c => c.id)]
  );
  for (const row of rows.rows) {
    out.set(row.conversation_id, {
      tripId: row.trip_id,
      category: row.category,
      provinceName: row.province_name,
      originLabel: row.origin_label,
      destinationLabel: row.destination_label
    });
  }
  return out;
}

/* ───────────── Bandeja ───────────── */

type InboxItem = {
  dto: ConversationSummaryDto;
  activityMs: number;
  conversationId: string;
  maxInSeq: number;
  searchText: string;
  visibleFrom: Date | null;
};

async function buildInbox(db: Queryable, userId: string, config: CommsConfig, onlyConversationId?: string): Promise<InboxItem[]> {
  const [direct, groups] = await Promise.all([collectDirect(db, userId, onlyConversationId), collectGroups(db, userId, onlyConversationId)]);
  const userIds = new Set<string>();
  for (const row of direct) userIds.add(row.peer_id);
  const [peers, routes] = await Promise.all([
    loadPublicUsers(db, [...userIds], config),
    loadRouteInfo(db, groups.map(g => g.conversation))
  ]);
  const items: InboxItem[] = [];

  for (const row of direct) {
    const peer = peers.get(row.peer_id);
    if (!peer) continue;
    const mine = row.lm_sender === userId;
    const lastMessage: ConversationLastMessageDto | null =
      row.lm_id && row.lm_kind && row.lm_sender && row.lm_created_at
        ? {
            id: row.lm_id,
            kind: row.lm_kind,
            preview: messagePreview(row.lm_kind, row.lm_body, row.lm_label, row.lm_hidden_at !== null),
            senderId: row.lm_sender,
            mine,
            createdAt: iso(row.lm_created_at)
          }
        : null;
    const activity = row.lm_created_at ?? row.booking_created_at;
    items.push({
      dto: {
        id: row.conversation_id,
        kind: "direct",
        title: titleOf(peer),
        subtitle: [CATEGORY_ROUTE_LABEL[row.category], row.province_name].filter(Boolean).join(" · "),
        peer,
        memberCount: null,
        myRole: row.driver_user_id === userId ? "driver" : "passenger",
        category: row.category,
        provinceName: row.province_name,
        tripId: row.trip_id,
        bookingId: row.booking_id,
        lastMessage,
        unreadCount: row.unread,
        lastActivityAt: iso(activity)
      },
      activityMs: activity.getTime(),
      conversationId: row.conversation_id,
      maxInSeq: Number(row.max_in_seq),
      searchText: peer.displayName,
      visibleFrom: null
    });
  }

  for (const group of groups) {
    const route = routes.get(group.conversation.id);
    if (!route) continue;
    const title = groupTitle(route.provinceName, route.category);
    const last = group.last;
    let lastMessage: ConversationLastMessageDto | null = null;
    if (last) {
      const mine = last.sender_user_id === userId;
      const senderName = last.sender_status === "deleted" ? DELETED_USER_NAME : (last.sender_name?.trim().split(/\s+/)[0] ?? "Usuario");
      const body = messagePreview(last.kind, last.body, last.location_label, last.hidden_at !== null);
      lastMessage = {
        id: last.id,
        kind: last.kind,
        preview: last.hidden_at ? body : `${mine ? "Tú" : senderName}: ${body}`,
        senderId: last.sender_user_id,
        mine,
        createdAt: iso(last.created_at)
      };
    }
    const activity = last?.created_at ?? group.conversation.created_at;
    items.push({
      dto: {
        id: group.conversation.id,
        kind: "group",
        title,
        subtitle: null,
        peer: null,
        memberCount: group.membership.passengers.size + 1,
        myRole: group.myRole,
        category: route.category,
        provinceName: route.provinceName,
        tripId: route.tripId,
        bookingId: null,
        lastMessage,
        unreadCount: group.unread,
        lastActivityAt: iso(activity)
      },
      activityMs: activity.getTime(),
      conversationId: group.conversation.id,
      maxInSeq: group.maxInSeq,
      searchText: title,
      visibleFrom: group.visibleFrom
    });
  }
  return items;
}

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Marca como «entregados» los mensajes recibidos de las conversaciones consultadas (la app los ha recibido). */
async function bumpDelivered(db: Queryable, userId: string, items: Array<{ conversationId: string; maxInSeq: number }>): Promise<void> {
  const useful = items.filter(item => item.maxInSeq > 0);
  if (useful.length === 0) return;
  await db.query(
    `update chat_participants p
        set last_delivered_seq = greatest(p.last_delivered_seq, v.max_seq)
       from unnest($2::uuid[], $3::bigint[]) as v(conversation_id, max_seq)
      where p.user_id = $1 and p.conversation_id = v.conversation_id and p.last_delivered_seq < v.max_seq`,
    [userId, useful.map(i => i.conversationId), useful.map(i => String(i.maxInSeq))]
  );
}

async function ensureAll(db: Queryable, userId: string): Promise<void> {
  await ensureDirectConversations(db, userId);
  await ensureGroupConversations(db, userId);
}

export type InboxFilter = "all" | "bookings" | "groups";

export async function listConversations(
  pool: Pool,
  userId: string,
  input: { filter?: InboxFilter; q?: string; limit?: number; cursor?: string },
  config: CommsConfig
): Promise<{ items: ConversationSummaryDto[]; nextCursor: string | null; unreadTotal: number }> {
  const limit = pageLimit(input.limit);
  const filter = input.filter ?? "all";
  await ensureAll(pool, userId);
  const all = await buildInbox(pool, userId, config);
  await ensureParticipants(pool, userId, all.map(item => item.conversationId));
  await bumpDelivered(pool, userId, all);
  const unreadTotal = all.reduce((sum, item) => sum + item.dto.unreadCount, 0);

  let visible = all.filter(item => (filter === "all" ? true : filter === "bookings" ? item.dto.kind === "direct" : item.dto.kind === "group"));

  const q = input.q?.trim();
  if (q) {
    const needle = normalizeText(q);
    const byName = new Set(visible.filter(item => normalizeText(item.searchText).includes(needle)).map(item => item.conversationId));
    const pattern = likePattern(q);
    const directIds = visible.filter(item => item.dto.kind === "direct").map(item => item.conversationId);
    const groupItems = visible.filter(item => item.dto.kind === "group");
    if (directIds.length > 0) {
      const hits = await pool.query<{ id: string }>(
        `select distinct c.id
           from chat_conversations c
           join trip_direct_messages m on m.trip_id = c.trip_id
            and ((m.sender_user_id = c.driver_user_id and m.recipient_user_id = c.passenger_user_id)
              or (m.sender_user_id = c.passenger_user_id and m.recipient_user_id = c.driver_user_id))
          where c.id = any($1::uuid[]) and m.hidden_at is null and m.body ilike $2`,
        [directIds, pattern]
      );
      for (const hit of hits.rows) byName.add(hit.id);
    }
    if (groupItems.length > 0) {
      const hits = await pool.query<{ conversation_id: string }>(
        `select distinct m.conversation_id
           from chat_group_messages m
           join unnest($1::uuid[], $2::timestamptz[]) as g(conversation_id, visible_from) on g.conversation_id = m.conversation_id
          where m.hidden_at is null and m.body ilike $3 and m.created_at >= g.visible_from
            and not ${blockedBetween("$4::uuid", "m.sender_user_id")}`,
        [groupItems.map(i => i.conversationId), groupItems.map(i => i.visibleFrom ?? new Date(0)), pattern, userId]
      );
      for (const hit of hits.rows) byName.add(hit.conversation_id);
    }
    visible = visible.filter(item => byName.has(item.conversationId));
  }

  visible.sort((a, b) => (b.activityMs - a.activityMs) || (a.conversationId < b.conversationId ? 1 : a.conversationId > b.conversationId ? -1 : 0));

  if (input.cursor) {
    const cursor = decodeCursor(input.cursor, { t: "number", id: "string" });
    const t = Number(cursor.t);
    const id = String(cursor.id);
    visible = visible.filter(item => item.activityMs < t || (item.activityMs === t && item.conversationId < id));
  }
  const page = visible.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = visible.length > limit && last ? encodeCursor({ t: last.activityMs, id: last.conversationId }) : null;
  return { items: page.map(item => item.dto), nextCursor, unreadTotal };
}

/**
 * Contador de la insignia de «Mensajes». Es el endpoint que la app sondea con más frecuencia, así que NO construye la bandeja:
 * solo recoge no leídos y último `seq` por conversación (sin vistas previas, perfiles ni etiquetas de ruta). Sigue marcando como
 * «entregados» los mensajes recibidos (consultar el contador es que el dispositivo los ha recibido).
 */
export async function getConversationUnreadCount(
  pool: Pool,
  userId: string
): Promise<{ total: number; direct: number; groups: number; conversationsWithUnread: number }> {
  await ensureAll(pool, userId);
  const [directRows, groupRows] = await Promise.all([collectDirectCounters(pool, userId), collectGroups(pool, userId, undefined, false)]);
  const groups: CounterRow[] = groupRows.map(group => ({ conversationId: group.conversation.id, unread: group.unread, maxInSeq: group.maxInSeq }));
  const withMessages = [...directRows, ...groups].filter(item => item.maxInSeq > 0);
  await ensureParticipants(pool, userId, withMessages.map(item => item.conversationId));
  await bumpDelivered(pool, userId, withMessages);
  const sum = (items: CounterRow[]) => items.reduce((total, item) => total + item.unread, 0);
  const direct = sum(directRows);
  const grouped = sum(groups);
  return {
    total: direct + grouped,
    direct,
    groups: grouped,
    conversationsWithUnread: [...directRows, ...groups].filter(item => item.unread > 0).length
  };
}

/* ───────────── Detalle (cabecera del chat, pantalla 26) ───────────── */

export async function loadTripLabels(
  db: Queryable,
  tripIds: string[]
): Promise<Map<string, { originLabel: string | null; destinationLabel: string | null }>> {
  const out = new Map<string, { originLabel: string | null; destinationLabel: string | null }>();
  if (tripIds.length === 0) return out;
  const rows = await db.query<{ trip_id: string; origin_label: string | null; destination_label: string | null }>(
    `select s.trip_id,
            (array_agg(s.label order by s.seq) filter (where s.kind = 'origin'))[1] as origin_label,
            (array_agg(s.label order by s.seq desc) filter (where s.kind = 'destination'))[1] as destination_label
       from trip_stops s
      where s.trip_id = any($1::uuid[])
      group by s.trip_id`,
    [[...new Set(tripIds)]]
  );
  for (const row of rows.rows) out.set(row.trip_id, { originLabel: row.origin_label, destinationLabel: row.destination_label });
  return out;
}

export async function getConversationDetail(
  pool: Pool,
  userId: string,
  conversationId: string,
  config: CommsConfig
): Promise<ConversationDetailDto> {
  const access = await resolveAccess(pool, userId, conversationId);
  await ensureParticipants(pool, userId, [conversationId]);
  const summary = (await buildInbox(pool, userId, config, conversationId)).find(item => item.conversationId === conversationId);
  if (!summary) throw err("CONVERSATION_NOT_FOUND", 404, "No encontramos esa conversación.");
  const base = summary.dto;

  if (access.kind === "direct") {
    const { party } = access;
    const [tripRow, labels, pickup, quote] = await Promise.all([
      pool.query<{ id: string; status: TripStatusCode; departure_at: Date | null; route_duration_s: number | null }>(
        `select id, status, departure_at, route_duration_s from trips where id = $1`,
        [party.tripId]
      ),
      loadTripLabels(pool, [party.tripId]),
      pool.query<{ label: string | null; lat: number; lng: number }>(
        `select s.label, ST_Y(s.geom) as lat, ST_X(s.geom) as lng
           from ride_requests r
           join trip_segments seg on seg.trip_id = r.trip_id and seg.seq = r.from_segment_seq
           join trip_stops s on s.trip_id = r.trip_id and s.seq = seg.from_stop_seq
          where r.id = $1`,
        [party.requestId]
      ),
      // Solo una cotización ligada a una tarifa APROBADA es un importe «definido»; si no, «Por definir».
      pool.query<{ contribution_cents: number }>(
        `select qs.contribution_cents
           from quote_snapshots qs
           join tariff_versions tv on tv.id = qs.tariff_version_id and tv.status = 'approved'
          where qs.request_id = $1
          order by qs.created_at desc limit 1`,
        [party.requestId]
      )
    ]);
    const trip = tripRow.rows[0];
    const label = labels.get(party.tripId);
    const pickupRow = pickup.rows[0];
    const quoteRow = quote.rows[0];
    return {
      ...base,
      trip: trip
        ? {
            id: trip.id,
            status: trip.status,
            departureAt: trip.departure_at ? iso(trip.departure_at) : null,
            arrivalEstimateAt:
              trip.departure_at && trip.route_duration_s
                ? new Date(trip.departure_at.getTime() + trip.route_duration_s * 1000).toISOString()
                : null,
            originLabel: label?.originLabel ?? null,
            destinationLabel: label?.destinationLabel ?? null
          }
        : null,
      booking: { id: party.bookingId, status: party.bookingStatus, seats: 1 },
      pickupPoint: pickupRow ? { label: pickupRow.label, lat: Number(pickupRow.lat), lng: Number(pickupRow.lng) } : null,
      contribution: quoteRow ? moneyDefined(Number(quoteRow.contribution_cents)) : moneyPending(),
      routeLabel: null,
      members: null
    };
  }

  const route = (await loadRouteInfo(pool, [access.conversation])).get(conversationId);
  const memberIds = [access.conversation.driver_user_id, ...access.membership.passengers.keys()];
  const users = await loadPublicUsers(pool, memberIds, config);
  const members: NonNullable<ConversationDetailDto["members"]> = [];
  for (const id of memberIds) {
    const user = users.get(id);
    if (user) members.push({ user, role: id === access.conversation.driver_user_id ? "driver" : "passenger" });
  }
  return {
    ...base,
    trip: null,
    booking: null,
    pickupPoint: null,
    contribution: null,
    routeLabel:
      route && (route.originLabel || route.destinationLabel)
        ? `${route.originLabel ?? "Origen"} → ${route.destinationLabel ?? "Destino"}`
        : null,
    members
  };
}

/** Abre (o recupera) el chat directo de una reserva. `created` indica si se ha creado ahora. */
export async function openDirectConversation(
  pool: Pool,
  userId: string,
  input: { tripId: string; peerUserId: string },
  config: CommsConfig
): Promise<{ detail: ConversationDetailDto; created: boolean }> {
  if (userId === input.peerUserId) throw err("CHAT_SELF_FORBIDDEN", 400, "No puedes abrir un chat contigo mismo.");
  const trip = await pool.query<{ driver_user_id: string }>(`select driver_user_id from trips where id = $1`, [input.tripId]);
  const driverId = trip.rows[0]?.driver_user_id;
  if (!driverId) throw err("TRIP_NOT_FOUND", 404, "No encontramos ese viaje.");

  let passengerId: string | null = null;
  if (userId === driverId && input.peerUserId !== driverId) passengerId = input.peerUserId;
  else if (input.peerUserId === driverId && userId !== driverId) passengerId = userId;
  const party = passengerId ? await findDirectParty(pool, input.tripId, passengerId) : null;
  if (!passengerId || !party) {
    throw err("CHAT_FORBIDDEN", 403, "El chat del viaje solo está disponible entre el conductor y un pasajero con reserva confirmada.");
  }
  if (await isBlockedPair(pool, driverId, passengerId)) {
    throw err("CHAT_BLOCKED", 403, "El chat no está disponible porque una de las personas ha bloqueado a la otra.");
  }
  const inserted = await pool.query<{ id: string }>(
    `insert into chat_conversations(kind, trip_id, driver_user_id, passenger_user_id)
     values('direct', $1, $2, $3)
     on conflict (trip_id, passenger_user_id) where kind = 'direct' do nothing
     returning id`,
    [input.tripId, driverId, passengerId]
  );
  let conversationId = inserted.rows[0]?.id;
  if (!conversationId) {
    const existing = await pool.query<{ id: string }>(
      `select id from chat_conversations where kind = 'direct' and trip_id = $1 and passenger_user_id = $2`,
      [input.tripId, passengerId]
    );
    conversationId = existing.rows[0]?.id;
  }
  if (!conversationId) throw new Error("direct conversation not found after upsert");
  return { detail: await getConversationDetail(pool, userId, conversationId, config), created: Boolean(inserted.rows[0]) };
}

export { loadConversation };
