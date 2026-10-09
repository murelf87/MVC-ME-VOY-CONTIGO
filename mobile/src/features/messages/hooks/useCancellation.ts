import type { RefundView, CancelBookingRequest, CancelBookingResponse, CancellationPreview } from "@/api/types";
import { queryCache, useApiMutation, useApiQuery, type UseApiMutationResult, type UseApiQueryResult } from "@/hooks";
import { cancelBooking, getCancellationPreview, listMyRefunds } from "../api";
import { CONVERSATIONS, cancelResultKey, NOTIFICATIONS, UNREAD_MESSAGES_KEY, UNREAD_NOTIFICATIONS_KEY, cancellationPreviewKey } from "./keys";

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

/** Lo que enseña «Reserva cancelada»: la respuesta del servidor y el nombre de quien conduce (para el texto). */
export interface CancelOutcome {
  response: CancelBookingResponse;
  driverName: string | null;
}

/** Guarda el resultado justo tras cancelar para que la pantalla siguiente lo pinte sin otra petición. */
export function rememberCancelOutcome(bookingId: string, outcome: CancelOutcome): void {
  queryCache.setData<CancelOutcome>(cancelResultKey(bookingId), outcome);
}

/**
 * Resultado de cancelar. Si venimos de la pantalla anterior ya está en caché; si se abre en frío (enlace, recarga) se
 * reconstruye desde `GET /v1/me/refunds`: la devolución de esa reserva, o `null` si no había nada pagado.
 */
export function useCancelOutcome(bookingId: string): UseApiQueryResult<CancelOutcome> {
  return useApiQuery<CancelOutcome>(
    cancelResultKey(bookingId),
    async ({ signal }) => {
      const page = await listMyRefunds({ limit: 50 }, { signal });
      const refund: RefundView | null = page.items.find((r) => r.bookingId === bookingId) ?? null;
      return { response: { booking: { id: bookingId, status: "cancelled" }, refund, alreadyCancelled: true }, driverName: null };
    },
    { staleTimeMs: 60_000 },
  );
}
