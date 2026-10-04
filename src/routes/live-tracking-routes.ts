import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { readBearerToken, resolveSession } from "../auth/session.js";
import {
  getTripLocationForViewer,
  listApproximateLiveTrips,
  recordDriverLocation
} from "../live/tracking-service.js";

async function optionalViewer(pool: Pool, authorization: string | undefined): Promise<string | null> {
  if (!authorization) return null;
  const token = readBearerToken(authorization);
  return (await resolveSession(pool, token)).userId;
}

export async function registerLiveTrackingRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.post("/v1/trips/:tripId/location", {
    schema: {
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["tripId"],
        properties: { tripId: { type: "string", format: "uuid" } }
      },
      body: {
        type: "object",
        additionalProperties: false,
        required: ["eventId","recordedAt","latitude","longitude"],
        properties: {
          eventId: { type: "string", format: "uuid" },
          recordedAt: { type: "string", format: "date-time" },
          latitude: { type: "number", minimum: -90, maximum: 90 },
          longitude: { type: "number", minimum: -180, maximum: 180 },
          accuracyM: { type: "number", minimum: 0, maximum: 10000 },
          speedMps: { type: "number", minimum: 0, maximum: 150 },
          headingDegrees: { type: "number", minimum: 0, exclusiveMaximum: 360 }
        }
      }
    }
  }, async request => {
    const principal = await resolveSession(pool, readBearerToken(request.headers.authorization));
    const params = request.params as { tripId: string };
    const body = request.body as {
      eventId: string;
      recordedAt: string;
      latitude: number;
      longitude: number;
      accuracyM?: number;
      speedMps?: number;
      headingDegrees?: number;
    };
    return recordDriverLocation(pool, {
      tripId: params.tripId,
      driverUserId: principal.userId,
      ...body
    });
  });

  app.get("/v1/trips/:tripId/location", {
    schema: {
      params: {
        type: "object",
        required: ["tripId"],
        properties: { tripId: { type: "string", format: "uuid" } }
      }
    }
  }, async request => {
    const params = request.params as { tripId: string };
    const viewerUserId = await optionalViewer(pool, request.headers.authorization);
    return {
      location: await getTripLocationForViewer(pool, params.tripId, viewerUserId)
    };
  });

  app.get("/v1/live/map", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        required: ["provinceId"],
        properties: {
          provinceId: { type: "string", format: "uuid" }
        }
      }
    }
  }, async request => {
    const query = request.query as { provinceId: string };
    return { trips: await listApproximateLiveTrips(pool, query.provinceId) };
  });
}
