import type { FastifyInstance } from "fastify";
import type { TrustContext } from "../context.js";
import { adminGuard, auditAdmin, authorizeAdmin } from "../http.js";
import { listAuditEvents } from "../audit-browser.js";
import { evaluateAlerts } from "../operations/evaluator.js";
import {
  ALERT_KINDS,
  type AlertKind,
  type AlertStatus,
  type RuleParams,
  changeAlertStatus,
  getOperations,
  listAlerts,
  updateOperations
} from "../operations.js";
import {
  computeTariffExample,
  getTariffOverview,
  listTariffVersions,
  publishTariffVersion,
  saveTariffDraft
} from "../tariffs.js";
import { arr, bool, enumOf, freeObject, int, nint, nstr, nullable, obj, pageQuery, queryObj, str, uuidParam } from "../schemas.js";
import {
  alertEvaluationS,
  alertS,
  alertsPageS,
  auditPageS,
  operationsS,
  tariffExampleS,
  tariffOverviewS,
  tariffVersionS,
  tariffVersionsPageS
} from "./admin-schemas.js";
import { RATE_ADMIN_WRITE, TAG_ADMIN_AUDIT, TAG_ADMIN_TARIFFS, doc } from "./shared.js";

/**
 * Pantalla 40 (tarifas y operaciones), alertas en tiempo real y visor de auditoría.
 * Nada de lo que hay aquí activa una tarifa: publicar está bloqueado por `ECONOMICS_ACTIVATION` (por defecto `disabled`).
 */
