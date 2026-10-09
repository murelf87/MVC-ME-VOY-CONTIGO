/** Chat directo del viaje y bloqueos (`chat-routes`). */
import type { PreviewDb } from "../core/db";
import { reply, type PreviewRouter } from "../core/router";
import { blockUser, listTripDirectMessages, sendTripDirectMessage, unblockUser } from "../domain/chat";
import { uuidParam } from "./schemas";

const chatParams = {
  type: "object",
  required: ["tripId", "peerUserId"],
  properties: {
    tripId: { type: "string", format: "uuid" },
    peerUserId: { type: "string", format: "uuid" },
  },
} as const;

export function registerChat(r: PreviewRouter, db: PreviewDb): void {
  r.post<{ Params: { tripId: string; peerUserId: string }; Body: { clientMessageId: string; body: string } }>(
    "/v1/trips/:tripId/chat/:peerUserId/messages",
    {
      summary: "Enviar mensaje (idempotente por clientMessageId)",
      tags: ["chat"],
      schema: {
        params: chatParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["clientMessageId", "body"],
          properties: {
            clientMessageId: { type: "string", format: "uuid" },
            body: { type: "string", minLength: 1, maxLength: 2000 },
          },
        },
      },
    },
    (req) => {
      const message = sendTripDirectMessage(db, req.auth(), { ...req.params, ...req.body }, req.requestId);
      return message.duplicate ? reply.ok(message) : reply.created(message);
    }
  );

  r.get<{ Params: { tripId: string; peerUserId: string }; Query: { limit?: number } }>(
    "/v1/trips/:tripId/chat/:peerUserId/messages",
    {
      summary: "Mensajes de la conversación",
      tags: ["chat"],
      schema: {
        params: chatParams,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { limit: { type: "integer", minimum: 1, maximum: 100 } },
        },
      },
    },
    (req) => ({ messages: listTripDirectMessages(db, req.auth(), { ...req.params, ...req.query }) })
  );

  r.put<{ Params: { userId: string } }>(
    "/v1/me/blocks/:userId",
    { summary: "Bloquear a un usuario", tags: ["chat"], schema: { params: uuidParam("userId") } },
    (req) => {
      blockUser(db, req.auth(), req.params.userId, req.requestId);
      return reply.noContent();
    }
  );

  r.delete<{ Params: { userId: string } }>(
    "/v1/me/blocks/:userId",
    { summary: "Desbloquear a un usuario", tags: ["chat"], schema: { params: uuidParam("userId") } },
    (req) => {
      unblockUser(db, req.auth(), req.params.userId, req.requestId);
      return reply.noContent();
    }
  );
}
