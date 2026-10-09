/**
 * Enviar la solicitud de plaza (un trayecto) o la reserva semanal (una solicitud por día). `Idempotency-Key` estable por
 * intento: si el envío falla sin saber si llegó (sin red a mitad, tiempo agotado, 5xx), reintentar con los mismos datos
 * reutiliza la clave y el servidor devuelve la solicitud ya creada en lugar de duplicarla. Doble toque: misma petición.
 */
import type { CreateRideRequestBody, RideRequestDetail, WeeklyRequestBody, WeeklyReservation } from "@/api/types";
import { useApiMutation, type UseApiMutationResult } from "@/hooks";
import { postRideRequest, postWeeklyRequest } from "../api";
import { AFFECTED_ELSEWHERE, REQUEST_ALL } from "./keys";

export type SendVars =
  | { kind: "single"; tripId: string; body: CreateRideRequestBody }
  | { kind: "weekly"; tripId: string; body: WeeklyRequestBody };

export type SentRequest = { kind: "single"; request: RideRequestDetail } | { kind: "weekly"; reservation: WeeklyReservation };

export function useSendRequest(): UseApiMutationResult<SentRequest, SendVars> {
  return useApiMutation<SentRequest, SendVars>(
    async (vars, { idempotencyKey, signal }) => {
      if (vars.kind === "single") {
        return { kind: "single", request: await postRideRequest(vars.tripId, vars.body, { idempotencyKey, signal }) };
      }
      return { kind: "weekly", reservation: await postWeeklyRequest(vars.tripId, vars.body, { idempotencyKey, signal }) };
    },
    { invalidates: [REQUEST_ALL, ...AFFECTED_ELSEWHERE] },
  );
}
