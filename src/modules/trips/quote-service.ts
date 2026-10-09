import { buildBreakdown, contributionForRoadDistance, roundHalfUp } from "../../domain/money.js";
import { moneyDefined, moneyPending, type MoneyDto } from "../../lib/dto.js";
import type { Db } from "./common.js";
import type { TripQuote, Weekday } from "./types.js";

/**
 * Servicio de presupuesto. REGLA: solo se usa una fila `tariff_versions` con `status='approved'` y `effective_from`
 * ya alcanzada. Este módulo NUNCA crea, aprueba ni activa una tarifa. Sin tarifa aprobada todo importe es
 * `pending_definition` («Por definir»). Dinero siempre en céntimos enteros.
 *
 * Supuestos a confirmar por negocio (docs/contracts/trips.md §16): el tope `shared_cost_cap_cents` se aplica por
 * trayecto y pasajero; la comisión de pasajero (`passenger_commission_bps`) se calcula sobre la aportación.
 */
export type ApprovedTariff = {
  id: string;
  version: number;
  rateMicrosPerKm: number | null;
  passengerCommissionBps: number | null;
  driverCommissionBps: number | null;
  sharedCostCapCents: number | null;
};

export async function loadApprovedTariff(db: Db): Promise<ApprovedTariff | null> {
  const result = await db.query<{
    id: string;
    version: number;
    rate_micros_per_km: number | null;
    passenger_commission_bps: number | null;
    driver_commission_bps: number | null;
    shared_cost_cap_cents: number | null;
  }>(
    `select id, version, rate_micros_per_km, passenger_commission_bps, driver_commission_bps, shared_cost_cap_cents
       from tariff_versions
      where status = 'approved' and effective_from is not null and effective_from <= now()
      order by version desc
      limit 1`
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    version: row.version,
    rateMicrosPerKm: row.rate_micros_per_km,
    passengerCommissionBps: row.passenger_commission_bps,
    driverCommissionBps: row.driver_commission_bps,
    sharedCostCapCents: row.shared_cost_cap_cents
  };
}

type LegAmounts = {
  contribution: number | null;
  fee: number | null;
  total: number | null;
  driverCommission: number | null;
};

/** Importes de UN trayecto; null en cada componente que la tarifa aprobada no define. */
function legAmounts(tariff: ApprovedTariff, roadDistanceM: number): LegAmounts {
  if (tariff.rateMicrosPerKm === null) return { contribution: null, fee: null, total: null, driverCommission: null };
  let contribution = contributionForRoadDistance(Math.max(0, Math.round(roadDistanceM)), tariff.rateMicrosPerKm);
  if (tariff.sharedCostCapCents !== null) contribution = Math.min(contribution, tariff.sharedCostCapCents);
  const fee = tariff.passengerCommissionBps === null
    ? null
    : Number(roundHalfUp(BigInt(contribution) * BigInt(tariff.passengerCommissionBps), 10_000n));
  const driverCommission = tariff.driverCommissionBps === null
    ? null
    : Number(roundHalfUp(BigInt(contribution) * BigInt(tariff.driverCommissionBps), 10_000n));
  return { contribution, fee, total: fee === null ? null : contribution + fee, driverCommission };
}

const asMoney = (cents: number | null): MoneyDto => (cents === null ? moneyPending() : moneyDefined(cents));

function pendingQuote(roadDistanceM: number, tariff: ApprovedTariff | null): TripQuote {
  return {
    state: "pending_definition",
    tariff: tariff
      ? { state: "approved", version: tariff.version }
      : { state: "none_approved", version: null },
    basis: { roadDistanceM, rateMicrosPerKm: tariff?.rateMicrosPerKm ?? null },
    contribution: moneyPending(),
    managementFee: moneyPending(),
    total: moneyPending(),
    weekly: null,
    lockedAt: null
  };
}

/** Presupuesto de un trayecto. */
export function computeQuote(tariff: ApprovedTariff | null, roadDistanceM: number): TripQuote {
  const base = pendingQuote(roadDistanceM, tariff);
  if (!tariff) return base;
  const amounts = legAmounts(tariff, roadDistanceM);
  const contribution = asMoney(amounts.contribution);
  const managementFee = asMoney(amounts.fee);
  const total = asMoney(amounts.total);
  const allDefined = amounts.contribution !== null && amounts.fee !== null && amounts.total !== null;
  return {
    ...base,
    state: allDefined ? "defined" : "pending_definition",
    contribution,
    managementFee,
    total
  };
}

/**
 * Presupuesto semanal: importes por semana = suma de los trayectos de una semana (ida × días + vuelta × días).
 * `distances.return` null → solo ida.
 */
