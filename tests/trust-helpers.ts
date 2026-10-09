/**
 * Utilidades de las pruebas del módulo `trust` (no es un test: el patrón de integración solo recoge *.integration.test.ts).
 * Base de datos propia (`mvc_trust`: migraciones 001–012 + 080–099; `mvc_trust_full` añade el resto de módulos).
 * Datos de ejemplo de Sevilla. Ninguna prueba toca otras bases de datos.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import "../src/db/types.js";
import { createSession, type UserRole } from "../src/auth/session.js";
import type { AppConfig } from "../src/config.js";
import { DomainError } from "../src/errors.js";
import { registerTrustModule } from "../src/modules/trust/index.js";
import { type TrustConfig, loadTrustConfig } from "../src/modules/trust/config.js";
import { registerProfileVehicleRoutes } from "../src/routes/profile-vehicle-routes.js";
import type { PrivateObjectInfo, PrivateObjectStorage, UploadUrlResult } from "../src/storage/private-object-storage.js";

const { Pool } = pg;

export function createPool(): pg.Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required for integration tests");
  if (!/\/mvc_trust(_full)?(\?|$)/.test(url)) throw new Error("Las pruebas de trust solo pueden usar las bases de datos mvc_trust o mvc_trust_full");
  return new Pool({ connectionString: url });
}

/** ¿Existe la tabla (módulos hermanos aplicados en esta base)? */
export async function hasTable(pool: pg.Pool, name: string): Promise<boolean> {
  const r = await pool.query<{ ok: boolean }>(`select to_regclass($1) is not null as ok`, [`public.${name}`]);
  return Boolean(r.rows[0]?.ok);
}

const MIGRATIONS_DIR = path.resolve("migrations");

/** Filas semilla de las migraciones 080 y 082 (se pierden al vaciar las tablas; se vuelven a ejecutar desde el propio SQL). */
async function reseedTrust(pool: pg.Pool): Promise<void> {
  const legal = await fs.readFile(path.join(MIGRATIONS_DIR, "080_trust_legal.sql"), "utf8");
  const legalSeed = legal.slice(legal.indexOf("insert into trust_legal_documents(kind, version, status, title, sections, content_sha256)"));
  await pool.query(legalSeed);
  const ops = await fs.readFile(path.join(MIGRATIONS_DIR, "082_trust_tariffs_operations.sql"), "utf8");
  const settings = /insert into trust_operations_settings[\s\S]*?do nothing;/.exec(ops)?.[0];
  const rules = /insert into trust_alert_rules[\s\S]*?do nothing;/.exec(ops)?.[0];
  if (!settings || !rules) throw new Error("No se encontraron las semillas de la migración 082");
  await pool.query(settings);
  await pool.query(rules);
}

/** Vacía todas las tablas de negocio (BD privada de este módulo) y restituye las semillas; conserva migraciones y PostGIS. */
export async function resetDatabase(pool: pg.Pool): Promise<void> {
  const tables = await pool.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public' and tablename not in ('schema_migrations','spatial_ref_sys')`
  );
  if (tables.rows.length > 0) {
    const list = tables.rows.map(r => `"${r.tablename.replace(/"/g, '""')}"`).join(", ");
    await pool.query(`truncate table ${list} restart identity cascade`);
  }
  await reseedTrust(pool);
}

/* ───────────────────────────── Dobles de prueba ───────────────────────────── */

/** Almacenamiento privado en memoria. `put` simula el PUT directo del cliente a la URL firmada. */
export class FakeStorage implements PrivateObjectStorage {
  readonly providerName: string;
  objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  uploadCalls: Array<{ key: string; contentType: string; expiresInSeconds: number }> = [];
  downloadCalls: Array<{ key: string; expiresInSeconds: number }> = [];
  failDownload: Error | null = null;

  constructor(providerName = "fake") {
    this.providerName = providerName;
  }

