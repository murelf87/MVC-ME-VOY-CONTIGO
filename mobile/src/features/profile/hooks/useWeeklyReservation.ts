/**
 * Reserva semanal: lectura y retirada de las solicitudes que siguen pendientes.
 */
import type { WeeklyReservation } from "@/api/types";
import { queryCache, useApiMutation, useApiQuery, type UseApiMutationResult, type UseApiQueryResult } from "@/hooks";
import { getWeeklyReservation, withdrawWeeklyReservation } from "../api";
import { REQUEST_DETAILS, TRIPS_OVERVIEW, WEEKLY_RESERVATIONS, weeklyReservationKey } from "./keys";

/** Se refresca cada 20 s: las respuestas del conductor llegan día a día. */
export function useWeeklyReservation(reservationId: string | undefined): UseApiQueryResult<WeeklyReservation> {
  const id = reservationId ?? "";
  return useApiQuery<WeeklyReservation>(weeklyReservationKey(id), ({ signal }) => getWeeklyReservation(id, { signal }), {
    enabled: id !== "",
    staleTimeMs: 10_000,
    refetchIntervalMs: 20_000,
  });
}

/** Retira los días que aún esperan respuesta; los ya aceptados o confirmados no se tocan. */
export function useWithdrawWeekly(): UseApiMutationResult<WeeklyReservation, string> {
  return useApiMutation<WeeklyReservation, string>(
    (reservationId, { idempotencyKey, signal }) => withdrawWeeklyReservation(reservationId, { idempotencyKey, signal }),
    {
      onSuccess: (reservation) => {
        queryCache.setData<WeeklyReservation>(weeklyReservationKey(reservation.id), reservation);
      },
      invalidates: [TRIPS_OVERVIEW, REQUEST_DETAILS, WEEKLY_RESERVATIONS],
    },
  );
}