export function computeWeeklyQuote(
  tariff: ApprovedTariff | null,
  distances: { outboundM: number; returnM: number | null },
  weekdays: readonly Weekday[]
): TripQuote {
  const quote = computeQuote(tariff, distances.outboundM);
  const legsPerDay: 1 | 2 = distances.returnM === null ? 1 : 2;
  const tripsPerWeek = weekdays.length * legsPerDay;
  let contributionPerWeek: MoneyDto = moneyPending();
  let totalPerWeek: MoneyDto = moneyPending();
  if (tariff) {
    const out = legAmounts(tariff, distances.outboundM);
    const back = distances.returnM === null ? null : legAmounts(tariff, distances.returnM);
    const days = weekdays.length;
    if (out.contribution !== null && (back === null || back.contribution !== null)) {
      contributionPerWeek = moneyDefined(days * (out.contribution + (back?.contribution ?? 0)));
    }
    if (out.total !== null && (back === null || back.total !== null)) {
      totalPerWeek = moneyDefined(days * (out.total + (back?.total ?? 0)));
    }
  }
  return {
    ...quote,
    weekly: { weekdays: [...weekdays], legsPerDay, tripsPerWeek, contributionPerWeek, totalPerWeek }
  };
}

/**
 * Fija el importe a la solicitud (`quote_snapshots`). Solo existe instantánea cuando hay tarifa aprobada con TODOS
 * los componentes definidos; en otro caso no se escribe nada y devuelve null.
 */
export async function lockQuoteForRequest(
  db: Db,
  input: { requestId: string; tariff: ApprovedTariff | null; roadDistanceM: number }
): Promise<Date | null> {
  const { tariff } = input;
  if (!tariff) return null;
  const amounts = legAmounts(tariff, input.roadDistanceM);
  if (amounts.contribution === null || amounts.fee === null) return null;
  const breakdown = buildBreakdown({
    contributionCents: amounts.contribution,
    passengerCommissionCents: amounts.fee,
    driverCommissionCents: amounts.driverCommission ?? 0
  });
  const existing = await db.query<{ created_at: Date }>(
    `select created_at from quote_snapshots where request_id = $1 and tariff_version_id = $2 order by created_at desc limit 1`,
    [input.requestId, tariff.id]
  );
  if (existing.rows[0]) return existing.rows[0].created_at;
  const inserted = await db.query<{ created_at: Date }>(
    `insert into quote_snapshots(
       request_id, tariff_version_id, road_distance_m, contribution_cents, passenger_commission_cents,
       driver_commission_cents, processing_cents, taxes_cents, passenger_total_cents, driver_net_cents
     ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     returning created_at`,
    [
      input.requestId, tariff.id, Math.round(input.roadDistanceM), breakdown.contributionCents,
      breakdown.passengerCommissionCents, breakdown.driverCommissionCents, breakdown.processingCents,
      breakdown.taxesCents, breakdown.passengerTotalCents, breakdown.driverNetCents
    ]
  );
  return inserted.rows[0]?.created_at ?? null;
}

/**
 * Presupuesto de una solicitud: la instantánea fijada si existe (`lockedAt` informado) o el cálculo en vivo.
 * Es el punto de entrada para el módulo `money`.
 */
export async function quoteForRequest(db: Db, requestId: string): Promise<TripQuote | null> {
  const request = await db.query<{ road_distance_m: number | null }>(
    `select coalesce(
              r.road_distance_m,
              (select sum(s.distance_m)::int from trip_segments s
                where s.trip_id = r.trip_id and s.seq >= r.from_segment_seq and s.seq < r.to_segment_seq),
              0) as road_distance_m
       from ride_requests r where r.id = $1`,
    [requestId]
  );
  if (!request.rows[0]) return null;
  const roadDistanceM = request.rows[0].road_distance_m ?? 0;
  const snapshot = await db.query<{
    created_at: Date;
    version: number;
    rate_micros_per_km: number | null;
    contribution_cents: number;
    passenger_commission_cents: number;
    passenger_total_cents: number;
    road_distance_m: number;
  }>(
    `select q.created_at, tv.version, tv.rate_micros_per_km, q.contribution_cents, q.passenger_commission_cents,
            q.passenger_total_cents, q.road_distance_m
       from quote_snapshots q join tariff_versions tv on tv.id = q.tariff_version_id
      where q.request_id = $1
      order by q.created_at desc limit 1`,
    [requestId]
  );
  const locked = snapshot.rows[0];
  if (locked) {
    return {
      state: "defined",
      tariff: { state: "approved", version: locked.version },
      basis: { roadDistanceM: locked.road_distance_m, rateMicrosPerKm: locked.rate_micros_per_km },
      contribution: moneyDefined(locked.contribution_cents),
      managementFee: moneyDefined(locked.passenger_commission_cents),
      total: moneyDefined(locked.passenger_total_cents),
      weekly: null,
      lockedAt: locked.created_at.toISOString()
    };
  }
  return computeQuote(await loadApprovedTariff(db), roadDistanceM);
}
