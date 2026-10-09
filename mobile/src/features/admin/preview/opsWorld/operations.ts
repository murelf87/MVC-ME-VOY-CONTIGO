/**
 * Operación (pantalla 40): restricciones, reglas de alertas en tiempo real y las alertas que generan.
 * Espejo de `src/modules/trust/operations.ts` y `operations/evaluator.ts`.
 *
 * Las alertas SOLO nacen de eventos reales del mundo simulado (reservas canceladas, incidencias si existe la fuente):
 * el evaluador no inventa nada. Las que trae la siembra son datos de ejemplo de la vista previa.
 */
import type {
  AdminAlert,
  AdminAlertEvaluation,
  AdminAlertKind,
  AdminAlertRule,
  AdminAlertRuleParams,
  AdminAlertSeverity,
  AdminAlertStatus,
  AdminOperations,
  AdminOperationsUpdate,
} from "@/api/types";
import { fail, writeAudit, type PreviewDb } from "@/preview";
import { actorRef, iso, isoOrNull, sliceOf, type PageSlice } from "./common";

export const ALERT_KINDS: readonly AdminAlertKind[] = ["unusual_cancellations", "schedule_price_changes", "route_incidents"];

export const RULE_LABELS: Record<AdminAlertKind, string> = {
  unusual_cancellations: "Cancelaciones inusuales",
  schedule_price_changes: "Cambios de horario o precio (requiere aceptación)",
  route_incidents: "Incidencias en ruta",
};

const DEFAULT_PARAMS: Record<AdminAlertKind, AdminAlertRuleParams> = {
  unusual_cancellations: { thresholdCount: 5, windowMinutes: 60 },
  schedule_price_changes: { maxPendingMinutes: 30 },
  route_incidents: { thresholdCount: 1, windowMinutes: 60 },
};

/** Parámetros admitidos por regla y su rango. Cualquier otro parámetro se rechaza. */
const PARAM_SPEC: Record<AdminAlertKind, Record<string, { min: number; max: number }>> = {
  unusual_cancellations: { thresholdCount: { min: 1, max: 1000 }, windowMinutes: { min: 5, max: 1440 } },
  schedule_price_changes: { maxPendingMinutes: { min: 1, max: 1440 } },
  route_incidents: { thresholdCount: { min: 1, max: 1000 }, windowMinutes: { min: 5, max: 1440 } },
};

const INCIDENTS_UNAVAILABLE_NOTE = "La fuente de incidencias (módulo live) aún no está disponible.";

/** Ajuste de la simulación: la fuente de incidencias del módulo live NO existe todavía (variante `admin-ops-no-incident-source`). */
export const INCIDENTS_UNAVAILABLE_SETTING = "trust.incidentsSourceUnavailable";

export interface OperationsSettingsRow {
  /** Fila única. */
  id: "settings";
  realtime_alerts_enabled: boolean;
  updated_at: number | null;
  updated_by_user_id: string | null;
}

export interface AlertRuleRow {
  kind: AdminAlertKind;
  enabled: boolean;
  params: AdminAlertRuleParams;
  updated_at: number | null;
  updated_by_user_id: string | null;
}

export interface AlertRow {
  id: string;
  kind: AdminAlertKind;
  severity: AdminAlertSeverity;
  status: AdminAlertStatus;
  dedupe_key: string;
  title: string;
  body: string;
  province_id: string | null;
  data: Record<string, unknown>;
  detected_at: number;
  acknowledged_at: number | null;
  acknowledged_by_user_id: string | null;
  resolved_at: number | null;
  resolved_by_user_id: string | null;
  updated_at: number;
}

export const settingsTable = (db: PreviewDb) => db.collection<OperationsSettingsRow>("trust_operations_settings");
export const rulesTable = (db: PreviewDb) => db.collection<AlertRuleRow>("trust_alert_rules", { pk: "kind" });
export const alertsTable = (db: PreviewDb) => db.collection<AlertRow>("trust_admin_alerts");

/** Crea la fila de ajustes y las tres reglas con sus valores por defecto si faltan (migración 082). */
export function ensureOperationsDefaults(db: PreviewDb): void {
  if (settingsTable(db).get("settings") === undefined) {
    settingsTable(db).insert({ id: "settings", realtime_alerts_enabled: true, updated_at: null, updated_by_user_id: null });
  }
  for (const kind of ALERT_KINDS) {
    if (rulesTable(db).get(kind) === undefined) {
      rulesTable(db).insert({ kind, enabled: true, params: { ...DEFAULT_PARAMS[kind] }, updated_at: null, updated_by_user_id: null });
    }
  }
}

