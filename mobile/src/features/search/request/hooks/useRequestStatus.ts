/**
 * Estado de una solicitud (o de una reserva semanal) para la pantalla 16: la solicitud, la reserva semanal si la hay y,
 * solo cuando está aceptada, el contexto de pago. Sondea mientras haya algo que esperar (respuesta del conductor, pago) y
 * lleva la cuenta atrás de la reserva provisional en local a partir de los segundos que dijo el servidor — el servidor
 * sigue decidiendo cuándo caduca: al llegar a 0 se vuelve a preguntar.
 */
import { useEffect, useMemo, useState } from "react";
import type { RequestPaymentContext, RideRequestDetail, WeeklyReservation } from "@/api/types";
import { useApiQuery, type UseApiQueryResult } from "@/hooks";
import { fetchRequestPayment, fetchRideRequest, fetchWeeklyReservation } from "../api";
import { holdSecondsLeft } from "../logic/statusModel";
import { requestKeys } from "./keys";

const POLL_WAITING_MS = 6_000;
const POLL_PAYABLE_MS = 10_000;

export interface RequestStatusData {
  ride: UseApiQueryResult<RideRequestDetail>;
  weekly: UseApiQueryResult<WeeklyReservation>;
  context: UseApiQueryResult<RequestPaymentContext>;
  /** Segundos que quedan de la reserva provisional (null si no hay). */
  secondsLeft: number | null;
  refetchAll(): void;
}

const isPayable = (status: string | undefined): boolean => status === "accepted" || status === "payment_pending";

export function useRequestStatus(requestId: string, reservationId: string | undefined): RequestStatusData {
  const ride = useApiQuery(requestKeys.ride(requestId), ({ signal }) => fetchRideRequest(requestId, { signal }), {
    staleTimeMs: 5_000,
    refetchIntervalMs: POLL_WAITING_MS,
  });
  const weekly = useApiQuery(
    requestKeys.weekly(reservationId ?? ""),
    ({ signal }) => fetchWeeklyReservation(reservationId ?? "", { signal }),
    { enabled: reservationId !== undefined, staleTimeMs: 5_000, refetchIntervalMs: POLL_WAITING_MS },
  );
  const payable = isPayable(ride.data?.status);
  const context = useApiQuery(requestKeys.paymentContext(requestId), ({ signal }) => fetchRequestPayment(requestId, { signal }), {
    enabled: payable,
    staleTimeMs: 5_000,
    refetchIntervalMs: POLL_PAYABLE_MS,
  });

  const holdInfo = (reservationId !== undefined ? weekly.data?.hold : undefined) ?? ride.data?.hold ?? null;
  const received = Math.max(ride.updatedAt ?? 0, reservationId !== undefined ? (weekly.updatedAt ?? 0) : 0) || null;
  const remaining = holdInfo !== null && holdInfo.active ? holdInfo.remainingSeconds : null;

  const [now, setNow] = useState<number>(() => Date.now());
  const ticking = remaining !== null;
  useEffect(() => {
    if (!ticking) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);

  const secondsLeft = useMemo(() => holdSecondsLeft(remaining, received, now), [remaining, received, now]);

  // Al llegar a 0 la reserva ya caducó para el servidor: pedir el estado nuevo sin esperar al sondeo.
  const expired = secondsLeft === 0 && remaining !== null;
  useEffect(() => {
    if (!expired) return;
    void ride.refetch();
    if (reservationId !== undefined) void weekly.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired]);

  return {
    ride,
    weekly,
    context,
    secondsLeft,
    refetchAll: () => {
      void ride.refetch();
      if (reservationId !== undefined) void weekly.refetch();
      if (payable) void context.refetch();
    },
  };
}
