import { writeAudit } from "../../../lib/audit.js";
import { notify } from "../../../lib/notify.js";
import type { Db, TrustContext } from "../context.js";
import { ALERT_KINDS, type AlertKind, loadRules, ruleSource } from "../operations.js";

export type RuleEvaluation = {
  kind: AlertKind;
  enabled: boolean;
  evaluated: boolean;
  created: number;
  skippedReason: "disabled" | "realtime_alerts_off" | "source_unavailable" | null;
};

export type AlertEvaluation = { evaluatedAt: string; created: number; autoResolved: number; rules: RuleEvaluation[] };

type NewAlert = {
  kind: AlertKind;
  severity: "info" | "warning" | "critical";
  dedupeKey: string;
  title: string;
  body: string;
  provinceId: string | null;
  data: Record<string, unknown>;
};

/**
 * Inserta la alerta salvo que ya exista una abierta/reconocida con la misma clave (true si se creó) y avisa al equipo
 * (administración y soporte) en la misma transacción: o se guardan alerta y avisos, o ninguno. Los avisos llevan solo el título
 * y el identificador de la alerta, nunca datos personales.
 */
async function insertAlert(ctx: TrustContext, alert: NewAlert, now: Date): Promise<boolean> {
  const client = await ctx.pool.connect();
  try {
    await client.query("begin");
    const inserted = await client.query<{ id: string }>(
      `insert into trust_admin_alerts(kind, severity, dedupe_key, title, body, province_id, data, detected_at)
       values($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
       on conflict (dedupe_key) where status in ('open','acknowledged') do nothing
       returning id`,
      [alert.kind, alert.severity, alert.dedupeKey, alert.title, alert.body, alert.provinceId, JSON.stringify(alert.data), now.toISOString()]
    );
    const alertId = inserted.rows[0]?.id;
    if (!alertId) {
      await client.query("commit");
      return false;
    }
    const recipients = await client.query<{ user_id: string }>(
      `select distinct ur.user_id
         from user_roles ur join app_users u on u.id = ur.user_id
        where ur.role in ('admin','support_admin') and u.status = 'active'`
    );
    for (const recipient of recipients.rows) {
      await notify(client, {
        userId: recipient.user_id,
        category: "system",
        kind: "admin_alert",
        title: "Alerta de operaciones",
        body: alert.title,
        data: { alertId, kind: alert.kind }
      });
    }
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function evaluateCancellations(ctx: TrustContext, params: { thresholdCount: number; windowMinutes: number }, now: Date): Promise<number> {
  const since = new Date(now.getTime() - params.windowMinutes * 60_000);
  const groups = await ctx.pool.query<{ province_id: string; n: number }>(
    `select t.province_id, count(*)::int as n
       from bookings b
       join ride_requests rr on rr.id = b.request_id
       join trips t on t.id = rr.trip_id
      where b.status in ('cancelled','driver_cancelled') and b.updated_at >= $1 and b.updated_at <= $2
      group by t.province_id
     having count(*) >= $3`,
    [since, now, params.thresholdCount]
  );
  let created = 0;
  for (const g of groups.rows) {
    const ok = await insertAlert(
      ctx,
      {
        kind: "unusual_cancellations",
        severity: g.n >= params.thresholdCount * 2 ? "critical" : "warning",
        dedupeKey: `unusual_cancellations:${g.province_id}`,
        title: "Cancelaciones inusuales",
        body: `${g.n} reservas canceladas en los últimos ${params.windowMinutes} minutos (umbral: ${params.thresholdCount}).`,
        provinceId: g.province_id,
        data: { count: g.n, windowMinutes: params.windowMinutes, thresholdCount: params.thresholdCount }
      },
      now
    );
    if (ok) created += 1;
  }
  return created;
}

async function evaluateScheduleChanges(ctx: TrustContext, params: { maxPendingMinutes: number }, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - params.maxPendingMinutes * 60_000);
  const rows = await ctx.pool.query<{
    id: string; trip_id: string; province_id: string; created_at: Date; material_price_change: boolean; material_schedule_change: boolean;
  }>(
    `select p.id, p.trip_id, t.province_id, p.created_at, p.material_price_change, p.material_schedule_change
       from route_change_proposals p
       join trips t on t.id = p.trip_id
      where p.status = 'pending' and (p.material_price_change or p.material_schedule_change) and p.created_at <= $1`,
    [cutoff]
  );
  let created = 0;
  for (const p of rows.rows) {
    const minutes = Math.max(0, Math.floor((now.getTime() - p.created_at.getTime()) / 60_000));
    const motivo = p.material_price_change && p.material_schedule_change ? "horario y precio" : p.material_price_change ? "precio" : "horario";
    const ok = await insertAlert(
      ctx,
      {
        kind: "schedule_price_changes",
        severity: "warning",
        dedupeKey: `schedule_price_changes:${p.id}`,
        title: "Cambio de horario o precio sin respuesta",
        body: `Una propuesta de cambio de ${motivo} lleva ${minutes} minutos esperando aceptación (máximo: ${params.maxPendingMinutes}).`,
        provinceId: p.province_id,
        data: {
          proposalId: p.id,
          tripId: p.trip_id,
          pendingMinutes: minutes,
          maxPendingMinutes: params.maxPendingMinutes,
          priceChange: p.material_price_change,
          scheduleChange: p.material_schedule_change
        }
      },
      now
    );
    if (ok) created += 1;
  }
  return created;
}

/** Las alertas de cambios sin respuesta se cierran solas cuando la propuesta deja de estar pendiente (el motivo ya no existe). */
async function autoResolveScheduleAlerts(db: Db): Promise<number> {
  const result = await db.query(
    `update trust_admin_alerts a
        set status = 'resolved', resolved_at = now(), updated_at = now()
      where a.kind = 'schedule_price_changes' and a.status in ('open','acknowledged')
        and not exists (
          select 1 from route_change_proposals p
           where p.id::text = a.data->>'proposalId' and p.status = 'pending')`
  );
  return result.rowCount ?? 0;
}

async function evaluateIncidents(ctx: TrustContext, params: { thresholdCount: number; windowMinutes: number }, now: Date): Promise<number> {
  const since = new Date(now.getTime() - params.windowMinutes * 60_000);
  const groups = await ctx.pool.query<{ province_id: string; n: number; safety: number }>(
    `select t.province_id, count(*)::int as n, (count(*) filter (where i.category = 'safety'))::int as safety
       from incident_reports i
       join trips t on t.id = i.trip_id
      where i.created_at >= $1 and i.created_at <= $2 and i.status in ('open','in_review')
      group by t.province_id
     having count(*) >= $3`,
    [since, now, params.thresholdCount]
  );
  let created = 0;
  for (const g of groups.rows) {
    const ok = await insertAlert(
      ctx,
      {
        kind: "route_incidents",
        severity: g.safety > 0 ? "critical" : "warning",
        dedupeKey: `route_incidents:${g.province_id}`,
        title: "Incidencias en ruta",
        body: `${g.n} incidencias abiertas en los últimos ${params.windowMinutes} minutos (umbral: ${params.thresholdCount}).`,
        provinceId: g.province_id,
        data: { count: g.n, safetyCount: g.safety, windowMinutes: params.windowMinutes, thresholdCount: params.thresholdCount }
      },
      now
    );
    if (ok) created += 1;
  }
  return created;
}

/**
 * Evalúa las reglas con eventos REALES (reservas canceladas, propuestas de cambio con impacto, incidencias si existe la fuente).
 * No inventa eventos: sin datos que superen el umbral no se crea nada. Llamable desde el endpoint o desde
 * `npx tsx src/modules/trust/operations/run-evaluator.ts`.
 */
export async function evaluateAlerts(
  ctx: TrustContext,
  opts: { actorUserId: string | null; requestId?: string | null; via?: "api" | "cli" }
): Promise<AlertEvaluation> {
  const now = ctx.now();
  const settings = await ctx.pool.query<{ realtime_alerts_enabled: boolean }>(`select realtime_alerts_enabled from trust_operations_settings where id`);
  const realtimeOn = settings.rows[0]?.realtime_alerts_enabled ?? true;
  const rules = await loadRules(ctx.pool);
  const out: RuleEvaluation[] = [];
  let autoResolved = 0;

  for (const kind of ALERT_KINDS) {
    const rule = rules.find(r => r.kind === kind);
    const enabled = rule?.enabled ?? false;
    if (!realtimeOn) {
      out.push({ kind, enabled, evaluated: false, created: 0, skippedReason: "realtime_alerts_off" });
      continue;
    }
    if (!rule || !enabled) {
      out.push({ kind, enabled, evaluated: false, created: 0, skippedReason: "disabled" });
      continue;
    }
    if ((await ruleSource(ctx.pool, kind)).source === "unavailable") {
      out.push({ kind, enabled, evaluated: false, created: 0, skippedReason: "source_unavailable" });
      continue;
    }
    let created = 0;
    if (kind === "unusual_cancellations") {
      created = await evaluateCancellations(
        ctx,
        { thresholdCount: rule.params.thresholdCount ?? 5, windowMinutes: rule.params.windowMinutes ?? 60 },
        now
      );
    } else if (kind === "schedule_price_changes") {
      created = await evaluateScheduleChanges(ctx, { maxPendingMinutes: rule.params.maxPendingMinutes ?? 30 }, now);
      autoResolved += await autoResolveScheduleAlerts(ctx.pool);
    } else {
      created = await evaluateIncidents(
        ctx,
        { thresholdCount: rule.params.thresholdCount ?? 1, windowMinutes: rule.params.windowMinutes ?? 60 },
        now
      );
    }
    out.push({ kind, enabled, evaluated: true, created, skippedReason: null });
  }
  const total = out.reduce((sum, r) => sum + r.created, 0);
  await writeAudit(ctx.pool, {
    actorUserId: opts.actorUserId,
    action: "admin.alerts.evaluated",
    entityType: "operations",
    entityId: null,
    requestId: opts.requestId ?? null,
    metadata: { via: opts.via ?? "api", created: total, autoResolved, byKind: Object.fromEntries(out.map(r => [r.kind, r.created])) }
  });
  return { evaluatedAt: now.toISOString(), created: total, autoResolved, rules: out };
}
