import type { Pool } from "pg";
import type { AuthPrincipal } from "../../../auth/session.js";
import { moneyPending, type MoneyDto, type PublicUserDto } from "../../../lib/dto.js";
import type { Queryable } from "../lib/db.js";
import { clampLimit, currentMadridMonth, decodeCursor, encodeCursor, monthToFirstDay, num, toIsoRequired } from "../lib/db.js";
import { centsToMoney, loadPublicUsers, STOP_LABEL_JOINS, tripRef, userFrom } from "../lib/people.js";
import type { PaymentProvider } from "../provider/types.js";
import { describeAvailability } from "../payments/availability.js";
import { loadDefaultMethod } from "../payments/methods-service.js";
import type { MoneyTripRefDto, Page, PaymentMethodDto, PaymentsAvailabilityDto } from "../types.js";
import { earningItem, queryEarnings, type DriverEarningItemDto } from "./earnings-service.js";

/* ───────────────────────── Tipos de cable ───────────────────────── */

export type PassengerPaymentState = "pending" | "under_review" | "paid" | "partially_refunded" | "refunded" | "failed" | "expired";
export const PASSENGER_PAYMENT_STATES: readonly PassengerPaymentState[] = [
  "pending",
  "under_review",
  "paid",
  "partially_refunded",
  "refunded",
  "failed",
  "expired"
];

export interface PassengerPaymentItemDto {
  key: string;
  kind: "payment" | "pending_request";
  requestId: string;
  bookingId: string | null;
  paymentId: string | null;
  driver: PublicUserDto;
  trip: MoneyTripRefDto;
  amount: MoneyDto;
  state: PassengerPaymentState;
  occurredAt: string;
}

export interface CommissionInfoDto {
  status: "pending_definition" | "defined";
  passengerRateBps: number | null;
  driverRateBps: number | null;
}

export interface PassengerPaymentsSummaryDto {
  month: string;
  availability: PaymentsAvailabilityDto;
  pendingThisMonth: MoneyDto;
  upcomingTripsCount: number;
  recent: PassengerPaymentItemDto[];
  paymentMethod: PaymentMethodDto | null;
  platformCommission: CommissionInfoDto;
}

export interface NextPayoutDto {
  status: "pending_definition" | "scheduled" | "processing";
  date: string | null;
  amount: MoneyDto;
}

export interface DriverPaymentsSummaryDto {
  month: string;
  availability: PaymentsAvailabilityDto;
  toCollectThisMonth: MoneyDto;
  completedTripsCount: number;
  nextPayout: NextPayoutDto;
  recent: DriverEarningItemDto[];
  payoutAccount: PaymentMethodDto | null;
  platformCommission: CommissionInfoDto;
}

/* ───────────────────────── Comisión de la plataforma (solo si hay tarifa aprobada) ───────────────────────── */

export async function loadCommissionInfo(db: Queryable): Promise<CommissionInfoDto> {
  const result = await db.query<{ passenger_commission_bps: number | null; driver_commission_bps: number | null }>(
    `select passenger_commission_bps, driver_commission_bps
       from tariff_versions where status::text='approved' order by version desc limit 1`
  );
  const row = result.rows[0];
  if (!row || row.passenger_commission_bps === null || row.driver_commission_bps === null) {
    return { status: "pending_definition", passengerRateBps: null, driverRateBps: null };
  }
  return { status: "defined", passengerRateBps: row.passenger_commission_bps, driverRateBps: row.driver_commission_bps };
}

/* ───────────────────────── Pasajero ───────────────────────── */

/** Importe de la última cotización congelada de la solicitud `r`, solo si es DEFINIDO (misma regla que `loadQuote`). */
const REQUEST_QUOTE_LATERAL = `
  left join lateral (
    select case when tv.status::text <> 'draft'
                   and qs.passenger_total_cents > 0
                   and qs.contribution_cents + qs.passenger_commission_cents + qs.processing_cents + qs.taxes_cents = qs.passenger_total_cents
                   and qs.driver_commission_cents <= qs.contribution_cents
                then qs.passenger_total_cents end as total
      from quote_snapshots qs
      left join tariff_versions tv on tv.id = qs.tariff_version_id
     where qs.request_id = r.id
     order by qs.created_at desc, qs.id desc
     limit 1
  ) q on true`;