  put(key: string, bytes: Uint8Array, contentType: string): void {
    this.objects.set(key, { bytes, contentType });
  }

  async createUploadUrl(input: { key: string; contentType: string; expiresInSeconds: number }): Promise<UploadUrlResult> {
    this.uploadCalls.push(input);
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
    if (value.bytes.byteLength > maxBytes) throw new Error("exceeds max bytes");
    return value.bytes;
  }
  async createDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
    if (this.failDownload) throw this.failDownload;
    this.downloadCalls.push({ key, expiresInSeconds });
    return `https://download.invalid/${key}?ttl=${expiresInSeconds}&sig=test`;
  }
}

/** Proveedor «disabled» como el real (src/storage/provider.ts). */
export class DisabledStorage implements PrivateObjectStorage {
  readonly providerName = "disabled";
  private fail(): never {
    throw new DomainError("PRIVATE_STORAGE_NOT_CONFIGURED", "Private file storage is not configured", 503);
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

/* ───────────────────────────── Aplicación de prueba ───────────────────────────── */

export type BuildOptions = {
  /** Por defecto un FakeStorage. `null` = sin almacenamiento. */
  storage?: PrivateObjectStorage | null;
  trustConfig?: Partial<TrustConfig>;
  now?: () => Date;
};

export type TestApp = { app: FastifyInstance; storage: PrivateObjectStorage | null; config: TrustConfig };

/** Misma forma que `buildApp()` para lo que usa el módulo: límite de frecuencia, manejador global y rutas existentes de revisión. */
export async function buildTrustApp(pool: pg.Pool, options: BuildOptions = {}): Promise<TestApp> {
  const storage = options.storage === undefined ? new FakeStorage() : options.storage;
  const config: TrustConfig = { ...loadTrustConfig({}), ...options.trustConfig };
  const app = Fastify({ logger: false });
  await app.register(rateLimit, { max: 100_000, timeWindow: "1 minute" });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
        requestId: request.id
      });
    }
    // Con TRUST_TEST_DEBUG=1 se imprime la causa de los 500 (solo para diagnosticar pruebas).
    if (process.env.TRUST_TEST_DEBUG === "1") console.error("[trust-test] error no controlado:", error);
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Internal server error" }, requestId: request.id });
  });
  await registerProfileVehicleRoutes(app, pool);
  await registerTrustModule(
    app,
    {
      pool,
      config: { privateUploadTtlSeconds: 600 } as unknown as AppConfig,
      privateStorage: storage,
      routeProvider: null,
      geocodingProvider: null
    },
    { trustConfig: config, ...(options.now ? { now: options.now } : {}) }
  );
  await app.ready();
  return { app, storage, config };
}

export type ApiResult<T = any> = { status: number; body: T; headers: Record<string, unknown>; raw: string };

export type Caller = { token: string } | string | null;

function bearer(who: Caller): Record<string, string> {
  if (!who) return {};
  const token = typeof who === "string" ? who : who.token;
  return { authorization: `Bearer ${token}` };
}

export async function call<T = any>(
  app: FastifyInstance,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  options: { as?: Caller; body?: unknown; query?: Record<string, string | number | boolean | undefined> } = {}
): Promise<ApiResult<T>> {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined) query[key] = String(value);
  const response = await app.inject({
    method,
    url,
    headers: bearer(options.as ?? null),
    query,
    ...(options.body !== undefined ? { payload: options.body as object } : {})
  });
  const raw = response.body;
  let body: unknown = null;
  if (raw && String(response.headers["content-type"] ?? "").includes("json")) body = JSON.parse(raw);
  return { status: response.statusCode, body: body as T, headers: response.headers, raw };
}

/* ───────────────────────────── Sembrado ───────────────────────────── */

export type SeededUser = { id: string; token: string; phone: string; name: string };

let phoneCounter = 0;

