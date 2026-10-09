import "../../../db/types.js";
import type { Pool, PoolClient } from "pg";
import { DomainError } from "../../../errors.js";

export type Queryable = Pick<PoolClient, "query"> | Pick<Pool, "query">;

/** Transacción con rollback garantizado. Los asientos contables diferidos se comprueban en el `commit`. */
export async function tx<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const value = await fn(client);
    await client.query("commit");
    return value;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // la conexión ya estaba rota o la transacción ya se había abortado en el servidor
    }
    throw error;
  } finally {
    client.release();
  }
}

export function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export function toIsoRequired(value: Date | string): string {
  const iso = toIso(value);
  if (iso === null) throw new Error("timestamp expected");
  return iso;
}

/** Convierte bigint/numeric de `pg` (cadenas) a número entero seguro: los importes son céntimos enteros. */
export function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`unsafe integer from database: ${String(value)}`);
  return parsed;
}

export function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : num(value);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_RE.test(value);

/** Cursor opaco de paginación por claves (instante + clave de desempate). */
export type KeysetCursor = { t: string; k: string };

export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string | undefined): KeysetCursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as KeysetCursor).t === "string" &&
      typeof (parsed as KeysetCursor).k === "string" &&
      !Number.isNaN(Date.parse((parsed as KeysetCursor).t)) &&
      (parsed as KeysetCursor).k.length <= 100
    ) {
      return { t: (parsed as KeysetCursor).t, k: (parsed as KeysetCursor).k };
    }
  } catch {
    // cae al error de abajo
  }
  throw new DomainError("VALIDATION_ERROR", "El cursor de paginación no es válido.", 400);
}

export function clampLimit(limit: number | undefined, fallback = 20, max = 50): number {
  if (!limit || !Number.isInteger(limit) || limit < 1) return fallback;
  return Math.min(limit, max);
}

/** «YYYY-MM» (Europe/Madrid) → primer día del mes «YYYY-MM-01» (para parámetros `date`). */
export function monthToFirstDay(month: string | undefined): string | null {
  if (month === undefined) return null;
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new DomainError("VALIDATION_ERROR", "El mes debe tener el formato AAAA-MM.", 400);
  }
  return `${month}-01`;
}

/** Mes natural actual en Europe/Madrid como «YYYY-MM» (calculado por la base de datos, no por la zona del proceso). */
export async function currentMadridMonth(db: Queryable): Promise<string> {
  const result = await db.query<{ month: string }>(
    `select to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM') as month`
  );
  return result.rows[0]!.month;
}

export const MADRID_TZ = "Europe/Madrid";
