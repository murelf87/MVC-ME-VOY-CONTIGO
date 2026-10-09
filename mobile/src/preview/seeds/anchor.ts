/**
 * Ancla temporal del mundo sembrado. Las láminas están hechas el lunes 5 de octubre de 2026 por la mañana; si el reloj
 * virtual es otro, los viajes sembrados se desplazan al día de «ahora» (pasadas las 21:00 locales, al día siguiente),
 * conservando las horas locales (08:05, 08:03…). Así la oferta del día siempre queda en el futuro.
 */
import type { PreviewDb } from "../core/db";
import { addDaysToDate, isoWeekdayOf, madridDate, madridDateTimeMs, madridParts } from "../core/time";

/** Fecha de calendario (Europe/Madrid) a la que se ancla la oferta sembrada. */
export function anchorDate(db: PreviewDb): string {
  const now = db.nowMs();
  const today = madridDate(now);
  return madridParts(now).hour >= 21 ? addDaysToDate(today, 1) : today;
}

/** Instante (ms) de `HH:mm` locales, `dayOffset` días respecto al ancla. */
export function localAt(db: PreviewDb, hhmm: string, dayOffset = 0): number {
  return madridDateTimeMs(addDaysToDate(anchorDate(db), dayOffset), hhmm);
}

/** Las `count` fechas laborables inmediatamente anteriores al ancla (más reciente primero). */
export function previousWorkdays(db: PreviewDb, count: number): string[] {
  const out: string[] = [];
  let date = anchorDate(db);
  while (out.length < count) {
    date = addDaysToDate(date, -1);
    if (isoWeekdayOf(date) <= 5) out.push(date);
  }
  return out;
}

/** Fecha `YYYY-MM-DD` `days` días después del ancla. */
export function anchorPlusDays(db: PreviewDb, days: number): string {
  return addDaysToDate(anchorDate(db), days);
}
