/**
 * Vehículos del conductor y su cumplimiento (`src/vehicles/vehicle-service.ts`, `compliance-service.ts`).
 * Extensión del contrato `trips`: campo opcional `color` (máx. 40).
 */
import { requireAnyRole } from "../core/auth";
import type { PreviewDb } from "../core/db";
import { ApiFailure } from "../core/errors";
import { isUniqueViolation } from "../core/db";
import { newestFirst } from "../core/order";
import type { VehicleRow } from "../core/rows";
import type { Principal } from "../core/types";
import { writeAudit } from "./audit";
import { vehicleListWire, vehicleReviewWire, vehicleSaveWire } from "./wire";

export interface VehicleInput {
  make: string;
  model: string;
  plate: string;
  passengerSeats: number;
  color?: string;
}

function cleanText(value: string, label: string, max: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 1 || normalized.length > max) {
    throw new ApiFailure("INVALID_VEHICLE_FIELD", `${label} is invalid`);
  }
  return normalized;
}

export function normalizePlate(value: string): { display: string; normalized: string } {
  const display = value.trim().toUpperCase().replace(/\s+/g, " ");
  const normalized = display.replace(/[^A-Z0-9]/g, "");
  if (display.length < 2 || display.length > 20 || normalized.length < 2 || normalized.length > 16) {
    throw new ApiFailure("INVALID_VEHICLE_PLATE", "Vehicle plate is invalid");
  }
  return { display, normalized };
}

function seats(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 8) {
    throw new ApiFailure("INVALID_PASSENGER_SEATS", "Passenger seats must be between 1 and 8");
  }
  return value;
}

function cleanColor(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) return null;
  if (normalized.length > 40) throw new ApiFailure("INVALID_VEHICLE_FIELD", "color is invalid");
  return normalized;
}

export function listOwnVehicles(db: PreviewDb, principal: Principal) {
  return newestFirst(
    db.vehicles.filter((v) => v.driver_user_id === principal.userId),
    (v) => v.created_at
  ).map(vehicleListWire);
}

