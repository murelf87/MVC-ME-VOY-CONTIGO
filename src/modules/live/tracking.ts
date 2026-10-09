import type { BookingContext } from "./booking-context.js";
import { ageSecondsOf, APPROXIMATE_RADIUS_M, approximateCoordinate, haversineM, point, type Db } from "./common.js";
import { liveSettings, type LiveSettings } from "./config.js";
import { sharesPreciseLocation } from "./privacy-service.js";
import {
  computeEta, loadLiveFix, loadRouteModel, minutesUntil, progressOf, signalOf, stopAt,
  type EtaCalc, type LiveFix, type RouteModel
} from "./eta.js";
import type { LiveArrival, LiveEta, LivePhase, LivePosition, LiveSignal } from "./types.js";

/**
 * Seguimiento derivado desde el punto de vista de UN pasajero: señal, posición visible, ETA, aviso de llegada y fase.
 * Reglas de privacidad aplicadas aquí (una sola vez, para /live, /in-car y el enlace compartido):
 *  - la posición precisa solo existe con viaje `active` y reserva `confirmed`;
 *  - cuando el coche ya dejó atrás el destino del pasajero (y este ya subió), deja de verse (no se sigue al conductor con otros pasajeros);
 *  - una posición vieja NUNCA es «en directo»: señal `stale` y avisos de llegada desactivados;
 *  - si el conductor desactivó «Compartir ubicación en viaje» (ajuste de `comms`), la posición sale APROXIMADA (cuadrícula de ~1 km,
 *    sin rumbo ni velocidad, `precision:"approximate"`) y NO se da la distancia restante en metros (`eta.distanceM = null`): junto con la
 *    ruta revelaría el punto exacto. La hora y los minutos de llegada y los avisos de llegada sí se mantienen.
 */
export type PassengerTracking = {
  model: RouteModel;
  settings: LiveSettings;
  /** Último punto conocido, si se puede mostrar a este pasajero. */
  fix: LiveFix | null;
  /** false si el conductor no comparte su ubicación precisa: coordenadas aproximadas y sin distancia restante en metros. */
  preciseLocation: boolean;
  signal: LiveSignal;
  progress: { c: number; q: number } | null;
  etaTarget: "pickup" | "dropoff";
  targetSeq: number;
  /** El coche ya dejó atrás el destino de este pasajero. */
  journeyOver: boolean;
  calc: EtaCalc | null;
  eta: LiveEta | null;
  arrival: LiveArrival;
  phase: LivePhase;
  position: LivePosition | null;
};

/** `withDistance=false` oculta la distancia restante (con la ruta revelaría la posición exacta del coche). */
export function toLiveEta(calc: EtaCalc, now: Date, withDistance = true): LiveEta {
  return {
    at: calc.at.toISOString(),
    minutes: minutesUntil(calc.at, now),
    distanceM: withDistance ? calc.remainingM : null,
    source: calc.source,
    approximate: calc.approximate
  };
}

export function derivePhase(ctx: BookingContext, arrival: LiveArrival): LivePhase {
  if (ctx.bookingStatus === "cancelled" || ctx.bookingStatus === "driver_cancelled" || ctx.tripStatus === "cancelled") {
    return "cancelled";
  }
  if (ctx.tripStatus === "completed" || ctx.bookingStatus === "completed" || ctx.bookingStatus === "no_show") {
    return "completed";
  }
  if (ctx.tripStatus === "published") return "scheduled";
  if (ctx.pickedUpAt) return "in_vehicle";
  if (arrival.arrived) return "at_pickup";
  if (arrival.warning) return "arriving";
  return "driver_en_route";
}

/** `precise=false` ⇒ posición aproximada (cuadrícula de ~1 km, sin rumbo ni velocidad; `accuracyM` = radio de incertidumbre). */
export function toLivePosition(fix: LiveFix, now: Date, stale: boolean, precise = true): LivePosition {
  const ageSeconds = ageSecondsOf(fix.recordedAt, now);
  return {
    location: precise ? point(fix.lat, fix.lng) : point(approximateCoordinate(fix.lat), approximateCoordinate(fix.lng)),
    headingDegrees: precise ? fix.headingDegrees : null,
    speedMps: precise ? fix.speedMps : null,
    accuracyM: precise ? fix.accuracyM : APPROXIMATE_RADIUS_M,
    recordedAt: fix.recordedAt.toISOString(),
    receivedAt: fix.receivedAt.toISOString(),
    ageSeconds,
    stale,
    precision: precise ? "precise" : "approximate"
  };
}

export async function trackPassenger(
  db: Db, ctx: BookingContext, now: Date, settings: LiveSettings = liveSettings()
): Promise<PassengerTracking> {
  const model = await loadRouteModel(db, ctx.tripId);
  const tripActive = ctx.tripStatus === "active";
  const bookingLive = ctx.bookingStatus === "confirmed";
  const pickedUp = ctx.pickedUpAt !== null;

  const rawFix = tripActive && bookingLive ? await loadLiveFix(db, ctx.tripId) : null;
  const pickupStop = stopAt(model, ctx.fromSeq);
  const dropoffStop = stopAt(model, ctx.toSeq);

  let journeyOver = false;
  if (pickedUp && rawFix && rawFix.frac !== null && model.routeDistanceM) {
    journeyOver = (rawFix.frac - dropoffStop.frac) * model.routeDistanceM > 3 * settings.arrivedDistanceM;
  }
  const fix = journeyOver ? null : rawFix;
  const signal = signalOf(fix, now, settings.staleAfterSeconds);
  const progress = progressOf(model, fix);

  const etaTarget: "pickup" | "dropoff" = pickedUp ? "dropoff" : "pickup";
  const targetSeq = pickedUp ? ctx.toSeq : ctx.fromSeq;
  const etaApplicable = bookingLive && (tripActive || ctx.tripStatus === "published") && !journeyOver;
  let calc = etaApplicable ? computeEta(model, targetSeq, fix, now, settings) : null;

  const waiting = tripActive && bookingLive && !pickedUp;
  const live = signal === "live";
  const distanceToPickup = waiting && fix ? haversineM(fix.lat, fix.lng, pickupStop.lat, pickupStop.lng) : null;
  const arrived = live && waiting && distanceToPickup !== null && distanceToPickup <= settings.arrivedDistanceM;

  // El coche ya pasó por la recogida sin que se verifique al pasajero y está lejos: no hay ETA fiable.
  if (waiting && calc && calc.source === "live_route" && calc.passed && !calc.offRoute && !arrived
      && distanceToPickup !== null && distanceToPickup > 3 * settings.arrivedDistanceM) {
    calc = null;
  }

  const warning = live && waiting
    && (arrived || (calc !== null && calc.source === "live_route" && calc.remainingS <= settings.arrivalWarningSeconds));
  const arrival: LiveArrival = { warning, arrived, warningThresholdSeconds: settings.arrivalWarningSeconds };
  // Solo se consulta el ajuste del conductor cuando hay una posición que mostrar.
  const precise = fix ? await sharesPreciseLocation(db, ctx.driverUserId) : true;

  return {
    model,
    settings,
    fix,
    preciseLocation: precise,
    signal,
    progress,
    etaTarget,
    targetSeq,
    journeyOver,
    calc,
    eta: calc ? toLiveEta(calc, now, precise) : null,
    arrival,
    phase: derivePhase(ctx, arrival),
    position: fix ? toLivePosition(fix, now, signal === "stale", precise) : null
  };
}
