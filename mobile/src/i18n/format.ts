/**
 * Formato es-ES de importes, fechas, horas, distancias y duraciones.
 *
 * Funciones PURAS y deterministas (no usan `Intl`, cuyo soporte y resultados varían entre Hermes/iOS/Android/web) para
 * que la misma entrada dé siempre el mismo texto. Las fechas de calendario (`YYYY-MM-DD`) no se convierten de zona; los
 * instantes (`ISO-8601` con `Z`/desfase, `Date`, ms) se expresan en hora peninsular española (Europe/Madrid) con la regla
 * de horario de verano de la UE (último domingo de marzo → último domingo de octubre, 01:00 UTC).
 *
 * El espacio entre cifra y «€» es un espacio de no separación (U+00A0, como pide la RAE y como produce `Intl`), para que
 * «4,00 €» nunca se parta en dos líneas.
 */
import type { Money, Weekday } from "@/api/types/common";

export const NBSP = " ";
/** Texto que sustituye a un importe cuya economía aún no está definida. */
export const MONEY_PENDING_TEXT = "Por definir";
/** Etiqueta de importes de ejemplo (`Money.status === "illustrative"`). */
export const MONEY_ILLUSTRATIVE_TAG = "ilustrativo";

// ── Números e importes ─────────────────────────────────────────────────────────────────────────────────────────────