function ruleSource(db: PreviewDb, kind: AdminAlertKind): { source: "available" | "unavailable"; sourceNote: string | null } {
  if (kind === "route_incidents" && db.getSetting<boolean>(INCIDENTS_UNAVAILABLE_SETTING) === true) {
    return { source: "unavailable", sourceNote: INCIDENTS_UNAVAILABLE_NOTE };
  }
  return { source: "available", sourceNote: null };
}

function orderedRules(db: PreviewDb): AlertRuleRow[] {
  const order = new Map(ALERT_KINDS.map((kind, index) => [kind, index]));
  return [...rulesTable(db).all()].sort((a, b) => (order.get(a.kind) ?? 9) - (order.get(b.kind) ?? 9));
}

export function getOperations(db: PreviewDb): AdminOperations {
  ensureOperationsDefaults(db);
  const settings = settingsTable(db).get("settings");
  const rules = orderedRules(db);
  const dtoRules: AdminAlertRule[] = rules.map((rule) => ({
    kind: rule.kind,
    label: RULE_LABELS[rule.kind],
    enabled: rule.enabled,
    params: rule.params,
    ...ruleSource(db, rule.kind),
  }));
  // «Última modificación»: la más reciente entre el interruptor general y las reglas.
  const stamps: Array<{ at: number; by: string | null }> = [];
  if (settings?.updated_at !== null && settings?.updated_at !== undefined) stamps.push({ at: settings.updated_at, by: settings.updated_by_user_id });
  for (const rule of rules) if (rule.updated_at !== null) stamps.push({ at: rule.updated_at, by: rule.updated_by_user_id });
  stamps.sort((a, b) => b.at - a.at);
  const latest = stamps[0];
  return {
    provinceOnly: { enabled: true, locked: true, label: "Solo trayectos dentro de la provincia" },
    realtimeAlerts: { enabled: settings?.realtime_alerts_enabled ?? true, rules: dtoRules },
    updatedAt: latest === undefined ? null : iso(latest.at),
    updatedBy: latest === undefined ? null : actorRef(db, latest.by),
  };
}

export function updateOperations(db: PreviewDb, actorUserId: string, input: AdminOperationsUpdate, requestId: string): AdminOperations {
  if ((input.provinceOnly as boolean | undefined) === false) {
    fail("PROVINCE_ONLY_LOCKED", "«Solo trayectos dentro de la provincia» está siempre activo y no se puede cambiar.", 422);
  }
  // Valida los parámetros ANTES de tocar nada.
  const issues: Array<{ path: string; message: string }> = [];
  (input.rules ?? []).forEach((rule, index) => {
    for (const [name, value] of Object.entries(rule.params ?? {})) {
      const spec = PARAM_SPEC[rule.kind][name];
      if (spec === undefined) {
        issues.push({ path: `rules.${index}.params.${name}`, message: `parámetro no admitido para ${rule.kind}` });
      } else if (typeof value !== "number" || !Number.isInteger(value) || value < spec.min || value > spec.max) {
        issues.push({ path: `rules.${index}.params.${name}`, message: `entero entre ${spec.min} y ${spec.max}` });
      }
    }
  });
  if (issues.length > 0) fail("VALIDATION_ERROR", "Los parámetros de las reglas no son válidos.", 400, { issues });

  ensureOperationsDefaults(db);
  const now = db.nowMs();
  db.tx(() => {
    const changes: Record<string, unknown> = {};
    if (input.realtimeAlertsEnabled !== undefined) {
      settingsTable(db).update("settings", { realtime_alerts_enabled: input.realtimeAlertsEnabled, updated_at: now, updated_by_user_id: actorUserId });
      changes.realtimeAlertsEnabled = input.realtimeAlertsEnabled;
    }
    for (const rule of input.rules ?? []) {
      const before = rulesTable(db).get(rule.kind);
      if (before === undefined) continue;
      const params = { ...before.params, ...(rule.params ?? {}) };
      const enabled = rule.enabled ?? before.enabled;
      rulesTable(db).update(rule.kind, { enabled, params, updated_at: now, updated_by_user_id: actorUserId });
      changes[rule.kind] = { before: { enabled: before.enabled, params: before.params }, after: { enabled, params } };
    }
    writeAudit(db, { actorUserId, action: "admin.operations.updated", entityType: "operations", entityId: null, requestId, metadata: { changes } });
  });
  return getOperations(db);
}