export type UserSeed = {
  roles?: UserRole[];
  phone?: string;
  status?: "active" | "suspended" | "deleted";
  photoKey?: string;
  photoStatus?: "pending" | "approved" | "rejected";
  identityStatus?: "unverified" | "pending" | "verified" | "rejected";
  createdAt?: Date;
};

export async function seedUser(pool: pg.Pool, displayName: string | null, seed: UserSeed = {}): Promise<SeededUser> {
  phoneCounter += 1;
  const phone = seed.phone ?? `+3460000${String(phoneCounter).padStart(4, "0")}`;
  const id = (
    await pool.query<{ id: string }>(
      `insert into app_users(phone_e164, status, created_at) values($1,$2, coalesce($3::timestamptz, now())) returning id`,
      [phone, seed.status ?? "active", seed.createdAt ?? null]
    )
  ).rows[0]!.id;
  await pool.query(
    `insert into profiles(user_id, display_name, public_photo_key, public_photo_status, identity_status)
     values($1,$2,$3,$4,$5)`,
    [id, displayName, seed.photoKey ?? null, seed.photoStatus ?? "pending", seed.identityStatus ?? "unverified"]
  );
  for (const role of seed.roles ?? ["passenger"]) {
    await pool.query(`insert into user_roles(user_id, role) values($1,$2)`, [id, role]);
  }
  const client = await pool.connect();
  try {
    const session = await createSession(client, id, 3600);
    return { id, token: session.token, phone, name: displayName ?? "" };
  } finally {
    client.release();
  }
}

export type StaffWorld = {
  admin: SeededUser;
  verification: SeededUser;
  finance: SeededUser;
  support: SeededUser;
  /** Pasajero normal (sin rol de personal). */
  rider: SeededUser;
  /** Conductor normal. */
  driver: SeededUser;
};

export async function seedStaffWorld(pool: pg.Pool): Promise<StaffWorld> {
  return {
    admin: await seedUser(pool, "Lucía Ramos", { roles: ["admin"] }),
    verification: await seedUser(pool, "Álvaro Gil", { roles: ["verification_admin"] }),
    finance: await seedUser(pool, "Marta Soler", { roles: ["finance_admin"] }),
    support: await seedUser(pool, "Íñigo Pérez", { roles: ["support_admin"] }),
    rider: await seedUser(pool, "Miguel Torres", { roles: ["passenger"] }),
    driver: await seedUser(pool, "Ana López", { roles: ["driver", "passenger"] })
  };
}

export async function seedProvince(pool: pg.Pool, code = "41", name = "Sevilla"): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `insert into provinces(code,name,source_name,geom)
     values($1,$2,'integration-test',
       ST_Multi(ST_GeomFromText('POLYGON((-6.6 36.9,-4.9 36.9,-4.9 38.1,-6.6 38.1,-6.6 36.9))',4326)))
     on conflict (code) do update set name=excluded.name
     returning id`,
    [code, name]
  );
  return row.rows[0]!.id;
}

export async function seedVehicle(pool: pg.Pool, driverId: string, plate = "1234 LBC"): Promise<string> {
  return (
    await pool.query<{ id: string }>(
      `insert into vehicles(driver_user_id, make, model, plate, passenger_seats) values($1,'Seat','León',$2,4) returning id`,
      [driverId, plate]
    )
  ).rows[0]!.id;
}

export type TripSeed = {
  status?: "draft" | "published" | "active" | "completed" | "cancelled";
  departureAt?: Date;
  origin?: { label: string; lat: number; lng: number };
  destination?: { label: string; lat: number; lng: number };
};

export const BERMEJALES = { label: "Sevilla - Los Bermejales", lat: 37.3398, lng: -5.9879 };
export const CARTUJA = { label: "Sevilla - Cartuja (Universidad)", lat: 37.4094, lng: -6.0049 };

