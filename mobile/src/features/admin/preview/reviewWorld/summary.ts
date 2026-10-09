/**
 * «Resumen de administración» del backend en memoria (SIMULACIÓN): `GET /v1/admin/summary` y
 * `GET /v1/admin/summary/vehicle-activity` (trust · A F S). Espejo de `src/modules/trust/summary.ts`:
 *
 *  - viajes activos = viajes publicados, en curso o completados con salida en el periodo; solicitudes = solicitudes de
 *    plaza creadas en el periodo; incidencias = reportes del módulo `live` (si no existe esa tabla: «no disponible», nunca
 *    un 0 inventado); «ahora en ruta» = viajes en curso;
 *  - cada cifra trae la comparación con el periodo anterior de la misma duración (entero redondeado);
 *  - las finanzas solo las ven `finance_admin` y `admin`; sin tarifa aprobada todo importe es «Por definir». El servidor
 *    real NUNCA emite importes `illustrative`: los de este fichero salen de la ficha sembrada de la vista previa;
 *  - la actividad de vehículos es una instantánea APROXIMADA (celdas de ~2 km, posiciones de hace menos de 10 min), sin
 *    identidades ni posiciones precisas.
 *
 * La vista previa no tiene decenas de viajes: si el mundo trae una ficha `admin_summary_seed`, sus cifras sustituyen a las
 * derivadas (así las láminas, con 42 viajes y 18 solicitudes, se ven como el diseño). Sin ficha, todo se deriva del mundo.
 */
import type {
  AdminCountKpi,
  AdminFinanceKpis,
  AdminMoneyKpi,
  AdminPeriod,
  AdminProvinceRef,
  AdminSummary,
  AdminTrend,
  AdminVehicleActivity,
  AdminVehicleCluster,
  Money,
} from "@/api/types";
import { fail, snapToGrid, writeAudit, type PreviewDb, type Principal } from "@/preview";
import { iso } from "./common";
import { periodWindow } from "./periods";
import { permissionFor } from "./rbac";
import { hasCollection, reviewTables, type KpiSeed, type PeriodSeed } from "./store";

const GRID_DEGREES = 0.02;
const FRESHNESS_SECONDS = 600;
const PRECISION_METERS = 2200;
const VEHICLE_ACTIVITY_LABEL = "Actividad de vehículos (aproximada)" as const;

const DEFINITIONS = {
  activeTrips: "Viajes publicados, en curso o completados con salida en el periodo.",
  requests: "Solicitudes de plaza creadas en el periodo.",
  incidents: "Reportes de incidencia del periodo (módulo live).",
} as const;

// ── Comparación entre periodos ────────────────────────────────────────────────────────────────────────────────────

/** `previous = 0` no tiene porcentaje: «nuevo» si ahora hay algo, «sin cambios» si no. */
export function compare(value: number, previous: number): { deltaPercent: number | null; trend: AdminTrend } {
  if (previous === 0) return { deltaPercent: null, trend: value === 0 ? "flat" : "new" };
  const delta = Math.round(((value - previous) / previous) * 100);
  return { deltaPercent: delta, trend: delta > 0 ? "up" : delta < 0 ? "down" : "flat" };
}

function countKpi(value: number, previous: number, definition: string, forcedDelta: number | null = null): AdminCountKpi {
  const derived = compare(value, previous);
  const deltaPercent = forcedDelta ?? derived.deltaPercent;
  const trend: AdminTrend = forcedDelta === null ? derived.trend : forcedDelta > 0 ? "up" : forcedDelta < 0 ? "down" : "flat";
  return { value, previous, deltaPercent, trend, available: true, definition };
}

function seededKpi(seed: KpiSeed, definition: string): AdminCountKpi {
  return countKpi(seed.value, seed.previous, definition, seed.delta_percent);
}

function unavailableKpi(definition: string): AdminCountKpi {
  return { value: null, previous: null, deltaPercent: null, trend: "unavailable", available: false, definition };
}

// ── Cifras derivadas del mundo ────────────────────────────────────────────────────────────────────────────────────

