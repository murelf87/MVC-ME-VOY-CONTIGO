/**
 * Utilidades de las pruebas del módulo `comms` (no es un test: el patrón de integración solo recoge *.integration.test.ts).
 * Base de datos propia (`mvc_comms`, migraciones 001–019 + 060–079). Datos de ejemplo de Sevilla:
 * Ana conduce y Miguel y Laura viajan con ella.
 */
import crypto from "node:crypto";
import pg from "pg";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance, type RouteOptions } from "fastify";
import "../src/db/types.js";
import { createSession, type AuthPrincipal, type UserRole } from "../src/auth/session.js";
import type { AppConfig } from "../src/config.js";
import { DomainError } from "../src/errors.js";
import { registerCommsModule, type CommsModuleOverrides } from "../src/modules/comms/index.js";
import type { ObjectEraser } from "../src/modules/comms/object-eraser.js";
import type { ModuleDeps } from "../src/modules/register.js";
import type { PrivateObjectInfo, PrivateObjectStorage, UploadUrlResult } from "../src/storage/private-object-storage.js";

const { Pool } = pg;

export function createPool(): pg.Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required for integration tests");
  if (!/mvc_comms/.test(url)) throw new Error("Las pruebas de comms solo pueden usar la base de datos mvc_comms");
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

export const minutesAfter = (base: Date, minutes: number): Date => new Date(base.getTime() + minutes * 60_000);
export const hoursAfter = (base: Date, hours: number): Date => new Date(base.getTime() + hours * 3_600_000);
export const daysAfter = (base: Date, days: number): Date => new Date(base.getTime() + days * 86_400_000);

export type StopSpec = { label: string; lat: number; lng: number };

export const SEVILLA = {
  santaJusta: { label: "Estación Santa Justa", lat: 37.392, lng: -5.9754 },
  luisMontoto: { label: "C. Luis Montoto", lat: 37.3849, lng: -5.9738 },
  puertaJerez: { label: "Puerta de Jerez", lat: 37.3818, lng: -5.9959 },
  universidad: { label: "Universidad de Sevilla", lat: 37.3589, lng: -5.9865 },
  islaMagica: { label: "Aparcamiento P1 · Isla Mágica", lat: 37.4126, lng: -6.0033 },
  centro: { label: "Sevilla Centro", lat: 37.3891, lng: -5.9845 }
} satisfies Record<string, StopSpec>;

export const DEFAULT_STOPS: StopSpec[] = [SEVILLA.centro, SEVILLA.luisMontoto, SEVILLA.islaMagica];

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/* ───────────────────────────── Dobles de prueba ───────────────────────────── */

/** Almacenamiento privado en memoria. `objects` contiene lo «subido»; `put` simula el PUT del cliente. */
export class FakeStorage implements PrivateObjectStorage {
  readonly providerName = "fake";
  objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  uploadUrlCalls: Array<{ key: string; contentType: string }> = [];

  put(key: string, bytes: Uint8Array, contentType: string): void {
    this.objects.set(key, { bytes, contentType });
  }

  async createUploadUrl(input: { key: string; contentType: string; expiresInSeconds: number }): Promise<UploadUrlResult> {
    this.uploadUrlCalls.push({ key: input.key, contentType: input.contentType });
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
    return `https://download.invalid/${key}?sig=test`;
  }
}

/** Proveedor «disabled» como el real: cualquier uso responde 503 PRIVATE_STORAGE_NOT_CONFIGURED. */
export class DisabledStorage implements PrivateObjectStorage {
  readonly providerName = "disabled";
  private fail(): never {
    throw new DomainError("PRIVATE_STORAGE_NOT_CONFIGURED", "Private storage is not configured", 503);
  }
  async createUploadUrl(): Promise<UploadUrlResult> {
    return this.fail();
  }
  async headObject(): Promise<PrivateObjectInfo> {
    return this.fail();
  }
  async readObject(): Promise<Uint8Array> {
    return this.fail();
  }
  async createDownloadUrl(): Promise<string> {
    return this.fail();
  }
}

/** Borrado de objetos que actúa sobre un FakeStorage y deja constancia de las claves pedidas. */
export class FakeEraser implements ObjectEraser {
  deleted: string[] = [];
  failWith: Error | null = null;
  constructor(private readonly storage: FakeStorage | null = null) {}
  async deleteObjects(keys: string[]): Promise<void> {
    if (this.failWith) throw this.failWith;
    for (const key of keys) {
      this.deleted.push(key);
      this.storage?.objects.delete(key);
    }
  }
}

/** `fetch` falso para el PUT de la exportación: guarda el cuerpo en el FakeStorage como haría la URL firmada. */
export function fakeUploadFetch(storage: FakeStorage, options: { status?: number } = {}): typeof fetch {
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const key = url.replace("https://upload.invalid/", "");
    if ((options.status ?? 200) >= 400) return new Response(null, { status: options.status ?? 500 });
    const body = init?.body;
    const bytes = body instanceof Uint8Array ? body : new TextEncoder().encode(String(body ?? ""));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    storage.put(key, bytes, headers["content-type"] ?? "application/octet-stream");
    return new Response(null, { status: 200 });
  };
  return impl as typeof fetch;
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

