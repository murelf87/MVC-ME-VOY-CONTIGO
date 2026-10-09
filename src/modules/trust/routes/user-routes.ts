import type { FastifyInstance } from "fastify";
import { trustError } from "../common.js";
import type { TrustContext } from "../context.js";
import { authenticate } from "../http.js";
import { completePhotoUpload, createPhotoUploadIntent, getPhotoState } from "../photo.js";
import { completeSelfieUpload, createSelfieUploadIntent, getPrivateCheckState } from "../identity-check.js";
import { completeDocumentUpload, createDocumentUploadIntent } from "../identity-docs.js";
import { UPLOAD_POLICY, requireStorage } from "../uploads.js";
import { getVerificationOverview, updateOwnRoles } from "../verification.js";
import { arr, enumOf, obj, queryObj, str, uuidParam } from "../schemas.js";
import { RATE_COMPLETE, RATE_PUBLIC_PHOTO, RATE_UPLOAD, TAG_USER, doc } from "./shared.js";
import {
  documentCompletedS,
  overviewS,
  photoStateS,
  privateCheckS,
  uploadIntentBody,
  uploadIntentS
} from "./user-schemas.js";

const intentParams = uuidParam("intentId");

/** Pantallas 05 (foto de perfil), 06–08 (comprobación privada) y la alternativa «documento de identidad». */
export function registerUserRoutes(scope: FastifyInstance, ctx: TrustContext): void {
  scope.get(
    "/v1/me/verification",
    {
      schema: doc({
        tags: [TAG_USER],
        summary: "Estado de verificación: roles, foto de perfil, comprobación privada e identidad",
        description:
          "Agregado de la pantalla «Tu foto de perfil». Nunca falla por el almacenamiento: con el proveedor desactivado devuelve `uploadAvailable:false` y `previewUrl:null`. " +
          "La selfie no acredita identidad (`selfieAloneVerifiesIdentity:false`) y no hay biometría facial (`biometricMatching:\"not_activated\"`).",
        responses: { 200: overviewS },
        errors: [401, 403]
      })
    },
    async request => getVerificationOverview(ctx, await authenticate(ctx, request))
  );

  scope.put(
    "/v1/me/roles",
    {
      schema: doc({
        tags: [TAG_USER],
        summary: "Elegir rol: conductor, pasajero o ambos",
        description:
          "Chips «Conductor / Pasajero». Solo `passenger` y `driver`: los roles de personal no se pueden pedir por aquí. " +
          "No se puede dejar un rol mientras haya viajes publicados/en curso (conductor) o solicitudes/reservas abiertas (pasajero).",
        body: obj({ roles: arr(str({ maxLength: 40 }), { maxItems: 8 }) }, ["roles"]),
        responses: { 200: obj({ roles: arr(enumOf(["passenger", "driver"])) }) },
        errors: [400, 401, 403, 409, 422]
      })
    },
    async request => {
      const principal = await authenticate(ctx, request);
      const body = request.body as { roles: string[] };
      return updateOwnRoles(ctx, principal, body.roles, request.id);
    }
  );

  /* ───────── Foto de perfil (pantalla 05) ───────── */

  scope.get(
    "/v1/me/photo",
    {
      schema: doc({
        tags: [TAG_USER],
        summary: "Estado de la foto de perfil",
        description: "`latest.previewUrl` es una URL firmada de corta vida de su propia foto (solo con almacenamiento privado activo).",
        responses: { 200: photoStateS },
        errors: [401, 403]
      })
    },
    async request => getPhotoState(ctx, (await authenticate(ctx, request)).userId)
  );

  scope.post(
    "/v1/me/photo/upload-intents",
    {
      config: { rateLimit: RATE_UPLOAD },
      schema: doc({
        tags: [TAG_USER],
        summary: "Pedir la subida de la foto de perfil",
        description:
          "Devuelve una URL firmada de un solo uso para un `PUT` directo al almacenamiento privado. Con el proveedor desactivado responde `503 PRIVATE_STORAGE_DISABLED`.",
        body: uploadIntentBody(UPLOAD_POLICY.profile_photo.types, UPLOAD_POLICY.profile_photo.maxBytes),
        responses: { 201: uploadIntentS },
        errors: [400, 401, 403, 422, 429, 503]
      })
    },
    async (request, reply) => {
      const principal = await authenticate(ctx, request);
      const intent = await createPhotoUploadIntent(ctx, principal.userId, request.body as { contentType: string; sizeBytes: number });
      return reply.code(201).send(intent);
    }
  );

  scope.post(
    "/v1/me/photo/upload-intents/:intentId/complete",
    {
      config: { rateLimit: RATE_COMPLETE },
      schema: doc({
        tags: [TAG_USER],
        summary: "Confirmar la subida de la foto de perfil (pasa a revisión humana)",
        description:
          "Verifica en el servidor el objeto subido (tamaño, tipo y firma binaria) y registra la entrega en revisión. Idempotente. " +
          "Una entrega pendiente anterior pasa a `superseded`; la foto aprobada anterior sigue siendo la pública hasta que se apruebe la nueva.",
        params: intentParams,
        responses: { 200: photoStateS },
        errors: [400, 401, 403, 404, 409, 410, 422, 503]
      })
    },
    async request => {
      const principal = await authenticate(ctx, request);
      return completePhotoUpload(ctx, principal.userId, (request.params as { intentId: string }).intentId, request.id);
    }
  );

  /* ───────── Comprobación privada (pantallas 06, 07, 08) ───────── */

  scope.get(
    "/v1/me/identity-check",
    {
      schema: doc({
        tags: [TAG_USER],
        summary: "Estado de la comprobación privada (intentos, motivo, siguiente paso)",
        description:
          "Máquina de estados `not_started → in_review → completed | needs_retry | rejected`, máximo 3 capturas. Siempre hay alternativa (`canUseAlternative`): documento de identidad. " +
          "La revisión la hace una persona; no hay coincidencia facial ni prueba de vida.",
        responses: { 200: privateCheckS },
        errors: [401, 403]
      })
    },
    async request => getPrivateCheckState(ctx, (await authenticate(ctx, request)).userId)
  );

  scope.post(
    "/v1/me/identity-check/upload-intents",
    {
      config: { rateLimit: RATE_UPLOAD },
      schema: doc({
        tags: [TAG_USER],
        summary: "Pedir la subida de una captura (selfie) de la comprobación privada",
        description:
          "Exige haber aceptado la versión vigente del aviso de privacidad (`private_check_notice`, pantalla 07): si no, `409 PRIVATE_CHECK_CONSENT_REQUIRED`. " +
          "Con el almacenamiento desactivado: `503 PRIVATE_STORAGE_DISABLED`.",
        body: uploadIntentBody(UPLOAD_POLICY.identity_selfie.types, UPLOAD_POLICY.identity_selfie.maxBytes),
        responses: { 201: uploadIntentS },
        errors: [400, 401, 403, 409, 422, 429, 503]
      })
    },
    async (request, reply) => {
      const principal = await authenticate(ctx, request);
      const intent = await createSelfieUploadIntent(ctx, principal.userId, request.body as { contentType: string; sizeBytes: number });
      return reply.code(201).send(intent);
    }
  );

  scope.post(
    "/v1/me/identity-check/upload-intents/:intentId/complete",
    {
      config: { rateLimit: RATE_COMPLETE },
      schema: doc({
        tags: [TAG_USER],
        summary: "Confirmar la captura: cuenta el intento y la deja en revisión humana",
        description:
          "El intento se cuenta bajo bloqueo de base de datos: nunca más de 3. Idempotente. La selfie por sí sola no verifica la identidad.",
        params: intentParams,
        responses: { 200: privateCheckS },
        errors: [400, 401, 403, 404, 409, 410, 422, 503]
      })
    },
    async request => {
      const principal = await authenticate(ctx, request);
      return completeSelfieUpload(ctx, principal.userId, (request.params as { intentId: string }).intentId, request.id);
    }
  );

  /* ───────── «Otra forma de verificar»: documento de identidad / permiso de conducir ───────── */

  scope.post(
    "/v1/me/identity/documents/upload-intents",
    {
      config: { rateLimit: RATE_UPLOAD },
      schema: doc({
        tags: [TAG_USER],
        summary: "Pedir la subida de un documento de identidad o del permiso de conducir",
        description:
          "`identity_document` es la alternativa a la selfie y la única vía que puede dejar la identidad `verified` (tras la revisión de una persona). " +
          "`driver_license` exige rol conductor.",
        body: obj(
          {
            kind: enumOf(["identity_document", "driver_license"]),
            contentType: str({ minLength: 1, maxLength: 100, description: `Tipo MIME. Admitidos: ${UPLOAD_POLICY.identity_document.types.join(", ")}.` }),
            sizeBytes: { type: "integer", description: `Tamaño exacto en bytes (de 1 a ${UPLOAD_POLICY.identity_document.maxBytes}).` }
          },
          ["kind", "contentType", "sizeBytes"]
        ),
        responses: { 201: uploadIntentS },
        errors: [400, 401, 403, 409, 422, 429, 503]
      })
    },
    async (request, reply) => {
      const principal = await authenticate(ctx, request);
      const intent = await createDocumentUploadIntent(
        ctx,
        principal,
        request.body as { kind: "identity_document" | "driver_license"; contentType: string; sizeBytes: number }
      );
      return reply.code(201).send(intent);
    }
  );

  scope.post(
    "/v1/me/identity/documents/upload-intents/:intentId/complete",
    {
      config: { rateLimit: RATE_COMPLETE },
      schema: doc({
        tags: [TAG_USER],
        summary: "Confirmar el documento: queda en revisión humana",
        description: "Registra el documento con el servicio existente de documentos privados. Idempotente.",
        params: intentParams,
        responses: { 200: documentCompletedS },
        errors: [400, 401, 403, 404, 409, 410, 422, 503]
      })
    },
    async request => {
      const principal = await authenticate(ctx, request);
      return completeDocumentUpload(ctx, principal, (request.params as { intentId: string }).intentId, principal.roles);
    }
  );

  /* ───────── Foto pública (sin sesión) ───────── */

  scope.get(
    "/v1/public/users/:userId/photo",
    {
      config: { rateLimit: RATE_PUBLIC_PHOTO },
      schema: doc({
        tags: [TAG_USER],
        summary: "Foto de perfil aprobada (redirección a una URL firmada de vida corta)",
        description:
          "Sin sesión. Solo existe si el equipo aprobó la foto (`public_photo_status = approved`). Responde `302` a una URL firmada de corta vida con " +
          "`Cache-Control: public, max-age=300`; el parámetro `v` solo invalida cachés. Las claves de almacenamiento nunca se exponen.",
        auth: false,
        params: uuidParam("userId"),
        querystring: queryObj({ v: str({ maxLength: 16 }) }),
        responses: { 302: { description: "Redirección a la URL firmada de la imagen.", type: "null" } },
        errors: [400, 404, 429, 503]
      })
    },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const found = await ctx.pool.query<{ public_photo_key: string }>(
        `select p.public_photo_key
           from profiles p
           join app_users u on u.id = p.user_id
          where p.user_id = $1 and u.status = 'active'
            and p.public_photo_status = 'approved' and p.public_photo_key is not null`,
        [userId]
      );
      const key = found.rows[0]?.public_photo_key;
      if (!key) throw trustError("PHOTO_NOT_FOUND", "Esta persona no tiene una foto de perfil aprobada.", 404);
      const storage = requireStorage(ctx);
      const url = await storage.createDownloadUrl(key, ctx.config.publicPhotoTtlSeconds);
      reply.header("cache-control", "public, max-age=300");
      return reply.redirect(url, 302);
    }
  );
}
