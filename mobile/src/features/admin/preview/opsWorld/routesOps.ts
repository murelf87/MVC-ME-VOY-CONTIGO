/**
 * Endpoints de tarifas, operación, alertas y auditoría (BUILD_BRIEF §10.6, fila `admin-ops`, parte trust).
 * Contrato: `docs/contracts/trust.md` §4.3. Espejo de `src/modules/trust/routes/admin-ops-routes.ts`:
 *   GET    /v1/admin/tariffs                          PUT  /v1/admin/tariffs/draft
 *   POST   /v1/admin/tariffs/example                  GET  /v1/admin/tariffs/versions
 *   POST   /v1/admin/tariffs/versions/{id}/publish    (BLOQUEADO mientras ECONOMICS_ACTIVATION=disabled)
 *   GET|PUT /v1/admin/operations
 *   GET    /v1/admin/alerts   POST /v1/admin/alerts/evaluate   POST /v1/admin/alerts/{id}/status
 *   GET    /v1/admin/audit-events
 */
import type {
  AdminAlertKind,
  AdminAlertStatus,
  AdminOperationsUpdate,
  AdminTariffDraftInput,
  AdminTariffExampleRequest,
  AdminTariffPublishRequest,
} from "@/api/types";
import { uuidParam, type JsonSchema, type PreviewDb, type PreviewRouter } from "@/preview";
import { listAuditEvents, auditAdmin, type AuditFilters } from "./audit";
import { clampLimit, queryOf, sliceOf } from "./common";
import { ALERT_KINDS, changeAlertStatus, evaluateAlerts, getOperations, listAlerts, updateOperations } from "./operations";
import { authorizeAdmin } from "./rbac";
import { computeTariffExample, getTariffOverview, listTariffVersions, publishTariffVersion, saveTariffDraft } from "./tariffs";

const TAG_TARIFFS = ["admin-tariffs"] as const;
const TAG_AUDIT = ["admin-audit"] as const;

const nullableInt: JsonSchema = { type: ["integer", "null"] };

const draftBody: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ratePerKmMicros", "passengerCommissionBps", "driverCommissionBps", "premiumMonthlyCents"],
  properties: {
    ratePerKmMicros: nullableInt,
    passengerCommissionBps: nullableInt,
    driverCommissionBps: nullableInt,
    premiumMonthlyCents: nullableInt,
    sharedCostCapCents: nullableInt,
    notes: { type: ["string", "null"], maxLength: 2000 },
  },
};

const exampleBody: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["distanceMeters"],
  properties: {
    distanceMeters: { type: "integer" },
    ratePerKmMicros: nullableInt,
    passengerCommissionBps: nullableInt,
    driverCommissionBps: nullableInt,
  },
};

const operationsBody: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    realtimeAlertsEnabled: { type: "boolean" },
    provinceOnly: { type: "boolean" },
    rules: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind"],
        properties: {
          kind: { type: "string", enum: ALERT_KINDS },
          enabled: { type: "boolean" },
          params: { type: "object", additionalProperties: true },
        },
      },
    },
  },
};

interface AlertsQuery {
  status?: AdminAlertStatus | "all";
  kind?: AdminAlertKind;
  cursor?: string;
  limit?: number;
}

