/**
 * Utilidades de las pruebas del módulo `trips` (no es un test: el patrón de integración solo recoge *.integration.test.ts).
 * Base de datos propia (`mvc_trips`, migraciones 001–029); datos de ejemplo de Sevilla (Ana conduce; Miguel y Laura viajan).
 *
 * Las pruebas construyen un servidor mínimo con el mismo andamiaje que `buildApp` (límite de tasa global, swagger y un manejador
 * de errores RAÍZ que convierte todo lo que no es DomainError en 500) y registran SOLO el módulo `trips`.
 */
import crypto from "node:crypto";
import pg from "pg";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance } from "fastify";
import "../src/db/types.js";
import { createSession, type AuthPrincipal, type UserRole } from "../src/auth/session.js";
import type { AppConfig } from "../src/config.js";
import { DomainError } from "../src/errors.js";
import type {
  GeocodeResult, GeocodingProvider, LatLng, RouteCandidate, RouteComputationRequest, RouteProvider
} from "../src/maps/types.js";
import { registerTripsModule } from "../src/modules/trips/index.js";
import type { ModuleDeps } from "../src/modules/register.js";

const { Pool } = pg;

// Se fijan ANTES de construir el servidor: los límites de tasa se leen al registrar las rutas.
process.env.TRIPS_RATE_SEARCH_PER_MINUTE ??= "100000";
process.env.TRIPS_RATE_MAP_PER_MINUTE ??= "100000";
process.env.TRIPS_RATE_PLAN_PER_MINUTE ??= "100000";
process.env.TRIPS_SWEEP_INTERVAL_SECONDS ??= "0";
process.env.PUBLIC_MEDIA_BASE_URL ??= "https://media.mvc.test";

export function createPool(): pg.Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required for integration tests");
  if (!/\/mvc_(trips|trips_full)(\?|$)/.test(url)) {
    throw new Error("Las pruebas de trips solo pueden usar las bases privadas mvc_trips / mvc_trips_full");
  }
  return new Pool({ connectionString: url });
}

/** Vacía todas las tablas de negocio (BD privada de este módulo) en UNA sentencia; conserva migraciones y PostGIS. */
export async function truncateAll(pool: pg.Pool): Promise<void> {
  const tables = await pool.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname='public' and tablename not in ('schema_migrations','spatial_ref_sys')`
  );
  if (tables.rows.length === 0) return;
  await pool.query(`truncate table ${tables.rows.map(t => `"${t.tablename}"`).join(", ")} restart identity cascade`);
}

export function principalOf(userId: string, roles: UserRole[] = ["passenger"]): AuthPrincipal {
  return { sessionId: crypto.randomUUID(), userId, roles, expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
}

/* ───────────────────────────── Tiempo (Europe/Madrid) ───────────────────────────── */

export const minutesAfter = (base: Date, minutes: number): Date => new Date(base.getTime() + minutes * 60_000);
export const secondsAfter = (base: Date, seconds: number): Date => new Date(base.getTime() + seconds * 1000);
export const hoursAfter = (base: Date, hours: number): Date => new Date(base.getTime() + hours * 3_600_000);

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** Fecha, hora y día de la semana de un instante en Europe/Madrid. */
export function madrid(at: Date): { date: string; time: string; weekday: (typeof WEEKDAYS)[number] } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23", weekday: "short"
  }).formatToParts(at);
  const get = (type: string): string => parts.find(p => p.type === type)?.value ?? "";
  const weekday = get("weekday").toLowerCase().slice(0, 3) as (typeof WEEKDAYS)[number];
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}`, weekday };
}

/** Suma `days` a una fecha `YYYY-MM-DD`. */
export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Día de la semana (mon..sun) de una fecha `YYYY-MM-DD`. */
export function weekdayOfDate(date: string): (typeof WEEKDAYS)[number] {
  return WEEKDAYS[new Date(`${date}T12:00:00.000Z`).getUTCDay()]!;
}

/** Lunes de la semana que contiene `date`. */
export function mondayOfDate(date: string): string {
  const index = (new Date(`${date}T12:00:00.000Z`).getUTCDay() + 6) % 7;
  return addDaysIso(date, -index);
}

/* ───────────────────────────── Geografía ───────────────────────────── */

export type StopSpec = { label: string; lat: number; lng: number; optional?: boolean; detourMinutes?: number };

