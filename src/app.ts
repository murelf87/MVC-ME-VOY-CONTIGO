import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { loadConfig } from "./config.js";
import { checkDatabaseReadiness, pool } from "./db/pool.js";
import { DomainError } from "./errors.js";
import { DisabledOtpProvider } from "./auth/disabled-otp-provider.js";
import { registerAuthRoutes } from "./routes/auth-routes.js";
import { registerMeRoutes } from "./routes/me-routes.js";

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
        version: "0.2.0",
        description: "Backend core with secure session primitives. Real SMS delivery remains disabled until a provider is configured."
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

  const otpProvider = new DisabledOtpProvider();
  await registerAuthRoutes(app, pool, otpProvider);
  await registerMeRoutes(app, pool);

  return app;
}
