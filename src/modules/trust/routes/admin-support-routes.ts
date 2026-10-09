import type { FastifyInstance } from "fastify";
import type { TrustContext } from "../context.js";
import { adminGuard, auditAdmin, authorizeAdmin } from "../http.js";
import {
  LEGAL_KINDS,
  type LegalKind,
  type LegalSection,
  adminCreateLegalDocument,
  adminListLegalDocuments,
  adminPublishLegalDocument
} from "../legal.js";
import {
  type TicketCategory,
  type TicketStatus,
  assignTicket,
  closeTicket,
  getTicketDetail,
  issueAttachmentAccess,
  listTickets,
  replyToTicket
} from "../support.js";
import { arr, enumOf, obj, pageQuery, queryObj, str, nullable, uuidParam } from "../schemas.js";
import { RATE_ADMIN_WRITE, TAG_ADMIN_LEGAL, TAG_ADMIN_SUPPORT, doc } from "./shared.js";
import { attachmentAccessS, ticketDetailS, ticketsPageS } from "./admin-schemas.js";
import { legalDocumentS, legalSectionInputS, legalSummaryS } from "./user-schemas.js";

/** Condiciones y políticas (alta de versiones y publicación con referencia de revisión legal) y atención al cliente. */
export function registerAdminSupportRoutes(scope: FastifyInstance, ctx: TrustContext): void {
  /* ───────── Documentos legales (admin) ───────── */

  scope.get(
    "/v1/admin/legal/documents",
    {
      preValidation: adminGuard(ctx, "legal", "read"),
      schema: doc({
        tags: [TAG_ADMIN_LEGAL],
        summary: "Todas las versiones de los documentos legales",
        responses: { 200: obj({ items: arr(legalSummaryS) }) },
        errors: [401, 403]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "legal", "read");
      const items = await adminListLegalDocuments(ctx.pool);
      await auditAdmin(ctx, request, principal, "admin.legal.listed", "legal_document", null, { returned: items.length });
      return { items };
    }
  );

  scope.post(
    "/v1/admin/legal/documents",
    {
      preValidation: adminGuard(ctx, "legal", "write"),
      config: { rateLimit: RATE_ADMIN_WRITE },
      schema: doc({
        tags: [TAG_ADMIN_LEGAL],
        summary: "Crear una versión nueva de un documento legal (nace como borrador pendiente de revisión legal)",
        description:
          "La versión es máximo + 1 del tipo. El contenido de una versión es inmutable: una corrección es una versión nueva. Solo el rol `admin`.",
        body: obj(
          {
            kind: enumOf(LEGAL_KINDS),
            title: str({ minLength: 1, maxLength: 300 }),
            sections: arr(legalSectionInputS, { maxItems: 80 })
          },
          ["kind", "title", "sections"]
        ),
        responses: { 201: legalDocumentS },
        errors: [400, 401, 403, 422, 429]
      })
    },
    async (request, reply) => {
      const principal = await authorizeAdmin(ctx, request, "legal", "write");
      const body = request.body as {
        kind: LegalKind;
        title: string;
        sections: Array<{ heading: string; paragraphs?: string[]; bullets?: string[] }>;
      };
      const sections: LegalSection[] = body.sections.map(s => ({ heading: s.heading, paragraphs: s.paragraphs ?? [], bullets: s.bullets ?? [] }));
      const created = await adminCreateLegalDocument(ctx, principal, { kind: body.kind, title: body.title, sections }, request.id);
      return reply.code(201).send(created);
    }
  );

  scope.post(
    "/v1/admin/legal/documents/:documentId/publish",
    {
      preValidation: adminGuard(ctx, "legal", "write"),
      config: { rateLimit: RATE_ADMIN_WRITE },
      schema: doc({
        tags: [TAG_ADMIN_LEGAL],
        summary: "Publicar una versión con la referencia de la revisión legal que la aprueba",
        description:
          "Exige `legalReviewReference` (acta, informe, ticket). La versión publicada anterior pasa a `retired`. Sin esa referencia no se puede publicar: " +
          "los textos sembrados siguen siendo borradores pendientes de revisión legal.",
        params: uuidParam("documentId"),
        body: obj(
          { legalReviewReference: str({ minLength: 1, maxLength: 300 }), effectiveFrom: str({ maxLength: 40 }) },
          ["legalReviewReference"]
        ),
        responses: { 200: legalDocumentS },
        errors: [400, 401, 403, 404, 409, 422, 429]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "legal", "write");
      const { documentId } = request.params as { documentId: string };
      const body = request.body as { legalReviewReference: string; effectiveFrom?: string };
      return adminPublishLegalDocument(
        ctx,
        principal,
        documentId,
        { legalReviewReference: body.legalReviewReference, ...(body.effectiveFrom !== undefined ? { effectiveFrom: body.effectiveFrom } : {}) },
        request.id
      );
    }
  );

  /* ───────── Atención al cliente (tablas de be-comms) ───────── */

  scope.get(
    "/v1/admin/support/tickets",
    {
      preValidation: adminGuard(ctx, "support", "read"),
      schema: doc({
        tags: [TAG_ADMIN_SUPPORT],
        summary: "Cola de consultas de atención al cliente",
        description:
          "Lee las consultas del centro de ayuda (módulo comms). Sin esas tablas: `503 SUPPORT_UNAVAILABLE`. Más recientes primero con cursor opaco. " +
          "Acceso a datos de personas usuarias: queda auditado.",
        querystring: queryObj({
          status: enumOf(["open", "answered", "closed", "all"], { default: "open" }),
          category: enumOf(["trip_issue", "payment_issue", "account_profile"]),
          assigned: enumOf(["any", "me", "unassigned"], { default: "any" }),
          ...pageQuery
        }),
        responses: { 200: ticketsPageS },
        errors: [400, 401, 403, 503]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "support", "read");
      const query = request.query as {
        status?: TicketStatus | "all";
        category?: TicketCategory;
        assigned?: "any" | "me" | "unassigned";
        cursor?: string;
        limit?: number;
      };
      const result = await listTickets(ctx.pool, principal, {
        status: query.status ?? "open",
        assigned: query.assigned ?? "any",
        ...(query.category ? { category: query.category } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {})
      });
      await auditAdmin(ctx, request, principal, "admin.support.tickets_listed", "support_ticket", null, {
        status: query.status ?? "open",
        category: query.category ?? null,
        assigned: query.assigned ?? "any",
        returned: result.items.length
      });
      return result;
    }
  );

  scope.get(
    "/v1/admin/support/tickets/:ticketId",
    {
      preValidation: adminGuard(ctx, "support", "read"),
      schema: doc({
        tags: [TAG_ADMIN_SUPPORT],
        summary: "Detalle de una consulta con su hilo de mensajes",
        params: uuidParam("ticketId"),
        responses: { 200: ticketDetailS },
        errors: [400, 401, 403, 404, 503]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "support", "read");
      const { ticketId } = request.params as { ticketId: string };
      const result = await getTicketDetail(ctx.pool, ticketId);
      await auditAdmin(ctx, request, principal, "admin.support.ticket_viewed", "support_ticket", ticketId);
      return result;
    }
  );

  scope.post(
    "/v1/admin/support/tickets/:ticketId/reply",
    {
      preValidation: adminGuard(ctx, "support", "write"),
      config: { rateLimit: RATE_ADMIN_WRITE },
      schema: doc({
        tags: [TAG_ADMIN_SUPPORT],
        summary: "Responder a una consulta (la persona usuaria recibe un aviso)",
        params: uuidParam("ticketId"),
        body: obj({ body: str({ minLength: 1, maxLength: 4000 }) }, ["body"]),
        responses: { 200: ticketDetailS },
        errors: [400, 401, 403, 404, 409, 429, 503]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "support", "write");
      const { ticketId } = request.params as { ticketId: string };
      return replyToTicket(ctx, principal, ticketId, (request.body as { body: string }).body, request.id);
    }
  );

  scope.post(
    "/v1/admin/support/tickets/:ticketId/assign",
    {
      preValidation: adminGuard(ctx, "support", "write"),
      config: { rateLimit: RATE_ADMIN_WRITE },
      schema: doc({
        tags: [TAG_ADMIN_SUPPORT],
        summary: "Asignarme una consulta o quitar la asignación",
        params: uuidParam("ticketId"),
        body: obj({ assignee: enumOf(["me", "none"]) }, ["assignee"]),
        responses: { 200: ticketDetailS },
        errors: [400, 401, 403, 404, 429, 503]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "support", "write");
      const { ticketId } = request.params as { ticketId: string };
      return assignTicket(ctx, principal, ticketId, (request.body as { assignee: "me" | "none" }).assignee, request.id);
    }
  );

  scope.post(
    "/v1/admin/support/tickets/:ticketId/close",
    {
      preValidation: adminGuard(ctx, "support", "write"),
      config: { rateLimit: RATE_ADMIN_WRITE },
      schema: doc({
        tags: [TAG_ADMIN_SUPPORT],
        summary: "Cerrar una consulta",
        params: uuidParam("ticketId"),
        responses: { 200: ticketDetailS },
        errors: [400, 401, 403, 404, 409, 429, 503]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "support", "write");
      const { ticketId } = request.params as { ticketId: string };
      return closeTicket(ctx, principal, ticketId, request.id);
    }
  );

  scope.post(
    "/v1/admin/support/attachments/:attachmentId/access",
    {
      preValidation: adminGuard(ctx, "support", "read"),
      config: { rateLimit: RATE_ADMIN_WRITE },
      schema: doc({
        tags: [TAG_ADMIN_SUPPORT],
        summary: "Ver un adjunto de una consulta: URL firmada de vida corta con auditoría previa",
        description:
          "Misma garantía que el acceso a evidencias: se firma, se audita y solo entonces se devuelve la URL (si la auditoría falla no sale ninguna). " +
          "Con el almacenamiento desactivado: `503 PRIVATE_STORAGE_DISABLED`.",
        params: uuidParam("attachmentId"),
        body: nullable(obj({ note: str({ maxLength: 500 }) }, [])),
        responses: { 200: attachmentAccessS },
        errors: [400, 401, 403, 404, 409, 429, 503]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "support", "read");
      const { attachmentId } = request.params as { attachmentId: string };
      const body = (request.body ?? {}) as { note?: string };
      return issueAttachmentAccess(ctx, principal, attachmentId, body.note !== undefined ? { note: body.note } : {}, request.id);
    }
  );
}
