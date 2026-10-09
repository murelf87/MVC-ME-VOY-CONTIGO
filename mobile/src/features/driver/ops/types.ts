/**
 * Tipos propios del paquete `driver-ops` (operar el viaje como conductor).
 *
 * Los contratos de `live` y `money` viven en `@/api/types` y NO se copian aquí. Este fichero solo declara lo que ese
 * contrato no tiene: las llamadas con `Idempotency-Key` y la cancelación de un viaje ENTERO, que el backend real aún no
 * ofrece (ver `api.ts` → `cancelTrip`). Cuando exista, estos tipos pasarán a `docs/contracts/` y a `@/api/types`.
 */
import type { CallOptions } from "@/api";
import type { DriverCancellationReason, IsoDateTime, PublicUser, RefundView, Uuid } from "@/api/types";

/** Opciones de las llamadas que CREAN o CAMBIAN cosas: llevan `Idempotency-Key` (se reutiliza al reintentar). */
export type OpsCallOptions = CallOptions & { idempotencyKey?: string };

/** Motivos para cancelar (mismo vocabulario que `driver-cancel` de `money`, docs/contracts/money.md §8.3). */
export type TripCancellationReason = DriverCancellationReason;

/** `POST /v1/me/trips/{tripId}/cancel` — PROPUESTO (no existe en el backend real). `Idempotency-Key` obligatoria. */
export interface CancelTripBody {
  reason: TripCancellationReason;
  /** Opcional, máx. 500 caracteres. Lo ve el pasajero en el aviso. */
  note?: string;
}

/** Qué ha pasado con cada reserva confirmada al cancelar el viaje. */
export interface CancelTripBookingEffect {
  bookingId: Uuid;
  passenger: PublicUser;
  status: "driver_cancelled";
  /**
   * Propuesta de devolución que abre el servidor (siempre `pending_review`: las consecuencias de la cancelación del
   * conductor NO están definidas). `null` si la reserva no tenía nada pagado.
   */
  refund: RefundView | null;
}

export interface CancelTripResponse {
  trip: { id: Uuid; status: "cancelled"; cancelledAt: IsoDateTime };
  /** Reservas confirmadas que han pasado a `driver_cancelled`. */
  bookings: CancelTripBookingEffect[];
  /** Solicitudes pendientes o aceptadas sin pago que se han cerrado (el pasajero recibe un aviso). */
  closedRequests: number;
  /** `true` si el viaje ya estaba cancelado (reintento): se devuelve el resultado previo. */
  alreadyCancelled: boolean;
}

/** Resultado de intentar enviar la ubicación del conductor (estado visible en la consola). */
export type LocationSendState = "idle" | "sending" | "ok" | "retrying";

/** Una posición ya lista para enviar a `POST /v1/trips/{id}/location`. */
export interface DriverFix {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  /** Instante de la medición (ms desde 1970). */
  recordedAtMs: number;
  speedMps: number | null;
  headingDegrees: number | null;
}
