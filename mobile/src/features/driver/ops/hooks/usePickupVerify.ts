import { useCallback, useMemo } from "react";
import type { LivePickupVerified } from "@/api/types";
import { queryCache, useApiMutation } from "@/hooks";
import { verifyPickupCode } from "../api";
import { opsKeys } from "../keys";
import type { OpsErrorView } from "../logic/errors";
import { describeOps } from "./describe";

/** Errores tras los que la consola cambió (intentos gastados, código bloqueado, viaje o reserva ya no válidos): se vuelve a pedir. */
const REFRESH_CONSOLE_ON: ReadonlySet<string> = new Set([
  "PICKUP_CODE_INVALID",
  "PICKUP_ATTEMPTS_EXCEEDED",
  "PICKUP_CODE_NOT_GENERATED",
  "TRIP_NOT_LIVE",
  "BOOKING_NOT_PICKUP_ELIGIBLE",
  "BOOKING_NOT_FOUND",
]);

export interface PickupVerifyState {
  verify(code: string): Promise<LivePickupVerified | undefined>;
  result: LivePickupVerified | undefined;
  isPending: boolean;
  isOffline: boolean;
  error: OpsErrorView | null;
  reset(): void;
}

/**
 * Verificación del código de recogida (`POST /v1/bookings/{id}/pickup-verify`). Un código equivocado NO se reintenta solo
 * (gastaría intentos del pasajero). Tras un acierto o un fallo con intentos se refresca la consola: el servidor es quien
 * dice si la recogida quedó verificada o el código se bloqueó.
 */
export function usePickupVerify(tripId: string, bookingId: string): PickupVerifyState {
  const mutation = useApiMutation<LivePickupVerified, string>((code, { signal }) => verifyPickupCode(bookingId, code, { signal }), {
    onSuccess: () => {
      void queryCache.invalidate(opsKeys.console(tripId));
    },
    onError: (error) => {
      const view = describeOps(error);
      if (view.code !== null && REFRESH_CONSOLE_ON.has(view.code)) void queryCache.invalidate(opsKeys.console(tripId));
    },
  });
  const { mutate, reset } = mutation;
  const verify = useCallback((code: string) => mutate(code), [mutate]);
  const error = useMemo(() => (mutation.error ? describeOps(mutation.error) : null), [mutation.error]);
  return { verify, result: mutation.data, isPending: mutation.isPending, isOffline: mutation.isOffline, error, reset };
}
