/**
 * Datos de ejemplo de la vista previa para tarifas, operación, alertas y auditoría (SIMULACIÓN).
 * El estado por defecto es el REAL de hoy: la economía no está activada (`ECONOMICS_ACTIVATION=disabled`), así que no hay
 * tarifa en vigor y publicar está bloqueado. Las variantes `admin-ops-*` llevan el mundo a otros estados.
 */
import type { AdminAlertKind, AdminAlertSeverity, AdminAlertStatus } from "@/api/types";
import { SEED_TRIP_IDS, SEED_USER_IDS, SEVILLA_PROVINCE_ID, stableUuid, type PreviewDb, type PreviewProfileId } from "@/preview";
import { INCIDENTS_UNAVAILABLE_SETTING, alertsTable, ensureOperationsDefaults, rulesTable, settingsTable, type AlertRow } from "./operations";
import { ECONOMICS_SETTING, tariffsTable, type TariffRow } from "./tariffs";

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** Un evento de auditoría pendiente de insertar (se ordenan por fecha al final para que el id crezca con el tiempo). */
export interface PendingAudit {
  at: number;
  actor: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  requestId?: string | null;
  metadata: Record<string, unknown>;
}

export interface OpsSeedCtx {
  db: PreviewDb;
  profile: PreviewProfileId;
  seed: string;
  now: number;
  staff: string;
  audit: PendingAudit[];
}

export function makeCtx(db: PreviewDb, profile: PreviewProfileId, seed: string): OpsSeedCtx {
  return { db, profile, seed, now: db.nowMs(), staff: SEED_USER_IDS.staff, audit: [] };
}

/** Escribe los eventos pendientes en `audit_events`, del más antiguo al más reciente. */
export function flushAudit(ctx: OpsSeedCtx): void {
  const sorted = [...ctx.audit].sort((a, b) => a.at - b.at);
  for (const event of sorted) {
    ctx.db.audit.insert({
      id: String(ctx.db.ids.seq("audit_events")),
      actor_user_id: event.actor,
      action: event.action,
      entity_type: event.entityType,
      entity_id: event.entityId,
      request_id: event.requestId ?? null,
      metadata: event.metadata,
      created_at: event.at,
    });
  }
  ctx.audit.length = 0;
}

// ── Tarifas ─────────────────────────────────────────────────────────────────────────────────────────────────────────

type TariffSeed = Partial<Omit<TariffRow, "id">> & { key: string; version: number; status: TariffRow["status"] };

function insertTariff(ctx: OpsSeedCtx, seed: TariffSeed): TariffRow {
  const { key, ...rest } = seed;
  const row: TariffRow = {
    id: stableUuid(`ops:tariff:${key}`),
    rate_micros_per_km: null,
    passenger_commission_bps: null,
    driver_commission_bps: null,
    shared_cost_cap_cents: null,
    premium_monthly_cents: null,
    effective_from: null,
    notes: null,
    approval_reference: null,
    created_at: ctx.now - 9 * DAY,
    updated_at: ctx.now - 9 * DAY,
    created_by_user_id: ctx.staff,
    updated_by_user_id: ctx.staff,
    approved_by_user_id: null,
    approved_at: null,
    retired_at: null,
    ...rest,
  };
  tariffsTable(ctx.db).insert(row);
  return row;
}

