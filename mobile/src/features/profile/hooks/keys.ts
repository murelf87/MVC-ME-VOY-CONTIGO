/**
 * Claves de la caché de consultas del slice `profile`. Un prefijo invalida todo lo que cuelga de él:
 * `queryCache.invalidate(TRIPS_OVERVIEW)` refresca «Mis viajes» (próximos, en curso e historial) de los dos roles.
 */
import type { Role } from "@/api/types";

/** Prefijo de «Mis viajes» (resumen y listas del historial). */
export const TRIPS_OVERVIEW = ["profile", "trips-overview"] as const;

export function tripsOverviewKey(role: Role): readonly unknown[] {
  return ["profile", "trips-overview", role];
}

export function tripsHistoryKey(role: Role): readonly unknown[] {
  return ["profile", "trips-overview", role, "history"];
}

export const FAVORITES = ["profile", "favorites"] as const;
export const ROUTINE = ["profile", "routine"] as const;

export const PLANS = ["profile", "plans"] as const;
export const MY_PLAN = ["profile", "my-plan"] as const;

export const VERIFICATION = ["profile", "verification"] as const;
export const PROVINCES = ["profile", "provinces"] as const;

/** Detalle de una solicitud de plaza (BookingDetail). */
export function requestDetailKey(requestId: string): readonly unknown[] {
  return ["profile", "request", requestId];
}

/** Detalle de una reserva semanal. */
export function weeklyReservationKey(reservationId: string): readonly unknown[] {
  return ["profile", "weekly-reservation", reservationId];
}

/** Prefijos que cambian cuando la persona retira o cancela algo: «Mis viajes», sus detalles y la rutina. */
export const REQUEST_DETAILS = ["profile", "request"] as const;
export const WEEKLY_RESERVATIONS = ["profile", "weekly-reservation"] as const;
