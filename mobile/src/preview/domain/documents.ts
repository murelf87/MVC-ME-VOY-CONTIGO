/** Documentos privados (`src/documents/document-service.ts`): registro, análisis del seguro, listado y revisión. */
import { requireAnyRole } from "../core/auth";
import type { PreviewDb } from "../core/db";
import { ApiFailure } from "../core/errors";
import { newestFirst } from "../core/order";
import type { AnalysisStatus, DocumentKind, DocumentRow, VehicleRow } from "../core/rows";
import type { Principal } from "../core/types";
import { writeAudit } from "./audit";
import { utcToday, validateInsuranceExpiry } from "./vehicles";
import { documentListWire } from "./wire";

export type PrivateDocumentKind = DocumentKind;

export interface VerifiedPrivateObject {
  storageProvider: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
}

export interface InsuranceAnalysisInput {
  status: "succeeded" | "needs_review" | "failed";
  detectedExpiresOn?: string;
  confidence?: number;
  provider: string;
  reference?: string;
}

const VEHICLE_KINDS = new Set<PrivateDocumentKind>(["vehicle_registration", "vehicle_insurance", "vehicle_photo"]);

function validateObject(object: VerifiedPrivateObject): void {
  if (!object.storageProvider.trim() || !object.storageKey.trim()) {
    throw new ApiFailure("INVALID_PRIVATE_OBJECT", "Private object reference is invalid");
  }
  if (!/^[0-9a-f]{64}$/.test(object.sha256)) throw new ApiFailure("INVALID_DOCUMENT_SHA256", "Document SHA-256 is invalid");
  if (!Number.isSafeInteger(object.sizeBytes) || object.sizeBytes < 1 || object.sizeBytes > 20 * 1024 * 1024) {
    throw new ApiFailure("INVALID_DOCUMENT_SIZE", "Document size must be between 1 byte and 20 MiB");
  }
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(object.contentType)) {
    throw new ApiFailure("INVALID_DOCUMENT_CONTENT_TYPE", "Document content type is invalid");
  }
}

export function registerVerifiedPrivateDocument(
  db: PreviewDb,
  principal: Principal,
  input: { kind: PrivateDocumentKind; vehicleId?: string; object: VerifiedPrivateObject },
  requestId?: string
): Readonly<DocumentRow> {
  validateObject(input.object);
  const isVehicleKind = VEHICLE_KINDS.has(input.kind);
  if (isVehicleKind && !input.vehicleId) {
    throw new ApiFailure("VEHICLE_DOCUMENT_REQUIRES_VEHICLE", "Vehicle document requires a vehicle");
  }
  if (!isVehicleKind && input.vehicleId) {
    throw new ApiFailure("DOCUMENT_VEHICLE_MISMATCH", "This document kind cannot be attached to a vehicle");
  }
  if (input.vehicleId) {
    const vehicle = db.vehicles.get(input.vehicleId);
    if (!vehicle) throw new ApiFailure("VEHICLE_NOT_FOUND", "Vehicle not found", 404);
    if (vehicle.driver_user_id !== principal.userId) {
      throw new ApiFailure("VEHICLE_NOT_OWNED", "You cannot attach a document to another user's vehicle", 403);
    }
  }

  return db.tx(() => {
    const now = db.nowMs();
    const analysis: AnalysisStatus = input.kind === "vehicle_insurance" ? "pending" : "not_required";
    const row = db.documents.insert({
      id: db.ids.uuid(),
      owner_user_id: principal.userId,
      vehicle_id: input.vehicleId ?? null,
      kind: input.kind,
      storage_provider: input.object.storageProvider,
      storage_key: input.object.storageKey,
      content_type: input.object.contentType,
      size_bytes: input.object.sizeBytes,
      sha256: input.object.sha256,
      review_status: "pending",
      review_reason: null,
      reviewed_by_user_id: null,
      reviewed_at: null,
      analysis_status: analysis,
      detected_expires_on: null,
      verified_expires_on: null,
      analysis_confidence: null,
      analyzer_provider: null,
      analyzer_reference: null,
      analyzed_at: null,
      expiry_verification_source: null,
      created_at: now,
      updated_at: now,
    });

    if (input.kind === "identity_document") {
      db.profiles.update(principal.userId, { identity_status: "pending", updated_at: now });
    }

    if (input.vehicleId) {
      const vehicle = db.vehicles.get(input.vehicleId) as Readonly<VehicleRow>;
      if (input.kind === "vehicle_photo") {
        const keep = vehicle.vehicle_photo_status === "approved" && vehicle.vehicle_photo_document_id !== null;
        db.vehicles.update(vehicle.id, { vehicle_photo_status: keep ? vehicle.vehicle_photo_status : "pending", updated_at: now });
      } else if (input.kind === "vehicle_insurance") {
        const keep =
          vehicle.insurance_status === "approved" &&
          vehicle.insurance_expires_on !== null &&
          vehicle.insurance_expires_on >= utcToday(db);
        db.vehicles.update(vehicle.id, { insurance_status: keep ? vehicle.insurance_status : "pending", updated_at: now });
      } else {
        db.vehicles.update(vehicle.id, { documentation_status: "pending", updated_at: now });
      }
    }

    writeAudit(db, {
      actorUserId: principal.userId,
      action: "private_document.registered",
      entityType: "private_document",
      entityId: row.id,
      requestId: requestId ?? null,
      metadata: { kind: input.kind, vehicleId: input.vehicleId ?? null },
    });
    return row;
  });
}