export function seedTariffs(ctx: OpsSeedCtx): void {
  const { now, seed } = ctx;
  const draftAudit = (row: TariffRow, created: boolean): void => {
    ctx.audit.push({
      at: row.updated_at,
      actor: ctx.staff,
      action: "admin.tariff_draft.saved",
      entityType: "tariff_version",
      entityId: row.id,
      metadata: {
        version: row.version,
        created,
        ratePerKmMicros: row.rate_micros_per_km,
        passengerCommissionBps: row.passenger_commission_bps,
        driverCommissionBps: row.driver_commission_bps,
        premiumMonthlyCents: row.premium_monthly_cents,
        sharedCostCapCents: row.shared_cost_cap_cents,
      },
    });
  };

  if (seed === "admin-ops-no-draft") return;

  if (seed === "admin-ops-tariff-b") {
    const draft = insertTariff(ctx, {
      key: "draft-b",
      version: 1,
      status: "draft",
      rate_micros_per_km: 180_000,
      passenger_commission_bps: 1_000,
      driver_commission_bps: 1_000,
      notes: null,
      created_at: now - 5 * DAY,
      updated_at: now - 3 * HOUR,
    });
    draftAudit(draft, false);
    return;
  }

  if (seed === "admin-ops-tariff-history" || seed === "admin-ops-activation-enabled") {
    ctx.db.setSetting(ECONOMICS_SETTING, "enabled");
    if (seed === "admin-ops-tariff-history") {
      insertTariff(ctx, {
        key: "v1",
        version: 1,
        status: "retired",
        rate_micros_per_km: 150_000,
        passenger_commission_bps: 800,
        driver_commission_bps: 800,
        premium_monthly_cents: 199,
        effective_from: Date.parse("2026-03-01T00:00:00+01:00"),
        approval_reference: "Acta de dirección 2026-02-20",
        approved_by_user_id: ctx.staff,
        approved_at: Date.parse("2026-02-20T11:00:00+01:00"),
        retired_at: Date.parse("2026-07-01T00:00:00+02:00"),
        created_at: Date.parse("2026-02-10T10:00:00+01:00"),
        updated_at: Date.parse("2026-07-01T00:00:00+02:00"),
      });
      const v2 = insertTariff(ctx, {
        key: "v2",
        version: 2,
        status: "approved",
        rate_micros_per_km: 180_000,
        passenger_commission_bps: 1_000,
        driver_commission_bps: 1_000,
        premium_monthly_cents: 299,
        effective_from: Date.parse("2026-07-01T00:00:00+02:00"),
        approval_reference: "Acta de dirección 2026-06-18",
        approved_by_user_id: ctx.staff,
        approved_at: Date.parse("2026-06-18T12:30:00+02:00"),
        created_at: Date.parse("2026-06-02T09:00:00+02:00"),
        updated_at: Date.parse("2026-06-18T12:30:00+02:00"),
      });
      ctx.audit.push({
        at: v2.approved_at ?? v2.updated_at,
        actor: ctx.staff,
        action: "admin.tariff.published",
        entityType: "tariff_version",
        entityId: v2.id,
        metadata: { version: 2, effectiveFrom: new Date(v2.effective_from ?? 0).toISOString(), approvalReference: v2.approval_reference },
      });
    }
    const draft = insertTariff(ctx, {
      key: "draft-complete",
      version: tariffsTable(ctx.db).size + 1,
      status: "draft",
      rate_micros_per_km: 190_000,
      passenger_commission_bps: 1_000,
      driver_commission_bps: 800,
      premium_monthly_cents: 299,
      shared_cost_cap_cents: 800,
      notes: "Propuesta para el trimestre de invierno",
      created_at: now - 4 * DAY,
      updated_at: now - 6 * HOUR,
    });
    draftAudit(draft, false);
    return;
  }

  // Por defecto y `admin-ops-tariff-a` (lámina 40a): borrador con la tarifa por km y todo lo demás «Por definir».
  const draft = insertTariff(ctx, {
    key: "draft-a",
    version: 1,
    status: "draft",
    rate_micros_per_km: 300_000,
    notes: "Propuesta pendiente de decisión",
    created_at: now - 9 * DAY,
    updated_at: now - 2 * DAY,
  });
  draftAudit(draft, true);
  ctx.audit.push({
    at: now - 2 * DAY + 4 * MIN,
    actor: ctx.staff,
    action: "admin.tariff.publish_attempted",
    entityType: "tariff_version",
    entityId: draft.id,
    metadata: { blocked: true, reason: "ECONOMICS_ACTIVATION_DISABLED", mode: "disabled" },
  });
}

// ── Operación y alertas ─────────────────────────────────────────────────────────────────────────────────────────────

