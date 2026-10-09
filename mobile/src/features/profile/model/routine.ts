/**
 * Rutina semanal («Favoritos y rutina»): orden y textos de las filas, frase de la plaza semanal, semana suspendida y
 * validación en español del formulario de fila. Funciones puras.
 */
import type { FavoritePlace, RoutineEntry, Weekday, WeeklySeatOffer } from "@/api/types";
import { WEEKDAY_KEYS, formatDayMonth, toCivilParts, weekdayLabel } from "@/i18n";
import { profileStrings } from "../strings";
import { isClock } from "./time";

const copy = profileStrings.routineForm;

// ── Filas ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Lunes a domingo y, dentro del día, por hora. No modifica la lista recibida. */
export function sortEntries<T extends Pick<RoutineEntry, "weekday" | "time">>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => {
    const byDay = WEEKDAY_KEYS.indexOf(a.weekday) - WEEKDAY_KEYS.indexOf(b.weekday);
    return byDay !== 0 ? byDay : a.time.localeCompare(b.time);
  });
}

/** «Casa → Campus». */
export function entryRouteText(entry: Pick<RoutineEntry, "fromPlace" | "toPlace">): string {
  return profileStrings.favorites.routeText(entry.fromPlace.name, entry.toPlace.name);
}

/** Días con alguna fila activa (los que usa la plaza semanal), de lunes a domingo. */
export function enabledWeekdays(entries: readonly Pick<RoutineEntry, "weekday" | "enabled">[]): Weekday[] {
  return WEEKDAY_KEYS.filter((day) => entries.some((entry) => entry.weekday === day && entry.enabled));
}

// ── Frases ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const PLURAL_BY_DAY: Record<Weekday, string> = {
  mon: "lunes",
  tue: "martes",
  wed: "miércoles",
  thu: "jueves",
  fri: "viernes",
  sat: "sábados",
  sun: "domingos",
};

/**
 * Los días de una oferta o de una fila, en frase: «de lunes a viernes» · «todos los días» · «los fines de semana» ·
 * «los lunes, miércoles y viernes». Vacío si no hay días.
 */
export function weekdaysPhrase(days: readonly Weekday[]): string {
  const selected = WEEKDAY_KEYS.filter((day) => days.includes(day));
  if (selected.length === 0) return "";
  if (selected.length === 7) return "todos los días";
  const first = selected[0];
  const last = selected[selected.length - 1];
  if (first === undefined || last === undefined) return "";
  if (selected.length === 2 && first === "sat" && last === "sun") return "los fines de semana";
  const firstIndex = WEEKDAY_KEYS.indexOf(first);
  const lastIndex = WEEKDAY_KEYS.indexOf(last);
  if (selected.length >= 3 && lastIndex - firstIndex === selected.length - 1) {
    return `de ${weekdayLabel(first, "long").toLowerCase()} a ${weekdayLabel(last, "long").toLowerCase()}`;
  }
  const names = selected.map((day) => PLURAL_BY_DAY[day]);
  if (names.length === 1) return `los ${names[0] ?? ""}`;
  return `los ${names.slice(0, -1).join(", ")} y ${names[names.length - 1] ?? ""}`;
}

/** «Ofrezco 1 plaza de lunes a viernes» o, con la oferta apagada, «No estás ofreciendo plaza semanal». */
export function offerLine(offer: Pick<WeeklySeatOffer, "enabled" | "seats" | "weekdays">): string {
  const strings = profileStrings.favorites.offer;
  const phrase = weekdaysPhrase(offer.weekdays);
  if (!offer.enabled || phrase === "") return strings.lineOff;
  return strings.line(offer.seats, phrase);
}

/** `2026-10-12` + `2026-10-18` → «12 – 18 oct»; entre meses, «28 sep – 4 oct». */
export function weekRangeLabel(weekStart: string, weekEnd: string): string {
  const start = toCivilParts(weekStart);
  const end = toCivilParts(weekEnd);
  if (start === null || end === null) return `${weekStart} – ${weekEnd}`;
  if (start.month === end.month && start.year === end.year) return `${start.day} – ${formatDayMonth(weekEnd)}`;
  return `${formatDayMonth(weekStart)} – ${formatDayMonth(weekEnd)}`;
}

// ── Formulario de fila ────────────────────────────────────────────────────────────────────────────────────────────────

export interface EntryDraft {
  weekdays: readonly Weekday[];
  time: string;
  fromPlaceId: string | null;
  toPlaceId: string | null;
  enabled: boolean;
}

export type EntryField = "weekdays" | "time" | "fromPlaceId" | "toPlaceId";
export type EntryErrors = Partial<Record<EntryField, string>>;

/** Validación en español. Sin errores → el objeto está vacío. */
export function validateEntryDraft(draft: EntryDraft): EntryErrors {
  const errors: EntryErrors = {};
  if (draft.weekdays.length === 0) errors.weekdays = copy.validation.daysRequired;
  if (draft.time.trim() === "" || !isClock(draft.time)) errors.time = copy.validation.timeRequired;
  if (draft.fromPlaceId === null) errors.fromPlaceId = copy.validation.fromRequired;
  if (draft.toPlaceId === null) errors.toPlaceId = copy.validation.toRequired;
  if (draft.fromPlaceId !== null && draft.toPlaceId !== null && draft.fromPlaceId === draft.toPlaceId) errors.toPlaceId = copy.validation.samePlace;
  return errors;
}

export function hasEntryErrors(errors: EntryErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * Días del borrador en los que ya existe una fila con la misma hora y el mismo trayecto (el servidor la rechazaría con
 * `ROUTINE_ENTRY_EXISTS`). `ignoreEntryId` excluye la fila que se está editando.
 */
export function clashingWeekdays(entries: readonly RoutineEntry[], draft: EntryDraft, ignoreEntryId?: string): Weekday[] {
  if (draft.fromPlaceId === null || draft.toPlaceId === null) return [];
  const clashes = entries.filter(
    (entry) =>
      entry.id !== ignoreEntryId &&
      draft.weekdays.includes(entry.weekday) &&
      entry.time === draft.time &&
      entry.fromPlace.id === draft.fromPlaceId &&
      entry.toPlace.id === draft.toPlaceId,
  );
  return WEEKDAY_KEYS.filter((day) => clashes.some((entry) => entry.weekday === day));
}

/** «Lun, Mar y Mié» para el aviso de fila repetida. */
export function weekdayNames(days: readonly Weekday[]): string {
  const names = WEEKDAY_KEYS.filter((day) => days.includes(day)).map((day) => weekdayLabel(day, "short"));
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1] ?? ""}`;
}

/** Los destinos que se pueden elegir como origen o destino de una fila (todos los guardados). */
export function placeChoices(places: readonly FavoritePlace[]): { id: string; label: string; icon: FavoritePlace["kind"] }[] {
  return places.map((place) => ({ id: place.id, label: place.name, icon: place.kind }));
}

/** Necesita al menos dos destinos guardados para poder crear una fila. */
export function canCreateEntries(places: readonly unknown[]): boolean {
  return places.length >= 2;
}
