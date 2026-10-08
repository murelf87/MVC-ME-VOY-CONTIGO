import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { EmailProvider } from "../email/provider.js";
import { PASSWORD_MAX } from "./credentials.js";
import type { AuthServiceConfig } from "./service.js";
import {
  changePassword, confirmEmail, loginWithPassword, registerWithPassword, requestPasswordReset,
  resendEmailVerification, resetPassword
} from "./service.js";
import { readBearerToken, resolveSession, revokeSession } from "./session.js";

const email = { type: "string", minLength: 3, maxLength: 254 };
const password = { type: "string", minLength: 1, maxLength: PASSWORD_MAX };
const code = { type: "string", minLength: 6, maxLength: 6 };
const sec = [{ bearerAuth: [] }];
// Sign-in endpoints get a tighter per-IP limit than the rest of the API.
const strict = { rateLimit: { max: 10, timeWindow: "1 minute" } };

export async function registerAuthRoutes(
  app: FastifyInstance,
  pool: Pool,
  emailProvider: EmailProvider,
  config: AuthServiceConfig
): Promise<void> {
  app.post("/v1/auth/register", {
    config: strict,
    schema: {
      body: {
        type: "object", additionalProperties: false, required: ["email", "password"],
        properties: {
          email, password,
          roles: { type: "array", minItems: 1, maxItems: 2, uniqueItems: true, items: { type: "string", enum: ["passenger", "driver"] } }
        }
      }
    }
  }, async (request, reply) => {
    return reply.code(201).send(await registerWithPassword(pool, emailProvider, config, request.body as any));
  });

  app.post("/v1/auth/login", {
    config: strict,
    schema: { body: { type: "object", additionalProperties: false, required: ["email", "password"], properties: { email, password } } }
  }, async request => loginWithPassword(pool, config, request.body as { email: string; password: string }));

  app.post("/v1/auth/email/resend", { config: strict, schema: { security: sec } }, async request => {
    const principal = await resolveSession(pool, readBearerToken(request.headers.authorization));
    return resendEmailVerification(pool, emailProvider, config, principal.userId);
  });

  app.post("/v1/auth/email/verify", {
    config: strict,
    schema: { security: sec, body: { type: "object", additionalProperties: false, required: ["code"], properties: { code } } }
  }, async request => {
    const principal = await resolveSession(pool, readBearerToken(request.headers.authorization));
    return confirmEmail(pool, principal.userId, (request.body as { code: string }).code);
  });

  app.post("/v1/auth/password/forgot", {
    config: strict,
    schema: { body: { type: "object", additionalProperties: false, required: ["email"], properties: { email } } }
  }, async (request, reply) => reply.code(202).send(await requestPasswordReset(pool, emailProvider, config, request.body as { email: string })));

  app.post("/v1/auth/password/reset", {
    config: strict,
    schema: {
      body: { type: "object", additionalProperties: false, required: ["email", "code", "newPassword"], properties: { email, code, newPassword: password } }
    }
  }, async request => resetPassword(pool, config, request.body as { email: string; code: string; newPassword: string }));

  app.post("/v1/auth/password/change", {
    config: strict,
    schema: {
      security: sec,
      body: { type: "object", additionalProperties: false, required: ["currentPassword", "newPassword"], properties: { currentPassword: password, newPassword: password } }
    }
  }, async request => {
    const principal = await resolveSession(pool, readBearerToken(request.headers.authorization));
    return changePassword(pool, principal.userId, principal.sessionId, request.body as { currentPassword: string; newPassword: string });
  });

  app.get("/v1/auth/session", { schema: { security: sec } }, async request => {
    const principal = await resolveSession(pool, readBearerToken(request.headers.authorization));
    return {
      user: { id: principal.userId, roles: principal.roles },
      session: { id: principal.sessionId, expiresAt: principal.expiresAt }
    };
  });

  app.post("/v1/auth/logout", { schema: { security: sec } }, async (request, reply) => {
    await revokeSession(pool, readBearerToken(request.headers.authorization));
    return reply.code(204).send();
  });
}
