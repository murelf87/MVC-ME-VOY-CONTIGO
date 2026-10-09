import type { FastifyBaseLogger } from "fastify";
import type { Pool } from "pg";
import { tx } from "./common.js";
import { expireOverdueHolds } from "./request-detail.js";
import { extendSeriesHorizon } from "./series-service.js";
import { tripsSettings } from "./settings.js";

export type SweepResult = { expired: number; materialized: number; purgedKeys: number };

/**
 * Un barrido: caduca holds vencidos (solicitud → `expired`, hold liberado, aviso al pasajero), amplía la ventana de las
 * series activas y purga claves de idempotencia vencidas. Idempotente y seguro en varias instancias: los holds se
 * toman con `FOR UPDATE SKIP LOCKED` y cada serie con un cerrojo consultivo.
 */
export async function runTripsSweep(pool: Pool, now = new Date()): Promise<SweepResult> {
  let expired = 0;
  for (let round = 0; round < 10; round += 1) {
    const n = await tx(pool, client => expireOverdueHolds(client));
    expired += n;
    if (n < 200) break;
  }
  const materialized = await extendSeriesHorizon(pool, now);
  const purged = await pool.query(
    `delete from trip_idempotency_keys where created_at < now() - ($1 || ' hours')::interval`,
    [tripsSettings().idempotencyTtlHours]
  );
  return { expired, materialized, purgedKeys: purged.rowCount ?? 0 };
}

/**
 * Temporizador interno del barrido (`TRIPS_SWEEP_INTERVAL_SECONDS`, 0 = desactivado). No bloquea el cierre del proceso
 * (`unref`) y nunca solapa dos barridos. En producción multi-instancia conviene además un planificador externo.
 */
export function startTripsSweeper(pool: Pool, log: FastifyBaseLogger): { stop: () => void } {
  const seconds = tripsSettings().sweepIntervalSeconds;
  if (seconds <= 0) return { stop: () => undefined };
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runTripsSweep(pool)
      .then(result => {
        if (result.expired > 0 || result.materialized > 0) log.info({ trips: result }, "trips sweep");
      })
      .catch(error => log.error({ err: error }, "trips sweep failed"))
      .finally(() => { running = false; });
  }, seconds * 1000);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