function groupThousands(integerDigits: string): string {
  return integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Número con coma decimal y puntos de millar: `formatDecimal(1234.5, 2)` → `1.234,50`. */
export function formatDecimal(value: number, fractionDigits: number): string {
  const factor = 10 ** fractionDigits;
  const rounded = Math.round(Math.abs(value) * factor) / factor;
  const [intPart, fracPart = ""] = rounded.toFixed(fractionDigits).split(".");
  const sign = value < 0 && rounded !== 0 ? "-" : "";
  const grouped = groupThousands(intPart);
  return fractionDigits > 0 ? `${sign}${grouped},${fracPart}` : `${sign}${grouped}`;
}

/** Céntimos enteros → `4,00 €`. Miles con punto (`1.234,50 €`). */
export function formatCents(cents: number): string {
  return `${formatDecimal(Math.round(cents) / 100, 2)}${NBSP}€`;
}

/** Céntimos por unidad: `formatCentsPerUnit(30, "km")` → `0,30 €/km`. */
export function formatCentsPerUnit(cents: number, unit: string): string {
  return `${formatCents(cents)}/${unit}`;
}

export interface MoneyParts {
  /** Texto principal: `4,00 €` o `Por definir`. */
  text: string;
  /** `true` si el importe es de ejemplo: la UI debe mostrar la etiqueta «ilustrativo» junto al importe. */
  illustrative: boolean;
  /** `true` si la economía aún no está definida (`cents === null`). */
  pending: boolean;
}

/** Descompone un `Money` de la API en texto + banderas (para pintar la etiqueta «ilustrativo»). */
export function moneyParts(money: Money): MoneyParts {
  if (money.cents === null || money.status === "pending_definition") {
    return { text: MONEY_PENDING_TEXT, illustrative: false, pending: true };
  }
  return { text: formatCents(money.cents), illustrative: money.status === "illustrative", pending: false };
}

/** `Money` → `4,00 €` | `Por definir`. Un importe ilustrativo se devuelve igual: usa `moneyParts().illustrative` para la etiqueta. */
export function formatMoney(money: Money): string {
  return moneyParts(money).text;
}

/** Como `formatMoney` pero añadiendo « (ilustrativo)» a los importes de ejemplo. */
export function formatMoneyLabelled(money: Money): string {
  const parts = moneyParts(money);
  return parts.illustrative ? `${parts.text} (${MONEY_ILLUSTRATIVE_TAG})` : parts.text;
}

/** Valoración media con coma: `4,8`. `null` → cadena vacía. */
export function formatRating(average: number | null): string {
  return average === null ? "" : formatDecimal(average, 1);
}

/** Porcentaje entero: `12` → `12 %` (con espacio de no separación). */
export function formatPercent(value: number): string {
  return `${formatDecimal(value, 0)}${NBSP}%`;
}

// ── Plurales ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Plural regular español de una palabra suelta: plaza→plazas, viaje→viajes, valoración→valoraciones, lápiz→lápices. */
export function pluralWord(word: string): string {
  if (/[aeiouáéíóú]$/i.test(word)) return `${word}s`;
  if (/z$/i.test(word)) return `${word.slice(0, -1)}ces`;
  const accentless = word
    .replace(/ó(n)$/i, "o$1")
    .replace(/á(n)$/i, "a$1")
    .replace(/é(n)$/i, "e$1")
    .replace(/í(n)$/i, "i$1")
    .replace(/ú(n)$/i, "u$1");
  return `${accentless}es`;
}

/** `pluralize(1, "plaza")` → `1 plaza`; `pluralize(3, "plaza")` → `3 plazas`; `pluralize(0, "plaza")` → `0 plazas`. */
export function pluralize(count: number, singular: string, plural?: string): string {
  const word = count === 1 ? singular : (plural ?? pluralWord(singular));
  return `${count}${NBSP}${word}`;
}

// ── Calendario y hora (Europe/Madrid) ───────────────────────────────────────────────────────────────────────────

export type DateInput = Date | string | number;

const WEEKDAYS_LONG = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"] as const;
const WEEKDAYS_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] as const;
const MONTHS_LONG = [
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
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;

/** Lunes primero, como los selectores de días de la app. */
export const WEEKDAY_KEYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
/** `L M X J V S D` (pantallas 10 y 14). */
export const weekdayInitials: readonly string[] = ["L", "M", "X", "J", "V", "S", "D"];

const WEEKDAY_LONG_BY_KEY: Record<Weekday, string> = {
  mon: "Lunes",
  tue: "Martes",
  wed: "Miércoles",
  thu: "Jueves",
  fri: "Viernes",
  sat: "Sábado",
  sun: "Domingo",
};
const WEEKDAY_SHORT_BY_KEY: Record<Weekday, string> = {
  mon: "Lun",
  tue: "Mar",
  wed: "Mié",
  thu: "Jue",
  fri: "Vie",
  sat: "Sáb",
  sun: "Dom",
};

/** `mon` → `Lunes` (`long`) | `Lun` (`short`) | `L` (`initial`). */
export function weekdayLabel(day: Weekday, style: "long" | "short" | "initial" = "long"): string {
  if (style === "initial") return weekdayInitials[WEEKDAY_KEYS.indexOf(day)] ?? "";
  return style === "long" ? WEEKDAY_LONG_BY_KEY[day] : WEEKDAY_SHORT_BY_KEY[day];
}

function lastSundayOfMonth(year: number, monthIndex: number): number {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
  return lastDay.getUTCDate() - lastDay.getUTCDay();
}

/** Desfase de Europe/Madrid respecto a UTC, en minutos, para un instante (ms desde epoch). */
export function madridOffsetMinutes(utcMs: number): number {
  const year = new Date(utcMs).getUTCFullYear();
  const dstStart = Date.UTC(year, 2, lastSundayOfMonth(year, 2), 1, 0, 0);
  const dstEnd = Date.UTC(year, 9, lastSundayOfMonth(year, 9), 1, 0, 0);
  return utcMs >= dstStart && utcMs < dstEnd ? 120 : 60;
}

export interface CivilParts {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  /** 0 = domingo … 6 = sábado */
  weekday: number;
  hour: number;
  minute: number;
  second: number;
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_TIME = /^(\d{1,2}):(\d{2})$/;

function partsFromUtcFields(date: Date): CivilParts {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

/**
 * Entrada → partes de calendario/hora en España. `YYYY-MM-DD` se toma tal cual (sin hora, a las 00:00); un instante
 * (`Date`, ms o ISO con zona) se convierte a hora de Madrid. Devuelve `null` si no se puede interpretar.
 */
export function toCivilParts(input: DateInput): CivilParts | null {
  if (typeof input === "string") {
    const calendar = CALENDAR_DATE.exec(input);
    if (calendar) {
      const y = Number(calendar[1]);
      const m = Number(calendar[2]);
      const d = Number(calendar[3]);
      const probe = new Date(Date.UTC(y, m - 1, d));
      if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
      return partsFromUtcFields(probe);
    }
  }
  const instant = input instanceof Date ? input.getTime() : typeof input === "number" ? input : Date.parse(input);
  if (!Number.isFinite(instant)) return null;
  const local = new Date(instant + madridOffsetMinutes(instant) * 60_000);
  return partsFromUtcFields(local);
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** `Lunes, 7 de abril de 2026`. */
export function formatDateLong(input: DateInput): string {
  const p = toCivilParts(input);
  if (!p) return "";
  return `${capitalize(WEEKDAYS_LONG[p.weekday] ?? "")}, ${p.day} de ${MONTHS_LONG[p.month - 1]} de ${p.year}`;
}

/** `Vie, 16 may`. */
export function formatDayShort(input: DateInput): string {
  const p = toCivilParts(input);
  if (!p) return "";
  return `${WEEKDAYS_SHORT[p.weekday]}, ${p.day} ${MONTHS_SHORT[p.month - 1]}`;
}

/** `16 may` (sin día de la semana ni año). */
export function formatDayMonth(input: DateInput): string {
  const p = toCivilParts(input);
  if (!p) return "";
  return `${p.day} ${MONTHS_SHORT[p.month - 1]}`;
}

/** `5 oct 2026` */
export function formatDateShort(input: DateInput): string {
  const p = toCivilParts(input);
  if (!p) return "";
  return `${p.day} ${MONTHS_SHORT[p.month - 1]} ${p.year}`;
}

/** `07:25` (24 h). Un `HH:mm` local se normaliza (`7:05` → `07:05`); un instante se pasa a hora de Madrid. */
export function formatTime(input: DateInput): string {
  if (typeof input === "string") {
    const clock = CLOCK_TIME.exec(input);
    if (clock) return `${pad2(Number(clock[1]))}:${clock[2]}`;
  }
  const p = toCivilParts(input);
  if (!p) return "";
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** `5 oct 2026 · 08:12` (administración). */
export function formatDateTime(input: DateInput): string {
  const date = formatDateShort(input);
  return date === "" ? "" : `${date} · ${formatTime(input)}`;
}

/** Días naturales de diferencia entre dos fechas civiles (positivo si `a` es posterior a `b`). */
function dayNumber(p: CivilParts): number {
  return Math.round(Date.UTC(p.year, p.month - 1, p.day) / 86_400_000);
}

/** `Hoy` | `Mañana` | `Ayer` | `Vie, 16 may`, según la fecha civil de `now` (por defecto, ahora). */
export function formatDayRelative(input: DateInput, now: DateInput = new Date()): string {
  const p = toCivilParts(input);
  const n = toCivilParts(now);
  if (!p || !n) return "";
  const delta = dayNumber(p) - dayNumber(n);
  if (delta === 0) return "Hoy";
  if (delta === 1) return "Mañana";
  if (delta === -1) return "Ayer";
  return formatDayShort(input);
}

/**
 * Antigüedad de un dato en vivo: `ahora mismo` (<5 s) · `hace 5 s` · `hace 2 min` · `hace 3 h` · `Ayer` ·
 * `Lun, 12 may`. Un instante futuro (reloj desfasado) se trata como «ahora mismo».
 */
export function formatRelative(input: DateInput, now: DateInput = new Date()): string {
  const then = input instanceof Date ? input.getTime() : typeof input === "number" ? input : Date.parse(input);
  const current = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(then) || !Number.isFinite(current)) return "";
  const seconds = Math.floor((current - then) / 1000);
  if (seconds < 5) return "ahora mismo";
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const p = toCivilParts(then);
  const n = toCivilParts(current);
  if (!p || !n) return "";
  const delta = dayNumber(n) - dayNumber(p);
  if (delta === 0) return `hace ${Math.floor(minutes / 60)} h`;
  if (delta === 1) return "Ayer";
  return formatDayShort(then);
}

/** Marca de la bandeja de mensajes (25): hoy `07:12`, ayer `Ayer`, este año `16 may`, antes `16 may 2025`. */
export function formatInboxStamp(input: DateInput, now: DateInput = new Date()): string {
  const p = toCivilParts(input);
  const n = toCivilParts(now);
  if (!p || !n) return "";
  const delta = dayNumber(n) - dayNumber(p);
  if (delta === 0) return formatTime(input);
  if (delta === 1) return "Ayer";
  return p.year === n.year ? formatDayMonth(input) : formatDateShort(input);
}

// ── Días de la semana, distancias y duraciones ──────────────────────────────────────────────────────────────────

/**
 * Resumen de una selección de días: `Lunes a viernes` · `Todos los días` · `Fines de semana` · `Lun, Mié y Vie`.
 * Los días se ordenan de lunes a domingo y se ignoran duplicados.
 */
export function formatWeekdays(days: readonly Weekday[]): string {
  const selected = WEEKDAY_KEYS.filter((d) => days.includes(d));
  if (selected.length === 0) return "";
  if (selected.length === 7) return "Todos los días";
  const indexes = selected.map((d) => WEEKDAY_KEYS.indexOf(d));
  const first = indexes[0] ?? 0;
  const last = indexes[indexes.length - 1] ?? 0;
  const consecutive = last - first === indexes.length - 1;
  if (selected.length === 2 && selected[0] === "sat" && selected[1] === "sun") return "Fines de semana";
  if (consecutive && selected.length >= 3) {
    return `${WEEKDAY_LONG_BY_KEY[selected[0] as Weekday]} a ${WEEKDAY_LONG_BY_KEY[selected[selected.length - 1] as Weekday].toLowerCase()}`;
  }
  const names = selected.map((d) => WEEKDAY_SHORT_BY_KEY[d]);
  if (names.length === 1) return WEEKDAY_LONG_BY_KEY[selected[0] as Weekday];
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/** Metros → `800 m` (múltiplos de 10) · `1,2 km` · `6 km` · `12,6 km` · `24 km`. */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "";
  const roundedMeters = Math.round(meters / 10) * 10;
  if (roundedMeters < 1000) return `${roundedMeters}${NBSP}m`;
  const km = Math.round(meters / 100) / 10;
  return `${formatDecimal(km, Number.isInteger(km) ? 0 : 1)}${NBSP}km`;
}

/** Minutos → `55 min` · `1 h` · `1 h 5 min`. */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "";
  const total = Math.round(minutes);
  if (total < 60) return `${total}${NBSP}min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}${NBSP}h` : `${h}${NBSP}h ${m}${NBSP}min`;
}

/** Segundos → igual que `formatDuration` (redondeando al minuto; menos de 30 s → `1 min`). */
export function formatDurationSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  return formatDuration(Math.max(1, Math.round(seconds / 60)));
}

/** Cuenta atrás `mm:ss` (`14:52`, `00:32`); a partir de una hora `h:mm:ss`. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`;
}
