/** Perfil, vehículos, documentos y subidas privadas del usuario (`me-routes`, `profile-vehicle-routes`, `private-upload-routes`). */
import type { PreviewDb } from "../core/db";
import { reply, type PreviewRouter } from "../core/router";
import { listOwnPrivateDocuments } from "../domain/documents";
import { getMe, updateOwnProfile } from "../domain/profile";
import {
  completePrivateUploadIntent,
  createOwnDocumentDownloadUrl,
  createPrivateUploadIntent,
  type PrivateUploadKind,
} from "../domain/uploads";
import { createVehicle, listOwnVehicles, updateOwnVehicle, type VehicleInput } from "../domain/vehicles";
import { uuidParam, vehicleBody } from "./schemas";

export function registerMe(r: PreviewRouter, db: PreviewDb): void {
  r.get("/me", { summary: "Mi usuario, perfil y roles", tags: ["me"] }, (req) => getMe(db, req.auth()));

  r.patch<{ Body: { displayName: string } }>(
    "/v1/me/profile",
    {
      summary: "Editar nombre público",
      tags: ["me"],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["displayName"],
          properties: { displayName: { type: "string", minLength: 2, maxLength: 80 } },
        },
      },
    },
    (req) => updateOwnProfile(db, req.auth(), req.body, req.requestId)
  );

  r.get("/v1/me/vehicles", { summary: "Mis vehículos", tags: ["vehicles"] }, (req) => ({
    vehicles: listOwnVehicles(db, req.auth()),
  }));

  r.post<{ Body: VehicleInput }>(
    "/v1/me/vehicles",
    { summary: "Dar de alta un vehículo", tags: ["vehicles"], schema: { body: vehicleBody } },
    (req) => reply.created(createVehicle(db, req.auth(), req.body, req.requestId))
  );

  r.put<{ Params: { vehicleId: string }; Body: VehicleInput }>(
    "/v1/me/vehicles/:vehicleId",
    {
      summary: "Editar un vehículo (reinicia su revisión)",
      tags: ["vehicles"],
      schema: { params: uuidParam("vehicleId"), body: vehicleBody },
    },
    (req) => updateOwnVehicle(db, req.auth(), req.params.vehicleId, req.body, req.requestId)
  );

  r.get("/v1/me/documents", { summary: "Mis documentos privados", tags: ["documents"] }, (req) => ({
    documents: listOwnPrivateDocuments(db, req.auth()),
  }));

  r.post<{ Body: { kind: PrivateUploadKind; vehicleId: string; contentType: string; sizeBytes: number } }>(
    "/v1/me/uploads/intents",
    {
      summary: "Pedir URL firmada para subir foto o seguro del vehículo",
      tags: ["documents"],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "vehicleId", "contentType", "sizeBytes"],
          properties: {
            kind: { type: "string", enum: ["vehicle_photo", "vehicle_insurance"] },
            vehicleId: { type: "string", format: "uuid" },
            contentType: { type: "string", minLength: 3, maxLength: 120 },
            sizeBytes: { type: "integer", minimum: 1, maximum: 20_971_520 },
          },
        },
      },
    },
    (req) => reply.created(createPrivateUploadIntent(db, req.auth(), req.body))
  );

  r.post<{ Params: { intentId: string } }>(
    "/v1/me/uploads/:intentId/complete",
    { summary: "Confirmar una subida y registrar el documento", tags: ["documents"], schema: { params: uuidParam("intentId") } },
    (req) => completePrivateUploadIntent(db, req.auth(), req.params.intentId, req.requestId)
  );

  r.get<{ Params: { documentId: string } }>(
    "/v1/me/documents/:documentId/download",
    { summary: "URL firmada para ver un documento propio", tags: ["documents"], schema: { params: uuidParam("documentId") } },
    (req) => createOwnDocumentDownloadUrl(db, req.auth(), req.params.documentId)
  );
}
