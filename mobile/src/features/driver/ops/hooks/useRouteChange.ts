import type { LiveCreateRouteChangeBody, LiveRouteChange } from "@/api/types";
import { useApiMutation, useApiQuery, type UseApiMutationResult, type UseApiQueryResult } from "@/hooks";
import { cancelRouteChange, createRouteChange, getRouteChange } from "../api";
import { opsKeys } from "../keys";
import { refreshAfterTripChange } from "./useTripTransitions";

/** Vista de una propuesta (el conductor ve quién ha respondido). Se refresca cada 15 s mientras esté pendiente. */
export function useRouteChangeView(id: string | null): UseApiQueryResult<LiveRouteChange> {
  return useApiQuery<LiveRouteChange>(opsKeys.routeChange(id ?? "none"), ({ signal }) => getRouteChange(id ?? "", { signal }), {
    enabled: id !== null,
    staleTimeMs: 5_000,
    refetchIntervalMs: 15_000,
  });
}

/** `POST /v1/trips/{id}/route-changes` con `Idempotency-Key`. */
export function useProposeRouteChange(tripId: string): UseApiMutationResult<LiveRouteChange, LiveCreateRouteChangeBody> {
  return useApiMutation<LiveRouteChange, LiveCreateRouteChangeBody>(
    (body, { idempotencyKey, signal }) => createRouteChange(tripId, body, { idempotencyKey, signal }),
    {
      onSuccess: () => {
        void refreshAfterTripChange();
      },
    },
  );
}

/** `POST /v1/route-changes/{id}/cancel`. */
export function useWithdrawRouteChange(id: string): UseApiMutationResult<LiveRouteChange, void> {
  return useApiMutation<LiveRouteChange, void>((_, { signal }) => cancelRouteChange(id, { signal }), {
    onSuccess: () => {
      void refreshAfterTripChange();
    },
  });
}