export async function seedTrip(pool: pg.Pool, driverId: string, vehicleId: string, provinceId: string, seed: TripSeed = {}): Promise<string> {
  const origin = seed.origin ?? BERMEJALES;
  const destination = seed.destination ?? CARTUJA;
  const status = seed.status ?? "published";
  const tripId = (
    await pool.query<{ id: string }>(
      `insert into trips(driver_user_id, vehicle_id, province_id, category, kind, leg, status, departure_at, offered_seats,
                         origin_geom, destination_geom, route_geom, route_distance_m, route_duration_s)
       values($1,$2,$3,'work','single','outbound',$4,$5,3,
              ST_SetSRID(ST_Point($6,$7),4326), ST_SetSRID(ST_Point($8,$9),4326),
              ST_GeomFromText($10,4326), 18000, 1500)
       returning id`,
      [
        driverId, vehicleId, provinceId, status, seed.departureAt ?? new Date(),
        origin.lng, origin.lat, destination.lng, destination.lat,
        `LINESTRING(${origin.lng} ${origin.lat},${destination.lng} ${destination.lat})`
      ]
    )
  ).rows[0]!.id;
  await pool.query(
    `insert into trip_stops(trip_id, seq, kind, label, geom) values
       ($1,0,'origin',$2,ST_SetSRID(ST_Point($3,$4),4326)),
       ($1,1,'destination',$5,ST_SetSRID(ST_Point($6,$7),4326))`,
    [tripId, origin.label, origin.lng, origin.lat, destination.label, destination.lng, destination.lat]
  );
  return tripId;
}

export async function seedBooking(
  pool: pg.Pool,
  input: {
    tripId: string;
    passengerId: string;
    status?: "confirmed" | "completed" | "cancelled" | "driver_cancelled";
    amountCents?: number;
    requestedAt?: Date;
    updatedAt?: Date;
  }
): Promise<{ requestId: string; bookingId: string }> {
  // Una reserva cancelada deja su solicitud en «cancelled» (no «abierta»); varias reservas abiertas del mismo pasajero en el mismo viaje
  // usan tramos consecutivos para respetar el índice único ride_requests_open_exact_uidx.
  const requestStatus = input.status === "cancelled" || input.status === "driver_cancelled" ? "cancelled" : "confirmed";
  const requestId = (
    await pool.query<{ id: string }>(
      `insert into ride_requests(trip_id, passenger_user_id, from_segment_seq, to_segment_seq, status, requested_at, updated_at)
       select $1, $2, next.seq, next.seq + 1, $4::request_status, coalesce($3::timestamptz, now()), coalesce($3::timestamptz, now())
         from (select coalesce(max(from_segment_seq) + 1, 0) as seq from ride_requests where trip_id = $1 and passenger_user_id = $2) next
       returning id`,
      [input.tripId, input.passengerId, input.requestedAt ?? null, requestStatus]
    )
  ).rows[0]!.id;
  const bookingId = (
    await pool.query<{ id: string }>(
      `insert into bookings(request_id, provider_payment_id, amount_cents, status, created_at, updated_at)
       values($1,$2,$3,$4, coalesce($5::timestamptz, now()), coalesce($5::timestamptz, now())) returning id`,
      [requestId, `pay_${crypto.randomUUID()}`, input.amountCents ?? 500, input.status ?? "confirmed", input.updatedAt ?? null]
    )
  ).rows[0]!.id;
  return { requestId, bookingId };
}

/** Posición viva de un viaje en curso (alimenta «Actividad de vehículos»). */
export async function seedLivePosition(
  pool: pg.Pool,
  input: { tripId: string; driverId: string; lat: number; lng: number; receivedAt?: Date }
): Promise<void> {
  const received = input.receivedAt ?? new Date();
  const event = await pool.query<{ id: string }>(
    `insert into trip_location_events(event_id, trip_id, driver_user_id, recorded_at, received_at, geom)
     values(gen_random_uuid(), $1, $2, $3, $3, ST_SetSRID(ST_Point($4,$5),4326)) returning id`,
    [input.tripId, input.driverId, received, input.lng, input.lat]
  );
  await pool.query(
    `insert into trip_live_state(trip_id, event_row_id, driver_user_id, recorded_at, received_at, geom)
     values($1,$2,$3,$4,$4,ST_SetSRID(ST_Point($5,$6),4326))
     on conflict (trip_id) do update set event_row_id = excluded.event_row_id, received_at = excluded.received_at, recorded_at = excluded.recorded_at, geom = excluded.geom`,
    [input.tripId, event.rows[0]!.id, input.driverId, received, input.lng, input.lat]
  );
}

