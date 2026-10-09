import type { TripDetail } from "@/api/types";
import { useApiQuery, type UseApiQueryResult } from "@/hooks";
import { getTripDetail } from "../api";
import { opsKeys } from "../keys";
import type { LngLat } from "../logic/geo";

/** Detalle del viaje visto por su conductor: ruta, paradas, plazas y solicitudes pendientes. Complementa la consola. */
export function useTripDetail(tripId: string, enabled = true): UseApiQueryResult<TripDetail> {
  return useApiQuery<TripDetail>(opsKeys.tripDetail(tripId), ({ signal }) => getTripDetail(tripId, { signal }), {
    enabled,
    staleTimeMs: 60_000,
  });
}

/** Geometría de la ruta como `[lng, lat][]` (vacía si aún no ha llegado el detalle). */
export function routeOf(detail: TripDetail | undefined): LngLat[] {
  const coordinates = detail?.route.geometry.coordinates;
  return coordinates ? coordinates.map((c): LngLat => [c[0], c[1]]) : [];
}
