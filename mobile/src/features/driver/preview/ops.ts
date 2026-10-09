/**
 * Backend en memoria de la vista previa · slice `driver` · paquete «operar el viaje».
 *
 *   GET  /v1/me/trips/:tripId/console           consola del conductor (viaje, pasajeros, cambio de ruta pendiente)
 *   POST /v1/trips/:tripId/route-changes        proponer una parada nueva (Idempotency-Key obligatoria)
 *   POST /v1/route-changes/:id/cancel           retirar la propuesta
 *   GET  /v1/route-changes/:id                  ver la propuesta (conductor o pasajero afectado)
 *   POST /v1/route-changes/:id/respond          aceptar / rechazar (pasajero afectado)
 *   POST /v1/bookings/:bookingId/driver-cancel  cancelar UNA reserva como conductor (Idempotency-Key obligatoria)
 *   POST /v1/me/trips/:tripId/cancel            cancelar el viaje entero (propuesto; Idempotency-Key obligatoria)
 *
 * La lógica vive en `driverCancelBooking`, `cancelTripAsDriver`, `buildDriverConsole` y en el dominio de cambios de ruta.
 * SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`).
 */
import type { LiveCreateRouteChangeBody, LiveRespondRouteChangeBody } from "@/api/types";
import type { DriverCancelBookingRequest } from "@/api/types";
import {
  cancelRouteChange,
  createRouteChange,
  getRouteChangeView,
  reply,
  respondToRouteChange,
  type PreviewDb,
  type PreviewProfileId,
  type PreviewRouter,
} from "@/preview";
import type { CancelTripBody } from "../ops/types";
import { cancelTripAsDriver, driverCancelBooking } from "./opsCancel";
import { buildDriverConsole } from "./opsConsole";
import { wireRouteChangeNotices } from "./opsNotify";
import { requireDriver } from "./publishReadiness";

const idParam = (name: string) => ({ type: "object", required: [name], properties: { [name]: { type: "string", minLength: 1 } } }) as const;

const cancelBody = {
  type: "object",
  additionalProperties: false,
  required: ["reason"],
  properties: { reason: { type: "string", minLength: 1 }, note: { type: "string", maxLength: 500 } },
} as const;

const routeChangeBody = {
  type: "object",
  additionalProperties: false,
  required: ["stop"],
  properties: {
    stop: {
      type: "object",
      required: ["location"],
      properties: {
        location: { type: "object", required: ["lat", "lng"], properties: { lat: { type: "number" }, lng: { type: "number" } } },
        label: { type: "string", maxLength: 120 },
      },
    },
    afterStopSeq: { type: "integer", minimum: 0 },
    requestId: { type: "string" },
  },
} as const;

export function registerOpsPreview(r: PreviewRouter, db: PreviewDb): void {
  wireRouteChangeNotices(db);

  r.get<{ Params: { tripId: string } }>(
    "/v1/me/trips/:tripId/console",
    { summary: "Consola del conductor para operar el viaje", tags: ["live"], schema: { params: idParam("tripId") } },
    (req) => {
      const principal = req.auth();
      requireDriver(principal, "Necesitas el rol de conductor para operar un viaje.");
      return buildDriverConsole(db, principal, req.params.tripId);
    },
  );

  r.post<{ Params: { tripId: string }; Body: LiveCreateRouteChangeBody }>(
    "/v1/trips/:tripId/route-changes",
    { summary: "Proponer una parada nueva en el viaje", tags: ["live"], idempotent: "required", schema: { params: idParam("tripId"), body: routeChangeBody } },
    (req) => {
      const principal = req.auth();
      requireDriver(principal, "Necesitas el rol de conductor para cambiar la ruta.");
      const { stop, afterStopSeq, requestId } = req.body;
      return reply.created(
        createRouteChange(db, principal, {
          tripId: req.params.tripId,
          stop: { lat: stop.location.lat, lng: stop.location.lng, label: stop.label },
          afterStopSeq,
          requestId,
        }),
      );
    },
  );

  r.post<{ Params: { id: string } }>(
    "/v1/route-changes/:id/cancel",
    { summary: "Retirar una propuesta de cambio de ruta", tags: ["live"], schema: { params: idParam("id") } },
    (req) => cancelRouteChange(db, req.auth(), req.params.id),
  );

  r.get<{ Params: { id: string } }>(
    "/v1/route-changes/:id",
    { summary: "Ver una propuesta de cambio de ruta", tags: ["live"], schema: { params: idParam("id") } },
    (req) => getRouteChangeView(db, req.auth().userId, req.params.id),
  );

  r.post<{ Params: { id: string }; Body: LiveRespondRouteChangeBody }>(
    "/v1/route-changes/:id/respond",
    {
      summary: "Aceptar o rechazar un cambio de ruta (pasajero afectado)",
      tags: ["live"],
      schema: {
        params: idParam("id"),
        body: { type: "object", additionalProperties: false, required: ["decision"], properties: { decision: { type: "string", enum: ["accept", "reject"] } } },
      },
    },
    (req) => respondToRouteChange(db, req.auth(), req.params.id, req.body.decision),
  );

  r.post<{ Params: { bookingId: string }; Body: DriverCancelBookingRequest }>(
    "/v1/bookings/:bookingId/driver-cancel",
    { summary: "Cancelar una reserva como conductor", tags: ["money"], idempotent: "required", schema: { params: idParam("bookingId"), body: cancelBody } },
    (req) => {
      const principal = req.auth();
      requireDriver(principal, "Necesitas el rol de conductor para cancelar una reserva.");
      return driverCancelBooking(db, principal, req.params.bookingId, req.body, req.requestId);
    },
  );

  r.post<{ Params: { tripId: string }; Body: CancelTripBody }>(
    "/v1/me/trips/:tripId/cancel",
    { summary: "Cancelar el viaje entero (propuesto)", tags: ["trips"], idempotent: "required", schema: { params: idParam("tripId"), body: cancelBody } },
    (req) => {
      const principal = req.auth();
      requireDriver(principal, "Necesitas el rol de conductor para cancelar un viaje.");
      return cancelTripAsDriver(db, principal, req.params.tripId, req.body, req.requestId);
    },
  );
}

export function seedOps(_db: PreviewDb, _profile: PreviewProfileId, _seed: string): void {}

/** Variantes de datos propias del paquete: { "nombre-unico": "qué contiene, en una frase" }. */
export const opsSeedVariants: Readonly<Record<string, string>> = {};
