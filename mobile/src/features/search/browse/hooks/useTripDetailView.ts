/** Detalle de un viaje con el contexto de búsqueda (marca «Tú te subes aquí»). `GET /v1/trips/:tripId`, sesión opcional. */
import type { TripDetail } from "@/api/types";
import { useApiQuery, type UseApiQueryResult } from "@/hooks";
import type { SearchCriteriaParam } from "../../routes";
import { getTripDetail } from "../api";

export function useTripDetailView(tripId: string, criteria: SearchCriteriaParam | undefined, dropoffStopSeq: number | undefined): UseApiQueryResult<TripDetail> {
  const lat = criteria?.origin.latitude;
  const lng = criteria?.origin.longitude;
  return useApiQuery<TripDetail>(
    ["trips", "detail", tripId, lat ?? null, lng ?? null, dropoffStopSeq ?? null],
    ({ signal }) =>
      getTripDetail(
        tripId,
        { ...(lat !== undefined && lng !== undefined ? { pickupLat: lat, pickupLng: lng } : {}), ...(dropoffStopSeq !== undefined ? { dropoffStopSeq } : {}) },
        { signal },
      ),
    { staleTimeMs: 20_000 },
  );
}
