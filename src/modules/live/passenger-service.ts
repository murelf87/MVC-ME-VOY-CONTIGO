import type { Pool } from "pg";
import type { AuthPrincipal } from "../../auth/session.js";
import { moneyDefined, moneyPending } from "../../lib/dto.js";
import { loadPassengerBooking, type BookingContext } from "./booking-context.js";
import { geoJsonToPoints, loadPublicUser, loadPublicUsers, point, usersBlocked, type Db } from "./common.js";
import { liveSettings, PICKUP_CODE_LENGTH } from "./config.js";
import {
  computeEta, journeySums, loadRouteModel, plannedArrival, stopAt, type RouteModel, type RouteStop
} from "./eta.js";
import { expireDueRouteChanges, findPendingRouteChangeForPassenger } from "./route-change-service.js";
import { activeShareState } from "./share-service.js";
import { toLiveEta, trackPassenger, type PassengerTracking } from "./tracking.js";
import type {
  GeoPoint, LiveBookingStatusView, LiveBookingSummary, LiveChatRef, LiveEta, LiveInCarState, LiveOccupancy, LiveOccupant,
  LivePendingRouteChange, LivePickupCodeState, LiveRating, LiveRatingBlockReason, LiveStop, LiveTimelineStop
} from "./types.js";

/* ────────────────────────────── Piezas comunes ────────────────────────────── */

export function toLiveStop(stop: RouteStop): LiveStop {
  return { seq: stop.seq, label: stop.label, location: point(stop.lat, stop.lng) };
}

/** Mismas reglas que el chat 1:1 vigente: solicitud y reserva confirmadas (o completada) y sin bloqueo entre ambos. */
async function chatRef(db: Db, ctx: BookingContext): Promise<LiveChatRef> {
  const open = ctx.requestStatus === "confirmed"
    && (ctx.bookingStatus === "confirmed" || ctx.bookingStatus === "completed");
  const blocked = open ? await usersBlocked(db, ctx.passengerUserId, ctx.driverUserId) : false;
  return { peerUserId: ctx.driverUserId, available: open && !blocked };
}

async function pendingChange(db: Db, ctx: BookingContext, now: Date): Promise<LivePendingRouteChange | null> {
  if (ctx.bookingStatus !== "confirmed" || (ctx.tripStatus !== "published" && ctx.tripStatus !== "active")) return null;
  await expireDueRouteChanges(db, { tripId: ctx.tripId }, now);
  return findPendingRouteChangeForPassenger(db, ctx.tripId, ctx.passengerUserId);
}

/* ────────────────────────────── 21 · Esperando el coche ────────────────────────────── */

export async function getBookingLive(
  pool: Pool, principal: AuthPrincipal, bookingId: string, now: Date = new Date()
): Promise<LiveBookingStatusView> {
  const ctx = await loadPassengerBooking(pool, bookingId, principal.userId);
  const tracking = await trackPassenger(pool, ctx, now);
  const { model, settings } = tracking;
  const driver = await loadPublicUser(pool, ctx.driverUserId);
  const pickup = stopAt(model, ctx.fromSeq);
  const dropoff = stopAt(model, ctx.toSeq);
  const plannedPickup = plannedArrival(model, ctx.fromSeq, settings.stopDwellSeconds, "schedule");
  const plannedDropoff = plannedArrival(model, ctx.toSeq, settings.stopDwellSeconds, "schedule");

  return {
    bookingId: ctx.bookingId,
    tripId: ctx.tripId,
    phase: tracking.phase,
    tripStatus: ctx.tripStatus,
    bookingStatus: ctx.bookingStatus,
    serverTime: now.toISOString(),
    driver,
    vehicle: ctx.vehicle,
    pickup: { ...toLiveStop(pickup), plannedAt: plannedPickup ? plannedPickup.toISOString() : null },
    dropoff: { ...toLiveStop(dropoff), plannedAt: plannedDropoff ? plannedDropoff.toISOString() : null },
    etaTarget: tracking.etaTarget,
    eta: tracking.eta,
    signal: tracking.signal,
    lastUpdateAt: tracking.position ? tracking.position.recordedAt : null,
    lastUpdateAgeSeconds: tracking.position ? tracking.position.ageSeconds : null,
    staleAfterSeconds: settings.staleAfterSeconds,
    position: tracking.position,
    arrival: tracking.arrival,
    chat: await chatRef(pool, ctx),
    pendingRouteChange: await pendingChange(pool, ctx, now)
  };
}

/* ────────────────────────────── 23 · En el coche ────────────────────────────── */

