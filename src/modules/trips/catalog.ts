import type { TripCategory, TripCategoryInfo } from "./types.js";

/** Categorías de viaje (pantallas 09, 10 y 18). El orden es el de las pantallas. */
export const TRIP_CATEGORIES: readonly TripCategoryInfo[] = [
  { id: "work", label: "Trabajo" },
  { id: "university", label: "Universidad" },
  { id: "fp_academies", label: "FP" },
  { id: "hospital", label: "Hospital" },
  { id: "sport", label: "Deporte" },
  { id: "other", label: "Otros" }
];

export function categoryLabel(category: TripCategory): string {
  return TRIP_CATEGORIES.find(item => item.id === category)?.label ?? "Otros";
}
