/**
 * Formulario «Define tu recorrido» (lógica pura, sin React ni red): estado inicial, validación en español, intercambio de
 * origen y destino, conversión a los criterios de búsqueda que viajan a Resultados y el texto-resumen.
 *
 * La comprobación de provincia (origen y destino dentro de UNA misma provincia) necesita la red y vive en
 * `provinceVerdict`, que decide a partir de lo que respondió el servidor.
 */
import type { IsoDate, LocalTime, Province, SearchMode, TripCategory, Weekday } from "@/api/types";
import { WEEKDAY_KEYS, formatTime, formatWeekdays } from "@/i18n";
import type { PlaceParam, SearchCriteriaParam } from "../../routes";
import type { ProvinceCheck } from "../api";
import { browseStrings } from "../strings";
import { isSamePlace, outsideProvinceCopy } from "./places";
import { clockMinutes, compareIso, isSelectableDate, nowClock, todayIso } from "./schedule";

const copy = browseStrings.defineRoute;

export const DEFAULT_ARRIVE_BY: LocalTime = "08:30";
export const DEFAULT_RETURN_AT: LocalTime = "18:00";
export const WORKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri"];

export interface RouteFormState {
  origin: PlaceParam | null;
  destination: PlaceParam | null;
  mode: SearchMode;
  /** «Llegada al destino». */
  arriveBy: LocalTime;
  /** «Regreso (opcional)»; `null` = sin regreso. */
  returnAt: LocalTime | null;
  /** Días del viaje semanal (solo cuentan con `mode` = `weekly`). */
  weekdays: Weekday[];
  /** Día del viaje puntual (solo cuenta con `mode` = `one_off`). */
  date: IsoDate | null;
  category: TripCategory | null;
}

export interface RouteFormSeed {
  origin?: PlaceParam;
  destination?: PlaceParam;
  category?: TripCategory | null;
}

/** Lo que enseña la lámina 10 al abrirla: llegada 08:30, regreso 18:00, semanal de lunes a viernes. */
export function initialRouteForm(seed: RouteFormSeed = {}): RouteFormState {
  return {
    origin: seed.origin ?? null,
    destination: seed.destination ?? null,
    mode: "weekly",
    arriveBy: DEFAULT_ARRIVE_BY,
    returnAt: DEFAULT_RETURN_AT,
    weekdays: [...WORKDAYS],
    date: null,
    category: seed.category ?? null,
  };
}

export function sortWeekdays(days: readonly Weekday[]): Weekday[] {
  return WEEKDAY_KEYS.filter((day) => days.includes(day));
}

export function toggleWeekday(days: readonly Weekday[], day: Weekday): Weekday[] {
  return sortWeekdays(days.includes(day) ? days.filter((entry) => entry !== day) : [...days, day]);
}

/** Intercambia origen y destino (también cuando falta uno de los dos). */
export function swapPlaces(form: RouteFormState): RouteFormState {
  return { ...form, origin: form.destination, destination: form.origin };
}

export type RouteFormField = "origin" | "destination" | "weekdays" | "date" | "arriveBy" | "returnAt";
export type RouteFormErrors = Partial<Record<RouteFormField, string>>;