async function pickupCodeState(db: Db, ctx: BookingContext): Promise<LivePickupCodeState> {
  const row = (await db.query<{ attempts: number; max_attempts: number; generated_at: Date; verified_at: Date | null }>(
    `select attempts, max_attempts, generated_at, verified_at from booking_pickup_codes where booking_id=$1`, [ctx.bookingId]
  )).rows[0];
  const codeLength = PICKUP_CODE_LENGTH;
  if (ctx.pickedUpAt || row?.verified_at) {
    const verifiedAt = row?.verified_at ?? ctx.pickedUpAt;
    return {
      status: "verified", codeLength, generatedAt: row ? row.generated_at.toISOString() : null,
      verifiedAt: verifiedAt ? verifiedAt.toISOString() : null, attemptsRemaining: null
    };
  }
  if (!row) return { status: "not_generated", codeLength, generatedAt: null, verifiedAt: null, attemptsRemaining: null };
  const remaining = Math.max(0, row.max_attempts - row.attempts);
  return {
    status: remaining === 0 ? "locked" : "active", codeLength, generatedAt: row.generated_at.toISOString(),
    verifiedAt: null, attemptsRemaining: remaining
  };
}

/**
 * Ocupación en el tramo más ocupado del trayecto del pasajero (él incluido) y capacidad de ese mismo tramo.
 * Cuentan reservas confirmadas o completadas (no «no presentado», ni canceladas).
 */
export async function journeyOccupancy(
  db: Db, ctx: Pick<BookingContext, "tripId" | "fromSeq" | "toSeq">
): Promise<{ occupied: number; capacity: number }> {
  const rows = (await db.query<{ seq: number; capacity: number; occupied: number }>(
    `select s.seq, s.capacity,
            (select count(*)::int
               from bookings b join ride_requests r on r.id=b.request_id
              where r.trip_id=s.trip_id and r.status='confirmed' and b.status in ('confirmed','completed')
                and r.from_segment_seq <= s.seq and r.to_segment_seq > s.seq) as occupied
       from trip_segments s
      where s.trip_id=$1 and s.seq >= $2 and s.seq < $3
      order by s.seq`,
    [ctx.tripId, ctx.fromSeq, ctx.toSeq]
  )).rows;
  let best = { occupied: 0, capacity: 0 };
  for (const row of rows) {
    if (row.occupied > best.occupied || (row.occupied === best.occupied && (best.capacity === 0 || row.capacity < best.capacity))) {
      best = { occupied: row.occupied, capacity: row.capacity };
    }
  }
  return best;
}

async function occupancyView(db: Db, ctx: BookingContext, driver: LiveOccupant["user"], me: LiveOccupant["user"]): Promise<LiveOccupancy> {
  const { occupied, capacity } = await journeyOccupancy(db, ctx);
  const others = (await db.query<{ passenger_user_id: string; shows: boolean }>(
    `select r.passenger_user_id,
            coalesce(bool_or(lp.show_profile_to_copassengers), false) as shows
       from bookings b
       join ride_requests r on r.id=b.request_id
       left join live_privacy_preferences lp on lp.user_id=r.passenger_user_id
      where r.trip_id=$1 and r.status='confirmed' and b.status in ('confirmed','completed')
        and r.passenger_user_id <> $2 and r.from_segment_seq < $4 and r.to_segment_seq > $3
      group by r.passenger_user_id
      order by min(b.created_at), r.passenger_user_id`,
    [ctx.tripId, ctx.passengerUserId, ctx.fromSeq, ctx.toSeq]
  )).rows;
  const profiles = await loadPublicUsers(db, others.filter(o => o.shows).map(o => o.passenger_user_id));
  const members: LiveOccupant[] = [
    { role: "driver", isYou: false, user: driver },
    { role: "passenger", isYou: true, user: me },
    ...others.map((o): LiveOccupant => ({
      role: "passenger", isYou: false, user: o.shows ? (profiles.get(o.passenger_user_id) ?? null) : null
    }))
  ];
  return { occupied, capacity, members };
}

function buildTimeline(ctx: BookingContext, tracking: PassengerTracking, now: Date): LiveTimelineStop[] {
  const { model, settings } = tracking;
  const tripActive = ctx.tripStatus === "active";
  const completed = ctx.tripStatus === "completed" || ctx.bookingStatus === "completed" || ctx.bookingStatus === "no_show";
  const cancelled = tracking.phase === "cancelled";
  const pickedUp = ctx.pickedUpAt !== null;
  const c = tracking.progress ? tracking.progress.c : null;
  const stops = model.stops.filter(s => s.seq >= ctx.fromSeq && s.seq <= ctx.toSeq);

  let currentAssigned = false;
  return stops.map((stop): LiveTimelineStop => {
    const isPickup = stop.seq === ctx.fromSeq;
    const isDropoff = stop.seq === ctx.toSeq;
    const done = !cancelled && (completed || tracking.journeyOver
      || (isPickup ? pickedUp : pickedUp && c !== null && stop.seq <= c));

    let at: Date | null = null;
    if (isPickup && ctx.pickedUpAt) at = ctx.pickedUpAt;
    else if (done) at = plannedArrival(model, stop.seq, settings.stopDwellSeconds, "schedule");
    else if (tripActive && tracking.fix && ctx.bookingStatus === "confirmed") {
      at = computeEta(model, stop.seq, tracking.fix, now, settings)?.at ?? null;
    }
    if (!at) at = plannedArrival(model, stop.seq, settings.stopDwellSeconds, tripActive ? "live" : "schedule");

    let state: LiveTimelineStop["state"] = "next";
    if (done) state = "done";
    else if (!cancelled && !currentAssigned) {
      state = "current";
      currentAssigned = true;
    }
    return {
      ...toLiveStop(stop),
      role: isPickup ? "pickup" : isDropoff ? "dropoff" : "stop",
      eta: (at ?? now).toISOString(),
      state
    };
  });
}

