/**
 * Vistas del pasajero en directo (`GET /v1/bookings/:id/live`, `/in-car`, `/summary`) construidas con el motor de
 * `./engine.ts`. Formas exactas de `mobile/src/api/types/live.ts`. SIMULACIÓN: solo con `EXPO_PUBLIC_PREVIEW=1`.
 */
import type {
  LiveBookingStatusView,
  LiveBookingSummary,
  LiveChatRef,
  LiveInCarState,
  LiveOccupant,
  LivePendingRouteChange,
  LivePickupCodeState,
  LiveRatingBlockReason,
  LiveStop,
  LiveTimelineStop,
} from "@/api/types";
import { LIVE_SETTINGS, isBlockedEitherWay, iso, isoReq, journeySums, loadRouteModel, moneyDefined, moneyIllustrative, moneyPending, publicUser } from "@/preview";
import type { PreviewDb } from "@/preview";
import {
  PICKUP_CODE_LENGTH,
  carPassed,
  coPassengers,
  ctxStop,
  geoPoint,
  liveSnapshot,
  occupiedOnMyJourney,
  pathBetween,
  pickupPoint,
  scheduledAtMs,
  stopEtaMs,
  tripStatusOf,
  vehicleOf,
  type BookingContext,
  type LiveSnapshot,
} from "./engine";
import { liveIncidents, livePrivacy, liveRatings, liveShares } from "./rows";

/** Días de plazo para valorar tras el fin del viaje. */
export const RATING_WINDOW_DAYS = LIVE_SETTINGS.ratingWindowDays;
const DAY_MS = 86_400_000;

/**
 * Quién sabe si hay una propuesta de cambio de ruta que afecta a esta reserva. El módulo de la persona que conduce
 * (`driver-ops`) es el dueño de esos datos: cuando su dominio de vista previa está disponible lo conecta `handlers.ts`
 * con `setPendingRouteChangeResolver`; sin resolutor no hay propuestas.
 */
export type PendingRouteChangeResolver = (db: PreviewDb, ctx: BookingContext) => LivePendingRouteChange | null;

let pendingRouteChangeResolver: PendingRouteChangeResolver | null = null;

export function setPendingRouteChangeResolver(resolver: PendingRouteChangeResolver | null): void {
  pendingRouteChangeResolver = resolver;
}

function pendingRouteChangeOf(db: PreviewDb, ctx: BookingContext): LivePendingRouteChange | null {
  return pendingRouteChangeResolver ? pendingRouteChangeResolver(db, ctx) : null;
}

/** El chat con quien conduce existe mientras la reserva y el viaje siguen vivos y no hay bloqueo entre ambas personas. */
function chatOf(db: PreviewDb, ctx: BookingContext, viewerUserId: string): LiveChatRef {
  const driverId = ctx.trip.driver_user_id;
  const alive = ctx.booking.status === "confirmed" && (ctx.trip.status === "published" || ctx.trip.status === "active");
  return { peerUserId: driverId, available: alive && !isBlockedEitherWay(db, viewerUserId, driverId) };
}

function stopView(ctx: BookingContext, seq: number): LiveStop {
  const stop = ctxStop(ctx, seq);
  return { seq: stop.seq, label: stop.label, location: geoPoint(stop.lat, stop.lng) };
}

function pickupView(ctx: BookingContext): LiveStop {
  const point = pickupPoint(ctx);
  return { seq: ctx.pickupSeq, label: point.label, location: geoPoint(point.lat, point.lng) };
}

// ---------------------------------------------------------------------------------------------------------------
// 21 · Esperando el coche
// ---------------------------------------------------------------------------------------------------------------

