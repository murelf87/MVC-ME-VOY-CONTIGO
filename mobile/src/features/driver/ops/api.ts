/**
 * Cliente de red del paquete `driver-ops` (operar el viaje como conductor). Contratos: docs/contracts/live.md §2, §4.1,
 * §4.4, §7, §9, §11 y docs/contracts/money.md §8.3; tipos en `@/api/types`.
 *
 *   GET  /v1/me/trips/{tripId}/console           → LiveConsole                      (conductor del viaje)
 *   POST /v1/me/trips/{tripId}/start             → LiveTripStarted                  (núcleo; exige vehículo en regla)
 *   POST /v1/me/trips/{tripId}/complete          → LiveTripCompleted                (núcleo)
 *   POST /v1/bookings/{bookingId}/pickup-verify  → LivePickupVerified               (núcleo; código de 6 cifras)
 *   POST /v1/trips/{tripId}/location             → LivePostLocationResult           (núcleo; cada 5–10 s)
 *   POST /v1/trips/{tripId}/route-changes        → LiveRouteChange                  (Idempotency-Key)
 *   POST /v1/route-changes/{id}/cancel           → LiveRouteChange
 *   GET  /v1/route-changes/{id}                  → LiveRouteChange                  (lo registra el paquete `live`)
 *   POST /v1/bookings/{bookingId}/driver-cancel  → CancelBookingResponse            (money §8.3; Idempotency-Key)
 *   POST /v1/me/trips/{tripId}/cancel            → CancelTripResponse               PROPUESTO: no existe en el backend real
 *   GET  /v1/trips/{tripId}                      → TripDetail                       (lo registra `search-browse`)
 *   POST /v1/conversations/direct                → ConversationDetail               (lo registra `messages`)
 *
 * Las pantallas NO importan este fichero: pasan por los hooks de `./hooks`. Los errores se explican con
 * `describeOpsError` (lógica/errors.ts), no con el catálogo global, para que cada código diga lo que toca al conductor.
 */
import { ApiError, apiRequest, isAuthExpiredError } from "@/api";
import type {
  CancelBookingResponse,
  ConversationDetail,
  DriverCancelBookingRequest,
  LiveConsole,
  LiveCreateRouteChangeBody,
  LivePickupVerified,
  LivePostLocationBody,
  LivePostLocationResult,
  LiveRouteChange,
  LiveTripCompleted,
  LiveTripStarted,
  TripDetail,
  Uuid,
} from "@/api/types";
import type { CancelTripBody, CancelTripResponse, OpsCallOptions } from "./types";

const enc = encodeURIComponent;

/** Consola del conductor: pasajeros, estado de cada recogida, señal propia y acciones permitidas. */
export async function getConsole(tripId: Uuid, options: OpsCallOptions = {}): Promise<LiveConsole> {
  return apiRequest<LiveConsole>(`/v1/me/trips/${enc(tripId)}/console`, options);
}

/** Inicia el viaje. El servidor exige el vehículo en regla (foto, seguro vigente…): los errores traen qué falta. */
export async function startTrip(tripId: Uuid, options: OpsCallOptions = {}): Promise<LiveTripStarted> {
  return apiRequest<LiveTripStarted>(`/v1/me/trips/${enc(tripId)}/start`, { method: "POST", ...options });
}

/** Termina el viaje: recogidos → `completed`, sin recoger → `no_show`. Lo decide el servidor, no la app. */
export async function completeTrip(tripId: Uuid, options: OpsCallOptions = {}): Promise<LiveTripCompleted> {
  return apiRequest<LiveTripCompleted>(`/v1/me/trips/${enc(tripId)}/complete`, { method: "POST", ...options });
}

/**
 * Verifica el código de 6 cifras que enseña el pasajero. Idempotente: repetirlo con el código bueno no falla.
 *
 * OJO: el backend contesta `401 PICKUP_CODE_INVALID` a un código equivocado (src/services/trip-execution-service.ts) y la
 * capa de red interpreta todo 401 con token como «sesión caducada» (cierra la sesión y lleva a Bienvenida). Para que un
 * simple error de tecleo no expulse al conductor, esta llamada NO emite `authExpired` (`authExpiry: "ignore"`) y el 401
 * con ese código se devuelve como lo que es: un código incorrecto. Los intentos que quedan salen de la consola.
 */