export const SEVILLA = {
  palomares: { label: "Palomares del Río", lat: 37.3133, lng: -6.0504 },
  mairena: { label: "Mairena del Aljarafe", lat: 37.3446, lng: -6.0614 },
  trabajo: { label: "Sevilla (Trabajo)", lat: 37.3891, lng: -5.9845 },
  montequinto: { label: "Montequinto", lat: 37.3317, lng: -5.9365 },
  dosHermanas: { label: "Dos Hermanas", lat: 37.2829, lng: -5.9208 },
  universidad: { label: "Universidad de Sevilla", lat: 37.3589, lng: -5.9865 },
  losBermejales: { label: "Los Bermejales", lat: 37.3398, lng: -5.9811 },
  /** Fuera de la provincia de pruebas (la caja llega a -6,6° de longitud). */
  huelva: { label: "Huelva (sugerida)", lat: 37.2614, lng: -6.9447 },
  aznalcollar: { label: "Aznalcóllar", lat: 37.5336, lng: -6.2744 }
} satisfies Record<string, StopSpec>;

export function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number): number => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/* ───────────────────────────── Dobles de prueba ───────────────────────────── */

/** Proveedor de rutas determinista: línea recta × factor de carretera; la duración sale de la velocidad indicada. */
export class FakeRouteProvider implements RouteProvider {
  readonly name = "fake";
  calls: RouteComputationRequest[] = [];
  constructor(private readonly options: { roadFactor?: number; speedMps?: number; failWith?: Error } = {}) {}

  async computeRoutes(request: RouteComputationRequest): Promise<RouteCandidate[]> {
    this.calls.push(request);
    if (this.options.failWith) throw this.options.failWith;
    const points = [request.origin, ...(request.intermediates ?? []), request.destination];
    let distance = 0;
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i]!;
      const b = points[i + 1]!;
      distance += haversine({ lat: a.latitude, lng: a.longitude }, { lat: b.latitude, lng: b.longitude });
    }
    distance *= this.options.roadFactor ?? 1.3;
    const seconds = distance / (this.options.speedMps ?? 8);
    return [{
      provider: this.name,
      providerRef: `fake-${this.calls.length}`,
      distanceMeters: Math.max(1, Math.round(distance)),
      durationSeconds: Math.max(1, Math.round(seconds)),
      geometry: { type: "LineString", coordinates: points.map(p => [p.longitude, p.latitude] as [number, number]) },
      labels: []
    }];
  }
}

/** Geocodificador de pruebas: «Huelva» devuelve Huelva (fuera de la provincia) y Aznalcóllar (dentro). */
export class FakeGeocoder implements GeocodingProvider {
  readonly name = "fake";
  queries: string[] = [];
  async geocodeAddress(address: string): Promise<GeocodeResult[]> {
    this.queries.push(address);
    return [
      { provider: "fake", placeId: "p-huelva", formattedAddress: "Huelva, España", location: { latitude: 37.2614, longitude: -6.9447 }, types: ["locality"] },
      { provider: "fake", placeId: "p-aznal", formattedAddress: "Aznalcóllar, Sevilla, España", location: { latitude: 37.5336, longitude: -6.2744 }, types: ["locality"] }
    ];
  }
  async reverseGeocode(location: LatLng): Promise<GeocodeResult[]> {
    return [{
      provider: "fake", placeId: "rev", formattedAddress: "Av. Manuel Siurot, Sevilla", location, types: ["street_address"]
    }];
  }
}

/* ───────────────────────────── Sembrado ───────────────────────────── */

export async function seedProvince(pool: pg.Pool): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `insert into provinces(code,name,source_name,geom)
     values('SE','Sevilla','integration-test',
       ST_Multi(ST_GeomFromText('POLYGON((-6.6 36.9,-4.9 36.9,-4.9 38.1,-6.6 38.1,-6.6 36.9))',4326)))
     on conflict (code) do update set name=excluded.name
     returning id`
  );
  return row.rows[0]!.id;
}

/** Segunda provincia contigua (Córdoba, de pruebas) para comprobar que no se mezclan. */
export async function seedOtherProvince(pool: pg.Pool): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `insert into provinces(code,name,source_name,geom)
     values('CO','Córdoba','integration-test',
       ST_Multi(ST_GeomFromText('POLYGON((-4.9 36.9,-3.5 36.9,-3.5 38.1,-4.9 38.1,-4.9 36.9))',4326)))
     on conflict (code) do update set name=excluded.name
     returning id`
  );
  return row.rows[0]!.id;
}

