import type { FastifyInstance } from "fastify";
import type { CommsRouteContext } from "./deps.js";
import { authenticate, defaultEmptyBody, rateLimitKey } from "./http.js";
import {
  deletePushToken,
  getNotificationPreferences,
  listNotifications,
  listPushTokens,
  markAllNotificationsRead,
  markNotificationRead,
  registerPushToken,
  unreadCounts,
  updateNotificationPreferences,
  type NotificationCategory
} from "./notifications.js";
import {
  errorResponses,
  notificationPageSchema,
  notificationPreferencesPatchSchema,
  notificationPreferencesSchema,
  notificationSchema,
  notificationUnreadCountSchema,
  notificationsQuerySchema,
  paramsOf,
  pushTokenBodySchema,
  pushTokenPageSchema,
  pushTokenSchema,
  readAllBodySchema,
  updatedCountSchema
} from "./schemas.js";

const BEARER = [{ bearerAuth: [] }];
const TAG = ["Notificaciones"];
const TAG_PUSH = ["Notificaciones push"];

const READ_LIMIT = { max: 120, timeWindow: "1 minute", keyGenerator: rateLimitKey } as const;
const WRITE_LIMIT = { max: 60, timeWindow: "1 minute", keyGenerator: rateLimitKey } as const;
const TOKEN_LIMIT = { max: 30, timeWindow: "1 hour", keyGenerator: rateLimitKey } as const;