export async function verifyPickupCode(bookingId: Uuid, code: string, options: OpsCallOptions = {}): Promise<LivePickupVerified> {
  try {
    return await apiRequest<LivePickupVerified>(`/v1/bookings/${enc(bookingId)}/pickup-verify`, {
      method: "POST",
      body: { code },
      // Un código equivocado NO se reintenta solo: gastaría intentos del pasajero.
      retries: 0,
      authExpiry: "ignore",
      ...options,
    });
  } catch (error) {
    if (isAuthExpiredError(error) && error.serverCode === "PICKUP_CODE_INVALID") {
      throw new ApiError("El código de recogida no es correcto.", "PICKUP_CODE_INVALID", 401, undefined, error.requestId);
    }
    throw error;
  }
}

/** Publica la posición del conductor. `eventId` hace idempotente el reintento. */
export async function postLocation(tripId: Uuid, body: LivePostLocationBody, options: OpsCallOptions = {}): Promise<LivePostLocationResult> {
  return apiRequest<LivePostLocationResult>(`/v1/trips/${enc(tripId)}/location`, { method: "POST", body, ...options });
}

/** Propone una parada nueva: el servidor calcula el desvío, a quién afecta y si hace falta su aceptación. */
export async function createRouteChange(tripId: Uuid, body: LiveCreateRouteChangeBody, options: OpsCallOptions = {}): Promise<LiveRouteChange> {
  return apiRequest<LiveRouteChange>(`/v1/trips/${enc(tripId)}/route-changes`, { method: "POST", body, ...options });
}

/** Retira una propuesta pendiente. */
export async function cancelRouteChange(routeChangeId: Uuid, options: OpsCallOptions = {}): Promise<LiveRouteChange> {
  return apiRequest<LiveRouteChange>(`/v1/route-changes/${enc(routeChangeId)}/cancel`, { method: "POST", ...options });
}

/** Vista de una propuesta (el conductor ve quién ha aceptado o rechazado). */
export async function getRouteChange(routeChangeId: Uuid, options: OpsCallOptions = {}): Promise<LiveRouteChange> {
  return apiRequest<LiveRouteChange>(`/v1/route-changes/${enc(routeChangeId)}`, options);
}

/** El conductor cancela UNA reserva. Reserva → `driver_cancelled`; se abre una propuesta de devolución en revisión. */
export async function driverCancelBooking(
  bookingId: Uuid,
  body: DriverCancelBookingRequest,
  options: OpsCallOptions = {},
): Promise<CancelBookingResponse> {
  return apiRequest<CancelBookingResponse>(`/v1/bookings/${enc(bookingId)}/driver-cancel`, { method: "POST", body, ...options });
}

/**
 * Cancela el viaje ENTERO. PROPUESTO: el backend real todavía no tiene este endpoint (solo cancela reservas sueltas con
 * `driver-cancel`). Contrato propuesto en `./types.ts` (`CancelTripBody` / `CancelTripResponse`).
 */
export async function cancelTrip(tripId: Uuid, body: CancelTripBody, options: OpsCallOptions = {}): Promise<CancelTripResponse> {
  return apiRequest<CancelTripResponse>(`/v1/me/trips/${enc(tripId)}/cancel`, { method: "POST", body, ...options });
}

/** Detalle del viaje tal y como lo ve su conductor (ruta, paradas, plazas, solicitudes pendientes). */
export async function getTripDetail(tripId: Uuid, options: OpsCallOptions = {}): Promise<TripDetail> {
  return apiRequest<TripDetail>(`/v1/trips/${enc(tripId)}`, options);
}

/** Abre (o recupera) el chat con un pasajero con reserva confirmada: «Escribir a Laura». */
export async function openPassengerChat(tripId: Uuid, passengerUserId: Uuid, options: OpsCallOptions = {}): Promise<ConversationDetail> {
  return apiRequest<ConversationDetail>("/v1/conversations/direct", {
    method: "POST",
    body: { tripId, peerUserId: passengerUserId },
    ...options,
  });
}
