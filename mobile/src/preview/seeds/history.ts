/**
 * Historial sembrado: los 12 viajes completados de Miguel con Ana de las últimas semanas (días laborables, 08:05, de
 * Montequinto a la Universidad). Las valoraciones agregadas de Ana (4,8 · 32) y de Miguel (4,8 · 12) son estadísticas
 * públicas de `user_stats`; no todas las filas históricas de esos totales existen en la vista previa.
 */
import type { PreviewDb } from "../core/db";
import { madridDateTimeMs } from "../core/time";
import { insertTripWithPlan } from "../domain/trips";
import { previousWorkdays } from "./anchor";
import { SEED_IDS, SEED_USER_IDS, SEED_VEHICLE_IDS } from "./ids";
import { planFor, seedConfirmedRider, type SeedStop } from "./trips";
import { stableUuid } from "../core/ids";

const MONTEQUINTO: SeedStop = { latitude: 37.332, longitude: -5.937, label: "Montequinto" };
const UNIVERSIDAD: SeedStop = { latitude: 37.383, longitude: -5.992, label: "Sevilla – Universidad" };

export const HISTORY_TRIPS_FOR_MIGUEL = 12;

/** Ids estables de los viajes del historial (más reciente primero). */
export function historyTripIds(db: PreviewDb): string[] {
  return previousWorkdays(db, HISTORY_TRIPS_FOR_MIGUEL).map((date) => stableUuid(`trip:history:ana:${date}`));
}

export function seedHistory(db: PreviewDb): void {
  const dates = previousWorkdays(db, HISTORY_TRIPS_FOR_MIGUEL);
  const firstDeparture = madridDateTimeMs(dates[0] ?? "2026-10-02", "08:05");
  // El trazado es el mismo en todos: se calcula una vez.
  const plan = planFor(db, [MONTEQUINTO, UNIVERSIDAD], [{ distanceM: 24000, durationS: 1380 }], firstDeparture);
  for (const date of dates) {
    const departureAt = madridDateTimeMs(date, "08:05");
    const trip = insertTripWithPlan(
      db,
      {
        id: stableUuid(`trip:history:ana:${date}`),
        driverUserId: SEED_USER_IDS.ana,
        vehicleId: SEED_VEHICLE_IDS.anaArona,
        provinceId: SEED_IDS.province,
        category: "university",
        leg: "outbound",
        departureAtMs: departureAt,
        flexibilityMinutes: 10,
        maxDetourM: 3000,
        offeredSeats: 3,
        origin: MONTEQUINTO,
        destination: UNIVERSIDAD,
        status: "completed",
        stopLabels: [MONTEQUINTO.label, UNIVERSIDAD.label],
      },
      plan
    );
    const startedAt = departureAt + 60_000;
    const completedAt = departureAt + 1_380_000;
    const createdAt = departureAt - 3 * 86_400_000;
    db.trips.update(trip.id, { started_at: startedAt, completed_at: completedAt, created_at: createdAt, updated_at: completedAt });
    seedConfirmedRider(db, trip, { user: "miguel", from: 0, to: 1 }, { pickedUp: true, status: "completed", bookedAt: departureAt - 18 * 3_600_000 });
  }
}
