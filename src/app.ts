import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { loadConfig } from "./config.js";
import { checkDatabaseReadiness, pool } from "./db/pool.js";
import { DomainError } from "./errors.js";
import { buildEmailProvider } from "./email/provider.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { readBearerToken, requireAnyRole, resolveSession } from "./auth/session.js";
import { registerMeRoutes } from "./routes/me-routes.js";
import { registerProfileVehicleRoutes } from "./routes/profile-vehicle-routes.js";
import { registerLiveTrackingRoutes } from "./routes/live-tracking-routes.js";
import { registerRideRequestRoutes } from "./routes/ride-request-routes.js";
import { GoogleMapsProvider } from "./maps/google-maps-provider.js";
import type { GeocodingProvider, RouteProvider } from "./maps/types.js";
import { DevLocalMapsProvider } from "./dev/dev-maps-provider.js";
import { registerTripDraftRoutes } from "./routes/trip-draft-routes.js";
import { registerTripSearchRoutes } from "./routes/trip-search-routes.js";
import { registerChatRoutes } from "./routes/chat-routes.js";
import { registerTripExecutionRoutes } from "./routes/trip-execution-routes.js";
import { registerFeedbackRoutes } from "./routes/feedback-routes.js";
import { registerCancellationRoutes } from "./routes/cancellation-routes.js";
import { registerNotificationRoutes } from "./routes/notification-routes.js";
import { registerAdminRoutes } from "./routes/admin-routes.js";
import { registerRecurringRoutes } from "./routes/recurring-routes.js";
import { registerPaymentRoutes } from "./routes/payment-routes.js";
import { registerRouteChangeRoutes } from "./routes/route-change-routes.js";
import { registerTariffRoutes } from "./routes/tariff-routes.js";
import { registerLegalRoutes } from "./routes/legal-routes.js";
import { registerAccountRoutes } from "./routes/account-routes.js";
import { registerPushRoutes } from "./routes/push-routes.js";
import { registerProvinceRoutes } from "./routes/province-routes.js";
import { registerGeocodingRoutes } from "./routes/geocoding-routes.js";
import { buildPrivateObjectStorage } from "./storage/provider.js";
import { buildInsuranceOcrProvider } from "./documents/insurance-ocr-provider.js";
import { registerPrivateUploadRoutes } from "./routes/private-upload-routes.js";

export async function buildApp() {
  const config = loadConfig();
  const app = Fastify({
    // Query strings carry coordinates and typed addresses: log the path only.
    logger: {
      serializers: {
        req: (req: any) => ({ method: req.method, url: String(req.url ?? "").split("?")[0] ?? "", id: req.id })
      }
    },
    trustProxy: config.trustProxy
  });

  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "MVC - Me voy contigo API",
        version: "0.21.0",
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

    const fastifyError = error as { validation?: unknown; statusCode?: number; message?: string };
    if (fastifyError.validation) {
      return reply.code(400).send({
        error: { code: "VALIDATION_ERROR", message: fastifyError.message ?? "Invalid request" },
        requestId: request.id
      });
    }
    if (typeof fastifyError.statusCode === "number" && fastifyError.statusCode >= 400 && fastifyError.statusCode < 500) {
      return reply.code(fastifyError.statusCode).send({
        error: {
          code: fastifyError.statusCode === 429 ? "RATE_LIMITED" : "HTTP_ERROR",
          message: fastifyError.message ?? "Request rejected"
        },
        requestId: request.id
      });
    }

    request.log.error(error);
    return reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
      requestId: request.id
    });
  });

  // Staff-only surface: refuse anonymous and non-staff callers before any body is parsed or validated.
  // Each handler still checks the specific role it needs (finance, verification, support).
  app.addHook("onRequest", async request => {
    if (!/^\/v1\/admin(\/|\?|$)/.test(request.url)) return;
    const principal = await resolveSession(pool, readBearerToken(request.headers.authorization));
    requireAnyRole(principal, ["admin", "verification_admin", "finance_admin", "support_admin"]);
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

  const emailProvider = buildEmailProvider(config);
  const privateStorage = buildPrivateObjectStorage(config);
  const insuranceOcr = buildInsuranceOcrProvider(config);
  let routeProvider: RouteProvider | null = null;
  let geocodingProvider: GeocodingProvider | null = null;
  if (config.mapsProvider === "google") {
    if (!config.googleMapsApiKey) throw new Error("GOOGLE_MAPS_API_KEY is required when MAPS_PROVIDER=google");
    const googleMaps = new GoogleMapsProvider(config.googleMapsApiKey);
    routeProvider = googleMaps;
    geocodingProvider = googleMaps;
  } else if (config.mapsProvider === "dev_local") {
    if (config.nodeEnv !== "development") {
      throw new Error("MAPS_PROVIDER=dev_local is only allowed with NODE_ENV=development");
    }
    const devMaps = new DevLocalMapsProvider();
    routeProvider = devMaps;
    geocodingProvider = devMaps;
  }
  await registerAuthRoutes(app, pool, emailProvider, {
    sessionTtlSeconds: config.authSessionTtlSeconds,
    maxFailedLogins: config.authMaxFailedLogins,
    lockMinutes: config.authLockMinutes,
    codeTtlSeconds: config.authCodeTtlSeconds,
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
  await registerFeedbackRoutes(app, pool);
  await registerCancellationRoutes(app, pool);
  await registerNotificationRoutes(app, pool);
  await registerAdminRoutes(app, pool, {
    email: config.emailProvider,
    maps: config.mapsProvider,
    storage: config.privateStorageProvider,
    insuranceOcr: config.insuranceOcrProvider,
    payments: config.paymentsProvider === "stripe" && config.stripeWebhookSecret ? "stripe" : "disabled",
    push: "disabled"
  });
  await registerRecurringRoutes(app, pool);
  await registerTariffRoutes(app, pool);
  await registerLegalRoutes(app, pool);
  await registerAccountRoutes(app, pool);
  await registerPushRoutes(app, pool);
  await registerRouteChangeRoutes(app, pool, routeProvider);
  await registerPaymentRoutes(app, pool, config);
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
