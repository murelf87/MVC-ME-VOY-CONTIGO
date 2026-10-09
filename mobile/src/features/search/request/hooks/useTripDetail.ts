/** Detalle del viaje (cabecera, ruta, paradas, recurrencia y si se puede pedir plaza). `GET /v1/trips/:tripId`. */
import type { TripDetail } from "@/api/types";
import { useApiQuery, type UseApiQueryResult } from "@/hooks";
import { fetchTrip } from "../api";
import { requestKeys } from "./keys";

export function useTripDetail(tripId: string): UseApiQueryResult<TripDetail> {
  return useApiQuery(requestKeys.trip(tripId), ({ signal }) => fetchTrip(tripId, {}, { signal }), { staleTimeMs: 20_000 });
}