export function seedOperations(ctx: OpsSeedCtx): void {
  const { db, now, seed } = ctx;
  ensureOperationsDefaults(db);
  const changedAt = now - 5 * DAY;
  if (seed === "admin-ops-alerts-off") {
    settingsTable(db).update("settings", { realtime_alerts_enabled: false, updated_at: now - 2 * HOUR, updated_by_user_id: ctx.staff });
    ctx.audit.push({
      at: now - 2 * HOUR,
      actor: ctx.staff,
      action: "admin.operations.updated",
      entityType: "operations",
      entityId: null,
      metadata: { changes: { realtimeAlertsEnabled: false } },
    });
    return;
  }
  if (seed === "admin-ops-no-incident-source") db.setSetting(INCIDENTS_UNAVAILABLE_SETTING, true);
  rulesTable(db).update("unusual_cancellations", { updated_at: changedAt, updated_by_user_id: ctx.staff });
  ctx.audit.push({
    at: changedAt,
    actor: ctx.staff,
    action: "admin.operations.updated",
    entityType: "operations",
    entityId: null,
    metadata: {
      changes: {
        unusual_cancellations: {
          before: { enabled: true, params: { thresholdCount: 8, windowMinutes: 60 } },
          after: { enabled: true, params: { thresholdCount: 5, windowMinutes: 60 } },
        },
      },
    },
  });
}

interface AlertSeed {
  key: string;
  kind: AdminAlertKind;
  severity: AdminAlertSeverity;
  status: AdminAlertStatus;
  title: string;
  body: string;
  data: Record<string, unknown>;
  detectedAt: number;
  acknowledgedAt?: number;
  resolvedAt?: number;
}

function insertAlertSeed(ctx: OpsSeedCtx, seed: AlertSeed): void {
  const row: AlertRow = {
    id: stableUuid(`ops:alert:${seed.key}`),
    kind: seed.kind,
    severity: seed.severity,
    status: seed.status,
    dedupe_key: `${seed.kind}:${seed.status === "resolved" ? seed.key : SEVILLA_PROVINCE_ID}`,
    title: seed.title,
    body: seed.body,
    province_id: SEVILLA_PROVINCE_ID,
    data: seed.data,
    detected_at: seed.detectedAt,
    acknowledged_at: seed.acknowledgedAt ?? null,
    acknowledged_by_user_id: seed.acknowledgedAt === undefined ? null : ctx.staff,
    resolved_at: seed.resolvedAt ?? null,
    resolved_by_user_id: seed.resolvedAt === undefined ? null : ctx.staff,
    updated_at: seed.resolvedAt ?? seed.acknowledgedAt ?? seed.detectedAt,
  };
  alertsTable(ctx.db).insert(row);
  if (seed.acknowledgedAt !== undefined) {
    ctx.audit.push({
      at: seed.acknowledgedAt,
      actor: ctx.staff,
      action: "admin.alert.status_changed",
      entityType: "admin_alert",
      entityId: row.id,
      metadata: { from: "open", to: "acknowledged", kind: row.kind },
    });
  }
  if (seed.resolvedAt !== undefined) {
    ctx.audit.push({
      at: seed.resolvedAt,
      actor: ctx.staff,
      action: "admin.alert.status_changed",
      entityType: "admin_alert",
      entityId: row.id,
      metadata: { from: seed.acknowledgedAt === undefined ? "open" : "acknowledged", to: "resolved", kind: row.kind },
    });
  }
}

