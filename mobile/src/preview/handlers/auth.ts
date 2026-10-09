/** `/v1/auth/*` (`src/auth/routes.ts`): teléfono → código SMS simulado → sesión opaca. */
import { readBearerToken, revokeSession } from "../core/auth";
import type { PreviewDb } from "../core/db";
import { reply, type PreviewRouter } from "../core/router";
import { beginPhoneVerification, verifyPhoneCode } from "../domain/phoneAuth";

export function registerAuth(r: PreviewRouter, db: PreviewDb): void {
  r.post<{ Body: { phone: string; roles?: unknown } }>(
    "/v1/auth/phone/start",
    {
      summary: "Pedir código por SMS (simulado)",
      tags: ["auth"],
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
              items: { type: "string", enum: ["passenger", "driver"] },
            },
          },
        },
      },
    },
    (req) => reply.accepted(beginPhoneVerification(db, req.body))
  );

  r.post<{ Body: { challengeId: string; code: string } }>(
    "/v1/auth/phone/verify",
    {
      summary: "Comprobar el código y abrir sesión",
      tags: ["auth"],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["challengeId", "code"],
          properties: {
            challengeId: { type: "string", format: "uuid" },
            code: { type: "string", minLength: 4, maxLength: 10 },
          },
        },
      },
    },
    (req) => verifyPhoneCode(db, req.body)
  );

  r.get("/v1/auth/session", { summary: "Sesión actual", tags: ["auth"] }, (req) => {
    const principal = req.auth();
    return {
      user: { id: principal.userId, roles: principal.roles },
      session: { id: principal.sessionId, expiresAt: principal.expiresAt },
    };
  });

  r.post("/v1/auth/logout", { summary: "Cerrar sesión", tags: ["auth"] }, (req) => {
    const token = readBearerToken(req.header("authorization"));
    revokeSession(db, token);
    return reply.noContent();
  });
}

