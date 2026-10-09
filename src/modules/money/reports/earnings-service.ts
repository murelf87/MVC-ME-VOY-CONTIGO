import type { Pool } from "pg";
import type { AuthPrincipal } from "../../../auth/session.js";
import { DomainError } from "../../../errors.js";
import type { MoneyDto, PublicUserDto } from "../../../lib/dto.js";
import type { Queryable } from "../lib/db.js";
import { clampLimit, decodeCursor, encodeCursor, num, toIsoRequired } from "../lib/db.js";
import { centsToMoney, loadPublicUsers, STOP_LABEL_JOINS, tripRef, userFrom } from "../lib/people.js";
import type { MoneyTripRefDto, Page } from "../types.js";

/**
 * Cobros del conductor DERIVADOS DEL LIBRO MAYOR (cuenta `driver_payable` del propio conductor, por reserva):
 *   neto = aportación − comisión del conductor − devoluciones aprobadas.
 * Nunca se calculan desde la cotización: sin asientos de libro (economía no activada) no hay cobros que mostrar.
 * Las reservas canceladas / en no-show no se listan como cobros mientras sus consecuencias no estén definidas.
 */
export type DriverEarningState = "pending" | "available" | "in_payout" | "paid_out";
export const DRIVER_EARNING_STATES: readonly DriverEarningState[] = ["pending", "available", "in_payout", "paid_out"];

export interface DriverEarningItemDto {
  bookingId: string;
  passenger: PublicUserDto;
  trip: MoneyTripRefDto;
  net: MoneyDto;
  state: DriverEarningState;
  occurredAt: string;
}

export interface DriverEarningDetailDto extends DriverEarningItemDto {
  lines: { contribution: MoneyDto; driverCommission: MoneyDto; refundAdjustments: MoneyDto; net: MoneyDto };
  payoutId: string | null;
}

export type EarningRow = {
  booking_id: string;
  passenger_user_id: string;
  trip_id: string;
  departure_at: Date | string | null;
  origin_label: string | null;
  destination_label: string | null;
  net_cents: string;
  state: DriverEarningState;
  occurred_at: Date | string;
  payout_run_id: string | null;
  contribution_cents: number | null;
  driver_commission_cents: number | null;
  refund_adjust_cents: string;
};

/** CTE común. $1 = conductor. Las filas con neto 0 (reserva devuelta íntegramente) no son cobros. */
const EARNINGS_SQL = `
  with led as (
    select tx.booking_id, sum(e.amount_cents) as net_cents
      from ledger_entries e
      join ledger_transactions tx on tx.id = e.transaction_id
     where e.account = 'driver_payable' and e.user_id = $1 and tx.booking_id is not null
     group by tx.booking_id
  ), items as (
    select b.id as booking_id, r.passenger_user_id, t.id as trip_id, t.departure_at,
           so.label as origin_label, sd.label as destination_label,
           led.net_cents::text as net_cents,
           case when pr.id is not null then (case when pr.status = 'paid' then 'paid_out' else 'in_payout' end)
                when b.status::text = 'completed' then 'available'
                else 'pending' end as state,
           coalesce(t.completed_at, t.departure_at, b.created_at) as occurred_at,
           pr.id as payout_run_id,
           pay.contribution_cents, pay.driver_commission_cents,
           (select coalesce(-sum(e2.amount_cents), 0)::text
              from ledger_entries e2 join ledger_transactions t2 on t2.id = e2.transaction_id
             where e2.account = 'driver_payable' and e2.user_id = $1 and t2.booking_id = b.id and t2.kind = 'refund_approved'
           ) as refund_adjust_cents
      from led
      join bookings b on b.id = led.booking_id
      join ride_requests r on r.id = b.request_id
      join trips t on t.id = r.trip_id
      ${STOP_LABEL_JOINS}
      left join payout_run_items pri on pri.booking_id = b.id
      left join payout_runs pr on pr.id = pri.payout_run_id and pr.status <> 'cancelled'
      left join lateral (
        select (p.breakdown->>'contributionCents')::int as contribution_cents,
               (p.breakdown->>'driverCommissionCents')::int as driver_commission_cents
          from payments p where p.booking_id = b.id limit 1
      ) pay on true
     where t.driver_user_id = $1 and led.net_cents <> 0
       -- Reservas canceladas o en no-show NO son cobros: su importe está en revisión (consecuencias aún no definidas).
       and b.status::text not in ('cancelled','driver_cancelled','no_show')
  )`;

