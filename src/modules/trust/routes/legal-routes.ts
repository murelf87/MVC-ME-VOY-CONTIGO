import type { FastifyInstance } from "fastify";
import { trustError } from "../common.js";
import type { TrustContext } from "../context.js";
import { authenticate } from "../http.js";
import {
  LEGAL_CONTEXTS,
  LEGAL_KINDS,
  type LegalContext,
  type LegalKind,
  acceptLegalDocument,
  getLegalDocument,
  legalStatusForUser,
  listAcceptances,
  listLatestLegalDocuments,
  toLegalDocument,
  toLegalSummary
} from "../legal.js";
import { arr, enumOf, int, obj, str } from "../schemas.js";
import { RATE_LEGAL_ACCEPT, TAG_LEGAL, doc } from "./shared.js";
import { legalAcceptanceS, legalDocumentS, legalStatusS, legalSummaryS } from "./user-schemas.js";

const PUBLIC_CACHE = "public, max-age=60";

function parseKind(raw: string): LegalKind {
  if (!(LEGAL_KINDS as readonly string[]).includes(raw)) {
    throw trustError("LEGAL_DOCUMENT_NOT_FOUND", "No existe ese documento legal.", 404);
  }
  return raw as LegalKind;
}

/** Documentos legales versionados (términos, privacidad, cancelación y aviso de la comprobación privada) y aceptaciones. */
export function registerLegalRoutes(scope: FastifyInstance, ctx: TrustContext): void {
  scope.get(
    "/v1/legal/documents",
    {
      schema: doc({
        tags: [TAG_LEGAL],
        summary: "Últimas versiones de los documentos legales",
        description:
          "Sin sesión. «Vigente» = la última versión publicada; si no hay ninguna publicada, la versión más alta en borrador, marcada " +
          "`pendingLegalReview:true` y `legallyEffective:false` (sin validez legal hasta que Legal la revise y la publique).",
        auth: false,
        responses: { 200: obj({ items: arr(legalSummaryS) }) },
        errors: [429]
      })
    },
    async (_request, reply) => {
      const rows = await listLatestLegalDocuments(ctx.pool);
      reply.header("cache-control", PUBLIC_CACHE);
      return { items: rows.map(toLegalSummary) };
    }
  );

  scope.get(
    "/v1/legal/documents/:kind",
    {
      schema: doc({
        tags: [TAG_LEGAL],
        summary: "Versión vigente de un documento legal, con su texto por secciones",
        description: "Sin sesión. `kind`: `terms`, `privacy`, `cancellation` o `private_check_notice` (pantalla 07).",
        auth: false,
        params: obj({ kind: str({ maxLength: 40 }) }),
        responses: { 200: legalDocumentS },
        errors: [404, 429]
      })
    },
    async (request, reply) => {
      const kind = parseKind((request.params as { kind: string }).kind);
      const row = await getLegalDocument(ctx.pool, kind);
      reply.header("cache-control", PUBLIC_CACHE);
      return toLegalDocument(row);
    }
  );

  scope.get(
    "/v1/legal/documents/:kind/versions/:version",
    {
      schema: doc({
        tags: [TAG_LEGAL],
        summary: "Una versión concreta de un documento legal",
        description: "Sin sesión. El contenido de una versión es inmutable: una corrección es una versión nueva.",
        auth: false,
        params: obj({ kind: str({ maxLength: 40 }), version: int({ minimum: 1 }) }),
        responses: { 200: legalDocumentS },
        errors: [400, 404, 429]
      })
    },
    async (request, reply) => {
      const params = request.params as { kind: string; version: number };
      const row = await getLegalDocument(ctx.pool, parseKind(params.kind), params.version);
      reply.header("cache-control", PUBLIC_CACHE);
      return toLegalDocument(row);
    }
  );

  scope.get(
    "/v1/me/legal/status",
    {
      schema: doc({
        tags: [TAG_LEGAL],
        summary: "Qué documentos legales falta por aceptar",
        responses: { 200: legalStatusS },
        errors: [401, 403]
      })
    },
    async request => legalStatusForUser(ctx.pool, (await authenticate(ctx, request)).userId)
  );

  scope.get(
    "/v1/me/legal/acceptances",
    {
      schema: doc({
        tags: [TAG_LEGAL],
        summary: "Historial propio de aceptaciones",
        responses: { 200: obj({ items: arr(legalAcceptanceS) }) },
        errors: [401, 403]
      })
    },
    async request => ({ items: await listAcceptances(ctx.pool, (await authenticate(ctx, request)).userId) })
  );

  scope.post(
    "/v1/me/legal/acceptances",
    {
      config: { rateLimit: RATE_LEGAL_ACCEPT },
      schema: doc({
        tags: [TAG_LEGAL],
        summary: "Aceptar una versión de un documento legal",
        description:
          "Guarda persona usuaria, versión, instante y un HMAC de la IP (nunca la IP; sin `TRUST_IP_HASH_PEPPER` no se guarda hash). " +
          "`201` al crear y `200` si ya estaba aceptada (idempotente). Solo se puede aceptar la versión vigente. " +
          "Aceptar un borrador pendiente de revisión legal queda registrado como tal (`legallyEffective:false`).",
        body: obj(
          {
            kind: enumOf(LEGAL_KINDS),
            version: int({ minimum: 1 }),
            context: enumOf(LEGAL_CONTEXTS)
          },
          ["kind", "version"]
        ),
        responses: { 200: legalAcceptanceS, 201: legalAcceptanceS },
        errors: [400, 401, 403, 404, 409, 429]
      })
    },
    async (request, reply) => {
      const principal = await authenticate(ctx, request);
      const body = request.body as { kind: LegalKind; version: number; context?: LegalContext };
      const { created, acceptance } = await acceptLegalDocument(
        ctx,
        principal,
        { kind: body.kind, version: body.version, ...(body.context ? { context: body.context } : {}) },
        { ip: request.ip, requestId: request.id }
      );
      return reply.code(created ? 201 : 200).send(acceptance);
    }
  );
}
