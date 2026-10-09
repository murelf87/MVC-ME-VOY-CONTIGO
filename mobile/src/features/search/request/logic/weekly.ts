/**
 * Lógica pura de «Tu plaza semanal» (14) y del resumen semanal de «Revisa tu solicitud» (15): formulario, fechas,
 * validación en español, cuerpo de la petición y lectura de la vista previa de días y plazas.
 *
 * Reglas (docs/contracts/trips.md §8): una solicitud POR DÍA; la vista previa dice qué días tienen plaza ANTES de crear;
 * si algún día no tiene plaza, solo se crea con `allowPartial` (consentimiento explícito de la persona); la vuelta exige
 * que el conductor la ofrezca; hasta 4 semanas; las excepciones (vacaciones, festivos) no se solicitan.
 */
import type { IsoDate, LocalTime, TripLeg, Weekday, WeeklyOccurrence, WeeklyRequestBody, WeeklyRequestPreview } from "@/api/types";
import { WEEKDAY_KEYS, formatDayShort, toCivilParts } from "@/i18n";
import { requestStrings } from "../strings";

const copy = requestStrings.weekly;

export const MAX_WEEKS = 4;
export const MIN_WEEKS = 1;
/** Días que se miran hacia delante buscando el primer día de servicio. */
const LOOKAHEAD_DAYS = 21;

export interface Recurrence {
  weekdays: readonly Weekday[];
  outboundLocal: LocalTime;
  returnLocal: LocalTime | null;
}

export interface WeeklyForm {
  weekdays: Weekday[];
  legs: TripLeg[];
  startDate: IsoDate;
  weeks: number;
  exceptionDates: IsoDate[];
  /** Consentimiento a reservar solo los días con plaza. */
  allowPartial: boolean;
}

// ── Fechas (calendario de Madrid como cadenas YYYY-MM-DD) ───────────────────────────────────────────────────────

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

