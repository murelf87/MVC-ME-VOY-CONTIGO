import type { Pool } from "pg";
import type { AuthPrincipal } from "../auth/session.js";
import { requireAnyRole } from "../auth/session.js";
import { DomainError } from "../errors.js";

export type VehicleInput = {
  make: string;
  model: string;
  plate: string;
  passengerSeats: number;
};

function cleanText(value: string, label: string, max: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 1 || normalized.length > max) {
    throw new DomainError("INVALID_VEHICLE_FIELD", `${label} is invalid`);
  }
  return normalized;
}

export function normalizePlate(value: string): { display: string; normalized: string } {
  const display = value.trim().toUpperCase().replace(/\s+/g, " ");
  const normalized = display.replace(/[^A-Z0-9]/g, "");
  if (display.length < 2 || display.length > 20 || normalized.length < 2 || normalized.length > 16) {
    throw new DomainError("INVALID_VEHICLE_PLATE", "Vehicle plate is invalid");
  }
  return { display, normalized };
}

function seats(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 8) {
    throw new DomainError("INVALID_PASSENGER_SEATS", "Passenger seats must be between 1 and 8");
  }
  return value;
}

export async function listOwnVehicles(pool: Pool, principal: AuthPrincipal) {
  return (await pool.query(
    `select id,make,model,plate,passenger_seats,review_status,documentation_status,
            vehicle_photo_status,vehicle_photo_document_id,
            insurance_status,insurance_expires_on,insurance_document_id,insurance_reviewed_at,
            review_reason,reviewed_at,created_at,updated_at
       from vehicles
      where driver_user_id=$1
      order by created_at desc`,
    [principal.userId]
  )).rows;
}

export async function createVehicle(
  pool: Pool,
  principal: AuthPrincipal,
  input: VehicleInput
) {
  requireAnyRole(principal, ["driver"]);
  const make = cleanText(input.make, "make", 80);
  const model = cleanText(input.model, "model", 80);
  const plate = normalizePlate(input.plate);
  const passengerSeats = seats(input.passengerSeats);

  try {
    const result = await pool.query(
      `insert into vehicles(
         driver_user_id,make,model,plate,passenger_seats,
         review_status,documentation_status
       ) values($1,$2,$3,$4,$5,'pending','pending')
       returning id,make,model,plate,passenger_seats,review_status,documentation_status,
                 vehicle_photo_status,insurance_status,insurance_expires_on,created_at,updated_at`,
      [principal.userId, make, model, plate.display, passengerSeats]
    );
    const row = result.rows[0];
    await pool.query(
      `insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
       values($1,'vehicle.created','vehicle',$2,'{}'::jsonb)`,
      [principal.userId, row.id]
    );
    return row;
  } catch (error: any) {
    if (error?.code === "23505") {
      throw new DomainError("VEHICLE_PLATE_ALREADY_EXISTS", "Vehicle plate already exists", 409);
    }
    throw error;
  }
}

export async function updateOwnVehicle(
  pool: Pool,
  principal: AuthPrincipal,
  vehicleId: string,
  input: VehicleInput
) {
  requireAnyRole(principal, ["driver"]);
  const current = await pool.query(
    `select * from vehicles where id=$1 for update`,
    [vehicleId]
  );
  const row = current.rows[0];
  if (!row) throw new DomainError("VEHICLE_NOT_FOUND", "Vehicle not found", 404);
  if (row.driver_user_id !== principal.userId) {
    throw new DomainError("VEHICLE_NOT_OWNED", "You cannot modify another user's vehicle", 403);
  }

  const make = cleanText(input.make, "make", 80);
  const model = cleanText(input.model, "model", 80);
  const plate = normalizePlate(input.plate);
  const passengerSeats = seats(input.passengerSeats);

  try {
    const result = await pool.query(
      `update vehicles
          set make=$2,model=$3,plate=$4,passenger_seats=$5,
              review_status='pending',documentation_status='pending',
              review_reason=null,reviewed_by_user_id=null,reviewed_at=null,updated_at=now()
        where id=$1
        returning id,make,model,plate,passenger_seats,review_status,documentation_status,
                  vehicle_photo_status,insurance_status,insurance_expires_on,created_at,updated_at`,
      [vehicleId, make, model, plate.display, passengerSeats]
    );
    await pool.query(
      `insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
       values($1,'vehicle.updated','vehicle',$2,$3::jsonb)`,
      [principal.userId, vehicleId, JSON.stringify({ reviewReset: true })]
    );
    return result.rows[0];
  } catch (error: any) {
    if (error?.code === "23505") {
      throw new DomainError("VEHICLE_PLATE_ALREADY_EXISTS", "Vehicle plate already exists", 409);
    }
    throw error;
  }
}

export async function reviewVehicle(
  pool: Pool,
  principal: AuthPrincipal,
  vehicleId: string,
  input: { area: "vehicle" | "documentation"; decision: "approved" | "rejected"; reason?: string }
) {
  requireAnyRole(principal, ["admin","verification_admin"]);
  const reason = input.reason?.trim();
  if (input.decision === "rejected" && (!reason || reason.length < 3)) {
    throw new DomainError("REVIEW_REASON_REQUIRED", "A rejection reason is required");
  }
  if (reason && reason.length > 1000) {
    throw new DomainError("REVIEW_REASON_TOO_LONG", "Review reason is too long");
  }

  const column = input.area === "vehicle" ? "review_status" : "documentation_status";
  const result = await pool.query(
    `update vehicles
        set ${column}=$2::vehicle_review_status,
            review_reason=$3,reviewed_by_user_id=$4,reviewed_at=now(),updated_at=now()
      where id=$1
      returning id,driver_user_id,make,model,plate,passenger_seats,
                review_status,documentation_status,vehicle_photo_status,
                insurance_status,insurance_expires_on,review_reason,reviewed_at`,
    [vehicleId, input.decision, reason ?? null, principal.userId]
  );
  const row = result.rows[0];
  if (!row) throw new DomainError("VEHICLE_NOT_FOUND", "Vehicle not found", 404);

  await pool.query(
    `insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
     values($1,'vehicle.reviewed','vehicle',$2,$3::jsonb)`,
    [principal.userId, vehicleId, JSON.stringify({
      area: input.area, decision: input.decision, reason: reason ?? null
    })]
  );
  return row;
}
