import type { AuthPrincipal } from "../../auth/session.js";
import { moneyDefined, moneyPending } from "../../lib/dto.js";
import { UUID_RE, trustError } from "./common.js";
import type { Db, TrustContext } from "./context.js";
import { compare, resolveWindow, windowDto, type KpiTrend, type Period } from "./period.js";
import { permissionFor, permits } from "./rbac.js";

export type ProvinceRef = { id: string; code: string; name: string };

export async function loadProvince(db: Db, provinceId: string | undefined): Promise<ProvinceRef | null> {
  if (provinceId === undefined) return null;
  const found = UUID_RE.test(provinceId)
    ? await db.query<ProvinceRef>(`select id, code, name from provinces where id = $1`, [provinceId])
    : { rows: [] as ProvinceRef[] };
  const row = found.rows[0];
  if (!row) throw trustError("PROVINCE_NOT_FOUND", "No existe esa provincia.", 404);
  return row;
}

/** ¿Existe la tabla (módulo de otro agente)? Lectura defensiva: nunca se asume que está migrada. */
export async function tableExists(db: Db, name: string): Promise<boolean> {
  const found = await db.query<{ ok: boolean }>(`select to_regclass($1) is not null as ok`, [`public.${name}`]);
  return Boolean(found.rows[0]?.ok);
}

type Counts = { cur: number; prev: number };

async function countPair(db: Db, sql: string, params: unknown[]): Promise<Counts> {
  const result = await db.query<{ cur: string; prev: string }>(sql, params);
  return { cur: Number(result.rows[0]?.cur ?? 0), prev: Number(result.rows[0]?.prev ?? 0) };
}

function countKpi(counts: Counts | null, definition: string) {
  if (!counts) {
    return { value: null, previous: null, deltaPercent: null, trend: "unavailable" as KpiTrend, available: false, definition };
  }
  const { deltaPercent, trend } = compare(counts.cur, counts.prev);
  return { value: counts.cur, previous: counts.prev, deltaPercent, trend, available: true, definition };
}

const FINANCE_NOT_ACTIVATED_NOTE = "Economía no activada: sin tarifa aprobada no hay ingresos que calcular.";

export async function getAdminSummary(
  ctx: TrustContext,
  principal: AuthPrincipal,
  input: { provinceId?: string | undefined; period: Period }
) {
  const province = await loadProvince(ctx.pool, input.provinceId);
  const now = ctx.now();
  const window = resolveWindow(input.period, now);
  const p = [window.from, window.to, window.previousFrom, window.previousTo, province?.id ?? null] as const;

  const trips = await countPair(
    ctx.pool,
    `select count(*) filter (where t.departure_at >= $1 and t.departure_at < $2)::text as cur,
            count(*) filter (where t.departure_at >= $3 and t.departure_at < $4)::text as prev
       from trips t
      where t.status in ('published','active','completed') and ($5::uuid is null or t.province_id = $5::uuid)
        and t.departure_at >= least($1::timestamptz, $3::timestamptz) and t.departure_at < greatest($2::timestamptz, $4::timestamptz)`,
    [...p]
  );
  const requests = await countPair(
    ctx.pool,
    `select count(*) filter (where rr.requested_at >= $1 and rr.requested_at < $2)::text as cur,
            count(*) filter (where rr.requested_at >= $3 and rr.requested_at < $4)::text as prev
       from ride_requests rr
       join trips t on t.id = rr.trip_id
      where ($5::uuid is null or t.province_id = $5::uuid)
        and rr.requested_at >= least($1::timestamptz, $3::timestamptz) and rr.requested_at < greatest($2::timestamptz, $4::timestamptz)`,
    [...p]
  );

  // Incidencias: fuente = incident_reports (módulo live). Sin tabla no se inventa un 0.
  let incidents: Counts | null = null;
  const notes: string[] = [];
  if (await tableExists(ctx.pool, "incident_reports")) {
    try {
      incidents = await countPair(
        ctx.pool,
        `select count(*) filter (where i.created_at >= $1 and i.created_at < $2)::text as cur,
                count(*) filter (where i.created_at >= $3 and i.created_at < $4)::text as prev
           from incident_reports i
           join trips t on t.id = i.trip_id
          where ($5::uuid is null or t.province_id = $5::uuid)
            and i.created_at >= least($1::timestamptz, $3::timestamptz) and i.created_at < greatest($2::timestamptz, $4::timestamptz)`,
        [...p]
      );
    } catch {
      incidents = null;
      notes.push("Incidencias: la fuente del módulo live no se pudo leer.");
    }
  }
  if (!incidents && notes.length === 0) notes.push("Incidencias: la fuente (módulo live) aún no está disponible.");

  const live = await ctx.pool.query<{ n: string }>(
    `select count(*)::text as n from trips t where t.status = 'active' and ($1::uuid is null or t.province_id = $1::uuid)`,
    [province?.id ?? null]
  );

  const canSeeFinance = permits(permissionFor(principal.roles, "finance_kpis"), "read");
  const finance = canSeeFinance ? await financeKpis(ctx, window.from, window.to, province?.id ?? null) : null;

  return {
    generatedAt: now.toISOString(),
    window: windowDto(window),
    province,
    kpis: {
      activeTrips: countKpi(trips, "Viajes publicados, en curso o completados con salida en el periodo."),
      requests: countKpi(requests, "Solicitudes de plaza creadas en el periodo."),
      incidents: countKpi(incidents, "Reportes de incidencia del periodo (módulo live).")
    },
    liveNow: { tripsInProgress: Number(live.rows[0]?.n ?? 0) },
    finance,
    notes
  };
}

