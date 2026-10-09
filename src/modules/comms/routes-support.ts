import type { FastifyInstance } from "fastify";
import type { CommsRouteContext } from "./deps.js";
import { authenticate, idempotencyKeyOf, rateLimitKey } from "./http.js";
import {
  errorResponses,
  idempotencyHeaderSchema,
  pageQuerySchema,
  paramsOf,
  supportAttachmentDownloadSchema,
  supportAttachmentSchema,
  supportReplyBodySchema,
  supportTicketDetailSchema,
  supportTicketPageSchema,
  supportTicketsQuerySchema,
  supportTripPageSchema,
  supportUploadIntentBodySchema,
  supportUploadIntentSchema,
  createSupportTicketBodySchema,
  userSettingsPatchSchema,
  userSettingsSchema
} from "./schemas.js";
import { getUserSettings, updateUserSettings, type UserSettingsPatch } from "./settings.js";
import {
  closeSupportTicket,
  completeSupportUpload,
  createSupportAttachmentDownload,
  createSupportTicket,
  createSupportUploadIntent,
  getSupportTicket,
  listSupportTickets,
  listSupportTrips,
  replyToSupportTicket,
  type SupportCategory,
  type SupportTicketStatus
} from "./support.js";

const BEARER = [{ bearerAuth: [] }];
const TAG = ["Centro de ayuda"];
const TAG_SETTINGS = ["Ajustes"];

const READ_LIMIT = { max: 120, timeWindow: "1 minute", keyGenerator: rateLimitKey } as const;
const WRITE_LIMIT = { max: 60, timeWindow: "1 minute", keyGenerator: rateLimitKey } as const;
const TICKET_LIMIT = { max: 10, timeWindow: "1 hour", keyGenerator: rateLimitKey } as const;
const UPLOAD_LIMIT = { max: 30, timeWindow: "1 hour", keyGenerator: rateLimitKey } as const;

