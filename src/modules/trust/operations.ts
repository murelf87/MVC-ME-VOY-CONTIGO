import type { AuthPrincipal } from "../../auth/session.js";
import { writeAudit } from "../../lib/audit.js";
import { UUID_RE, clampLimit, decodeCursor, encodeCursor, iso, isoOrNull, sliceOverflow, trustError } from "./common.js";
import type { Db, TrustContext } from "./context.js";
import { tableExists } from "./summary.js";

export const ALERT_KINDS = ["unusual_cancellations", "schedule_price_changes", "route_incidents"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export type AlertStatus = "open" | "acknowledged" | "resolved";

export type RuleParams = { thresholdCount?: number; windowMinutes?: number; maxPendingMinutes?: number };

export const RULE_LABELS: Record<AlertKind, string> = {
  unusual_cancellations: "Cancelaciones inusuales",
  schedule_price_changes: "Cambios de horario o precio (requiere aceptación)",
  route_incidents: "Incidencias en ruta"
};

/** Parámetros admitidos por regla y su rango. Cualquier otro parámetro se rechaza. */
const PARAM_SPEC: Record<AlertKind, Record<string, { min: number; max: number }>> = {
  unusual_cancellations: { thresholdCount: { min: 1, max: 1000 }, windowMinutes: { min: 5, max: 1440 } },
  schedule_price_changes: { maxPendingMinutes: { min: 1, max: 1440 } },
  route_incidents: { thresholdCount: { min: 1, max: 1000 }, windowMinutes: { min: 5, max: 1440 } }
};

const INCIDENTS_UNAVAILABLE_NOTE = "La fuente de incidencias (módulo live) aún no está disponible.";

type RuleRow = { kind: AlertKind; enabled: boolean; params: RuleParams; updated_at: Date | null; updated_by_user_id: string | null };

export async function ruleSource(db: Db, kind: AlertKind): Promise<{ source: "available" | "unavailable"; sourceNote: string | null }> {
  if (kind === "route_incidents" && !(await tableExists(db, "incident_reports"))) {
    return { source: "unavailable", sourceNote: INCIDENTS_UNAVAILABLE_NOTE };
  }
  return { source: "available", sourceNote: null };
}

export async function loadRules(db: Db): Promise<RuleRow[]> {
  const rows = await db.query<RuleRow>(
    `select kind, enabled, params, updated_at, updated_by_user_id from trust_alert_rules order by kind`
  );
  const order = new Map(ALERT_KINDS.map((k, i) => [k, i]));
  return rows.rows.sort((a, b) => (order.get(a.kind) ?? 9) - (order.get(b.kind) ?? 9));
}

export async function getOperations(ctx: TrustContext) {
  const [settings, rules] = await Promise.all([
    ctx.pool.query<{ realtime_alerts_enabled: boolean; updated_at: Date | null; updated_by_user_id: string | null }>(
      `select realtime_alerts_enabled, updated_at, updated_by_user_id from trust_operations_settings where id`
    ),
    loadRules(ctx.pool)
  ]);
  const s = settings.rows[0];
  const dtoRules = [];
  for (const rule of rules) {
    dtoRules.push({
      kind: rule.kind,
      label: RULE_LABELS[rule.kind],
      enabled: rule.enabled,
      params: rule.params,
      ...(await ruleSource(ctx.pool, rule.kind))
    });
  }
  // «Última modificación»: la más reciente entre el interruptor general y las reglas.
  const stamps: Array<{ at: Date; by: string | null }> = [];
  if (s?.updated_at) stamps.push({ at: s.updated_at, by: s.updated_by_user_id });
  for (const r of rules) if (r.updated_at) stamps.push({ at: r.updated_at, by: r.updated_by_user_id });
  stamps.sort((a, b) => b.at.getTime() - a.at.getTime());
  const latest = stamps[0];
  let updatedBy: { id: string; displayName: string | null } | null = null;
  if (latest?.by) {
    const who = await ctx.pool.query<{ display_name: string | null }>(`select display_name from profiles where user_id = $1`, [latest.by]);
    updatedBy = { id: latest.by, displayName: who.rows[0]?.display_name ?? null };
  }
  return {
    provinceOnly: { enabled: true as const, locked: true as const, label: "Solo trayectos dentro de la provincia" },
    realtimeAlerts: { enabled: s?.realtime_alerts_enabled ?? true, rules: dtoRules },
    updatedAt: latest ? latest.at.toISOString() : null,
    updatedBy
  };
}

export type OperationsUpdate = {
  realtimeAlertsEnabled?: boolean | undefined;
  rules?: Array<{ kind: AlertKind; enabled?: boolean | undefined; params?: RuleParams | undefined }> | undefined;
  provinceOnly?: boolean | undefined;
};

export async function updateOperations(ctx: TrustContext, principal: AuthPrincipal, input: OperationsUpdate, requestId: string) {
  if (input.provinceOnly === false) {
    throw trustError("PROVINCE_ONLY_LOCKED", "«Solo trayectos dentro de la provincia» está siempre activo y no se puede cambiar.", 422);
  }
  // Valida parámetros ANTES de tocar nada.
  const issues: Array<{ path: string; message: string }> = [];
  (input.rules ?? []).forEach((rule, index) => {
    for (const [name, value] of Object.entries(rule.params ?? {})) {
      const spec = PARAM_SPEC[rule.kind][name];
      if (!spec) {
        issues.push({ path: `rules.${index}.params.${name}`, message: `parámetro no admitido para ${rule.kind}` });
      } else if (typeof value !== "number" || !Number.isInteger(value) || value < spec.min || value > spec.max) {
        issues.push({ path: `rules.${index}.params.${name}`, message: `entero entre ${spec.min} y ${spec.max}` });
      }
    }
  });
  if (issues.length > 0) throw trustError("VALIDATION_ERROR", "Los parámetros de las reglas no son válidos.", 400, { issues });

  const client = await ctx.pool.connect();
  try {
    await client.query("begin");
    const changes: Record<string, unknown> = {};
    if (input.realtimeAlertsEnabled !== undefined) {
      await client.query(
        `update trust_operations_settings set realtime_alerts_enabled = $1, updated_at = now(), updated_by_user_id = $2 where id`,
        [input.realtimeAlertsEnabled, principal.userId]
      );
      changes.realtimeAlertsEnabled = input.realtimeAlertsEnabled;
    }
    for (const rule of input.rules ?? []) {
      const current = await client.query<{ enabled: boolean; params: RuleParams }>(
        `select enabled, params from trust_alert_rules where kind = $1 for update`,
        [rule.kind]
      );
      const before = current.rows[0];
      if (!before) continue;
      const params = { ...before.params, ...(rule.params ?? {}) };
      const enabled = rule.enabled ?? before.enabled;
      await client.query(
        `update trust_alert_rules set enabled = $2, params = $3::jsonb, updated_at = now(), updated_by_user_id = $4 where kind = $1`,
        [rule.kind, enabled, JSON.stringify(params), principal.userId]
      );
      changes[rule.kind] = { before: { enabled: before.enabled, params: before.params }, after: { enabled, params } };
    }
    await writeAudit(client, {
      actorUserId: principal.userId,
      action: "admin.operations.updated",
      entityType: "operations",
      entityId: null,
      requestId,
      metadata: { changes }
    });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return getOperations(ctx);
}

/* ───────────── Alertas ───────────── */

type AlertRow = {
  id: string;
  kind: AlertKind;
  severity: "info" | "warning" | "critical";
  status: AlertStatus;
  title: string;
  body: string;
  detected_at: Date;
  detected_at_text: string;
  data: Record<string, unknown>;
  acknowledged_at: Date | null;
  resolved_at: Date | null;
  province_id: string | null;
  province_code: string | null;
  province_name: string | null;
};

const ALERT_SELECT = `
  select a.id, a.kind, a.severity, a.status, a.title, a.body, a.detected_at,
         to_char(a.detected_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as detected_at_text,
         a.data, a.acknowledged_at, a.resolved_at, a.province_id, pr.code as province_code, pr.name as province_name
    from trust_admin_alerts a
    left join provinces pr on pr.id = a.province_id`;

export function toAlert(row: AlertRow) {
  return {
    id: row.id,
    kind: row.kind,
    severity: row.severity,
    status: row.status,
    title: row.title,
    body: row.body,
    detectedAt: iso(row.detected_at),
    province: row.province_id && row.province_code && row.province_name ? { id: row.province_id, code: row.province_code, name: row.province_name } : null,
    data: row.data,
    acknowledgedAt: isoOrNull(row.acknowledged_at),
    resolvedAt: isoOrNull(row.resolved_at)
  };
}

export async function listAlerts(
  db: Db,
  input: { status: AlertStatus | "all"; kind?: AlertKind | undefined; cursor?: string | undefined; limit?: number | undefined }
) {
  const limit = clampLimit(input.limit);
  const params: unknown[] = [input.status === "all" ? null : input.status, input.kind ?? null];
  let keyset = "";
  if (input.cursor) {
    const cursor = decodeCursor(input.cursor, { t: "iso", id: "uuid" });
    params.push(String(cursor.t), String(cursor.id));
    keyset = `and (a.detected_at, a.id) < ($3::timestamptz, $4::uuid)`;
  }
  const rows = await db.query<AlertRow>(
    `${ALERT_SELECT}
      where ($1::text is null or a.status = $1::text) and ($2::text is null or a.kind = $2::text) ${keyset}
      order by a.detected_at desc, a.id desc
      limit ${limit + 1}`,
    params
  );
  const { page, hasMore } = sliceOverflow(rows.rows, limit);
  const last = page[page.length - 1];
  return { items: page.map(toAlert), nextCursor: hasMore && last ? encodeCursor({ t: last.detected_at_text, id: last.id }) : null };
}

export async function changeAlertStatus(
  ctx: TrustContext,
  principal: AuthPrincipal,
  alertId: string,
  to: "acknowledged" | "resolved",
  requestId: string
) {
  if (!UUID_RE.test(alertId)) throw trustError("ALERT_NOT_FOUND", "No existe esa alerta.", 404);
  const client = await ctx.pool.connect();
  try {
    await client.query("begin");
    const found = await client.query<{ status: AlertStatus; kind: AlertKind }>(
      `select status, kind from trust_admin_alerts where id = $1 for update`,
      [alertId]
    );
    const row = found.rows[0];
    if (!row) throw trustError("ALERT_NOT_FOUND", "No existe esa alerta.", 404);
    const allowed = (row.status === "open" && (to === "acknowledged" || to === "resolved")) || (row.status === "acknowledged" && to === "resolved");
    if (!allowed) {
      throw trustError("ALERT_INVALID_TRANSITION", `No se puede pasar una alerta de «${row.status}» a «${to}».`, 409, { from: row.status, to });
    }
    if (to === "acknowledged") {
      await client.query(
        `update trust_admin_alerts set status = 'acknowledged', acknowledged_at = now(), acknowledged_by_user_id = $2, updated_at = now() where id = $1`,
        [alertId, principal.userId]
      );
    } else {
      await client.query(
        `update trust_admin_alerts set status = 'resolved', resolved_at = now(), resolved_by_user_id = $2, updated_at = now() where id = $1`,
        [alertId, principal.userId]
      );
    }
    await writeAudit(client, {
      actorUserId: principal.userId,
      action: "admin.alert.status_changed",
      entityType: "admin_alert",
      entityId: alertId,
      requestId,
      metadata: { from: row.status, to, kind: row.kind }
    });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  const result = await ctx.pool.query<AlertRow>(`${ALERT_SELECT} where a.id = $1`, [alertId]);
  return toAlert(result.rows[0]!);
}