function provinceRefOf(db: PreviewDb, provinceId: string | undefined): AdminProvinceRef | null {
  if (provinceId === undefined) return null;
  const province = db.provinces.get(provinceId);
  if (province === undefined) return fail("PROVINCE_NOT_FOUND", "No existe esa provincia.", 404);
  return { id: province.id, code: province.code, name: province.name };
}

function tripsIn(db: PreviewDb, from: number, to: number, provinceId: string | undefined): number {
  return db.trips.count(
    (trip) =>
      (trip.status === "published" || trip.status === "active" || trip.status === "completed") &&
      trip.departure_at !== null &&
      trip.departure_at >= from &&
      trip.departure_at <= to &&
      (provinceId === undefined || trip.province_id === provinceId),
  );
}

function requestsIn(db: PreviewDb, from: number, to: number, provinceId: string | undefined): number {
  return db.rideRequests.count(
    (request) =>
      request.requested_at >= from &&
      request.requested_at <= to &&
      (provinceId === undefined || db.trips.get(request.trip_id)?.province_id === provinceId),
  );
}

function incidentsIn(db: PreviewDb, from: number, to: number, provinceId: string | undefined): number | null {
  if (!hasCollection(db, "live_incident_reports")) return null;
  const reports = db.collection<{ trip_id: string; created_at: number }>("live_incident_reports");
  return reports.count(
    (report) =>
      report.created_at >= from &&
      report.created_at <= to &&
      (provinceId === undefined || db.trips.get(report.trip_id)?.province_id === provinceId),
  );
}

function tripsInProgress(db: PreviewDb, provinceId: string | undefined): number {
  return db.trips.count((trip) => trip.status === "active" && (provinceId === undefined || trip.province_id === provinceId));
}

const PENDING: Money = { cents: null, currency: "EUR", status: "pending_definition" };

function pendingMoneyKpi(note: string | null): AdminMoneyKpi {
  return { amount: PENDING, source: "none", note };
}

function derivedFinance(): AdminFinanceKpis {
  return {
    grossRevenue: pendingMoneyKpi("Economía no activada: sin tarifa aprobada no hay ingresos que calcular."),
    operatingCosts: pendingMoneyKpi("No existe fuente de costes operativos."),
    result: pendingMoneyKpi(null),
    economicsActivated: false,
  };
}

function seededFinance(seed: NonNullable<PeriodSeed["finance"]>): AdminFinanceKpis {
  const illustrative = (cents: number): AdminMoneyKpi => ({
    amount: { cents, currency: "EUR", status: "illustrative" },
    source: "none",
    note: "Importe de ejemplo de la vista previa: el servidor real no lo emite.",
  });
  return {
    grossRevenue: illustrative(seed.gross_cents),
    operatingCosts: illustrative(seed.costs_cents),
    result: illustrative(seed.result_cents),
    economicsActivated: false,
  };
}