export async function getInCarState(
  pool: Pool, principal: AuthPrincipal, bookingId: string, now: Date = new Date()
): Promise<LiveInCarState> {
  const ctx = await loadPassengerBooking(pool, bookingId, principal.userId);
  const tracking = await trackPassenger(pool, ctx, now);
  const { model, settings } = tracking;
  const people = await loadPublicUsers(pool, [ctx.driverUserId, ctx.passengerUserId]);
  const driver = people.get(ctx.driverUserId) ?? (await loadPublicUser(pool, ctx.driverUserId));
  const me = people.get(ctx.passengerUserId) ?? (await loadPublicUser(pool, ctx.passengerUserId));

  // ETA al destino del pasajero (independiente de si ya subió: la pantalla «En el coche» siempre habla del destino).
  let destinationCalc = null;
  if (ctx.bookingStatus === "confirmed" && (ctx.tripStatus === "active" || ctx.tripStatus === "published") && !tracking.journeyOver) {
    destinationCalc = computeEta(model, ctx.toSeq, tracking.fix, now, settings);
  }
  const etaAtDestination: LiveEta | null = destinationCalc ? toLiveEta(destinationCalc, now, tracking.preciseLocation) : null;
  let remaining: LiveInCarState["remaining"] = null;
  if (destinationCalc && etaAtDestination) {
    const plannedDistance = journeySums(model, ctx.fromSeq, ctx.toSeq).distanceM;
    remaining = {
      minutes: etaAtDestination.minutes,
      // Con la ubicación del conductor sin compartir con precisión, la distancia restante en metros se oculta (revelaría dónde está).
      distanceM: !tracking.preciseLocation ? null
        : destinationCalc.remainingM !== null ? destinationCalc.remainingM : Math.round(plannedDistance)
    };
  }

  return {
    bookingId: ctx.bookingId,
    tripId: ctx.tripId,
    phase: tracking.phase,
    tripStatus: ctx.tripStatus,
    serverTime: now.toISOString(),
    driver,
    vehicle: ctx.vehicle,
    pickupCode: await pickupCodeState(pool, ctx),
    occupancy: await occupancyView(pool, ctx, driver, me),
    timeline: buildTimeline(ctx, tracking, now),
    etaAtDestination,
    remaining,
    signal: tracking.signal,
    lastUpdateAt: tracking.position ? tracking.position.recordedAt : null,
    share: await activeShareState(pool, ctx.bookingId, now),
    chat: await chatRef(pool, ctx),
    pendingRouteChange: await pendingChange(pool, ctx, now)
  };
}

/* ────────────────────────────── 24 · Viaje terminado ────────────────────────────── */

async function journeyPath(db: Db, ctx: BookingContext, model: RouteModel): Promise<GeoPoint[]> {
  const from = stopAt(model, ctx.fromSeq);
  const to = stopAt(model, ctx.toSeq);
  if (from.frac < to.frac - 1e-9) {
    const result = await db.query<{ geojson: string | null }>(
      `select ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_LineSubstring(route_geom, $2::float8, $3::float8), 0.0001), 6) as geojson
         from trips where id=$1 and route_geom is not null`,
      [ctx.tripId, from.frac, to.frac]
    );
    const points = geoJsonToPoints(result.rows[0]?.geojson ?? null);
    if (points.length >= 2) return points;
  }
  return [point(from.lat, from.lng), point(to.lat, to.lng)];
}

export async function loadMyRating(db: Db, tripId: string, raterUserId: string, rateeUserId: string): Promise<LiveRating | null> {
  const row = (await db.query<{
    id: string; trip_id: string; rater_user_id: string; ratee_user_id: string; stars: number; comment: string | null; created_at: Date;
  }>(
    `select id, trip_id, rater_user_id, ratee_user_id, stars, comment, created_at
       from trip_ratings where trip_id=$1 and rater_user_id=$2 and ratee_user_id=$3`,
    [tripId, raterUserId, rateeUserId]
  )).rows[0];
  if (!row) return null;
  return {
    id: row.id, tripId: row.trip_id, raterUserId: row.rater_user_id, rateeUserId: row.ratee_user_id,
    stars: row.stars, comment: row.comment, createdAt: row.created_at.toISOString()
  };
}