/** $1 = pasajero. Pagos propios + solicitudes aceptadas todavía sin intento de pago vigente. */
const PASSENGER_ITEMS_CTE = `
  with items as (
    select 'payment:' || p.id::text as key, 'payment'::text as kind, r.id as request_id, p.booking_id, p.id as payment_id,
           t.driver_user_id, t.id as trip_id, t.departure_at, so.label as origin_label, sd.label as destination_label,
           p.amount_cents::bigint as amount_cents,
           case when p.status in ('requires_action','processing') then 'pending'
                when p.status = 'failed' then 'failed'
                when p.status = 'expired' then 'expired'
                when p.status = 'refunded' then 'refunded'
                when p.outcome <> 'booking_confirmed'
                  or exists (select 1 from refund_requests rr
                              where rr.payment_id = p.id and rr.status in ('pending_review','approved','executing','failed'))
                  then 'under_review'
                when p.refunded_cents > 0 then 'partially_refunded'
                else 'paid' end as state,
           coalesce(p.succeeded_at, p.created_at) as occurred_at
      from payments p
      join ride_requests r on r.id = p.request_id
      join trips t on t.id = r.trip_id
      ${STOP_LABEL_JOINS}
     where p.payer_user_id = $1
    union all
    select 'request:' || r.id::text, 'pending_request', r.id, null::uuid, null::uuid,
           t.driver_user_id, t.id, t.departure_at, so.label, sd.label,
           q.total::bigint, 'pending', r.updated_at
      from ride_requests r
      join trips t on t.id = r.trip_id
      ${STOP_LABEL_JOINS}
      ${REQUEST_QUOTE_LATERAL}
     where r.passenger_user_id = $1
       and r.status::text in ('accepted','payment_pending')
       and not exists (select 1 from payments p2
                        where p2.request_id = r.id and p2.status in ('requires_action','processing','succeeded'))
  )`;

type PassengerItemRow = {
  key: string;
  kind: "payment" | "pending_request";
  request_id: string;
  booking_id: string | null;
  payment_id: string | null;
  driver_user_id: string;
  trip_id: string;
  departure_at: Date | string | null;
  origin_label: string | null;
  destination_label: string | null;
  amount_cents: string | null;
  state: PassengerPaymentState;
  occurred_at: Date | string;
};

function passengerItem(row: PassengerItemRow, users: Map<string, PublicUserDto>): PassengerPaymentItemDto {
  return {
    key: row.key,
    kind: row.kind,
    requestId: row.request_id,
    bookingId: row.booking_id,
    paymentId: row.payment_id,
    driver: userFrom(users, row.driver_user_id),
    trip: tripRef({
      trip_id: row.trip_id,
      departure_at: row.departure_at,
      origin_label: row.origin_label,
      destination_label: row.destination_label
    }),
    amount: row.amount_cents === null ? moneyPending() : centsToMoney(num(row.amount_cents)),
    state: row.state,
    occurredAt: toIsoRequired(row.occurred_at)
  };
}

export async function listPassengerPayments(
  pool: Pool,
  principal: AuthPrincipal,
  query: { state?: PassengerPaymentState; cursor?: string; limit?: number }
): Promise<Page<PassengerPaymentItemDto>> {
  const params: unknown[] = [principal.userId];
  const where: string[] = [];
  if (query.state) {
    params.push(query.state);
    where.push(`state = $${params.length}`);
  }
  const cursor = decodeCursor(query.cursor);
  if (cursor) {
    params.push(cursor.t, cursor.k);
    where.push(`(occurred_at, key) < ($${params.length - 1}::timestamptz, $${params.length}::text)`);
  }
  const limit = clampLimit(query.limit);
  params.push(limit + 1);
  const result = await pool.query<PassengerItemRow>(
    `${PASSENGER_ITEMS_CTE}
     select * from items
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by occurred_at desc, key desc
      limit $${params.length}`,
    params
  );
  const rows = result.rows.slice(0, limit);
  const users = await loadPublicUsers(pool, rows.map(r => r.driver_user_id));
  const last = rows[rows.length - 1];
  return {
    items: rows.map(row => passengerItem(row, users)),
    nextCursor: result.rows.length > limit && last ? encodeCursor({ t: toIsoRequired(last.occurred_at), k: last.key }) : null
  };
}

type MonthBounds = { month: string; start: Date; end: Date; startDay: string };

async function resolveMonth(db: Queryable, requested: string | undefined): Promise<MonthBounds> {
  const startDay = monthToFirstDay(requested) ?? `${await currentMadridMonth(db)}-01`;
  const bounds = await db.query<{ start: Date; end: Date }>(
    `select ($1::date::timestamp at time zone 'Europe/Madrid') as start,
            (($1::date + interval '1 month')::timestamp at time zone 'Europe/Madrid') as "end"`,
    [startDay]
  );
  const row = bounds.rows[0]!;
  return { month: startDay.slice(0, 7), start: new Date(row.start), end: new Date(row.end), startDay };
}

