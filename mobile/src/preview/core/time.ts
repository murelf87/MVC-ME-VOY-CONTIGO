/**
 * Utilidades de hora local de España (Europe/Madrid) sin `Intl` (la vista previa debe dar el mismo resultado en
 * cualquier navegador y en Node). Regla de la UE: horario de verano (CEST, UTC+2) desde el último domingo de
 * marzo a las 01:00 UTC hasta el último domingo de octubre a las 01:00 UTC; el resto del año CET (UTC+1).
 */

const RealDate: DateConstructor = Date;

const MS_MIN = 60_000;
const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;

/** Último domingo del mes (mes 1-12) a la 01:00 UTC, en ms. */
function lastSundayUtc(year: number, month: number): number {
  const lastDay = RealDate.UTC(year, month, 0, 1, 0, 0); // día 0 del mes siguiente = último día de este
  const weekday = new RealDate(lastDay).getUTCDay(); // 0 = domingo
  return lastDay - weekday * MS_DAY;
}

/** Desfase de Europe/Madrid respecto a UTC en minutos (60 o 120) en el instante `ms`. */
export function madridOffsetMinutes(ms: number): number {
  const year = new RealDate(ms).getUTCFullYear();
  const start = lastSundayUtc(year, 3);
  const end = lastSundayUtc(year, 10);
  return ms >= start && ms < end ? 120 : 60;
}

export interface MadridParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  /** 1 = lunes … 7 = domingo (ISO). */
  isoWeekday: number;
  offsetMinutes: number;
}

export function madridParts(ms: number): MadridParts {
  const offsetMinutes = madridOffsetMinutes(ms);
  const local = new RealDate(ms + offsetMinutes * MS_MIN);
  const weekday = local.getUTCDay();
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds(),
    millisecond: local.getUTCMilliseconds(),
    isoWeekday: weekday === 0 ? 7 : weekday,
    offsetMinutes,
  };
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** `HH:mm` de reloj en Europe/Madrid. */
export function madridHHmm(ms: number): string {
  const p = madridParts(ms);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** `YYYY-MM-DD` (fecha de calendario en Europe/Madrid). */
export function madridDate(ms: number): string {
  const p = madridParts(ms);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** Instante UTC (ms) de una hora local de Madrid. Resuelve el desfase con el de ese mismo momento local. */
export function madridLocalToMs(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  const naive = RealDate.UTC(year, month - 1, day, hour, minute, second);
  // Primero con el desfase del instante «ingenuo» tomado como UTC; después se corrige si cruza el cambio horario.
  let ms = naive - madridOffsetMinutes(naive) * MS_MIN;
  const offset = madridOffsetMinutes(ms);
  ms = naive - offset * MS_MIN;
  return ms;
}

/** `YYYY-MM-DD` sumando `days` días de calendario a otra fecha de calendario. */
export function addDaysToDate(date: string, days: number): string {
  const [y, m, d] = parseDateParts(date);
  const base = RealDate.UTC(y, m - 1, d) + days * MS_DAY;
  const out = new RealDate(base);
  return `${out.getUTCFullYear()}-${pad2(out.getUTCMonth() + 1)}-${pad2(out.getUTCDate())}`;
}

export function parseDateParts(date: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Fecha de calendario no válida: ${date}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Día de la semana ISO (1 = lunes … 7 = domingo) de una fecha de calendario. */
export function isoWeekdayOf(date: string): number {
  const [y, m, d] = parseDateParts(date);
  const weekday = new RealDate(RealDate.UTC(y, m - 1, d)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** Instante (ms) a las `HH:mm` locales de la fecha de calendario dada. */
export function madridDateTimeMs(date: string, hhmm: string): number {
  const [y, m, d] = parseDateParts(date);
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) throw new Error(`Hora no válida: ${hhmm}`);
  return madridLocalToMs(y, m, d, Number(match[1]), Number(match[2]));
}

export const TIME = { MS_MIN, MS_HOUR, MS_DAY } as const;