/** Propuesta de cambio de ruta pendiente con impacto de horario/precio (alimenta la regla «Cambios de horario o precio»). */
export async function seedRouteChangeProposal(
  pool: pg.Pool,
  input: { tripId: string; createdBy: string; createdAt: Date; materialPrice?: boolean; materialSchedule?: boolean; status?: string }
): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `insert into route_change_proposals(trip_id, created_by_user_id, from_route_version, proposed_route_version, proposed_route_geom,
                                         proposed_distance_m, proposed_duration_s, material_price_change, material_schedule_change, status, created_at)
     values($1,$2,1,2,ST_GeomFromText('LINESTRING(-5.9879 37.3398,-6.0049 37.4094)',4326),19000,1600,$3,$4,$5::proposal_status,$6) returning id`,
    [input.tripId, input.createdBy, input.materialPrice ?? true, input.materialSchedule ?? false, input.status ?? "pending", input.createdAt]
  );
  return row.rows[0]!.id;
}

/** Incidencia de viaje (tabla `incident_reports` del módulo live; solo existe si se migró 030–033). */
export async function seedIncident(
  pool: pg.Pool,
  input: { tripId: string; reporterId: string; role?: "driver" | "passenger"; bookingId?: string; category?: string; createdAt?: Date }
): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `insert into incident_reports(reporter_user_id, reporter_role, trip_id, booking_id, category, description, created_at, updated_at)
     values($1,$2,$3,$4,$5,'Descripción de la incidencia de prueba', coalesce($6::timestamptz, now()), coalesce($6::timestamptz, now()))
     returning id`,
    [input.reporterId, input.role ?? "passenger", input.tripId, input.bookingId ?? null, input.category ?? "route_or_schedule", input.createdAt ?? null]
  );
  return row.rows[0]!.id;
}

/** Propuesta de devolución (tabla `refund_requests` del módulo money; solo existe si se migró 043). */
export async function seedRefund(
  pool: pg.Pool,
  input: {
    requestId: string;
    bookingId: string;
    tripId: string;
    passengerId: string;
    driverId?: string;
    status?: "pending_review" | "approved" | "refunded" | "rejected";
    paidCents?: number;
    proposedCents?: number | null;
    approvedCents?: number | null;
    retainedCommissionCents?: number | null;
    cancelledAt?: Date;
  }
): Promise<string> {
  const status = input.status ?? "pending_review";
  const row = await pool.query<{ id: string }>(
    `insert into refund_requests(origin, status, request_id, booking_id, trip_id, passenger_user_id, driver_user_id, cancelled_by,
                                 cancelled_at, paid_cents, proposed_cents, approved_cents, retained_commission_cents, refunded_at)
     values('passenger_cancellation',$1,$2,$3,$4,$5,$6,'passenger',$7,$8,$9,$10,$11, case when $1 = 'refunded' then now() else null end)
     returning id`,
    [
      status, input.requestId, input.bookingId, input.tripId, input.passengerId, input.driverId ?? null,
      input.cancelledAt ?? null, input.paidCents ?? 500, input.proposedCents ?? null, input.approvedCents ?? null,
      input.retainedCommissionCents ?? null
    ]
  );
  return row.rows[0]!.id;
}

/* ───────────────────────────── Archivos de ejemplo ───────────────────────────── */

