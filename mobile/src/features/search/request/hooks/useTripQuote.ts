/**
 * Presupuesto de UN trayecto con el punto de recogida elegido (`POST /v1/trips/:tripId/quote`, sin efectos): punto de
 * recogida, destino, distancia y aportación. Todo importe lo calcula el servidor.
 */
import type { TripQuoteResponse } from "@/api/types";
import { useApiQuery, type UseApiQueryResult } from "@/hooks";
import { fetchQuote } from "../api";
import { requestKeys } from "./keys";

export function useTripQuote(tripId: string, pickupPointId: string, dropoffStopSeq: number | null, enabled = true): UseApiQueryResult<TripQuoteResponse> {
  return useApiQuery(
    requestKeys.quote(tripId, pickupPointId, dropoffStopSeq),
    ({ signal }) => fetchQuote(tripId, { pickupPointId, ...(dropoffStopSeq !== null ? { dropoffStopSeq } : {}) }, { signal }),
    { enabled, staleTimeMs: 15_000 },
  );
}
