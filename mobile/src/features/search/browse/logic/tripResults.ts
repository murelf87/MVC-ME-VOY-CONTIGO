/**
 * Resultados de búsqueda (lámina 11): criterios → consulta del servidor y formato de cada tarjeta (lógica pura).
 * Nada se inventa: el precio solo se muestra si el servidor lo trae definido, y la distancia/hora de recogida salen del
 * propio resultado.
 */
import type { SearchSuggestion, TripSearchItem, TripSearchQuery } from "@/api/types";
import { formatDistance, formatMoney, formatRating, formatTime, formatWeekdays } from "@/i18n";
import type { SearchCriteriaParam } from "../../routes";
import { browseStrings } from "../strings";

const copy = browseStrings.tripResults;

export type SearchOverrides = Partial<Pick<TripSearchQuery, "toleranceMinutes" | "weekdays" | "radiusM">>;

export function toSearchQuery(criteria: SearchCriteriaParam, provinceId: string, overrides: SearchOverrides, cursor?: string): TripSearchQuery {
  const weekdays = overrides.weekdays ?? (criteria.mode === "weekly" ? (criteria.weekdays ?? []).join(",") : undefined);
  return {
    provinceId,
    originLat: criteria.origin.latitude,
    originLng: criteria.origin.longitude,
    destLat: criteria.destination.latitude,
    destLng: criteria.destination.longitude,
    originLabel: criteria.origin.label,
    destLabel: criteria.destination.label,
    arriveBy: criteria.arriveBy,
    ...(criteria.returnAt !== undefined ? { returnAt: criteria.returnAt } : {}),
    mode: criteria.mode,
    ...(criteria.mode === "one_off" && criteria.date !== undefined ? { date: criteria.date } : {}),
    ...(criteria.mode === "weekly" && weekdays !== undefined && weekdays !== "" ? { weekdays } : {}),
    ...(criteria.category !== undefined ? { category: criteria.category } : {}),
    ...(overrides.toleranceMinutes !== undefined ? { toleranceMinutes: overrides.toleranceMinutes } : {}),
    ...(overrides.radiusM !== undefined ? { radiusM: overrides.radiusM } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
  };
}

export function overridesKey(overrides: SearchOverrides): string {
  return `${overrides.toleranceMinutes ?? ""}|${overrides.weekdays ?? ""}|${overrides.radiusM ?? ""}`;
}

export interface ResultCardView {
  tripId: string;
  driverName: string;
  photoUrl: string | null;
  rating: string | null;
  ratingCount: number;
  seats: string;
  from: string;
  pickup: string;
  to: string;
  arrive: string;
  extras: string[];
  a11y: string;
  dropoffStopSeq: number;
}

function pickupText(item: TripSearchItem): string {
  const distance = formatDistance(item.pickup.walkDistanceM);
  return item.pickup.minutesFromNow !== null
    ? copy.pickupInMinutes(Math.max(0, item.pickup.minutesFromNow), distance)
    : copy.pickupAtTime(formatTime(item.pickup.pickupAtLocal), distance);
}

/** `destination`: el destino que pidió la persona (su etiqueta), no la parada del conductor. */
export function resultCardView(item: TripSearchItem, fallbackDestination: string): ResultCardView {
  const seats = copy.seats(item.seatsAvailable);
  const from = copy.fromLabel(item.pickup.label ?? copy.fromUnknown);
  const extras: string[] = [];
  if (item.price.cents !== null && item.price.status === "defined") extras.push(copy.price(formatMoney(item.price)));
  if (item.return?.available === true && item.return.departsLocal !== null) extras.push(copy.returnAvailable(formatTime(item.return.departsLocal)));
  if (item.recurrence !== null && !item.recurrence.fullMatch && item.recurrence.matchedWeekdays.length > 0) {
    extras.push(copy.partialDays(formatWeekdays(item.recurrence.matchedWeekdays)));
  }
  return {
    tripId: item.tripId,
    driverName: item.driver.firstName,
    photoUrl: item.driver.photoUrl,
    rating: item.driver.ratingAverage !== null ? formatRating(item.driver.ratingAverage) : null,
    ratingCount: item.driver.ratingCount,
    seats,
    from,
    pickup: pickupText(item),
    to: fallbackDestination,
    arrive: copy.arriveApprox(formatTime(item.dropoff.arriveAtLocal)),
    extras,
    a11y: copy.cardA11y(item.driver.firstName, seats, from),
    dropoffStopSeq: item.dropoff.stopSeq,
  };
}

export function suggestionText(suggestion: SearchSuggestion | undefined): string {
  return suggestion?.message ?? copy.noMatchesFallback;
}
