/**
 * Datos de «Mis viajes»: el resumen (contadores, próximos y en curso) y el historial paginado de cada rol.
 */
import type { OverviewCard, Role, TripsOverview } from "@/api/types";
import { useApiQuery, usePaginatedQuery, type UseApiQueryResult, type UsePaginatedQueryResult } from "@/hooks";
import { getTripsOverview } from "../api";
import { tripsHistoryKey, tripsOverviewKey } from "./keys";

/** Tamaño de página del historial. */
export const HISTORY_PAGE_SIZE = 20;

/** Clave estable de una tarjeta (una reserva semanal y un viaje pueden compartir el mismo id numérico en el servidor). */
export function overviewCardKey(card: OverviewCard): string {
  return card.kind === "trip" ? `trip:${card.id}:${card.leg}` : `weekly:${card.id}`;
}

/**
 * Próximos y en curso del rol indicado. Se revalida cada 30 s mientras la pantalla está a la vista (la llegada del
 * conductor y «En 12 min» cambian con el tiempo) y al volver a ella.
 */
export function useTripsOverview(role: Role, enabled = true): UseApiQueryResult<TripsOverview> {
  return useApiQuery<TripsOverview>(tripsOverviewKey(role), ({ signal }) => getTripsOverview({ role, section: "all" }, { signal }), {
    enabled,
    staleTimeMs: 10_000,
    refetchIntervalMs: 30_000,
  });
}

/** Historial del rol indicado (solo se pide cuando se abre la pestaña). */
export function useTripsHistory(role: Role, enabled: boolean): UsePaginatedQueryResult<OverviewCard> {
  return usePaginatedQuery<OverviewCard>(
    tripsHistoryKey(role),
    async ({ cursor, signal }) => {
      const overview = await getTripsOverview(
        cursor === null ? { role, section: "history", limit: HISTORY_PAGE_SIZE } : { role, section: "history", cursor, limit: HISTORY_PAGE_SIZE },
        { signal },
      );
      return overview.history;
    },
    { enabled, staleTimeMs: 10_000, getItemId: overviewCardKey },
  );
}
