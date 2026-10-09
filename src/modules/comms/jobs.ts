import { executeDueAccountDeletions } from "./account-deletion.js";
import { expireDataExports, processQueuedDataExports } from "./data-export.js";
import { silentLogger, type DataRightsDeps } from "./deps.js";

/** Subidas de adjuntos de ayuda que se abandonaron: se retiran 24 h después de que caduque la URL firmada. */
const ABANDONED_INTENT_GRACE_HOURS = 24;
/** Adjuntos subidos pero nunca vinculados a una consulta. */
const UNLINKED_ATTACHMENT_DAYS = 7;
const CLEANUP_BATCH = 100;

export type CommsJobsSummary = {
  exports: Awaited<ReturnType<typeof processQueuedDataExports>>;
  expiredExports: number;
  deletions: Awaited<ReturnType<typeof executeDueAccountDeletions>>;
  cleanup: { intents: number; attachments: number };
};

/**
 * Limpieza de subidas huérfanas de «Centro de ayuda». Solo actúa si hay borrado de objetos disponible: sin él los
 * registros se conservan para poder borrar los objetos cuando haya almacenamiento configurado.
 */
export async function cleanupSupportUploads(deps: DataRightsDeps, now: Date = new Date()): Promise<{ intents: number; attachments: number }> {
  const eraser = deps.eraser;
  const log = deps.log ?? silentLogger;
  const result = { intents: 0, attachments: 0 };
  if (!eraser) return result;
  const { pool } = deps;

  const abandoned = await pool.query<{ id: string; storage_key: string }>(
    `select id, storage_key
       from support_upload_intents
      where completed_at is null and expires_at < $1::timestamptz - make_interval(hours => $2::int)
      order by expires_at
      limit ${CLEANUP_BATCH}`,
    [now, ABANDONED_INTENT_GRACE_HOURS]
  );
  for (const row of abandoned.rows) {
    try {
      await eraser.deleteObjects([row.storage_key]);
      await pool.query(`delete from support_upload_intents where id = $1 and completed_at is null`, [row.id]);
      result.intents += 1;
    } catch (error) {
      log.error({ intentId: row.id, error: error instanceof Error ? error.name : "unknown" }, "could not clean abandoned support upload");
    }
  }

  const unlinked = await pool.query<{ id: string; storage_key: string }>(
    `select id, storage_key
       from support_attachments
      where ticket_id is null and created_at < $1::timestamptz - make_interval(days => $2::int)
      order by created_at
      limit ${CLEANUP_BATCH}`,
    [now, UNLINKED_ATTACHMENT_DAYS]
  );
  for (const row of unlinked.rows) {
    try {
      await eraser.deleteObjects([row.storage_key]);
      // Doble comprobación: si entre medias se vinculó a una consulta, no se borra el registro.
      const deleted = await pool.query(`delete from support_attachments where id = $1 and ticket_id is null`, [row.id]);
      if ((deleted.rowCount ?? 0) > 0) result.attachments += 1;
    } catch (error) {
      log.error({ attachmentId: row.id, error: error instanceof Error ? error.name : "unknown" }, "could not clean unlinked support attachment");
    }
  }
  return result;
}

/** Ejecuta una pasada de todos los trabajos periódicos del módulo (exportaciones, caducidades, eliminaciones, limpieza). */
export async function runCommsJobsOnce(deps: DataRightsDeps, now: Date = new Date()): Promise<CommsJobsSummary> {
  const exports = await processQueuedDataExports(deps, now);
  const expired = await expireDataExports(deps, now);
  const deletions = await executeDueAccountDeletions(deps, now);
  const cleanup = await cleanupSupportUploads(deps, now);
  return { exports, expiredExports: expired.expired, deletions, cleanup };
}

export type CommsJobsHandle = { stop(): void };

/** Temporizador interno: sin solapamientos, sin retener el proceso al apagar y sin dejar escapar excepciones. */
export function startCommsJobs(deps: DataRightsDeps, intervalSeconds: number): CommsJobsHandle {
  if (intervalSeconds <= 0) return { stop() {} };
  const log = deps.log ?? silentLogger;
  let running = false;
  let stopped = false;
  const tick = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      await runCommsJobsOnce(deps);
    } catch (error) {
      log.error({ error: error instanceof Error ? error.name : "unknown" }, "comms jobs cycle failed");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    void tick();
  }, intervalSeconds * 1000);
  timer.unref();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    }
  };
}