let ratingColumns: boolean | null = null;
async function hasRatingColumns(pool: pg.Pool): Promise<boolean> {
  if (ratingColumns === null) {
    const r = await pool.query<{ n: number }>(
      `select count(*)::int as n from information_schema.columns
        where table_schema='public' and table_name='profiles' and column_name in ('rating_sum','rating_count')`
    );
    ratingColumns = (r.rows[0]?.n ?? 0) === 2;
  }
  return ratingColumns;
}

export type UserSeed = {
  roles?: UserRole[];
  photoApproved?: boolean;
  identity?: "unverified" | "pending" | "verified" | "rejected";
  /** Solo si existen las columnas (migración 030 de `live`). */
  ratingSum?: number;
  ratingCount?: number;
};

export async function seedUser(pool: pg.Pool, displayName: string, seed: UserSeed = {}): Promise<string> {
  const id = (await pool.query<{ id: string }>(`insert into app_users default values returning id`)).rows[0]!.id;
  await pool.query(
    `insert into profiles(user_id, display_name, public_photo_key, public_photo_status, identity_status)
     values($1,$2,$3,$4,$5)`,
    [id, displayName, seed.photoApproved ? `profiles/${id}.jpg` : null, seed.photoApproved ? "approved" : "pending", seed.identity ?? "verified"]
  );
  if (seed.ratingCount !== undefined && (await hasRatingColumns(pool))) {
    await pool.query(`update profiles set rating_sum=$2, rating_count=$3 where user_id=$1`, [id, seed.ratingSum ?? 0, seed.ratingCount]);
  }
  for (const role of seed.roles ?? ["passenger"]) {
    await pool.query(`insert into user_roles(user_id, role) values($1,$2)`, [id, role]);
  }
  return id;
}

let plateCounter = 0;
/** Matrícula única por llamada: «1234 LBC», «1235 LBC», … */
export function nextPlate(): string {
  plateCounter += 1;
  return `${String(1233 + plateCounter).padStart(4, "0")} LBC`;
}

export type VehicleSeed = {
  plate?: string;
  make?: string;
  model?: string;
  color?: string | null;
  seats?: number;
  review?: "pending" | "approved" | "rejected";
  documentation?: "pending" | "approved" | "rejected";
  photo?: "pending" | "approved" | "rejected";
  insurance?: "pending" | "approved" | "rejected";
  /** `YYYY-MM-DD`; por defecto un año después de hoy. */
  insuranceExpiresOn?: string | null;
};