export function seedAlerts(ctx: OpsSeedCtx): void {
  const { now, seed } = ctx;
  if (seed === "admin-ops-alerts-empty" || seed === "admin-ops-alerts-evaluable" || seed === "admin-ops-alerts-off") return;

  if (seed === "admin-ops-alerts-many") {
    const kinds: AdminAlertKind[] = ["unusual_cancellations", "schedule_price_changes", "route_incidents"];
    for (let index = 0; index < 30; index += 1) {
      const kind = kinds[index % 3] ?? "unusual_cancellations";
      const resolved = index >= 3;
      const detectedAt = now - (index + 1) * 5 * HOUR;
      insertAlertSeed(ctx, {
        key: `many-${index}`,
        kind,
        severity: kind === "route_incidents" ? "critical" : "warning",
        status: resolved ? "resolved" : "open",
        title: kind === "route_incidents" ? "Incidencias en ruta" : kind === "unusual_cancellations" ? "Cancelaciones inusuales" : "Cambio de horario o precio sin respuesta",
        body:
          kind === "route_incidents"
            ? `${1 + (index % 3)} incidencias abiertas en los últimos 60 minutos (umbral: 1).`
            : kind === "unusual_cancellations"
              ? `${5 + (index % 4)} reservas canceladas en los últimos 60 minutos (umbral: 5).`
              : `Una propuesta de cambio de horario lleva ${31 + index} minutos esperando aceptación (máximo: 30).`,
        data: kind === "unusual_cancellations" ? { count: 5 + (index % 4), windowMinutes: 60, thresholdCount: 5 } : { windowMinutes: 60 },
        detectedAt,
        ...(resolved ? { resolvedAt: detectedAt + 40 * MIN } : {}),
      });
    }
    return;
  }

  insertAlertSeed(ctx, {
    key: "incidents-open",
    kind: "route_incidents",
    severity: "critical",
    status: "open",
    title: "Incidencias en ruta",
    body: "2 incidencias abiertas en los últimos 60 minutos (umbral: 1).",
    data: { count: 2, safetyCount: 1, windowMinutes: 60, thresholdCount: 1 },
    detectedAt: now - 12 * MIN,
  });
  insertAlertSeed(ctx, {
    key: "cancel-open",
    kind: "unusual_cancellations",
    severity: "warning",
    status: "open",
    title: "Cancelaciones inusuales",
    body: "6 reservas canceladas en los últimos 60 minutos (umbral: 5).",
    data: { count: 6, windowMinutes: 60, thresholdCount: 5 },
    detectedAt: now - 29 * MIN,
  });
  insertAlertSeed(ctx, {
    key: "schedule-ack",
    kind: "schedule_price_changes",
    severity: "warning",
    status: "acknowledged",
    title: "Cambio de horario o precio sin respuesta",
    body: "Una propuesta de cambio de horario lleva 42 minutos esperando aceptación (máximo: 30).",
    data: {
      proposalId: stableUuid("ops:proposal:1"),
      tripId: SEED_TRIP_IDS.anaMorning,
      pendingMinutes: 42,
      maxPendingMinutes: 30,
      priceChange: false,
      scheduleChange: true,
    },
    detectedAt: now - 20 * HOUR,
    acknowledgedAt: now - 20 * HOUR + 11 * MIN,
  });
  insertAlertSeed(ctx, {
    key: "cancel-resolved",
    kind: "unusual_cancellations",
    severity: "warning",
    status: "resolved",
    title: "Cancelaciones inusuales",
    body: "5 reservas canceladas en los últimos 60 minutos (umbral: 5).",
    data: { count: 5, windowMinutes: 60, thresholdCount: 5 },
    detectedAt: now - 3 * DAY - 2 * HOUR,
    acknowledgedAt: now - 3 * DAY - 90 * MIN,
    resolvedAt: now - 3 * DAY - 40 * MIN,
  });
  insertAlertSeed(ctx, {
    key: "incidents-resolved",
    kind: "route_incidents",
    severity: "warning",
    status: "resolved",
    title: "Incidencias en ruta",
    body: "1 incidencias abiertas en los últimos 60 minutos (umbral: 1).",
    data: { count: 1, safetyCount: 0, windowMinutes: 60, thresholdCount: 1 },
    detectedAt: now - 6 * DAY,
    resolvedAt: now - 6 * DAY + 75 * MIN,
  });
}

/**
 * `admin-ops-alerts-evaluable`: deja cancelaciones REALES recientes (reservas de la oferta sembrada pasadas a «cancelada»
 * hace pocos minutos) para que «Evaluar ahora» cree una alerta a partir de eventos, sin inventar nada.
 */
export function seedEvaluableCancellations(ctx: OpsSeedCtx): void {
  const { db, now } = ctx;
  const bookings = db.bookings.all().filter((booking) => booking.status === "confirmed" || booking.status === "completed");
  bookings.slice(0, 6).forEach((booking, index) => {
    db.bookings.update(booking.id, { status: index % 2 === 0 ? "cancelled" : "driver_cancelled", updated_at: now - (4 + index * 3) * MIN });
  });
}

