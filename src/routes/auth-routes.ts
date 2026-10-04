import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { OtpProvider } from "../auth/otp-provider.js";
import { requestOtp, revokeSession, verifyOtp } from "../auth/auth-service.js";

export async function registerAuthRoutes(
  app: FastifyInstance,
  pool: Pool,
  provider: OtpProvider
): Promise<void> {
  app.post("/auth/otp/request", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["phoneE164","purpose"],
        properties: {
          phoneE164: { type: "string", minLength: 8, maxLength: 16 },
          purpose: { type: "string", enum: ["login","register"] }
        }
      }
    }
  }, async (request) => {
    const body = request.body as { phoneE164: string; purpose: "login" | "register" };
    return requestOtp(pool, provider, body);
  });

  app.post("/auth/otp/verify", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["challengeId","phoneE164","code"],
        properties: {
          challengeId: { type: "string", format: "uuid" },
          phoneE164: { type: "string", minLength: 8, maxLength: 16 },
          code: { type: "string", pattern: "^[0-9]{6}$" }
        }
      }
    }
  }, async (request) => {
    const body = request.body as { challengeId: string; phoneE164: string; code: string };
    const userAgent = request.headers["user-agent"];
    return verifyOtp(pool, {
      ...body,
      ipAddress: request.ip,
      ...(userAgent ? { userAgent } : {})
    });
  });

  app.post("/auth/logout", async (request, reply) => {
    await revokeSession(pool, request.headers.authorization);
    return reply.code(204).send();
  });
}
