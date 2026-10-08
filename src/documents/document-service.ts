import type { Pool } from "pg";
import type { AuthPrincipal } from "../auth/session.js";
import { requireAnyRole } from "../auth/session.js";
import { DomainError } from "../errors.js";
import { validateInsuranceExpiry } from "../vehicles/compliance-service.js";

export type PrivateDocumentKind =
  | "identity_document"
  | "driver_license"
  | "vehicle_registration"
  | "vehicle_insurance"
  | "vehicle_photo"
  | "other";

export type VerifiedPrivateObject = {
  storageProvider: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
};

export type InsuranceAnalysisInput = {
  status: "succeeded" | "needs_review" | "failed";
  detectedExpiresOn?: string;
  confidence?: number;
  provider: string;
  reference?: string;
};

const VEHICLE_KINDS = new Set<PrivateDocumentKind>([
  "vehicle_registration",
  "vehicle_insurance",
  "vehicle_photo"
]);

function validateObject(object: VerifiedPrivateObject): void {
  if (!object.storageProvider.trim() || !object.storageKey.trim()) {
    throw new DomainError("INVALID_PRIVATE_OBJECT", "Private object reference is invalid");
  }
  if (!/^[0-9a-f]{64}$/.test(object.sha256)) {
    throw new DomainError("INVALID_DOCUMENT_SHA256", "Document SHA-256 is invalid");
  }
  if (!Number.isSafeInteger(object.sizeBytes) || object.sizeBytes < 1 || object.sizeBytes > 20 * 1024 * 1024) {
    throw new DomainError("INVALID_DOCUMENT_SIZE", "Document size must be between 1 byte and 20 MiB");
  }
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(object.contentType)) {
    throw new DomainError("INVALID_DOCUMENT_CONTENT_TYPE", "Document content type is invalid");
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function registerVerifiedPrivateDocument(
  pool: Pool,
  principal: AuthPrincipal,
  input: {
    kind: PrivateDocumentKind;
    vehicleId?: string;
    object: VerifiedPrivateObject;
  }
) {
  validateObject(input.object);
  const isVehicleKind = VEHICLE_KINDS.has(input.kind);

  if (isVehicleKind && !input.vehicleId) {
    throw new DomainError("VEHICLE_DOCUMENT_REQUIRES_VEHICLE", "Vehicle document requires a vehicle");
  }
  if (!isVehicleKind && input.vehicleId) {
    throw new DomainError("DOCUMENT_VEHICLE_MISMATCH", "This document kind cannot be attached to a vehicle");
  }

  if (input.vehicleId) {
    const vehicle = await pool.query(
      `select driver_user_id from vehicles where id=$1`,
      [input.vehicleId]
    );
    if (!vehicle.rowCount) throw new DomainError("VEHICLE_NOT_FOUND", "Vehicle not found", 404);
    if (vehicle.rows[0].driver_user_id !== principal.userId) {
      throw new DomainError("VEHICLE_NOT_OWNED", "You cannot attach a document to another user's vehicle", 403);
    }
  }

  const analysisStatus = input.kind === "vehicle_insurance" ? "pending" : "not_required";

  const result = await pool.query(
    `insert into private_documents(
       owner_user_id,vehicle_id,kind,storage_provider,storage_key,
       content_type,size_bytes,sha256,review_status,analysis_status
     ) values($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)
     returning id,vehicle_id,kind,content_type,size_bytes,sha256,review_status,
               analysis_status,detected_expires_on,verified_expires_on,
               created_at,updated_at`,
    [
      principal.userId, input.vehicleId ?? null, input.kind,
      input.object.storageProvider, input.object.storageKey,
      input.object.contentType, input.object.sizeBytes, input.object.sha256,
      analysisStatus
    ]
  );

  if (input.kind === "identity_document") {
    await pool.query(
      `update profiles set identity_status='pending',updated_at=now() where user_id=$1`,
      [principal.userId]
    );
  }

  if (input.vehicleId) {
    if (input.kind === "vehicle_photo") {
      await pool.query(
        `update vehicles
            set vehicle_photo_status=case
                  when vehicle_photo_status='approved' and vehicle_photo_document_id is not null
                    then vehicle_photo_status
                  else 'pending'::vehicle_review_status
                end,
                updated_at=now()
          where id=$1`,
        [input.vehicleId]
      );
    } else if (input.kind === "vehicle_insurance") {
      await pool.query(
        `update vehicles
            set insurance_status=case
                  when insurance_status='approved'
                   and insurance_expires_on is not null
                   and insurance_expires_on >= current_date
                    then insurance_status
                  else 'pending'::vehicle_review_status
                end,
                updated_at=now()
          where id=$1`,
        [input.vehicleId]
      );
    } else {
      await pool.query(
        `update vehicles set documentation_status='pending',updated_at=now() where id=$1`,
        [input.vehicleId]
      );
    }
  }

  const row = result.rows[0];
  await pool.query(
    `insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
     values($1,'private_document.registered','private_document',$2,$3::jsonb)`,
    [principal.userId, row.id, JSON.stringify({ kind: input.kind, vehicleId: input.vehicleId ?? null })]
  );
  return row;
}

export async function recordInsuranceAnalysisResult(
  pool: Pool,
  documentId: string,
  input: InsuranceAnalysisInput
) {
  const confidence = input.confidence;
  if (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    throw new DomainError("INVALID_ANALYSIS_CONFIDENCE", "Analysis confidence must be between 0 and 1");
  }

  let detectedExpiresOn: string | null = null;
  if (input.detectedExpiresOn) {
    detectedExpiresOn = validateInsuranceExpiry(input.detectedExpiresOn);
  }
  if (input.status === "succeeded" && !detectedExpiresOn) {
    throw new DomainError(
      "INSURANCE_EXPIRY_NOT_DETECTED",
      "Successful insurance analysis requires a detected expiry date"
    );
  }

  const result = await pool.query(
    `update private_documents
        set analysis_status=$2,
            detected_expires_on=$3::date,
            analysis_confidence=$4,
            analyzer_provider=$5,
            analyzer_reference=$6,
            analyzed_at=now(),
            updated_at=now()
      where id=$1 and kind='vehicle_insurance'
      returning id,vehicle_id,analysis_status,detected_expires_on,analysis_confidence,
                analyzer_provider,analyzer_reference,analyzed_at`,
    [
      documentId,
      input.status,
      detectedExpiresOn,
      confidence ?? null,
      input.provider.trim(),
      input.reference?.trim() || null
    ]
  );
  if (!result.rowCount) {
    throw new DomainError("INSURANCE_DOCUMENT_NOT_FOUND", "Insurance document not found", 404);
  }
  return result.rows[0];
}

export async function listOwnPrivateDocuments(pool: Pool, principal: AuthPrincipal) {
  return (await pool.query(
    `select id,vehicle_id,kind,content_type,size_bytes,sha256,
            review_status,review_reason,reviewed_at,
            analysis_status,detected_expires_on,verified_expires_on,
            analysis_confidence,analyzer_provider,analyzed_at,expiry_verification_source,
            created_at,updated_at
       from private_documents
      where owner_user_id=$1
      order by created_at desc`,
    [principal.userId]
  )).rows;
}

export async function reviewPrivateDocument(
  pool: Pool,
  principal: AuthPrincipal,
  documentId: string,
  input: {
    decision: "approved" | "rejected";
    reason?: string;
    verifiedExpiresOn?: string;
  }
) {
  requireAnyRole(principal, ["admin","verification_admin"]);
  const reason = input.reason?.trim();
  if (input.decision === "rejected" && (!reason || reason.length < 3)) {
    throw new DomainError("REVIEW_REASON_REQUIRED", "A rejection reason is required");
  }
  if (reason && reason.length > 1000) {
    throw new DomainError("REVIEW_REASON_TOO_LONG", "Review reason is too long");
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const found = await client.query(
      `select * from private_documents where id=$1 for update`,
      [documentId]
    );
    const document = found.rows[0];
    if (!document) throw new DomainError("DOCUMENT_NOT_FOUND", "Document not found", 404);

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
        verifiedExpiresOn = new Date(document.detected_expires_on).toISOString().slice(0, 10);
        expirySource = "automatic";
      } else {
        throw new DomainError(
          "INSURANCE_EXPIRY_REVIEW_REQUIRED",
          "Insurance expiry must be detected with sufficient confidence or manually verified"
        );
      }

      if (verifiedExpiresOn < todayIso()) {
        throw new DomainError(
          "VEHICLE_INSURANCE_EXPIRED",
          "Expired insurance cannot be approved",
          409,
          { expiresOn: verifiedExpiresOn }
        );
      }
    }

    const updated = await client.query(
      `update private_documents
          set review_status=$2::profile_review_status,
              review_reason=$3,
              reviewed_by_user_id=$4,
              reviewed_at=now(),
              verified_expires_on=coalesce($5::date,verified_expires_on),
              expiry_verification_source=coalesce($6,expiry_verification_source),
              updated_at=now()
        where id=$1
        returning id,owner_user_id,vehicle_id,kind,content_type,size_bytes,sha256,
                  review_status,review_reason,reviewed_at,analysis_status,
                  detected_expires_on,verified_expires_on,analysis_confidence,
                  expiry_verification_source`,
      [
        documentId,
        input.decision,
        reason ?? null,
        principal.userId,
        verifiedExpiresOn,
        expirySource
      ]
    );

    if (document.kind === "identity_document") {
      await client.query(
        `update profiles
            set identity_status=$2::identity_status,updated_at=now()
          where user_id=$1`,
        [document.owner_user_id, input.decision === "approved" ? "verified" : "rejected"]
      );
    }

    if (document.kind === "vehicle_photo" && document.vehicle_id) {
      if (input.decision === "approved") {
        await client.query(
          `update vehicles
              set vehicle_photo_status='approved',
                  vehicle_photo_document_id=$2,
                  updated_at=now()
            where id=$1`,
          [document.vehicle_id, documentId]
        );
      } else {
        await client.query(
          `update vehicles
              set vehicle_photo_status=case
                    when vehicle_photo_document_id is null then 'rejected'::vehicle_review_status
                    else vehicle_photo_status
                  end,
                  updated_at=now()
            where id=$1`,
          [document.vehicle_id]
        );
      }
    }

    if (document.kind === "vehicle_insurance" && document.vehicle_id) {
      if (input.decision === "approved" && verifiedExpiresOn) {
        await client.query(
          `update vehicles
              set insurance_status='approved',
                  insurance_expires_on=$2::date,
                  insurance_document_id=$3,
                  insurance_reviewed_at=now(),
                  updated_at=now()
            where id=$1`,
          [document.vehicle_id, verifiedExpiresOn, documentId]
        );
      } else if (input.decision === "rejected") {
        await client.query(
          `update vehicles
              set insurance_status=case
                    when insurance_document_id is null
                      or insurance_expires_on is null
                      or insurance_expires_on < current_date
                    then 'rejected'::vehicle_review_status
                    else insurance_status
                  end,
                  updated_at=now()
            where id=$1`,
          [document.vehicle_id]
        );
      }
    }

    await client.query(
      `insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
       values($1,'private_document.reviewed','private_document',$2,$3::jsonb)`,
      [principal.userId, documentId, JSON.stringify({
        decision: input.decision,
        reason: reason ?? null,
        verifiedExpiresOn,
        expirySource
      })]
    );
    await client.query("commit");
    return updated.rows[0];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