async function financeKpis(ctx: TrustContext, from: Date, to: Date, provinceId: string | null) {
  const active = await ctx.pool.query<{ ok: boolean }>(
    `select exists(select 1 from tariff_versions where status = 'approved' and effective_from is not null and effective_from <= now()) as ok`
  );
  const economicsActivated = Boolean(active.rows[0]?.ok);
  let gross;
  if (economicsActivated) {
    const sum = await ctx.pool.query<{ cents: string }>(
      `select coalesce(sum(qs.passenger_commission_cents + qs.driver_commission_cents), 0)::text as cents
         from bookings b
         join ride_requests rr on rr.id = b.request_id
         join trips t on t.id = rr.trip_id
         join lateral (
           select passenger_commission_cents, driver_commission_cents, tariff_version_id
             from quote_snapshots where request_id = rr.id order by created_at desc limit 1) qs on qs.tariff_version_id is not null
        where b.status in ('confirmed','completed') and b.created_at >= $1 and b.created_at < $2
          and ($3::uuid is null or t.province_id = $3::uuid)`,
      [from, to, provinceId]
    );
    gross = { amount: moneyDefined(Number(sum.rows[0]?.cents ?? 0)), source: "commissions_of_confirmed_bookings" as const, note: null };
  } else {
    gross = { amount: moneyPending(), source: "none" as const, note: FINANCE_NOT_ACTIVATED_NOTE };
  }
  return {
    grossRevenue: gross,
    operatingCosts: { amount: moneyPending(), source: "none" as const, note: "No existe fuente de costes operativos." },
    result: { amount: moneyPending(), source: "none" as const, note: null },
    economicsActivated
  };
}

/* ───────────── Actividad de vehículos (aproximada) ───────────── */

export const GRID_DEGREES = 0.02;
export const CELL_PRECISION_METERS = 2200;

export async function getVehicleActivity(ctx: TrustContext, input: { provinceId?: string | undefined }) {
  const province = await loadProvince(ctx.pool, input.provinceId);
  const now = ctx.now();
  const freshness = ctx.config.vehicleActivityFreshnessSeconds;
  const since = new Date(now.getTime() - freshness * 1000);
  const rows = await ctx.pool.query<{ cx: number; cy: number; n: number }>(
    `select floor(ST_X(s.geom) / $3::float8)::int as cx, floor(ST_Y(s.geom) / $3::float8)::int as cy, count(*)::int as n
       from trip_live_state s
       join trips t on t.id = s.trip_id
      where t.status = 'active' and s.received_at >= $1 and ($2::uuid is null or t.province_id = $2::uuid)
      group by 1, 2
      order by n desc, cy, cx`,
    [since, province?.id ?? null, GRID_DEGREES]
  );
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  const items = rows.rows.map(r => ({
    id: `${(r.cy * GRID_DEGREES).toFixed(2)}:${(r.cx * GRID_DEGREES).toFixed(2)}`,
    kind: r.n === 1 ? ("vehicle" as const) : ("cluster" as const),
    count: r.n,
    lat: round((r.cy + 0.5) * GRID_DEGREES),
    lng: round((r.cx + 0.5) * GRID_DEGREES),
    precisionMeters: CELL_PRECISION_METERS
  }));
  return {
    generatedAt: now.toISOString(),
    province,
    label: "Actividad de vehículos (aproximada)" as const,
    precision: "approximate" as const,
    gridDegrees: GRID_DEGREES,
    freshnessSeconds: freshness,
    totalVehicles: items.reduce((sum, i) => sum + i.count, 0),
    items
  };
}
