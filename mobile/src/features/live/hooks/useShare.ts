import type { LiveShareCreateBody, LiveShareCreated, LiveSharedTrip } from "@/api/types";
import { useApiMutation, useApiQuery, type UseApiMutationResult, type UseApiQueryResult } from "@/hooks";
import { createShare, getShare, getSharedTrip, revokeShare, type ShareStatus } from "../api";
import { liveKeys } from "./keys";

/** Enlace activo de esta reserva (sin el token: solo se ve al crearlo). */
export function useShareStatus(bookingId: string): UseApiQueryResult<ShareStatus> {
  return useApiQuery<ShareStatus>(liveKeys.share(bookingId), ({ signal }) => getShare(bookingId, { signal }), { staleTimeMs: 10_000 });
}

/** `POST /v1/bookings/{id}/share`: crear otro enlace revoca el anterior. */
export function useCreateShare(bookingId: string): UseApiMutationResult<LiveShareCreated, LiveShareCreateBody> {
  return useApiMutation<LiveShareCreated, LiveShareCreateBody>((body, { signal }) => createShare(bookingId, body, { signal }), {
    invalidates: [liveKeys.share(bookingId), liveKeys.inCar(bookingId)],
  });
}

/** `DELETE /v1/bookings/{id}/share` (idempotente). */
export function useRevokeShare(bookingId: string): UseApiMutationResult<void, void> {
  return useApiMutation<void, void>((_, { signal }) => revokeShare(bookingId, { signal }), { invalidates: [liveKeys.share(bookingId), liveKeys.inCar(bookingId)] });
}

/** Vista pública del enlace (sin sesión). Se refresca cada 15 s. */
export function useSharedTrip(token: string): UseApiQueryResult<LiveSharedTrip> {
  return useApiQuery<LiveSharedTrip>(liveKeys.sharedTrip(token), ({ signal }) => getSharedTrip(token, { signal }), { staleTimeMs: 5_000, refetchIntervalMs: 15_000 });
}
