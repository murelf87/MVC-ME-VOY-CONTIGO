import type { TripRow } from "./trip-data.js";
import { plateHintOf, vehicleDisplayName } from "./common.js";
import type { VehicleSummary } from "./types.js";

/**
 * Vehículo tal y como lo ve el lector. La matrícula COMPLETA solo para el conductor y para pasajeros con reserva
 * confirmada (`full=true`); para el resto solo una pista de 3 caracteres y nunca el id del vehículo.
 */
export function toVehicleSummary(
  row: Pick<TripRow, "vehicle_id" | "make" | "model" | "plate" | "color" | "passenger_seats">,
  full: boolean,
  includeId = false
): VehicleSummary {
  return {
    id: includeId ? row.vehicle_id : null,
    make: row.make,
    model: row.model,
    color: row.color,
    displayName: vehicleDisplayName(row.make, row.model),
    plateHint: plateHintOf(row.plate) || null,
    plate: full ? row.plate : null,
    passengerSeats: row.passenger_seats
  };
}
