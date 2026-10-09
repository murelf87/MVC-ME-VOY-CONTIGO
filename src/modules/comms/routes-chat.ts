import type { FastifyInstance } from "fastify";
import {
  getConversationDetail,
  getConversationUnreadCount,
  listConversations,
  openDirectConversation,
  type InboxFilter
} from "./chat-inbox.js";
import { getCallContact, listMessages, markConversationRead, sendMessage, type SendMessageInput } from "./chat-messages.js";
import type { CommsRouteContext } from "./deps.js";
import { authenticate, defaultEmptyBody, idempotencyKeyOf, rateLimitKey } from "./http.js";
import { createUserReport, listBlockedUsers, listMyReports, reportChatMessage, type ReportReason } from "./moderation.js";
import {
  blockedUserPageSchema,
  callContactSchema,
  chatMessageSchema,
  chatMessagePageSchema,
  conversationDetailSchema,
  conversationPageSchema,
  conversationUnreadCountSchema,
  conversationsQuerySchema,
  createReportBodySchema,
  errorResponses,
  idempotencyHeaderSchema,
  markReadBodySchema,
  markReadResponseSchema,
  messagesQuerySchema,
  openDirectBodySchema,
  pageQuerySchema,
  paramsOf,
  reportMessageBodySchema,
  sendMessageBodySchema,
  userReportPageSchema,
  userReportSchema
} from "./schemas.js";

const BEARER = [{ bearerAuth: [] }];
const TAG = ["Mensajes"];
const TAG_SAFETY = ["Bloqueos y denuncias"];

const READ_LIMIT = { max: 120, timeWindow: "1 minute", keyGenerator: rateLimitKey } as const;
const SEND_LIMIT = { max: 60, timeWindow: "1 minute", keyGenerator: rateLimitKey } as const;
const REPORT_LIMIT = { max: 10, timeWindow: "1 hour", keyGenerator: rateLimitKey } as const;
const CALL_LIMIT = { max: 30, timeWindow: "1 hour", keyGenerator: rateLimitKey } as const;

