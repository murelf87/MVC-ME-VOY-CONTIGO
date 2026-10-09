import type { LiveTripCompleted, LiveTripStarted } from "@/api/types";
import { queryCache, useApiMutation, type UseApiMutationResult } from "@/hooks";
import { completeTrip, startTrip } from "../api";

/**
 * Tras iniciar, terminar o cancelar un viaje cambian la consola, el detalle y TODAS las listas de viajes de la app
 * (Mis viajes, solicitudes, mapa…): se marcan como obsoletas y se refrescan las que están a la vista.
 */
export function refreshAfterTripChange(): Promise<void> {
  return queryCache.invalidate();
}

/** `POST /v1/me/trips/{id}/start`. El servidor comprueba el vehículo (foto, seguro…) y el estado del viaje. */
export function useStartTrip(tripId: string): UseApiMutationResult<LiveTripStarted, void> {
  return useApiMutation<LiveTripStarted, void>((_, { signal }) => startTrip(tripId, { signal }), {
    onSuccess: () => {
      void refreshAfterTripChange();
    },
  });
}

/** `POST /v1/me/trips/{id}/complete`. Recogidos → completados; sin recoger → no presentados (lo decide el servidor). */
export function useCompleteTrip(tripId: string): UseApiMutationResult<LiveTripCompleted, void> {
  return useApiMutation<LiveTripCompleted, void>((_, { signal }) => completeTrip(tripId, { signal }), {
    onSuccess: () => {
      void refreshAfterTripChange();
    },
  });
}
