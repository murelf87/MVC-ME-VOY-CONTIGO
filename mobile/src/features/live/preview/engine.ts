/**
 * Motor de seguimiento de la vista previa (SIMULACIÓN): de la reserva de una persona y de la última posición que publicó
 * el conductor saca fase, señal, posición visible, llegada estimada y ocupación. La llegada estimada usa el dominio
 * compartido `preview/domain/liveEta.ts` (port de `src/modules/live/eta.ts`: la posición se proyecta sobre la ruta por
 * carretera guardada y se suman los tramos PLANIFICADOS más el tiempo de parada; sin tráfico real), el mismo que usa la
 * consola de quien conduce. Nada de aquí llega a producción.
 *
 * Reglas del contrato (`docs/contracts/live.md` §0 y §3) que cumple:
 *  - posición precisa solo para quien tiene una reserva `confirmed` de un viaje `active` (aquí: siempre el titular);
 *  - si el conductor desactiva «Compartir ubicación en viaje» la posición es APROXIMADA (cuadrícula de ~1 km, sin rumbo
 *    ni velocidad, `accuracyM: 1000`) y la distancia restante en metros pasa a `null`;
 *  - nunca «en directo» con una posición vieja: `signal` es `live` solo si `ageSeconds <= 60`;
 *  - con señal no viva, `arrival.warning/arrived` son `false` y la llegada es aproximada.
 */
import type { GeoPoint, LiveArrival, LiveEta, LivePhase, LivePosition, LiveSignal, LiveTripStatus, LiveVehicle } from "@/api/types";
import { ApiFailure, LIVE_SETTINGS, computeEta, distanceM, iso, loadLiveFix, loadRouteModel, minutesUntil, plannedArrival, progressOf, signalOf, snapToGrid } from "@/preview";
import type { BookingRow, EtaCalc, LiveFix, PreviewDb, RideRequestRow, RouteModel, TripRow, TripStopRow } from "@/preview";
import { sharesLiveLocation } from "./rows";

export const APPROXIMATE_ACCURACY_M = 1000;
export const PICKUP_CODE_LENGTH = 6;

export interface BookingContext {
  booking: Readonly<BookingRow>;
  request: Readonly<RideRequestRow>;
  trip: Readonly<TripRow>;
  stops: ReadonlyArray<Readonly<TripStopRow>>;
  pickupSeq: number;
  dropoffSeq: number;
}

/** Reserva del pasajero titular; cualquier otra persona recibe `404 BOOKING_NOT_FOUND` (no se revela si existe). */
export function loadBookingContext(db: PreviewDb, bookingId: string, viewerUserId: string): BookingContext {
  const booking = db.bookings.get(bookingId);
  const request = booking ? db.rideRequests.get(booking.request_id) : undefined;
  const trip = request ? db.trips.get(request.trip_id) : undefined;
  if (!booking || !request || !trip || request.passenger_user_id !== viewerUserId) {
    throw new ApiFailure("BOOKING_NOT_FOUND", "Booking not found", 404);
  }
  const stops = db.tripStops.filter((s) => s.trip_id === trip.id).sort((a, b) => a.seq - b.seq);
  const pickupSeq = request.from_segment_seq;
  const dropoffSeq = request.dropoff_stop_seq ?? request.to_segment_seq;
  if (!stops.some((s) => s.seq === pickupSeq) || !stops.some((s) => s.seq === dropoffSeq) || dropoffSeq <= pickupSeq) {
    throw new ApiFailure("BOOKING_NOT_FOUND", "Booking not found", 404);
  }
  return { booking, request, trip, stops, pickupSeq, dropoffSeq };
}

export function ctxStop(ctx: BookingContext, seq: number): Readonly<TripStopRow> {
  const stop = ctx.stops.find((s) => s.seq === seq);
  if (!stop) throw new ApiFailure("BOOKING_NOT_FOUND", "Booking not found", 404);
  return stop;
}

export function geoPoint(lat: number, lng: number): GeoPoint {
  return { lat, lng };
}

/** El borrador no se ve como tal desde una reserva: a efectos del pasajero es un viaje publicado. */
export function tripStatusOf(trip: Readonly<TripRow>): LiveTripStatus {
  return trip.status === "draft" ? "published" : trip.status;
}

export function vehicleOf(db: PreviewDb, trip: Readonly<TripRow>): LiveVehicle {
  const vehicle = db.vehicles.get(trip.vehicle_id);
  return {
    make: vehicle?.make ?? "",
    model: vehicle?.model ?? "",
    color: vehicle?.color ?? null,
    plate: vehicle?.plate ?? "",
  };
}

/** Punto de recogida del pasajero: el que pidió (si indicó uno) o la parada del conductor. */
export function pickupPoint(ctx: BookingContext): { lat: number; lng: number; label: string | null } {
  const stop = ctxStop(ctx, ctx.pickupSeq);
  return { lat: ctx.request.pickup_lat ?? stop.lat, lng: ctx.request.pickup_lng ?? stop.lng, label: ctx.request.pickup_label ?? stop.label };
}