/** Vehículo con TODOS los requisitos de publicación cumplidos (salvo lo que se indique). */
export async function seedVehicle(pool: pg.Pool, driverId: string, seed: VehicleSeed = {}): Promise<string> {
  const nextYear = `${new Date().getUTCFullYear() + 1}-06-30`;
  return (await pool.query<{ id: string }>(
    `insert into vehicles(driver_user_id, make, model, plate, color, passenger_seats, review_status, documentation_status,
                          vehicle_photo_status, insurance_status, insurance_expires_on)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [
      driverId, seed.make ?? "Seat", seed.model ?? "Arona", seed.plate ?? nextPlate(),
      seed.color === undefined ? "Gris" : seed.color, seed.seats ?? 3,
      seed.review ?? "approved", seed.documentation ?? "approved", seed.photo ?? "approved", seed.insurance ?? "approved",
      seed.insuranceExpiresOn === undefined ? nextYear : seed.insuranceExpiresOn
    ]
  )).rows[0]!.id;
}

export type TripSeed = {
  status?: "draft" | "published" | "active" | "completed" | "cancelled";
  departureAt?: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
  stops?: StopSpec[];
  capacity?: number;
  category?: "work" | "university" | "fp_academies" | "hospital" | "sport" | "other";
  leg?: "outbound" | "return";
  kind?: "single" | "recurring";
  seriesId?: string | null;
  flexibilityMinutes?: number;
  maxDetourMinutes?: number;
  pickupOnRoute?: boolean;
  roadFactor?: number;
  speedMps?: number;
};

export type SeededTrip = {
  tripId: string;
  stops: StopSpec[];
  segments: Array<{ distanceM: number; durationS: number }>;
  departureAt: Date;
  /** Instante de llegada a cada parada (salida + duración acumulada). */
  arrivals: Date[];
};

export const DEFAULT_STOPS: StopSpec[] = [SEVILLA.palomares, SEVILLA.mairena, SEVILLA.trabajo];

export async function seedTrip(
  pool: pg.Pool, driverId: string, vehicleId: string, provinceId: string, seed: TripSeed = {}
): Promise<SeededTrip> {
  const stops = seed.stops ?? DEFAULT_STOPS;
  const roadFactor = seed.roadFactor ?? 1.3;
  const speedMps = seed.speedMps ?? 8;
  const segments = stops.slice(0, -1).map((stop, index) => {
    const distanceM = Math.max(1, Math.round(haversine(stop, stops[index + 1]!) * roadFactor));
    return { distanceM, durationS: Math.max(1, Math.round(distanceM / speedMps)) };
  });
  const totalDistance = segments.reduce((sum, s) => sum + s.distanceM, 0);
  const totalDuration = segments.reduce((sum, s) => sum + s.durationS, 0);
  const lineWkt = `LINESTRING(${stops.map(s => `${s.lng} ${s.lat}`).join(",")})`;
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  const status = seed.status ?? "published";
  const departureAt = seed.departureAt ?? hoursAfter(new Date(), 3);

  const tripId = (await pool.query<{ id: string }>(
    `insert into trips(
       driver_user_id, vehicle_id, province_id, category, kind, leg, status, departure_at, flexibility_minutes, max_detour_m,
       offered_seats, origin_geom, destination_geom, route_geom, route_distance_m, route_duration_s, route_provider,
       route_provider_ref, started_at, completed_at, series_id, max_detour_minutes, pickup_on_route
     ) values(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,3000,$10,
       ST_SetSRID(ST_Point($11,$12),4326), ST_SetSRID(ST_Point($13,$14),4326), ST_GeomFromText($15,4326),
       $16,$17,'integration-test','test-route',$18,$19,$20,$21,$22
     ) returning id`,
    [
      driverId, vehicleId, provinceId, seed.category ?? "work", seed.kind ?? "single", seed.leg ?? "outbound", status, departureAt,
      seed.flexibilityMinutes ?? 0, seed.capacity ?? 3, first.lng, first.lat, last.lng, last.lat, lineWkt, totalDistance, totalDuration,
      seed.startedAt === undefined ? (status === "active" || status === "completed" ? departureAt : null) : seed.startedAt,
      seed.completedAt === undefined ? (status === "completed" ? minutesAfter(departureAt, 55) : null) : seed.completedAt,
      seed.seriesId ?? null, seed.maxDetourMinutes ?? 5, seed.pickupOnRoute ?? false
    ]
  )).rows[0]!.id;

  for (let i = 0; i < stops.length; i += 1) {
    const stop = stops[i]!;
    const kind = i === 0 ? "origin" : i === stops.length - 1 ? "destination" : "stop";
    await pool.query(
      `insert into trip_stops(trip_id, seq, kind, label, geom, optional, detour_minutes)
       values($1,$2,$3,$4,ST_SetSRID(ST_Point($5,$6),4326),$7,$8)`,
      [tripId, i, kind, stop.label, stop.lng, stop.lat, stop.optional ?? false, stop.detourMinutes ?? null]
    );
  }
  for (let i = 0; i < segments.length; i += 1) {
    await pool.query(
      `insert into trip_segments(trip_id, seq, from_stop_seq, to_stop_seq, distance_m, duration_s, capacity) values($1,$2,$2,$3,$4,$5,$6)`,
      [tripId, i, i + 1, segments[i]!.distanceM, segments[i]!.durationS, seed.capacity ?? 3]
    );
  }
  const arrivals: Date[] = [departureAt];
  for (const segment of segments) arrivals.push(secondsAfter(arrivals[arrivals.length - 1]!, segment.durationS));
  return { tripId, stops, segments, departureAt, arrivals };
}

export type RequestSeed = {
  status?: "pending" | "payment_pending" | "confirmed" | "rejected" | "expired" | "cancelled";
  /** `ride_requests.requested_at`. */
  requestedAt?: Date;
  holdExpiresAt?: Date;
  bookingStatus?: "confirmed" | "completed" | "cancelled" | "driver_cancelled" | "no_show";
  pickedUpAt?: Date | null;
  message?: string | null;
  pickupDetourMinutes?: number | null;
};

/** Crea una solicitud (y, según su estado, su hold o su reserva) directamente en la base de datos. */
export async function seedRequest(
  pool: pg.Pool, tripId: string, passengerId: string, fromSeq: number, toSeq: number, seed: RequestSeed = {}
): Promise<{ requestId: string; bookingId: string | null; holdId: string | null }> {
  const status = seed.status ?? "pending";
  const requestId = (await pool.query<{ id: string }>(
    `insert into ride_requests(trip_id, passenger_user_id, from_segment_seq, to_segment_seq, status, requested_at, message, pickup_detour_minutes)
     values($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [tripId, passengerId, fromSeq, toSeq, status, seed.requestedAt ?? new Date(), seed.message ?? null, seed.pickupDetourMinutes ?? null]
  )).rows[0]!.id;
  let holdId: string | null = null;
  if (status === "payment_pending") {
    holdId = (await pool.query<{ id: string }>(
      `insert into seat_holds(request_id, status, expires_at) values($1,'active',$2) returning id`,
      [requestId, seed.holdExpiresAt ?? minutesAfter(new Date(), 15)]
    )).rows[0]!.id;
  }
  let bookingId: string | null = null;
  if (status === "confirmed") {
    bookingId = (await pool.query<{ id: string }>(
      `insert into bookings(request_id, provider_payment_id, amount_cents, status, picked_up_at)
       values($1,$2,0,$3,$4) returning id`,
      [requestId, `pay-${crypto.randomUUID()}`, seed.bookingStatus ?? "confirmed", seed.pickedUpAt ?? null]
    )).rows[0]!.id;
    await pool.query(
      `insert into seat_holds(request_id, status, expires_at, consumed_at) values($1,'consumed',now(),now())`,
      [requestId]
    );
  }
  return { requestId, bookingId, holdId };
}

/**
 * Tarifa APROBADA, sembrada únicamente dentro de la base de pruebas. Valores ficticios de prueba (no son la tarifa del producto:
 * el módulo `trips` nunca aprueba ni activa una tarifa).
 */
export async function seedApprovedTariff(
  pool: pg.Pool,
  tariff: { rateMicrosPerKm: number; passengerCommissionBps?: number | null; capCents?: number | null; status?: "approved" | "draft" | "retired" }
): Promise<string> {
  const version = (await pool.query<{ v: number }>(`select coalesce(max(version),0)+1 as v from tariff_versions`)).rows[0]!.v;
  return (await pool.query<{ id: string }>(
    `insert into tariff_versions(version, status, rate_micros_per_km, passenger_commission_bps, driver_commission_bps,
                                  shared_cost_cap_cents, effective_from)
     values($1,$2,$3,$4,0,$5,'2020-01-01T00:00:00Z') returning id`,
    [version, tariff.status ?? "approved", tariff.rateMicrosPerKm, tariff.passengerCommissionBps ?? null, tariff.capCents ?? null]
  )).rows[0]!.id;
}

/** Fija la última posición del conductor (y su evento) con la hora de GPS indicada. */
export async function setPosition(
  pool: pg.Pool, tripId: string, driverId: string, where: { lat: number; lng: number }, recordedAt: Date
): Promise<void> {
  const event = await pool.query<{ id: string }>(
    `insert into trip_location_events(event_id, trip_id, driver_user_id, recorded_at, received_at, geom, accuracy_m, speed_mps, heading_degrees)
     values(gen_random_uuid(),$1,$2,$3,$3,ST_SetSRID(ST_Point($5,$4),4326),7,9.4,128.5) returning id`,
    [tripId, driverId, recordedAt, where.lat, where.lng]
  );
  await pool.query(
    `insert into trip_live_state(trip_id, event_row_id, driver_user_id, recorded_at, received_at, geom, accuracy_m, speed_mps, heading_degrees)
     values($1,$2,$3,$4,$4,ST_SetSRID(ST_Point($6,$5),4326),7,9.4,128.5)
     on conflict (trip_id) do update
       set event_row_id=excluded.event_row_id, recorded_at=excluded.recorded_at, received_at=excluded.received_at,
           geom=excluded.geom, updated_at=now()`,
    [tripId, event.rows[0]!.id, driverId, recordedAt, where.lat, where.lng]
  );
}

export type World = {
  provinceId: string;
  ana: string;
  miguel: string;
  laura: string;
  vehicleId: string;
  plate: string;
};

/** Ana (conductora, vehículo gris completo), Miguel y Laura (pasajeros), la provincia de Sevilla. */
export async function seedWorld(pool: pg.Pool): Promise<World> {
  const provinceId = await seedProvince(pool);
  const ana = await seedUser(pool, "Ana García López", { roles: ["driver", "passenger"], photoApproved: true, ratingSum: 154, ratingCount: 32 });
  const miguel = await seedUser(pool, "Miguel Torres", { photoApproved: true, ratingSum: 58, ratingCount: 12 });
  const laura = await seedUser(pool, "Laura Pérez", { photoApproved: true, ratingSum: 20, ratingCount: 4 });
  const plate = nextPlate();
  const vehicleId = await seedVehicle(pool, ana, { plate });
  return { provinceId, ana, miguel, laura, vehicleId, plate };
}

/* ───────────────────────────── Servidor HTTP de pruebas ───────────────────────────── */

export async function sessionTokenFor(pool: pg.Pool, userId: string): Promise<string> {
  const client = await pool.connect();
  try {
    return (await createSession(client, userId, 3600)).token;
  } finally {
    client.release();
  }
}

export const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

export async function buildTripsApp(pool: pg.Pool, overrides: Partial<ModuleDeps> = {}): Promise<FastifyInstance> {
  // TRIPS_TEST_LOG=1 muestra los errores 500 del servidor al depurar una prueba.
  const app = Fastify({ logger: process.env.TRIPS_TEST_LOG ? { level: "error" } : false });
  await app.register(rateLimit, { max: 10_000, timeWindow: "1 minute" });
  await app.register(swagger, {
    openapi: {
      info: { title: "trips test", version: "0" },
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } }
    }
  });
  // Igual que el manejador global de app.ts: todo lo que no es DomainError → 500. El módulo debe sobrevivir con el suyo.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message }, requestId: request.id });
    }
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Internal server error" }, requestId: request.id });
  });
  const deps: ModuleDeps = {
    pool,
    config: { privateUploadTtlSeconds: 600 } as AppConfig,
    privateStorage: null,
    routeProvider: new FakeRouteProvider(),
    geocodingProvider: new FakeGeocoder(),
    ...overrides
  };
  await registerTripsModule(app, deps);
  await app.ready();
  return app;
}

