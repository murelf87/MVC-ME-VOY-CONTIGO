import { createHash } from "node:crypto";
import type { FastifyReply } from "fastify";
import type { Pool, PoolClient } from "pg";
import { tx } from "./common.js";
import { err } from "./errors.js";
import { tripsSettings } from "./settings.js";

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,80}$/;

export function readIdempotencyKey(header: string | string[] | undefined): string | undefined {
  if (header === undefined) return undefined;
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || value.trim() === "") return undefined;
  const key = value.trim();
  if (!KEY_PATTERN.test(key)) {
    throw err("IDEMPOTENCY_KEY_INVALID", 400, "La cabecera Idempotency-Key no es válida (8–80 caracteres: letras, números, . _ : -).");
  }
  return key;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

export type IdempotentResult<T> = { status: number; body: T };

/**
 * Ejecuta `execute` en una transacción. Con `key`, la reserva de la clave y la operación se confirman JUNTAS:
 * una petición concurrente con la misma clave espera a la primera y recibe su respuesta (nunca se duplica el efecto).
 * Misma clave + mismo cuerpo → repetición de la respuesta original (`replayed: true`);
 * misma clave + cuerpo distinto → 422 IDEMPOTENCY_KEY_REUSED. Sin clave no hay deduplicación.
 */
export async function withIdempotency<T>(
  pool: Pool,
  input: { userId: string; scope: string; key: string | undefined; fingerprintOf: unknown },
  execute: (client: PoolClient) => Promise<IdempotentResult<T>>
): Promise<IdempotentResult<T> & { replayed: boolean }> {
  const { key } = input;
  if (key === undefined) {
    return { ...(await tx(pool, execute)), replayed: false };
  }
  const hash = fingerprint(input.fingerprintOf);
  const ttlHours = tripsSettings().idempotencyTtlHours;
  return tx(pool, async client => {
    await client.query(
      `delete from trip_idempotency_keys
        where user_id=$1 and scope=$2 and idempotency_key=$3 and created_at < now() - ($4 || ' hours')::interval`,
      [input.userId, input.scope, key, ttlHours]
    );
    const inserted = await client.query(
      `insert into trip_idempotency_keys(user_id, scope, idempotency_key, request_hash)
       values($1,$2,$3,$4)
       on conflict (user_id, scope, idempotency_key) do nothing
       returning 1`,
      [input.userId, input.scope, key, hash]
    );
    if (inserted.rowCount === 0) {
      const existing = await client.query<{ request_hash: string; status_code: number | null; response: unknown }>(
        `select request_hash, status_code, response
           from trip_idempotency_keys where user_id=$1 and scope=$2 and idempotency_key=$3`,
        [input.userId, input.scope, key]
      );
      const row = existing.rows[0];
      if (!row || row.request_hash !== hash) {
        throw err("IDEMPOTENCY_KEY_REUSED", 422, "Esa clave de idempotencia ya se usó con una petición distinta.");
      }
      return { status: row.status_code ?? 200, body: row.response as T, replayed: true };
    }
    const result = await execute(client);
    await client.query(
      `update trip_idempotency_keys set status_code=$4, response=$5::jsonb
        where user_id=$1 and scope=$2 and idempotency_key=$3`,
      [input.userId, input.scope, key, result.status, JSON.stringify(result.body)]
    );
    return { ...result, replayed: false };
  });
}

export function sendIdempotent<T>(reply: FastifyReply, result: IdempotentResult<T> & { replayed: boolean }): FastifyReply {
  if (result.replayed) reply.header("Idempotency-Replayed", "true");
  return reply.code(result.status).send(result.body);
}