/** Hora planificada (ms) de paso por la parada `seq` según la hora publicada del viaje; `null` si no se puede calcular. */
export function scheduledAtMs(model: RouteModel, seq: number): number | null {
  return plannedArrival(model, seq, LIVE_SETTINGS.stopDwellSeconds, "schedule");
}

// ---------------------------------------------------------------------------------------------------------------
// Estado en directo
// ---------------------------------------------------------------------------------------------------------------

export interface LiveSnapshot {
  nowMs: number;
  phase: LivePhase;
  signal: LiveSignal;
  /** Última posición del viaje activo (`null` si no está activo o aún no hay GPS). */
  fix: LiveFix | null;
  /** `true` si el conductor comparte su ubicación exacta (por defecto). */
  precise: boolean;
  model: RouteModel;
  /** Tramo `c` y avance `q` (0..1) del coche sobre la ruta; `null` sin posición proyectable. */
  progress: { c: number; q: number } | null;
  position: LivePosition | null;
  pickedUp: boolean;
  etaPickup: LiveEta | null;
  etaDropoff: LiveEta | null;
  arrival: LiveArrival;
}

export function isPickedUp(db: PreviewDb, ctx: BookingContext): boolean {
  return ctx.booking.picked_up_at !== null || (db.pickupCodes.get(ctx.booking.id)?.verified_at ?? null) !== null;
}

function toLiveEta(calc: EtaCalc, nowMs: number, precise: boolean): LiveEta {
  return {
    at: iso(calc.atMs) as string,
    minutes: minutesUntil(calc.atMs, nowMs),
    // La distancia restante por la ruta revelaría el punto exacto si el conductor no comparte su ubicación: nunca se da.
    distanceM: calc.source === "live_route" && precise ? calc.remainingM : null,
    source: calc.source,
    approximate: calc.approximate,
  };
}

export function liveSnapshot(db: PreviewDb, ctx: BookingContext): LiveSnapshot {
  const now = db.nowMs();
  const { trip, booking } = ctx;
  const model = loadRouteModel(db, trip.id);
  const precise = sharesLiveLocation(db, trip.driver_user_id);
  const fix = trip.status === "active" ? loadLiveFix(db, trip.id) : null;
  const signal = signalOf(fix, now, LIVE_SETTINGS.staleAfterSeconds);
  const progress = progressOf(model, fix);
  const pickedUp = isPickedUp(db, ctx);
  const pickup = pickupPoint(ctx);
  const distanceToPickup = fix ? distanceM(fix.lat, fix.lng, pickup.lat, pickup.lng) : null;
  const toPickup = computeEta(model, ctx.pickupSeq, fix, now);

  const arrived = signal === "live" && !pickedUp && distanceToPickup !== null && distanceToPickup <= LIVE_SETTINGS.arrivedDistanceM;
  const warning =
    signal === "live" && !pickedUp && toPickup !== null && toPickup.source === "live_route" && (arrived || toPickup.remainingS <= LIVE_SETTINGS.arrivalWarningSeconds);

  let phase: LivePhase;
  if (booking.status === "cancelled" || booking.status === "driver_cancelled" || trip.status === "cancelled") phase = "cancelled";
  else if (trip.status === "completed" || booking.status === "completed" || booking.status === "no_show") phase = "completed";
  else if (trip.status !== "active") phase = "scheduled";
  else if (pickedUp) phase = "in_vehicle";
  else if (arrived) phase = "at_pickup";
  else if (warning) phase = "arriving";
  else phase = "driver_en_route";

  let position: LivePosition | null = null;
  if (fix) {
    const ageSeconds = Math.max(0, Math.floor((now - fix.recordedAtMs) / 1000));
    position = {
      location: precise ? geoPoint(fix.lat, fix.lng) : geoPoint(snapToGrid(fix.lat), snapToGrid(fix.lng)),
      headingDegrees: precise ? fix.headingDegrees : null,
      speedMps: precise ? fix.speedMps : null,
      accuracyM: precise ? fix.accuracyM : APPROXIMATE_ACCURACY_M,
      recordedAt: iso(fix.recordedAtMs) as string,
      receivedAt: iso(fix.receivedAtMs) as string,
      ageSeconds,
      stale: ageSeconds > LIVE_SETTINGS.staleAfterSeconds,
      precision: precise ? "precise" : "approximate",
    };
  }

  const noEta = phase === "cancelled" || phase === "completed";
  return {
    nowMs: now,
    phase,
    signal,
    fix,
    precise,
    model,
    progress,
    position,
    pickedUp,
    etaPickup: noEta || pickedUp || toPickup === null ? null : toLiveEta(toPickup, now, precise),
    etaDropoff: noEta ? null : toLiveEtaOrNull(computeEta(model, ctx.dropoffSeq, fix, now), now, precise),
    arrival: { warning, arrived, warningThresholdSeconds: LIVE_SETTINGS.arrivalWarningSeconds },
  };
}

function toLiveEtaOrNull(calc: EtaCalc | null, nowMs: number, precise: boolean): LiveEta | null {
  return calc === null ? null : toLiveEta(calc, nowMs, precise);
}