export async function getPassengerSummary(
  pool: Pool,
  provider: PaymentProvider,
  principal: AuthPrincipal,
  month: string | undefined
): Promise<PassengerPaymentsSummaryDto> {
  const bounds = await resolveMonth(pool, month);
  const [pending, upcoming, recent, defaultMethod, commission] = await Promise.all([
    pool.query<{ total: string | null; unknown_count: number }>(
      `${PASSENGER_ITEMS_CTE}
       select coalesce(sum(amount_cents), 0)::text as total,
              (count(*) filter (where amount_cents is null))::int as unknown_count
         from items
        where state = 'pending' and departure_at >= $2 and departure_at < $3`,
      [principal.userId, bounds.start, bounds.end]
    ),
    pool.query<{ n: number }>(
      `select count(*)::int as n
         from bookings b
         join ride_requests r on r.id = b.request_id
         join trips t on t.id = r.trip_id
        where r.passenger_user_id = $1 and b.status::text = 'confirmed'
          and t.departure_at >= now() and t.status::text in ('published','active')`,
      [principal.userId]
    ),
    pool.query<PassengerItemRow>(
      `${PASSENGER_ITEMS_CTE}
       select * from items order by occurred_at desc, key desc limit 3`,
      [principal.userId]
    ),
    provider.enabled ? loadDefaultMethod(pool, principal.userId, "charge") : Promise.resolve(null),
    loadCommissionInfo(pool)
  ]);
  const pendingRow = pending.rows[0]!;
  const users = await loadPublicUsers(pool, recent.rows.map(r => r.driver_user_id));
  return {
    month: bounds.month,
    availability: describeAvailability(provider),
    // Si algún pendiente del mes no tiene importe definido, el total no se puede afirmar: «Por definir».
    pendingThisMonth: pendingRow.unknown_count > 0 ? moneyPending() : centsToMoney(num(pendingRow.total)),
    upcomingTripsCount: upcoming.rows[0]!.n,
    recent: recent.rows.map(row => passengerItem(row, users)),
    paymentMethod: defaultMethod,
    platformCommission: commission
  };
}

/* ───────────────────────── Conductor ───────────────────────── */

export async function loadNextPayout(db: Queryable, driverUserId: string): Promise<NextPayoutDto> {
  const open = await db.query<{ status: string; net_cents: string; scheduled_for: string | null }>(
    `select status, net_cents::text as net_cents, scheduled_for
       from payout_runs
      where driver_user_id = $1 and status in ('draft','processing','failed')
      order by period_month asc
      limit 1`,
    [driverUserId]
  );
  const run = open.rows[0];
  if (run) {
    return {
      status: run.status === "processing" ? "processing" : run.scheduled_for ? "scheduled" : "pending_definition",
      date: run.scheduled_for,
      amount: centsToMoney(num(run.net_cents))
    };
  }
  const available = await queryEarnings(db, driverUserId, { state: "available", all: true });
  const total = available.rows.reduce((sum, row) => sum + num(row.net_cents), 0);
  return {
    status: "pending_definition",
    date: null,
    amount: total > 0 ? centsToMoney(total) : moneyPending()
  };
}

export async function getDriverSummary(
  pool: Pool,
  provider: PaymentProvider,
  principal: AuthPrincipal,
  month: string | undefined
): Promise<DriverPaymentsSummaryDto> {
  const bounds = await resolveMonth(pool, month);
  const [completedTrips, unknownBookings, earnings, recent, nextPayout, payoutAccount, commission] = await Promise.all([
    pool.query<{ n: number }>(
      `select count(*)::int as n from trips
        where driver_user_id = $1 and status::text = 'completed' and completed_at >= $2 and completed_at < $3`,
      [principal.userId, bounds.start, bounds.end]
    ),
    pool.query<{ n: number }>(
      `select count(*)::int as n
         from bookings b
         join ride_requests r on r.id = b.request_id
         join trips t on t.id = r.trip_id
        where t.driver_user_id = $1 and b.status::text = 'completed'
          and t.completed_at >= $2 and t.completed_at < $3
          and not exists (select 1 from ledger_transactions tx where tx.booking_id = b.id and tx.kind = 'charge')`,
      [principal.userId, bounds.start, bounds.end]
    ),
    queryEarnings(pool, principal.userId, { all: true }),
    queryEarnings(pool, principal.userId, { limit: 3 }),
    loadNextPayout(pool, principal.userId),
    provider.enabled ? loadDefaultMethod(pool, principal.userId, "payout") : Promise.resolve(null),
    loadCommissionInfo(pool)
  ]);

  // «A cobrar este mes»: neto de reservas cuyo viaje se completó en el mes y aún no están abonadas (Por cobrar + En liquidación).
  const startMs = bounds.start.getTime();
  const endMs = bounds.end.getTime();
  const collectible = earnings.rows.filter(row => {
    if (row.state !== "available" && row.state !== "in_payout") return false;
    const at = new Date(row.occurred_at).getTime();
    return at >= startMs && at < endMs;
  });
  const toCollect =
    unknownBookings.rows[0]!.n > 0
      ? moneyPending()
      : centsToMoney(collectible.reduce((sum, row) => sum + num(row.net_cents), 0));

  const users = await loadPublicUsers(pool, recent.rows.map(r => r.passenger_user_id));
  return {
    month: bounds.month,
    availability: describeAvailability(provider),
    toCollectThisMonth: toCollect,
    completedTripsCount: completedTrips.rows[0]!.n,
    nextPayout,
    recent: recent.rows.map(row => earningItem(row, users)),
    payoutAccount,
    platformCommission: commission
  };
}