export function registerOpsRoutes(r: PreviewRouter, db: PreviewDb): void {
  // ── Tarifas ─────────────────────────────────────────────────────────────────────────────────────────────────────

  r.get(
    "/v1/admin/tariffs",
    { summary: "Configuración de tarifas (propuesta): tarifa en vigor, borrador y estado de la activación", tags: TAG_TARIFFS },
    (req) => {
      const principal = authorizeAdmin(db, req, "tariffs", "read");
      const result = getTariffOverview(db);
      auditAdmin(db, req.requestId, principal, "admin.tariffs.viewed", "tariff", null, {
        hasDraft: result.draft !== null,
        hasActive: result.active !== null,
        activationMode: result.activation.mode,
      });
      return result;
    },
  );

  r.put<{ Body: AdminTariffDraftInput }>(
    "/v1/admin/tariffs/draft",
    { summary: "Guardar borrador de tarifa («Guardar borrador»)", tags: TAG_TARIFFS, schema: { body: draftBody } },
    (req) => {
      const principal = authorizeAdmin(db, req, "tariffs", "write");
      return saveTariffDraft(db, principal.userId, req.body, req.requestId);
    },
  );

  r.post<{ Body: AdminTariffExampleRequest }>(
    "/v1/admin/tariffs/example",
    { summary: "Ejemplo de aportación (cálculo sin guardar)", tags: TAG_TARIFFS, schema: { body: exampleBody } },
    (req) => {
      const principal = authorizeAdmin(db, req, "tariffs", "read");
      const body = req.body;
      const input = {
        distanceMeters: body.distanceMeters,
        ratePerKmMicros: body.ratePerKmMicros ?? null,
        passengerCommissionBps: body.passengerCommissionBps ?? null,
        driverCommissionBps: body.driverCommissionBps ?? null,
      };
      const result = computeTariffExample(input);
      auditAdmin(db, req.requestId, principal, "admin.tariff_example.calculated", "tariff", null, input);
      return result;
    },
  );

  r.get<{ Query: { cursor?: string; limit?: number } }>(
    "/v1/admin/tariffs/versions",
    { summary: "Historial de versiones de tarifa", tags: TAG_TARIFFS, schema: { querystring: queryOf() } },
    (req) => {
      const principal = authorizeAdmin(db, req, "tariffs", "read");
      const page = sliceOf(listTariffVersions(db), req.query.cursor, req.query.limit);
      auditAdmin(db, req.requestId, principal, "admin.tariff_versions.listed", "tariff", null, { returned: page.items.length });
      return page;
    },
  );

  // Puerta dura: sin esquema de cuerpo, porque con la activación desactivada responde 409 ANTES de validar el cuerpo o el id.
  r.post<{ Params: { versionId: string } }>(
    "/v1/admin/tariffs/versions/:versionId/publish",
    { summary: "Activar una tarifa (BLOQUEADO mientras ECONOMICS_ACTIVATION=disabled)", tags: TAG_TARIFFS },
    (req) => {
      const principal = authorizeAdmin(db, req, "tariff_activation", "write");
      const raw: unknown = req.body;
      const body: Partial<AdminTariffPublishRequest> = {};
      if (typeof raw === "object" && raw !== null) {
        const record = raw as Record<string, unknown>;
        if (typeof record.approvalReference === "string") body.approvalReference = record.approvalReference;
        if (typeof record.effectiveFrom === "string") body.effectiveFrom = record.effectiveFrom;
      }
      return publishTariffVersion(db, principal.userId, req.params.versionId, body, req.requestId);
    },
  );

  // ── Operación y alertas ─────────────────────────────────────────────────────────────────────────────────────────

  r.get(
    "/v1/admin/operations",
    { summary: "Restricciones operativas y reglas de alertas en tiempo real", tags: TAG_TARIFFS },
    (req) => {
      const principal = authorizeAdmin(db, req, "operations", "read");
      const result = getOperations(db);
      auditAdmin(db, req.requestId, principal, "admin.operations.viewed", "operations", null);
      return result;
    },
  );

  r.put<{ Body: AdminOperationsUpdate }>(
    "/v1/admin/operations",
    { summary: "Guardar restricciones y reglas de alertas", tags: TAG_TARIFFS, schema: { body: operationsBody } },
    (req) => {
      const principal = authorizeAdmin(db, req, "operations", "write");
      return updateOperations(db, principal.userId, req.body, req.requestId);
    },
  );

  r.get<{ Query: AlertsQuery }>(
    "/v1/admin/alerts",
    {
      summary: "Alertas de operación generadas por eventos reales",
      tags: TAG_TARIFFS,
      schema: {
        querystring: queryOf({
          status: { type: "string", enum: ["open", "acknowledged", "resolved", "all"], default: "open" },
          kind: { type: "string", enum: ALERT_KINDS },
        }),
      },
    },
    (req) => {
      const principal = authorizeAdmin(db, req, "alerts", "read");
      const status = req.query.status ?? "open";
      const result = listAlerts(db, { status, kind: req.query.kind, cursor: req.query.cursor, limit: req.query.limit });
      auditAdmin(db, req.requestId, principal, "admin.alerts.listed", "alerts", null, {
        status,
        kind: req.query.kind ?? null,
        returned: result.items.length,
      });
      return result;
    },
  );

  r.post(
    "/v1/admin/alerts/evaluate",
    { summary: "Evaluar las reglas de alerta ahora", tags: TAG_TARIFFS },
    (req) => {
      const principal = authorizeAdmin(db, req, "alerts", "write");
      return evaluateAlerts(db, principal.userId, req.requestId);
    },
  );

  r.post<{ Params: { alertId: string }; Body: { status: "acknowledged" | "resolved" } }>(
    "/v1/admin/alerts/:alertId/status",
    {
      summary: "Reconocer o resolver una alerta",
      tags: TAG_TARIFFS,
      schema: {
        params: uuidParam("alertId"),
        body: {
          type: "object",
          additionalProperties: false,
          required: ["status"],
          properties: { status: { type: "string", enum: ["acknowledged", "resolved"] } },
        },
      },
    },
    (req) => {
      const principal = authorizeAdmin(db, req, "alerts", "write");
      return changeAlertStatus(db, principal.userId, req.params.alertId, req.body.status, req.requestId);
    },
  );

  // ── Auditoría ───────────────────────────────────────────────────────────────────────────────────────────────────

  r.get<{ Query: AuditFilters }>(
    "/v1/admin/audit-events",
    {
      summary: "Visor de auditoría con filtros y datos personales ocultos",
      tags: TAG_AUDIT,
      schema: {
        querystring: queryOf({
          actorUserId: { type: "string", format: "uuid" },
          action: { type: "string", maxLength: 101 },
          entityType: { type: "string", maxLength: 100 },
          entityId: { type: "string", maxLength: 200 },
          from: { type: "string", maxLength: 40 },
          to: { type: "string", maxLength: 40 },
        }),
      },
    },
    (req) => {
      const principal = authorizeAdmin(db, req, "audit", "read");
      const query = req.query;
      const result = listAuditEvents(db, { ...query, limit: query.limit === undefined ? undefined : clampLimit(query.limit) });
      auditAdmin(db, req.requestId, principal, "admin.audit_log.viewed", "audit_log", null, {
        filters: {
          actorUserId: query.actorUserId ?? null,
          action: query.action ?? null,
          entityType: query.entityType ?? null,
          entityId: query.entityId ?? null,
          from: query.from ?? null,
          to: query.to ?? null,
        },
        returned: result.items.length,
      });
      return result;
    },
  );
}