function utcOf(iso: IsoDate): number {
  const m = ISO_DATE.exec(iso);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : Number.NaN;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isoFromUtc(ms: number): IsoDate {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return isoFromUtc(utcOf(iso) + days * 86_400_000);
}

export function compareIso(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Día de la semana (lunes primero) de una fecha de calendario. */
export function weekdayOf(iso: IsoDate): Weekday {
  const jsDay = new Date(utcOf(iso)).getUTCDay(); // 0 = domingo
  return WEEKDAY_KEYS[(jsDay + 6) % 7] as Weekday;
}

/** Fecha de hoy en Madrid. */
export function todayIso(nowMs: number): IsoDate {
  const p = toCivilParts(nowMs);
  return p === null ? isoFromUtc(nowMs) : `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

function minutesOfDay(hhmm: string | null): number | null {
  if (hhmm === null) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Primer día de servicio: hoy si el conductor ofrece hoy y la recogida aún no ha pasado; si no, el siguiente día elegido.
 * («Inicio de la reserva»: la lámina 14 enseña el lunes 5 de octubre de 2026 con el reloj a las 07:17 y recogida a las 08:00.)
 */
export function defaultStartDate(input: { nowMs: number; weekdays: readonly Weekday[]; firstBoardLocal: LocalTime | null }): IsoDate {
  const today = todayIso(input.nowMs);
  const parts = toCivilParts(input.nowMs);
  const nowMinutes = parts === null ? 0 : parts.hour * 60 + parts.minute;
  const board = minutesOfDay(input.firstBoardLocal);
  for (let i = 0; i < LOOKAHEAD_DAYS; i += 1) {
    const date = addDays(today, i);
    if (!input.weekdays.includes(weekdayOf(date))) continue;
    if (i === 0 && board !== null && board <= nowMinutes) continue;
    return date;
  }
  return today;
}

// ── Formulario ──────────────────────────────────────────────────────────────────────────────────────────────────

export function sortWeekdays(days: readonly Weekday[]): Weekday[] {
  return WEEKDAY_KEYS.filter((d) => days.includes(d));
}

/** Estado inicial: los días que pidió la búsqueda (dentro de los que ofrece el conductor) y ida y vuelta si la hay. */
export function initialForm(input: {
  recurrence: Recurrence;
  preferredWeekdays?: readonly Weekday[];
  nowMs: number;
}): WeeklyForm {
  const offered = sortWeekdays(input.recurrence.weekdays);
  const preferred = sortWeekdays((input.preferredWeekdays ?? []).filter((d) => offered.includes(d)));
  const weekdays = preferred.length > 0 ? preferred : offered;
  const legs: TripLeg[] = input.recurrence.returnLocal !== null ? ["outbound", "return"] : ["outbound"];
  return {
    weekdays,
    legs,
    startDate: defaultStartDate({ nowMs: input.nowMs, weekdays, firstBoardLocal: input.recurrence.outboundLocal }),
    weeks: MIN_WEEKS,
    exceptionDates: [],
    allowPartial: false,
  };
}

/** Marca o desmarca un día de la semana (solo uno de los que ofrece el conductor). */
export function toggleWeekday(form: WeeklyForm, day: Weekday, offered: readonly Weekday[]): WeeklyForm {
  if (!offered.includes(day)) return form;
  const selected = form.weekdays.includes(day) ? form.weekdays.filter((d) => d !== day) : [...form.weekdays, day];
  const weekdays = sortWeekdays(selected);
  return { ...form, weekdays, exceptionDates: pruneExceptions(form.exceptionDates, weekdays, form.startDate, form.weeks) };
}

/** Incluye o quita un trayecto; siempre queda al menos uno. */
export function toggleLeg(form: WeeklyForm, leg: TripLeg, offeredReturn: boolean): WeeklyForm {
  if (leg === "return" && !offeredReturn) return form;
  const has = form.legs.includes(leg);
  if (has && form.legs.length === 1) return form;
  const legs: TripLeg[] = has ? form.legs.filter((l) => l !== leg) : [...form.legs, leg];
  return { ...form, legs: legs.sort((a, b) => (a === "outbound" ? -1 : b === "outbound" ? 1 : 0)) };
}

export function setStartDate(form: WeeklyForm, startDate: IsoDate): WeeklyForm {
  return { ...form, startDate, exceptionDates: pruneExceptions(form.exceptionDates, form.weekdays, startDate, form.weeks) };
}

export function setWeeks(form: WeeklyForm, weeks: number): WeeklyForm {
  const clamped = Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, Math.round(weeks)));
  return { ...form, weeks: clamped, exceptionDates: pruneExceptions(form.exceptionDates, form.weekdays, form.startDate, clamped) };
}

/** Días de reserva dentro de la ventana (inicio + semanas) para los días de la semana elegidos, sin contar excepciones. */
export function windowDates(form: Pick<WeeklyForm, "weekdays" | "startDate" | "weeks">): IsoDate[] {
  if (!isIsoDate(form.startDate)) return [];
  const out: IsoDate[] = [];
  for (let i = 0; i < form.weeks * 7; i += 1) {
    const date = addDays(form.startDate, i);
    if (form.weekdays.includes(weekdayOf(date))) out.push(date);
  }
  return out;
}

function pruneExceptions(dates: readonly IsoDate[], weekdays: readonly Weekday[], startDate: IsoDate, weeks: number): IsoDate[] {
  const valid = new Set(windowDates({ weekdays: [...weekdays], startDate, weeks }));
  return dates.filter((d) => valid.has(d)).sort(compareIso);
}

export function toggleException(form: WeeklyForm, date: IsoDate): WeeklyForm {
  const has = form.exceptionDates.includes(date);
  const next = has ? form.exceptionDates.filter((d) => d !== date) : [...form.exceptionDates, date];
  return { ...form, exceptionDates: pruneExceptions(next, form.weekdays, form.startDate, form.weeks) };
}

export function setExceptions(form: WeeklyForm, dates: readonly IsoDate[]): WeeklyForm {
  return { ...form, exceptionDates: pruneExceptions(dates, form.weekdays, form.startDate, form.weeks) };
}

/** Días que quedan por reservar (ventana − excepciones). */
export function bookableDates(form: WeeklyForm): IsoDate[] {
  const skip = new Set(form.exceptionDates);
  return windowDates(form).filter((d) => !skip.has(d));
}

// ── Validación (en español, junto al campo) ─────────────────────────────────────────────────────────────────────

export interface WeeklyFormErrors {
  weekdays?: string;
  legs?: string;
  startDate?: string;
  occurrences?: string;
}

export function validateForm(form: WeeklyForm, nowMs: number): WeeklyFormErrors {
  const errors: WeeklyFormErrors = {};
  if (form.weekdays.length === 0) errors.weekdays = copy.validationDays;
  if (form.legs.length === 0) errors.legs = copy.validationLegs;
  if (!isIsoDate(form.startDate) || compareIso(form.startDate, todayIso(nowMs)) < 0) errors.startDate = copy.validationStart;
  if (errors.weekdays === undefined && errors.startDate === undefined && bookableDates(form).length === 0) {
    errors.occurrences = copy.validationNoOccurrences;
  }
  return errors;
}

export function isFormValid(errors: WeeklyFormErrors): boolean {
  return errors.weekdays === undefined && errors.legs === undefined && errors.startDate === undefined && errors.occurrences === undefined;
}

// ── Cuerpo de la petición ───────────────────────────────────────────────────────────────────────────────────────

export function toWeeklyBody(
  form: WeeklyForm,
  target: { pickupPointId: string; dropoffStopSeq?: number | undefined; message?: string | undefined },
): WeeklyRequestBody {
  const body: WeeklyRequestBody = {
    pickupPointId: target.pickupPointId,
    weekdays: sortWeekdays(form.weekdays),
    legs: [...form.legs],
    startDate: form.startDate,
    weeks: form.weeks,
    // No existe una política de cancelación aprobada (docs/contracts/money.md §15): se declara explícitamente.
    cancellationPolicyVersion: null,
  };
  if (target.dropoffStopSeq !== undefined) body.dropoffStopSeq = target.dropoffStopSeq;
  if (form.exceptionDates.length > 0) body.exceptionDates = [...form.exceptionDates];
  if (form.allowPartial) body.allowPartial = true;
  const message = target.message?.trim();
  if (message !== undefined && message !== "") body.message = message;
  return body;
}

/** Clave estable de caché de la vista previa (cualquier cambio del cuerpo es otra consulta). */
export function previewKey(tripId: string, body: WeeklyRequestBody): readonly unknown[] {
  return [
    "request",
    "weekly-preview",
    tripId,
    body.pickupPointId,
    body.dropoffStopSeq ?? null,
    (body.weekdays ?? []).join(","),
    (body.legs ?? ["outbound"]).join(","),
    body.startDate,
    body.weeks ?? 1,
    (body.exceptionDates ?? []).join(","),
    body.allowPartial === true,
  ];
}

// ── Lectura de la vista previa ──────────────────────────────────────────────────────────────────────────────────

export interface PreviewSummary {
  /** Días con plaza que se solicitarían. */
  requestable: number;
  /** Fechas (sin repetir) con algún trayecto sin plaza. */
  fullDates: IsoDate[];
  exceptions: number;
  past: number;
  noTrip: number;
  /** Hay días con plaza y otros sin plaza: hace falta el consentimiento «solo los días con plaza». */
  needsPartialConsent: boolean;
  /** Ningún día tiene plaza. */
  nothingAvailable: boolean;
}

export function summarizePreview(preview: WeeklyRequestPreview): PreviewSummary {
  let requestable = 0;
  let exceptions = 0;
  let past = 0;
  let noTrip = 0;
  const full = new Set<IsoDate>();
  for (const o of preview.occurrences) {
    switch (o.state) {
      case "available":
      case "requested":
        requestable += 1;
        break;
      case "skipped_full":
        full.add(o.date);
        break;
      case "skipped_exception":
        exceptions += 1;
        break;
      case "skipped_past":
        past += 1;
        break;
      case "skipped_no_occurrence":
        noTrip += 1;
        break;
    }
  }
  const fullDates = [...full].sort(compareIso);
  return {
    requestable,
    fullDates,
    exceptions,
    past,
    noTrip,
    needsPartialConsent: fullDates.length > 0 && requestable > 0,
    nothingAvailable: requestable === 0,
  };
}

/** «5 oct, 6 oct y 7 oct». */
export function listDates(dates: readonly IsoDate[]): string {
  return copy.dateList(dates);
}

export interface OccurrenceRow {
  key: string;
  date: IsoDate;
  /** «Lun, 5 oct» */
  dateLabel: string;
  leg: TripLeg;
  legLabel: string;
  /** Hora de recogida (ida) o de salida (vuelta). */
  time: string | null;
  state: WeeklyOccurrence["state"];
  stateLabel: string;
  tone: "success" | "warning" | "muted" | "info";
}

function stateText(o: WeeklyOccurrence): { label: string; tone: OccurrenceRow["tone"] } {
  switch (o.state) {
    case "available":
      return { label: o.seatsAvailable !== null ? `${copy.dayAvailable} · ${copy.daySeats(o.seatsAvailable)}` : copy.dayAvailable, tone: "success" };
    case "requested":
      return { label: copy.dayRequested, tone: "info" };
    case "skipped_exception":
      return { label: copy.dayException, tone: "muted" };
    case "skipped_full":
      return { label: copy.dayFull, tone: "warning" };
    case "skipped_past":
      return { label: copy.dayPast, tone: "muted" };
    case "skipped_no_occurrence":
      return { label: copy.dayNoTrip, tone: "muted" };
  }
}

/** Una fila por día y trayecto, ordenadas por fecha (ida antes que vuelta). */
export function occurrenceRows(occurrences: readonly WeeklyOccurrence[]): OccurrenceRow[] {
  return [...occurrences]
    .sort((a, b) => compareIso(a.date, b.date) || (a.leg === b.leg ? 0 : a.leg === "outbound" ? -1 : 1))
    .map((o) => {
      const state = stateText(o);
      return {
        key: `${o.date}:${o.leg}`,
        date: o.date,
        dateLabel: formatDayShort(o.date),
        leg: o.leg,
        legLabel: o.leg === "outbound" ? "Ida" : "Vuelta",
        time: o.boardsAtLocal,
        state: o.state,
        stateLabel: state.label,
        tone: state.tone,
      };
    });
}

/** Fechas de la ventana que se pueden marcar como excepción, con su etiqueta («Lun, 5 oct»). */
export function exceptionCandidates(form: WeeklyForm, nowMs: number): Array<{ date: IsoDate; label: string; selected: boolean }> {
  const today = todayIso(nowMs);
  return windowDates(form)
    .filter((d) => compareIso(d, today) >= 0)
    .map((d) => ({ date: d, label: formatDayShort(d), selected: form.exceptionDates.includes(d) }));
}

export function exceptionsRowText(dates: readonly IsoDate[]): string {
  if (dates.length === 0) return copy.exceptionsRow;
  if (dates.length <= 2) return listDates(dates);
  return copy.exceptionsCount(dates.length);
}
