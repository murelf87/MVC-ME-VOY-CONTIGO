import type { CancelBookingRequest, CancelBookingResponse, CancellationPreview } from "@/api/types";
import { useApiMutation, useApiQuery, type UseApiMutationResult, type UseApiQueryResult } from "@/hooks";
import { cancelBooking, getCancellationPreview } from "../api";
import { CONVERSATIONS, NOTIFICATIONS, UNREAD_MESSAGES_KEY, UNREAD_NOTIFICATIONS_KEY, cancellationPreviewKey } from "./keys";

/** `GET /v1/bookings/{id}/cancellation-preview` (pantalla 28). */
export function useCancellationPreview(bookingId: string): UseApiQueryResult<CancellationPreview> {
  return useApiQuery<CancellationPreview>(cancellationPreviewKey(bookingId), ({ signal }) => getCancellationPreview(bookingId, { signal }), { staleTimeMs: 10_000 });
}

/** `POST /v1/bookings/{id}/cancel` con `Idempotency-Key`: reintentar no cancela dos veces ni abre dos devoluciones. */
export function useCancelBooking(bookingId: string): UseApiMutationResult<CancelBookingResponse, CancelBookingRequest> {
  return useApiMutation<CancelBookingResponse, CancelBookingRequest>(
    (body, { idempotencyKey, signal }) => cancelBooking(bookingId, body, { idempotencyKey, signal }),
    { invalidates: [cancellationPreviewKey(bookingId), CONVERSATIONS, UNREAD_MESSAGES_KEY, NOTIFICATIONS, UNREAD_NOTIFICATIONS_KEY, ["my-trips"], ["live"], ["bookings"]] },
  );
}
