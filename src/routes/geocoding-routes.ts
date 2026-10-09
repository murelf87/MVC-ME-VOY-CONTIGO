import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { readBearerToken, resolveSession } from "../auth/session.js";
import { DomainError } from "../errors.js";
import type { GeocodingProvider } from "../maps/types.js";

/**
 * Sesión OPCIONAL: un invitado puede buscar lugares (puede explorar el mapa y la búsqueda antes de crear cuenta; solicitar
 * plaza sí exige cuenta). Si llega la cabecera `Authorization`, debe ser válida (401 si no lo es). Como el geocodificador
 * externo se paga por consulta, el invitado tiene un límite de frecuencia más estricto que una persona con sesión.
 */
async function resolveOptionalUser(pool: Pool, authorization: string | undefined): Promise<void> {
  if (authorization === undefined) return;
  await resolveSession(pool, readBearerToken(authorization));
}

const GUEST_GEOCODING_PER_MINUTE = 20;
const MEMBER_GEOCODING_PER_MINUTE = 60;

const geocodingRateLimit = {
  rateLimit: {
    max: (request: FastifyRequest): number =>
      request.headers.authorization === undefined ? GUEST_GEOCODING_PER_MINUTE : MEMBER_GEOCODING_PER_MINUTE,
    timeWindow: "1 minute"
  }
};

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
    config: geocodingRateLimit,
    schema: {
      security: [{ bearerAuth: [] }, {}],
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
    await resolveOptionalUser(pool, request.headers.authorization);
    const query = request.query as { query: string };
    const results = await requireProvider(provider).geocodeAddress(query.query);
    return { results };
  });

  app.get("/v1/maps/reverse", {
    config: geocodingRateLimit,
    schema: {
      security: [{ bearerAuth: [] }, {}],
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
    await resolveOptionalUser(pool, request.headers.authorization);
    const query = request.query as {
      latitude: number;
      longitude: number;
    };
    const results = await requireProvider(provider).reverseGeocode(query);
    return { results };
  });
}
