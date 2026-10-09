import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import { readBearerToken, resolveSession, type AuthPrincipal, type UserRole } from "../../auth/session.js";
import { DomainError } from "../../errors.js";
import { err } from "./errors.js";
import type { GeoPoint, IsoDate, IsoDateTime, LocalTime, Weekday } from "./types.js";

export type Db = Pick<PoolClient, "query"> | Pick<Pool, "query">;

/**
 * Ejecuta consultas independientes en paralelo SOLO cuando `db` es un Pool. Un `PoolClient` (dentro de una transacción) admite
 * una consulta cada vez: lanzar varias a la vez está obsoleto en `pg` (se eliminará en pg@9), así que ahí se encadenan.
 */
export async function inParallel<const T extends readonly (() => Promise<unknown>)[]>(
  db: Db, thunks: T
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const isClient = typeof (db as { release?: unknown }).release === "function";
  if (!isClient) return (await Promise.all(thunks.map(run => run()))) as never;
  const out: unknown[] = [];
  for (const run of thunks) out.push(await run());
  return out as never;
}

export async function tx<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/* ─────────────────────────────── Autenticación ─────────────────────────────── */

const KNOWN_ROLES: ReadonlySet<string> = new Set(["passenger", "driver", "admin", "verification_admin", "finance_admin", "support_admin"]);

/**
 * `resolveSession` entrega los roles como TEXTO de Postgres (`{driver,passenger}`): `array_agg` de un tipo enumerado no lo
 * convierte `pg` en array, y los servicios heredados (`requireAnyRole`) fallarían con TypeError (500). Aquí se acepta un
 * array real o ese literal; los valores desconocidos se descartan (nunca se concede un permiso por un valor inesperado).
 * Defecto del núcleo (src/auth/session.ts) que sortean también los módulos `live`, `money` y `trust`.
 */
export function normalizeRoles(input: unknown): UserRole[] {
  let values: string[] = [];
  if (Array.isArray(input)) values = input.filter((value): value is string => typeof value === "string");
  else if (typeof input === "string") {
    const inner = input.trim().replace(/^\{/, "").replace(/\}$/, "");
    values = inner.length === 0 ? [] : inner.split(",").map(value => value.trim().replace(/^"|"$/g, ""));
  }
  return [...new Set(values.filter(value => KNOWN_ROLES.has(value)))] as UserRole[];
}

export async function principalOf(pool: Pool, authorization: string | undefined): Promise<AuthPrincipal> {
  const principal = await resolveSession(pool, readBearerToken(authorization));
  return { ...principal, roles: normalizeRoles(principal.roles) };
}

/** Autenticación opcional: sin cabecera → invitado (null); con cabecera inválida → 401 (la app renueva sesión). */
export async function optionalPrincipalOf(pool: Pool, authorization: string | undefined): Promise<AuthPrincipal | null> {
  if (authorization === undefined || authorization.trim() === "") return null;
  return principalOf(pool, authorization);
}

export function requireRole(principal: AuthPrincipal, role: UserRole, message: string): void {
  if (!principal.roles.includes(role)) throw err("AUTH_FORBIDDEN", 403, message);
}

/* ─────────────────────────────── Errores HTTP ─────────────────────────────── */

/**
 * Manejador de errores del plugin «trips». El manejador global de `src/app.ts` convierte los errores de validación
 * y de límite de peticiones en 500; aquí se devuelven como 400 VALIDATION_ERROR / 429 RATE_LIMITED con el formato
 * estándar `{ error:{ code, message, details? }, requestId }`.
 */
export function tripsErrorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const requestId = request.id;
  if (error instanceof DomainError) {
    return reply.code(error.statusCode).send({
      error: { code: error.code, message: error.message, ...(error.details !== undefined ? { details: error.details } : {}) },
      requestId
    });
  }
  const fastifyError = error as FastifyError & { validation?: unknown[]; validationContext?: string };
  if (fastifyError.validation) {
    return reply.code(400).send({
      error: {
        code: "VALIDATION_ERROR",
        message: "Los datos enviados no son válidos.",
        details: fastifyError.validation.map(item => {
          const v = item as { instancePath?: string; message?: string; keyword?: string };
          return { path: v.instancePath ?? "", message: v.message ?? "", keyword: v.keyword ?? "" };
        })
      },
      requestId
    });
  }
  if (fastifyError.statusCode === 429) {
    return reply.code(429).send({
      error: { code: "RATE_LIMITED", message: "Demasiadas peticiones. Espera un momento e inténtalo de nuevo." },
      requestId
    });
  }
  if (typeof fastifyError.statusCode === "number" && fastifyError.statusCode >= 400 && fastifyError.statusCode < 500) {
    return reply.code(fastifyError.statusCode).send({
      error: { code: "BAD_REQUEST", message: "La petición no es válida." },
      requestId
    });
  }
  request.log.error(error);
  return reply.code(500).send({
    error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." },
    requestId
  });
}

/* ─────────────────────────────── Paginación ─────────────────────────────── */

export function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined): Record<string, unknown> | null {
  if (cursor === undefined || cursor === "") return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // cae al error de abajo
  }
  throw err("INVALID_CURSOR", 400, "El cursor de paginación no es válido.");
}

export function offsetFromCursor(cursor: string | undefined): number {
  const decoded = decodeCursor(cursor);
  if (!decoded) return 0;
  const offset = decoded.o;
  if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0 || offset > 100_000) {
    throw err("INVALID_CURSOR", 400, "El cursor de paginación no es válido.");
  }
  return offset;
}

