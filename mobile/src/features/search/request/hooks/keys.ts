/**
 * Claves de la caché de consultas del paquete «solicitar plaza y pagar». Todas cuelgan de `["request", …]`: un prefijo
 * invalida todo lo que cuelga de él.
 *
 * `AFFECTED_ELSEWHERE` son los prefijos de OTROS paquetes que cambian cuando se envía, se retira o se paga una solicitud
 * («Mis viajes», el detalle de la reserva y «Mis pagos»): se invalidan aquí para que se vean al volver a ellos. Reflejan
 * las claves `profile/hooks/keys.ts` y `account/money/hooks/keys.ts`; si cambian, lo único que se pierde es el refresco
 * inmediato (los datos siguen caducando solos).
 */
export const REQUEST_ALL = ["request"] as const;

export const requestKeys = {
  trip: (tripId: string): readonly unknown[] => ["request", "trip", tripId],
  quote: (tripId: string, pickupPointId: string, dropoffStopSeq: number | null): readonly unknown[] => [
    "request",
    "quote",
    tripId,
    pickupPointId,
    dropoffStopSeq,
  ],
  pickups: (tripId: string, lat: number, lng: number, dropoffStopSeq: number | null): readonly unknown[] => [
    "request",
    "pickups",
    tripId,
    Math.round(lat * 100_000),
    Math.round(lng * 100_000),
    dropoffStopSeq,
  ],
  ride: (requestId: string): readonly unknown[] => ["request", "ride", requestId],
  weekly: (reservationId: string): readonly unknown[] => ["request", "weekly", reservationId],
  paymentContext: (requestId: string): readonly unknown[] => ["request", "payment-context", requestId],
  payment: (paymentId: string): readonly unknown[] => ["request", "payment", paymentId],
};

export const AFFECTED_ELSEWHERE: readonly (readonly unknown[])[] = [
  ["profile", "trips-overview"],
  ["profile", "request"],
  ["profile", "weekly-reservation"],
  ["money"],
];
