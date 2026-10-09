import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { parseIdempotencyKey } from "../lib/idempotency.js";
import { authenticateFinance } from "../lib/http.js";
import {
  executePayoutRun,
  generatePayoutRuns,
  listAdminPayoutRuns,
  type PayoutStatus
} from "../payouts/payout-service.js";
import type { PaymentProvider } from "../provider/types.js";
import {
  approveRefund,
  executeRefund,
  getAdminRefund,
  listAdminRefunds,
  rejectRefund,
  type AdminRefundPeriod,
  type AdminRefundTab
} from "../refunds/refund-service.js";
import type { RefundOrigin, RefundStatus } from "../types.js";
import { BEARER, sendIdempotent } from "./helpers.js";
import {
  adminPayoutRunSchema,
  adminRefundDetailSchema,
  adminRefundItemSchema,
  adminRefundListSchema,
  approveRefundBodySchema,
  cursorQuery,
  enumOf,
  errorResponses,
  generatePayoutRunsBodySchema,
  generatePayoutRunsSchema,
  idempotencyHeaderSchema,
  limitQuery,
  monthQuery,
  page,
  paramsOf,
  PAYOUT_STATUSES,
  queryOf,
  REFUND_ORIGINS,
  REFUND_STATUSES,
  rejectRefundBodySchema
} from "./schemas.js";

const TAG_ADMIN_REFUNDS = ["Finanzas · Reservas y devoluciones"];
const TAG_ADMIN_PAYOUTS = ["Finanzas · Liquidaciones"];

const ADMIN_NOTE = " Solo `finance_admin` o `admin` (401 sin sesión, 403 con cualquier otro rol).";