export type ApiResult<T = any> = { status: number; body: T; headers: Record<string, unknown> };

/** Cliente HTTP mínimo sobre `app.inject` con la sesión indicada (o invitado si no hay token). */
export function api(app: FastifyInstance, token?: string) {
  const call = async <T = any>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown, headers: Record<string, string> = {}
  ): Promise<ApiResult<T>> => {
    const response = await app.inject({
      method, url, headers: { ...(token ? bearer(token) : {}), ...headers },
      ...(body !== undefined ? { payload: body as object } : {})
    });
    let parsed: unknown = null;
    if (response.body) {
      try { parsed = JSON.parse(response.body); } catch { parsed = response.body; }
    }
    return { status: response.statusCode, body: parsed as T, headers: response.headers as Record<string, unknown> };
  };
  return {
    get: <T = any>(url: string, headers?: Record<string, string>) => call<T>("GET", url, undefined, headers),
    post: <T = any>(url: string, body?: unknown, headers?: Record<string, string>) => call<T>("POST", url, body ?? {}, headers),
    put: <T = any>(url: string, body?: unknown) => call<T>("PUT", url, body ?? {}),
    patch: <T = any>(url: string, body?: unknown) => call<T>("PATCH", url, body ?? {}),
    del: <T = any>(url: string) => call<T>("DELETE", url)
  };
}

export const idemKey = (): string => crypto.randomUUID();

/** Códigos de error de un resultado `{error:{code}}` (para `assert.equal(codeOf(r), "…")`). */
export const codeOf = (result: ApiResult): string | undefined => (result.body as { error?: { code?: string } } | null)?.error?.code;

/** Cuenta filas con una consulta de apoyo. */
export async function count(pool: pg.Pool, sql: string, params: unknown[] = []): Promise<number> {
  return (await pool.query<{ n: number }>(`select count(*)::int as n from (${sql}) q`, params)).rows[0]!.n;
}
