import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { SmsVerificationProvider } from "./provider.js";
import type { AuthServiceConfig } from "./service.js";
import { beginPhoneVerification, verifyPhoneCode } from "./service.js";
import { readBearerToken, resolveSession, revokeSession } from "./session.js";

export async function registerAuthRoutes(
  app: FastifyInstance,
  pool: Pool,
  provider: SmsVerificationProvider,
  config: AuthServiceConfig
): Promise<void> {
  app.post("/v1/auth/phone/start", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["phone"],
        properties: {
          phone: { type: "string", minLength: 8, maxLength: 32 },
          roles: {
            type: "array",
            minItems: 1,
            maxItems: 2,
            uniqueItems: true,
            items: { type: "string", enum: ["passenger", "driver"] }
          }
        }
      }
    }
  }, async (request, reply) => {
    const body = request.body as { phone: string; roles?: unknown };
    const result = await beginPhoneVerification(pool, provider, config, body);
    return reply.code(202).send(result);
  });

  app.post("/v1/auth/phone/verify", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["challengeId", "code"],
        properties: {
          challengeId: { type: "string", format: "uuid" },
          code: { type: "string", minLength: 4, maxLength: 10 }
        }
      }
    }
  }, async request => {
    const body = request.body as { challengeId: string; code: string };
    return verifyPhoneCode(pool, provider, config, body);
  });

  app.get("/v1/auth/session", {
    schema: { security: [{ bearerAuth: [] }] }
  }, async request => {
    const token = readBearerToken(request.headers.authorization);
    const principal = await resolveSession(pool, token);
    return {
      user: { id: principal.userId, roles: principal.roles },
      session: { id: principal.sessionId, expiresAt: principal.expiresAt }
    };
  });

  app.post("/v1/auth/logout", {
    schema: { security: [{ bearerAuth: [] }] }
  }, async (request, reply) => {
    const token = readBearerToken(request.headers.authorization);
    await revokeSession(pool, token);
    return reply.code(204).send();
  });
}
