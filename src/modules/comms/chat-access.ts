import { err } from "./errors.js";
import type { Queryable } from "./common.js";

/**
 * Reglas de acceso al chat. TODO acceso se recalcula en cada petición desde reservas y bloqueos:
 * las filas de `chat_conversations`/`chat_participants` solo dan identidad estable y punteros de lectura, nunca permiso.
 */

export type ConversationKind = "direct" | "group";
export type ConversationRole = "driver" | "passenger";

export type ConversationRow = {
  id: string;
  kind: ConversationKind;
  trip_id: string | null;
  driver_user_id: string;
  passenger_user_id: string | null;
  route_key: string | null;
  created_at: Date;
};

export type DirectParty = {
  tripId: string;
  driverUserId: string;
  passengerUserId: string;
  requestId: string;
  bookingId: string;
  bookingStatus: "confirmed" | "completed";
  bookingCreatedAt: Date;
};

/** Condición SQL: existe un bloqueo en cualquiera de los dos sentidos entre las expresiones a y b. */
export function blockedBetween(a: string, b: string): string {
  return `exists (select 1 from user_blocks ub
                   where (ub.blocker_user_id = ${a} and ub.blocked_user_id = ${b})
                      or (ub.blocker_user_id = ${b} and ub.blocked_user_id = ${a}))`;
}

