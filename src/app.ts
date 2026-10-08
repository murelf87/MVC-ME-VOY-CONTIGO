import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { loadConfig } from "./config.js";
import { checkDatabaseReadiness, pool } from "./db/pool.js";
import { DomainError } from "./errors.js";
import { buildSmsVerificationProvider } from "./auth/provider.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerMeRoutes } from "./routes/me-routes.js";
import { registerProfileVehicleRoutes } from "./routes/profile-vehicle-routes.js";
import { registerLiveTrackingRoutes } from "./routes/live-tracking-routes.js";
import { registerRideRequestRoutes } from "./routes/ride-request-routes.js";
import { GoogleMapsProvider } from "./maps/google-maps-provider.js";
import type { GeocodingProvider, RouteProvider } from "./maps/types.js";
import { registerTripDraftRoutes } from "./routes/trip-draft-routes.js";
import { registerTripSearchRoutes } from "./routes/trip-search-routes.js";
import { registerChatRoutes } from "./routes/chat-routes.js";
import { registerTripExecutionRoutes } from "./routes/trip-execution-routes.js";
import { registerProvinceRoutes } from "./routes/province-routes.js";
import { registerGeocodingRoutes } from "./routes/geocoding-routes.js";
import { buildPrivateObjectStorage } from "./storage/provider.js";
import { buildInsuranceOcrProvider } from "./documents/insurance-ocr-provider.js";
import { registerPrivateUploadRoutes } from "./routes/private-upload-routes.js";

export async function buildApp() {
  const config = loadConfig();
  const app = Fastify({ logger: true, trustProxy: config.trustProxy });

  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "MVC - Me voy contigo API",
        version: "0.14.0",
        description: "Backend core with provider-backed phone verification and revocable opaque sessions."
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "MVC opaque session token"
          }
        }
      }
    }
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
        requestId: request.id
      });
    }

    request.log.error(error);
    return reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
      requestId: request.id
    });
  });

  app.get("/health/live", {
    schema: {
      response: {
        200: {
          type: "object",
          properties: { status: { type: "string" } },
          required: ["status"]
        }
      }
    }
  }, async () => ({ status: "ok" }));

  app.get("/health/ready", {
    schema: {
      response: {
        200: {
          type: "object",
          properties: { status: { type: "string" }, postgis: { type: "string" } },
          required: ["status"]
        },
        503: {
          type: "object",
          properties: { status: { type: "string" }, error: { type: "string" } },
          required: ["status"]
        }
      }
    }
  }, async (_request, reply) => {
    const db = await checkDatabaseReadiness();
    if (!db.ok) return reply.code(503).send({ status: "not_ready", error: db.error ?? "database_error" });
    return { status: "ready", postgis: db.postgis ?? "unknown" };
  });

  const smsProvider = buildSmsVerificationProvider(config);
  const privateStorage = buildPrivateObjectStorage(config);
  const insuranceOcr = buildInsuranceOcrProvider(config);
  let routeProvider: RouteProvider | null = null;
  let geocodingProvider: GeocodingProvider | null = null;
  if (config.mapsProvider === "google") {
    if (!config.googleMapsApiKey) throw new Error("GOOGLE_MAPS_API_KEY is required when MAPS_PROVIDER=google");
    const googleMaps = new GoogleMapsProvider(config.googleMapsApiKey);
    routeProvider = googleMaps;
    geocodingProvider = googleMaps;
  }
  await registerAuthRoutes(app, pool, smsProvider, {
    challengeTtlSeconds: config.authChallengeTtlSeconds,
    sessionTtlSeconds: config.authSessionTtlSeconds,
    maxCheckAttempts: config.authMaxCheckAttempts,
    resendCooldownSeconds: config.authResendCooldownSeconds
  });
  await registerMeRoutes(app, pool);
  await registerProfileVehicleRoutes(app, pool);
  await registerLiveTrackingRoutes(app, pool);
  await registerRideRequestRoutes(app, pool);
  await registerTripDraftRoutes(app, pool, routeProvider);
  await registerTripSearchRoutes(app, pool);
  await registerChatRoutes(app, pool);
  await registerTripExecutionRoutes(app, pool);
  await registerProvinceRoutes(app, pool);
  await registerGeocodingRoutes(app, pool, geocodingProvider);
  await registerPrivateUploadRoutes(
    app,
    pool,
    privateStorage,
    insuranceOcr,
    config.privateUploadTtlSeconds
  );

  return app;
}
