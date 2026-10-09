/** Seguimiento en vivo (`live-tracking-routes`): publicar ubicación, ver ubicación y mapa aproximado. */
import type { PreviewDb } from "../core/db";
import type { PreviewRouter } from "../core/router";
import { getTripLocationForViewer, listApproximateLiveTrips, recordDriverLocation } from "../domain/live";
import { uuidParam } from "./schemas";

interface LocationBody {
  eventId: string;
  recordedAt: string;
  latitude: number;
  longitude: number;
  accuracyM?: number;
  speedMps?: number;
  headingDegrees?: number;
}

export function registerLive(r: PreviewRouter, db: PreviewDb): void {
  r.post<{ Params: { tripId: string }; Body: LocationBody }>(
    "/v1/trips/:tripId/location",
    {
      summary: "Publicar la ubicación del conductor",
      tags: ["live"],
      schema: {
        params: uuidParam("tripId"),
        body: {
          type: "object",
          additionalProperties: false,
          required: ["eventId", "recordedAt", "latitude", "longitude"],
          properties: {
            eventId: { type: "string", format: "uuid" },
            recordedAt: { type: "string", format: "date-time" },
            latitude: { type: "number", minimum: -90, maximum: 90 },
            longitude: { type: "number", minimum: -180, maximum: 180 },
            accuracyM: { type: "number", minimum: 0, maximum: 10_000 },
            speedMps: { type: "number", minimum: 0, maximum: 150 },
            headingDegrees: { type: "number", minimum: 0, exclusiveMaximum: 360 },
          },
        },
      },
    },
    (req) => recordDriverLocation(db, { tripId: req.params.tripId, driverUserId: req.auth().userId, ...req.body })
  );

  r.get<{ Params: { tripId: string } }>(
    "/v1/trips/:tripId/location",
    { summary: "Ubicación visible del viaje (precisa solo para participantes)", tags: ["live"], schema: { params: uuidParam("tripId") } },
    (req) => ({ location: getTripLocationForViewer(db, req.params.tripId, req.authOptional()?.userId ?? null) })
  );

  r.get<{ Query: { provinceId: string } }>(
    "/v1/live/map",
    {
      summary: "Coches en marcha de la provincia (posición aproximada)",
      tags: ["live"],
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["provinceId"],
          properties: { provinceId: { type: "string", format: "uuid" } },
        },
      },
    },
    (req) => ({ trips: listApproximateLiveTrips(db, req.query.provinceId) })
  );
}
