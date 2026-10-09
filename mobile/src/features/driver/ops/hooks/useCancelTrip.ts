import type { CancelBookingResponse, DriverCancelBookingRequest } from "@/api/types";
import { useApiMutation, type UseApiMutationResult } from "@/hooks";
import { cancelTrip, driverCancelBooking } from "../api";
import type { CancelTripBody, CancelTripResponse } from "../types";
import { refreshAfterTripChange } from "./useTripTransitions";

/** `POST /v1/me/trips/{id}/cancel` (propuesto). `Idempotency-Key` fija por intento: reintentar no cancela dos veces. */
export function useCancelTrip(tripId: string): UseApiMutationResult<CancelTripResponse, CancelTripBody> {
  return useApiMutation<CancelTripResponse, CancelTripBody>((body, { idempotencyKey, signal }) => cancelTrip(tripId, body, { idempotencyKey, signal }), {
    onSuccess: () => {
      void refreshAfterTripChange();
    },
  });
}

/** `POST /v1/bookings/{id}/driver-cancel`: cancelar UNA reserva como conductor. */
export function useDriverCancelBooking(bookingId: string): UseApiMutationResult<CancelBookingResponse, DriverCancelBookingRequest> {
  return useApiMutation<CancelBookingResponse, DriverCancelBookingRequest>(
    (body, { idempotencyKey, signal }) => driverCancelBooking(bookingId, body, { idempotencyKey, signal }),
    {
      onSuccess: () => {
        void refreshAfterTripChange();
      },
    },
  );
}