export function earningItem(row: EarningRow, users: Map<string, PublicUserDto>): DriverEarningItemDto {
  return {
    bookingId: row.booking_id,
    passenger: userFrom(users, row.passenger_user_id),
    trip: tripRef({
      trip_id: row.trip_id,
      departure_at: row.departure_at,
      origin_label: row.origin_label,
      destination_label: row.destination_label
    }),
    net: centsToMoney(num(row.net_cents)),
    state: row.state,
    occurredAt: toIsoRequired(row.occurred_at)
  };
}

export async function queryEarnings(
  db: Queryable,
  driverUserId: string,
  options: { state?: DriverEarningState; payoutRunId?: string; bookingId?: string; cursor?: string; limit?: number; all?: boolean }
): Promise<{ rows: EarningRow[]; nextCursor: string | null }> {
  const params: unknown[] = [driverUserId];
  const where: string[] = [];
  if (options.state) {
    params.push(options.state);
    where.push(`state = $${params.length}`);
  }
  if (options.payoutRunId) {
    params.push(options.payoutRunId);
    where.push(`payout_run_id = $${params.length}::uuid`);
  }
  if (options.bookingId) {
    params.push(options.bookingId);
    where.push(`booking_id = $${params.length}::uuid`);
  }
  const cursor = decodeCursor(options.cursor);
  if (cursor) {
    params.push(cursor.t, cursor.k);
    where.push(`(occurred_at, booking_id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  const limit = options.all ? 500 : clampLimit(options.limit);
  params.push(limit + 1);
  const result = await db.query<EarningRow>(
    `${EARNINGS_SQL}
     select * from items
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by occurred_at desc, booking_id desc
      limit $${params.length}`,
    params
  );
  const rows = result.rows.slice(0, limit);
  const last = rows[rows.length - 1];
  return {
    rows,
    nextCursor: result.rows.length > limit && last ? encodeCursor({ t: toIsoRequired(last.occurred_at), k: last.booking_id }) : null
  };
}

export async function listDriverEarnings(
  pool: Pool,
  principal: AuthPrincipal,
  query: { state?: DriverEarningState; cursor?: string; limit?: number }
): Promise<Page<DriverEarningItemDto>> {
  const { rows, nextCursor } = await queryEarnings(pool, principal.userId, query);
  const users = await loadPublicUsers(pool, rows.map(r => r.passenger_user_id));
  return { items: rows.map(row => earningItem(row, users)), nextCursor };
}

export async function getDriverEarning(pool: Pool, principal: AuthPrincipal, bookingId: string): Promise<DriverEarningDetailDto> {
  const { rows } = await queryEarnings(pool, principal.userId, { bookingId, limit: 1 });
  const row = rows[0];
  if (!row) throw new DomainError("BOOKING_NOT_FOUND", "Cobro no encontrado.", 404);
  const users = await loadPublicUsers(pool, [row.passenger_user_id]);
  const base = earningItem(row, users);
  const net = num(row.net_cents);
  return {
    ...base,
    lines: {
      contribution: centsToMoney(row.contribution_cents),
      driverCommission: centsToMoney(row.driver_commission_cents),
      refundAdjustments: centsToMoney(num(row.refund_adjust_cents)),
      net: centsToMoney(net)
    },
    payoutId: row.payout_run_id
  };
}
