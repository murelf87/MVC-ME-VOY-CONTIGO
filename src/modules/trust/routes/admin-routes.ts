import type { FastifyInstance } from "fastify";
import type { TrustContext } from "../context.js";
import { adminGuard, auditAdmin, authorizeAdmin, authorizeStaff, staffGuard } from "../http.js";
import { listAdminBookings, type BookingStatusFilter } from "../bookings.js";
import { PERIODS, type Period } from "../period.js";
import { permissionsFor, staffRolesOf } from "../rbac.js";
import { ITEM_KEYS, listReviewQueue, type ItemKey } from "../review-queue.js";
import {
  type Decision,
  type EvidenceKind,
  type EvidencePurpose,
  decideReview,
  getDossier,
  issueEvidenceAccess
} from "../review.js";
import { getAdminSummary, getVehicleActivity } from "../summary.js";
import { arr, enumOf, obj, pageQuery, queryObj, str, uuidParam } from "../schemas.js";
import {
  adminMeS,
  bookingsPageS,
  decisionResultS,
  dossierS,
  evidenceAccessS,
  queuePageS,
  summaryS,
  vehicleActivityS
} from "./admin-schemas.js";
import {
  RATE_ADMIN_WRITE,
  TAG_ADMIN_BOOKINGS,
  TAG_ADMIN_REVIEW,
  TAG_ADMIN_SUMMARY,
  doc
} from "./shared.js";

const provinceQuery = { provinceId: str({ format: "uuid", description: "Omitido = todas las provincias." }) };