/** Resultado del análisis (OCR) del seguro. La vista previa NO tiene OCR (como el backend con `disabled`), pero los escenarios pueden fijarlo. */
export function recordInsuranceAnalysisResult(db: PreviewDb, documentId: string, input: InsuranceAnalysisInput) {
  const confidence = input.confidence;
  if (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    throw new ApiFailure("INVALID_ANALYSIS_CONFIDENCE", "Analysis confidence must be between 0 and 1");
  }
  let detected: string | null = null;
  if (input.detectedExpiresOn) detected = validateInsuranceExpiry(input.detectedExpiresOn);
  if (input.status === "succeeded" && !detected) {
    throw new ApiFailure("INSURANCE_EXPIRY_NOT_DETECTED", "Successful insurance analysis requires a detected expiry date");
  }
  const doc = db.documents.get(documentId);
  if (!doc || doc.kind !== "vehicle_insurance") {
    throw new ApiFailure("INSURANCE_DOCUMENT_NOT_FOUND", "Insurance document not found", 404);
  }
  const now = db.nowMs();
  return db.documents.update(documentId, {
    analysis_status: input.status,
    detected_expires_on: detected,
    analysis_confidence: confidence ?? null,
    analyzer_provider: input.provider.trim(),
    analyzer_reference: input.reference?.trim() || null,
    analyzed_at: now,
    updated_at: now,
  });
}

export function listOwnPrivateDocuments(db: PreviewDb, principal: Principal) {
  return newestFirst(
    db.documents.filter((d) => d.owner_user_id === principal.userId),
    (d) => d.created_at
  ).map(documentListWire);
}

export function reviewPrivateDocument(
  db: PreviewDb,
  principal: Principal,
  documentId: string,
  input: { decision: "approved" | "rejected"; reason?: string; verifiedExpiresOn?: string },
  requestId?: string
): Readonly<DocumentRow> {
  requireAnyRole(principal, ["admin", "verification_admin"]);
  const reason = input.reason?.trim();
  if (input.decision === "rejected" && (!reason || reason.length < 3)) {
    throw new ApiFailure("REVIEW_REASON_REQUIRED", "A rejection reason is required");
  }
  if (reason && reason.length > 1000) throw new ApiFailure("REVIEW_REASON_TOO_LONG", "Review reason is too long");

  return db.tx(() => {
    const document = db.documents.get(documentId);
    if (!document) throw new ApiFailure("DOCUMENT_NOT_FOUND", "Document not found", 404);

    let verifiedExpiresOn: string | null = null;
    let expirySource: "automatic" | "manual" | null = null;

    if (document.kind === "vehicle_insurance" && input.decision === "approved") {
      if (input.verifiedExpiresOn) {
        verifiedExpiresOn = validateInsuranceExpiry(input.verifiedExpiresOn);
        expirySource = "manual";
      } else if (
        document.analysis_status === "succeeded" &&
        document.detected_expires_on &&
        Number(document.analysis_confidence ?? 0) >= 0.75
      ) {
        verifiedExpiresOn = document.detected_expires_on;
        expirySource = "automatic";
      } else {
        throw new ApiFailure(
          "INSURANCE_EXPIRY_REVIEW_REQUIRED",
          "Insurance expiry must be detected with sufficient confidence or manually verified"
        );
      }
      if (verifiedExpiresOn < utcToday(db)) {
        throw new ApiFailure("VEHICLE_INSURANCE_EXPIRED", "Expired insurance cannot be approved", 409, {
          expiresOn: verifiedExpiresOn,
        });
      }
    }

    const now = db.nowMs();
    const updated = db.documents.update(documentId, {
      review_status: input.decision,
      review_reason: reason ?? null,
      reviewed_by_user_id: principal.userId,
      reviewed_at: now,
      verified_expires_on: verifiedExpiresOn ?? document.verified_expires_on,
      expiry_verification_source: expirySource ?? document.expiry_verification_source,
      updated_at: now,
    });

    if (document.kind === "identity_document") {
      db.profiles.update(document.owner_user_id, {
        identity_status: input.decision === "approved" ? "verified" : "rejected",
        updated_at: now,
      });
    }

    if (document.kind === "vehicle_photo" && document.vehicle_id) {
      const vehicle = db.vehicles.get(document.vehicle_id);
      if (vehicle) {
        if (input.decision === "approved") {
          db.vehicles.update(vehicle.id, { vehicle_photo_status: "approved", vehicle_photo_document_id: documentId, updated_at: now });
        } else if (vehicle.vehicle_photo_document_id === null) {
          db.vehicles.update(vehicle.id, { vehicle_photo_status: "rejected", updated_at: now });
        } else {
          db.vehicles.update(vehicle.id, { updated_at: now });
        }
      }
    }

    if (document.kind === "vehicle_insurance" && document.vehicle_id) {
      const vehicle = db.vehicles.get(document.vehicle_id);
      if (vehicle) {
        if (input.decision === "approved" && verifiedExpiresOn) {
          db.vehicles.update(vehicle.id, {
            insurance_status: "approved",
            insurance_expires_on: verifiedExpiresOn,
            insurance_document_id: documentId,
            insurance_reviewed_at: now,
            updated_at: now,
          });
        } else if (input.decision === "rejected") {
          const downgrade =
            vehicle.insurance_document_id === null ||
            vehicle.insurance_expires_on === null ||
            vehicle.insurance_expires_on < utcToday(db);
          db.vehicles.update(vehicle.id, { insurance_status: downgrade ? "rejected" : vehicle.insurance_status, updated_at: now });
        }
      }
    }

    writeAudit(db, {
      actorUserId: principal.userId,
      action: "private_document.reviewed",
      entityType: "private_document",
      entityId: documentId,
      requestId: requestId ?? null,
      metadata: { decision: input.decision, reason: reason ?? null, verifiedExpiresOn, expirySource },
    });
    return updated;
  });
}
