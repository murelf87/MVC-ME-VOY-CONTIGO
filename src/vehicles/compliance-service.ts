import type { PoolClient, QueryResultRow } from "pg";
import { DomainError } from "../errors.js";

export type VehicleComplianceSnapshot = {
  vehicleId: string;
  vehiclePhotoStatus: string;
  insuranceStatus: string;
  insuranceExpiresOn: string | null;
};

function isoDate(value: unknown): string | null {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export async function readVehicleCompliance(
  client: Pick<PoolClient, "query">,
  vehicleId: string
): Promise<VehicleComplianceSnapshot> {
  const result = await client.query<{
    id: string;
    vehicle_photo_status: string;
    insurance_status: string;
    insurance_expires_on: string | Date | null;
  }>(
    `select id,vehicle_photo_status,insurance_status,insurance_expires_on
       from vehicles
      where id=$1`,
    [vehicleId]
  );
  const row = result.rows[0];
  if (!row) throw new DomainError("VEHICLE_NOT_FOUND", "Vehicle not found", 404);

  return {
    vehicleId: row.id,
    vehiclePhotoStatus: row.vehicle_photo_status,
    insuranceStatus: row.insurance_status,
    insuranceExpiresOn: isoDate(row.insurance_expires_on)
  };
}

export async function assertVehicleCanDrive(
  client: Pick<PoolClient, "query">,
  vehicleId: string
): Promise<VehicleComplianceSnapshot> {
  const state = await readVehicleCompliance(client, vehicleId);

  if (state.vehiclePhotoStatus !== "approved") {
    throw new DomainError(
      "VEHICLE_PHOTO_REQUIRED",
      "An approved vehicle photo is required before driving",
      409
    );
  }

  if (state.insuranceStatus !== "approved") {
    throw new DomainError(
      "VEHICLE_INSURANCE_REQUIRED",
      "Approved vehicle insurance is required before driving",
      409
    );
  }

  if (!state.insuranceExpiresOn) {
    throw new DomainError(
      "VEHICLE_INSURANCE_EXPIRY_REQUIRED",
      "Insurance expiry date must be verified before driving",
      409
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  if (state.insuranceExpiresOn < today) {
    throw new DomainError(
      "VEHICLE_INSURANCE_EXPIRED",
      "Vehicle insurance has expired. Upload and validate the renewal before driving",
      409,
      { expiresOn: state.insuranceExpiresOn }
    );
  }

  return state;
}

export function validateInsuranceExpiry(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new DomainError(
      "INVALID_INSURANCE_EXPIRY",
      "Insurance expiry must use YYYY-MM-DD format"
    );
  }
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new DomainError("INVALID_INSURANCE_EXPIRY", "Insurance expiry date is invalid");
  }
  return value;
}
