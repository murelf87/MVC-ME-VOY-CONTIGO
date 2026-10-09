import { DomainError } from "../../../errors.js";
import type { Queryable } from "../lib/db.js";
import { num } from "../lib/db.js";

/**
 * Libro mayor solo-añadir, de partida doble, en céntimos enteros (ver docs/contracts/money.md §12).
 * Cada transacción suma 0 (comprobado aquí y, de forma definitiva, por un trigger diferido en la base de datos);
 * `tx_key` es la clave idempotente: publicar dos veces el mismo asiento no duplica nada.
 */
export type LedgerAccount =
  | "passenger"
  | "driver_payable"
  | "platform_revenue"
  | "processing_fees"
  | "tax_payable"
  | "suspense"
  | "refund_payable"
  | "external_payout";

export type LedgerKind = "charge" | "charge_unallocated" | "refund_approved" | "refund_executed" | "payout" | "adjustment";

export type LedgerLine = { account: LedgerAccount; userId?: string; amountCents: number };

const USER_ACCOUNTS: ReadonlySet<LedgerAccount> = new Set(["passenger", "driver_payable", "refund_payable", "external_payout"]);

export type PaymentBreakdown = {
  contributionCents: number;
  passengerCommissionCents: number;
  driverCommissionCents: number;
  processingCents: number;
  taxesCents: number;
  totalCents: number;
};

export function parseBreakdown(value: unknown): PaymentBreakdown {
  const raw = value as Record<string, unknown> | null;
  const read = (key: keyof PaymentBreakdown): number => {
    const n = raw?.[key];
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) throw new Error(`invalid payment breakdown: ${key}`);
    return n;
  };
  const breakdown: PaymentBreakdown = {
    contributionCents: read("contributionCents"),
    passengerCommissionCents: read("passengerCommissionCents"),
    driverCommissionCents: read("driverCommissionCents"),
    processingCents: read("processingCents"),
    taxesCents: read("taxesCents"),
    totalCents: read("totalCents")
  };
  const sum =
    breakdown.contributionCents + breakdown.passengerCommissionCents + breakdown.processingCents + breakdown.taxesCents;
  if (sum !== breakdown.totalCents) throw new Error("payment breakdown does not add up to its total");
  if (breakdown.driverCommissionCents > breakdown.contributionCents) throw new Error("driver commission exceeds contribution");
  return breakdown;
}

export type PostLedgerInput = {
  txKey: string;
  kind: LedgerKind;
  paymentId?: string | null;
  bookingId?: string | null;
  refundRequestId?: string | null;
  payoutRunId?: string | null;
  memo?: string;
  lines: LedgerLine[];
};

export async function postLedger(db: Queryable, input: PostLedgerInput): Promise<{ created: boolean; transactionId: number }> {
  if (input.lines.length === 0) throw new Error("ledger transaction without lines");
  let total = 0;
  for (const line of input.lines) {
    if (!Number.isSafeInteger(line.amountCents) || line.amountCents === 0) {
      throw new Error("ledger amounts must be non-zero integer cents");
    }
    if (USER_ACCOUNTS.has(line.account) !== (line.userId !== undefined)) {
      throw new Error(`ledger account ${line.account} ${USER_ACCOUNTS.has(line.account) ? "requires" : "forbids"} a user`);
    }
    total += line.amountCents;
  }
  if (total !== 0) throw new Error(`ledger transaction ${input.txKey} does not balance (${total})`);

  const inserted = await db.query<{ id: string }>(
    `insert into ledger_transactions(tx_key,kind,payment_id,booking_id,refund_request_id,payout_run_id,memo)
     values($1,$2,$3,$4,$5,$6,$7)
     on conflict (tx_key) do nothing
     returning id`,
    [
      input.txKey,
      input.kind,
      input.paymentId ?? null,
      input.bookingId ?? null,
      input.refundRequestId ?? null,
      input.payoutRunId ?? null,
      input.memo ?? null
    ]
  );
  const row = inserted.rows[0];
  if (!row) {
    const existing = await db.query<{ id: string }>(`select id from ledger_transactions where tx_key=$1`, [input.txKey]);
    return { created: false, transactionId: num(existing.rows[0]!.id) };
  }
  const transactionId = num(row.id);
  await db.query(
    `insert into ledger_entries(transaction_id,account,user_id,amount_cents)
     select $1, x.account, x.user_id, x.amount_cents
       from unnest($2::text[], $3::uuid[], $4::bigint[]) as x(account, user_id, amount_cents)`,
    [
      transactionId,
      input.lines.map(l => l.account),
      input.lines.map(l => l.userId ?? null),
      input.lines.map(l => l.amountCents)
    ]
  );
  return { created: true, transactionId };
}

