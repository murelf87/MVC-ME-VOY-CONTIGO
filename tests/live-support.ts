/**
 * Utilidades de las pruebas del módulo `live` (no es un test: el patrón de integración solo recoge *.integration.test.ts).
 * Base de datos propia (`mvc_live`); datos de ejemplo de Sevilla (Ana conduce, Miguel y Laura viajan).
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
import type { RouteCandidate, RouteComputationRequest, RouteProvider } from "../src/maps/types.js";
import { registerLiveModule } from "../src/modules/live/index.js";
import type { ModuleDeps } from "../src/modules/register.js";
import type { PrivateObjectInfo, PrivateObjectStorage, UploadUrlResult } from "../src/storage/private-object-storage.js";

const { Pool } = pg;

export function createPool(): pg.Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required for integration tests");
  return new Pool({ connectionString: url });
}

/** Vacía todas las tablas de negocio (BD privada de este módulo); conserva migraciones y PostGIS. */
export async function truncateAll(pool: pg.Pool): Promise<void> {
  await pool.query(`
    do $$
    declare r record;
    begin
      for r in select tablename from pg_tables
                where schemaname='public' and tablename not in ('schema_migrations','spatial_ref_sys')
      loop
        execute format('truncate table %I restart identity cascade', r.tablename);
      end loop;
    end $$`);
}

export function principalOf(userId: string, roles: UserRole[] = ["passenger"]): AuthPrincipal {
  return { sessionId: crypto.randomUUID(), userId, roles, expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
}

/* ───────────────────────────── Tiempo y geografía ───────────────────────────── */

/** 07:17 en Madrid (CEST) del 5/10/2026 = 05:17 UTC: la hora de las láminas. */
export const T0 = new Date("2026-10-05T05:17:00.000Z");
export const minutesAfter = (base: Date, minutes: number): Date => new Date(base.getTime() + minutes * 60_000);
export const secondsAfter = (base: Date, seconds: number): Date => new Date(base.getTime() + seconds * 1000);

export type StopSpec = { label: string; lat: number; lng: number };

export const SEVILLA = {
  santaJusta: { label: "Estación Santa Justa", lat: 37.392, lng: -5.9754 },
  luisMontoto: { label: "C. Luis Montoto", lat: 37.3849, lng: -5.9738 },
  puertaJerez: { label: "Puerta de Jerez", lat: 37.3818, lng: -5.9959 },
  universidad: { label: "Universidad de Sevilla", lat: 37.3589, lng: -5.9865 }
} satisfies Record<string, StopSpec>;

export const DEFAULT_STOPS: StopSpec[] = [SEVILLA.santaJusta, SEVILLA.luisMontoto, SEVILLA.puertaJerez, SEVILLA.universidad];

export function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Punto entre dos paradas (q=0 primera, q=1 segunda), interpolación lineal en grados (igual que la ruta sembrada). */
export function between(a: StopSpec, b: StopSpec, q: number): { lat: number; lng: number } {
  return { lat: a.lat + (b.lat - a.lat) * q, lng: a.lng + (b.lng - a.lng) * q };
}

/* ───────────────────────────── Dobles de prueba ───────────────────────────── */

/** Proveedor de rutas determinista: línea recta × factor de carretera; la duración sale de la velocidad indicada. */
export class FakeRouteProvider implements RouteProvider {
  readonly name = "fake";
  calls: RouteComputationRequest[] = [];
  constructor(private readonly options: { roadFactor?: number; speedMps?: number; trafficFactor?: number; failWith?: Error } = {}) {}

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
    const seconds = (distance / (this.options.speedMps ?? 8)) * (this.options.trafficFactor ?? 1);
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

export class FakeStorage implements PrivateObjectStorage {
  readonly providerName = "fake";
  objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  async createUploadUrl(input: { key: string; contentType: string; expiresInSeconds: number }): Promise<UploadUrlResult> {
    return {
      url: `https://upload.invalid/${input.key}`,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
      headers: { "content-type": input.contentType }
    };
  }
  async headObject(key: string): Promise<PrivateObjectInfo> {
    const value = this.objects.get(key);
    if (!value) throw Object.assign(new Error("NotFound"), { name: "NotFound" });
    return { sizeBytes: value.bytes.byteLength, contentType: value.contentType };
  }
  async readObject(key: string, maxBytes: number): Promise<Uint8Array> {
    const value = this.objects.get(key);
    if (!value) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
    if (value.bytes.byteLength > maxBytes) throw new Error("too large");
    return value.bytes;
  }
  async createDownloadUrl(key: string): Promise<string> {
    return `https://download.invalid/${key}`;
  }
}

/* ───────────────────────────── Sembrado ───────────────────────────── */

export async function seedProvince(pool: pg.Pool): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `insert into provinces(code,name,source_name,geom)
     values('SE','Sevilla (caja de pruebas)','integration-test',
       ST_Multi(ST_GeomFromText('POLYGON((-6.6 36.9,-4.9 36.9,-4.9 38.1,-6.6 38.1,-6.6 36.9))',4326)))
     on conflict (code) do update set name=excluded.name
     returning id`
  );
  return row.rows[0]!.id;
}

