import type { Pool } from "pg";
import { requireAnyRole, type AuthPrincipal } from "../../auth/session.js";
import { DomainError } from "../../errors.js";
import { loadPublicUsers } from "./common.js";
import { liveSettings } from "./config.js";
import { computeEta, loadLiveFix, loadRouteModel, signalOf, stopAt } from "./eta.js";
import { expireDueRouteChanges, findPendingRouteChangeForDriver } from "./route-change-service.js";
import { toLiveStop } from "./passenger-service.js";
import { toLiveEta, toLivePosition } from "./tracking.js";
import type {
  LiveBookingStatus, LiveConsole, LiveConsolePassenger, LiveEta, LivePickupCodeStatus, LiveTripStatus
} from "./types.js";

type PassengerRow = {
  booking_id: string;
  status: LiveBookingStatus;
  picked_up_at: Date | null;
  passenger_user_id: string;
  f: number;
  t: number;
  attempts: number | null;
  max_attempts: number | null;
  rated: boolean;
};

function codeState(row: PassengerRow): { status: LivePickupCodeStatus; attemptsRemaining: number | null } {
  if (row.picked_up_at) return { status: "verified", attemptsRemaining: null };
  if (row.attempts === null || row.max_attempts === null) return { status: "not_generated", attemptsRemaining: null };
  const remaining = Math.max(0, row.max_attempts - row.attempts);
  return { status: remaining === 0 ? "locked" : "active", attemptsRemaining: remaining };
}

/**
 * Consola en directo del conductor propietario. `routeProviderConfigured` solo decide si se anuncia la acción
 * «proponer cambio de ruta» (sin proveedor de rutas el servidor la rechaza con 503).
 */
export async function getDriverConsole(
  pool: Pool,
  principal: AuthPrincipal,
  tripId: string,
  routeProviderConfigured: boolean,
  now: Date = new Date()
): Promise<LiveConsole> {
  requireAnyRole(principal, ["driver"]);
  const model = await loadRouteModel(pool, tripId);
  if (model.driverUserId !== principal.userId) {
    throw new DomainError("TRIP_NOT_OWNED", "Only the trip driver may open the console", 403);
  }
  if (model.status === "draft") {
    throw new DomainError("CONSOLE_TRIP_NOT_PUBLISHED", "The trip has not been published yet", 409);
  }
  const status = model.status as LiveTripStatus;
  const settings = liveSettings();
  await expireDueRouteChanges(pool, { tripId }, now);

  const vehicle = (await pool.query<{ make: string; model: string; color: string | null; plate: string }>(
    `select make, model, color, plate from vehicles where id=$1`, [model.vehicleId]
  )).rows[0];
  if (!vehicle) throw new DomainError("VEHICLE_NOT_FOUND", "Vehicle not found", 404);

  const fix = status === "active" ? await loadLiveFix(pool, tripId) : null;
  const signal = signalOf(fix, now, settings.staleAfterSeconds);

  const rows = (await pool.query<PassengerRow>(
    `select b.id as booking_id, b.status, b.picked_up_at, r.passenger_user_id,
            r.from_segment_seq as f, r.to_segment_seq as t, pc.attempts, pc.max_attempts,
            exists (select 1 from trip_ratings tr
                     where tr.trip_id=r.trip_id and tr.rater_user_id=$2 and tr.ratee_user_id=r.passenger_user_id) as rated
       from bookings b
       join ride_requests r on r.id=b.request_id
       left join booking_pickup_codes pc on pc.booking_id=b.id
      where r.trip_id=$1 and r.status='confirmed' and b.status in ('confirmed','completed','no_show')
      order by r.from_segment_seq, b.created_at, b.id`,
    [tripId, principal.userId]
  )).rows;
  const people = await loadPublicUsers(pool, rows.map(r => r.passenger_user_id));

  const passengers: LiveConsolePassenger[] = rows.map(row => {
    const passenger = people.get(row.passenger_user_id);
    if (!passenger) throw new DomainError("USER_NOT_FOUND", "Passenger not found", 404);
    let etaToPickup: LiveEta | null = null;
    if (status === "active" && row.status === "confirmed" && !row.picked_up_at) {
      const calc = computeEta(model, row.f, fix, now, settings);
      etaToPickup = calc ? toLiveEta(calc, now) : null;
    }
    return {
      bookingId: row.booking_id,
      passenger,
      bookingStatus: row.status,
      pickup: toLiveStop(stopAt(model, row.f)),
      dropoff: toLiveStop(stopAt(model, row.t)),
      pickedUp: row.picked_up_at !== null,
      pickedUpAt: row.picked_up_at ? row.picked_up_at.toISOString() : null,
      code: codeState(row),
      etaToPickup,
      ratedByMe: row.rated
    };
  });

  // Asientos ocupados en el tramo más ocupado del viaje (reservas confirmadas o completadas).
  let occupied = 0;
  for (const segment of model.segments) {
    const count = rows.filter(r => (r.status === "confirmed" || r.status === "completed")
      && r.f <= segment.seq && r.t > segment.seq).length;
    occupied = Math.max(occupied, count);
  }

  const waiting = passengers.filter(p => p.bookingStatus === "confirmed" && !p.pickedUp);
  let next: LiveConsole["next"] = null;
  if (status === "active" && waiting.length > 0) {
    const ordered = [...waiting].sort((a, b) => {
      const ea = a.etaToPickup ? Date.parse(a.etaToPickup.at) : Number.POSITIVE_INFINITY;
      const eb = b.etaToPickup ? Date.parse(b.etaToPickup.at) : Number.POSITIVE_INFINITY;
      return ea - eb || a.pickup.seq - b.pickup.seq;
    });
    const first = ordered[0];
    if (first) {
      next = { bookingId: first.bookingId, passenger: first.passenger, pickup: first.pickup, etaToPickup: first.etaToPickup };
    }
  }

  const pending = await findPendingRouteChangeForDriver(pool, tripId);
  const live = status === "published" || status === "active";

  return {
    tripId,
    status,
    serverTime: now.toISOString(),
    departureAt: model.departureAt ? model.departureAt.toISOString() : null,
    startedAt: model.startedAt ? model.startedAt.toISOString() : null,
    completedAt: model.completedAt ? model.completedAt.toISOString() : null,
    vehicle: { make: vehicle.make, model: vehicle.model, color: vehicle.color, plate: vehicle.plate },
    seats: { offered: model.offeredSeats, occupied },
    signal,
    position: fix ? toLivePosition(fix, now, signal === "stale") : null,
    next,
    passengers,
    counts: {
      total: passengers.length,
      verified: passengers.filter(p => p.pickedUp).length,
      pending: waiting.length
    },
    pendingRouteChange: pending,
    actions: {
      canStart: status === "published",
      canComplete: status === "active",
      canProposeRouteChange: live && pending === null && routeProviderConfigured,
      willMarkNoShow: status === "active" ? waiting.length : 0
    }
  };
}