/** `GET /v1/admin/summary`. */
export function buildSummary(
  db: PreviewDb,
  principal: Principal,
  query: { provinceId?: string; period: AdminPeriod },
  requestId: string,
): AdminSummary {
  const province = provinceRefOf(db, query.provinceId);
  const now = db.nowMs();
  const window = periodWindow(now, query.period);
  const seed = reviewTables(db).summarySeed.get("summary")?.periods[query.period];
  const canSeeFinance = permissionFor(principal.roles, "finance_kpis") !== "none";

  let activeTrips: AdminCountKpi;
  let requests: AdminCountKpi;
  let incidents: AdminCountKpi;
  let live: number;
  let finance: AdminFinanceKpis | null = null;

  if (seed !== undefined) {
    activeTrips = seededKpi(seed.trips, DEFINITIONS.activeTrips);
    requests = seededKpi(seed.requests, DEFINITIONS.requests);
    incidents = seed.incidents === null ? unavailableKpi(DEFINITIONS.incidents) : seededKpi(seed.incidents, DEFINITIONS.incidents);
    live = seed.live_now;
    if (canSeeFinance) finance = seed.finance === null ? derivedFinance() : seededFinance(seed.finance);
  } else {
    activeTrips = countKpi(
      tripsIn(db, window.from, window.to, query.provinceId),
      tripsIn(db, window.previousFrom, window.previousTo, query.provinceId),
      DEFINITIONS.activeTrips,
    );
    requests = countKpi(
      requestsIn(db, window.from, window.to, query.provinceId),
      requestsIn(db, window.previousFrom, window.previousTo, query.provinceId),
      DEFINITIONS.requests,
    );
    const current = incidentsIn(db, window.from, window.to, query.provinceId);
    const previous = incidentsIn(db, window.previousFrom, window.previousTo, query.provinceId);
    incidents = current === null || previous === null ? unavailableKpi(DEFINITIONS.incidents) : countKpi(current, previous, DEFINITIONS.incidents);
    live = tripsInProgress(db, query.provinceId);
    if (canSeeFinance) finance = derivedFinance();
  }

  writeAudit(db, {
    actorUserId: principal.userId,
    action: "admin.summary.viewed",
    entityType: "admin_summary",
    entityId: query.provinceId ?? null,
    requestId,
    metadata: { period: query.period, provinceId: query.provinceId ?? null },
  });

  return {
    generatedAt: iso(now),
    window: {
      period: query.period,
      timeZone: "Europe/Madrid",
      from: iso(window.from),
      to: iso(window.to),
      previousFrom: iso(window.previousFrom),
      previousTo: iso(window.previousTo),
    },
    province,
    kpis: { activeTrips, requests, incidents },
    liveNow: { tripsInProgress: live },
    finance,
    notes: [],
  };
}

// ── Actividad de vehículos ────────────────────────────────────────────────────────────────────────────────────────

function cellId(lat: number, lng: number): string {
  return `${lat.toFixed(2)}:${lng.toFixed(2)}`;
}

function clusterOf(id: string, count: number, lat: number, lng: number): AdminVehicleCluster {
  return { id, kind: count > 1 ? "cluster" : "vehicle", count, lat, lng, precisionMeters: PRECISION_METERS };
}

/** `GET /v1/admin/summary/vehicle-activity`. */
export function buildVehicleActivity(db: PreviewDb, principal: Principal, query: { provinceId?: string }, requestId: string): AdminVehicleActivity {
  const province = provinceRefOf(db, query.provinceId);
  const now = db.nowMs();
  const seeded = reviewTables(db).summarySeed.get("summary")?.vehicles;

  let items: AdminVehicleCluster[];
  if (seeded !== undefined && seeded.length > 0) {
    items = seeded.map((cell) => clusterOf(cell.id, cell.count, cell.lat, cell.lng));
  } else {
    const cells = new Map<string, AdminVehicleCluster>();
    for (const fix of db.liveState.all()) {
      const trip = db.trips.get(fix.trip_id);
      if (trip === undefined || trip.status !== "active") continue;
      if (query.provinceId !== undefined && trip.province_id !== query.provinceId) continue;
      if (now - fix.recorded_at > FRESHNESS_SECONDS * 1000) continue;
      const lat = snapToGrid(fix.lat, GRID_DEGREES);
      const lng = snapToGrid(fix.lng, GRID_DEGREES);
      const id = cellId(lat, lng);
      const existing = cells.get(id);
      cells.set(id, clusterOf(id, (existing?.count ?? 0) + 1, lat, lng));
    }
    items = [...cells.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  writeAudit(db, {
    actorUserId: principal.userId,
    action: "admin.vehicle_activity.viewed",
    entityType: "admin_summary",
    entityId: query.provinceId ?? null,
    requestId,
    metadata: { provinceId: query.provinceId ?? null },
  });

  return {
    generatedAt: iso(now),
    province,
    label: VEHICLE_ACTIVITY_LABEL,
    precision: "approximate",
    gridDegrees: GRID_DEGREES,
    freshnessSeconds: FRESHNESS_SECONDS,
    totalVehicles: items.reduce((sum, item) => sum + item.count, 0),
    items,
  };
}
