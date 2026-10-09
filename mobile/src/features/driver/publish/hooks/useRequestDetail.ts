import type { RideRequestDetail, WeeklyReservation } from "@/api/types";
import { fetchRideRequest, fetchWeeklyReservation } from "@/features/search/request/api";
import { useApiQuery, type UseApiQueryResult } from "@/hooks";
import { PUBLISH_ROOT } from "../keys";

/** Una solicitud suelta (`GET /v1/ride-requests/:id`; el conductor del viaje también puede leerla). */
export function useRideRequestDetail(requestId: string | undefined): UseApiQueryResult<RideRequestDetail> {
  return useApiQuery<RideRequestDetail>(
    [PUBLISH_ROOT, "request-detail", requestId ?? "none"],
    ({ signal }) => fetchRideRequest(requestId as string, { signal }),
    { enabled: requestId !== undefined, staleTimeMs: 5_000, refetchIntervalMs: 15_000 },
  );
}

/** Una reserva semanal (`GET /v1/weekly-reservations/:id`; el conductor de la serie también puede leerla). */
export function useWeeklyDetail(reservationId: string | undefined): UseApiQueryResult<WeeklyReservation> {
  return useApiQuery<WeeklyReservation>(
    [PUBLISH_ROOT, "weekly-detail", reservationId ?? "none"],
    ({ signal }) => fetchWeeklyReservation(reservationId as string, { signal }),
    { enabled: reservationId !== undefined, staleTimeMs: 5_000, refetchIntervalMs: 15_000 },
  );
}
