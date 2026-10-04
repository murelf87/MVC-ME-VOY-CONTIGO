import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { readBearerToken, resolveSession } from "../auth/session.js";
import { updateOwnProfile } from "../profiles/profile-service.js";
import {
  createVehicle,
  listOwnVehicles,
  reviewVehicle,
  updateOwnVehicle
} from "../vehicles/vehicle-service.js";
import {
  listOwnPrivateDocuments,
  reviewPrivateDocument
} from "../documents/document-service.js";

async function principal(pool: Pool, authorization: string | undefined) {
  return resolveSession(pool, readBearerToken(authorization));
}

const vehicleBody = {
  type: "object",
  additionalProperties: false,
  required: ["make","model","plate","passengerSeats"],
  properties: {
    make: { type: "string", minLength: 1, maxLength: 80 },
    model: { type: "string", minLength: 1, maxLength: 80 },
    plate: { type: "string", minLength: 2, maxLength: 20 },
    passengerSeats: { type: "integer", minimum: 1, maximum: 8 }
  }
} as const;

export async function registerProfileVehicleRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.patch("/v1/me/profile", {
    schema: {
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        additionalProperties: false,
        required: ["displayName"],
        properties: { displayName: { type: "string", minLength: 2, maxLength: 80 } }
      }
    }
  }, async request => {
    const auth = await principal(pool, request.headers.authorization);
    return updateOwnProfile(pool, auth, request.body as { displayName: string });
  });

  app.get("/v1/me/vehicles", {
    schema: { security: [{ bearerAuth: [] }] }
  }, async request => {
    const auth = await principal(pool, request.headers.authorization);
    return { vehicles: await listOwnVehicles(pool, auth) };
  });

  app.post("/v1/me/vehicles", {
    schema: { security: [{ bearerAuth: [] }], body: vehicleBody }
  }, async (request, reply) => {
    const auth = await principal(pool, request.headers.authorization);
    const vehicle = await createVehicle(pool, auth, request.body as any);
    return reply.code(201).send(vehicle);
  });

  app.put("/v1/me/vehicles/:vehicleId", {
    schema: {
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["vehicleId"],
        properties: { vehicleId: { type: "string", format: "uuid" } }
      },
      body: vehicleBody
    }
  }, async request => {
    const auth = await principal(pool, request.headers.authorization);
    const params = request.params as { vehicleId: string };
    return updateOwnVehicle(pool, auth, params.vehicleId, request.body as any);
  });

  app.get("/v1/me/documents", {
    schema: { security: [{ bearerAuth: [] }] }
  }, async request => {
    const auth = await principal(pool, request.headers.authorization);
    return { documents: await listOwnPrivateDocuments(pool, auth) };
  });

  app.post("/v1/admin/vehicles/:vehicleId/review", {
    schema: {
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["vehicleId"],
        properties: { vehicleId: { type: "string", format: "uuid" } }
      },
      body: {
        type: "object",
        additionalProperties: false,
        required: ["area","decision"],
        properties: {
          area: { type: "string", enum: ["vehicle","documentation"] },
          decision: { type: "string", enum: ["approved","rejected"] },
          reason: { type: "string", maxLength: 1000 }
        }
      }
    }
  }, async request => {
    const auth = await principal(pool, request.headers.authorization);
    const params = request.params as { vehicleId: string };
    return reviewVehicle(pool, auth, params.vehicleId, request.body as any);
  });

  app.post("/v1/admin/documents/:documentId/review", {
    schema: {
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["documentId"],
        properties: { documentId: { type: "string", format: "uuid" } }
      },
      body: {
        type: "object",
        additionalProperties: false,
        required: ["decision"],
        properties: {
          decision: { type: "string", enum: ["approved","rejected"] },
          reason: { type: "string", maxLength: 1000 }
        }
      }
    }
  }, async request => {
    const auth = await principal(pool, request.headers.authorization);
    const params = request.params as { documentId: string };
    return reviewPrivateDocument(pool, auth, params.documentId, request.body as any);
  });
}