/**
 * Reparte `amount` entre `parts` en proporción a su peso con el método del mayor resto (resultado exacto: suma `amount`).
 * Empates: mayor peso y, después, menor posición. Nunca asigna a una parte más que su peso.
 */
export function allocateProRata(amount: number, parts: ReadonlyArray<number>): number[] {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("amount must be a non-negative integer");
  const total = parts.reduce((a, b) => a + b, 0);
  if (amount > total) throw new Error("allocation exceeds the available total");
  if (amount === 0) return parts.map(() => 0);
  if (amount === total) return [...parts];

  const a = BigInt(amount);
  const t = BigInt(total);
  const shares = parts.map(p => Number((a * BigInt(p)) / t));
  const remainders = parts.map(p => (a * BigInt(p)) % t);
  let leftover = amount - shares.reduce((x, y) => x + y, 0);
  const order = parts
    .map((_, index) => index)
    .sort((i, j) => {
      const ri = remainders[i]!;
      const rj = remainders[j]!;
      if (ri !== rj) return ri > rj ? -1 : 1;
      if (parts[i] !== parts[j]) return parts[j]! - parts[i]!;
      return i - j;
    });
  for (const index of order) {
    if (leftover === 0) break;
    shares[index] = shares[index]! + 1;
    leftover -= 1;
  }
  return shares;
}

/** Cobro confirmado con reserva creada: reparte el total entre conductor, plataforma, procesamiento e impuestos. */
export function buildChargeLines(input: {
  passengerUserId: string;
  driverUserId: string;
  breakdown: PaymentBreakdown;
}): LedgerLine[] {
  const b = input.breakdown;
  const lines: LedgerLine[] = [{ account: "passenger", userId: input.passengerUserId, amountCents: -b.totalCents }];
  const driverNet = b.contributionCents - b.driverCommissionCents;
  if (driverNet !== 0) lines.push({ account: "driver_payable", userId: input.driverUserId, amountCents: driverNet });
  const platform = b.passengerCommissionCents + b.driverCommissionCents;
  if (platform !== 0) lines.push({ account: "platform_revenue", amountCents: platform });
  if (b.processingCents !== 0) lines.push({ account: "processing_fees", amountCents: b.processingCents });
  if (b.taxesCents !== 0) lines.push({ account: "tax_payable", amountCents: b.taxesCents });
  return lines;
}

export async function postCharge(
  db: Queryable,
  input: { paymentId: string; bookingId: string; passengerUserId: string; driverUserId: string; breakdown: PaymentBreakdown }
): Promise<void> {
  await postLedger(db, {
    txKey: `charge:${input.paymentId}`,
    kind: "charge",
    paymentId: input.paymentId,
    bookingId: input.bookingId,
    lines: buildChargeLines(input)
  });
}

