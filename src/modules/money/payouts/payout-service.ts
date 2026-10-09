import type { Pool, PoolClient } from "pg";
import type { AuthPrincipal } from "../../../auth/session.js";
import { DomainError } from "../../../errors.js";
import { writeAudit } from "../../../lib/audit.js";
import type { MoneyDto, PublicUserDto } from "../../../lib/dto.js";
import type { Queryable } from "../lib/db.js";
import { clampLimit, decodeCursor, encodeCursor, monthToFirstDay, num, toIso, toIsoRequired } from "../lib/db.js";
import { withIdempotency, type IdempotentOutcome } from "../lib/idempotency.js";
import { providerIdempotencyKey } from "../lib/ids.js";
import { centsToMoney, loadPublicUsers, userFrom } from "../lib/people.js";
import { loadDefaultMethod } from "../payments/methods-service.js";
import { describeAvailability } from "../payments/availability.js";
import { callProvider } from "../provider/call.js";
import { PAYMENTS_DISABLED_MESSAGE } from "../provider/disabled.js";
import type { PaymentProvider } from "../provider/types.js";
import { earningItem, queryEarnings, type DriverEarningItemDto } from "../reports/earnings-service.js";
import { loadNextPayout, type NextPayoutDto } from "../reports/summary-service.js";
import type { Page, PaymentMethodDto, PaymentsAvailabilityDto } from "../types.js";

export type PayoutStatus = "draft" | "processing" | "paid" | "failed" | "cancelled";
export const PAYOUT_STATUSES: readonly PayoutStatus[] = ["draft", "processing", "paid", "failed", "cancelled"];

export interface PayoutViewDto {
  id: string;
  period: string;
  status: PayoutStatus;
  net: MoneyDto;
  bookingsCount: number;
  scheduledFor: string | null;
  paidAt: string | null;
  failureCode: string | null;
  createdAt: string;
}

export interface AdminPayoutRunDto extends PayoutViewDto {
  driver: PublicUserDto;
}

export interface MyPayoutsDto extends Page<PayoutViewDto> {
  availability: PaymentsAvailabilityDto;
  schedule: { frequency: "monthly"; dayStatus: "pending_definition" | "defined"; dayOfMonth: number | null };
  nextPayout: NextPayoutDto;
  payoutAccount: PaymentMethodDto | null;
}

export interface PayoutDetailDto extends PayoutViewDto {
  items: DriverEarningItemDto[];
}

export interface GeneratePayoutRunsDto {
  period: string;
  created: AdminPayoutRunDto[];
  skipped: number;
}

type PayoutRow = {
  id: string;
  driver_user_id: string;
  period_month: string;
  status: PayoutStatus;
  net_cents: string;
  bookings_count: number;
  scheduled_for: string | null;
  paid_at: Date | string | null;
  failure_code: string | null;
  created_at: Date | string;
  execution_attempts: number;
};

const PAYOUT_COLUMNS = `id,driver_user_id,period_month::text as period_month,status,net_cents::text as net_cents,bookings_count,
  scheduled_for,paid_at,failure_code,created_at,execution_attempts`;

function toPayoutView(row: PayoutRow): PayoutViewDto {
  return {
    id: row.id,
    period: row.period_month.slice(0, 7),
    status: row.status,
    net: centsToMoney(num(row.net_cents)),
    bookingsCount: row.bookings_count,
    scheduledFor: row.scheduled_for,
    paidAt: toIso(row.paid_at),
    failureCode: row.failure_code,
    createdAt: toIsoRequired(row.created_at)
  };
}

/* ───────────────────────── Conductor ───────────────────────── */

