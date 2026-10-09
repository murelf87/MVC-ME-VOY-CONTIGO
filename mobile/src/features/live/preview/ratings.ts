/**
 * `POST /v1/trips/:tripId/ratings` (contrato `live.md` §5.1): valoración tras el viaje. SIMULACIÓN (solo vista previa).
 * El pasajero valora al conductor; el conductor valora a cada pasajero con reserva `completed`. Una por (viaje, quien
 * valora, valorado). El agregado público (`PublicUser.ratingAverage/ratingCount`) se actualiza en `user_stats`.
 */
import type { LiveRating } from "@/api/types";
import { fail, isoReq, reply, userStats, uuidParam } from "@/preview";
import type { BookingRow, PreviewDb, PreviewRouter, RideRequestRow } from "@/preview";
import { liveRatings, type LiveRatingRow } from "./rows";
import { RATING_WINDOW_DAYS } from "./views";

export const COMMENT_MAX_LENGTH = 500;
const DAY_MS = 86_400_000;

export function ratingWire(row: Readonly<LiveRatingRow>): LiveRating {
  return {
    id: row.id,
    tripId: row.trip_id,
    raterUserId: row.rater_user_id,
    rateeUserId: row.ratee_user_id,
    stars: row.stars,
    comment: row.comment,
    createdAt: isoReq(row.created_at),
  };
}

interface TripBooking {
  booking: Readonly<BookingRow>;
  request: Readonly<RideRequestRow>;
}

/** Reservas del viaje que cuentan como «participar» (no las canceladas). */
function bookingsOfTrip(db: PreviewDb, tripId: string): TripBooking[] {
  const out: TripBooking[] = [];
  for (const booking of db.bookings.all()) {
    if (booking.status === "cancelled" || booking.status === "driver_cancelled") continue;
    const request = db.rideRequests.get(booking.request_id);
    if (request && request.trip_id === tripId) out.push({ booking, request });
  }
  return out;
}

/** Comentario normalizado: recortado, `null` si queda vacío y error si supera el máximo. */
export function normalizeComment(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return null;
  if (Array.from(trimmed).length > COMMENT_MAX_LENGTH) {
    fail("RATING_COMMENT_TOO_LONG", `El comentario no puede superar los ${COMMENT_MAX_LENGTH} caracteres.`, 400);
  }
  return trimmed;
}

/** Actualiza la media pública de `rateeUserId` con una valoración más (una cifra decimal, como `profiles.rating_sum/rating_count`). */
function addToPublicRating(db: PreviewDb, rateeUserId: string, stars: number): void {
  const stats = userStats(db);
  const current = stats.get(rateeUserId);
  if (!current) {
    stats.insert({ id: rateeUserId, rating_average: stars, rating_count: 1, trips_completed: 0 });
    return;
  }
  const count = current.rating_count + 1;
  const sum = (current.rating_average ?? 0) * current.rating_count + stars;
  stats.update(rateeUserId, { rating_average: Math.round((sum / count) * 10) / 10, rating_count: count });
}

export function registerRatings(r: PreviewRouter, db: PreviewDb): void {
  r.post<{ Params: { tripId: string }; Body: { rateeUserId: string; stars: number; comment?: string | null } }>(
    "/v1/trips/:tripId/ratings",
    {
      summary: "Valorar a la persona con la que se hizo el viaje (1–5 y comentario opcional)",
      tags: ["live"],
      idempotent: true,
      schema: {
        params: uuidParam("tripId"),
        body: {
          type: "object",
          additionalProperties: false,
          required: ["rateeUserId", "stars"],
          properties: {
            rateeUserId: { type: "string", format: "uuid" },
            // Sin `minimum/maximum`: el contrato pide `400 RATING_INVALID_STARS`, no un VALIDATION_ERROR genérico.
            stars: { type: "number" },
            comment: { type: ["string", "null"] },
          },
        },
      },
    },
    (req) => {
      const me = req.auth();
      const { rateeUserId, stars } = req.body;
      if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
        fail("RATING_INVALID_STARS", "La valoración debe ser un número entero de 1 a 5.", 400);
      }
      const comment = normalizeComment(req.body.comment);

      const trip = db.trips.get(req.params.tripId);
      if (!trip) fail("TRIP_NOT_FOUND", "Trip not found", 404);
      const entries = bookingsOfTrip(db, trip.id);
      const iAmDriver = trip.driver_user_id === me.userId;
      const mine = entries.find((e) => e.request.passenger_user_id === me.userId);
      if (!iAmDriver && !mine) fail("RATING_NOT_PARTICIPANT", "Solo pueden valorar quienes participaron en el viaje.", 403);
      if (trip.status !== "completed") fail("RATING_TRIP_NOT_COMPLETED", "Solo se puede valorar un viaje terminado.", 409);

      let bookingId: string | null;
      if (iAmDriver) {
        const target = entries.find((e) => e.request.passenger_user_id === rateeUserId && e.booking.status === "completed");
        if (!target) fail("RATING_INVALID_RATEE", "Solo puedes valorar a un pasajero que completó el viaje.", 422);
        bookingId = target.booking.id;
      } else {
        if (mine?.booking.status !== "completed") {
          fail("RATING_BOOKING_NOT_COMPLETED", "Solo puede valorar quien completó el trayecto.", 409);
        }
        if (rateeUserId !== trip.driver_user_id) fail("RATING_INVALID_RATEE", "Como pasajero solo puedes valorar a quien conducía.", 422);
        bookingId = mine.booking.id;
      }
      if (rateeUserId === me.userId) fail("RATING_INVALID_RATEE", "No puedes valorarte a ti mismo.", 422);

      const ratings = liveRatings(db);
      if (ratings.find((x) => x.trip_id === trip.id && x.rater_user_id === me.userId && x.ratee_user_id === rateeUserId)) {
        fail("RATING_ALREADY_SUBMITTED", "Ya valoraste a esta persona en este viaje.", 409);
      }
      const now = db.nowMs();
      const windowEndsAt = (trip.completed_at ?? now) + RATING_WINDOW_DAYS * DAY_MS;
      if (now > windowEndsAt) {
        fail("RATING_WINDOW_CLOSED", `Han pasado más de ${RATING_WINDOW_DAYS} días desde el final del viaje.`, 409, {
          windowEndsAt: isoReq(windowEndsAt),
        });
      }

      const row = db.tx(() => {
        const inserted = ratings.insert({
          id: db.ids.uuid(),
          trip_id: trip.id,
          booking_id: bookingId,
          rater_user_id: me.userId,
          ratee_user_id: rateeUserId,
          rater_role: iAmDriver ? "driver" : "passenger",
          stars,
          comment,
          created_at: now,
        });
        addToPublicRating(db, rateeUserId, stars);
        return inserted;
      });
      return reply.created(ratingWire(row));
    }
  );
}