export function hasErrors(errors: RouteFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * Valida lo que se puede comprobar sin red. `now` es el instante actual (se usa para «hoy» y para no aceptar una llegada
 * de hoy que ya pasó).
 */
export function validateRouteForm(form: RouteFormState, now: Date): RouteFormErrors {
  const errors: RouteFormErrors = {};
  if (form.origin === null) errors.origin = copy.originRequired;
  if (form.destination === null) errors.destination = copy.destinationRequired;
  if (form.origin !== null && form.destination !== null && isSamePlace(form.origin, form.destination)) {
    errors.destination = copy.samePlace;
  }

  const arrival = clockMinutes(form.arriveBy);
  if (arrival === null) errors.arriveBy = copy.arrivalInvalid;

  if (form.mode === "weekly") {
    if (form.weekdays.length === 0) errors.weekdays = copy.daysRequired;
  } else if (form.date === null) {
    errors.date = copy.dateRequired;
  } else {
    const today = todayIso(now);
    if (!isSelectableDate(form.date, today)) {
      errors.date = compareIso(form.date, today) < 0 ? copy.datePast : copy.dateTooFar;
    } else if (form.date === today && arrival !== null) {
      const current = clockMinutes(nowClock(now));
      if (current !== null && arrival <= current) errors.arriveBy = copy.arrivalPast;
    }
  }

  if (form.returnAt !== null) {
    const back = clockMinutes(form.returnAt);
    if (back === null) errors.returnAt = copy.returnInvalid;
    else if (arrival !== null && back <= arrival) errors.returnAt = copy.returnAfterArrival;
  }
  return errors;
}

/**
 * Criterios de búsqueda a partir de un formulario ya validado. Devuelve `null` si falta algo (origen, destino, y día o
 * días según la frecuencia): la pantalla no llega a llamarla en ese caso.
 */
export function toCriteria(form: RouteFormState): SearchCriteriaParam | null {
  if (form.origin === null || form.destination === null) return null;
  const base = {
    origin: form.origin,
    destination: form.destination,
    arriveBy: form.arriveBy,
    ...(form.returnAt !== null ? { returnAt: form.returnAt } : {}),
    ...(form.category !== null ? { category: form.category } : {}),
  };
  if (form.mode === "weekly") {
    if (form.weekdays.length === 0) return null;
    return { ...base, mode: "weekly", weekdays: sortWeekdays(form.weekdays) };
  }
  if (form.date === null) return null;
  return { ...base, mode: "one_off", date: form.date };
}

/** El formulario que corresponde a unos criterios (volver a editarlos desde Resultados). */
export function formFromCriteria(criteria: SearchCriteriaParam): RouteFormState {
  return {
    origin: criteria.origin,
    destination: criteria.destination,
    mode: criteria.mode,
    arriveBy: criteria.arriveBy,
    returnAt: criteria.returnAt ?? null,
    weekdays: criteria.mode === "weekly" ? sortWeekdays(criteria.weekdays ?? WORKDAYS) : [...WORKDAYS],
    date: criteria.mode === "one_off" ? (criteria.date ?? null) : null,
    category: criteria.category ?? null,
  };
}

/** «Lunes a viernes · Llegada 08:30» (semanal) o «Lun, 5 oct · Llegada 08:30» (puntual: la fecha la pone quien llama). */
export function scheduleSummary(criteria: Pick<SearchCriteriaParam, "mode" | "weekdays" | "arriveBy">, dateLabel?: string): string {
  const arrival = browseStrings.tripResults.arrivalBy(formatTime(criteria.arriveBy));
  if (criteria.mode === "weekly") {
    const days = formatWeekdays(criteria.weekdays ?? WORKDAYS);
    return days === "" ? arrival : `${days} · ${arrival}`;
  }
  return dateLabel !== undefined && dateLabel !== "" ? `${dateLabel} · ${arrival}` : arrival;
}

// ── Provincia ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type ProvinceVerdict =
  | { kind: "ok"; province: Province }
  | { kind: "invalid"; errors: RouteFormErrors }
  | { kind: "failed"; error: unknown };

/**
 * Qué decir según lo que respondió el servidor para el origen y el destino:
 *  - los dos en la misma provincia disponible → sigue;
 *  - alguno fuera de las provincias disponibles → error en ese campo («Origen fuera de provincia…»);
 *  - dos provincias distintas → error de «una sola provincia» en el destino;
 *  - fallo de red o del servidor → no se puede decidir (`failed`): se reintenta, no se acusa a la persona.
 * `activeProvinceName` sirve solo para el texto «Solo hacemos trayectos dentro de la provincia de …».
 */
export function provinceVerdict(origin: ProvinceCheck, destination: ProvinceCheck, activeProvinceName: string | null): ProvinceVerdict {
  const errors: RouteFormErrors = {};
  if (!origin.ok && origin.reason === "outside") errors.origin = outsideProvinceCopy("origin", activeProvinceName).message;
  if (!destination.ok && destination.reason === "outside") errors.destination = outsideProvinceCopy("destination", activeProvinceName).message;
  if (hasErrors(errors)) return { kind: "invalid", errors };

  const failure = !origin.ok && origin.reason === "error" ? origin : !destination.ok && destination.reason === "error" ? destination : null;
  if (failure !== null && failure.reason === "error") return { kind: "failed", error: failure.error };

  if (origin.ok && destination.ok) {
    if (origin.province.id !== destination.province.id) {
      return { kind: "invalid", errors: { destination: copy.sameProvinceRequired } };
    }
    return { kind: "ok", province: origin.province };
  }
  return { kind: "failed", error: new Error("province-check") };
}