// ── Auditoría de fondo ──────────────────────────────────────────────────────────────────────────────────────────────

/** Actividad habitual del panel y de las personas usuarias, con datos personales que el visor debe ocultar. */
export function seedAuditBackground(ctx: OpsSeedCtx): void {
  const { now, staff } = ctx;
  const { ana, miguel } = SEED_USER_IDS;
  const push = (at: number, actor: string | null, action: string, entityType: string, entityId: string | null, metadata: Record<string, unknown>): void => {
    ctx.audit.push({ at, actor, action, entityType, entityId, requestId: `req-seed-${ctx.audit.length.toString(36)}`, metadata });
  };
  push(now - 35 * MIN, staff, "admin.alerts.evaluated", "operations", null, {
    via: "api",
    created: 0,
    autoResolved: 0,
    byKind: { unusual_cancellations: 0, schedule_price_changes: 0, route_incidents: 0 },
  });
  push(now - 50 * MIN, staff, "admin.alerts.listed", "alerts", null, { status: "open", kind: null, returned: 2 });
  push(now - 3 * HOUR, staff, "admin.audit_log.viewed", "audit_log", null, {
    filters: { actorUserId: null, action: "admin.*", entityType: null, entityId: null, from: null, to: null },
    returned: 20,
  });
  push(now - 7 * HOUR, ana, "profile.photo.submitted", "profile_photo", stableUuid("ops:photo:ana"), {
    storageKey: "private/photos/ana-garcia-0f3a.jpg",
    contentType: "image/jpeg",
    phone: "+34611000101",
  });
  push(now - 9 * HOUR, miguel, "trips.request.created", "ride_request", stableUuid("ops:request:miguel"), {
    tripId: SEED_TRIP_IDS.anaMorning,
    seats: 1,
    message: "Hola, te escribo desde el 611 223 344 o miguel.torres@example.com",
  });
  push(now - 11 * HOUR, ana, "admin.access_denied", "admin_resource", "admin_panel", {
    resource: "admin_panel",
    needed: "read",
    method: "GET",
    route: "/v1/admin/me",
    roles: ["driver", "passenger"],
    ip: "81.45.12.200",
  });
  push(now - 1 * DAY, staff, "admin.tariffs.viewed", "tariff", null, { hasDraft: true, hasActive: false, activationMode: "disabled" });
  push(now - 1 * DAY - 40 * MIN, staff, "admin.operations.viewed", "operations", null, {});
  push(now - 2 * DAY - 2 * HOUR, staff, "admin.tariff_example.calculated", "tariff", null, {
    distanceMeters: 18000,
    ratePerKmMicros: 300000,
    passengerCommissionBps: null,
    driverCommissionBps: null,
  });
  push(now - 4 * DAY, ana, "auth.session.created", "session", stableUuid("ops:session:ana"), { phone: "+34611000101", ip: "88.12.34.56", userAgent: "MVC/1.0 iOS" });
  push(now - 5 * DAY - 3 * HOUR, staff, "admin.bookings.listed", "booking", null, { status: "all", returned: 12 });
  push(now - 6 * DAY, staff, "admin.summary.viewed", "summary", null, { period: "last_7_days" });
  push(now - 8 * DAY, staff, "admin.me.viewed", "admin_user", staff, { roles: ["admin", "verification_admin", "finance_admin", "support_admin"] });
}

// ── Roles de personal por variante ──────────────────────────────────────────────────────────────────────────────────

const ROLE_VARIANTS: Readonly<Record<string, "support_admin" | "finance_admin" | "verification_admin">> = {
  "admin-ops-support-only": "support_admin",
  "admin-ops-finance-only": "finance_admin",
  "admin-ops-verification-only": "verification_admin",
};

/** Deja a la persona de administración con UN solo rol de personal (los permisos se leen en cada petición). */
export function applyRoleVariant(ctx: OpsSeedCtx): void {
  const keep = ROLE_VARIANTS[ctx.seed];
  if (keep === undefined) return;
  for (const role of ["admin", "verification_admin", "finance_admin", "support_admin"] as const) {
    if (role !== keep) ctx.db.userRoles.delete(`${ctx.staff}:${role}`);
  }
}
