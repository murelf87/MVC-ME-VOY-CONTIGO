import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { readBearerToken, resolveSession } from "../auth/session.js";
import { DomainError } from "../errors.js";
import type { GeocodingProvider } from "../maps/types.js";

async function requireUser(pool: Pool, authorization: string | undefined): Promise<void> {
  const token = readBearerToken(authorization);
  await resolveSession(pool, token);
}

function requireProvider(provider: GeocodingProvider | null): GeocodingProvider {
  if (!provider) {
    throw new DomainError(
      "MAPS_PROVIDER_NOT_CONFIGURED",
      "Geocoding provider is not configured",
      503
    );
  }
  return provider;
}

export async function registerGeocodingRoutes(
  app: FastifyInstance,
  pool: Pool,
  provider: GeocodingProvider | null
): Promise<void> {
  app.get("/v1/maps/geocode", {
    schema: {
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 3, maxLength: 500 }
        }
      }
    }
  }, async request => {
    await requireUser(pool, request.headers.authorization);
    const query = request.query as { query: string };
    const results = await requireProvider(provider).geocodeAddress(query.query);
    return { results };
  });

  app.get("/v1/maps/reverse", {
    schema: {
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        additionalProperties: false,
        required: ["latitude", "longitude"],
        properties: {
          latitude: { type: "number", minimum: -90, maximum: 90 },
          longitude: { type: "number", minimum: -180, maximum: 180 }
        }
      }
    }
  }, async request => {
    await requireUser(pool, request.headers.authorization);
    const query = request.query as {
      latitude: number;
      longitude: number;
    };
    const results = await requireProvider(provider).reverseGeocode(query);
    return { results };
  });
}
