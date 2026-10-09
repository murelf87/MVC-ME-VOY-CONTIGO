/**
 * Oferta de viajes de la mañana del lunes 5 de octubre de 2026 en la provincia de Sevilla, coherente con las láminas
 * 09 (mapa: «2 plazas», «1 plaza», «Completo»), 11 (resultados: Ana ★ 4,8 (32) y Miguel ★ 4,9 (18)) y 12 (detalle:
 * Montequinto 08:05 → Dos Hermanas 08:15 → Universidad 08:28, 24 km, 23 min).
 *
 * Las rutas las calcula el proveedor simulado; en los viajes de las láminas se fijan las distancias y duraciones que
 * muestra el diseño (9 000 m + 15 000 m; 21 500 m).
 */
import type { PreviewDb } from "../core/db";
import { stableUuid } from "../core/ids";
import type { RideRequestRow, TripCategory, TripLeg, TripRow, TripStopRow } from "../core/rows";
import { sha256Hex } from "../core/sha256";
import type { GeoLatLng } from "../core/types";
import { computeProvinceCompliantSegmentPlan, insertTripWithPlan, type ProvinceRouteSegmentPlan } from "../domain/trips";
import { localAt } from "./anchor";
import { illustrativeFareCents } from "./fares";
import { SEED_IDS, SEED_USER_IDS, SEED_VEHICLE_IDS, type SeedUserKey, type SeedVehicleKey } from "./ids";

export interface SeedStop extends GeoLatLng {
  label: string;
}

export interface SeedRider {
  user: SeedUserKey;
  /** Tramos [from, to) que ocupa. */
  from: number;
  to: number;
}

export interface TripSpec {
  id: string;
  driver: SeedUserKey;
  vehicle: SeedVehicleKey;
  category: TripCategory;
  leg: TripLeg;
  /** Hora local de salida `HH:mm`. */
  at: string;
  dayOffset?: number;
  seats: number;
  flexibilityMinutes: number;
  maxDetourM: number;
  stops: readonly SeedStop[];
  /** Distancia y duración fijas por tramo (si faltan, las calcula el proveedor simulado). */
  segments?: ReadonlyArray<{ distanceM: number; durationS: number }>;
  riders?: readonly SeedRider[];
  status?: "published" | "draft";
}

const stop = (lat: number, lng: number, label: string): SeedStop => ({ latitude: lat, longitude: lng, label });

const MONTEQUINTO = stop(37.332, -5.937, "Montequinto");
const DOS_HERMANAS = stop(37.283, -5.921, "Dos Hermanas");
const UNIVERSIDAD = stop(37.383, -5.992, "Sevilla – Universidad");
const UNIVERSIDAD_DE_SEVILLA = stop(37.3825, -5.9919, "Universidad de Sevilla");
const MAIRENA = stop(37.3446, -6.0614, "Mairena del Aljarafe");
const SEVILLA_TRABAJO = stop(37.3873, -5.9769, "Sevilla (Trabajo)");
const SAN_JUAN = stop(37.3667, -6.0394, "San Juan de Aznalfarache");
const TORRE_SEVILLA = stop(37.4091, -6.0039, "Sevilla (Trabajo)");

