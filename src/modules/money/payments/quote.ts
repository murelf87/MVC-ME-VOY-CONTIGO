import { moneyPending } from "../../../lib/dto.js";
import type { Queryable } from "../lib/db.js";
import { num } from "../lib/db.js";
import { centsToMoney } from "../lib/people.js";
import type { PaymentBreakdown } from "../ledger/ledger-service.js";
import type { PaymentSummaryDto } from "../types.js";

/**
 * Cotización congelada de una solicitud, escrita por el módulo `trips` en `quote_snapshots` (se lee la tabla, no su código).
 * Solo se considera DEFINIDA si está ligada a una versión de tarifa que no sea borrador y es internamente coherente:
 * sin tarifa aprobada no hay importe y, por tanto, no se puede cobrar (PROMPT_MAESTRO §8).
 */
export type Quote =
  | { defined: false; reason: "no_quote" | "no_approved_tariff" | "inconsistent" }
  | {
      defined: true;
      snapshotId: string;
      tariffVersionId: string;
      tariffVersion: number;
      breakdown: PaymentBreakdown;
    };

type QuoteRow = {
  id: string;
  tariff_version_id: string | null;
  tariff_version: number | null;
  tariff_status: string | null;
  contribution_cents: number;
  passenger_commission_cents: number;
  driver_commission_cents: number;
  processing_cents: number;
  taxes_cents: number;
  passenger_total_cents: number;
  driver_net_cents: number;
};

export async function loadQuote(db: Queryable, requestId: string): Promise<Quote> {
  const result = await db.query<QuoteRow>(
    `select q.id, q.tariff_version_id, tv.version as tariff_version, tv.status::text as tariff_status,
            q.contribution_cents, q.passenger_commission_cents, q.driver_commission_cents,
            q.processing_cents, q.taxes_cents, q.passenger_total_cents, q.driver_net_cents
       from quote_snapshots q
       left join tariff_versions tv on tv.id=q.tariff_version_id
      where q.request_id=$1
      order by q.created_at desc, q.id desc
      limit 1`,
    [requestId]
  );
  const row = result.rows[0];
  if (!row) return { defined: false, reason: "no_quote" };
  if (!row.tariff_version_id || row.tariff_version === null || row.tariff_status === null || row.tariff_status === "draft") {
    return { defined: false, reason: "no_approved_tariff" };
  }
  const total = num(row.passenger_total_cents);
  const parts =
    num(row.contribution_cents) + num(row.passenger_commission_cents) + num(row.processing_cents) + num(row.taxes_cents);
  if (total <= 0 || parts !== total || num(row.driver_commission_cents) > num(row.contribution_cents)) {
    return { defined: false, reason: "inconsistent" };
  }
  return {
    defined: true,
    snapshotId: row.id,
    tariffVersionId: row.tariff_version_id,
    tariffVersion: num(row.tariff_version),
    breakdown: {
      contributionCents: num(row.contribution_cents),
      passengerCommissionCents: num(row.passenger_commission_cents),
      driverCommissionCents: num(row.driver_commission_cents),
      processingCents: num(row.processing_cents),
      taxesCents: num(row.taxes_cents),
      totalCents: total
    }
  };
}

export function quoteToSummary(quote: Quote): PaymentSummaryDto {
  if (!quote.defined) {
    return {
      contribution: moneyPending(),
      platformFee: moneyPending(),
      processing: moneyPending(),
      taxes: moneyPending(),
      total: moneyPending(),
      tariffVersion: null,
      quoteSnapshotId: null
    };
  }
  const b = quote.breakdown;
  return {
    contribution: centsToMoney(b.contributionCents),
    platformFee: centsToMoney(b.passengerCommissionCents),
    processing: centsToMoney(b.processingCents),
    taxes: centsToMoney(b.taxesCents),
    total: centsToMoney(b.totalCents),
    tariffVersion: quote.tariffVersion,
    quoteSnapshotId: quote.snapshotId
  };
}

/** ¿Existe alguna tarifa aprobada? (la economía está «activada»). */
export async function economyIsActive(db: Queryable): Promise<boolean> {
  const result = await db.query<{ active: boolean }>(
    `select exists(select 1 from tariff_versions where status='approved') as active`
  );
  return result.rows[0]!.active;
}