export function registerAdminOpsRoutes(scope: FastifyInstance, ctx: TrustContext): void {
  /* ───────── Tarifas (borradores) ───────── */

  scope.get(
    "/v1/admin/tariffs",
    {
      preValidation: adminGuard(ctx, "tariffs", "read"),
      schema: doc({
        tags: [TAG_ADMIN_TARIFFS],
        summary: "Configuración de tarifas (propuesta): tarifa en vigor, borrador y estado de la activación",
        description:
          "`active` es la tarifa aprobada en vigor (hoy `null`: economía no activada). `draft` es el borrador de trabajo (los valores sin decidir son `null`: «Por definir»). " +
          "`activation.canPublish` es `false` mientras `ECONOMICS_ACTIVATION=disabled`.",
        responses: { 200: tariffOverviewS },
        errors: [401, 403]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "tariffs", "read");
      const result = await getTariffOverview(ctx);
      await auditAdmin(ctx, request, principal, "admin.tariffs.viewed", "tariff", null, {
        hasDraft: result.draft !== null,
        hasActive: result.active !== null,
        activationMode: result.activation.mode
      });
      return result;
    }
  );

  scope.put(
    "/v1/admin/tariffs/draft",
    {
      preValidation: adminGuard(ctx, "tariffs", "write"),
      config: { rateLimit: RATE_ADMIN_WRITE },
      schema: doc({
        tags: [TAG_ADMIN_TARIFFS],
        summary: "Guardar borrador de tarifa («Guardar borrador»)",
        description:
          "Crea el borrador (versión = máximo + 1) o actualiza el único borrador de trabajo. Todos los valores pueden ser `null` («Por definir»). " +
          "Rangos: tarifa 0–5 000 000 µ€/km, comisiones 0–10 000 pb, Premium y tope de gastos compartidos 0–1 000 000 céntimos. " +
          "Nunca modifica reservas ni tarifas aprobadas y nunca activa nada.",
        body: obj(
          {
            ratePerKmMicros: nint(),
            passengerCommissionBps: nint(),
            driverCommissionBps: nint(),
            premiumMonthlyCents: nint(),
            sharedCostCapCents: nint(),
            notes: nstr({ maxLength: 2000 })
          },
          ["ratePerKmMicros", "passengerCommissionBps", "driverCommissionBps", "premiumMonthlyCents"]
        ),
        responses: { 200: tariffVersionS },
        errors: [400, 401, 403, 422, 429]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "tariffs", "write");
      const body = request.body as {
        ratePerKmMicros: number | null;
        passengerCommissionBps: number | null;
        driverCommissionBps: number | null;
        premiumMonthlyCents: number | null;
        sharedCostCapCents?: number | null;
        notes?: string | null;
      };
      const saved = await saveTariffDraft(ctx, principal, body, request.id);
      return saved.version;
    }
  );

  scope.post(
    "/v1/admin/tariffs/example",
    {
      preValidation: adminGuard(ctx, "tariffs", "read"),
      schema: doc({
        tags: [TAG_ADMIN_TARIFFS],
        summary: "Ejemplo de aportación (cálculo sin guardar)",
        description:
          "Importes `illustrative` (se muestran como «Ejemplo») o `pending_definition` si falta un dato. Con 0,18 €/km, 18 km y 10 %/10 %: aportación 3,24 €, " +
          "comisión pasajero 0,32 €, total pasajero 3,56 €, comisión conductor 0,32 €, neto conductor 2,92 €. Redondeo: mitad hacia arriba en céntimos.",
        body: obj(
          {
            distanceMeters: int(),
            ratePerKmMicros: nint(),
            passengerCommissionBps: nint(),
            driverCommissionBps: nint()
          },
          ["distanceMeters"]
        ),
        responses: { 200: tariffExampleS },
        errors: [400, 401, 403, 422]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "tariffs", "read");
      const body = request.body as {
        distanceMeters: number;
        ratePerKmMicros?: number | null;
        passengerCommissionBps?: number | null;
        driverCommissionBps?: number | null;
      };
      const result = computeTariffExample({
        distanceMeters: body.distanceMeters,
        ratePerKmMicros: body.ratePerKmMicros ?? null,
        passengerCommissionBps: body.passengerCommissionBps ?? null,
        driverCommissionBps: body.driverCommissionBps ?? null
      });
      await auditAdmin(ctx, request, principal, "admin.tariff_example.calculated", "tariff", null, {
        distanceMeters: body.distanceMeters,
        ratePerKmMicros: body.ratePerKmMicros ?? null,
        passengerCommissionBps: body.passengerCommissionBps ?? null,
        driverCommissionBps: body.driverCommissionBps ?? null
      });
      return result;
    }
  );

  scope.get(
    "/v1/admin/tariffs/versions",
    {
      preValidation: adminGuard(ctx, "tariffs", "read"),
      schema: doc({
        tags: [TAG_ADMIN_TARIFFS],
        summary: "Historial de versiones de tarifa",
        description: "Más recientes primero. Paginación por cursor opaco.",
        querystring: queryObj({ ...pageQuery }),
        responses: { 200: tariffVersionsPageS },
        errors: [400, 401, 403]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "tariffs", "read");
      const query = request.query as { cursor?: string; limit?: number };
      const result = await listTariffVersions(ctx.pool, {
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {})
      });
      await auditAdmin(ctx, request, principal, "admin.tariff_versions.listed", "tariff", null, { returned: result.items.length });
      return result;
    }
  );

  scope.post(
    "/v1/admin/tariffs/versions/:versionId/publish",
    {
      config: { rateLimit: RATE_ADMIN_WRITE },
      // Primero la sesión y el permiso (solo `admin`); después, sin cuerpo (o con `null`) también debe llegar a la puerta dura
      // y recibir 409, no un 400 de validación.
      preValidation: [
        adminGuard(ctx, "tariff_activation", "write"),
        async request => {
          if (request.body === undefined) request.body = null;
        }
      ],
      schema: doc({
        tags: [TAG_ADMIN_TARIFFS],
        summary: "Activar una tarifa (BLOQUEADO mientras ECONOMICS_ACTIVATION=disabled)",
        description:
          "Puerta dura: con `ECONOMICS_ACTIVATION=disabled` (valor por defecto) responde siempre `409 ECONOMICS_ACTIVATION_DISABLED` ANTES de validar el cuerpo o el identificador, " +
          "no modifica nada y deja el intento auditado (`admin.tariff.publish_attempted`). Solo con `enabled`, `approvalReference` y una fecha de entrada en vigor futura " +
          "se marca el borrador como `approved`; no retira versiones anteriores ni toca reservas confirmadas. Solo el rol `admin`.",
        params: obj({ versionId: str({ maxLength: 64 }) }),
        body: nullable(obj({ approvalReference: str({ maxLength: 300 }), effectiveFrom: str({ maxLength: 40 }) }, [])),
        responses: { 200: tariffVersionS },
        errors: [400, 401, 403, 404, 409, 422, 429]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "tariff_activation", "write");
      const { versionId } = request.params as { versionId: string };
      const body = (request.body ?? {}) as { approvalReference?: string; effectiveFrom?: string };
      return publishTariffVersion(
        ctx,
        principal,
        versionId,
        { approvalReference: body.approvalReference ?? "", effectiveFrom: body.effectiveFrom ?? "" },
        request.id
      );
    }
  );

  /* ───────── Operaciones y alertas en tiempo real ───────── */

  scope.get(
    "/v1/admin/operations",
    {
      preValidation: adminGuard(ctx, "operations", "read"),
      schema: doc({
        tags: [TAG_ADMIN_TARIFFS],
        summary: "Restricciones operativas y reglas de alertas en tiempo real",
        description:
          "«Solo trayectos dentro de la provincia» está siempre activo y bloqueado. Cada regla indica si su fuente de eventos existe (`source`).",
        responses: { 200: operationsS },
        errors: [401, 403]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "operations", "read");
      const result = await getOperations(ctx);
      await auditAdmin(ctx, request, principal, "admin.operations.viewed", "operations", null);
      return result;
    }
  );

  scope.put(
    "/v1/admin/operations",
    {
      preValidation: adminGuard(ctx, "operations", "write"),
      config: { rateLimit: RATE_ADMIN_WRITE },
      schema: doc({
        tags: [TAG_ADMIN_TARIFFS],
        summary: "Guardar restricciones y reglas de alertas",
        description:
          "Interruptor general de alertas en tiempo real y reglas (`enabled` y `params` por regla). `provinceOnly:false` → `422 PROVINCE_ONLY_LOCKED`. " +
          "Parámetros fuera de rango o no admitidos → `400 VALIDATION_ERROR`. Solo el rol `admin`.",
        body: obj(
          {
            realtimeAlertsEnabled: bool(),
            rules: arr(
              obj({ kind: enumOf(ALERT_KINDS), enabled: bool(), params: freeObject() }, ["kind"]),
              { maxItems: 3 }
            ),
            provinceOnly: bool()
          },
          []
        ),
        responses: { 200: operationsS },
        errors: [400, 401, 403, 422, 429]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "operations", "write");
      const body = request.body as {
        realtimeAlertsEnabled?: boolean;
        rules?: Array<{ kind: AlertKind; enabled?: boolean; params?: RuleParams }>;
        provinceOnly?: boolean;
      };
      return updateOperations(ctx, principal, body, request.id);
    }
  );

  scope.get(
    "/v1/admin/alerts",
    {
      preValidation: adminGuard(ctx, "alerts", "read"),
      schema: doc({
        tags: [TAG_ADMIN_TARIFFS],
        summary: "Alertas de operación generadas por eventos reales",
        description:
          "Cancelaciones inusuales, cambios de horario/precio sin responder e incidencias en ruta (si existe la fuente). Nunca se inventan eventos.",
        querystring: queryObj({
          status: enumOf(["open", "acknowledged", "resolved", "all"], { default: "open" }),
          kind: enumOf(ALERT_KINDS),
          ...pageQuery
        }),
        responses: { 200: alertsPageS },
        errors: [400, 401, 403]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "alerts", "read");
      const query = request.query as { status?: AlertStatus | "all"; kind?: AlertKind; cursor?: string; limit?: number };
      const result = await listAlerts(ctx.pool, {
        status: query.status ?? "open",
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {})
      });
      await auditAdmin(ctx, request, principal, "admin.alerts.listed", "alerts", null, {
        status: query.status ?? "open",
        kind: query.kind ?? null,
        returned: result.items.length
      });
      return result;
    }
  );

  scope.post(
    "/v1/admin/alerts/evaluate",
    {
      preValidation: adminGuard(ctx, "alerts", "write"),
      config: { rateLimit: RATE_ADMIN_WRITE },
      schema: doc({
        tags: [TAG_ADMIN_TARIFFS],
        summary: "Evaluar las reglas de alerta ahora",
        description:
          "Evalúa con eventos reales y deduplica por clave mientras la alerta siga viva. Con las alertas en tiempo real desactivadas no evalúa (`skippedReason:\"realtime_alerts_off\"`). " +
          "También se puede lanzar por línea de comandos: `npx tsx src/modules/trust/operations/run-evaluator.ts`.",
        responses: { 200: alertEvaluationS },
        errors: [401, 403, 429]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "alerts", "write");
      return evaluateAlerts(ctx, { actorUserId: principal.userId, requestId: request.id, via: "api" });
    }
  );

  scope.post(
    "/v1/admin/alerts/:alertId/status",
    {
      preValidation: adminGuard(ctx, "alerts", "write"),
      config: { rateLimit: RATE_ADMIN_WRITE },
      schema: doc({
        tags: [TAG_ADMIN_TARIFFS],
        summary: "Reconocer o resolver una alerta",
        description: "Transiciones válidas: `open → acknowledged`, `open → resolved`, `acknowledged → resolved`.",
        params: uuidParam("alertId"),
        body: obj({ status: enumOf(["acknowledged", "resolved"]) }, ["status"]),
        responses: { 200: alertS },
        errors: [400, 401, 403, 404, 409, 429]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "alerts", "write");
      const { alertId } = request.params as { alertId: string };
      const body = request.body as { status: "acknowledged" | "resolved" };
      return changeAlertStatus(ctx, principal, alertId, body.status, request.id);
    }
  );

  /* ───────── Auditoría ───────── */

  scope.get(
    "/v1/admin/audit-events",
    {
      preValidation: adminGuard(ctx, "audit", "read"),
      schema: doc({
        tags: [TAG_ADMIN_AUDIT],
        summary: "Visor de auditoría con filtros y datos personales ocultos",
        description:
          "Filtros: persona (`actorUserId`), acción exacta o con prefijo (`admin.*`), entidad, rango de fechas. Más recientes primero con cursor opaco. " +
          "En `metadata` se ocultan claves personales (teléfono, email, nombre, dirección, IP, tokens, claves/URL de almacenamiento, coordenadas) y valores con forma de teléfono o email. " +
          "Solo el rol `admin`; consultar el registro también queda registrado.",
        querystring: queryObj({
          actorUserId: str({ format: "uuid" }),
          action: str({ maxLength: 101 }),
          entityType: str({ maxLength: 100 }),
          entityId: str({ maxLength: 200 }),
          from: str({ maxLength: 40, description: "ISO-8601, inclusivo." }),
          to: str({ maxLength: 40, description: "ISO-8601, exclusivo." }),
          ...pageQuery
        }),
        responses: { 200: auditPageS },
        errors: [400, 401, 403, 422]
      })
    },
    async request => {
      const principal = await authorizeAdmin(ctx, request, "audit", "read");
      const query = request.query as {
        actorUserId?: string;
        action?: string;
        entityType?: string;
        entityId?: string;
        from?: string;
        to?: string;
        cursor?: string;
        limit?: number;
      };
      const result = await listAuditEvents(ctx.pool, query);
      await auditAdmin(ctx, request, principal, "admin.audit_log.viewed", "audit_log", null, {
        filters: {
          actorUserId: query.actorUserId ?? null,
          action: query.action ?? null,
          entityType: query.entityType ?? null,
          entityId: query.entityId ?? null,
          from: query.from ?? null,
          to: query.to ?? null
        },
        returned: result.items.length
      });
      return result;
    }
  );
}
