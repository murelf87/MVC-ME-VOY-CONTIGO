import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DomainError } from "../../../errors.js";
import { tx } from "./db.js";

const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

export function parseIdempotencyKey(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) {
    throw new DomainError("IDEMPOTENCY_KEY_REQUIRED", "Falta la cabecera Idempotency-Key.", 400);
  }
  if (!KEY_RE.test(value)) {
    throw new DomainError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "Idempotency-Key debe tener entre 8 y 128 caracteres [A-Za-z0-9_-].",
      400
    );
  }
  return value;
}

/** JSON con claves ordenadas: dos cuerpos equivalentes producen la misma huella. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

export type IdempotentOutcome<T> = { status: number; body: T; replayed: boolean };

/**
 * Ejecuta `fn` como mucho UNA vez por (usuario, clave). El efecto y la respuesta guardada se confirman en la MISMA
 * transacción: o existen ambos o ninguno. Peticiones concurrentes con la misma clave se serializan con un cierre
 * consultivo; la segunda recibe la respuesta guardada de la primera (`replayed: true`).
 *
 * - Misma clave con otra ruta/cuerpo → 422 IDEMPOTENCY_KEY_REUSED.
 * - Los errores (rollback) no se guardan: el reintento se evalúa de nuevo.
 * - `scope` identifica la operación y su recurso (p. ej. «payment_intent:<requestId>»).
 */
export async function withIdempotency<T extends object>(
  pool: Pool,
  options: { userId: string; key: string; scope: string; fingerprint: unknown; successStatus: number },
  fn: (client: PoolClient) => Promise<T>
): Promise<IdempotentOutcome<T>> {
  const requestHash = createHash("sha256")
    .update(stableStringify({ scope: options.scope, fingerprint: options.fingerprint }))
    .digest("hex");

  return tx(pool, async client => {
    await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `money-idem:${options.userId}:${options.key}`
    ]);
    const existing = await client.query<{ request_hash: string; response_status: number; response_body: T }>(
      `select request_hash,response_status,response_body
         from idempotency_keys where user_id=$1 and idem_key=$2`,
      [options.userId, options.key]
    );
    const stored = existing.rows[0];
    if (stored) {
      if (stored.request_hash !== requestHash) {
        throw new DomainError(
          "IDEMPOTENCY_KEY_REUSED",
          "Esta Idempotency-Key ya se usó con otra operación o con otro cuerpo.",
          422
        );
      }
      return { status: stored.response_status, body: stored.response_body, replayed: true };
    }

    const body = await fn(client);
    await client.query(
      `insert into idempotency_keys(user_id,idem_key,scope,request_hash,response_status,response_body)
       values($1,$2,$3,$4,$5,$6::jsonb)`,
      [options.userId, options.key, options.scope, requestHash, options.successStatus, JSON.stringify(body)]
    );
    return { status: options.successStatus, body, replayed: false };
  });
}

/**
 * Elimina claves de idempotencia antiguas (las respuestas guardadas no deben conservarse indefinidamente).
 * Función de mantenimiento para el planificador del orquestador (no hay planificador en este repositorio).
 * Devuelve cuántas filas se borraron.
 */
export async function purgeIdempotencyKeys(pool: Pool, olderThanHours = 48): Promise<number> {
  const result = await pool.query(`delete from idempotency_keys where created_at < now() - ($1::int * interval '1 hour')`, [
    olderThanHours
  ]);
  return result.rowCount ?? 0;
}