// ── Alertas ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function toAlert(db: PreviewDb, row: AlertRow): AdminAlert {
  const province = row.province_id === null ? undefined : db.provinces.get(row.province_id);
  return {
    id: row.id,
    kind: row.kind,
    severity: row.severity,
    status: row.status,
    title: row.title,
    body: row.body,
    detectedAt: iso(row.detected_at),
    province: province === undefined ? null : { id: province.id, code: province.code, name: province.name },
    data: row.data,
    acknowledgedAt: isoOrNull(row.acknowledged_at),
    resolvedAt: isoOrNull(row.resolved_at),
  };
}

export function listAlerts(
  db: PreviewDb,
  input: { status: AdminAlertStatus | "all"; kind?: AdminAlertKind | undefined; cursor?: string | undefined; limit?: number | undefined },
): PageSlice<AdminAlert> {
  const rows = alertsTable(db)
    .filter((row) => (input.status === "all" || row.status === input.status) && (input.kind === undefined || row.kind === input.kind))
    .sort((a, b) => b.detected_at - a.detected_at || (a.id < b.id ? 1 : -1));
  const page = sliceOf(rows, input.cursor, input.limit);
  return { items: page.items.map((row) => toAlert(db, row)), nextCursor: page.nextCursor };
}

export function changeAlertStatus(db: PreviewDb, actorUserId: string, alertId: string, to: "acknowledged" | "resolved", requestId: string): AdminAlert {
  const row = alertsTable(db).get(alertId);
  if (row === undefined) return fail("ALERT_NOT_FOUND", "No existe esa alerta.", 404);
  const allowed = (row.status === "open" && (to === "acknowledged" || to === "resolved")) || (row.status === "acknowledged" && to === "resolved");
  if (!allowed) return fail("ALERT_INVALID_TRANSITION", `No se puede pasar una alerta de «${row.status}» a «${to}».`, 409, { from: row.status, to });
  const now = db.nowMs();
  return db.tx(() => {
    const updated =
      to === "acknowledged"
        ? alertsTable(db).update(alertId, { status: "acknowledged", acknowledged_at: now, acknowledged_by_user_id: actorUserId, updated_at: now })
        : alertsTable(db).update(alertId, { status: "resolved", resolved_at: now, resolved_by_user_id: actorUserId, updated_at: now });
    writeAudit(db, {
      actorUserId,
      action: "admin.alert.status_changed",
      entityType: "admin_alert",
      entityId: alertId,
      requestId,
      metadata: { from: row.status, to, kind: row.kind },
    });
    return toAlert(db, updated);
  });
}

// ── Evaluador ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Inserta la alerta salvo que ya exista una abierta/reconocida con la misma clave. Devuelve `true` si se creó. */
function insertAlert(
  db: PreviewDb,
  alert: { kind: AdminAlertKind; severity: AdminAlertSeverity; dedupeKey: string; title: string; body: string; provinceId: string | null; data: Record<string, unknown> },
  now: number,
): boolean {
  const live = alertsTable(db).find((row) => row.dedupe_key === alert.dedupeKey && (row.status === "open" || row.status === "acknowledged"));
  if (live !== undefined) return false;
  alertsTable(db).insert({
    id: db.ids.uuid(),
    kind: alert.kind,
    severity: alert.severity,
    status: "open",
    dedupe_key: alert.dedupeKey,
    title: alert.title,
    body: alert.body,
    province_id: alert.provinceId,
    data: alert.data,
    detected_at: now,
    acknowledged_at: null,
    acknowledged_by_user_id: null,
    resolved_at: null,
    resolved_by_user_id: null,
    updated_at: now,
  });
  return true;
}

function evaluateCancellations(db: PreviewDb, params: { thresholdCount: number; windowMinutes: number }, now: number): number {
  const since = now - params.windowMinutes * 60_000;
  const byProvince = new Map<string, number>();
  for (const booking of db.bookings.all()) {
    if (booking.status !== "cancelled" && booking.status !== "driver_cancelled") continue;
    if (booking.updated_at < since || booking.updated_at > now) continue;
    const request = db.rideRequests.get(booking.request_id);
    const trip = request === undefined ? undefined : db.trips.get(request.trip_id);
    if (trip === undefined) continue;
    byProvince.set(trip.province_id, (byProvince.get(trip.province_id) ?? 0) + 1);
  }
  let created = 0;
  for (const [provinceId, count] of byProvince) {
    if (count < params.thresholdCount) continue;
    const ok = insertAlert(
      db,
      {
        kind: "unusual_cancellations",
        severity: count >= params.thresholdCount * 2 ? "critical" : "warning",
        dedupeKey: `unusual_cancellations:${provinceId}`,
        title: "Cancelaciones inusuales",
        body: `${count} reservas canceladas en los últimos ${params.windowMinutes} minutos (umbral: ${params.thresholdCount}).`,
        provinceId,
        data: { count, windowMinutes: params.windowMinutes, thresholdCount: params.thresholdCount },
      },
      now,
    );
    if (ok) created += 1;
  }
  return created;
}