export type UserSeed = {
  roles?: UserRole[];
  photoApproved?: boolean;
  ratingSum?: number;
  ratingCount?: number;
};

export async function seedUser(pool: pg.Pool, displayName: string, seed: UserSeed = {}): Promise<string> {
  const id = (await pool.query<{ id: string }>(`insert into app_users default values returning id`)).rows[0]!.id;
  await pool.query(
    `insert into profiles(user_id, display_name, public_photo_key, public_photo_status, identity_status, rating_sum, rating_count)
     values($1,$2,$3,$4,'verified',$5,$6)`,
    [
      id, displayName,
      seed.photoApproved ? `profiles/${id}.jpg` : null,
      seed.photoApproved ? "approved" : "pending",
      seed.ratingSum ?? 0, seed.ratingCount ?? 0
    ]
  );
  for (const role of seed.roles ?? ["passenger"]) {
    await pool.query(`insert into user_roles(user_id, role) values($1,$2)`, [id, role]);
  }
  return id;
}

let plateCounter = 0;

/** Matrícula única por llamada (la base de datos exige matrícula normalizada única): «1234 LBC», «1235 LBC», … */
export function nextPlate(): string {
  plateCounter += 1;
  return `${String(1233 + plateCounter).padStart(4, "0")} LBC`;
}

export async function seedVehicle(pool: pg.Pool, driverId: string, plate: string = nextPlate()): Promise<string> {
  const licensePlate = plate;
  return (await pool.query<{ id: string }>(
    `insert into vehicles(driver_user_id, make, model, plate, passenger_seats, review_status, documentation_status, color)
     values($1,'Seat','León',$2,3,'approved','approved','Blanco') returning id`,
    [driverId, licensePlate]
  )).rows[0]!.id;
}

export type TripSeed = {
  status?: "published" | "active" | "completed" | "cancelled";
  departureAt?: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
  stops?: StopSpec[];
  capacity?: number;
  flexibilityMinutes?: number;
  maxDetourM?: number;
  roadFactor?: number;
  speedMps?: number;
};

export type SeededTrip = {
  tripId: string;
  stops: StopSpec[];
  segments: Array<{ distanceM: number; durationS: number }>;
};

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
  const departureAt = seed.departureAt ?? new Date("2026-10-05T05:25:00.000Z");

  const tripId = (await pool.query<{ id: string }>(
    `insert into trips(
       driver_user_id, vehicle_id, province_id, category, kind, leg, status, departure_at, flexibility_minutes, max_detour_m,
       offered_seats, origin_geom, destination_geom, route_geom, route_distance_m, route_duration_s, route_provider,
       route_provider_ref, started_at, completed_at
     ) values(
       $1,$2,$3,'work','single','outbound',$4,$5,$6,$7,$8,
       ST_SetSRID(ST_Point($9,$10),4326), ST_SetSRID(ST_Point($11,$12),4326), ST_GeomFromText($13,4326),
       $14,$15,'integration-test','live-route',$16,$17
     ) returning id`,
    [
      driverId, vehicleId, provinceId, status, departureAt, seed.flexibilityMinutes ?? 0, seed.maxDetourM ?? 3000,
      seed.capacity ?? 3, first.lng, first.lat, last.lng, last.lat, lineWkt, totalDistance, totalDuration,
      seed.startedAt === undefined ? (status === "active" || status === "completed" ? departureAt : null) : seed.startedAt,
      seed.completedAt === undefined ? (status === "completed" ? minutesAfter(departureAt, 55) : null) : seed.completedAt
    ]
  )).rows[0]!.id;

  for (let i = 0; i < stops.length; i += 1) {
    const stop = stops[i]!;
    const kind = i === 0 ? "origin" : i === stops.length - 1 ? "destination" : "stop";
    await pool.query(
      `insert into trip_stops(trip_id, seq, kind, label, geom) values($1,$2,$3,$4,ST_SetSRID(ST_Point($5,$6),4326))`,
      [tripId, i, kind, stop.label, stop.lng, stop.lat]
    );
  }
  for (let i = 0; i < segments.length; i += 1) {
    await pool.query(
      `insert into trip_segments(trip_id, seq, from_stop_seq, to_stop_seq, distance_m, duration_s, capacity) values($1,$2,$2,$3,$4,$5,$6)`,
      [tripId, i, i + 1, segments[i]!.distanceM, segments[i]!.durationS, seed.capacity ?? 3]
    );
  }
  return { tripId, stops, segments };
}