export async function isBlockedPair(db: Queryable, a: string, b: string): Promise<boolean> {
  const result = await db.query(
    `select 1 from user_blocks
      where (blocker_user_id = $1 and blocked_user_id = $2) or (blocker_user_id = $2 and blocked_user_id = $1)
      limit 1`,
    [a, b]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Reserva que habilita el chat directo: solicitud confirmada + reserva confirmada o completada (regla del chat 1:1 vigente). */
export async function findDirectParty(db: Queryable, tripId: string, passengerUserId: string): Promise<DirectParty | null> {
  const result = await db.query<{
    trip_id: string;
    driver_user_id: string;
    passenger_user_id: string;
    request_id: string;
    booking_id: string;
    booking_status: "confirmed" | "completed";
    booking_created_at: Date;
  }>(
    `select r.trip_id, t.driver_user_id, r.passenger_user_id, r.id as request_id,
            b.id as booking_id, b.status as booking_status, b.created_at as booking_created_at
       from bookings b
       join ride_requests r on r.id = b.request_id and r.status = 'confirmed'
       join trips t on t.id = r.trip_id
      where r.trip_id = $1 and r.passenger_user_id = $2 and b.status in ('confirmed','completed')
      order by b.created_at desc
      limit 1`,
    [tripId, passengerUserId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    tripId: row.trip_id,
    driverUserId: row.driver_user_id,
    passengerUserId: row.passenger_user_id,
    requestId: row.request_id,
    bookingId: row.booking_id,
    bookingStatus: row.booking_status,
    bookingCreatedAt: row.booking_created_at
  };
}

export async function loadConversation(db: Queryable, conversationId: string): Promise<ConversationRow | null> {
  const result = await db.query<ConversationRow>(
    `select id, kind, trip_id, driver_user_id, passenger_user_id, route_key, created_at
       from chat_conversations where id = $1`,
    [conversationId]
  );
  return result.rows[0] ?? null;
}

/**
 * Fragmento SQL (cuerpo de un CTE) con los chats directos a los que `userParam` tiene acceso AHORA: una fila por (viaje, pasajero) con
 * reserva `confirmed|completed`, solicitud confirmada y sin bloqueo entre conductor y pasajero. Es la única definición de «elegible» que usan
 * la bandeja y el contador de no leídos.
 */
export function eligibleDirectSql(userParam: string): string {
  return `select distinct on (r.trip_id, r.passenger_user_id)
                 r.trip_id, t.driver_user_id, r.passenger_user_id, b.id as booking_id, b.created_at as booking_created_at
            from bookings b
            join ride_requests r on r.id = b.request_id and r.status = 'confirmed'
            join trips t on t.id = r.trip_id
           where b.status in ('confirmed','completed')
             and (r.passenger_user_id = ${userParam} or t.driver_user_id = ${userParam})
             and not ${blockedBetween("t.driver_user_id", "r.passenger_user_id")}
           order by r.trip_id, r.passenger_user_id, b.created_at desc`;
}

/** Crea (si faltan) las conversaciones directas a las que la persona tiene derecho ahora mismo. Idempotente. */
export async function ensureDirectConversations(db: Queryable, userId: string): Promise<void> {
  await db.query(
    `insert into chat_conversations(kind, trip_id, driver_user_id, passenger_user_id)
     select distinct on (r.trip_id, r.passenger_user_id) 'direct', r.trip_id, t.driver_user_id, r.passenger_user_id
       from bookings b
       join ride_requests r on r.id = b.request_id and r.status = 'confirmed'
       join trips t on t.id = r.trip_id
      where b.status in ('confirmed','completed')
        and (r.passenger_user_id = $1 or t.driver_user_id = $1)
        and not ${blockedBetween("t.driver_user_id", "r.passenger_user_id")}
      order by r.trip_id, r.passenger_user_id
     on conflict (trip_id, passenger_user_id) where kind = 'direct' do nothing`,
    [userId]
  );
}

/** Crea (si faltan) los grupos de ruta recurrente de la persona (como pasajero con reserva confirmada o como conductor con pasajeros). */
export async function ensureGroupConversations(db: Queryable, userId: string): Promise<void> {
  await db.query(
    `insert into chat_conversations(kind, trip_id, driver_user_id, route_key)
     select distinct on (k.driver_user_id, k.route_key) 'group', t.id, k.driver_user_id, k.route_key
       from bookings b
       join ride_requests r on r.id = b.request_id and r.status = 'confirmed'
       join trips t on t.id = r.trip_id and t.status in ('published','active')
       join chat_trip_route_keys k on k.trip_id = t.id
      where r.passenger_user_id = $1 and b.status = 'confirmed'
        and not ${blockedBetween("k.driver_user_id", "r.passenger_user_id")}
      order by k.driver_user_id, k.route_key, t.departure_at nulls last
     on conflict (driver_user_id, route_key) where kind = 'group' do nothing`,
    [userId]
  );
  await db.query(
    `insert into chat_conversations(kind, trip_id, driver_user_id, route_key)
     select distinct on (k.route_key) 'group', t.id, k.driver_user_id, k.route_key
       from chat_trip_route_keys k
       join trips t on t.id = k.trip_id and t.status in ('published','active')
      where k.driver_user_id = $1
        and exists (select 1 from ride_requests r join bookings b on b.request_id = r.id and b.status = 'confirmed'
                     where r.trip_id = t.id and r.status = 'confirmed')
      order by k.route_key, t.departure_at nulls last
     on conflict (driver_user_id, route_key) where kind = 'group' do nothing`,
    [userId]
  );
}

export async function ensureParticipants(db: Queryable, userId: string, conversationIds: string[]): Promise<void> {
  if (conversationIds.length === 0) return;
  await db.query(
    `insert into chat_participants(conversation_id, user_id)
     select unnest($2::uuid[]), $1
     on conflict do nothing`,
    [userId, conversationIds]
  );
}

export type GroupMembership = {
  conversationId: string;
  driverId: string;
  /** Pasajeros con acceso ahora → instante de su primera reserva en la ruta (desde cuándo ven mensajes). */
  passengers: Map<string, Date>;
};

/**
 * Pertenencia derivada de los grupos: pasajeros con una reserva CONFIRMADA en un viaje publicado/activo de la ruta,
 * sin bloqueo con el conductor. El conductor es miembro si hay al menos un pasajero.
 */
export async function loadGroupMemberships(db: Queryable, conversationIds: string[]): Promise<Map<string, GroupMembership>> {
  const result = new Map<string, GroupMembership>();
  if (conversationIds.length === 0) return result;
  const rows = await db.query<{ conversation_id: string; driver_user_id: string; user_id: string; first_booking_at: Date }>(
    `select c.id as conversation_id, c.driver_user_id, r.passenger_user_id as user_id, min(b.created_at) as first_booking_at
       from chat_conversations c
       join chat_trip_route_keys k on k.driver_user_id = c.driver_user_id and k.route_key = c.route_key
       join trips t on t.id = k.trip_id
       join ride_requests r on r.trip_id = t.id and r.status = 'confirmed'
       join bookings b on b.request_id = r.id and b.status in ('confirmed','completed')
      where c.id = any($1::uuid[]) and c.kind = 'group'
        and not ${blockedBetween("c.driver_user_id", "r.passenger_user_id")}
      group by c.id, c.driver_user_id, r.passenger_user_id
     having bool_or(b.status = 'confirmed' and t.status in ('published','active'))`,
    [conversationIds]
  );
  for (const id of conversationIds) result.set(id, { conversationId: id, driverId: "", passengers: new Map() });
  for (const row of rows.rows) {
    const entry = result.get(row.conversation_id);
    if (!entry) continue;
    entry.driverId = row.driver_user_id;
    entry.passengers.set(row.user_id, row.first_booking_at);
  }
  return result;
}

export function isGroupMember(membership: GroupMembership, driverId: string, userId: string): boolean {
  return userId === driverId ? membership.passengers.size > 0 : membership.passengers.has(userId);
}

export type DirectAccess = {
  kind: "direct";
  conversation: ConversationRow;
  party: DirectParty;
  myRole: ConversationRole;
  peerUserId: string;
};

export type GroupAccess = {
  kind: "group";
  conversation: ConversationRow;
  membership: GroupMembership;
  myRole: ConversationRole;
  /** Los pasajeros solo ven mensajes posteriores a su primera reserva; el conductor lo ve todo. */
  visibleFrom: Date;
};

export type ConversationAccess = DirectAccess | GroupAccess;

const EPOCH = new Date(0);

/**
 * Resuelve el acceso de `userId` a una conversación o falla:
 *  · 404 CONVERSATION_NOT_FOUND si no existe o la persona nunca fue parte (no se revela su existencia);
 *  · 403 CHAT_BLOCKED / CHAT_FORBIDDEN si fue parte pero ya no tiene acceso (bloqueo, reserva cancelada, expulsada del grupo).
 */
export async function resolveAccess(db: Queryable, userId: string, conversationId: string): Promise<ConversationAccess> {
  const conversation = await loadConversation(db, conversationId);
  const notFound = () => err("CONVERSATION_NOT_FOUND", 404, "No encontramos esa conversación.");
  if (!conversation) throw notFound();

  if (conversation.kind === "direct") {
    if (conversation.trip_id === null || conversation.passenger_user_id === null) throw notFound();
    const isDriver = userId === conversation.driver_user_id;
    if (!isDriver && userId !== conversation.passenger_user_id) throw notFound();
    const party = await findDirectParty(db, conversation.trip_id, conversation.passenger_user_id);
    if (!party) {
      throw err("CHAT_FORBIDDEN", 403, "Ya no tienes acceso a este chat: la reserva no está vigente.");
    }
    if (await isBlockedPair(db, party.driverUserId, party.passengerUserId)) {
      throw err("CHAT_BLOCKED", 403, "El chat no está disponible porque una de las personas ha bloqueado a la otra.");
    }
    return {
      kind: "direct",
      conversation,
      party,
      myRole: isDriver ? "driver" : "passenger",
      peerUserId: isDriver ? conversation.passenger_user_id : conversation.driver_user_id
    };
  }

  const membership = (await loadGroupMemberships(db, [conversation.id])).get(conversation.id);
  const isDriver = userId === conversation.driver_user_id;
  if (membership && isGroupMember(membership, conversation.driver_user_id, userId)) {
    return {
      kind: "group",
      conversation,
      membership,
      myRole: isDriver ? "driver" : "passenger",
      visibleFrom: isDriver ? EPOCH : (membership.passengers.get(userId) ?? EPOCH)
    };
  }
  // No es miembro ahora: si nunca lo fue → 404; si lo fue (conductor del grupo o con puntero) → 403.
  const wasParticipant =
    isDriver ||
    ((await db.query(`select 1 from chat_participants where conversation_id = $1 and user_id = $2`, [conversationId, userId])).rowCount ?? 0) > 0;
  if (!wasParticipant) throw notFound();
  if (await isBlockedPair(db, userId, conversation.driver_user_id)) {
    throw err("CHAT_BLOCKED", 403, "El chat no está disponible porque una de las personas ha bloqueado a la otra.");
  }
  throw err("CHAT_FORBIDDEN", 403, "Ya no tienes acceso a este grupo: tu reserva en la ruta no está vigente.");
}

/**
 * Filtro SQL de mensajes de grupo visibles para el espectador (alias `m`): posteriores a su alta y sin bloqueo con el autor.
 * `viewer` y `from` son referencias a parámetros ($n).
 */
export function groupVisibilitySql(viewer: string, from: string): string {
  return `m.created_at >= ${from}::timestamptz and not ${blockedBetween(viewer, "m.sender_user_id")}`;
}
