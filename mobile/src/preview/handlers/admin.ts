/** Revisión administrativa existente (`profile-vehicle-routes`): vehículos y documentos privados. */
import type { PreviewDb } from "../core/db";
import type { PreviewRouter } from "../core/router";
import { reviewPrivateDocument } from "../domain/documents";
import { reviewVehicle } from "../domain/vehicles";
import { documentReviewWire } from "../domain/wire";
import { uuidParam } from "./schemas";

export function registerAdminReview(r: PreviewRouter, db: PreviewDb): void {
  r.post<{
    Params: { vehicleId: string };
    Body: { area: "vehicle" | "documentation"; decision: "approved" | "rejected"; reason?: string; verifiedExpiresOn?: string };
  }>(
    "/v1/admin/vehicles/:vehicleId/review",
    {
      summary: "Revisar un vehículo (personal de verificación)",
      tags: ["admin"],
      schema: {
        params: uuidParam("vehicleId"),
        body: {
          type: "object",
          additionalProperties: false,
          required: ["area", "decision"],
          properties: {
            area: { type: "string", enum: ["vehicle", "documentation"] },
            decision: { type: "string", enum: ["approved", "rejected"] },
            reason: { type: "string", maxLength: 1000 },
            verifiedExpiresOn: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          },
        },
      },
    },
    (req) => reviewVehicle(db, req.auth(), req.params.vehicleId, req.body, req.requestId)
  );

  r.post<{
    Params: { documentId: string };
    Body: { decision: "approved" | "rejected"; reason?: string; verifiedExpiresOn?: string };
  }>(
    "/v1/admin/documents/:documentId/review",
    {
      summary: "Revisar un documento privado (personal de verificación)",
      tags: ["admin"],
      schema: {
        params: uuidParam("documentId"),
        body: {
          type: "object",
          additionalProperties: false,
          required: ["decision"],
          properties: {
            decision: { type: "string", enum: ["approved", "rejected"] },
            reason: { type: "string", maxLength: 1000 },
            // El backend 0.14 descarta este campo (su schema no lo declara) y por eso un seguro nunca se puede aprobar
            // con fecha manual por HTTP; la vista previa lo admite para que el flujo de administración sea probable.
            verifiedExpiresOn: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          },
        },
      },
    },
    (req) => documentReviewWire(reviewPrivateDocument(db, req.auth(), req.params.documentId, req.body, req.requestId))
  );
}
