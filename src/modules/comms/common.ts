import type { FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import { readBearerToken, resolveSession, type AuthPrincipal } from "../../auth/session.js";
import type { CommsConfig } from "./config.js";
import { err } from "./errors.js";

export type Queryable = Pick<PoolClient, "query"> | Pick<Pool, "query">;

export async function tx<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const value = await fn(client);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const principals = new WeakMap<FastifyRequest, Promise<AuthPrincipal>>();

/**
 * Sesión del solicitante (401 si falta o caducó, 403 si la cuenta no está activa). Se resuelve UNA vez por petición: el
 * gancho `preValidation` del módulo la exige antes de validar nada (un cliente sin sesión recibe siempre 401, nunca detalles
 * de validación) y los manejadores de las rutas reutilizan el resultado sin otra consulta.
 */
export function authenticate(pool: Pool, request: FastifyRequest): Promise<AuthPrincipal> {
  let principal = principals.get(request);
  if (!principal) {
    principal = (async () => resolveSession(pool, readBearerToken(request.headers.authorization)))();
    principals.set(request, principal);
  }
  return principal;
}

/* ───────────── Fechas ───────────── */

export function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export function isoOrNull(value: Date | string | null | undefined): string | null {
  return value === null || value === undefined ? null : iso(value);
}

/** Expresión SQL que serializa un timestamptz con microsegundos (para cursores exactos). */
export function tsUs(column: string): string {
  return `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/* ───────────── Cursores opacos ───────────── */

export function encodeCursor(payload: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(raw: string, shape: Record<string, "string" | "number">): Record<string, string | number> {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("shape");
    const out: Record<string, string | number> = {};
    for (const [key, type] of Object.entries(shape)) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value !== type) throw new Error("field");
      if (type === "number" && !Number.isFinite(value as number)) throw new Error("number");
      out[key] = value as string | number;
    }
    return out;
  } catch {
    throw err("INVALID_CURSOR", 400, "El cursor de paginación no es válido.");
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TS_US_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** Cursor de listas ordenadas por (fecha desc, id desc): `t` = timestamp con microsegundos (ver `tsUs`) e `id` uuid. */
export function decodeTimeIdCursor(raw: string): { t: string; id: string } {
  const cursor = decodeCursor(raw, { t: "string", id: "string" });
  const t = String(cursor.t);
  const id = String(cursor.id);
  if (!TS_US_RE.test(t) || !UUID_RE.test(id)) throw err("INVALID_CURSOR", 400, "El cursor de paginación no es válido.");
  return { t, id };
}

/* ───────────── Texto ───────────── */

/** Escapa %, _ y \ para usar el texto del usuario dentro de un ILIKE. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, ch => `\\${ch}`)}%`;
}

/** PostgreSQL no admite el carácter NUL en columnas `text`: se rechaza antes de llegar a la base de datos. */
export function containsNul(value: string): boolean {
  return value.includes("\u0000");
}

export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/* ───────────── PublicUser ───────────── */

export type PublicUserDto = {
  id: string;
  displayName: string;
  firstName: string;
  photoUrl: string | null;
  ratingAverage: number | null;
  ratingCount: number;
};

export type PublicUserRow = {
  user_id: string;
  display_name: string | null;
  public_photo_key: string | null;
  public_photo_status: string | null;
  user_status: string | null;
  /** Agregados de valoración (módulo live). Ausentes mientras esa migración no esté aplicada. */
  rating_sum?: number | string | null;
  rating_count?: number | string | null;
};

/** Columnas necesarias para construir un PublicUser (alias `u` = app_users, `p` = profiles). */
export const PUBLIC_USER_COLUMNS = `u.id as user_id, p.display_name, p.public_photo_key, p.public_photo_status, u.status as user_status`;

export function firstNameOf(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? displayName;
}

export function toPublicUser(row: PublicUserRow, config: Pick<CommsConfig, "publicMediaBaseUrl">): PublicUserDto {
  const deleted = row.user_status === "deleted";
  const displayName = deleted ? "Usuario eliminado" : (row.display_name?.trim() || "Usuario MVC");
  const photoUrl =
    !deleted && config.publicMediaBaseUrl && row.public_photo_key && row.public_photo_status === "approved"
      ? `${config.publicMediaBaseUrl}/${row.public_photo_key.split("/").map(encodeURIComponent).join("/")}`
      : null;
  return {
    id: row.user_id,
    displayName,
    firstName: firstNameOf(displayName),
    photoUrl,
    ratingAverage: ratingAverageOf(row),
    ratingCount: deleted ? 0 : Number(row.rating_count ?? 0)
  };
}

/** media = round(rating_sum / rating_count, 1), con la misma aritmética que los módulos live y trips (idéntico redondeo); null sin valoraciones. */
function ratingAverageOf(row: PublicUserRow): number | null {
  if (row.user_status === "deleted") return null;
  const count = Number(row.rating_count ?? 0);
  const sum = Number(row.rating_sum ?? 0);
  return count > 0 ? Math.round((sum * 10) / count) / 10 : null;
}

let ratingColumnsPresent: Promise<boolean> | null = null;

/**
 * Las columnas de valoración las añade la migración 030 (módulo live). `comms` funciona con y sin ella: se comprueba una sola
 * vez por proceso si existen y, si no, `ratingAverage` es null y `ratingCount` 0.
 */
function hasRatingColumns(db: Queryable): Promise<boolean> {
  if (!ratingColumnsPresent) {
    ratingColumnsPresent = Promise.resolve(
      db.query<{ total: number }>(
        `select count(*)::int as total from information_schema.columns
          where table_schema = current_schema() and table_name = 'profiles' and column_name in ('rating_sum','rating_count')`
      )
    ).then(
      result => (result.rows[0]?.total ?? 0) === 2,
      () => {
        ratingColumnsPresent = null;
        return false;
      }
    );
  }
  return ratingColumnsPresent;
}

export async function loadPublicUsers(
  db: Queryable,
  userIds: string[],
  config: Pick<CommsConfig, "publicMediaBaseUrl">
): Promise<Map<string, PublicUserDto>> {
  const result = new Map<string, PublicUserDto>();
  if (userIds.length === 0) return result;
  const ratings = (await hasRatingColumns(db)) ? ", p.rating_sum, p.rating_count" : "";
  const rows = await db.query<PublicUserRow>(
    `select ${PUBLIC_USER_COLUMNS}${ratings}
       from app_users u left join profiles p on p.user_id = u.id
      where u.id = any($1::uuid[])`,
    [[...new Set(userIds)]]
  );
  for (const row of rows.rows) result.set(row.user_id, toPublicUser(row, config));
  return result;
}

/* ───────────── Categorías de viaje ───────────── */

export type TripCategoryCode = "work" | "university" | "fp_academies" | "hospital" | "sport" | "other";

/** «Trabajo» (título de los grupos de ruta). */
export const CATEGORY_SHORT_LABEL: Record<TripCategoryCode, string> = {
  work: "Trabajo",
  university: "Universidad",
  fp_academies: "FP / Academias",
  hospital: "Hospital",
  sport: "Deporte",
  other: "Otros destinos"
};

/** «Ruta al trabajo» (subtítulo de las conversaciones directas, tal como en la pantalla 25). */
export const CATEGORY_ROUTE_LABEL: Record<TripCategoryCode, string> = {
  work: "Ruta al trabajo",
  university: "Universidad",
  fp_academies: "FP / Academias",
  hospital: "Hospital",
  sport: "Deporte",
  other: "Otros destinos"
};

export function pageLimit(limit: number | undefined, fallback = 20, max = 50): number {
  const value = limit ?? fallback;
  return Math.min(Math.max(1, Math.trunc(value)), max);
}
