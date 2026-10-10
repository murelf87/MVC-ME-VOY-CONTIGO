/**
 * Backend en memoria de la vista previa · slice `admin` · paquete «resumen, usuarios y reembolsos».
 * SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`). Espejo de `src/modules/trust` (resumen, cola de revisión, evidencias,
 * reservas) y de `src/modules/money` (propuestas de devolución). El detalle vive en `./reviewWorld/*`.
 *
 *   GET  /v1/admin/me                                   GET  /v1/admin/summary · …/summary/vehicle-activity
 *   GET  /v1/admin/review/users · …/{userId}            POST …/{userId}/decision
 *   POST /v1/admin/evidence/{kind}/{evidenceId}/access  GET  /v1/admin/bookings
 *   GET  /v1/admin/refund-proposals · …/{id}            POST …/{id}/approve | reject | execute  (Idempotency-Key obligatoria)
 */
import type {
  AdminEvidenceAccessRequest,
  AdminEvidenceKind,
  AdminPeriod,
  AdminRefundPeriod,
  AdminRefundTab,
  AdminReviewDecisionRequest,
  AdminReviewItemKey,
  AdminReviewTab,
  ApproveRefundRequest,
  RefundOrigin,
  RefundStatus,
  RejectRefundRequest,
} from "@/api/types";
import { registerSeedRef, uuidParam, writeAudit, type JsonSchema, type PreviewDb, type PreviewProfileId, type PreviewRouter } from "@/preview";
import { listBookings } from "./reviewWorld/bookings";
import { clampLimit } from "./reviewWorld/common";
import { ITEM_KEYS, decide, getDossier, issueEvidenceAccess, listQueue } from "./reviewWorld/queue";
import { approveRefund, executeRefund, getRefund, listRefunds, rejectRefund, settleRefunds } from "./reviewWorld/refunds";
import { adminMe, authorizeAdmin, authorizeFinance, authorizeStaff } from "./reviewWorld/rbac";
import { applySelfReview, applyUsersB, seedManyPending, seedReviewItems } from "./reviewWorld/seedItems";
import { seedBulkRefunds, seedRefunds } from "./reviewWorld/seedRefunds";
import { seedSummary } from "./reviewWorld/seedSummary";
import { reviewTables, SETTING_PROVIDER_ENABLED, SETTING_PROVIDER_OUTCOME, SETTING_QUEUE_EMPTY, SETTING_STORAGE_DISABLED } from "./reviewWorld/store";
import { buildSummary, buildVehicleActivity } from "./reviewWorld/summary";


const PERIODS: AdminPeriod[] = ["today", "yesterday", "last_7_days", "last_30_days", "this_month"];
const REFUND_PERIODS: AdminRefundPeriod[] = ["7d", "30d", "90d", "365d", "all"];
const REFUND_TABS: AdminRefundTab[] = ["all", "cancelled", "refunded"];
const REVIEW_TABS: AdminReviewTab[] = ["pending", "approved", "rejected"];
const EVIDENCE_KINDS: AdminEvidenceKind[] = ["profile_photo", "identity_selfie", "private_document"];
const PURPOSES = ["identity_review", "photo_moderation", "license_review", "vehicle_review", "support_case", "legal_request"] as const;

const TAG_TRUST = ["admin-review"] as const;
const TAG_MONEY = ["admin-refunds"] as const;

const str = (extra: Record<string, unknown> = {}): JsonSchema => ({ type: "string", ...extra });
const page: Record<string, JsonSchema> = {
  limit: { type: "integer", minimum: 1, maximum: 50 },
  cursor: { type: "string", minLength: 1, maxLength: 200 },
};
const query = (props: Record<string, JsonSchema>): JsonSchema => ({ type: "object", additionalProperties: false, properties: props });

const decisionBody: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["decision"],
  properties: {
    decision: str({ enum: ["approved", "rejected", "needs_retry"] }),
    reason: { type: ["string", "null"], maxLength: 1000 },
    reasonCode: { type: ["string", "null"], maxLength: 60 },
    items: { type: "array", items: str({ enum: ITEM_KEYS }) },
  },
};
const evidenceBody: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["purpose"],
  properties: { purpose: str({ enum: [...PURPOSES] }), note: { type: ["string", "null"], maxLength: 300 } },
};
const approveBody: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: { approvedCents: { type: ["integer", "null"], minimum: 0 }, note: { type: ["string", "null"], maxLength: 1000 } },
};
const rejectBody: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["note"],
  properties: { note: str({ minLength: 1, maxLength: 1000 }) },
};

