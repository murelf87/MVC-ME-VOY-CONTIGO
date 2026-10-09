/**
 * Referencias simbólicas del slice `live` para los escenarios de diseño y la comprobación de rutas
 * (`{ "$ref": "live.booking" }`). Nunca devuelven `undefined`: en un mundo sin la escena correspondiente apuntan al dato
 * equivalente más cercano o a un identificador que no existe, de modo que la pantalla se abre en su estado «no encontrado»
 * en lugar de fallar. SIMULACIÓN (solo vista previa).
 */
import { SEED_TRIP_IDS, SEED_USER_IDS, registerSeedRef, resolveSeedRef, routeChangeTables } from "@/preview";
import type { PreviewDb } from "@/preview";
import { liveIncidents, liveShares } from "./rows";
import { ABSENT_ID, ABSENT_SHARE_TOKEN, SCENE_BOOKING_ID, SCENE_TRIP_ID, sceneShareToken } from "./scenes";

function tripOfBooking(db: PreviewDb, bookingId: string): string | undefined {
  const booking = db.bookings.get(bookingId);
  return booking ? db.rideRequests.get(booking.request_id)?.trip_id : undefined;
}

/** Reserva más reciente de Miguel ya completada (del historial del mundo base). */
function latestCompletedBookingOfMiguel(db: PreviewDb): string | undefined {
  let best: { id: string; at: number } | undefined;
  for (const booking of db.bookings.all()) {
    if (booking.status !== "completed") continue;
    const request = db.rideRequests.get(booking.request_id);
    if (!request || request.passenger_user_id !== SEED_USER_IDS.miguel) continue;
    const at = db.trips.get(request.trip_id)?.completed_at ?? booking.updated_at;
    if (best === undefined || at > best.at) best = { id: booking.id, at };
  }
  return best?.id;
}

export function registerLiveSeedRefs(): void {
  registerSeedRef("live.booking", (db) => db.bookings.get(SCENE_BOOKING_ID)?.id ?? resolveSeedRef(db, "booking.miguel") ?? ABSENT_ID);
  registerSeedRef("live.trip", (db) => {
    if (db.trips.get(SCENE_TRIP_ID)) return SCENE_TRIP_ID;
    const viaBooking = tripOfBooking(db, resolveSeedRef(db, "booking.miguel") ?? ABSENT_ID);
    return viaBooking ?? SEED_TRIP_IDS.anaMorning;
  });
  registerSeedRef("live.finishedBooking", (db) => db.bookings.get(SCENE_BOOKING_ID)?.id ?? latestCompletedBookingOfMiguel(db) ?? ABSENT_ID);
  registerSeedRef("live.finishedTrip", (db) => {
    if (db.trips.get(SCENE_TRIP_ID)) return SCENE_TRIP_ID;
    return tripOfBooking(db, latestCompletedBookingOfMiguel(db) ?? ABSENT_ID) ?? ABSENT_ID;
  });
  registerSeedRef("live.routeChange", (db) => {
    const proposal = routeChangeTables(db).proposals.filter((row) => row.trip_id === SCENE_TRIP_ID).sort((a, b) => b.created_at - a.created_at)[0];
    return proposal?.id ?? ABSENT_ID;
  });
  registerSeedRef("live.incident", (db) => {
    const mine = liveIncidents(db)
      .filter((row) => row.reporter_user_id === SEED_USER_IDS.miguel)
      .sort((a, b) => b.created_at - a.created_at)[0];
    return mine?.id ?? ABSENT_ID;
  });
  registerSeedRef("live.shareToken", (db) => (liveShares(db).find((s) => s.booking_id === SCENE_BOOKING_ID && s.revoked_at === null) ? sceneShareToken() : ABSENT_SHARE_TOKEN));
}
