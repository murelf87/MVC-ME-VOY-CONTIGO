import type { Pool } from "pg";
import type { AuthPrincipal } from "../auth/session.js";
import { requireAnyRole } from "../auth/session.js";
import { DomainError } from "../errors.js";

export type PrivateDocumentKind =
  | "identity_document"
  | "driver_license"
  | "vehicle_registration"
  | "vehicle_insurance"
  | "other";

export type VerifiedPrivateObject = {
  storageProvider: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
};

const VEHICLE_KINDS = new Set<PrivateDocumentKind>([
  "vehicle_registration",
  "vehicle_insurance"
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

  const result = await pool.query(
    `insert into private_documents(
       owner_user_id,vehicle_id,kind,storage_provider,storage_key,
       content_type,size_bytes,sha256,review_status
     ) values($1,$2,$3,$4,$5,$6,$7,$8,'pending')
     returning id,vehicle_id,kind,content_type,size_bytes,sha256,review_status,created_at,updated_at`,
    [
      principal.userId, input.vehicleId ?? null, input.kind,
      input.object.storageProvider, input.object.storageKey,
      input.object.contentType, input.object.sizeBytes, input.object.sha256
    ]
  );

  if (input.kind === "identity_document") {
    await pool.query(
      `update profiles set identity_status='pending',updated_at=now() where user_id=$1`,
      [principal.userId]
    );
  }
  if (input.vehicleId) {
    await pool.query(
      `update vehicles set documentation_status='pending',updated_at=now() where id=$1`,
      [input.vehicleId]
    );
  }

  const row = result.rows[0];
  await pool.query(
    `insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
     values($1,'private_document.registered','private_document',$2,$3::jsonb)`,
    [principal.userId, row.id, JSON.stringify({ kind: input.kind, vehicleId: input.vehicleId ?? null })]
  );
  return row;
}

export async function listOwnPrivateDocuments(pool: Pool, principal: AuthPrincipal) {
  return (await pool.query(
    `select id,vehicle_id,kind,content_type,size_bytes,sha256,
            review_status,review_reason,reviewed_at,created_at,updated_at
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
  input: { decision: "approved" | "rejected"; reason?: string }
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

    const updated = await client.query(
      `update private_documents
          set review_status=$2::profile_review_status,
              review_reason=$3,reviewed_by_user_id=$4,reviewed_at=now(),updated_at=now()
        where id=$1
        returning id,owner_user_id,vehicle_id,kind,content_type,size_bytes,sha256,
                  review_status,review_reason,reviewed_at`,
      [documentId, input.decision, reason ?? null, principal.userId]
    );

    if (document.kind === "identity_document") {
      await client.query(
        `update profiles
            set identity_status=$2::identity_status,updated_at=now()
          where user_id=$1`,
        [document.owner_user_id, input.decision === "approved" ? "verified" : "rejected"]
      );
    }

    await client.query(
      `insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
       values($1,'private_document.reviewed','private_document',$2,$3::jsonb)`,
      [principal.userId, documentId, JSON.stringify({
        decision: input.decision, reason: reason ?? null
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