export function registerSupportRoutes(app: FastifyInstance, ctx: CommsRouteContext): void {
  const { pool, config, storage, uploadTtlSeconds } = ctx;

  app.get<{ Querystring: { limit?: number; cursor?: string } }>(
    "/v1/me/support/trips",
    {
      config: { rateLimit: READ_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Viajes para vincular a una consulta",
        description: "Selector «Selecciona un viaje (opcional)»: viajes en los que participé (como conductor o con reserva), del más reciente al más antiguo. Sin borradores.",
        querystring: pageQuerySchema,
        response: { 200: supportTripPageSchema, ...errorResponses(400, 401, 403, 429) }
      }
    },
    async request => {
      const auth = await authenticate(pool, request);
      const { limit, cursor } = request.query;
      return listSupportTrips(pool, auth.userId, { ...(limit !== undefined ? { limit } : {}), ...(cursor ? { cursor } : {}) });
    }
  );

  app.post<{ Body: { contentType: string; sizeBytes: number } }>(
    "/v1/me/support/uploads/intents",
    {
      config: { rateLimit: UPLOAD_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Preparar la subida de una imagen privada",
        description:
          "«Adjuntar imágenes (opcional)». Devuelve una URL firmada para `PUT` con las cabeceras indicadas. Requiere almacenamiento privado configurado: si no, 503 PRIVATE_STORAGE_NOT_CONFIGURED " +
          "(la consulta se puede enviar igualmente sin imágenes). Tipos: JPEG, PNG, WebP, HEIC, HEIF; 1 B – 10 MiB.",
        body: supportUploadIntentBodySchema,
        response: { 201: supportUploadIntentSchema, ...errorResponses(400, 401, 403, 422, 429, 503) }
      }
    },
    async (request, reply) => {
      const auth = await authenticate(pool, request);
      const intent = await createSupportUploadIntent(pool, auth.userId, storage, uploadTtlSeconds, request.body);
      return reply.code(201).send(intent);
    }
  );

  app.post<{ Params: { intentId: string } }>(
    "/v1/me/support/uploads/:intentId/complete",
    {
      config: { rateLimit: UPLOAD_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Completar la subida de una imagen",
        description:
          "Comprueba que el archivo existe, que su tamaño y tipo son los declarados y que el contenido es realmente una imagen. 201 al registrar el adjunto; repetir devuelve el mismo (200).",
        params: paramsOf("intentId"),
        response: {
          200: supportAttachmentSchema,
          201: supportAttachmentSchema,
          ...errorResponses(400, 401, 403, 404, 409, 410, 422, 429, 503)
        }
      }
    },
    async (request, reply) => {
      const auth = await authenticate(pool, request);
      const result = await completeSupportUpload(pool, auth.userId, storage, request.params.intentId);
      return reply.code(result.created ? 201 : 200).send(result.attachment);
    }
  );

  app.get<{ Params: { attachmentId: string } }>(
    "/v1/me/support/attachments/:attachmentId/download",
    {
      config: { rateLimit: READ_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "URL firmada de un adjunto propio",
        description: "Válida 5 minutos y solo para la persona que lo subió. Ajeno o inexistente: 404.",
        params: paramsOf("attachmentId"),
        response: { 200: supportAttachmentDownloadSchema, ...errorResponses(400, 401, 403, 404, 409, 429, 503) }
      }
    },
    async request =>
      createSupportAttachmentDownload(pool, (await authenticate(pool, request)).userId, storage, request.params.attachmentId)
  );

  app.post<{
    Body: { category: SupportCategory; body: string; tripId?: string; bookingId?: string; attachmentIds?: string[] };
  }>(
    "/v1/me/support/tickets",
    {
      config: { rateLimit: TICKET_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Enviar una consulta al centro de ayuda",
        description:
          "Categorías: Problema en un viaje · Problema de pago · Mi perfil y cuenta. Texto de 1 a 500 caracteres; viaje/reserva opcionales (solo los propios); hasta 4 imágenes ya completadas. " +
          "Topes: 10 consultas abiertas y 5 al día. Cabecera opcional `Idempotency-Key`: repetirla devuelve la misma consulta (200).",
        headers: idempotencyHeaderSchema,
        body: createSupportTicketBodySchema,
        response: { 200: supportTicketDetailSchema, 201: supportTicketDetailSchema, ...errorResponses(400, 401, 403, 409, 422, 429) }
      }
    },
    async (request, reply) => {
      const auth = await authenticate(pool, request);
      const result = await createSupportTicket(
        pool,
        auth.userId,
        { ...request.body, idempotencyKey: idempotencyKeyOf(request) },
        config,
        request.id
      );
      return reply.code(result.created ? 201 : 200).send(result.ticket);
    }
  );

  app.get<{ Querystring: { status?: SupportTicketStatus; limit?: number; cursor?: string } }>(
    "/v1/me/support/tickets",
    {
      config: { rateLimit: READ_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Mis consultas",
        description: "Más recientes primero por última actividad. `status` = open | answered | closed.",
        querystring: supportTicketsQuerySchema,
        response: { 200: supportTicketPageSchema, ...errorResponses(400, 401, 403, 429) }
      }
    },
    async request => {
      const auth = await authenticate(pool, request);
      const { status, limit, cursor } = request.query;
      return listSupportTickets(pool, auth.userId, {
        ...(status ? { status } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(cursor ? { cursor } : {})
      });
    }
  );

  app.get<{ Params: { ticketId: string } }>(
    "/v1/me/support/tickets/:ticketId",
    {
      config: { rateLimit: READ_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Hilo de una consulta",
        description: "La consulta original, las respuestas del equipo (`authorType: staff`, «Equipo MVC») y mis respuestas. Ajena o inexistente: 404.",
        params: paramsOf("ticketId"),
        response: { 200: supportTicketDetailSchema, ...errorResponses(400, 401, 403, 404, 429) }
      }
    },
    async request => getSupportTicket(pool, (await authenticate(pool, request)).userId, request.params.ticketId, config)
  );

  app.post<{ Params: { ticketId: string }; Body: { body: string; attachmentIds?: string[] } }>(
    "/v1/me/support/tickets/:ticketId/replies",
    {
      config: { rateLimit: TICKET_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Responder en una consulta",
        description: "1–1000 caracteres y hasta 4 imágenes. Si estaba respondida vuelve a abierta. Una consulta cerrada responde 409 SUPPORT_TICKET_CLOSED.",
        params: paramsOf("ticketId"),
        body: supportReplyBodySchema,
        response: { 201: supportTicketDetailSchema, ...errorResponses(400, 401, 403, 404, 409, 422, 429) }
      }
    },
    async (request, reply) => {
      const auth = await authenticate(pool, request);
      const ticket = await replyToSupportTicket(pool, auth.userId, request.params.ticketId, request.body, config);
      return reply.code(201).send(ticket);
    }
  );

  app.post<{ Params: { ticketId: string } }>(
    "/v1/me/support/tickets/:ticketId/close",
    {
      config: { rateLimit: WRITE_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Cerrar una consulta",
        description: "Idempotente. Una consulta cerrada no se puede reabrir: hay que enviar una nueva.",
        params: paramsOf("ticketId"),
        response: { 200: supportTicketDetailSchema, ...errorResponses(400, 401, 403, 404, 429) }
      }
    },
    async request =>
      closeSupportTicket(pool, (await authenticate(pool, request)).userId, request.params.ticketId, config, request.id)
  );

  /* ───────────── Ajustes ───────────── */

  app.get(
    "/v1/me/settings",
    {
      config: { rateLimit: READ_LIMIT },
      schema: {
        tags: TAG_SETTINGS,
        security: BEARER,
        summary: "Ajustes de la cuenta",
        description:
          "Cabecera de perfil y «Mi móvil», «Compartir ubicación en viaje — solo durante el trayecto activo», «Tamaño de letra» e idioma. " +
          "`account.pendingDeletion` aparece si hay una eliminación de cuenta programada.",
        response: { 200: userSettingsSchema, ...errorResponses(401, 403, 429) }
      }
    },
    async request => getUserSettings(pool, (await authenticate(pool, request)).userId, config)
  );

  app.patch<{ Body: UserSettingsPatch }>(
    "/v1/me/settings",
    {
      config: { rateLimit: WRITE_LIMIT },
      schema: {
        tags: TAG_SETTINGS,
        security: BEARER,
        summary: "Cambiar ajustes",
        description:
          "Cuerpo parcial. `shareLiveLocationInTrip: false` impide que el módulo de viaje en vivo muestre la posición precisa de la persona a los demás participantes. " +
          "`fontScale`: small | normal | large | extra_large.",
        body: userSettingsPatchSchema,
        response: { 200: userSettingsSchema, ...errorResponses(400, 401, 403, 429) }
      }
    },
    async request => updateUserSettings(pool, (await authenticate(pool, request)).userId, request.body, config)
  );
}