/** Pantallas 37 (resumen), 38 (usuarios y revisión) y 39 (reservas y devoluciones). */
export function registerAdminRoutes(scope: FastifyInstance, ctx: TrustContext): void {
  scope.get(
    "/v1/admin/me",
    {
      preValidation: staffGuard(ctx),
      schema: doc({
        tags: [TAG_ADMIN_SUMMARY],
        summary: "Quién soy en el panel: roles de personal y permisos por recurso",
        description:
          "Cualquier rol de personal (admin, verification_admin, finance_admin, support_admin). La app usa `permissions` para mostrar u ocultar pestañas; " +
          "el servidor vuelve a comprobar el permiso en cada endpoint.",
        responses: { 200: adminMeS },
        errors: [401, 403]
      })
    },
    async request => {
      const principal = await authorizeStaff(ctx, request);
      const profile = await ctx.pool.query<{ display_name: string | null }>(`select display_name from profiles where user_id = $1`, [principal.userId]);
      await auditAdmin(ctx, request, principal, "admin.me.viewed", "user", principal.userId);
      return {
        userId: principal.userId,
        displayName: profile.rows[0]?.display_name ?? null,
        roles: staffRolesOf(principal.roles),
        permissions: permissionsFor(principal.roles)
      };
    }
  );

  /* ───────── 37 · Resumen de administración ───────── */

  scope.get(
    "/v1/admin/summary",
    {
      preValidation: adminGuard(ctx, "summary", "read"),
      schema: doc({
        tags: [TAG_ADMIN_SUMMARY],
        summary: "Resumen de administración: viajes, solicitudes, incidencias y finanzas con comparación de periodo",
        description:
          "Ventanas de calendario en Europe/Madrid. Las incidencias salen del módulo live; si no existe la fuente, `available:false` (no se inventa un 0). " +
          "`finance` es `null` para roles sin acceso a finanzas. Los importes sin tarifa aprobada son `pending_definition` («Por definir»): " +
          "el backend nunca emite importes `illustrative` aquí.",
        querystring: queryObj({ ...provinceQuery, period: enumOf(PERIODS, { default: "today" }) }),
        responses: { 200: summaryS },
        errors: [400, 401, 403, 404]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "summary", "read");
      const query = request.query as { provinceId?: string; period?: Period };
      const period = query.period ?? "today";
      const result = await getAdminSummary(ctx, principal, { ...(query.provinceId ? { provinceId: query.provinceId } : {}), period });
      await auditAdmin(ctx, request, principal, "admin.summary.viewed", "summary", null, {
        period,
        provinceId: query.provinceId ?? null,
        financeIncluded: result.finance !== null
      });
      return result;
    }
  );

  scope.get(
    "/v1/admin/summary/vehicle-activity",
    {
      preValidation: adminGuard(ctx, "summary", "read"),
      schema: doc({
        tags: [TAG_ADMIN_SUMMARY],
        summary: "Actividad de vehículos (aproximada) para el mapa del resumen",
        description:
          "Celdas de ~2 km con posiciones de hace menos de `freshnessSeconds`. Nunca devuelve identidades ni posiciones precisas (centro de celda).",
        querystring: queryObj(provinceQuery),
        responses: { 200: vehicleActivityS },
        errors: [400, 401, 403, 404]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "summary", "read");
      const query = request.query as { provinceId?: string };
      const result = await getVehicleActivity(ctx, query.provinceId ? { provinceId: query.provinceId } : {});
      await auditAdmin(ctx, request, principal, "admin.vehicle_activity.viewed", "summary", null, {
        provinceId: query.provinceId ?? null,
        totalVehicles: result.totalVehicles
      });
      return result;
    }
  );

  /* ───────── 38 · Usuarios y revisión ───────── */

  scope.get(
    "/v1/admin/review/users",
    {
      preValidation: adminGuard(ctx, "review", "read"),
      schema: doc({
        tags: [TAG_ADMIN_REVIEW],
        summary: "Cola «Usuarios y revisión» con pestañas, filtros y orden",
        description:
          "Pestañas Pendientes / Aprobados / Rechazados con recuentos que respetan los filtros de rol y de elemento. " +
          "`needs_retry` por sí solo no mete a una persona en la cola (espera acción de la persona usuaria). Paginación por cursor opaco.",
        querystring: queryObj({
          tab: enumOf(["pending", "approved", "rejected"], { default: "pending" }),
          role: enumOf(["driver", "passenger"]),
          item: enumOf(ITEM_KEYS),
          sort: enumOf(["recent", "oldest"], { default: "recent" }),
          ...pageQuery
        }),
        responses: { 200: queuePageS },
        errors: [400, 401, 403]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "review", "read");
      const query = request.query as {
        tab?: "pending" | "approved" | "rejected";
        role?: "driver" | "passenger";
        item?: ItemKey;
        sort?: "recent" | "oldest";
        cursor?: string;
        limit?: number;
      };
      const result = await listReviewQueue(ctx.pool, principal.userId, {
        tab: query.tab ?? "pending",
        sort: query.sort ?? "recent",
        ...(query.role ? { role: query.role } : {}),
        ...(query.item ? { item: query.item } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {})
      });
      await auditAdmin(ctx, request, principal, "admin.review_queue.viewed", "review_queue", null, {
        tab: query.tab ?? "pending",
        role: query.role ?? null,
        item: query.item ?? null,
        returned: result.items.length
      });
      return result;
    }
  );

  scope.get(
    "/v1/admin/review/users/:userId",
    {
      preValidation: adminGuard(ctx, "review", "read"),
      schema: doc({
        tags: [TAG_ADMIN_REVIEW],
        summary: "Expediente de una persona usuaria («Ver expediente»)",
        description:
          "Tarjeta, elementos con sus evidencias (sin URL: el acceso a documentación privada es solo con `POST /v1/admin/evidence/{kind}/{evidenceId}/access`), " +
          "decisiones permitidas, motivos, vehículos e historial. Teléfono siempre enmascarado.",
        params: uuidParam("userId"),
        responses: { 200: dossierS },
        errors: [400, 401, 403, 404]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "review", "read");
      const { userId } = request.params as { userId: string };
      const result = await getDossier(ctx, principal, userId);
      await auditAdmin(ctx, request, principal, "admin.dossier.viewed", "user", userId);
      return result;
    }
  );

  scope.post(
    "/v1/admin/review/users/:userId/decision",
    {
      preValidation: adminGuard(ctx, "review", "write"),
      config: { rateLimit: RATE_ADMIN_WRITE },
      schema: doc({
        tags: [TAG_ADMIN_REVIEW],
        summary: "Aprobar, rechazar o pedir otra captura",
        description:
          "Sin `items` actúa sobre todos los elementos en revisión. Cada elemento se decide por separado y de forma atómica; el resultado informa de cada uno. " +
          "`rejected` exige `reason` (≥3 caracteres); `needs_retry` solo aplica a la comprobación privada y exige `reasonCode`. " +
          "Aprobar la foto la hace pública; aprobar el documento de identidad deja `identity_status = verified`; aprobar la selfie NO verifica la identidad. " +
          "Nadie puede decidir sobre su propio expediente.",
        params: uuidParam("userId"),
        body: obj(
          {
            decision: enumOf(["approved", "rejected", "needs_retry"]),
            reason: str({ maxLength: 1000 }),
            reasonCode: str({ maxLength: 60 }),
            items: arr(enumOf(ITEM_KEYS), { maxItems: 4 })
          },
          ["decision"]
        ),
        responses: { 200: decisionResultS },
        errors: [400, 401, 403, 404, 409, 422, 429]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "review", "write");
      const { userId } = request.params as { userId: string };
      const body = request.body as { decision: Decision; reason?: string; reasonCode?: string; items?: ItemKey[] };
      return decideReview(
        ctx,
        principal,
        userId,
        {
          decision: body.decision,
          ...(body.reason !== undefined ? { reason: body.reason } : {}),
          ...(body.reasonCode !== undefined ? { reasonCode: body.reasonCode } : {}),
          ...(body.items ? { items: body.items } : {})
        },
        request.id
      );
    }
  );

  scope.post(
    "/v1/admin/evidence/:kind/:evidenceId/access",
    {
      preValidation: adminGuard(ctx, "evidence", "read"),
      config: { rateLimit: RATE_ADMIN_WRITE },
      schema: doc({
        tags: [TAG_ADMIN_REVIEW],
        summary: "Ver documentación privada: URL firmada de vida corta con auditoría previa",
        description:
          "La URL se firma, se escribe la auditoría (quién, qué, propósito, TTL, propietario) y solo entonces se devuelve: si la auditoría falla no sale ninguna URL. " +
          "Nadie puede acceder a su propia documentación desde el panel. Con el almacenamiento desactivado: `503 PRIVATE_STORAGE_DISABLED`.",
        params: obj({
          kind: enumOf(["profile_photo", "identity_selfie", "private_document"]),
          evidenceId: str({ format: "uuid" })
        }),
        body: obj(
          {
            purpose: enumOf(["identity_review", "photo_moderation", "license_review", "vehicle_review", "support_case", "legal_request"]),
            note: str({ maxLength: 500 })
          },
          ["purpose"]
        ),
        responses: { 200: evidenceAccessS },
        errors: [400, 401, 403, 404, 409, 429, 503]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "evidence", "read");
      const params = request.params as { kind: EvidenceKind; evidenceId: string };
      const body = request.body as { purpose: EvidencePurpose; note?: string };
      return issueEvidenceAccess(
        ctx,
        principal,
        params.kind,
        params.evidenceId,
        { purpose: body.purpose, ...(body.note !== undefined ? { note: body.note } : {}) },
        request.id
      );
    }
  );

  /* ───────── 39 · Reservas y devoluciones ───────── */

  scope.get(
    "/v1/admin/bookings",
    {
      preValidation: adminGuard(ctx, "bookings", "read"),
      schema: doc({
        tags: [TAG_ADMIN_BOOKINGS],
        summary: "Reservas y devoluciones: listado por provincia, periodo y estado",
        description:
          "El importe pagado es el registrado en la reserva. «Devolución propuesta», «Comisión plataforma (propuesta)» y «Coste final pasajero» son `pending_definition` " +
          "(«Por definir») hasta que exista la política de cancelación versionada; si el módulo de pagos publica propuestas/devoluciones, se leen de él. " +
          "Las acciones de devolución pertenecen al módulo de pagos. `counts.refunded` es `null` mientras no exista la fuente.",
        querystring: queryObj({
          ...provinceQuery,
          period: enumOf(PERIODS, { default: "last_30_days" }),
          status: enumOf(["all", "cancelled", "refunded"], { default: "all" }),
          ...pageQuery
        }),
        responses: { 200: bookingsPageS },
        errors: [400, 401, 403, 404]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "bookings", "read");
      const query = request.query as {
        provinceId?: string;
        period?: Period;
        status?: BookingStatusFilter;
        cursor?: string;
        limit?: number;
      };
      const result = await listAdminBookings(ctx, {
        period: query.period ?? "last_30_days",
        status: query.status ?? "all",
        ...(query.provinceId ? { provinceId: query.provinceId } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {})
      });
      await auditAdmin(ctx, request, principal, "admin.bookings.listed", "bookings", null, {
        period: query.period ?? "last_30_days",
        status: query.status ?? "all",
        provinceId: query.provinceId ?? null,
        returned: result.items.length
      });
      return result;
    }
  );
}