export type UserSeed = {
  roles?: UserRole[];
  phone?: string | null;
  status?: "active" | "suspended" | "deleted";
  photoApproved?: boolean;
  noProfile?: boolean;
};

let phoneCounter = 0;

export async function seedUser(pool: pg.Pool, displayName: string, seed: UserSeed = {}): Promise<string> {
  phoneCounter += 1;
  const phone = seed.phone === undefined ? `+346000${String(phoneCounter).padStart(5, "0")}` : seed.phone;
  const id = (
    await pool.query<{ id: string }>(`insert into app_users(phone_e164, status) values($1,$2) returning id`, [phone, seed.status ?? "active"])
  ).rows[0]!.id;
  if (!seed.noProfile) {
    await pool.query(
      `insert into profiles(user_id, display_name, public_photo_key, public_photo_status, identity_status)
       values($1,$2,$3,$4,'verified')`,
      [id, displayName, seed.photoApproved ? `profiles/${id}.jpg` : null, seed.photoApproved ? "approved" : "pending"]
    );
  }
  for (const role of seed.roles ?? ["passenger"]) {
    await pool.query(`insert into user_roles(user_id, role) values($1,$2)`, [id, role]);
  }
  return id;
}

export async function seedVehicle(pool: pg.Pool, driverId: string, plate = "1234 LBC"): Promise<string> {
  return (
    await pool.query<{ id: string }>(
      `insert into vehicles(driver_user_id, make, model, plate, passenger_seats, review_status, documentation_status)
       values($1,'Seat','León',$2,3,'approved','approved') returning id`,
      [driverId, plate]
    )
  ).rows[0]!.id;
}

export type TripSeed = {
  status?: "draft" | "published" | "active" | "completed" | "cancelled";
  kind?: "single" | "recurring";
  category?: "work" | "university" | "fp_academies" | "hospital" | "sport" | "other";
  leg?: "outbound" | "return";
  departureAt?: Date;
  stops?: StopSpec[];
  capacity?: number;
};

export type SeededTrip = { tripId: string; stops: StopSpec[] };

export async function seedTrip(
  pool: pg.Pool, driverId: string, vehicleId: string, provinceId: string, seed: TripSeed = {}
): Promise<SeededTrip> {
  const stops = seed.stops ?? DEFAULT_STOPS;
  const roadFactor = 1.3;
  const speedMps = 8;
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
  const departureAt = seed.departureAt ?? new Date("2026-10-12T05:25:00.000Z");

  const tripId = (
    await pool.query<{ id: string }>(
      `insert into trips(
         driver_user_id, vehicle_id, province_id, category, kind, leg, status, departure_at, flexibility_minutes, max_detour_m,
         offered_seats, origin_geom, destination_geom, route_geom, route_distance_m, route_duration_s, route_provider,
         route_provider_ref, started_at, completed_at
       ) values(
         $1,$2,$3,$4,$5,$6,$7,$8,0,3000,$9,
         ST_SetSRID(ST_Point($10,$11),4326), ST_SetSRID(ST_Point($12,$13),4326), ST_GeomFromText($14,4326),
         $15,$16,'integration-test','comms-route',$17,$18
       ) returning id`,
      [
        driverId, vehicleId, provinceId, seed.category ?? "work", seed.kind ?? "single", seed.leg ?? "outbound", status,
        status === "draft" ? null : departureAt, seed.capacity ?? 3, first.lng, first.lat, last.lng, last.lat, lineWkt,
        totalDistance, totalDuration,
        status === "active" || status === "completed" ? departureAt : null,
        status === "completed" ? minutesAfter(departureAt, 55) : null
      ]
    )
  ).rows[0]!.id;

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
  return { tripId, stops };
}

export type BookingSeed = {
  status?: "confirmed" | "completed" | "cancelled" | "driver_cancelled" | "no_show";
  requestStatus?: "pending" | "accepted" | "payment_pending" | "confirmed" | "cancelled";
  createdAt?: Date;
  amountCents?: number;
};

export async function seedBooking(
  pool: pg.Pool, tripId: string, passengerId: string, seed: BookingSeed = {}
): Promise<{ requestId: string; bookingId: string | null }> {
  const requestId = (
    await pool.query<{ id: string }>(
      `insert into ride_requests(trip_id, passenger_user_id, from_segment_seq, to_segment_seq, status) values($1,$2,0,1,$3) returning id`,
      [tripId, passengerId, seed.requestStatus ?? "confirmed"]
    )
  ).rows[0]!.id;
  if (seed.requestStatus && seed.requestStatus !== "confirmed" && seed.status === undefined) return { requestId, bookingId: null };
  const bookingId = (
    await pool.query<{ id: string }>(
      `insert into bookings(request_id, provider_payment_id, amount_cents, status, created_at)
       values($1,$2,$3,$4,$5) returning id`,
      [requestId, `pay-${crypto.randomUUID()}`, seed.amountCents ?? 0, seed.status ?? "confirmed", seed.createdAt ?? new Date()]
    )
  ).rows[0]!.id;
  return { requestId, bookingId };
}