export type BookingSeed = {
  status?: "confirmed" | "completed" | "cancelled" | "driver_cancelled" | "no_show";
  pickedUpAt?: Date | null;
  amountCents?: number;
  requestStatus?: "pending" | "accepted" | "payment_pending" | "confirmed";
  createdAt?: Date;
};

export async function seedBooking(
  pool: pg.Pool, tripId: string, passengerId: string, fromSeq: number, toSeq: number, seed: BookingSeed = {}
): Promise<{ requestId: string; bookingId: string | null }> {
  const requestId = (await pool.query<{ id: string }>(
    `insert into ride_requests(trip_id, passenger_user_id, from_segment_seq, to_segment_seq, status) values($1,$2,$3,$4,$5) returning id`,
    [tripId, passengerId, fromSeq, toSeq, seed.requestStatus ?? "confirmed"]
  )).rows[0]!.id;
  if (seed.requestStatus && seed.requestStatus !== "confirmed") return { requestId, bookingId: null };
  const bookingId = (await pool.query<{ id: string }>(
    `insert into bookings(request_id, provider_payment_id, amount_cents, status, picked_up_at, created_at)
     values($1,$2,$3,$4,$5,$6) returning id`,
    [
      requestId, `pay-${crypto.randomUUID()}`, seed.amountCents ?? 0, seed.status ?? "confirmed",
      seed.pickedUpAt ?? null, seed.createdAt ?? new Date()
    ]
  )).rows[0]!.id;
  return { requestId, bookingId };
}

/** Presupuesto aceptado de una solicitud con tarifa aprobada (aportación por km + comisión de pasajero). */
export async function seedQuote(
  pool: pg.Pool, requestId: string,
  tariff: { rateMicrosPerKm: number; passengerCommissionBps: number; capCents?: number | null; status?: "approved" | "retired" },
  roadDistanceM: number
): Promise<{ totalCents: number }> {
  const version = (await pool.query<{ v: number }>(`select coalesce(max(version),0)+1 as v from tariff_versions`)).rows[0]!.v;
  const tariffId = (await pool.query<{ id: string }>(
    `insert into tariff_versions(version, status, rate_micros_per_km, passenger_commission_bps, driver_commission_bps,
                                  shared_cost_cap_cents, effective_from)
     values($1,$2,$3,$4,0,$5,'2026-01-01T00:00:00Z') returning id`,
    [version, tariff.status ?? "approved", tariff.rateMicrosPerKm, tariff.passengerCommissionBps, tariff.capCents ?? null]
  )).rows[0]!.id;
  // Misma fórmula que trips/quote-service.ts: aportación (con tope) + comisión de pasajero.
  let contribution = Math.round((roadDistanceM * tariff.rateMicrosPerKm) / 10_000_000);
  if (tariff.capCents != null) contribution = Math.min(contribution, tariff.capCents);
  const fee = Math.round((contribution * tariff.passengerCommissionBps) / 10_000);
  const total = contribution + fee;
  await pool.query(
    `insert into quote_snapshots(request_id, tariff_version_id, road_distance_m, contribution_cents, passenger_commission_cents,
                                 passenger_total_cents, driver_net_cents)
     values($1,$2,$3,$4,$5,$6,$4)`,
    [requestId, tariffId, roadDistanceM, contribution, fee, total]
  );
  return { totalCents: total };
}