export const TRIP_SPECS: readonly TripSpec[] = [
  {
    id: SEED_IDS.trips.anaMorning,
    driver: "ana",
    vehicle: "anaArona",
    category: "university",
    leg: "outbound",
    at: "08:05",
    seats: 3,
    flexibilityMinutes: 10,
    maxDetourM: 3000,
    stops: [MONTEQUINTO, DOS_HERMANAS, UNIVERSIDAD],
    segments: [
      { distanceM: 9000, durationS: 600 },
      { distanceM: 15000, durationS: 780 },
    ],
    riders: [{ user: "laura", from: 0, to: 2 }],
  },
  {
    id: SEED_IDS.trips.miguelAngelMorning,
    driver: "miguelAngel",
    vehicle: "miguelAngelLeon",
    category: "university",
    leg: "outbound",
    at: "08:03",
    seats: 3,
    flexibilityMinutes: 5,
    maxDetourM: 2000,
    stops: [MAIRENA, UNIVERSIDAD_DE_SEVILLA],
    segments: [{ distanceM: 21500, durationS: 1740 }],
    riders: [
      { user: "lucia", from: 0, to: 1 },
      { user: "javier", from: 0, to: 1 },
    ],
  },
  {
    id: SEED_IDS.trips.carlosWork,
    driver: "carlos",
    vehicle: "carlosClio",
    category: "work",
    leg: "outbound",
    at: "07:40",
    seats: 3,
    flexibilityMinutes: 5,
    maxDetourM: 2000,
    stops: [MAIRENA, SEVILLA_TRABAJO],
    riders: [
      { user: "elena", from: 0, to: 1 },
      { user: "pablo", from: 0, to: 1 },
    ],
  },
  {
    id: SEED_IDS.trips.martaWork,
    driver: "marta",
    vehicle: "martaYaris",
    category: "work",
    leg: "outbound",
    at: "08:30",
    seats: 2,
    flexibilityMinutes: 5,
    maxDetourM: 1500,
    stops: [SAN_JUAN, TORRE_SEVILLA],
    riders: [
      { user: "irene", from: 0, to: 1 },
      { user: "alvaro", from: 0, to: 1 },
    ],
  },
  {
    id: SEED_IDS.trips.anaReturn,
    driver: "ana",
    vehicle: "anaArona",
    category: "university",
    leg: "return",
    at: "18:00",
    seats: 3,
    flexibilityMinutes: 10,
    maxDetourM: 3000,
    stops: [UNIVERSIDAD, MONTEQUINTO],
    segments: [{ distanceM: 24000, durationS: 1500 }],
  },
  {
    id: SEED_IDS.trips.danielAlcala,
    driver: "daniel",
    vehicle: "danielFocus",
    category: "work",
    leg: "outbound",
    at: "07:50",
    seats: 3,
    flexibilityMinutes: 10,
    maxDetourM: 2500,
    stops: [stop(37.338, -5.84, "Alcalá de Guadaíra"), stop(37.404, -6.012, "Parque Científico y Tecnológico Cartuja")],
    riders: [{ user: "nuria", from: 0, to: 1 }],
  },
  {
    id: SEED_IDS.trips.miguelAngelReturn,
    driver: "miguelAngel",
    vehicle: "miguelAngelLeon",
    category: "university",
    leg: "return",
    at: "17:45",
    seats: 3,
    flexibilityMinutes: 5,
    maxDetourM: 2000,
    stops: [UNIVERSIDAD_DE_SEVILLA, MAIRENA],
  },
  {
    id: SEED_IDS.trips.carlosReturn,
    driver: "carlos",
    vehicle: "carlosClio",
    category: "work",
    leg: "return",
    at: "18:15",
    seats: 3,
    flexibilityMinutes: 5,
    maxDetourM: 2000,
    stops: [SEVILLA_TRABAJO, MAIRENA],
    riders: [{ user: "pablo", from: 0, to: 1 }],
  },
  {
    id: SEED_IDS.trips.carmenHospital,
    driver: "carmen",
    vehicle: "carmen208",
    category: "hospital",
    leg: "outbound",
    at: "07:35",
    seats: 3,
    flexibilityMinutes: 5,
    maxDetourM: 2000,
    stops: [stop(37.4036, -6.0328, "Camas"), stop(37.409, -5.993, "Hospital Universitario Virgen Macarena")],
    riders: [{ user: "hugo", from: 0, to: 1 }],
  },
  {
    id: SEED_IDS.trips.carmenSport,
    driver: "carmen",
    vehicle: "carmen208",
    category: "sport",
    leg: "outbound",
    at: "19:45",
    seats: 3,
    flexibilityMinutes: 10,
    maxDetourM: 2000,
    stops: [stop(37.3719, -6.0472, "Tomares"), stop(37.3567, -5.9814, "Estadio Benito Villamarín")],
  },
  {
    id: SEED_IDS.trips.anaTomorrow,
    driver: "ana",
    vehicle: "anaArona",
    category: "university",
    leg: "outbound",
    at: "08:05",
    dayOffset: 1,
    seats: 3,
    flexibilityMinutes: 10,
    maxDetourM: 3000,
    stops: [MONTEQUINTO, DOS_HERMANAS, UNIVERSIDAD],
    segments: [
      { distanceM: 9000, durationS: 600 },
      { distanceM: 15000, durationS: 780 },
    ],
  },
  {
    id: SEED_IDS.trips.martaTomorrow,
    driver: "marta",
    vehicle: "martaYaris",
    category: "work",
    leg: "outbound",
    at: "08:30",
    dayOffset: 1,
    seats: 2,
    flexibilityMinutes: 5,
    maxDetourM: 1500,
    stops: [SAN_JUAN, TORRE_SEVILLA],
  },
  {
    id: SEED_IDS.trips.anaDraft,
    driver: "ana",
    vehicle: "anaLeon",
    category: "work",
    leg: "outbound",
    at: "08:00",
    dayOffset: 1,
    seats: 3,
    flexibilityMinutes: 10,
    maxDetourM: 2000,
    stops: [stop(37.2829, -5.9209, "Dos Hermanas"), stop(37.404, -6.012, "Parque Científico y Tecnológico Cartuja")],
    status: "draft",
  },
];

