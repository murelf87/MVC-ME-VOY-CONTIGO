/**
 * Coches de la provincia para el mapa de inicio (`GET /v1/trips/map`, sesión opcional: un invitado también los ve).
 *
 *  - Se pide con la provincia activa y el filtro (plazas, franja de salida, categoría); cambiar el filtro NO borra los
 *    coches de antes hasta que llegan los nuevos (el mapa no parpadea), salvo que la petición nueva falle.
 *  - Se refresca cada 30 s mientras la pantalla está a la vista, al volver a ella y al recuperar la red.
 *  - Las posiciones llegan SIEMPRE aproximadas desde el servidor y aquí no se afinan.
 */
import { useMemo } from "react";
import type { MapCar, MapCarsResponse } from "@/api/types";
import { useApiQuery } from "@/hooks";
import { getMapCars } from "../api";
import { toMapQuery, type MapFilter } from "../logic/mapCars";

const POLL_MS = 30_000;
const STALE_MS = 15_000;

export interface UseMapCarsResult {
  cars: readonly MapCar[];
  data: MapCarsResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  isOffline: boolean;
  failedToRefresh: boolean;
  error: Error | null;
  /** `true` mientras se piden coches nuevos con un filtro distinto (se siguen viendo los anteriores). */
  isPreviousData: boolean;
  refetch(): void;
}

const NO_CARS: readonly MapCar[] = [];

export function useMapCars(provinceId: string | null, filter: MapFilter): UseMapCarsResult {
  const query = useApiQuery<MapCarsResponse>(
    ["trips", "map", provinceId, filter.onlyWithSeats, filter.withinHours, filter.category],
    ({ signal }) => getMapCars(toMapQuery(provinceId ?? "", filter), { signal }),
    {
      enabled: provinceId !== null,
      staleTimeMs: STALE_MS,
      refetchIntervalMs: POLL_MS,
      keepPreviousData: true,
    },
  );
  // Si el filtro nuevo falla, los coches del filtro anterior NO se presentan como si cumplieran el nuevo.
  const data = query.isPreviousData && query.error !== null ? undefined : query.data;
  const cars = useMemo<readonly MapCar[]>(() => data?.cars ?? NO_CARS, [data]);
  return {
    cars,
    data,
    isLoading: query.isLoading,
    isError: query.isError,
    isOffline: query.isOffline,
    failedToRefresh: query.failedToRefresh,
    error: query.error,
    isPreviousData: query.isPreviousData,
    refetch: () => void query.refetch(),
  };
}
