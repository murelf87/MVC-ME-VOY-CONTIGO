/**
 * Puntos de recogida propuestos (A, B) para un origen (`GET /v1/trips/:tripId/pickup-points`, requiere sesión). Sin
 * origen o sin sesión la consulta no se lanza: la pantalla pide el origen o invita a crear la cuenta.
 */
import type { PickupPointsResponse } from "@/api/types";
import { useApiQuery, type UseApiQueryResult } from "@/hooks";
import { fetchPickupPoints } from "../api";
import { MAX_PROPOSALS } from "../logic/pickup";
import { requestKeys } from "./keys";

export interface PickupOrigin {
  lat: number;
  lng: number;
}

export function usePickupPoints(
  tripId: string,
  origin: PickupOrigin | null,
  dropoffStopSeq: number | null,
  enabled: boolean,
): UseApiQueryResult<PickupPointsResponse> {
  const point = origin ?? { lat: 0, lng: 0 };
  return useApiQuery(
    requestKeys.pickups(tripId, point.lat, point.lng, dropoffStopSeq),
    ({ signal }) =>
      fetchPickupPoints(
        tripId,
        { lat: point.lat, lng: point.lng, limit: MAX_PROPOSALS, ...(dropoffStopSeq !== null ? { dropoffStopSeq } : {}) },
        { signal },
      ),
    { enabled: enabled && origin !== null, staleTimeMs: 30_000, keepPreviousData: true },
  );
}