/** Fija la última posición del conductor (y su evento) con la hora de GPS indicada. */
export async function setPosition(
  pool: pg.Pool, tripId: string, driverId: string, where: { lat: number; lng: number }, recordedAt: Date,
  extras: { receivedAt?: Date; accuracyM?: number; speedMps?: number; headingDegrees?: number } = {}
): Promise<void> {
  const event = await pool.query<{ id: string }>(
    `insert into trip_location_events(event_id, trip_id, driver_user_id, recorded_at, received_at, geom, accuracy_m, speed_mps, heading_degrees)
     values(gen_random_uuid(),$1,$2,$3,$4,ST_SetSRID(ST_Point($6,$5),4326),$7,$8,$9) returning id`,
    [
      tripId, driverId, recordedAt, extras.receivedAt ?? recordedAt, where.lat, where.lng,
      extras.accuracyM ?? 7, extras.speedMps ?? 9.4, extras.headingDegrees ?? 128.5
    ]
  );
  await pool.query(
    `insert into trip_live_state(trip_id, event_row_id, driver_user_id, recorded_at, received_at, geom, accuracy_m, speed_mps, heading_degrees)
     values($1,$2,$3,$4,$5,ST_SetSRID(ST_Point($7,$6),4326),$8,$9,$10)
     on conflict (trip_id) do update
       set event_row_id=excluded.event_row_id, recorded_at=excluded.recorded_at, received_at=excluded.received_at,
           geom=excluded.geom, accuracy_m=excluded.accuracy_m, speed_mps=excluded.speed_mps,
           heading_degrees=excluded.heading_degrees, updated_at=now()`,
    [
      tripId, event.rows[0]!.id, driverId, recordedAt, extras.receivedAt ?? recordedAt, where.lat, where.lng,
      extras.accuracyM ?? 7, extras.speedMps ?? 9.4, extras.headingDegrees ?? 128.5
    ]
  );
}

/** Ajuste «Compartir ubicación en viaje» de `comms` (`user_settings`, migración 063). Sin fila = true. */
export async function setShareLiveLocation(pool: pg.Pool, userId: string, value: boolean): Promise<void> {
  await pool.query(
    `insert into user_settings(user_id, share_live_location_in_trip) values($1,$2)
     on conflict (user_id) do update set share_live_location_in_trip=excluded.share_live_location_in_trip, updated_at=now()`,
    [userId, value]
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

/** Ana (conductora, 4,8 · 32 valoraciones), Miguel y Laura (pasajeros), un vehículo y la provincia. */
export async function seedWorld(pool: pg.Pool): Promise<World> {
  const provinceId = await seedProvince(pool);
  const ana = await seedUser(pool, "Ana García López", { roles: ["driver", "passenger"], photoApproved: true, ratingSum: 154, ratingCount: 32 });
  const miguel = await seedUser(pool, "Miguel Torres", { photoApproved: true, ratingSum: 58, ratingCount: 12 });
  const laura = await seedUser(pool, "Laura Pérez", { photoApproved: true, ratingSum: 20, ratingCount: 4 });
  const plate = nextPlate();
  const vehicleId = await seedVehicle(pool, ana, plate);
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

/**
 * App mínima con el mismo andamiaje que `buildApp`: límite de tasa global, swagger y un manejador de errores RAÍZ que
 * convierte todo lo que no es DomainError en 500 (como el real). El módulo debe sobrevivir con su propio manejador encapsulado.
 */
export async function buildLiveApp(
  pool: pg.Pool,
  overrides: Partial<ModuleDeps> = {}
): Promise<FastifyInstance> {
  // LIVE_TEST_LOG=1 muestra los errores internos (útil al depurar una respuesta 500).
  const app = Fastify({ logger: process.env.LIVE_TEST_LOG === "1" ? { level: "error" } : false });
  await app.register(rateLimit, { max: 10_000, timeWindow: "1 minute" });
  await app.register(swagger, {
    openapi: {
      info: { title: "live test", version: "0" },
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } }
    }
  });
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
    routeProvider: null,
    geocodingProvider: null,
    ...overrides
  };
  await registerLiveModule(app, deps);
  await app.ready();
  return app;
}