export async function getBookingSummary(
  pool: Pool, principal: AuthPrincipal, bookingId: string, now: Date = new Date()
): Promise<LiveBookingSummary> {
  const ctx = await loadPassengerBooking(pool, bookingId, principal.userId);
  const settings = liveSettings();
  const model = await loadRouteModel(pool, ctx.tripId);
  const driver = await loadPublicUser(pool, ctx.driverUserId);
  const pickup = stopAt(model, ctx.fromSeq);
  const dropoff = stopAt(model, ctx.toSeq);
  const sums = journeySums(model, ctx.fromSeq, ctx.toSeq);
  const intermediateStops = Math.max(0, ctx.toSeq - ctx.fromSeq - 1);
  const plannedSeconds = Math.round(sums.durationS + intermediateStops * settings.stopDwellSeconds);

  const arrived = ctx.tripStatus === "completed" && ctx.bookingStatus === "completed";
  const lastSeq = model.stops.reduce((max, s) => Math.max(max, s.seq), 0);
  const reachedEnd = ctx.toSeq === lastSeq;
  const actualSeconds = arrived && reachedEnd && ctx.pickedUpAt && ctx.tripCompletedAt
    ? Math.round((ctx.tripCompletedAt.getTime() - ctx.pickedUpAt.getTime()) / 1000)
    : null;
  const useActual = actualSeconds !== null && actualSeconds > 0;

  const plannedPickup = plannedArrival(model, ctx.fromSeq, settings.stopDwellSeconds, "schedule");
  const plannedDropoff = plannedArrival(model, ctx.toSeq, settings.stopDwellSeconds, "schedule");
  const pickupAt = ctx.pickedUpAt ?? plannedPickup;
  let dropoffAt: Date | null = plannedDropoff;
  if (arrived && reachedEnd && ctx.tripCompletedAt) dropoffAt = ctx.tripCompletedAt;
  else if (ctx.pickedUpAt) dropoffAt = new Date(ctx.pickedUpAt.getTime() + plannedSeconds * 1000);

  const occupancy = await journeyOccupancy(pool, ctx);

  // Valoración: el pasajero valora al conductor.
  const mine = await loadMyRating(pool, ctx.tripId, ctx.passengerUserId, ctx.driverUserId);
  const windowEnd = ctx.tripCompletedAt
    ? new Date(ctx.tripCompletedAt.getTime() + settings.ratingWindowDays * 86_400_000)
    : null;
  let reason: LiveRatingBlockReason | null = null;
  if (ctx.tripStatus !== "completed") reason = "trip_not_completed";
  else if (ctx.bookingStatus !== "completed") reason = "booking_not_completed";
  else if (mine) reason = "already_rated";
  else if (windowEnd && now.getTime() > windowEnd.getTime()) reason = "window_closed";

  const incidentCount = (await pool.query<{ n: number }>(
    `select count(*)::int as n from incident_reports where reporter_user_id=$1 and trip_id=$2`,
    [ctx.passengerUserId, ctx.tripId]
  )).rows[0]?.n ?? 0;

  const paid = ctx.amountCents > 0 && ctx.providerPaymentId.length > 0;

  return {
    bookingId: ctx.bookingId,
    tripId: ctx.tripId,
    tripStatus: ctx.tripStatus,
    bookingStatus: ctx.bookingStatus,
    arrived,
    pickup: { ...toLiveStop(pickup), at: pickupAt ? pickupAt.toISOString() : null },
    dropoff: { ...toLiveStop(dropoff), at: dropoffAt ? dropoffAt.toISOString() : null },
    path: await journeyPath(pool, ctx, model),
    duration: { seconds: useActual ? (actualSeconds as number) : plannedSeconds, source: useActual ? "actual" : "planned" },
    distance: { meters: Math.round(sums.distanceM), basis: "planned_road_route" },
    passengers: { count: occupancy.occupied, capacity: occupancy.capacity },
    driver,
    vehicle: ctx.vehicle,
    payment: paid
      ? { status: "confirmed", amount: moneyDefined(ctx.amountCents) }
      : { status: "pending_definition", amount: moneyPending() },
    rating: {
      canRate: reason === null,
      reason,
      rateeUserId: ctx.driverUserId,
      windowEndsAt: windowEnd ? windowEnd.toISOString() : null,
      mine
    },
    incidents: { canReport: true, mineCount: incidentCount }
  };
}