/** Bytes con la firma binaria del tipo (suficiente para la comprobación de firma del servidor). `salt` cambia el SHA-256. */
export function sampleBytes(contentType: string, salt = 0, size = 96): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + salt * 17 + 7) & 0xff;
  const put = (offset: number, values: ReadonlyArray<number | string>) => {
    let at = offset;
    for (const v of values) bytes[at++] = typeof v === "string" ? v.charCodeAt(0) : v;
  };
  switch (contentType) {
    case "image/jpeg": put(0, [0xff, 0xd8, 0xff, 0xe0]); break;
    case "image/png": put(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); break;
    case "image/webp": put(0, ["R", "I", "F", "F"]); put(8, ["W", "E", "B", "P"]); break;
    case "image/heic": case "image/heif": put(4, ["f", "t", "y", "p", "h", "e", "i", "c"]); break;
    case "application/pdf": put(0, ["%", "P", "D", "F", "-", "1", ".", "4"]); break;
    default: break;
  }
  return bytes;
}

export type UploadKind = "photo" | "selfie" | "identity_document" | "driver_license";

const INTENT_PATH: Record<UploadKind, string> = {
  photo: "/v1/me/photo/upload-intents",
  selfie: "/v1/me/identity-check/upload-intents",
  identity_document: "/v1/me/identity/documents/upload-intents",
  driver_license: "/v1/me/identity/documents/upload-intents"
};

export function keyFromUploadUrl(url: string): string {
  return url.replace("https://upload.invalid/", "");
}

/** Pide la subida, «sube» el archivo al almacenamiento falso y confirma. Devuelve ambas respuestas. */
export async function uploadFlow(
  app: FastifyInstance,
  storage: FakeStorage,
  user: Caller,
  kind: UploadKind,
  options: { contentType?: string; salt?: number; bytes?: Uint8Array } = {}
): Promise<{ intent: ApiResult; complete: ApiResult; key: string; bytes: Uint8Array }> {
  const contentType = options.contentType ?? (kind === "identity_document" || kind === "driver_license" ? "application/pdf" : "image/jpeg");
  const bytes = options.bytes ?? sampleBytes(contentType, options.salt ?? Math.floor(Math.random() * 1e6));
  const document = kind === "identity_document" || kind === "driver_license";
  const intent = await call(app, "POST", INTENT_PATH[kind], {
    as: user,
    body: { ...(document ? { kind } : {}), contentType, sizeBytes: bytes.byteLength }
  });
  if (intent.status !== 201) return { intent, complete: intent, key: "", bytes };
  const key = keyFromUploadUrl(intent.body.uploadUrl);
  storage.put(key, bytes, contentType);
  const complete = await call(app, "POST", `${INTENT_PATH[kind]}/${intent.body.intentId}/complete`, { as: user });
  return { intent, complete, key, bytes };
}

/** Acepta la versión vigente del aviso de la comprobación privada (pantalla 07). */
export async function acceptPrivateCheckNotice(app: FastifyInstance, user: Caller): Promise<ApiResult> {
  const latest = await call(app, "GET", "/v1/legal/documents/private_check_notice");
  return call(app, "POST", "/v1/me/legal/acceptances", {
    as: user,
    body: { kind: "private_check_notice", version: latest.body.version, context: "private_check" }
  });
}

export async function auditCount(pool: pg.Pool, action: string, entityId?: string): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `select count(*)::text as n from audit_events where action = $1 and ($2::text is null or entity_id = $2)`,
    [action, entityId ?? null]
  );
  return Number(r.rows[0]?.n ?? 0);
}

export async function lastAudit(pool: pg.Pool, action: string): Promise<{ actor_user_id: string | null; entity_type: string; entity_id: string | null; request_id: string | null; metadata: any } | undefined> {
  const r = await pool.query(
    `select actor_user_id, entity_type, entity_id, request_id, metadata from audit_events where action = $1 order by id desc limit 1`,
    [action]
  );
  return r.rows[0];
}
