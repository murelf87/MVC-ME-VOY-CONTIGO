/**
 * Horas y fechas del recorrido (lógica pura, sin React): reloj `HH:mm`, calendario de un mes con los días elegibles y
 * etiquetas legibles. Todo se calcula en hora de Madrid (`toCivilParts`), que es la del servicio.
 */
import type { IsoDate, LocalTime } from "@/api/types";
import { formatDayRelative, formatDayShort, toCivilParts } from "@/i18n";

// ── Reloj ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ClockTime {
  hour: number;
  minute: number;
}

const CLOCK = /^(\d{1,2}):(\d{2})$/;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** `08:30` → `{ hour: 8, minute: 30 }`; `null` si no es una hora válida (`24:00`, `8:75`, texto). */
export function parseClock(value: string): ClockTime | null {
  const match = CLOCK.exec(value.trim());
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function clockString(time: ClockTime): LocalTime {
  return `${pad2(time.hour)}:${pad2(time.minute)}`;
}

/** Minutos desde las 00:00; `null` si no es una hora válida. */
export function clockMinutes(value: string): number | null {
  const parsed = parseClock(value);
  return parsed === null ? null : parsed.hour * 60 + parsed.minute;
}

/** `7:05` → `07:05`; lo que no sea una hora válida se devuelve igual. */
export function normalizeClock(value: string): LocalTime {
  const parsed = parseClock(value);
  return parsed === null ? value : clockString(parsed);
}

export const HOURS: readonly number[] = Array.from({ length: 24 }, (_, hour) => hour);
/** Pasos de minutos del selector (cada 5). */
export const MINUTE_STEPS: readonly number[] = Array.from({ length: 12 }, (_, step) => step * 5);

export function pad(value: number): string {
  return pad2(value);
}

/** Hora actual en Madrid (`HH:mm`). */
export function nowClock(now: Date): LocalTime {
  const parts = toCivilParts(now);
  return parts === null ? "00:00" : clockString({ hour: parts.hour, minute: parts.minute });
}

// ── Fechas ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Días de antelación máximos con los que se puede buscar un viaje puntual (el servidor no materializa más de 90). */
export const MAX_ADVANCE_DAYS = 90;

export function isoFromParts(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

/** Hoy en Madrid (`YYYY-MM-DD`). */
export function todayIso(now: Date): IsoDate {
  const parts = toCivilParts(now);
  return parts === null ? "1970-01-01" : isoFromParts(parts.year, parts.month, parts.day);
}

function utcDay(iso: IsoDate): number | null {
  const parts = toCivilParts(iso);
  return parts === null ? null : Math.round(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
}

export function addDaysIso(iso: IsoDate, days: number): IsoDate {
  const day = utcDay(iso);
  if (day === null) return iso;
  const date = new Date((day + days) * 86_400_000);
  return isoFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** Negativo si `a` es anterior a `b`, 0 si son el mismo día, positivo si es posterior. */
export function compareIso(a: IsoDate, b: IsoDate): number {
  const left = utcDay(a);
  const right = utcDay(b);
  if (left === null || right === null) return 0;
  return left - right;
}

export function isValidIso(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && toCivilParts(value) !== null;
}

/** ¿Se puede elegir ese día? (de hoy a 90 días vista). */
export function isSelectableDate(iso: IsoDate, today: IsoDate): boolean {
  return compareIso(iso, today) >= 0 && compareIso(iso, addDaysIso(today, MAX_ADVANCE_DAYS)) <= 0;
}

export interface MonthRef {
  year: number;
  /** 1–12 */
  month: number;
}

export function monthOf(iso: IsoDate): MonthRef {
  const parts = toCivilParts(iso);
  return parts === null ? { year: 1970, month: 1 } : { year: parts.year, month: parts.month };
}

export function shiftMonth(ref: MonthRef, delta: number): MonthRef {
  const index = ref.year * 12 + (ref.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function compareMonths(a: MonthRef, b: MonthRef): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

/** `octubre 2026`. */
export function monthTitle(ref: MonthRef): string {
  return `${MONTH_NAMES[ref.month - 1] ?? ""} ${ref.year}`;
}

export interface CalendarDay {
  iso: IsoDate;
  day: number;
  /** `false` para los días de relleno de la semana (mes anterior o siguiente). */
  inMonth: boolean;
  /** Fuera del margen de 0 a 90 días: se ve apagado y no responde. */
  disabled: boolean;
  today: boolean;
  selected: boolean;
}

/** Semanas (lunes a domingo) que cubren el mes, con el estado de cada día. */
export function monthGrid(ref: MonthRef, today: IsoDate, selected: IsoDate | null): CalendarDay[][] {
  const first = isoFromParts(ref.year, ref.month, 1);
  const firstParts = toCivilParts(first);
  const firstDay = utcDay(first);
  if (firstParts === null || firstDay === null) return [];
  // `weekday`: 0 = domingo. Lunes primero: lunes = 0 … domingo = 6.
  const lead = (firstParts.weekday + 6) % 7;
  const daysInMonth = new Date(Date.UTC(ref.year, ref.month, 0)).getUTCDate();
  const rows = Math.ceil((lead + daysInMonth) / 7);
  const weeks: CalendarDay[][] = [];
  for (let row = 0; row < rows; row += 1) {
    const week: CalendarDay[] = [];
    for (let col = 0; col < 7; col += 1) {
      const date = new Date((firstDay + row * 7 + col - lead) * 86_400_000);
      const iso = isoFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
      week.push({
        iso,
        day: date.getUTCDate(),
        inMonth: date.getUTCMonth() + 1 === ref.month && date.getUTCFullYear() === ref.year,
        disabled: !isSelectableDate(iso, today),
        today: iso === today,
        selected: selected !== null && iso === selected,
      });
    }
    weeks.push(week);
  }
  return weeks;
}

/** `Hoy · Lun, 5 oct` · `Mañana · Mar, 6 oct` · `Vie, 16 oct`. */
export function dateFieldLabel(iso: IsoDate, now: Date): string {
  const short = formatDayShort(iso);
  const relative = formatDayRelative(iso, now);
  return relative === "Hoy" || relative === "Mañana" ? `${relative} · ${short}` : short;
}

/** `Lunes, 5 de octubre`: para la lectura en voz alta de un día del calendario. */
export function dayA11yLabel(iso: IsoDate): string {
  const parts = toCivilParts(iso);
  if (parts === null) return iso;
  const weekdays = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  return `${weekdays[parts.weekday] ?? ""} ${parts.day} de ${MONTH_NAMES[parts.month - 1] ?? ""}`;
}