export type World = {
  provinceId: string;
  ana: string;
  miguel: string;
  laura: string;
  vehicleId: string;
};

/** Ana (conductora), Miguel y Laura (pasajeros), un vehículo y la provincia de Sevilla. */
export async function seedWorld(pool: pg.Pool): Promise<World> {
  const provinceId = await seedProvince(pool);
  const ana = await seedUser(pool, "Ana García López", { roles: ["driver", "passenger"], photoApproved: true, phone: "+34600111222" });
  const miguel = await seedUser(pool, "Miguel Torres", { photoApproved: true, phone: "+34600333444" });
  const laura = await seedUser(pool, "Laura Pérez", { photoApproved: true, phone: "+34600555666" });
  const vehicleId = await seedVehicle(pool, ana);
  return { provinceId, ana, miguel, laura, vehicleId };
}

export async function blockUser(pool: pg.Pool, blocker: string, blocked: string): Promise<void> {
  await pool.query(`insert into user_blocks(blocker_user_id, blocked_user_id) values($1,$2) on conflict do nothing`, [blocker, blocked]);
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

export type BuildCommsAppOptions = {
  privateStorage?: PrivateObjectStorage | null;
  modules?: CommsModuleOverrides;
  /** Máximo del límite de frecuencia GLOBAL (los límites por ruta siguen activos). */
  globalRateMax?: number;
  /** Recibe cada ruta registrada (con su schema real), para comprobar el contrato con la app. */
  onRoute?: (route: RouteOptions) => void;
};

/**
 * App mínima con el mismo andamiaje que `buildApp`: límite de frecuencia global, swagger y un manejador de errores RAÍZ que
 * convierte todo lo que no es DomainError en 500 (como el real). El módulo debe sobrevivir con su propio manejador encapsulado.
 * Sin temporizador interno de trabajos: los tests lanzan los trabajos a mano.
 */
export async function buildCommsApp(pool: pg.Pool, options: BuildCommsAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  // 127.0.0.1 (la IP por defecto de `inject`) no se limita: los límites por ruta se prueban con otra IP (ver Client.ip).
  // La lista de permitidos se evalúa con la IP de la petición (no con la clave del límite, que en este módulo es la sesión).
  await app.register(rateLimit, {
    max: options.globalRateMax ?? 100_000,
    timeWindow: "1 minute",
    allowList: request => request.ip === "127.0.0.1"
  });
  await app.register(swagger, {
    openapi: {
      info: { title: "comms test", version: "0" },
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } }
    }
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message }, requestId: request.id });
    }
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Internal server error" }, requestId: request.id });
  });
  if (options.onRoute) app.addHook("onRoute", options.onRoute);
  const deps: ModuleDeps = {
    pool,
    config: { privateUploadTtlSeconds: 600 } as AppConfig,
    privateStorage: options.privateStorage === undefined ? null : options.privateStorage,
    routeProvider: null,
    geocodingProvider: null
  };
  await registerCommsModule(app, deps, {
    ...options.modules,
    config: { jobsIntervalSeconds: 0, ...options.modules?.config }
  });
  await app.ready();
  return app;
}

/** Cliente mínimo sobre `app.inject` con el token de una persona. */
export class Client {
  constructor(
    private readonly app: FastifyInstance,
    private readonly token: string | null,
    /** IP de origen simulada. Cualquiera distinta de 127.0.0.1 queda sujeta a los límites de frecuencia. */
    readonly ip: string = "127.0.0.1"
  ) {}

  async request(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown, headers: Record<string, string> = {}) {
    const response = await this.app.inject({
      method,
      url,
      remoteAddress: this.ip,
      headers: { ...(this.token ? bearer(this.token) : {}), ...headers },
      ...(body === undefined ? {} : { payload: body as object })
    });
    let json: unknown = null;
    try {
      json = response.body ? JSON.parse(response.body) : null;
    } catch {
      json = null;
    }
    return { status: response.statusCode, body: json as any, headers: response.headers, raw: response.body };
  }
  get(url: string, headers?: Record<string, string>) {
    return this.request("GET", url, undefined, headers);
  }
  post(url: string, body?: unknown, headers?: Record<string, string>) {
    return this.request("POST", url, body ?? {}, headers);
  }
  patch(url: string, body: unknown) {
    return this.request("PATCH", url, body);
  }
  delete(url: string) {
    return this.request("DELETE", url);
  }
}

export async function clientFor(app: FastifyInstance, pool: pg.Pool, userId: string): Promise<Client> {
  return new Client(app, await sessionTokenFor(pool, userId));
}

/** Claves de un objeto, ordenadas (para comparar la forma exacta de las respuestas con el contrato). */
export const keysOf = (value: unknown): string[] => Object.keys(value as object).sort();

/* ───────────────────────────── Imágenes mínimas válidas (cabeceras reales) ───────────────────────────── */

export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1]);
export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
export const NOT_AN_IMAGE = new TextEncoder().encode("#!/bin/sh\nrm -rf /\n");
