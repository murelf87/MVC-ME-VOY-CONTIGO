import type { LiveCreateIncidentBody, LiveIncidentReport, Page } from "@/api/types";
import { queryCache, useApiMutation, useApiQuery, type UseApiMutationResult, type UseApiQueryResult } from "@/hooks";
import { createIncident, getMyIncident, listMyIncidents } from "../api";
import { liveKeys } from "./keys";

/** `POST /v1/incident-reports` con `Idempotency-Key`: reintentar no crea dos incidencias. */
export function useCreateIncident(): UseApiMutationResult<LiveIncidentReport, LiveCreateIncidentBody> {
  return useApiMutation<LiveIncidentReport, LiveCreateIncidentBody>((body, { idempotencyKey, signal }) => createIncident(body, { idempotencyKey, signal }), {
    invalidates: [liveKeys.incidents, liveKeys.all],
  });
}

/** Mis incidencias (más recientes primero). */
export function useMyIncidents(): UseApiQueryResult<Page<LiveIncidentReport>> {
  return useApiQuery<Page<LiveIncidentReport>>(liveKeys.incidents, ({ signal }) => listMyIncidents({ limit: 50 }, { signal }), { staleTimeMs: 10_000 });
}

/** Una incidencia mía. Se refresca cada 30 s (el equipo puede cambiar su estado). */
export function useMyIncident(reportId: string): UseApiQueryResult<LiveIncidentReport> {
  return useApiQuery<LiveIncidentReport>(liveKeys.incident(reportId), ({ signal }) => getMyIncident(reportId, { signal }), { staleTimeMs: 10_000, refetchIntervalMs: 30_000 });
}

export function refreshIncidents(): Promise<void> {
  return queryCache.invalidate(liveKeys.incidents);
}