export function registerAdminRoutes(app: FastifyInstance, pool: Pool, provider: PaymentProvider): void {
  app.get<{
    Querystring: {
      tab?: AdminRefundTab;
      status?: RefundStatus;
      origin?: RefundOrigin;
      period?: AdminRefundPeriod;
      provinceCode?: string;
      cursor?: string;
      limit?: number;
    };
  }>("/v1/admin/refund-proposals", {
    schema: {
      tags: TAG_ADMIN_REFUNDS,
      security: BEARER,
      summary: "Reservas y devoluciones (panel de finanzas)",
      description:
        "Lista paginada con contadores de pestañas (`counts`, que respetan periodo y provincia pero no la pestaña). Cada consulta materializa de forma idempotente las consecuencias pendientes de reservas canceladas/no-show creadas por otros módulos." +
        ADMIN_NOTE,
      querystring: queryOf({
        tab: enumOf(["all", "cancelled", "refunded"]),
        status: enumOf(REFUND_STATUSES),
        origin: enumOf(REFUND_ORIGINS),
        period: enumOf(["7d", "30d", "90d", "365d", "all"]),
        provinceCode: { type: "string", minLength: 1, maxLength: 20 },
        cursor: cursorQuery,
        limit: limitQuery
      }),
      response: { 200: adminRefundListSchema, ...errorResponses(400, 401, 403) }
    }
  }, async request => {
    await authenticateFinance(pool, request);
    const q = request.query;
    return listAdminRefunds(pool, {
      tab: q.tab ?? "all",
      period: q.period ?? "30d",
      ...(q.status ? { status: q.status } : {}),
      ...(q.origin ? { origin: q.origin } : {}),
      ...(q.provinceCode ? { provinceCode: q.provinceCode } : {}),
      ...(q.cursor ? { cursor: q.cursor } : {}),
      ...(q.limit ? { limit: q.limit } : {})
    });
  });

  app.get<{ Params: { refundId: string } }>("/v1/admin/refund-proposals/:refundId", {
    schema: {
      tags: TAG_ADMIN_REFUNDS,
      security: BEARER,
      summary: "Revisar una devolución",
      description: "Detalle con el pago, el máximo devolvible y los asientos del libro mayor del pago." + ADMIN_NOTE,
      params: paramsOf("refundId"),
      response: { 200: adminRefundDetailSchema, ...errorResponses(400, 401, 403, 404) }
    }
  }, async request => {
    await authenticateFinance(pool, request);
    return getAdminRefund(pool, request.params.refundId);
  });

  app.post<{
    Params: { refundId: string };
    Body: { approvedCents?: number; note?: string };
    Headers: { "idempotency-key"?: string };
  }>("/v1/admin/refund-proposals/:refundId/approve", {
    // Todos los campos son opcionales: una petición sin cuerpo equivale a `{}` (aprobar el importe propuesto por la política).
    preValidation: async request => {
      if (request.body === undefined || request.body === null) request.body = {};
    },
    schema: {
      tags: TAG_ADMIN_REFUNDS,
      security: BEARER,
      summary: "Aprobar una devolución",
      description:
        "La propuesta debe estar en `pending_review`. `approvedCents` es obligatorio si la propuesta es «Por definir» y debe cumplir `1 ≤ approvedCents ≤ maxRefundable`; la nota es obligatoria si no hay política aplicable o si se cambia el importe propuesto. Registra el asiento contable y la auditoría. Con el proveedor desactivado queda `approved` + `awaiting_provider` (NO se marca como devuelta). Requiere `Idempotency-Key`." +
        ADMIN_NOTE,
      params: paramsOf("refundId"),
      headers: idempotencyHeaderSchema,
      body: approveRefundBodySchema,
      response: { 200: adminRefundItemSchema, ...errorResponses(400, 401, 403, 404, 409, 422, 502) }
    }
  }, async (request, reply) => {
    const principal = await authenticateFinance(pool, request);
    const key = parseIdempotencyKey(request.headers["idempotency-key"]);
    const outcome = await approveRefund(pool, provider, principal, key, request.params.refundId, request.body ?? {});
    return sendIdempotent(reply, outcome);
  });

  app.post<{
    Params: { refundId: string };
    Body: { note: string };
    Headers: { "idempotency-key"?: string };
  }>("/v1/admin/refund-proposals/:refundId/reject", {
    schema: {
      tags: TAG_ADMIN_REFUNDS,
      security: BEARER,
      summary: "Rechazar una devolución",
      description: "La nota (motivo) es obligatoria y es interna: no se envía al pasajero. Requiere `Idempotency-Key`." + ADMIN_NOTE,
      params: paramsOf("refundId"),
      headers: idempotencyHeaderSchema,
      body: rejectRefundBodySchema,
      response: { 200: adminRefundItemSchema, ...errorResponses(400, 401, 403, 404, 409, 422) }
    }
  }, async (request, reply) => {
    const principal = await authenticateFinance(pool, request);
    const key = parseIdempotencyKey(request.headers["idempotency-key"]);
    const outcome = await rejectRefund(pool, principal, key, request.params.refundId, request.body);
    return sendIdempotent(reply, outcome);
  });

  app.post<{ Params: { refundId: string }; Headers: { "idempotency-key"?: string } }>(
    "/v1/admin/refund-proposals/:refundId/execute",
    {
      schema: {
        tags: TAG_ADMIN_REFUNDS,
        security: BEARER,
        summary: "Pedir al proveedor una devolución aprobada",
        description:
          "Reintenta pedir al proveedor una devolución ya aprobada (`approved` en espera del proveedor, o `failed`). 409 `PAYMENTS_PROVIDER_DISABLED` mientras no haya proveedor activo. `refunded` solo llega con el evento firmado del proveedor. Requiere `Idempotency-Key`." +
          ADMIN_NOTE,
        params: paramsOf("refundId"),
        headers: idempotencyHeaderSchema,
        response: { 200: adminRefundItemSchema, ...errorResponses(400, 401, 403, 404, 409, 422, 502) }
      }
    },
    async (request, reply) => {
      const principal = await authenticateFinance(pool, request);
      const key = parseIdempotencyKey(request.headers["idempotency-key"]);
      const outcome = await executeRefund(pool, provider, principal, key, request.params.refundId);
      return sendIdempotent(reply, outcome);
    }
  );

  /* ─────────────── Liquidaciones ─────────────── */

  app.get<{ Querystring: { period?: string; status?: PayoutStatus; cursor?: string; limit?: number } }>("/v1/admin/payout-runs", {
    schema: {
      tags: TAG_ADMIN_PAYOUTS,
      security: BEARER,
      summary: "Liquidaciones a conductores",
      description: "Listado de liquidaciones mensuales, filtrable por periodo (AAAA-MM) y estado." + ADMIN_NOTE,
      querystring: queryOf({ period: monthQuery, status: enumOf(PAYOUT_STATUSES), cursor: cursorQuery, limit: limitQuery }),
      response: { 200: page(adminPayoutRunSchema), ...errorResponses(400, 401, 403) }
    }
  }, async request => {
    await authenticateFinance(pool, request);
    const q = request.query;
    return listAdminPayoutRuns(pool, {
      ...(q.period ? { period: q.period } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.cursor ? { cursor: q.cursor } : {}),
      ...(q.limit ? { limit: q.limit } : {})
    });
  });

  app.post<{ Body: { period: string }; Headers: { "idempotency-key"?: string } }>("/v1/admin/payout-runs", {
    schema: {
      tags: TAG_ADMIN_PAYOUTS,
      security: BEARER,
      summary: "Generar liquidaciones de un periodo",
      description:
        "Crea una liquidación `draft` por conductor con neto positivo de reservas completadas en el mes (una por conductor y mes; idempotente). `scheduledFor` queda `null` («Por definir») hasta que se apruebe un calendario. Requiere `Idempotency-Key`." +
        ADMIN_NOTE,
      headers: idempotencyHeaderSchema,
      body: generatePayoutRunsBodySchema,
      response: { 201: generatePayoutRunsSchema, ...errorResponses(400, 401, 403, 422) }
    }
  }, async (request, reply) => {
    const principal = await authenticateFinance(pool, request);
    const key = parseIdempotencyKey(request.headers["idempotency-key"]);
    const outcome = await generatePayoutRuns(pool, principal, key, request.body);
    return sendIdempotent(reply, outcome);
  });

  app.post<{ Params: { payoutId: string }; Headers: { "idempotency-key"?: string } }>("/v1/admin/payout-runs/:payoutId/execute", {
    schema: {
      tags: TAG_ADMIN_PAYOUTS,
      security: BEARER,
      summary: "Pedir el abono de una liquidación al proveedor",
      description:
        "Solo desde `draft` o `failed`. 409 `PAYMENTS_PROVIDER_DISABLED` mientras no haya proveedor; 409 `PAYOUT_ACCOUNT_REQUIRED` si el conductor no tiene cuenta de cobro activa. `paid` solo llega con el evento firmado del proveedor. Requiere `Idempotency-Key`." +
        ADMIN_NOTE,
      params: paramsOf("payoutId"),
      headers: idempotencyHeaderSchema,
      response: { 200: adminPayoutRunSchema, ...errorResponses(400, 401, 403, 404, 409, 422, 502) }
    }
  }, async (request, reply) => {
    const principal = await authenticateFinance(pool, request);
    const key = parseIdempotencyKey(request.headers["idempotency-key"]);
    const outcome = await executePayoutRun(pool, provider, principal, key, request.params.payoutId);
    return sendIdempotent(reply, outcome);
  });
}