export function tripSpec(id: string): TripSpec {
  const spec = TRIP_SPECS.find((s) => s.id === id);
  if (!spec) throw new Error(`Viaje sembrado desconocido: ${id}`);
  return spec;
}

/** Ruta del proveedor simulado con distancias/duraciones fijadas por tramo cuando el diseño las fija. */
export function planFor(db: PreviewDb, stops: readonly SeedStop[], fixed: TripSpec["segments"], departureAtMs: number): ProvinceRouteSegmentPlan {
  const [origin, ...rest] = stops;
  const destination = rest[rest.length - 1];
  if (!origin || !destination) throw new Error("Un viaje necesita al menos origen y destino");
  const plan = computeProvinceCompliantSegmentPlan(db, {
    provinceId: SEED_IDS.province,
    origin,
    destination,
    intermediates: rest.slice(0, -1),
    departureTime: new Date(departureAtMs).toISOString(),
  });
  if (!fixed) return plan;
  const segments = plan.segments.map((segment, index) => ({
    ...segment,
    distanceMeters: fixed[index]?.distanceM ?? segment.distanceMeters,
    durationSeconds: fixed[index]?.durationS ?? segment.durationSeconds,
  }));
  return {
    route: {
      ...plan.route,
      distanceMeters: segments.reduce((sum, s) => sum + s.distanceMeters, 0),
      durationSeconds: segments.reduce((sum, s) => sum + s.durationSeconds, 0),
    },
    segments,
  };
}

function stopsOf(db: PreviewDb, tripId: string): Array<Readonly<TripStopRow>> {
  return db.tripStops.filter((s) => s.trip_id === tripId).sort((a, b) => a.seq - b.seq);
}

export interface ConfirmedRiderOptions {
  /** Instante en que se pagó la reserva (por defecto, 14 h antes de la salida). */
  bookedAt?: number;
  /** La persona ya subió al coche. */
  pickedUp?: boolean;
  status?: "confirmed" | "completed";
}

