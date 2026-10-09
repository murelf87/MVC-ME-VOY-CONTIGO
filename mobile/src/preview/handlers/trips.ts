/** Viajes del conductor, búsqueda, solicitudes y ejecución (`trip-draft`, `trip-search`, `ride-request`, `trip-execution`). */
import type { PreviewDb } from "../core/db";
import { ApiFailure } from "../core/errors";
import { reply, type PreviewRouter } from "../core/router";
import type { GeoLatLng } from "../core/types";
import {
  completeOwnedTrip,
  generateOwnPickupCode,
  startOwnedTrip,
  verifyPickupCode,
} from "../domain/execution";
import {
  createRideRequest,
  decideRideRequest,
  getExtendedRideRequestCreator,
  listOwnRideRequests,
  listTripRideRequests,
  type DecisionKind,
} from "../domain/requests";
import { searchPublishedTrips, type TripSearchInput } from "../domain/search";
import {
  createTripDraftWithServerRoute,
  listOwnDriverTrips,
  publishOwnedTrip,
  type CreateTripDraftInput,
} from "../domain/trips";
import { pointSchema, uuidParam } from "./schemas";

export function registerTrips(r: PreviewRouter, db: PreviewDb): void {
  r.post<{ Body: CreateTripDraftInput & { intermediates?: GeoLatLng[] } }>(
    "/v1/me/trips",
    {
      summary: "Crear borrador de viaje (ruta calculada por el servidor)",
      tags: ["trips"],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "vehicleId",
            "provinceId",
            "category",
            "leg",
            "departureAt",
            "flexibilityMinutes",
            "maxDetourM",
            "offeredSeats",
            "origin",
            "destination",
          ],
          properties: {
            vehicleId: { type: "string", format: "uuid" },
            provinceId: { type: "string", format: "uuid" },
            category: { type: "string", enum: ["work", "university", "fp_academies", "hospital", "sport", "other"] },
            leg: { type: "string", enum: ["outbound", "return"] },
            departureAt: { type: "string", format: "date-time" },
            flexibilityMinutes: { type: "integer", minimum: 0, maximum: 60 },
            maxDetourM: { type: "integer", minimum: 0, maximum: 100_000 },
            offeredSeats: { type: "integer", minimum: 1, maximum: 8 },
            origin: pointSchema,
            destination: pointSchema,
            intermediates: { type: "array", maxItems: 10, items: pointSchema },
          },
        },
      },
    },
    (req) => reply.created(createTripDraftWithServerRoute(db, req.auth(), req.body, req.requestId))
  );

  r.get("/v1/me/trips", { summary: "Mis viajes como conductor", tags: ["trips"] }, (req) => ({
    trips: listOwnDriverTrips(db, req.auth()),
  }));

  r.post<{ Params: { tripId: string } }>(
    "/v1/me/trips/:tripId/publish",
    { summary: "Publicar un borrador", tags: ["trips"], schema: { params: uuidParam("tripId") } },
    (req) => {
      publishOwnedTrip(db, req.auth(), req.params.tripId);
      return reply.noContent();
    }
  );

  r.get<{ Query: TripSearchInput }>(
    "/v1/trips/search",
    {
      summary: "Buscar viajes publicados por recorrido",
      tags: ["trips"],
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["provinceId", "originLatitude", "originLongitude", "destinationLatitude", "destinationLongitude"],
          properties: {
            provinceId: { type: "string", format: "uuid" },
            originLatitude: { type: "number", minimum: -90, maximum: 90 },
            originLongitude: { type: "number", minimum: -180, maximum: 180 },
            destinationLatitude: { type: "number", minimum: -90, maximum: 90 },
            destinationLongitude: { type: "number", minimum: -180, maximum: 180 },
            radiusM: { type: "integer", minimum: 100, maximum: 50_000 },
            departureAfter: { type: "string", format: "date-time" },
            departureBefore: { type: "string", format: "date-time" },
            limit: { type: "integer", minimum: 1, maximum: 100 },
          },
        },
      },
    },
    (req) => ({ trips: searchPublishedTrips(db, req.query) })
  );

  r.post<{ Params: { tripId: string }; Body: Record<string, unknown> & { fromSegmentSeq?: number; toSegmentSeq?: number } }>(
    "/v1/trips/:tripId/requests",
    {
      summary: "Solicitar plaza (forma heredada 0.14 o ampliada con punto de recogida)",
      tags: ["requests"],
      idempotent: true,
      schema: {
        params: uuidParam("tripId"),
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            fromSegmentSeq: { type: "integer", minimum: 0 },
            toSegmentSeq: { type: "integer", minimum: 1 },
            pickupPointId: { type: "string", maxLength: 300 },
            dropoffStopSeq: { type: "integer", minimum: 1 },
            message: { type: "string", maxLength: 300 },
          },
        },
      },
    },
    (req) => {
      const body = req.body;
      const legacyOnly = Object.keys(body).every((key) => key === "fromSegmentSeq" || key === "toSegmentSeq");
      const extended = getExtendedRideRequestCreator();
      if (!legacyOnly && extended) return reply.created(extended(db, req.auth(), req.params.tripId, body, req.requestId));
      if (typeof body.fromSegmentSeq !== "number" || typeof body.toSegmentSeq !== "number") {
        throw new ApiFailure("INVALID_REQUEST_SHAPE", "Indica un punto de recogida o un rango de tramos.", 422);
      }
      return reply.created(
        createRideRequest(db, req.auth(), { tripId: req.params.tripId, fromSegmentSeq: body.fromSegmentSeq, toSegmentSeq: body.toSegmentSeq }, req.requestId)
      );
    }
  );

  r.get("/v1/me/ride-requests", { summary: "Mis solicitudes de plaza", tags: ["requests"] }, (req) => ({
    requests: listOwnRideRequests(db, req.auth()),
  }));

  r.get<{ Params: { tripId: string } }>(
    "/v1/trips/:tripId/requests",
    { summary: "Solicitudes de mi viaje (conductor)", tags: ["requests"], schema: { params: uuidParam("tripId") } },
    (req) => ({ requests: listTripRideRequests(db, req.auth(), req.params.tripId) })
  );

  r.post<{ Params: { requestId: string }; Body: { decision: DecisionKind } }>(
    "/v1/ride-requests/:requestId/decision",
    {
      summary: "Aceptar o rechazar una solicitud (forma heredada 0.14)",
      tags: ["requests"],
      schema: {
        params: uuidParam("requestId"),
        body: {
          type: "object",
          additionalProperties: false,
          required: ["decision"],
          properties: { decision: { type: "string", enum: ["accept", "reject"] } },
        },
      },
    },
    (req) => decideRideRequest(db, req.auth(), req.params.requestId, req.body.decision, undefined, req.requestId)
  );

  r.post<{ Params: { tripId: string } }>(
    "/v1/me/trips/:tripId/start",
    { summary: "Iniciar el viaje", tags: ["execution"], schema: { params: uuidParam("tripId") } },
    (req) => startOwnedTrip(db, req.auth(), req.params.tripId, req.requestId)
  );

  r.post<{ Params: { tripId: string } }>(
    "/v1/me/trips/:tripId/complete",
    { summary: "Completar el viaje", tags: ["execution"], schema: { params: uuidParam("tripId") } },
    (req) => completeOwnedTrip(db, req.auth(), req.params.tripId, req.requestId)
  );

  r.post<{ Params: { bookingId: string } }>(
    "/v1/bookings/:bookingId/pickup-code",
    { summary: "Generar mi código de recogida", tags: ["execution"], schema: { params: uuidParam("bookingId") } },
    (req) => generateOwnPickupCode(db, req.auth(), req.params.bookingId, req.requestId)
  );

  r.post<{ Params: { bookingId: string }; Body: { code: string } }>(
    "/v1/bookings/:bookingId/pickup-verify",
    {
      summary: "Verificar el código de recogida (conductor)",
      tags: ["execution"],
      schema: {
        params: uuidParam("bookingId"),
        body: {
          type: "object",
          additionalProperties: false,
          required: ["code"],
          properties: { code: { type: "string", pattern: "^[0-9]{6}$" } },
        },
      },
    },
    (req) => verifyPickupCode(db, req.auth(), req.params.bookingId, req.body.code, req.requestId)
  );
}