export function registerChatRoutes(app: FastifyInstance, ctx: CommsRouteContext): void {
  const { pool, config } = ctx;

  app.get<{ Querystring: { filter?: InboxFilter; q?: string; limit?: number; cursor?: string } }>(
    "/v1/conversations",
    {
      config: { rateLimit: READ_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Bandeja de mensajes",
        description:
          "Pantalla «Mensajes»: pestañas Todos / Mis reservas (`filter=bookings`) / Grupos (`filter=groups`) y búsqueda `q` por nombre, título de grupo o texto de los mensajes. " +
          "Solo conversaciones accesibles ahora (reserva vigente, sin bloqueos). Ordenadas por actividad. `unreadTotal` alimenta la insignia roja.",
        querystring: conversationsQuerySchema,
        response: { 200: conversationPageSchema, ...errorResponses(400, 401, 403, 429) }
      }
    },
    async request => {
      const auth = await authenticate(pool, request);
      const { filter, q, limit, cursor } = request.query;
      return listConversations(
        pool,
        auth.userId,
        { ...(filter ? { filter } : {}), ...(q ? { q } : {}), ...(limit !== undefined ? { limit } : {}), ...(cursor ? { cursor } : {}) },
        config
      );
    }
  );

  app.get(
    "/v1/conversations/unread-count",
    {
      config: { rateLimit: READ_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Mensajes sin leer",
        response: { 200: conversationUnreadCountSchema, ...errorResponses(401, 403, 429) }
      }
    },
    async request => getConversationUnreadCount(pool, (await authenticate(pool, request)).userId)
  );

  app.post<{ Body: { tripId: string; peerUserId: string } }>(
    "/v1/conversations/direct",
    {
      config: { rateLimit: SEND_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Abrir (o recuperar) el chat de una reserva",
        description:
          "Solo entre el conductor del viaje y un pasajero con reserva confirmada o completada, sin bloqueos. Idempotente: 201 si se crea, 200 si ya existía.",
        body: openDirectBodySchema,
        response: { 200: conversationDetailSchema, 201: conversationDetailSchema, ...errorResponses(400, 401, 403, 404, 429) }
      }
    },
    async (request, reply) => {
      const auth = await authenticate(pool, request);
      const result = await openDirectConversation(pool, auth.userId, request.body, config);
      return reply.code(result.created ? 201 : 200).send(result.detail);
    }
  );

  app.get<{ Params: { conversationId: string } }>(
    "/v1/conversations/:conversationId",
    {
      config: { rateLimit: READ_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Cabecera del chat",
        description:
          "Pantalla «Chat de reserva»: persona, viaje, reserva confirmada, punto de recogida y aporte del viaje (`pending_definition` = «Por definir» mientras no haya tarifa aprobada). " +
          "En grupos: ruta y miembros actuales. Una conversación ajena responde 404; si fuiste parte pero ya no tienes acceso, 403.",
        params: paramsOf("conversationId"),
        response: { 200: conversationDetailSchema, ...errorResponses(400, 401, 403, 404, 429) }
      }
    },
    async request => getConversationDetail(pool, (await authenticate(pool, request)).userId, request.params.conversationId, config)
  );

  app.get<{ Params: { conversationId: string }; Querystring: { limit?: number; cursor?: string; afterSeq?: number } }>(
    "/v1/conversations/:conversationId/messages",
    {
      config: { rateLimit: READ_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Mensajes de una conversación",
        description:
          "Orden cronológico ascendente. Sin parámetros: los últimos mensajes. `cursor`: página de mensajes más antiguos (`nextCursor`). " +
          "`afterSeq`: solo los posteriores a ese número (sondeo). Marca como entregados los recibidos. Los propios incluyen `receipt` (sent/delivered/read).",
        params: paramsOf("conversationId"),
        querystring: messagesQuerySchema,
        response: { 200: chatMessagePageSchema, ...errorResponses(400, 401, 403, 404, 429) }
      }
    },
    async request => {
      const auth = await authenticate(pool, request);
      const { limit, cursor, afterSeq } = request.query;
      return listMessages(pool, auth.userId, request.params.conversationId, {
        ...(limit !== undefined ? { limit } : {}),
        ...(cursor ? { cursor } : {}),
        ...(afterSeq !== undefined ? { afterSeq } : {})
      });
    }
  );

  app.post<{ Params: { conversationId: string }; Body: SendMessageInput }>(
    "/v1/conversations/:conversationId/messages",
    {
      config: { rateLimit: SEND_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Enviar un mensaje de texto o una ubicación",
        description:
          "`clientMessageId` (uuid del cliente) hace idempotente el reintento: mismo id y mismo contenido → 200 con el mismo mensaje; mismo id con otro contenido → 409. " +
          "Texto: 1–2000 caracteres. Ubicación: `location` con `lat`/`lng` válidos. Notas de voz e imágenes no están soportadas.",
        params: paramsOf("conversationId"),
        body: sendMessageBodySchema,
        response: { 200: chatMessageSchema, 201: chatMessageSchema, ...errorResponses(400, 401, 403, 404, 409, 422, 429) }
      }
    },
    async (request, reply) => {
      const auth = await authenticate(pool, request);
      const result = await sendMessage(pool, auth.userId, request.params.conversationId, request.body, config);
      return reply.code(result.created ? 201 : 200).send(result.message);
    }
  );

  app.post<{ Params: { conversationId: string }; Body: { upToSeq?: number } | undefined }>(
    "/v1/conversations/:conversationId/read",
    {
      config: { rateLimit: SEND_LIMIT },
      preValidation: defaultEmptyBody,
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Marcar la conversación como leída",
        description: "Sin cuerpo marca todo lo recibido; con `upToSeq` solo hasta ese mensaje. El puntero nunca retrocede ni supera lo recibido.",
        params: paramsOf("conversationId"),
        body: markReadBodySchema,
        response: { 200: markReadResponseSchema, ...errorResponses(400, 401, 403, 404, 429) }
      }
    },
    async request => {
      const auth = await authenticate(pool, request);
      return markConversationRead(pool, auth.userId, request.params.conversationId, request.body?.upToSeq);
    }
  );

  app.get<{ Params: { conversationId: string } }>(
    "/v1/conversations/:conversationId/call-contact",
    {
      config: { rateLimit: CALL_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Teléfono de la otra persona para «Llamar a …»",
        description:
          "Solo chats de reserva. El teléfono únicamente se entrega a la otra parte de una reserva confirmada, sin bloqueo y dentro de la ventana del viaje; " +
          "cada entrega queda auditada. Fuera de ventana o desactivado por configuración: `available:false` y `reason`.",
        params: paramsOf("conversationId"),
        response: { 200: callContactSchema, ...errorResponses(400, 401, 403, 404, 429) }
      }
    },
    async request => getCallContact(pool, (await authenticate(pool, request)).userId, request.params.conversationId, config)
  );

  app.post<{ Params: { conversationId: string; messageId: string }; Body: { reason: ReportReason; details?: string } }>(
    "/v1/conversations/:conversationId/messages/:messageId/report",
    {
      config: { rateLimit: REPORT_LIMIT },
      schema: {
        tags: TAG_SAFETY,
        security: BEARER,
        summary: "Denunciar un mensaje",
        description:
          "Crea una denuncia contra el autor del mensaje con una copia literal del mensaje como prueba. No se puede denunciar un mensaje propio. " +
          "Cabecera opcional `Idempotency-Key`.",
        params: paramsOf("conversationId", "messageId"),
        headers: idempotencyHeaderSchema,
        body: reportMessageBodySchema,
        response: { 200: userReportSchema, 201: userReportSchema, ...errorResponses(400, 401, 403, 404, 409, 422, 429) }
      }
    },
    async (request, reply) => {
      const auth = await authenticate(pool, request);
      const result = await reportChatMessage(
        pool,
        auth.userId,
        request.params.conversationId,
        request.params.messageId,
        { reason: request.body.reason, details: request.body.details, idempotencyKey: idempotencyKeyOf(request) },
        config,
        request.id
      );
      return reply.code(result.created ? 201 : 200).send(result.report);
    }
  );

  /* ───────────── Bloqueos y denuncias ───────────── */

  app.get<{ Querystring: { limit?: number; cursor?: string } }>(
    "/v1/me/blocks",
    {
      config: { rateLimit: READ_LIMIT },
      schema: {
        tags: TAG_SAFETY,
        security: BEARER,
        summary: "Personas que he bloqueado",
        description: "Más recientes primero. Para bloquear o desbloquear: `PUT/DELETE /v1/me/blocks/{userId}` (ya existentes).",
        querystring: pageQuerySchema,
        response: { 200: blockedUserPageSchema, ...errorResponses(400, 401, 403, 429) }
      }
    },
    async request => {
      const auth = await authenticate(pool, request);
      const { limit, cursor } = request.query;
      return listBlockedUsers(pool, auth.userId, { ...(limit !== undefined ? { limit } : {}), ...(cursor ? { cursor } : {}) }, config);
    }
  );

  app.post<{
    Body: {
      reportedUserId: string;
      reason: ReportReason;
      details?: string;
      tripId?: string;
      conversationId?: string;
      evidenceMessageIds?: string[];
    };
  }>(
    "/v1/me/reports",
    {
      config: { rateLimit: REPORT_LIMIT },
      schema: {
        tags: TAG_SAFETY,
        security: BEARER,
        summary: "Denunciar a una persona",
        description:
          "Solo a quien has compartido una reserva o una conversación. Hasta 10 mensajes de prueba de la conversación indicada (se guarda una copia literal). " +
          "Misma persona y motivo en 24 h → 409; máximo 10 denuncias al día → 429. Cabecera opcional `Idempotency-Key`. La persona denunciada nunca ve quién denunció.",
        headers: idempotencyHeaderSchema,
        body: createReportBodySchema,
        response: { 200: userReportSchema, 201: userReportSchema, ...errorResponses(400, 401, 403, 404, 409, 422, 429) }
      }
    },
    async (request, reply) => {
      const auth = await authenticate(pool, request);
      const result = await createUserReport(
        pool,
        auth.userId,
        { ...request.body, idempotencyKey: idempotencyKeyOf(request) },
        config,
        request.id
      );
      return reply.code(result.created ? 201 : 200).send(result.report);
    }
  );

  app.get<{ Querystring: { limit?: number; cursor?: string } }>(
    "/v1/me/reports",
    {
      config: { rateLimit: READ_LIMIT },
      schema: {
        tags: TAG_SAFETY,
        security: BEARER,
        summary: "Mis denuncias",
        description: "Solo las propias. El estado lo gestiona el equipo de MVC; la nota de resolución interna nunca se muestra.",
        querystring: pageQuerySchema,
        response: { 200: userReportPageSchema, ...errorResponses(400, 401, 403, 429) }
      }
    },
    async request => {
      const auth = await authenticate(pool, request);
      const { limit, cursor } = request.query;
      return listMyReports(pool, auth.userId, { ...(limit !== undefined ? { limit } : {}), ...(cursor ? { cursor } : {}) }, config);
    }
  );
}
