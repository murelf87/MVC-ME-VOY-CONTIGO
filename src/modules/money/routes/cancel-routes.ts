import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import {
  cancelBookingAsDriver,
  cancelBookingAsPassenger,
  getCancellationPreview,
  type DriverCancellationReason,
  type PassengerCancellationReason
} from "../cancellations/cancel-service.js";
import { parseIdempotencyKey } from "../lib/idempotency.js";
import { authenticate } from "../lib/http.js";
import { listMyRefunds } from "../refunds/refund-service.js";
import { BEARER, sendIdempotent } from "./helpers.js";
import {
  cancelBookingBodySchema,
  cancelBookingResponseSchema,
  cancellationPreviewSchema,
  cursorQuery,
  driverCancelBookingBodySchema,
  errorResponses,
  idempotencyHeaderSchema,
  limitQuery,
  myRefundsSchema,
  paramsOf,
  queryOf
} from "./schemas.js";

const TAG_CANCEL = ["Cancelación y devoluciones"];

export function registerCancelRoutes(app: FastifyInstance, pool: Pool): void {
  app.get<{ Params: { bookingId: string } }>("/v1/bookings/:bookingId/cancellation-preview", {
    schema: {
      tags: TAG_CANCEL,
      security: BEARER,
      summary: "Vista previa de la cancelación (Detalle del reembolso, propuesta)",
      description:
        "Solo el pasajero de la reserva. Mientras NO exista una política de cancelación aprobada aceptada al pagar, `policy.status=pending_review` y los importes derivados son «Por definir»: la app no debe prometer ningún reembolso. Si el viaje ya empezó, `canCancel=false` y `blocked.code=TRIP_ALREADY_STARTED`.",
      params: paramsOf("bookingId"),
      response: { 200: cancellationPreviewSchema, ...errorResponses(400, 401, 404) }
    }
  }, async request => {
    const principal = await authenticate(pool, request);
    return getCancellationPreview(pool, principal, request.params.bookingId);
  });

  app.post<{
    Params: { bookingId: string };
    Body: { reason: PassengerCancellationReason; note?: string };
    Headers: { "idempotency-key"?: string };
  }>("/v1/bookings/:bookingId/cancel", {
    schema: {
      tags: TAG_CANCEL,
      security: BEARER,
      summary: "Cancelar mi reserva",
      description:
        "Reserva → `cancelled`, solicitud → `cancelled`, libera la capacidad y crea una PROPUESTA de devolución en revisión si hubo importe pagado (nunca promete dinero). Requiere `Idempotency-Key`. Reintentar sobre una reserva ya cancelada devuelve 200 con `alreadyCancelled=true`.",
      params: paramsOf("bookingId"),
      headers: idempotencyHeaderSchema,
      body: cancelBookingBodySchema,
      response: { 200: cancelBookingResponseSchema, ...errorResponses(400, 401, 404, 409, 422) }
    }
  }, async (request, reply) => {
    const principal = await authenticate(pool, request);
    const key = parseIdempotencyKey(request.headers["idempotency-key"]);
    const outcome = await cancelBookingAsPassenger(pool, principal, key, request.params.bookingId, request.body);
    return sendIdempotent(reply, outcome);
  });

  app.post<{
    Params: { bookingId: string };
    Body: { reason: DriverCancellationReason; note?: string };
    Headers: { "idempotency-key"?: string };
  }>("/v1/bookings/:bookingId/driver-cancel", {
    schema: {
      tags: TAG_CANCEL,
      security: BEARER,
      summary: "Cancelar una reserva como conductor",
      description:
        "Solo el conductor del viaje. Reserva → `driver_cancelled`, solicitud → `cancelled`, aviso al pasajero y propuesta `driver_cancellation` en revisión: las consecuencias de la cancelación del conductor NO están definidas y nunca se resuelven solas. Requiere `Idempotency-Key`.",
      params: paramsOf("bookingId"),
      headers: idempotencyHeaderSchema,
      body: driverCancelBookingBodySchema,
      response: { 200: cancelBookingResponseSchema, ...errorResponses(400, 401, 404, 409, 422) }
    }
  }, async (request, reply) => {
    const principal = await authenticate(pool, request);
    const key = parseIdempotencyKey(request.headers["idempotency-key"]);
    const outcome = await cancelBookingAsDriver(pool, principal, key, request.params.bookingId, request.body);
    return sendIdempotent(reply, outcome);
  });

  app.get<{ Querystring: { cursor?: string; limit?: number } }>("/v1/me/refunds", {
    schema: {
      tags: TAG_CANCEL,
      security: BEARER,
      summary: "Mis devoluciones",
      description: "Propuestas y devoluciones del pasajero. `refundedAt` solo existe cuando el proveedor confirmó la devolución con un evento firmado.",
      querystring: queryOf({ cursor: cursorQuery, limit: limitQuery }),
      response: { 200: myRefundsSchema, ...errorResponses(400, 401) }
    }
  }, async request => {
    const principal = await authenticate(pool, request);
    return listMyRefunds(pool, principal, request.query);
  });
}
