import type { Pool } from "pg";
import type { AuthPrincipal } from "../../../auth/session.js";
import { DomainError } from "../../../errors.js";
import type { MoneyDto, PublicUserDto } from "../../../lib/dto.js";
import type { Queryable } from "../lib/db.js";
import { clampLimit, decodeCursor, encodeCursor, num, toIsoRequired } from "../lib/db.js";
import { centsToMoney, loadPublicUsers, unknownUser } from "../lib/people.js";
import type { MoneyTripRefDto, Page } from "../types.js";

/**
 * Recibos = JUSTIFICANTES NO FISCALES inmutables, emitidos a partir de un evento confirmado por el servidor
 * (pago confirmado, devolución ejecutada, abono pagado). No son facturas: la facturación depende de una decisión
 * fiscal pendiente (docs/contracts/money.md §Decisiones).
 */
export type ReceiptKind = "payment" | "refund" | "earning_statement";
export type ReceiptLineKey =
  | "contribution"
  | "platform_fee"
  | "processing"
  | "taxes"
  | "refund"
  | "driver_commission"
  | "refund_adjustments"
  | "net";

export type IssueReceiptInput = {
  userId: string;
  kind: ReceiptKind;
  paymentId?: string | null;
  bookingId?: string | null;
  refundRequestId?: string | null;
  payoutRunId?: string | null;
  counterpartUserId?: string | null;
  totalCents: number;
  lines: Array<{ key: ReceiptLineKey; cents: number }>;
  trip: MoneyTripRefDto | null;
};

const RECEIPT_NOTICES: Record<ReceiptKind, string> = {
  payment: "Justificante de pago no fiscal emitido por MVC. No es una factura.",
  refund: "Justificante de devolución no fiscal emitido por MVC. No es una factura rectificativa.",
  earning_statement: "Resumen de liquidación no fiscal emitido por MVC. No es una factura ni una autofactura."
};

const EXISTENCE_COLUMN: Record<ReceiptKind, "payment_id" | "refund_request_id" | "payout_run_id"> = {
  payment: "payment_id",
  refund: "refund_request_id",
  earning_statement: "payout_run_id"
};