export function registerNotificationRoutes(app: FastifyInstance, ctx: CommsRouteContext): void {
  const { pool, config } = ctx;

  app.get<{ Querystring: { category?: NotificationCategory; unread?: boolean; limit?: number; cursor?: string } }>(
    "/v1/notifications",
    {
      config: { rateLimit: READ_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Listar mis notificaciones",
        description:
          "Más recientes primero. `category` filtra por Viajes/Mensajes/Pagos (omitir = Todas, incluye `system`); `unread=true` solo las no leídas. " +
          "No incluye los avisos opcionales que la persona desactivó. `unreadCount` es el total de no leídas (insignia de la campana).",
        querystring: notificationsQuerySchema,
        response: { 200: notificationPageSchema, ...errorResponses(400, 401, 403, 429) }
      }
    },
    async request => {
      const auth = await authenticate(pool, request);
      const { category, unread, limit, cursor } = request.query;
      return listNotifications(pool, auth.userId, {
        ...(category ? { category } : {}),
        ...(unread !== undefined ? { unread } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(cursor ? { cursor } : {})
      });
    }
  );

  app.get(
    "/v1/notifications/unread-count",
    {
      config: { rateLimit: READ_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Contadores de notificaciones no leídas",
        response: { 200: notificationUnreadCountSchema, ...errorResponses(401, 403, 429) }
      }
    },
    async request => unreadCounts(pool, (await authenticate(pool, request)).userId)
  );

  app.post<{ Body: { category?: NotificationCategory } | undefined }>(
    "/v1/notifications/read-all",
    {
      config: { rateLimit: WRITE_LIMIT },
      preValidation: defaultEmptyBody,
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Marcar todas las notificaciones como leídas",
        description: "Cuerpo opcional `{ category }` para marcar solo una categoría. Sin cuerpo (o `{}`) marca todas.",
        body: readAllBodySchema,
        response: { 200: updatedCountSchema, ...errorResponses(400, 401, 403, 429) }
      }
    },
    async request => {
      const auth = await authenticate(pool, request);
      return markAllNotificationsRead(pool, auth.userId, request.body?.category);
    }
  );

  app.post<{ Params: { notificationId: string } }>(
    "/v1/notifications/:notificationId/read",
    {
      config: { rateLimit: WRITE_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Marcar una notificación como leída",
        description: "Idempotente. Una notificación ajena o inexistente responde 404.",
        params: paramsOf("notificationId"),
        response: { 200: notificationSchema, ...errorResponses(400, 401, 403, 404, 429) }
      }
    },
    async request => markNotificationRead(pool, (await authenticate(pool, request)).userId, request.params.notificationId)
  );

  app.get(
    "/v1/me/notification-preferences",
    {
      config: { rateLimit: READ_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Preferencias de notificaciones",
        description:
          "«Avisos esenciales del viaje» (siempre activos, no editables), «Avisos opcionales de llegada (recomendado)» y avisos de mensajes. " +
          "`push` informa de si hay entrega push (hoy no hay proveedor configurado).",
        response: { 200: notificationPreferencesSchema, ...errorResponses(401, 403, 429) }
      }
    },
    async request => getNotificationPreferences(pool, (await authenticate(pool, request)).userId, config)
  );

  app.patch<{ Body: { essentialTripNotices?: boolean; arrivalAlerts?: boolean; messages?: boolean } }>(
    "/v1/me/notification-preferences",
    {
      config: { rateLimit: WRITE_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Cambiar preferencias de notificaciones",
        description:
          "Los avisos esenciales del viaje no se pueden desactivar: enviar `essentialTripNotices: false` responde 422 ESSENTIAL_NOTICES_LOCKED. " +
          "Solo se pueden desactivar los avisos opcionales de llegada y los de mensajes.",
        body: notificationPreferencesPatchSchema,
        response: { 200: notificationPreferencesSchema, ...errorResponses(400, 401, 403, 422, 429) }
      }
    },
    async request => updateNotificationPreferences(pool, (await authenticate(pool, request)).userId, request.body, config)
  );

  /* ───────────── Dispositivos push ───────────── */

  app.get(
    "/v1/me/push-tokens",
    {
      config: { rateLimit: READ_LIMIT },
      schema: {
        tags: TAG_PUSH,
        security: BEARER,
        summary: "Mis dispositivos registrados para notificaciones push",
        description: "No devuelve el token en claro.",
        response: { 200: pushTokenPageSchema, ...errorResponses(401, 403, 429) }
      }
    },
    async request => ({ items: await listPushTokens(pool, (await authenticate(pool, request)).userId), nextCursor: null })
  );

  app.post<{ Body: { token: string; platform: "ios" | "android" | "web"; provider: "expo" | "fcm" | "apns"; deviceId?: string; appVersion?: string; locale?: string } }>(
    "/v1/me/push-tokens",
    {
      config: { rateLimit: TOKEN_LIMIT },
      schema: {
        tags: TAG_PUSH,
        security: BEARER,
        summary: "Registrar o actualizar el token push de este dispositivo",
        description:
          "201 si es nuevo, 200 si ya existía (refresca `lastSeenAt`). Un token pertenece a una sola persona: si otra cuenta lo tenía, pasa a quien lo registra. " +
          "El registro funciona aunque no haya proveedor de envío configurado (ver `push` en las preferencias).",
        body: pushTokenBodySchema,
        response: { 200: pushTokenSchema, 201: pushTokenSchema, ...errorResponses(400, 401, 403, 422, 429) }
      }
    },
    async (request, reply) => {
      const auth = await authenticate(pool, request);
      const result = await registerPushToken(pool, auth.userId, request.body);
      return reply.code(result.created ? 201 : 200).send(result.token);
    }
  );

  app.delete<{ Params: { tokenId: string } }>(
    "/v1/me/push-tokens/:tokenId",
    {
      config: { rateLimit: WRITE_LIMIT },
      schema: {
        tags: TAG_PUSH,
        security: BEARER,
        summary: "Dar de baja un dispositivo push",
        description: "La app lo llama al cerrar sesión. Ajeno o inexistente: 404.",
        params: paramsOf("tokenId"),
        response: { 204: { type: "null", description: "Dispositivo dado de baja" }, ...errorResponses(400, 401, 403, 404, 429) }
      }
    },
    async (request, reply) => {
      await deletePushToken(pool, (await authenticate(pool, request)).userId, request.params.tokenId);
      return reply.code(204).send();
    }
  );
}
