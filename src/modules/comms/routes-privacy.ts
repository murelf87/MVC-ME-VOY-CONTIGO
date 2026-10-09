import type { FastifyInstance } from "fastify";
import { cancelAccountDeletion, getAccountDeletionState, requestAccountDeletion } from "./account-deletion.js";
import { createDataExportDownload, getDataExport, listDataExports, requestDataExport } from "./data-export.js";
import type { CommsRouteContext } from "./deps.js";
import { authenticate, idempotencyKeyOf, rateLimitKey } from "./http.js";
import {
  accountDeletionStateSchema,
  dataExportDownloadSchema,
  dataExportPageSchema,
  dataExportSchema,
  errorResponses,
  idempotencyHeaderSchema,
  pageQuerySchema,
  paramsOf,
  requestAccountDeletionBodySchema
} from "./schemas.js";

const BEARER = [{ bearerAuth: [] }];
const TAG = ["Privacidad y datos"];

const READ_LIMIT = { max: 120, timeWindow: "1 minute", keyGenerator: rateLimitKey } as const;
const SENSITIVE_LIMIT = { max: 10, timeWindow: "1 hour", keyGenerator: rateLimitKey } as const;

export function registerPrivacyRoutes(app: FastifyInstance, ctx: CommsRouteContext): void {
  const { pool, config, rights } = ctx;

  app.post(
    "/v1/me/data-exports",
    {
      config: { rateLimit: SENSITIVE_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Solicitar la exportación de mis datos",
        description:
          "Genera un archivo JSON con SOLO los datos de la persona (perfil, viajes, reservas, mensajes, notificaciones, consultas…). Es asíncrono: 202 al registrar la petición; " +
          "consulta el estado con `GET /v1/me/data-exports/{id}`. Si ya hay una en curso se devuelve esa (200). Una exportación completada o en curso cada 24 h (429 EXPORT_RATE_LIMITED). " +
          "Sin almacenamiento privado configurado el estado es `blocked_storage_disabled`: no se genera ni se entrega nada. Cabecera opcional `Idempotency-Key`.",
        headers: idempotencyHeaderSchema,
        response: { 200: dataExportSchema, 202: dataExportSchema, ...errorResponses(400, 401, 403, 429) }
      }
    },
    async (request, reply) => {
      const auth = await authenticate(pool, request);
      const result = await requestDataExport(rights, auth.userId, { idempotencyKey: idempotencyKeyOf(request), requestId: request.id });
      return reply.code(result.created ? 202 : 200).send(result.export);
    }
  );

  app.get<{ Querystring: { limit?: number; cursor?: string } }>(
    "/v1/me/data-exports",
    {
      config: { rateLimit: READ_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Mis exportaciones de datos",
        querystring: pageQuerySchema,
        response: { 200: dataExportPageSchema, ...errorResponses(400, 401, 403, 429) }
      }
    },
    async request => {
      const auth = await authenticate(pool, request);
      const { limit, cursor } = request.query;
      return listDataExports(pool, auth.userId, { ...(limit !== undefined ? { limit } : {}), ...(cursor ? { cursor } : {}) });
    }
  );

  app.get<{ Params: { exportId: string } }>(
    "/v1/me/data-exports/:exportId",
    {
      config: { rateLimit: READ_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Estado de una exportación",
        description: "queued → processing → ready (descargable hasta `expiresAt`) | failed | blocked_storage_disabled | expired. Ajena o inexistente: 404.",
        params: paramsOf("exportId"),
        response: { 200: dataExportSchema, ...errorResponses(400, 401, 403, 404, 429) }
      }
    },
    async request => getDataExport(pool, (await authenticate(pool, request)).userId, request.params.exportId)
  );

  app.get<{ Params: { exportId: string } }>(
    "/v1/me/data-exports/:exportId/download",
    {
      config: { rateLimit: SENSITIVE_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "URL firmada de descarga de la exportación",
        description: "Válida 5 minutos; cada descarga queda auditada. 409 si aún no está lista, 410 si ha caducado.",
        params: paramsOf("exportId"),
        response: { 200: dataExportDownloadSchema, ...errorResponses(400, 401, 403, 404, 409, 410, 429, 503) }
      }
    },
    async request => createDataExportDownload(rights, (await authenticate(pool, request)).userId, request.params.exportId, request.id)
  );

  app.get(
    "/v1/me/account-deletion",
    {
      config: { rateLimit: READ_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Estado, bloqueos y plan de eliminación de cuenta",
        description:
          "`blockers`: lo que impide eliminar la cuenta ahora (viajes publicados o en curso, reservas confirmadas, solicitudes abiertas, reembolsos pendientes y los que registre cada módulo). " +
          "`plan` explica qué se borra, qué se anonimiza y qué se conserva por obligación legal.",
        response: { 200: accountDeletionStateSchema, ...errorResponses(401, 403, 429) }
      }
    },
    async request => getAccountDeletionState(pool, (await authenticate(pool, request)).userId, config)
  );

  app.post<{ Body: { confirmation: string; reason?: string } }>(
    "/v1/me/account-deletion",
    {
      config: { rateLimit: SENSITIVE_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Solicitar la eliminación de la cuenta",
        description:
          "Exige `confirmation: \"ELIMINAR\"` (422 si no coincide) y que no haya bloqueos (409 ACCOUNT_DELETION_BLOCKED con `details.blockers`). " +
          "Programa la eliminación tras un periodo de gracia; durante la gracia la cuenta sigue operativa y se puede cancelar. 201 al programar, 200 si ya había una solicitud vigente.",
        body: requestAccountDeletionBodySchema,
        response: { 200: accountDeletionStateSchema, 201: accountDeletionStateSchema, ...errorResponses(400, 401, 403, 409, 422, 429) }
      }
    },
    async (request, reply) => {
      const auth = await authenticate(pool, request);
      const result = await requestAccountDeletion(pool, auth.userId, request.body, config, request.id);
      return reply.code(result.created ? 201 : 200).send(result.state);
    }
  );

  app.post(
    "/v1/me/account-deletion/cancel",
    {
      config: { rateLimit: SENSITIVE_LIMIT },
      schema: {
        tags: TAG,
        security: BEARER,
        summary: "Cancelar la eliminación de la cuenta",
        description: "404 si no hay una solicitud vigente; 409 si ya está en curso.",
        response: { 200: accountDeletionStateSchema, ...errorResponses(401, 403, 404, 409, 429) }
      }
    },
    async request => cancelAccountDeletion(pool, (await authenticate(pool, request)).userId, config, request.id)
  );
}
