import type { LiveRouteChange, LiveRespondRouteChangeBody } from "@/api/types";
import { useApiMutation, useApiQuery, type UseApiMutationResult, type UseApiQueryResult } from "@/hooks";
import { getRouteChange, respondRouteChange } from "../api";
import { liveKeys } from "./keys";

/** Propuesta de cambio de ruta (pantalla 22). Mientras esté pendiente se refresca cada 10 s (puede caducar o retirarse). */
export function useRouteChange(proposalId: string): UseApiQueryResult<LiveRouteChange> {
  return useApiQuery<LiveRouteChange>(liveKeys.routeChange(proposalId), ({ signal }) => getRouteChange(proposalId, { signal }), {
    staleTimeMs: 5_000,
    refetchIntervalMs: 10_000,
  });
}

/** `POST /v1/route-changes/{id}/respond` con `Idempotency-Key`. Tras responder se refrescan la propuesta y el estado en directo. */
export function useRespondRouteChange(proposalId: string): UseApiMutationResult<LiveRouteChange, LiveRespondRouteChangeBody> {
  return useApiMutation<LiveRouteChange, LiveRespondRouteChangeBody>(
    (body, { idempotencyKey, signal }) => respondRouteChange(proposalId, body, { idempotencyKey, signal }),
    { invalidates: [liveKeys.all] },
  );
}