export const reviewSeedVariants: Readonly<Record<string, string>> = {
  "admin-users-b": "Usuarios y revisión (lámina 38b): Ana y Miguel con la identidad verificada; el permiso y la foto nuevos esperan revisión.",
  "admin-refunds-b": "Reservas y devoluciones (lámina 39b): segunda versión de las doce propuestas.",
  "admin-self-review": "El propio personal de administración tiene una entrega pendiente (no puede decidirla).",
  "admin-many-pending": "Veintiocho personas más con la identidad por revisar (para «Cargar más»).",
  "admin-queue-empty": "Sin ninguna entrega a revisión: pestañas vacías con contadores a cero.",
  "admin-storage-off": "Almacenamiento privado desactivado: no se pueden abrir las pruebas.",
  "admin-refunds-many": "Cuarenta propuestas de devolución más (para «Cargar más»).",
  "admin-provider-on": "Proveedor de pagos SIMULADO habilitado: una devolución aprobada se puede ejecutar.",
  "admin-provider-failed": "Proveedor de pagos SIMULADO habilitado que rechaza la devolución ejecutada.",
};

export function registerReviewPreview(r: PreviewRouter, db: PreviewDb): void {
  registerSeedRef("adminReview.pendingUser", (d) => reviewTables(d).items.filter((row) => row.state === "in_review")[0]?.user_id);
  registerSeedRef("adminRefund.pending", (d) => reviewTables(d).refunds.filter((row) => row.status === "pending_review")[0]?.id);
  registerSeedRef("adminRefund.refunded", (d) => reviewTables(d).refunds.filter((row) => row.status === "refunded")[0]?.id);

  r.get("/v1/admin/me", { summary: "Quién soy en el panel: roles y permisos", tags: TAG_TRUST }, (req) => adminMe(db, authorizeStaff(db, req)));

  r.get<{ Query: { provinceId?: string; period?: AdminPeriod } }>(
    "/v1/admin/summary",
    { summary: "Resumen de administración", tags: TAG_TRUST, schema: { querystring: query({ provinceId: str(), period: str({ enum: PERIODS }) }) } },
    (req) => {
      const principal = authorizeAdmin(db, req, "summary", "read");
      return buildSummary(db, principal, { provinceId: req.query.provinceId, period: req.query.period ?? "today" }, req.requestId);
    },
  );

  r.get<{ Query: { provinceId?: string } }>(
    "/v1/admin/summary/vehicle-activity",
    { summary: "Actividad de vehículos (celdas aproximadas)", tags: TAG_TRUST, schema: { querystring: query({ provinceId: str() }) } },
    (req) => {
      const principal = authorizeAdmin(db, req, "summary", "read");
      return buildVehicleActivity(db, principal, { provinceId: req.query.provinceId }, req.requestId);
    },
  );

  r.get<{ Query: { tab?: AdminReviewTab; role?: "driver" | "passenger"; item?: AdminReviewItemKey; sort?: "recent" | "oldest"; cursor?: string; limit?: number } }>(
    "/v1/admin/review/users",
    {
      summary: "Cola de revisión de usuarios",
      tags: TAG_TRUST,
      schema: {
        querystring: query({
          ...page,
          tab: str({ enum: REVIEW_TABS }),
          role: str({ enum: ["driver", "passenger"] }),
          item: str({ enum: ITEM_KEYS }),
          sort: str({ enum: ["recent", "oldest"] }),
        }),
      },
    },
    (req) => {
      const principal = authorizeAdmin(db, req, "review", "read");
      const q = req.query;
      return listQueue(db, principal.userId, {
        tab: q.tab ?? "pending",
        role: q.role,
        item: q.item,
        sort: q.sort ?? "recent",
        cursor: q.cursor,
        limit: q.limit === undefined ? undefined : clampLimit(q.limit),
      });
    },
  );

  r.get<{ Params: { userId: string } }>(
    "/v1/admin/review/users/:userId",
    { summary: "Expediente de un usuario", tags: TAG_TRUST, schema: { params: uuidParam("userId") } },
    (req) => getDossier(db, authorizeAdmin(db, req, "review", "read"), req.params.userId),
  );

  r.post<{ Params: { userId: string }; Body: AdminReviewDecisionRequest }>(
    "/v1/admin/review/users/:userId/decision",
    { summary: "Aprobar, rechazar o pedir repetir", tags: TAG_TRUST, schema: { params: uuidParam("userId"), body: decisionBody } },
    (req) => {
      const principal = authorizeAdmin(db, req, "review", "write");
      const b = req.body;
      return decide(db, principal, req.params.userId, { decision: b.decision, reason: b.reason ?? undefined, reasonCode: b.reasonCode ?? undefined, items: b.items }, req.requestId);
    },
  );

  r.post<{ Params: { kind: AdminEvidenceKind; evidenceId: string }; Body: AdminEvidenceAccessRequest }>(
    "/v1/admin/evidence/:kind/:evidenceId/access",
    {
      summary: "URL firmada de 120 s para ver una prueba (auditada)",
      tags: TAG_TRUST,
      schema: {
        params: { type: "object", required: ["kind", "evidenceId"], properties: { kind: str({ enum: EVIDENCE_KINDS }), evidenceId: str({ format: "uuid" }) } },
        body: evidenceBody,
      },
    },
    (req) => {
      const principal = authorizeAdmin(db, req, "evidence", "read");
      return issueEvidenceAccess(db, principal, req.params.kind, req.params.evidenceId, { purpose: req.body.purpose, note: req.body.note ?? undefined }, req.requestId);
    },
  );

  r.get<{ Query: { provinceId?: string; period?: AdminPeriod; status?: "all" | "cancelled" | "refunded"; cursor?: string; limit?: number } }>(
    "/v1/admin/bookings",
    {
      summary: "Reservas del periodo",
      tags: TAG_TRUST,
      schema: { querystring: query({ ...page, provinceId: str(), period: str({ enum: PERIODS }), status: str({ enum: ["all", "cancelled", "refunded"] }) }) },
    },
    (req) => {
      authorizeAdmin(db, req, "bookings", "read");
      const q = req.query;
      return listBookings(db, { provinceId: q.provinceId, period: q.period ?? "today", status: q.status ?? "all", cursor: q.cursor, limit: q.limit === undefined ? undefined : clampLimit(q.limit) });
    },
  );

  r.get<{ Query: { tab?: AdminRefundTab; status?: RefundStatus; origin?: RefundOrigin; period?: AdminRefundPeriod; provinceCode?: string; cursor?: string; limit?: number } }>(
    "/v1/admin/refund-proposals",
    {
      summary: "Propuestas de devolución",
      tags: TAG_MONEY,
      schema: { querystring: query({ ...page, tab: str({ enum: REFUND_TABS }), status: str(), origin: str(), period: str({ enum: REFUND_PERIODS }), provinceCode: str() }) },
    },
    (req) => {
      authorizeFinance(db, req);
      settleRefunds(db);
      const q = req.query;
      return listRefunds(db, {
        tab: q.tab ?? "all",
        status: q.status,
        origin: q.origin,
        period: q.period ?? "30d",
        provinceCode: q.provinceCode,
        cursor: q.cursor,
        limit: q.limit === undefined ? undefined : clampLimit(q.limit),
      });
    },
  );

  r.get<{ Params: { refundId: string } }>(
    "/v1/admin/refund-proposals/:refundId",
    { summary: "Detalle de una propuesta de devolución", tags: TAG_MONEY, schema: { params: uuidParam("refundId") } },
    (req) => {
      const principal = authorizeFinance(db, req);
      settleRefunds(db);
      const detail = getRefund(db, req.params.refundId);
      writeAudit(db, { actorUserId: principal.userId, action: "admin.refund.viewed", entityType: "refund", entityId: req.params.refundId, requestId: req.requestId, metadata: {} });
      return detail;
    },
  );

  r.post<{ Params: { refundId: string }; Body: ApproveRefundRequest }>(
    "/v1/admin/refund-proposals/:refundId/approve",
    { summary: "Aprobar una devolución", tags: TAG_MONEY, idempotent: "required", schema: { params: uuidParam("refundId"), body: approveBody } },
    (req) => {
      const principal = authorizeFinance(db, req);
      return approveRefund(db, principal, req.params.refundId, { approvedCents: req.body.approvedCents ?? undefined, note: req.body.note ?? undefined }, req.requestId);
    },
  );

  r.post<{ Params: { refundId: string }; Body: RejectRefundRequest }>(
    "/v1/admin/refund-proposals/:refundId/reject",
    { summary: "Rechazar una devolución", tags: TAG_MONEY, idempotent: "required", schema: { params: uuidParam("refundId"), body: rejectBody } },
    (req) => rejectRefund(db, authorizeFinance(db, req), req.params.refundId, { note: req.body.note }, req.requestId),
  );

  r.post<{ Params: { refundId: string } }>(
    "/v1/admin/refund-proposals/:refundId/execute",
    { summary: "Ejecutar una devolución aprobada (proveedor SIMULADO)", tags: TAG_MONEY, idempotent: "required", schema: { params: uuidParam("refundId") } },
    (req) => executeRefund(db, authorizeFinance(db, req), req.params.refundId, req.requestId),
  );
}

export function seedReview(db: PreviewDb, profile: PreviewProfileId, seed: string): void {
  if (profile !== "admin" && !seed.startsWith("admin-")) return;
  seedSummary(db);
  if (seed !== "admin-queue-empty") seedReviewItems(db);
  if (seed === "admin-users-b") applyUsersB(db);
  if (seed === "admin-self-review") applySelfReview(db);
  if (seed === "admin-many-pending") seedManyPending(db);
  if (seed === "admin-queue-empty") db.setSetting(SETTING_QUEUE_EMPTY, true);
  if (seed === "admin-storage-off") db.setSetting(SETTING_STORAGE_DISABLED, true);
  seedRefunds(db, seed === "admin-refunds-b" ? "b" : "a");
  if (seed === "admin-refunds-many") seedBulkRefunds(db, 40);
  if (seed === "admin-provider-on" || seed === "admin-provider-failed") db.setSetting(SETTING_PROVIDER_ENABLED, true);
  if (seed === "admin-provider-failed") db.setSetting(SETTING_PROVIDER_OUTCOME, "failed");
}