export function createVehicle(db: PreviewDb, principal: Principal, input: VehicleInput, requestId?: string) {
  requireAnyRole(principal, ["driver"]);
  const make = cleanText(input.make, "make", 80);
  const model = cleanText(input.model, "model", 80);
  const plate = normalizePlate(input.plate);
  const passengerSeats = seats(input.passengerSeats);
  const color = cleanColor(input.color);
  const now = db.nowMs();
  try {
    const row = db.vehicles.insert({
      id: db.ids.uuid(),
      driver_user_id: principal.userId,
      make,
      model,
      plate: plate.display,
      plate_normalized: plate.normalized,
      passenger_seats: passengerSeats,
      color,
      review_status: "pending",
      documentation_status: "pending",
      vehicle_photo_status: "pending",
      vehicle_photo_document_id: null,
      insurance_status: "pending",
      insurance_expires_on: null,
      insurance_document_id: null,
      insurance_reviewed_at: null,
      review_reason: null,
      reviewed_by_user_id: null,
      reviewed_at: null,
      created_at: now,
      updated_at: now,
    });
    writeAudit(db, { actorUserId: principal.userId, action: "vehicle.created", entityType: "vehicle", entityId: row.id, requestId: requestId ?? null });
    return vehicleSaveWire(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiFailure("VEHICLE_PLATE_ALREADY_EXISTS", "Vehicle plate already exists", 409);
    throw error;
  }
}

export function updateOwnVehicle(db: PreviewDb, principal: Principal, vehicleId: string, input: VehicleInput, requestId?: string) {
  requireAnyRole(principal, ["driver"]);
  const row = db.vehicles.get(vehicleId);
  if (!row) throw new ApiFailure("VEHICLE_NOT_FOUND", "Vehicle not found", 404);
  if (row.driver_user_id !== principal.userId) {
    throw new ApiFailure("VEHICLE_NOT_OWNED", "You cannot modify another user's vehicle", 403);
  }
  const make = cleanText(input.make, "make", 80);
  const model = cleanText(input.model, "model", 80);
  const plate = normalizePlate(input.plate);
  const passengerSeats = seats(input.passengerSeats);
  const color = input.color === undefined ? row.color : cleanColor(input.color);
  try {
    const updated = db.vehicles.update(vehicleId, {
      make,
      model,
      plate: plate.display,
      plate_normalized: plate.normalized,
      passenger_seats: passengerSeats,
      color,
      review_status: "pending",
      documentation_status: "pending",
      review_reason: null,
      reviewed_by_user_id: null,
      reviewed_at: null,
      updated_at: db.nowMs(),
    });
    writeAudit(db, {
      actorUserId: principal.userId,
      action: "vehicle.updated",
      entityType: "vehicle",
      entityId: vehicleId,
      requestId: requestId ?? null,
      metadata: { reviewReset: true },
    });
    return vehicleSaveWire(updated);
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiFailure("VEHICLE_PLATE_ALREADY_EXISTS", "Vehicle plate already exists", 409);
    throw error;
  }
}

export function reviewVehicle(
  db: PreviewDb,
  principal: Principal,
  vehicleId: string,
  input: { area: "vehicle" | "documentation"; decision: "approved" | "rejected"; reason?: string },
  requestId?: string
) {
  requireAnyRole(principal, ["admin", "verification_admin"]);
  const reason = input.reason?.trim();
  if (input.decision === "rejected" && (!reason || reason.length < 3)) {
    throw new ApiFailure("REVIEW_REASON_REQUIRED", "A rejection reason is required");
  }
  if (reason && reason.length > 1000) throw new ApiFailure("REVIEW_REASON_TOO_LONG", "Review reason is too long");
  if (!db.vehicles.has(vehicleId)) throw new ApiFailure("VEHICLE_NOT_FOUND", "Vehicle not found", 404);
  const now = db.nowMs();
  const patch: Partial<VehicleRow> =
    input.area === "vehicle" ? { review_status: input.decision } : { documentation_status: input.decision };
  const row = db.vehicles.update(vehicleId, {
    ...patch,
    review_reason: reason ?? null,
    reviewed_by_user_id: principal.userId,
    reviewed_at: now,
    updated_at: now,
  });
  writeAudit(db, {
    actorUserId: principal.userId,
    action: "vehicle.reviewed",
    entityType: "vehicle",
    entityId: vehicleId,
    requestId: requestId ?? null,
    metadata: { area: input.area, decision: input.decision, reason: reason ?? null },
  });
  return vehicleReviewWire(row);
}

// ---------------------------------------------------------------------------------------------------------------
// Cumplimiento (compliance-service.ts)
// ---------------------------------------------------------------------------------------------------------------

export interface VehicleComplianceSnapshot {
  vehicleId: string;
  vehiclePhotoStatus: string;
  insuranceStatus: string;
  insuranceExpiresOn: string | null;
}

export function readVehicleCompliance(db: PreviewDb, vehicleId: string): VehicleComplianceSnapshot {
  const row = db.vehicles.get(vehicleId);
  if (!row) throw new ApiFailure("VEHICLE_NOT_FOUND", "Vehicle not found", 404);
  return {
    vehicleId: row.id,
    vehiclePhotoStatus: row.vehicle_photo_status,
    insuranceStatus: row.insurance_status,
    insuranceExpiresOn: row.insurance_expires_on,
  };
}

/** Fecha UTC del reloj virtual (`new Date().toISOString().slice(0, 10)` del backend). */
export function utcToday(db: PreviewDb): string {
  return new Date(db.nowMs()).toISOString().slice(0, 10);
}

export function assertVehicleCanDrive(db: PreviewDb, vehicleId: string): VehicleComplianceSnapshot {
  const state = readVehicleCompliance(db, vehicleId);
  if (state.vehiclePhotoStatus !== "approved") {
    throw new ApiFailure("VEHICLE_PHOTO_REQUIRED", "An approved vehicle photo is required before driving", 409);
  }
  if (state.insuranceStatus !== "approved") {
    throw new ApiFailure("VEHICLE_INSURANCE_REQUIRED", "Approved vehicle insurance is required before driving", 409);
  }
  if (!state.insuranceExpiresOn) {
    throw new ApiFailure("VEHICLE_INSURANCE_EXPIRY_REQUIRED", "Insurance expiry date must be verified before driving", 409);
  }
  if (state.insuranceExpiresOn < utcToday(db)) {
    throw new ApiFailure(
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
    throw new ApiFailure("INVALID_INSURANCE_EXPIRY", "Insurance expiry must use YYYY-MM-DD format");
  }
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new ApiFailure("INVALID_INSURANCE_EXPIRY", "Insurance expiry date is invalid");
  }
  return value;
}

