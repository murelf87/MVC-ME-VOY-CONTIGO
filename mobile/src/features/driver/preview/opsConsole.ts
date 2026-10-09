/**
 * `GET /v1/me/trips/{tripId}/console` en el backend en memoria de la vista previa: la consola en directo de la persona que
 * conduce (equivale a `getDriverConsole` de `src/modules/live/console-service.ts`, contrato `docs/contracts/live.md` §4.4).
 * SIMULACIÓN: solo con `EXPO_PUBLIC_PREVIEW=1`.
 *
 * Todo se deriva del mundo sembrado en cada petición (nada se guarda aquí): pasajeros confirmados, estado del código de
 * cada recogida, ETA hasta cada parada con la posición viva proyectada sobre la ruta, señal propia y propuesta de cambio de
 * ruta pendiente. El servidor dicta el estado; la app no lo adivina.
 */
import type { LiveBookingStatus, LiveConsole, LiveConsolePassenger, LiveEta, LivePickupCodeStatus, LivePosition, LiveStop, LiveTripStatus } from "@/api/types";
import {
  ApiFailure,
  LIVE_SETTINGS,
  computeEta,
  expireDueRouteChanges,
  isoReq,
  loadLiveFix,
  loadRouteModel,
  minutesUntil,
  pendingRouteChangeForDriver,
  publicUser,
  signalOf,
  stopAt,
  type EtaCalc,
  type LiveFix,
  type PreviewDb,
  type Principal,
  type RouteStop,
} from "@/preview";

/** Solo las columnas de `live_ratings` (tabla del paquete `live`) que lee la consola. */
interface RatingKey {
  trip_id: string;
  rater_user_id: string;
  ratee_user_id: string;
}

interface PassengerLine {
  bookingId: string;
  status: LiveBookingStatus;
  pickedUpAt: number | null;
  createdAt: number;
  passengerUserId: string;
  from: number;
  to: number;
}

const toLiveStop = (stop: RouteStop): LiveStop => ({ seq: stop.seq, label: stop.label, location: { lat: stop.lat, lng: stop.lng } });

function toLiveEta(calc: EtaCalc, nowMs: number): LiveEta {
  return {
    at: isoReq(calc.atMs),
    minutes: minutesUntil(calc.atMs, nowMs),
    distanceM: calc.remainingM,
    source: calc.source,
    approximate: calc.approximate,
  };
}

function toLivePosition(fix: LiveFix, nowMs: number, stale: boolean): LivePosition {
  return {
    location: { lat: fix.lat, lng: fix.lng },
    headingDegrees: fix.headingDegrees,
    speedMps: fix.speedMps,
    accuracyM: fix.accuracyM,
    recordedAt: isoReq(fix.recordedAtMs),
    receivedAt: isoReq(fix.receivedAtMs),
    ageSeconds: Math.max(0, Math.floor((nowMs - fix.recordedAtMs) / 1000)),
    stale,
    precision: "precise",
  };
}

function codeState(db: PreviewDb, line: PassengerLine): { status: LivePickupCodeStatus; attemptsRemaining: number | null } {
  if (line.pickedUpAt !== null) return { status: "verified", attemptsRemaining: null };
  const row = db.pickupCodes.get(line.bookingId);
  if (!row) return { status: "not_generated", attemptsRemaining: null };
  const remaining = Math.max(0, row.max_attempts - row.attempts);
  return { status: remaining === 0 ? "locked" : "active", attemptsRemaining: remaining };
}

function passengerLines(db: PreviewDb, tripId: string): PassengerLine[] {
  const lines: PassengerLine[] = [];
  for (const request of db.rideRequests.filter((r) => r.trip_id === tripId && r.status === "confirmed")) {
    const booking = db.bookings.find((b) => b.request_id === request.id);
    if (!booking) continue;
    if (booking.status !== "confirmed" && booking.status !== "completed" && booking.status !== "no_show") continue;
    lines.push({
      bookingId: booking.id,
      status: booking.status,
      pickedUpAt: booking.picked_up_at,
      createdAt: booking.created_at,
      passengerUserId: request.passenger_user_id,
      from: request.from_segment_seq,
      to: request.to_segment_seq,
    });
  }
  return lines.sort((a, b) => a.from - b.from || a.createdAt - b.createdAt || (a.bookingId < b.bookingId ? -1 : 1));
}