interface IncidentLike {
  trip_id?: unknown;
  created_at?: unknown;
  status?: unknown;
  category?: unknown;
}

function evaluateIncidents(db: PreviewDb, params: { thresholdCount: number; windowMinutes: number }, now: number): number {
  // El módulo live guarda sus incidencias en `live_incident_reports`; sin esa colección no hay fuente de la que leer.
  if (!db.collectionNames().includes("live_incident_reports")) return 0;
  let incidents: Array<Readonly<IncidentLike & { id: string }>>;
  try {
    incidents = db.collection<IncidentLike & { id: string }>("live_incident_reports").all();
  } catch {
    // otra clave primaria que la esperada: no hay forma fiable de leer esa fuente
    return 0;
  }
  const since = now - params.windowMinutes * 60_000;
  const byProvince = new Map<string, { n: number; safety: number }>();
  for (const raw of incidents) {
    const createdAt = typeof raw.created_at === "number" ? raw.created_at : 0;
    if (createdAt < since || createdAt > now) continue;
    if (raw.status !== "open" && raw.status !== "in_review") continue;
    const trip = typeof raw.trip_id === "string" ? db.trips.get(raw.trip_id) : undefined;
    if (trip === undefined) continue;
    const entry = byProvince.get(trip.province_id) ?? { n: 0, safety: 0 };
    entry.n += 1;
    if (raw.category === "safety") entry.safety += 1;
    byProvince.set(trip.province_id, entry);
  }
  let created = 0;
  for (const [provinceId, group] of byProvince) {
    if (group.n < params.thresholdCount) continue;
    const ok = insertAlert(
      db,
      {
        kind: "route_incidents",
        severity: group.safety > 0 ? "critical" : "warning",
        dedupeKey: `route_incidents:${provinceId}`,
        title: "Incidencias en ruta",
        body: `${group.n} incidencias abiertas en los últimos ${params.windowMinutes} minutos (umbral: ${params.thresholdCount}).`,
        provinceId,
        data: { count: group.n, safetyCount: group.safety, windowMinutes: params.windowMinutes, thresholdCount: params.thresholdCount },
      },
      now,
    );
    if (ok) created += 1;
  }
  return created;
}

export function evaluateAlerts(db: PreviewDb, actorUserId: string | null, requestId: string | null): AdminAlertEvaluation {
  ensureOperationsDefaults(db);
  const now = db.nowMs();
  const realtimeOn = settingsTable(db).get("settings")?.realtime_alerts_enabled ?? true;
  const out: AdminAlertEvaluation["rules"] = [];
  db.tx(() => {
    for (const kind of ALERT_KINDS) {
      const rule = rulesTable(db).get(kind);
      const enabled = rule?.enabled ?? false;
      if (!realtimeOn) {
        out.push({ kind, enabled, evaluated: false, created: 0, skippedReason: "realtime_alerts_off" });
        continue;
      }
      if (rule === undefined || !enabled) {
        out.push({ kind, enabled, evaluated: false, created: 0, skippedReason: "disabled" });
        continue;
      }
      if (ruleSource(db, kind).source === "unavailable") {
        out.push({ kind, enabled, evaluated: false, created: 0, skippedReason: "source_unavailable" });
        continue;
      }
      let created = 0;
      if (kind === "unusual_cancellations") {
        created = evaluateCancellations(db, { thresholdCount: rule.params.thresholdCount ?? 5, windowMinutes: rule.params.windowMinutes ?? 60 }, now);
      } else if (kind === "route_incidents") {
        created = evaluateIncidents(db, { thresholdCount: rule.params.thresholdCount ?? 1, windowMinutes: rule.params.windowMinutes ?? 60 }, now);
      }
      // `schedule_price_changes` lee las propuestas de cambio de ruta del módulo live: en la vista previa no hay
      // propuestas con impacto pendientes, así que no se crea (ni se cierra) nada.
      out.push({ kind, enabled, evaluated: true, created, skippedReason: null });
    }
    const total = out.reduce((sum, item) => sum + item.created, 0);
    writeAudit(db, {
      actorUserId,
      action: "admin.alerts.evaluated",
      entityType: "operations",
      entityId: null,
      requestId,
      metadata: { via: "api", created: total, autoResolved: 0, byKind: Object.fromEntries(out.map((item) => [item.kind, item.created])) },
    });
  });
  return { evaluatedAt: iso(now), created: out.reduce((sum, item) => sum + item.created, 0), autoResolved: 0, rules: out };
}