/* ─────────────────────────────── Tiempo (Europe/Madrid) ─────────────────────────────── */

const MADRID = "Europe/Madrid";

const madridParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: MADRID,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

function partsOf(date: Date): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const map: Record<string, number> = {};
  for (const part of madridParts.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = Number(part.value);
  }
  return { y: map.year ?? 0, mo: map.month ?? 0, d: map.day ?? 0, h: map.hour ?? 0, mi: map.minute ?? 0, s: map.second ?? 0 };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function iso(date: Date): IsoDateTime {
  return date.toISOString();
}

export function isoOrNull(date: Date | null | undefined): IsoDateTime | null {
  return date ? date.toISOString() : null;
}

/** «HH:mm» en Europe/Madrid. */
export function localTimeOf(date: Date): LocalTime {
  const p = partsOf(date);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

/** «YYYY-MM-DD» en Europe/Madrid. */
export function localDateOf(date: Date): IsoDate {
  const p = partsOf(date);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

/** Minutos desde medianoche (Madrid) de un instante. */
export function localMinutesOf(date: Date): number {
  const p = partsOf(date);
  return p.h * 60 + p.mi;
}

function offsetMinutesAt(utcMs: number): number {
  const p = partsOf(new Date(utcMs));
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

/** Convierte una fecha y hora de reloj de Madrid en el instante UTC (gestiona el cambio horario). */
export function madridLocalToUtc(date: IsoDate, time: LocalTime): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = offsetMinutesAt(guess);
  let utc = guess - first * 60_000;
  const second = offsetMinutesAt(utc);
  if (second !== first) utc = guess - second * 60_000;
  return new Date(utc);
}

const WEEKDAYS: readonly Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const WEEKDAY_ORDER: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const WORKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri"];

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isLocalTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function weekdayOfDate(date: IsoDate): Weekday {
  return WEEKDAYS[new Date(`${date}T00:00:00.000Z`).getUTCDay()]!;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Lunes (ISO) de la semana que contiene `date`. */
export function mondayOf(date: IsoDate): IsoDate {
  const idx = WEEKDAY_ORDER.indexOf(weekdayOfDate(date));
  return addDays(date, -idx);
}

export function sortWeekdays(days: readonly Weekday[]): Weekday[] {
  return WEEKDAY_ORDER.filter(day => days.includes(day));
}

export function parseWeekdaysCsv(value: string | undefined): Weekday[] | null {
  if (value === undefined || value.trim() === "") return null;
  const parts = value.split(",").map(item => item.trim().toLowerCase()).filter(Boolean);
  const valid = parts.filter((p): p is Weekday => (WEEKDAY_ORDER as readonly string[]).includes(p));
  if (valid.length !== parts.length || valid.length === 0) {
    throw err("INVALID_SEARCH_WEEKDAYS", 422, "Los días indicados no son válidos. Usa mon,tue,wed,thu,fri,sat,sun.");
  }
  return sortWeekdays([...new Set(valid)]);
}

const SPANISH_WEEKDAYS: Record<Weekday, string> = {
  mon: "lunes", tue: "martes", wed: "miércoles", thu: "jueves", fri: "viernes", sat: "sábado", sun: "domingo"
};
const SPANISH_MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

/** «viernes 9 de octubre». */
export function spanishDay(date: IsoDate): string {
  const [, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${SPANISH_WEEKDAYS[weekdayOfDate(date)]} ${d} de ${SPANISH_MONTHS[m - 1]}`;
}

const SHORT_DAYS: Record<Weekday, string> = { mon: "Lun", tue: "Mar", wed: "Mié", thu: "Jue", fri: "Vie", sat: "Sáb", sun: "Dom" };

/** «Lun - Vie · Recurrente» o «Lun, Mié, Vie». */
export function weekdaysLabel(days: readonly Weekday[]): string {
  const sorted = sortWeekdays(days);
  if (sorted.length === 0) return "";
  const first = WEEKDAY_ORDER.indexOf(sorted[0]!);
  const last = WEEKDAY_ORDER.indexOf(sorted[sorted.length - 1]!);
  const contiguous = last - first + 1 === sorted.length;
  if (sorted.length >= 3 && contiguous) return `${SHORT_DAYS[sorted[0]!]} - ${SHORT_DAYS[sorted[sorted.length - 1]!]}`;
  return sorted.map(day => SHORT_DAYS[day]).join(", ");
}

/* ─────────────────────────────── Geografía ─────────────────────────────── */

const EARTH_RADIUS_M = 6_371_008.8;

export function haversineM(a: GeoPoint, b: GeoPoint): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 3 decimales ≈ 110 m: precisión máxima para quien no participa en el viaje. */
export function approx3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Cuadrícula del mapa de inicio (0,01° ≈ 1,1 km). */
export function grid(value: number, step = 0.01): number {
  return Math.round(Math.round(value / step) * step * 1e6) / 1e6;
}

export function pointOf(lat: number | string, lng: number | string): GeoPoint {
  return { lat: Number(lat), lng: Number(lng) };
}

export function round(value: number, decimals = 0): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export function minutesFromSeconds(seconds: number): number {
  return Math.max(0, Math.round(seconds / 60));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Resumen de equivalencias de nombre de vehículo: «SEAT Arona». */
export function vehicleDisplayName(make: string, model: string): string {
  return `${make.trim()} ${model.trim()}`.replace(/\s+/g, " ").trim();
}

/** Últimos 3 caracteres alfanuméricos de la matrícula (pista, nunca la matrícula completa). */
export function plateHintOf(plate: string): string {
  const normalized = plate.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized.slice(-3);
}