export async function listMyPayouts(
  pool: Pool,
  provider: PaymentProvider,
  principal: AuthPrincipal,
  query: { cursor?: string; limit?: number }
): Promise<MyPayoutsDto> {
  const params: unknown[] = [principal.userId];
  const where = [`driver_user_id = $1`];
  const cursor = decodeCursor(query.cursor);
  if (cursor) {
    params.push(cursor.t, cursor.k);
    where.push(`(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  const limit = clampLimit(query.limit);
  params.push(limit + 1);
  const [rowsResult, nextPayout, payoutAccount] = await Promise.all([
    pool.query<PayoutRow>(
      `select ${PAYOUT_COLUMNS} from payout_runs where ${where.join(" and ")}
        order by created_at desc, id desc limit $${params.length}`,
      params
    ),
    loadNextPayout(pool, principal.userId),
    provider.enabled ? loadDefaultMethod(pool, principal.userId, "payout") : Promise.resolve(null)
  ]);
  const rows = rowsResult.rows.slice(0, limit);
  const last = rows[rows.length - 1];
  return {
    items: rows.map(toPayoutView),
    nextCursor: rowsResult.rows.length > limit && last ? encodeCursor({ t: toIsoRequired(last.created_at), k: last.id }) : null,
    availability: describeAvailability(provider),
    // El calendario de abonos (día del mes) NO está aprobado: «Por definir».
    schedule: { frequency: "monthly", dayStatus: "pending_definition", dayOfMonth: null },
    nextPayout,
    payoutAccount
  };
}

export async function getMyPayout(pool: Pool, principal: AuthPrincipal, payoutId: string): Promise<PayoutDetailDto> {
  const found = await pool.query<PayoutRow>(
    `select ${PAYOUT_COLUMNS} from payout_runs where id=$1 and driver_user_id=$2`,
    [payoutId, principal.userId]
  );
  const row = found.rows[0];
  if (!row) throw new DomainError("PAYOUT_NOT_FOUND", "Liquidación no encontrada.", 404);
  const earnings = await queryEarnings(pool, principal.userId, { payoutRunId: payoutId, all: true });
  const users = await loadPublicUsers(pool, earnings.rows.map(r => r.passenger_user_id));
  return { ...toPayoutView(row), items: earnings.rows.map(r => earningItem(r, users)) };
}

/* ───────────────────────── Panel de finanzas ───────────────────────── */

async function adminRuns(db: Queryable, rows: PayoutRow[]): Promise<AdminPayoutRunDto[]> {
  const users = await loadPublicUsers(db, rows.map(r => r.driver_user_id));
  return rows.map(row => ({ ...toPayoutView(row), driver: userFrom(users, row.driver_user_id) }));
}

export async function listAdminPayoutRuns(
  pool: Pool,
  query: { period?: string; status?: PayoutStatus; cursor?: string; limit?: number }
): Promise<Page<AdminPayoutRunDto>> {
  const params: unknown[] = [];
  const where: string[] = [];
  const periodDay = monthToFirstDay(query.period);
  if (periodDay) {
    params.push(periodDay);
    where.push(`period_month = $${params.length}::date`);
  }
  if (query.status) {
    params.push(query.status);
    where.push(`status = $${params.length}`);
  }
  const cursor = decodeCursor(query.cursor);
  if (cursor) {
    params.push(cursor.t, cursor.k);
    where.push(`(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  const limit = clampLimit(query.limit);
  params.push(limit + 1);
  const result = await pool.query<PayoutRow>(
    `select ${PAYOUT_COLUMNS} from payout_runs
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by created_at desc, id desc limit $${params.length}`,
    params
  );
  const rows = result.rows.slice(0, limit);
  const last = rows[rows.length - 1];
  return {
    items: await adminRuns(pool, rows),
    nextCursor: result.rows.length > limit && last ? encodeCursor({ t: toIsoRequired(last.created_at), k: last.id }) : null
  };
}

type Candidate = { driver_user_id: string; booking_id: string; net_cents: string };

/**
 * Genera una liquidación `draft` por conductor y mes natural (Europe/Madrid) con las reservas COMPLETADAS ese mes cuyo neto
 * en el libro mayor es positivo y que no están ya en otra liquidación. El importe de la liquidación es
 * `min(suma de netos elegibles, saldo del conductor − liquidaciones abiertas)`: si hubo devoluciones sobre reservas ya abonadas,
 * el saldo negativo resultante se descuenta aquí (nunca se abona más de lo que el libro mayor debe al conductor).
 * Sin neto positivo no se crea liquidación. Un conductor con liquidación ya generada para el mes se omite (idempotente).
 */
export async function generatePayoutRuns(
  pool: Pool,
  principal: AuthPrincipal,
  idempotencyKey: string,
  body: { period: string }
): Promise<IdempotentOutcome<GeneratePayoutRunsDto>> {
  const periodDay = monthToFirstDay(body.period);
  if (!periodDay) throw new DomainError("VALIDATION_ERROR", "Indica el periodo (AAAA-MM).", 400);
  return withIdempotency(
    pool,
    {
      userId: principal.userId,
      key: idempotencyKey,
      scope: `payout_generate:${body.period}`,
      fingerprint: { period: body.period },
      successStatus: 201
    },
    async client => {
      // Serializa la generación de un mismo periodo.
      await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`money-payout-gen:${body.period}`]);
      const candidates = await client.query<Candidate>(
        `select t.driver_user_id, b.id as booking_id, sum(e.amount_cents)::text as net_cents
           from bookings b
           join ride_requests r on r.id = b.request_id
           join trips t on t.id = r.trip_id
           join ledger_transactions tx on tx.booking_id = b.id
           join ledger_entries e on e.transaction_id = tx.id and e.account = 'driver_payable' and e.user_id = t.driver_user_id
          where b.status::text = 'completed'
            and t.completed_at >= ($1::date::timestamp at time zone 'Europe/Madrid')
            and t.completed_at < (($1::date + interval '1 month')::timestamp at time zone 'Europe/Madrid')
            and not exists (select 1 from payout_run_items pri where pri.booking_id = b.id)
          group by t.driver_user_id, b.id
         having sum(e.amount_cents) > 0
          order by t.driver_user_id, b.id`,
        [periodDay]
      );

      const byDriver = new Map<string, Candidate[]>();
      for (const candidate of candidates.rows) {
        const list = byDriver.get(candidate.driver_user_id) ?? [];
        list.push(candidate);
        byDriver.set(candidate.driver_user_id, list);
      }

      const created: PayoutRow[] = [];
      let skipped = 0;
      for (const [driverId, items] of byDriver) {
        const existing = await client.query(`select 1 from payout_runs where driver_user_id=$1 and period_month=$2::date`, [
          driverId,
          periodDay
        ]);
        if (existing.rowCount) {
          skipped += 1;
          continue;
        }
        const eligible = items.reduce((sum, item) => sum + num(item.net_cents), 0);
        const balance = await client.query<{ balance: string; reserved: string }>(
          `select coalesce((select sum(e.amount_cents) from ledger_entries e
                             where e.account = 'driver_payable' and e.user_id = $1), 0)::text as balance,
                  coalesce((select sum(net_cents) from payout_runs
                             where driver_user_id = $1 and status in ('draft','processing','failed')), 0)::text as reserved`,
          [driverId]
        );
        const available = num(balance.rows[0]!.balance) - num(balance.rows[0]!.reserved);
        const net = Math.min(eligible, available);
        if (net <= 0) {
          skipped += 1;
          continue;
        }
        const account = await loadDefaultMethod(client, driverId, "payout");
        const inserted = await client.query<PayoutRow>(
          `insert into payout_runs(driver_user_id,period_month,status,net_cents,bookings_count,payout_account_id,created_by_user_id)
           values($1,$2::date,'draft',$3,$4,$5,$6)
           returning ${PAYOUT_COLUMNS}`,
          [driverId, periodDay, net, items.length, account?.id ?? null, principal.userId]
        );
        const run = inserted.rows[0]!;
        await client.query(
          `insert into payout_run_items(payout_run_id,booking_id,net_cents)
           select $1, x.booking_id, x.net_cents
             from unnest($2::uuid[], $3::bigint[]) as x(booking_id, net_cents)`,
          [run.id, items.map(i => i.booking_id), items.map(i => num(i.net_cents))]
        );
        await writeAudit(client, {
          actorUserId: principal.userId,
          action: "payout.run_created",
          entityType: "payout_run",
          entityId: run.id,
          metadata: { period: body.period, netCents: net, bookings: items.length, eligibleCents: eligible }
        });
        created.push(run);
      }
      return { period: body.period, created: await adminRuns(client, created), skipped };
    }
  );
}

async function destinationMethod(client: PoolClient, driverUserId: string): Promise<{ id: string; provider_method_ref: string } | null> {
  const result = await client.query<{ id: string; provider_method_ref: string }>(
    `select id, provider_method_ref from payment_methods
      where user_id=$1 and purpose='payout' and status='active'
      order by is_default desc, created_at desc limit 1`,
    [driverUserId]
  );
  return result.rows[0] ?? null;
}

export async function executePayoutRun(
  pool: Pool,
  provider: PaymentProvider,
  principal: AuthPrincipal,
  idempotencyKey: string,
  payoutId: string
): Promise<IdempotentOutcome<AdminPayoutRunDto>> {
  return withIdempotency(
    pool,
    {
      userId: principal.userId,
      key: idempotencyKey,
      scope: `payout_execute:${payoutId}`,
      fingerprint: { payoutId },
      successStatus: 200
    },
    async client => {
      const found = await client.query<PayoutRow>(`select ${PAYOUT_COLUMNS} from payout_runs where id=$1 for update`, [payoutId]);
      const run = found.rows[0];
      if (!run) throw new DomainError("PAYOUT_NOT_FOUND", "Liquidación no encontrada.", 404);
      if (run.status !== "draft" && run.status !== "failed") {
        throw new DomainError("PAYOUT_NOT_EXECUTABLE", "Esta liquidación no está en un estado en el que se pueda pedir el abono.", 409);
      }
      if (!provider.enabled || !provider.capabilities.payouts) {
        throw new DomainError("PAYMENTS_PROVIDER_DISABLED", PAYMENTS_DISABLED_MESSAGE, 409);
      }
      const destination = await destinationMethod(client, run.driver_user_id);
      if (!destination) {
        throw new DomainError("PAYOUT_ACCOUNT_REQUIRED", "El conductor no tiene una cuenta de cobro activa.", 409);
      }
      const attempt = run.execution_attempts + 1;
      const submitted = await callProvider(() =>
        provider.createPayout({
          idempotencyKey: providerIdempotencyKey("payout", run.id, String(attempt)),
          payoutRunId: run.id,
          amountCents: num(run.net_cents),
          destinationMethodRef: destination.provider_method_ref
        })
      );
      const updated = await client.query<PayoutRow>(
        `update payout_runs
            set status='processing', provider=$2, provider_payout_ref=$3, payout_account_id=$4, failure_code=null,
                execution_attempts=execution_attempts + 1, updated_at=now()
          where id=$1
          returning ${PAYOUT_COLUMNS}`,
        [run.id, provider.name, submitted.providerPayoutRef, destination.id]
      );
      await writeAudit(client, {
        actorUserId: principal.userId,
        action: "payout.execute_requested",
        entityType: "payout_run",
        entityId: run.id,
        metadata: { attempt, netCents: num(run.net_cents) }
      });
      const [item] = await adminRuns(client, [updated.rows[0]!]);
      return item!;
    }
  );
}
