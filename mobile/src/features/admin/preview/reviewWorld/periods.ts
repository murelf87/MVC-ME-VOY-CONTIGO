/**
 * Ventanas de tiempo del panel (SIMULACIÓN). Espejo de `src/modules/trust/summary.ts`: los periodos se cuentan en horario
 * de Europe/Madrid (la medianoche de la persona que mira, no la del servidor) y cada ventana trae su periodo de
 * comparación: el mismo recorrido del periodo anterior («hoy hasta ahora» frente a «ayer a esta misma hora»).
 */
import type { AdminPeriod, AdminRefundPeriod } from "@/api/types";
import { addDaysToDate, madridDate, madridDateTimeMs, madridParts, TIME } from "@/preview";

export interface TimeWindow {
  from: number;
  to: number;
  previousFrom: number;
  previousTo: number;
}

function midnightOf(date: string): number {
  return madridDateTimeMs(date, "00:00");
}

function firstOfMonth(nowMs: number, monthsBack: number): string {
  const parts = madridParts(nowMs);
  const index = parts.year * 12 + (parts.month - 1) - monthsBack;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

/** Ventana de un periodo del resumen y de las reservas, y la inmediatamente anterior de la misma duración. */
export function periodWindow(nowMs: number, period: AdminPeriod): TimeWindow {
  const today = madridDate(nowMs);
  switch (period) {
    case "today": {
      const from = midnightOf(today);
      const previousFrom = midnightOf(addDaysToDate(today, -1));
      return { from, to: nowMs, previousFrom, previousTo: nowMs - (from - previousFrom) };
    }
    case "yesterday": {
      const from = midnightOf(addDaysToDate(today, -1));
      const to = midnightOf(today);
      return { from, to, previousFrom: midnightOf(addDaysToDate(today, -2)), previousTo: from };
    }
    case "last_7_days": {
      const from = midnightOf(addDaysToDate(today, -6));
      const previousFrom = midnightOf(addDaysToDate(today, -13));
      return { from, to: nowMs, previousFrom, previousTo: nowMs - (from - previousFrom) };
    }
    case "last_30_days": {
      const from = midnightOf(addDaysToDate(today, -29));
      const previousFrom = midnightOf(addDaysToDate(today, -59));
      return { from, to: nowMs, previousFrom, previousTo: nowMs - (from - previousFrom) };
    }
    case "this_month": {
      const from = midnightOf(firstOfMonth(nowMs, 0));
      const previousFrom = midnightOf(firstOfMonth(nowMs, 1));
      return { from, to: nowMs, previousFrom, previousTo: Math.min(from, previousFrom + (nowMs - from)) };
    }
  }
}

/** Instante desde el que cuenta un periodo móvil de devoluciones (`null` = sin límite). */
export function refundPeriodStart(nowMs: number, period: AdminRefundPeriod): number | null {
  switch (period) {
    case "7d":
      return nowMs - 7 * TIME.MS_DAY;
    case "30d":
      return nowMs - 30 * TIME.MS_DAY;
    case "90d":
      return nowMs - 90 * TIME.MS_DAY;
    case "365d":
      return nowMs - 365 * TIME.MS_DAY;
    case "all":
      return null;
  }
}

export function within(ms: number, from: number, to: number): boolean {
  return ms >= from && ms <= to;
}
