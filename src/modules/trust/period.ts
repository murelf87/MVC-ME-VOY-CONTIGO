/**
 * Ventanas de calendario del panel en Europe/Madrid (incluye cambios de hora de verano/invierno).
 * Cada ventana lleva su periodo de comparación de la misma duración inmediatamente anterior.
 */
export const TIME_ZONE = "Europe/Madrid" as const;
export const PERIODS = ["today", "yesterday", "last_7_days", "last_30_days", "this_month"] as const;
export type Period = (typeof PERIODS)[number];

export type Window = {
  period: Period;
  timeZone: typeof TIME_ZONE;
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
};

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

function localParts(date: Date): { y: number; m: number; d: number } {
  const parts = Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
}

/** Desfase (minutos) de Madrid respecto a UTC en un instante. */
function offsetMinutes(date: Date): number {
  const parts = Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Instante UTC en el que en Madrid es 00:00 del día local y/m/d (m 1–12; admite desbordes de d y m). */
export function madridMidnight(y: number, m: number, d: number): Date {
  const wall = Date.UTC(y, m - 1, d, 0, 0, 0);
  let guess = wall;
  for (let i = 0; i < 3; i += 1) guess = wall - offsetMinutes(new Date(guess)) * 60000;
  return new Date(guess);
}

export function resolveWindow(period: Period, now: Date): Window {
  const { y, m, d } = localParts(now);
  const todayStart = madridMidnight(y, m, d);
  const mk = (from: Date, to: Date, previousFrom: Date, previousTo: Date): Window => ({
    period,
    timeZone: TIME_ZONE,
    from,
    to,
    previousFrom,
    previousTo
  });
  switch (period) {
    case "today": {
      const prevStart = madridMidnight(y, m, d - 1);
      return mk(todayStart, now, prevStart, new Date(prevStart.getTime() + (now.getTime() - todayStart.getTime())));
    }
    case "yesterday": {
      const prevStart = madridMidnight(y, m, d - 1);
      return mk(prevStart, todayStart, madridMidnight(y, m, d - 2), prevStart);
    }
    case "last_7_days": {
      const span = 7 * 86_400_000;
      const from = new Date(now.getTime() - span);
      return mk(from, now, new Date(from.getTime() - span), from);
    }
    case "last_30_days": {
      const span = 30 * 86_400_000;
      const from = new Date(now.getTime() - span);
      return mk(from, now, new Date(from.getTime() - span), from);
    }
    case "this_month": {
      const monthStart = madridMidnight(y, m, 1);
      const prevStart = madridMidnight(y, m - 1, 1);
      const elapsed = now.getTime() - monthStart.getTime();
      const prevEnd = new Date(Math.min(prevStart.getTime() + elapsed, monthStart.getTime()));
      return mk(monthStart, now, prevStart, prevEnd);
    }
  }
}

export function windowDto(window: Window) {
  return {
    period: window.period,
    timeZone: window.timeZone,
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    previousFrom: window.previousFrom.toISOString(),
    previousTo: window.previousTo.toISOString()
  };
}

export type KpiTrend = "up" | "down" | "flat" | "new" | "unavailable";

/** Variación porcentual redondeada (mitad hacia arriba, lejos de cero en negativos) y tendencia. */
export function compare(value: number, previous: number): { deltaPercent: number | null; trend: KpiTrend } {
  if (previous === 0) return { deltaPercent: null, trend: value === 0 ? "flat" : "new" };
  const raw = ((value - previous) * 100) / previous;
  const deltaPercent = Math.sign(raw) * Math.round(Math.abs(raw));
  return { deltaPercent: deltaPercent === 0 ? 0 : deltaPercent, trend: deltaPercent > 0 ? "up" : deltaPercent < 0 ? "down" : "flat" };
}