export function buildLiveView(db: PreviewDb, ctx: BookingContext, viewerUserId: string): LiveBookingStatusView {
  const snap = liveSnapshot(db, ctx);
  const target = snap.phase === "in_vehicle" ? "dropoff" : "pickup";
  return {
    bookingId: ctx.booking.id,
    tripId: ctx.trip.id,
    phase: snap.phase,
    tripStatus: tripStatusOf(ctx.trip),
    bookingStatus: ctx.booking.status,
    serverTime: isoReq(snap.nowMs),
    driver: publicUser(db, ctx.trip.driver_user_id),
    vehicle: vehicleOf(db, ctx.trip),
    pickup: { ...pickupView(ctx), plannedAt: iso(scheduledAtMs(snap.model, ctx.pickupSeq)) },
    dropoff: { ...stopView(ctx, ctx.dropoffSeq), plannedAt: iso(scheduledAtMs(snap.model, ctx.dropoffSeq)) },
    etaTarget: target,
    eta: target === "dropoff" ? snap.etaDropoff : snap.etaPickup,
    signal: snap.signal,
    lastUpdateAt: snap.position?.recordedAt ?? null,
    lastUpdateAgeSeconds: snap.position?.ageSeconds ?? null,
    staleAfterSeconds: LIVE_SETTINGS.staleAfterSeconds,
    position: snap.position,
    arrival: snap.arrival,
    chat: chatOf(db, ctx, viewerUserId),
    pendingRouteChange: pendingRouteChangeOf(db, ctx),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 23 · En el coche
// ---------------------------------------------------------------------------------------------------------------

/** Estado del código de recogida: el código en claro nunca se guarda, solo su huella y los intentos. */
export function pickupCodeStateOf(db: PreviewDb, ctx: BookingContext): LivePickupCodeState {
  const row = db.pickupCodes.get(ctx.booking.id);
  if (!row) {
    if (ctx.booking.picked_up_at !== null) {
      return { status: "verified", codeLength: PICKUP_CODE_LENGTH, generatedAt: null, verifiedAt: iso(ctx.booking.picked_up_at), attemptsRemaining: null };
    }
    return { status: "not_generated", codeLength: PICKUP_CODE_LENGTH, generatedAt: null, verifiedAt: null, attemptsRemaining: null };
  }
  if (row.verified_at !== null) {
    return { status: "verified", codeLength: PICKUP_CODE_LENGTH, generatedAt: iso(row.generated_at), verifiedAt: iso(row.verified_at), attemptsRemaining: null };
  }
  const left = Math.max(0, row.max_attempts - row.attempts);
  return {
    status: left === 0 ? "locked" : "active",
    codeLength: PICKUP_CODE_LENGTH,
    generatedAt: iso(row.generated_at),
    verifiedAt: null,
    attemptsRemaining: left,
  };
}

function occupancyOf(db: PreviewDb, ctx: BookingContext, viewerUserId: string): LiveInCarState["occupancy"] {
  const members: LiveOccupant[] = [
    { role: "driver", isYou: false, user: publicUser(db, ctx.trip.driver_user_id) },
    { role: "passenger", isYou: true, user: publicUser(db, viewerUserId) },
  ];
  for (const other of coPassengers(db, ctx)) {
    const shares = livePrivacy(db).get(other.userId)?.show_profile_to_co_passengers === true;
    members.push({ role: "passenger", isYou: false, user: shares ? publicUser(db, other.userId) : null });
  }
  return { occupied: occupiedOnMyJourney(db, ctx), capacity: ctx.trip.offered_seats, members };
}

/** «Tu trayecto»: de TU recogida a TU destino. La primera parada sin completar es la «actual». */
function timelineOf(ctx: BookingContext, snap: LiveSnapshot): LiveTimelineStop[] {
  const rows = ctx.stops.filter((s) => s.seq >= ctx.pickupSeq && s.seq <= ctx.dropoffSeq);
  const isDone = (seq: number): boolean => {
    if (snap.phase === "completed") return true;
    if (!snap.pickedUp) return false;
    return seq <= ctx.pickupSeq || carPassed(snap, seq);
  };
  let currentTaken = false;
  return rows.map((stop): LiveTimelineStop => {
    const done = isDone(stop.seq);
    let state: LiveTimelineStop["state"] = "next";
    if (done) state = "done";
    else if (!currentTaken) {
      state = "current";
      currentTaken = true;
    }
    const etaMs = stopEtaMs(snap, stop.seq, done) ?? scheduledAtMs(snap.model, stop.seq) ?? ctx.trip.departure_at ?? snap.nowMs;
    return {
      seq: stop.seq,
      label: stop.label,
      location: geoPoint(stop.lat, stop.lng),
      role: stop.seq === ctx.pickupSeq ? "pickup" : stop.seq === ctx.dropoffSeq ? "dropoff" : "stop",
      eta: isoReq(etaMs),
      state,
    };
  });
}

/** Enlace de «Compartir viaje» vigente de esta reserva (sin revelar nada más que su caducidad). */
export function activeShareOf(db: PreviewDb, bookingId: string): { active: boolean; expiresAt: string | null } {
  const now = db.nowMs();
  const share = liveShares(db).find((s) => s.booking_id === bookingId && s.revoked_at === null && s.expires_at > now);
  return share ? { active: true, expiresAt: iso(share.expires_at) } : { active: false, expiresAt: null };
}

export function buildInCarView(db: PreviewDb, ctx: BookingContext, viewerUserId: string): LiveInCarState {
  const snap = liveSnapshot(db, ctx);
  const eta = snap.etaDropoff;
  return {
    bookingId: ctx.booking.id,
    tripId: ctx.trip.id,
    phase: snap.phase,
    tripStatus: tripStatusOf(ctx.trip),
    serverTime: isoReq(snap.nowMs),
    driver: publicUser(db, ctx.trip.driver_user_id),
    vehicle: vehicleOf(db, ctx.trip),
    pickupCode: pickupCodeStateOf(db, ctx),
    occupancy: occupancyOf(db, ctx, viewerUserId),
    timeline: timelineOf(ctx, snap),
    etaAtDestination: eta,
    remaining: eta === null ? null : { minutes: eta.minutes, distanceM: eta.distanceM },
    signal: snap.signal,
    lastUpdateAt: snap.position?.recordedAt ?? null,
    share: activeShareOf(db, ctx.booking.id),
    chat: chatOf(db, ctx, viewerUserId),
    pendingRouteChange: pendingRouteChangeOf(db, ctx),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 24 · Viaje terminado
// ---------------------------------------------------------------------------------------------------------------

/** Fin del plazo para valorar; `null` mientras el viaje no esté terminado. */
export function ratingWindowEndsAt(ctx: BookingContext): number | null {
  const completedAt = ctx.trip.completed_at;
  return completedAt === null ? null : completedAt + RATING_WINDOW_DAYS * DAY_MS;
}

/**
 * Un pago confirmado por el proveedor SOLO existe en la simulación si la reserva lo declara con este prefijo; ninguna
 * semilla lo usa: sin tarifa aprobada el importe es siempre «por definir» y el que se ve es una propuesta ilustrativa.
 */
export const PAYMENT_CONFIRMED_PREFIX = "pi_confirmed_";

export function buildSummaryView(db: PreviewDb, ctx: BookingContext, viewerUserId: string): LiveBookingSummary {
  const now = db.nowMs();
  const { trip, booking } = ctx;
  const model = loadRouteModel(db, trip.id);
  const journey = journeySums(model, ctx.pickupSeq, ctx.dropoffSeq);
  const pickupFraction = model.stops.find((s) => s.seq === ctx.pickupSeq)?.frac ?? 0;
  const dropoffFraction = model.stops.find((s) => s.seq === ctx.dropoffSeq)?.frac ?? 1;
  const actual = booking.picked_up_at !== null && trip.completed_at !== null && trip.completed_at > booking.picked_up_at;
  const arrived = trip.status === "completed" && booking.status === "completed";

  const mine = liveRatings(db).find((r) => r.trip_id === trip.id && r.rater_user_id === viewerUserId && r.ratee_user_id === trip.driver_user_id);
  const windowEnds = ratingWindowEndsAt(ctx);
  let reason: LiveRatingBlockReason | null = null;
  if (trip.status !== "completed") reason = "trip_not_completed";
  else if (booking.status !== "completed") reason = "booking_not_completed";
  else if (mine) reason = "already_rated";
  else if (windowEnds !== null && now > windowEnds) reason = "window_closed";

  const confirmed = booking.provider_payment_id.startsWith(PAYMENT_CONFIRMED_PREFIX);
  const amount = booking.amount_cents <= 0 ? moneyPending() : confirmed ? moneyDefined(booking.amount_cents) : moneyIllustrative(booking.amount_cents);
  return {
    bookingId: booking.id,
    tripId: trip.id,
    tripStatus: tripStatusOf(trip),
    bookingStatus: booking.status,
    arrived,
    pickup: { ...pickupView(ctx), at: iso(booking.picked_up_at ?? scheduledAtMs(model, ctx.pickupSeq)) },
    dropoff: { ...stopView(ctx, ctx.dropoffSeq), at: iso(trip.completed_at ?? scheduledAtMs(model, ctx.dropoffSeq)) },
    path: pathBetween(trip.route_geometry, pickupFraction, dropoffFraction),
    duration: actual
      ? { seconds: Math.round(((trip.completed_at as number) - (booking.picked_up_at as number)) / 1000), source: "actual" }
      : { seconds: Math.round(journey.durationS), source: "planned" },
    distance: { meters: Math.round(journey.distanceM), basis: "planned_road_route" },
    passengers: { count: occupiedOnMyJourney(db, ctx), capacity: trip.offered_seats },
    driver: publicUser(db, trip.driver_user_id),
    vehicle: vehicleOf(db, trip),
    payment: { status: confirmed ? "confirmed" : "pending_definition", amount },
    rating: {
      canRate: reason === null,
      reason,
      rateeUserId: trip.driver_user_id,
      windowEndsAt: iso(windowEnds),
      mine: mine
        ? {
            id: mine.id,
            tripId: mine.trip_id,
            raterUserId: mine.rater_user_id,
            rateeUserId: mine.ratee_user_id,
            stars: mine.stars,
            comment: mine.comment,
            createdAt: isoReq(mine.created_at),
          }
        : null,
    },
    incidents: {
      canReport: true,
      mineCount: liveIncidents(db).count((r) => r.reporter_user_id === viewerUserId && r.trip_id === trip.id),
    },
  };
}
