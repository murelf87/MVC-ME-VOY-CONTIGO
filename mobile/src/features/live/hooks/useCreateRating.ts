import type { LiveCreateRatingBody, LiveRating } from "@/api/types";
import { useApiMutation, type UseApiMutationResult } from "@/hooks";
import { createRating } from "../api";
import { liveKeys } from "./keys";

/** `POST /v1/trips/{tripId}/ratings` con `Idempotency-Key`: valorar dos veces el mismo viaje no crea dos valoraciones. */
export function useCreateRating(tripId: string): UseApiMutationResult<LiveRating, LiveCreateRatingBody> {
  return useApiMutation<LiveRating, LiveCreateRatingBody>((body, { idempotencyKey, signal }) => createRating(tripId, body, { idempotencyKey, signal }), {
    invalidates: [liveKeys.all],
  });
}