/** Cobrado sin reserva (pago tardío, duplicado): el dinero queda en suspenso hasta devolverlo. */
export async function postUnallocatedCharge(
  db: Queryable,
  input: { paymentId: string; passengerUserId: string; amountCents: number }
): Promise<void> {
  await postLedger(db, {
    txKey: `charge_unallocated:${input.paymentId}`,
    kind: "charge_unallocated",
    paymentId: input.paymentId,
    lines: [
      { account: "passenger", userId: input.passengerUserId, amountCents: -input.amountCents },
      { account: "suspense", amountCents: input.amountCents }
    ]
  });
}

type BalanceRow = { account: LedgerAccount; user_id: string | null; balance: string };

/**
 * Devolución aprobada: revierte `amountCents` del cobro en proporción a lo que queda de cada componente
 * (descontando devoluciones previas) y lo registra como deuda con el pasajero (`refund_payable`).
 * El reparto proporcional es PROVISIONAL mientras no exista una política aprobada (ver contrato §Decisiones).
 */
export async function postRefundApproved(
  db: Queryable,
  input: { refundId: string; paymentId: string; bookingId: string | null; passengerUserId: string; amountCents: number }
): Promise<void> {
  const remaining = await db.query<BalanceRow>(
    `select e.account, e.user_id, sum(e.amount_cents)::text as balance
       from ledger_entries e
       join ledger_transactions t on t.id=e.transaction_id
      where t.payment_id=$1
        and t.kind in ('charge','charge_unallocated','refund_approved')
        and e.account in ('driver_payable','platform_revenue','processing_fees','tax_payable','suspense')
      group by e.account, e.user_id
     having sum(e.amount_cents) > 0
      order by e.account, e.user_id`,
    [input.paymentId]
  );
  const parts = remaining.rows.map(r => num(r.balance));
  const available = parts.reduce((a, b) => a + b, 0);
  if (input.amountCents > available) {
    throw new DomainError(
      "REFUND_AMOUNT_EXCEEDS_PAID",
      "El importe a devolver supera lo que queda por devolver de este pago.",
      400
    );
  }
  const shares = allocateProRata(input.amountCents, parts);
  const lines: LedgerLine[] = [];
  remaining.rows.forEach((row, index) => {
    const share = shares[index]!;
    if (share === 0) return;
    lines.push(
      row.user_id === null
        ? { account: row.account, amountCents: -share }
        : { account: row.account, userId: row.user_id, amountCents: -share }
    );
  });
  lines.push({ account: "refund_payable", userId: input.passengerUserId, amountCents: input.amountCents });
  await postLedger(db, {
    txKey: `refund_approved:${input.refundId}`,
    kind: "refund_approved",
    paymentId: input.paymentId,
    bookingId: input.bookingId,
    refundRequestId: input.refundId,
    lines
  });
}

/** Devolución confirmada por el proveedor: salda la deuda con el pasajero. */
export async function postRefundExecuted(
  db: Queryable,
  input: { refundId: string; paymentId: string; bookingId: string | null; passengerUserId: string; amountCents: number }
): Promise<void> {
  await postLedger(db, {
    txKey: `refund_executed:${input.refundId}`,
    kind: "refund_executed",
    paymentId: input.paymentId,
    bookingId: input.bookingId,
    refundRequestId: input.refundId,
    lines: [
      { account: "refund_payable", userId: input.passengerUserId, amountCents: -input.amountCents },
      { account: "passenger", userId: input.passengerUserId, amountCents: input.amountCents }
    ]
  });
}

/** Abono confirmado por el proveedor: baja la deuda con el conductor y la registra como abono externo. */
export async function postPayout(
  db: Queryable,
  input: { payoutRunId: string; driverUserId: string; amountCents: number }
): Promise<void> {
  await postLedger(db, {
    txKey: `payout:${input.payoutRunId}`,
    kind: "payout",
    payoutRunId: input.payoutRunId,
    lines: [
      { account: "driver_payable", userId: input.driverUserId, amountCents: -input.amountCents },
      { account: "external_payout", userId: input.driverUserId, amountCents: input.amountCents }
    ]
  });
}