/** Hora estimada (ms) de paso por la parada `seq`: en vivo si el coche aún no la pasó, la planificada en otro caso. */
export function stopEtaMs(snap: LiveSnapshot, seq: number, passedAlready: boolean): number | null {
  if (!passedAlready && snap.fix !== null) {
    const calc = computeEta(snap.model, seq, snap.fix, snap.nowMs);
    if (calc) return calc.atMs;
  }
  return plannedArrival(snap.model, seq, LIVE_SETTINGS.stopDwellSeconds);
}

/** ¿El coche ya pasó por la parada `seq`? */
export function carPassed(snap: LiveSnapshot, seq: number): boolean {
  const progress = snap.progress;
  if (progress === null) return false;
  return seq <= progress.c || (seq === progress.c + 1 && progress.q >= 0.999);
}

// ---------------------------------------------------------------------------------------------------------------
// Ocupación del coche
// ---------------------------------------------------------------------------------------------------------------

const RIDING_STATUSES: ReadonlySet<string> = new Set(["confirmed", "completed"]);

export interface Rider {
  bookingId: string;
  userId: string;
  fromSeq: number;
  toSeq: number;
}

/** Pasajeros del viaje (reservas confirmadas o completadas), con su rango de paradas. */
export function ridersOf(db: PreviewDb, tripId: string): Rider[] {
  const out: Rider[] = [];
  for (const booking of db.bookings.all()) {
    if (!RIDING_STATUSES.has(booking.status)) continue;
    const request = db.rideRequests.get(booking.request_id);
    if (!request || request.trip_id !== tripId) continue;
    out.push({
      bookingId: booking.id,
      userId: request.passenger_user_id,
      fromSeq: request.from_segment_seq,
      toSeq: request.dropoff_stop_seq ?? request.to_segment_seq,
    });
  }
  return out;
}

/** Plazas ocupadas en el tramo más ocupado del trayecto de `ctx` (incluida la persona titular). */
export function occupiedOnMyJourney(db: PreviewDb, ctx: BookingContext): number {
  const riders = ridersOf(db, ctx.trip.id);
  let max = 1;
  for (let seq = ctx.pickupSeq; seq < ctx.dropoffSeq; seq += 1) {
    const count = riders.filter((r) => r.fromSeq <= seq && r.toSeq > seq).length;
    if (count > max) max = count;
  }
  return max;
}

/** Copasajeros cuyo trayecto coincide en algún tramo con el de `ctx` (sin la persona titular). */
export function coPassengers(db: PreviewDb, ctx: BookingContext): Rider[] {
  return ridersOf(db, ctx.trip.id).filter((r) => r.bookingId !== ctx.booking.id && r.fromSeq < ctx.dropoffSeq && r.toSeq > ctx.pickupSeq);
}

// ---------------------------------------------------------------------------------------------------------------
// Trazado simplificado del trayecto (mapa de «Viaje terminado»)
// ---------------------------------------------------------------------------------------------------------------

const MAX_PATH_POINTS = 48;

/** Trozo de la ruta entre dos fracciones de su longitud, con a lo sumo `MAX_PATH_POINTS` puntos (siempre con los extremos). */
export function pathBetween(route: ReadonlyArray<readonly [number, number]>, fromFraction: number, toFraction: number): GeoPoint[] {
  if (route.length < 2) return [];
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < route.length; i += 1) {
    const a = route[i - 1] as readonly [number, number];
    const b = route[i] as readonly [number, number];
    const length = distanceM(a[1], a[0], b[1], b[0]);
    lengths.push(length);
    total += length;
  }
  if (total <= 0) return [];
  const fromM = Math.min(1, Math.max(0, fromFraction)) * total;
  const toM = Math.min(1, Math.max(fromFraction, toFraction)) * total;

  const points: GeoPoint[] = [];
  const add = (lat: number, lng: number): void => {
    points.push(geoPoint(Number(lat.toFixed(6)), Number(lng.toFixed(6))));
  };
  let walked = 0;
  for (let i = 1; i < route.length; i += 1) {
    const a = route[i - 1] as readonly [number, number];
    const b = route[i] as readonly [number, number];
    const length = lengths[i - 1] as number;
    const start = walked;
    const end = walked + length;
    walked = end;
    if (end < fromM || start > toM) continue;
    const at = (m: number): [number, number] => {
      const t = length <= 0 ? 0 : Math.min(1, Math.max(0, (m - start) / length));
      return [a[1] + (b[1] - a[1]) * t, a[0] + (b[0] - a[0]) * t];
    };
    if (points.length === 0) {
      const [lat, lng] = at(Math.max(start, fromM));
      add(lat, lng);
    }
    if (end <= toM) add(b[1], b[0]);
    else {
      const [lat, lng] = at(toM);
      add(lat, lng);
    }
  }
  if (points.length <= MAX_PATH_POINTS) return points;
  const stride = Math.ceil(points.length / MAX_PATH_POINTS);
  const picked = points.filter((_, index) => index % stride === 0);
  const last = points[points.length - 1];
  if (last !== undefined && picked[picked.length - 1] !== last) picked.push(last);
  return picked;
}