/** Inserta una reserva ya confirmada (solicitud confirmada + hold consumido + reserva) sin pasar por el flujo. */
export function seedConfirmedRider(db: PreviewDb, trip: Readonly<TripRow>, rider: SeedRider, options: ConfirmedRiderOptions = {}): { requestId: string; bookingId: string } {
  const passenger = SEED_USER_IDS[rider.user];
  const stops = stopsOf(db, trip.id);
  const segments = db.tripSegments.filter((s) => s.trip_id === trip.id && s.seq >= rider.from && s.seq < rider.to);
  const roadDistanceM = segments.reduce((sum, s) => sum + s.distance_m, 0);
  const pickupStop = stops.find((s) => s.seq === rider.from);
  const departure = trip.departure_at ?? db.nowMs();
  const bookedAt = options.bookedAt ?? departure - 14 * 3_600_000;
  const key = `${trip.id}:${rider.user}`;

  const request: RideRequestRow = {
    id: stableUuid(`request:${key}`),
    trip_id: trip.id,
    passenger_user_id: passenger,
    from_segment_seq: rider.from,
    to_segment_seq: rider.to,
    status: "confirmed",
    requested_at: bookedAt - 25 * 60_000,
    updated_at: bookedAt,
    pickup_lat: pickupStop?.lat ?? null,
    pickup_lng: pickupStop?.lng ?? null,
    pickup_label: pickupStop?.label ?? null,
    pickup_address: null,
    pickup_source: "driver_stop",
    pickup_offset_s: 0,
    pickup_walk_minutes: 0,
    pickup_detour_minutes: 0,
    dropoff_stop_seq: rider.to,
    road_distance_m: roadDistanceM,
    message: null,
    weekly_reservation_id: null,
  };
  db.rideRequests.insert(request);
  db.seatHolds.insert({
    id: stableUuid(`hold:${key}`),
    request_id: request.id,
    status: "consumed",
    expires_at: bookedAt + 15 * 60_000,
    released_at: null,
    consumed_at: bookedAt,
    created_at: bookedAt - 5 * 60_000,
  });
  const bookingId = stableUuid(`booking:${key}`);
  db.bookings.insert({
    id: bookingId,
    request_id: request.id,
    provider_payment_id: `pi_preview_${sha256Hex(key).slice(0, 16)}`,
    amount_cents: illustrativeFareCents(roadDistanceM),
    status: options.status ?? "confirmed",
    picked_up_at: options.pickedUp ? departure + 90_000 : null,
    created_at: bookedAt,
    updated_at: bookedAt,
  });
  return { requestId: request.id, bookingId };
}

/** Inserta un viaje de la tabla `TRIP_SPECS` con sus paradas, tramos y reservas confirmadas. */
export function seedTrip(db: PreviewDb, spec: TripSpec): Readonly<TripRow> {
  const departureAt = localAt(db, spec.at, spec.dayOffset ?? 0);
  const plan = planFor(db, spec.stops, spec.segments, departureAt);
  const [origin, ...rest] = spec.stops;
  const destination = rest[rest.length - 1];
  if (!origin || !destination) throw new Error("Un viaje necesita al menos origen y destino");
  const trip = insertTripWithPlan(
    db,
    {
      id: spec.id,
      driverUserId: SEED_USER_IDS[spec.driver],
      vehicleId: SEED_VEHICLE_IDS[spec.vehicle],
      provinceId: SEED_IDS.province,
      category: spec.category,
      leg: spec.leg,
      departureAtMs: departureAt,
      flexibilityMinutes: spec.flexibilityMinutes,
      maxDetourM: spec.maxDetourM,
      offeredSeats: spec.seats,
      origin,
      destination,
      intermediates: rest.slice(0, -1),
      status: spec.status ?? "published",
      stopLabels: spec.stops.map((s) => s.label),
    },
    plan
  );
  // Un viaje sembrado existe desde antes de «ahora»: la creación no puede quedar en el futuro respecto a la salida.
  const createdAt = Math.min(db.nowMs(), departureAt) - 2 * 86_400_000;
  db.trips.update(trip.id, { created_at: createdAt, updated_at: createdAt });
  for (const rider of spec.riders ?? []) seedConfirmedRider(db, trip, rider);
  return db.trips.get(trip.id) ?? trip;
}

export interface SeedTripsOptions {
  /** Conductores cuyos viajes no se siembran (escenarios «sin vehículo»). */
  skipDrivers?: readonly SeedUserKey[];
  /** Solo viajes publicados (sin borradores). */
  withDrafts?: boolean;
}

export function seedTrips(db: PreviewDb, options: SeedTripsOptions = {}): void {
  const skip = new Set(options.skipDrivers ?? []);
  for (const spec of TRIP_SPECS) {
    if (skip.has(spec.driver)) continue;
    if (spec.status === "draft" && options.withDrafts === false) continue;
    seedTrip(db, spec);
  }
}
