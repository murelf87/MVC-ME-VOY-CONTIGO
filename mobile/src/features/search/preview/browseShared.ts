/**
 * Piezas comunes del servidor simulado de «buscar y ver viajes»: provincia, vehículo visible, relación de quien mira con el
 * viaje (público / conductor / solicitante / pasajero), ¿puede solicitar plaza?, y la vista de un punto (aproximado o
 * preciso). Portan `src/modules/trips/{detail-service,pickup-service,dto}.ts` del backend real.
 *
 * SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`).
 */
import type { GeoPoint, PrecisePoint, RideRequestStatus, VehicleSummary } from "@/api/types";
import { fail, madridHHmm, madridParts, pointInRing, utcToday, type PreviewDb, type TripRow } from "@/preview";
import { approx3 } from "./browseGeometry";

export function assertProvince(db: PreviewDb, provinceId: string): void {
  if (!db.provinces.has(provinceId)) fail("PROVINCE_NOT_FOUND", "La provincia no existe.", 404);
}

export function pointInProvince(db: PreviewDb, provinceId: string, point: GeoPoint): boolean {
  const province = db.provinces.get(provinceId);
  if (!province) return fail("PROVINCE_NOT_FOUND", "La provincia no existe.", 404);
  return pointInRing(point.lat, point.lng, province.ring);
}

export function localTimeOf(ms: number): string {
  return madridHHmm(ms);
}

export function localMinutesOf(ms: number): number {
  const parts = madridParts(ms);
  return parts.hour * 60 + parts.minute;
}

export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** «Vehículo en condiciones de circular» (`VEHICLE_BOOKABLE_SQL`): todo lo que se enseña públicamente lo exige. */
export function vehicleBookable(db: PreviewDb, trip: Readonly<TripRow>): boolean {
  const vehicle = db.vehicles.get(trip.vehicle_id);
  return (
    vehicle !== undefined &&
    vehicle.review_status === "approved" &&
    vehicle.documentation_status === "approved" &&
    vehicle.vehicle_photo_status === "approved" &&
    vehicle.insurance_status === "approved" &&
    vehicle.insurance_expires_on !== null &&
    vehicle.insurance_expires_on >= utcToday(db)
  );
}

/**
 * Vehículo tal y como lo ve el lector. La matrícula COMPLETA solo para el conductor y para pasajeros con reserva
 * confirmada (`full`); para el resto solo una pista de 3 caracteres, y nunca el id del vehículo.
 */
export function vehicleSummary(db: PreviewDb, trip: Readonly<TripRow>, full: boolean, includeId: boolean): VehicleSummary {
  const vehicle = db.vehicles.get(trip.vehicle_id);
  if (!vehicle) {
    return { id: null, make: "", model: "", color: null, displayName: "Vehículo", plateHint: null, plate: null, passengerSeats: trip.offered_seats };
  }
  const hint = vehicle.plate_normalized.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-3);
  return {
    id: includeId ? vehicle.id : null,
    make: vehicle.make,
    model: vehicle.model,
    color: vehicle.color,
    displayName: `${vehicle.make.trim()} ${vehicle.model.trim()}`.replace(/\s+/g, " ").trim(),
    plateHint: hint || null,
    plate: full ? vehicle.plate : null,
    passengerSeats: vehicle.passenger_seats,
  };
}

/** Punto con precisión explícita: coordenadas aproximadas (3 decimales ≈ 110 m) si quien mira no participa. */
export function viewPoint(point: GeoPoint, precise: boolean): PrecisePoint {
  return precise
    ? { lat: point.lat, lng: point.lng, precision: "precise" }
    : { lat: approx3(point.lat), lng: approx3(point.lng), precision: "approximate" };
}

// ---------------------------------------------------------------------------------------------------------------
// Relación de quien mira con el viaje
// ---------------------------------------------------------------------------------------------------------------