/** Emite el recibo si no existe ya uno del mismo tipo para ese objeto (idempotente). Devuelve su id. */
export async function issueReceipt(db: Queryable, input: IssueReceiptInput): Promise<string> {
  const column = EXISTENCE_COLUMN[input.kind];
  const objectId =
    input.kind === "payment" ? input.paymentId : input.kind === "refund" ? input.refundRequestId : input.payoutRunId;
  if (!objectId) throw new Error(`receipt of kind ${input.kind} requires its object id`);

  const existing = await db.query<{ id: string }>(
    `select id from receipts where kind=$1 and ${column}=$2`,
    [input.kind, objectId]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const counter = await db.query<{ year: number; last_value: number }>(
    `insert into receipt_counters(year,last_value)
     values(extract(year from now() at time zone 'Europe/Madrid')::int, 1)
     on conflict (year) do update set last_value = receipt_counters.last_value + 1
     returning year, last_value`
  );
  const { year, last_value: sequence } = counter.rows[0]!;
  const number = `MVC-J-${year}-${String(sequence).padStart(6, "0")}`;

  const inserted = await db.query<{ id: string }>(
    `insert into receipts(number,user_id,kind,payment_id,booking_id,refund_request_id,payout_run_id,
                          counterpart_user_id,total_cents,lines,trip_snapshot)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)
     returning id`,
    [
      number,
      input.userId,
      input.kind,
      input.paymentId ?? null,
      input.bookingId ?? null,
      input.refundRequestId ?? null,
      input.payoutRunId ?? null,
      input.counterpartUserId ?? null,
      input.totalCents,
      JSON.stringify(input.lines.map(l => ({ key: l.key, cents: l.cents }))),
      input.trip ? JSON.stringify(input.trip) : null
    ]
  );
  return inserted.rows[0]!.id;
}

export type ReceiptSummaryDto = {
  id: string;
  number: string;
  kind: ReceiptKind;
  issuedAt: string;
  total: MoneyDto;
  trip: MoneyTripRefDto | null;
  counterpart: PublicUserDto | null;
  bookingId: string | null;
  paymentId: string | null;
};

export type ReceiptDto = ReceiptSummaryDto & {
  fiscalInvoice: false;
  lines: Array<{ key: ReceiptLineKey; amount: MoneyDto }>;
  notice: string;
};

type ReceiptRow = {
  id: string;
  number: string;
  kind: ReceiptKind;
  issued_at: Date | string;
  total_cents: string;
  trip_snapshot: MoneyTripRefDto | null;
  counterpart_user_id: string | null;
  booking_id: string | null;
  payment_id: string | null;
  lines: Array<{ key: ReceiptLineKey; cents: number }>;
};

const RECEIPT_COLUMNS = `id,number,kind,issued_at,total_cents::text as total_cents,trip_snapshot,counterpart_user_id,booking_id,payment_id,lines`;

function toSummary(row: ReceiptRow, users: Map<string, PublicUserDto>): ReceiptSummaryDto {
  return {
    id: row.id,
    number: row.number,
    kind: row.kind,
    issuedAt: toIsoRequired(row.issued_at),
    total: centsToMoney(num(row.total_cents)),
    trip: row.trip_snapshot,
    counterpart: row.counterpart_user_id ? (users.get(row.counterpart_user_id) ?? unknownUser(row.counterpart_user_id)) : null,
    bookingId: row.booking_id,
    paymentId: row.payment_id
  };
}

export async function listReceipts(
  pool: Pool,
  principal: AuthPrincipal,
  query: { kind?: ReceiptKind; cursor?: string; limit?: number }
): Promise<Page<ReceiptSummaryDto>> {
  const limit = clampLimit(query.limit);
  const cursor = decodeCursor(query.cursor);
  const params: unknown[] = [principal.userId];
  const where: string[] = ["user_id=$1"];
  if (query.kind) {
    params.push(query.kind);
    where.push(`kind=$${params.length}`);
  }
  if (cursor) {
    params.push(cursor.t, cursor.k);
    where.push(`(issued_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  params.push(limit + 1);
  const result = await pool.query<ReceiptRow>(
    `select ${RECEIPT_COLUMNS} from receipts
      where ${where.join(" and ")}
      order by issued_at desc, id desc
      limit $${params.length}`,
    params
  );
  const rows = result.rows.slice(0, limit);
  const users = await loadPublicUsers(pool, rows.map(r => r.counterpart_user_id));
  const last = rows[rows.length - 1];
  return {
    items: rows.map(row => toSummary(row, users)),
    nextCursor: result.rows.length > limit && last ? encodeCursor({ t: toIsoRequired(last.issued_at), k: last.id }) : null
  };
}

export async function getReceipt(pool: Pool, principal: AuthPrincipal, receiptId: string): Promise<ReceiptDto> {
  const result = await pool.query<ReceiptRow>(
    `select ${RECEIPT_COLUMNS} from receipts where id=$1 and user_id=$2`,
    [receiptId, principal.userId]
  );
  const row = result.rows[0];
  if (!row) throw new DomainError("RECEIPT_NOT_FOUND", "Recibo no encontrado.", 404);
  const users = await loadPublicUsers(pool, [row.counterpart_user_id]);
  return {
    ...toSummary(row, users),
    fiscalInvoice: false,
    lines: row.lines.map(line => ({ key: line.key, amount: centsToMoney(line.cents) })),
    notice: RECEIPT_NOTICES[row.kind]
  };
}

const LINE_LABELS: Record<ReceiptLineKey, string> = {
  contribution: "Aportación por el trayecto",
  platform_fee: "Gestión MVC",
  processing: "Procesamiento del pago",
  taxes: "Impuestos",
  refund: "Importe devuelto",
  driver_commission: "Comisión de MVC al conductor",
  refund_adjustments: "Ajustes por devoluciones",
  net: "Importe neto"
};

const KIND_TITLES: Record<ReceiptKind, string> = {
  payment: "Justificante de pago",
  refund: "Justificante de devolución",
  earning_statement: "Resumen de liquidación"
};

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function eurosText(money: MoneyDto): string {
  if (money.cents === null) return "Por definir";
  const sign = money.cents < 0 ? "-" : "";
  const abs = Math.abs(money.cents);
  return `${sign}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, "0")} €`;
}

/** HTML autocontenido (sin scripts ni recursos externos) para imprimir o convertir a PDF en el dispositivo. */
export function renderReceiptHtml(receipt: ReceiptDto): string {
  const issued = new Intl.DateTimeFormat("es-ES", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Madrid"
  }).format(new Date(receipt.issuedAt));
  const trip = receipt.trip
    ? `<p>${escapeHtml(receipt.trip.originLabel ?? "Origen")} &rarr; ${escapeHtml(receipt.trip.destinationLabel ?? "Destino")}</p>`
    : "";
  const counterpart = receipt.counterpart ? `<p>Con ${escapeHtml(receipt.counterpart.firstName)}</p>` : "";
  const rows = receipt.lines
    .map(line => `<tr><td>${escapeHtml(LINE_LABELS[line.key])}</td><td class="n">${escapeHtml(eurosText(line.amount))}</td></tr>`)
    .join("");
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(KIND_TITLES[receipt.kind])} ${escapeHtml(receipt.number)}</title>
<style>
body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0b1b4d;margin:24px;max-width:640px}
h1{font-size:20px;margin:0 0 4px}.m{color:#4b5a86;font-size:13px}
table{width:100%;border-collapse:collapse;margin:16px 0}td{padding:8px 0;border-bottom:1px solid #dbe4ff}
.n{text-align:right;white-space:nowrap}.t td{font-weight:700;border-bottom:2px solid #0b1b4d}
.aviso{margin-top:16px;padding:12px;background:#eef3ff;border-radius:8px;font-size:13px}
</style></head><body>
<h1>${escapeHtml(KIND_TITLES[receipt.kind])}</h1>
<p class="m">${escapeHtml(receipt.number)} &middot; ${escapeHtml(issued)}</p>
${trip}${counterpart}
<table>${rows}<tr class="t"><td>Total</td><td class="n">${escapeHtml(eurosText(receipt.total))}</td></tr></table>
<p class="aviso">${escapeHtml(receipt.notice)}</p>
</body></html>`;
}