/** Consola del conductor propietario del viaje (`principal` ya autenticado y con rol de conductor). */
export function buildDriverConsole(db: PreviewDb, principal: Principal, tripId: string): LiveConsole {
  const model = loadRouteModel(db, tripId);
  if (model.driverUserId !== principal.userId) {
    throw new ApiFailure("TRIP_NOT_OWNED", "Only the trip driver may open the console", 403);
  }
  if (model.status === "draft") {
    throw new ApiFailure("CONSOLE_TRIP_NOT_PUBLISHED", "The trip has not been published yet", 409);
  }
  const status = model.status as LiveTripStatus;
  const nowMs = db.nowMs();
  expireDueRouteChanges(db, { tripId });

  const vehicle = db.vehicles.get(model.vehicleId);
  if (!vehicle) throw new ApiFailure("VEHICLE_NOT_FOUND", "Vehicle not found", 404);

  const fix = status === "active" ? loadLiveFix(db, tripId) : null;
  const signal = signalOf(fix, nowMs, LIVE_SETTINGS.staleAfterSeconds);

  const ratings = db.collection<RatingKey>("live_ratings");
  const lines = passengerLines(db, tripId);

  const passengers: LiveConsolePassenger[] = lines.map((line) => {
    let etaToPickup: LiveEta | null = null;
    if (status === "active" && line.status === "confirmed" && line.pickedUpAt === null) {
      const calc = computeEta(model, line.from, fix, nowMs, LIVE_SETTINGS);
      etaToPickup = calc ? toLiveEta(calc, nowMs) : null;
    }
    return {
      bookingId: line.bookingId,
      passenger: publicUser(db, line.passengerUserId),
      bookingStatus: line.status,
      pickup: toLiveStop(stopAt(model, line.from)),
      dropoff: toLiveStop(stopAt(model, line.to)),
      pickedUp: line.pickedUpAt !== null,
      pickedUpAt: line.pickedUpAt !== null ? isoReq(line.pickedUpAt) : null,
      code: codeState(db, line),
      etaToPickup,
      ratedByMe:
        ratings.find((r) => r.trip_id === tripId && r.rater_user_id === principal.userId && r.ratee_user_id === line.passengerUserId) !== undefined,
    };
  });

  // Asientos ocupados en el tramo más ocupado del viaje (reservas confirmadas o completadas).
  let occupied = 0;
  for (const segment of model.segments) {
    const count = lines.filter((l) => (l.status === "confirmed" || l.status === "completed") && l.from <= segment.seq && l.to > segment.seq).length;
    occupied = Math.max(occupied, count);
  }

  const waiting = passengers.filter((p) => p.bookingStatus === "confirmed" && !p.pickedUp);
  let next: LiveConsole["next"] = null;
  if (status === "active" && waiting.length > 0) {
    const ordered = [...waiting].sort((a, b) => {
      const ea = a.etaToPickup ? Date.parse(a.etaToPickup.at) : Number.POSITIVE_INFINITY;
      const eb = b.etaToPickup ? Date.parse(b.etaToPickup.at) : Number.POSITIVE_INFINITY;
      return (ea === eb ? 0 : ea < eb ? -1 : 1) || a.pickup.seq - b.pickup.seq;
    });
    const first = ordered[0];
    if (first) next = { bookingId: first.bookingId, passenger: first.passenger, pickup: first.pickup, etaToPickup: first.etaToPickup };
  }

  const pending = pendingRouteChangeForDriver(db, tripId);
  const live = status === "published" || status === "active";

  return {
    tripId,
    status,
    serverTime: isoReq(nowMs),
    departureAt: model.departureAtMs !== null ? isoReq(model.departureAtMs) : null,
    startedAt: model.startedAtMs !== null ? isoReq(model.startedAtMs) : null,
    completedAt: model.completedAtMs !== null ? isoReq(model.completedAtMs) : null,
    vehicle: { make: vehicle.make, model: vehicle.model, color: vehicle.color, plate: vehicle.plate },
    seats: { offered: model.offeredSeats, occupied },
    signal,
    position: fix ? toLivePosition(fix, nowMs, signal === "stale") : null,
    next,
    passengers,
    counts: {
      total: passengers.length,
      verified: passengers.filter((p) => p.pickedUp).length,
      pending: waiting.length,
    },
    pendingRouteChange: pending,
    actions: {
      canStart: status === "published",
      canComplete: status === "active",
      canProposeRouteChange: live && pending === null,
      willMarkNoShow: status === "active" ? waiting.length : 0,
    },
  };
}
