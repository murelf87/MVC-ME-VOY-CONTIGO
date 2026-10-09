/**
 * Liquidaciones al conductor (docs/contracts/money.md §8.6): periodos `YYYY-MM`, estados y reglas de presentación.
 * Nada se muestra como «abonado» salvo que el servidor devuelva `paid` (llega con el evento firmado del proveedor).
 * Funciones puras: se prueban en Node.
 */
import { madridOffsetMinutes } from "@/i18n";
import type { AdminPayoutRun, PayoutStatus } from "@/api/types";

export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export type PeriodValidation = { ok: true; period: string } | { ok: false; message: string };

export function validatePeriod(text: string): PeriodValidation {
  const raw = text.trim();
  // Se admite «2026-10» y «10/2026» (la forma habitual en España).
  const es = /^(0?[1-9]|1[0-2])\s*[/.-]\s*(\d{4})$/.exec(raw);
  const period = es !== null ? `${es[2]}-${(es[1] ?? "").padStart(2, "0")}` : raw;
  if (!PERIOD_PATTERN.test(period)) return { ok: false, message: "Escribe el mes como 10/2026 (mes y año)." };
  const year = Number(period.slice(0, 4));
  if (year < 2024 || year > 2100) return { ok: false, message: "Escribe un año entre 2024 y 2100." };
  return { ok: true, period };
}

function civilNow(nowMs: number): { year: number; month: number } {
  const local = new Date(nowMs + madridOffsetMinutes(nowMs) * 60_000);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1 };
}

export function periodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Los últimos `count` meses cerrados o en curso, el más reciente primero: `["2026-10", "2026-09", …]`. */
export function recentPeriods(nowMs: number, count: number): string[] {
  const { year, month } = civilNow(nowMs);
  const periods: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const index = year * 12 + (month - 1) - i;
    periods.push(periodKey(Math.floor(index / 12), (index % 12) + 1));
  }
  return periods;
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"] as const;

/** `2026-10` → «octubre de 2026». */
export function periodLabel(period: string): string {
  if (!PERIOD_PATTERN.test(period)) return period;
  const month = MONTHS[Number(period.slice(5, 7)) - 1] ?? "";
  return `${month} de ${period.slice(0, 4)}`;
}

export type PayoutTone = "gray" | "amber" | "green" | "red";

export function payoutTone(status: PayoutStatus): PayoutTone {
  switch (status) {
    case "draft":
      return "gray";
    case "processing":
      return "amber";
    case "paid":
      return "green";
    case "failed":
      return "red";
    case "cancelled":
      return "gray";
  }
}

/** Se puede pedir el abono de una liquidación generada (`draft`) o fallida (`failed`): el servidor responde 409 `PAYOUT_NOT_EXECUTABLE` en cualquier otro estado. */
export function canExecute(run: Pick<AdminPayoutRun, "status">): boolean {
  return run.status === "draft" || run.status === "failed";
}

/** Totales del periodo mostrado: nº de liquidaciones por estado. */
export function countByStatus(runs: readonly Pick<AdminPayoutRun, "status">[]): Record<PayoutStatus, number> {
  const counts: Record<PayoutStatus, number> = { draft: 0, processing: 0, paid: 0, failed: 0, cancelled: 0 };
  for (const run of runs) counts[run.status] += 1;
  return counts;
}
