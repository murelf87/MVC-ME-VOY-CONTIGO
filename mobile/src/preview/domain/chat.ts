/** Chat directo conductor ↔ pasajero confirmado y bloqueos (`src/chat/chat-service.ts`, formas heredadas 0.14). */
import type { PreviewDb } from "../core/db";
import { isUniqueViolation } from "../core/db";
import { ApiFailure } from "../core/errors";
import type { DirectMessageRow } from "../core/rows";
import type { Principal } from "../core/types";
import { iso } from "../core/wire";
import { writeAudit } from "./audit";

export function hasConfirmedBooking(db: PreviewDb, tripId: string, userId: string): boolean {
  return db.bookings.all().some((b) => {
    if (b.status !== "confirmed" && b.status !== "completed") return false;
    const request = db.rideRequests.get(b.request_id);
    return Boolean(request && request.trip_id === tripId && request.passenger_user_id === userId && request.status === "confirmed");
  });
}

export function assertTripDirectConversation(db: PreviewDb, principal: Principal, tripId: string, peerUserId: string): void {
  if (principal.userId === peerUserId) {
    throw new ApiFailure("CHAT_SELF_FORBIDDEN", "Cannot open a trip chat with yourself", 400);
  }
  const trip = db.trips.get(tripId);
  if (!trip) throw new ApiFailure("TRIP_NOT_FOUND", "Trip not found", 404);
  const principalIsDriver = principal.userId === trip.driver_user_id;
  const peerIsDriver = peerUserId === trip.driver_user_id;

  let allowed = false;
  if (principalIsDriver && !peerIsDriver) allowed = hasConfirmedBooking(db, tripId, peerUserId);
  else if (peerIsDriver && !principalIsDriver) allowed = hasConfirmedBooking(db, tripId, principal.userId);
  if (!allowed) {
    throw new ApiFailure("CHAT_FORBIDDEN", "Trip chat is only available between the driver and a confirmed passenger", 403);
  }
  if (isBlockedEitherWay(db, principal.userId, peerUserId)) {
    throw new ApiFailure("CHAT_BLOCKED", "Chat is unavailable because one participant blocked the other", 403);
  }
}

export function isBlockedEitherWay(db: PreviewDb, a: string, b: string): boolean {
  return db.blocks.has(`${a}:${b}`) || db.blocks.has(`${b}:${a}`);
}

export function messageWire(m: Readonly<DirectMessageRow>) {
  return {
    id: m.id,
    trip_id: m.trip_id,
    sender_user_id: m.sender_user_id,
    recipient_user_id: m.recipient_user_id,
    client_message_id: m.client_message_id,
    body: m.body,
    created_at: iso(m.created_at),
  };
}

export function sendTripDirectMessage(
  db: PreviewDb,
  principal: Principal,
  input: { tripId: string; peerUserId: string; clientMessageId: string; body: string },
  requestId?: string
) {
  assertTripDirectConversation(db, principal, input.tripId, input.peerUserId);
  const body = input.body.trim();
  if (body.length < 1 || body.length > 2000) {
    throw new ApiFailure("INVALID_CHAT_MESSAGE", "Message must contain 1 to 2000 characters");
  }
  return db.tx(() => {
    try {
      const row = db.messages.insert({
        id: db.ids.uuid(),
        trip_id: input.tripId,
        sender_user_id: principal.userId,
        recipient_user_id: input.peerUserId,
        client_message_id: input.clientMessageId,
        body,
        created_at: db.nowMs(),
        seq: db.ids.seq("trip_direct_messages"),
        kind: "text",
      });
      writeAudit(db, {
        actorUserId: principal.userId,
        action: "chat.message.sent",
        entityType: "trip_direct_message",
        entityId: row.id,
        requestId: requestId ?? null,
        metadata: { tripId: input.tripId, recipientUserId: input.peerUserId },
      });
      db.events.emit("message.sent", { message: row });
      return { ...messageWire(row), duplicate: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = db.messages.find(
        (m) => m.sender_user_id === principal.userId && m.client_message_id === input.clientMessageId
      );
      if (!existing) throw error;
      if (existing.trip_id !== input.tripId || existing.recipient_user_id !== input.peerUserId || existing.body !== body) {
        throw new ApiFailure("CHAT_IDEMPOTENCY_CONFLICT", "clientMessageId was already used for different content", 409);
      }
      return { ...messageWire(existing), duplicate: true };
    }
  });
}

export function listTripDirectMessages(
  db: PreviewDb,
  principal: Principal,
  input: { tripId: string; peerUserId: string; limit?: number }
) {
  assertTripDirectConversation(db, principal, input.tripId, input.peerUserId);
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ApiFailure("INVALID_CHAT_LIMIT", "Chat limit must be between 1 and 100");
  }
  return db.messages
    .filter(
      (m) =>
        m.trip_id === input.tripId &&
        ((m.sender_user_id === principal.userId && m.recipient_user_id === input.peerUserId) ||
          (m.sender_user_id === input.peerUserId && m.recipient_user_id === principal.userId))
    )
    .sort((a, b) => a.created_at - b.created_at || (a.seq ?? 0) - (b.seq ?? 0))
    .slice(0, limit)
    .map(messageWire);
}

export function blockUser(db: PreviewDb, principal: Principal, blockedUserId: string, requestId?: string): void {
  if (principal.userId === blockedUserId) throw new ApiFailure("BLOCK_SELF_FORBIDDEN", "Cannot block yourself");
  if (!db.users.has(blockedUserId)) throw new ApiFailure("USER_NOT_FOUND", "User not found", 404);
  const id = `${principal.userId}:${blockedUserId}`;
  if (!db.blocks.has(id)) {
    db.blocks.insert({ id, blocker_user_id: principal.userId, blocked_user_id: blockedUserId, created_at: db.nowMs() });
  }
  writeAudit(db, {
    actorUserId: principal.userId,
    action: "user.blocked",
    entityType: "user",
    entityId: blockedUserId,
    requestId: requestId ?? null,
  });
}

export function unblockUser(db: PreviewDb, principal: Principal, blockedUserId: string, requestId?: string): void {
  db.blocks.delete(`${principal.userId}:${blockedUserId}`);
  writeAudit(db, {
    actorUserId: principal.userId,
    action: "user.unblocked",
    entityType: "user",
    entityId: blockedUserId,
    requestId: requestId ?? null,
  });
}