export interface ViewerStanding {
  relation: "public" | "driver" | "requester" | "passenger";
  /** Solicitud abierta del lector en este viaje (pending | payment_pending | confirmed). */
  openRequest: {
    id: string;
    status: RideRequestStatus;
    fromSegmentSeq: number;
    toSegmentSeq: number;
    dropoffStopSeq: number | null;
    /** La subida es una parada declarada (y no un punto proyectado sobre la ruta). */
    pickupIsDeclaredStop: boolean;
  } | null;
  precision: "approximate" | "precise";
  /** Matrícula completa: conductor o reserva confirmada. */
  fullPlate: boolean;
}

const OPEN_REQUEST_STATUSES: ReadonlySet<string> = new Set(["pending", "accepted", "payment_pending", "confirmed"]);

export function viewerStanding(db: PreviewDb, trip: Readonly<TripRow>, userId: string | null): ViewerStanding {
  if (userId === null) return { relation: "public", openRequest: null, precision: "approximate", fullPlate: false };
  if (userId === trip.driver_user_id) return { relation: "driver", openRequest: null, precision: "precise", fullPlate: true };
  const open = db.rideRequests
    .filter((r) => r.trip_id === trip.id && r.passenger_user_id === userId && OPEN_REQUEST_STATUSES.has(r.status))
    .sort((a, b) => b.requested_at - a.requested_at)[0];
  if (!open) return { relation: "public", openRequest: null, precision: "approximate", fullPlate: false };
  const status: RideRequestStatus = open.status === "accepted" ? "payment_pending" : open.status;
  const confirmed = status === "confirmed";
  return {
    relation: confirmed ? "passenger" : "requester",
    openRequest: {
      id: open.id,
      status,
      fromSegmentSeq: open.from_segment_seq,
      toSegmentSeq: open.to_segment_seq,
      dropoffStopSeq: open.dropoff_stop_seq ?? null,
      pickupIsDeclaredStop: open.pickup_source === undefined || open.pickup_source === null || open.pickup_source === "driver_stop",
    },
    // Coordenadas precisas con solicitud aceptada (hold activo) o confirmada.
    precision: status === "payment_pending" || confirmed ? "precise" : "approximate",
    fullPlate: confirmed,
  };
}

export interface Bookability {
  canRequest: boolean;
  reason: string | null;
}

/** ¿Puede el lector solicitar plaza ahora mismo en este rango? Códigos estables del contrato. */
export function bookability(input: {
  db: PreviewDb;
  trip: Readonly<TripRow>;
  userId: string | null;
  standing: ViewerStanding;
  freeSeats: number;
}): Bookability {
  const { db, trip, userId, standing } = input;
  if (userId === null) return { canRequest: false, reason: "AUTH_REQUIRED" };
  if (userId === trip.driver_user_id) return { canRequest: false, reason: "DRIVER_CANNOT_REQUEST_OWN_TRIP" };
  const open = trip.status === "published" || trip.status === "active";
  const notDeparted = trip.status === "active" || (trip.departure_at !== null && trip.departure_at > db.nowMs() - 5 * 60_000);
  if (!open || !vehicleBookable(db, trip) || !notDeparted) return { canRequest: false, reason: "TRIP_NOT_BOOKABLE" };
  if (standing.openRequest) return { canRequest: false, reason: "OPEN_REQUEST_EXISTS" };
  if (input.freeSeats <= 0) return { canRequest: false, reason: "NO_CAPACITY" };
  return { canRequest: true, reason: null };
}

/** Un viaje en borrador o cancelado solo lo ve su conductor; para el resto es 404 como en el backend real. */
export function loadVisibleTrip(db: PreviewDb, tripId: string, viewerUserId: string | null): Readonly<TripRow> {
  const trip = db.trips.get(tripId);
  const isDriver = trip !== undefined && viewerUserId === trip.driver_user_id;
  if (!trip || ((trip.status === "draft" || trip.status === "cancelled") && !isDriver)) {
    return fail("TRIP_NOT_FOUND", "El viaje no existe.", 404);
  }
  return trip;
}
