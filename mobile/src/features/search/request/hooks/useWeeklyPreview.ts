/**
 * Vista previa de la reserva semanal (`POST /v1/trips/:tripId/weekly-requests/preview`): qué días y trayectos tienen plaza
 * ANTES de crear nada. Una consulta por cuerpo distinto (cualquier cambio de días, inicio, semanas o excepciones).
 */
import type { WeeklyRequestBody, WeeklyRequestPreview } from "@/api/types";
import { useApiQuery, type UseApiQueryResult } from "@/hooks";
import { postWeeklyPreview } from "../api";
import { previewKey } from "../logic/weekly";

export function useWeeklyPreview(tripId: string, body: WeeklyRequestBody | null, enabled = true): UseApiQueryResult<WeeklyRequestPreview> {
  return useApiQuery(
    body === null ? ["request", "weekly-preview", tripId, "none"] : previewKey(tripId, body),
    ({ signal }) => (body === null ? Promise.reject(new Error("sin cuerpo")) : postWeeklyPreview(tripId, body, { signal })),
    { enabled: enabled && body !== null, staleTimeMs: 10_000, keepPreviousData: true },
  );
}
