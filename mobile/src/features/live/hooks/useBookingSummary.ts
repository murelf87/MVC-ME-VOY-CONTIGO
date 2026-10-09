import type { LiveBookingSummary } from "@/api/types";
import { useApiQuery, type UseApiQueryResult } from "@/hooks";
import { getBookingSummary } from "../api";
import { liveKeys } from "./keys";

/** Resumen del viaje (pantalla 24). No sondea: lo único que cambia es lo que hace la propia persona (valorar, reportar). */
export function useBookingSummary(bookingId: string): UseApiQueryResult<LiveBookingSummary> {
  return useApiQuery<LiveBookingSummary>(liveKeys.summary(bookingId), ({ signal }) => getBookingSummary(bookingId, { signal }), {
    staleTimeMs: 15_000,
  });
}
