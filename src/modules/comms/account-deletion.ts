import type { Pool, PoolClient } from "pg";
import { writeAudit } from "../../lib/audit.js";
import { notify } from "../../lib/notify.js";
import { iso, isoOrNull, tx, type Queryable } from "./common.js";
import type { CommsConfig } from "./config.js";
import { silentLogger, type DataRightsDeps } from "./deps.js";
import { err } from "./errors.js";
import { getDeletionBlockerProviders, getErasureSteps, type DeletionBlocker } from "./registry.js";

export type AccountDeletionStatus = "scheduled" | "blocked" | "processing" | "completed" | "cancelled";

export type AccountDeletionRequestDto = {
  id: string;
  status: AccountDeletionStatus;
  requestedAt: string;
  scheduledFor: string;
  cancelledAt: string | null;
  completedAt: string | null;
  blockers: DeletionBlocker[];
};

export type AccountDeletionPlanDto = {
  deleted: string[];
  anonymised: string[];
  retained: Array<{ item: string; reason: string; period: string }>;
};

export type AccountDeletionStateDto = {
  eligible: boolean;
  blockers: DeletionBlocker[];
  graceDays: number;
  request: AccountDeletionRequestDto | null;
  plan: AccountDeletionPlanDto;
};

/**
 * Qué ocurre con los datos al eliminar la cuenta. Los plazos de conservación son una PROPUESTA pendiente de validación jurídica
 * (ver docs/contracts/comms.md §12); el texto se muestra tal cual en la pantalla de confirmación.
 */
export const DELETION_PLAN: AccountDeletionPlanDto = {
  deleted: [
    "Teléfono y sesiones abiertas",
    "Foto de perfil, selfie y documentos privados",
    "Vehículos (se anonimizan y la matrícula queda libre) y sus documentos",
    "Notificaciones, dispositivos push, ajustes y personas bloqueadas",
    "Contenido de tus mensajes de chat",
    "Texto e imágenes de tus consultas al centro de ayuda"
  ],
  anonymised: [
    "Tu nombre público pasa a «Usuario eliminado» en viajes y chats de otras personas",
    "Reservas y viajes pasados (se conservan sin vincularlos a ti)"
  ],
  retained: [
    { item: "Registros de pago y facturación", reason: "Obligación legal (fiscal y contable)", period: "6 años" },
    {
      item: "Denuncias presentadas o recibidas y su prueba",
      reason: "Seguridad de las personas usuarias y defensa de reclamaciones",
      period: "hasta 3 años desde su cierre"
    },
    {
      item: "Registro de auditoría de operaciones de seguridad (sin el contenido de los mensajes)",
      reason: "Seguridad e integridad del servicio",
      period: "hasta 3 años"
    }
  ]
};

const CONFIRMATION_WORD = "ELIMINAR";
const RETRY_AFTER_FAILURE_MINUTES = 10;

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function formatDateEs(date: Date): string {
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" }).format(date);
}

/* ───────────── Bloqueos ───────────── */

async function count(db: Queryable, sql: string, userId: string): Promise<number> {
  const result = await db.query<{ total: number }>(sql, [userId]);
  return result.rows[0]?.total ?? 0;
}

/** Condiciones que impiden eliminar la cuenta ahora: las de las tablas base y las que registra cada módulo. */
export async function collectDeletionBlockers(db: Queryable, userId: string): Promise<DeletionBlocker[]> {
  const blockers: DeletionBlocker[] = [];

  const activeTrips = await count(
    db,
    `select count(*)::int as total from trips
      where driver_user_id = $1 and (status = 'active' or (status = 'published' and (departure_at is null or departure_at >= now())))`,
    userId
  );
  if (activeTrips > 0) {
    blockers.push({
      code: "ACTIVE_TRIP_AS_DRIVER",
      count: activeTrips,
      message: `Tienes ${activeTrips} ${plural(activeTrips, "viaje publicado o en curso", "viajes publicados o en curso")} como conductor. Cancélalo o complétalo antes de eliminar la cuenta.`
    });
  }

  const upcoming = await count(
    db,
    `select count(*)::int as total
       from bookings b join ride_requests r on r.id = b.request_id join trips t on t.id = r.trip_id
      where r.passenger_user_id = $1 and b.status = 'confirmed' and t.status in ('published','active')`,
    userId
  );
  if (upcoming > 0) {
    blockers.push({
      code: "UPCOMING_BOOKING_AS_PASSENGER",
      count: upcoming,
      message: `Tienes ${upcoming} ${plural(upcoming, "reserva confirmada pendiente", "reservas confirmadas pendientes")} de realizar. Cancélala o complétala antes de eliminar la cuenta.`
    });
  }

  const openRequests = await count(
    db,
    `select count(*)::int as total
       from ride_requests r join trips t on t.id = r.trip_id
      where r.passenger_user_id = $1 and r.status in ('pending','accepted','payment_pending') and t.status in ('published','active')`,
    userId
  );
  if (openRequests > 0) {
    blockers.push({
      code: "OPEN_RIDE_REQUEST",
      count: openRequests,
      message: `Tienes ${openRequests} ${plural(openRequests, "solicitud de viaje en curso", "solicitudes de viaje en curso")}. Cancélala o espera a que se resuelva antes de eliminar la cuenta.`
    });
  }

  const compensations = await count(
    db,
    `select count(*)::int as total
       from payment_compensations pc join ride_requests r on r.id = pc.request_id
      where r.passenger_user_id = $1 and pc.status = 'pending'`,
    userId
  );
  if (compensations > 0) {
    blockers.push({
      code: "PENDING_PAYMENT_COMPENSATION",
      count: compensations,
      message: `Tienes ${compensations} ${plural(compensations, "reembolso o compensación de pago pendiente", "reembolsos o compensaciones de pago pendientes")}. Podrás eliminar la cuenta cuando se resuelva.`
    });
  }

  for (const provider of getDeletionBlockerProviders()) blockers.push(...(await provider.check(db, userId)));
  return blockers;
}

/* ───────────── Estado, solicitud y cancelación ───────────── */

type RequestRow = {
  id: string;
  user_id: string;
  status: AccountDeletionStatus;
  requested_at: Date;
  scheduled_for: Date;
  cancelled_at: Date | null;
  completed_at: Date | null;
  last_blockers: unknown;
  last_error: string | null;
  updated_at: Date;
};

const REQUEST_COLUMNS = `id, user_id, status, requested_at, scheduled_for, cancelled_at, completed_at, last_blockers, last_error, updated_at`;

function parseBlockers(value: unknown): DeletionBlocker[] {
  if (!Array.isArray(value)) return [];
  const out: DeletionBlocker[] = [];
  for (const item of value) {
    if (item && typeof item === "object") {
      const { code, message, count: total } = item as Record<string, unknown>;
      if (typeof code === "string" && typeof message === "string" && typeof total === "number") out.push({ code, message, count: total });
    }
  }
  return out;
}

function toRequestDto(row: RequestRow): AccountDeletionRequestDto {
  return {
    id: row.id,
    status: row.status,
    requestedAt: iso(row.requested_at),
    scheduledFor: iso(row.scheduled_for),
    cancelledAt: isoOrNull(row.cancelled_at),
    completedAt: isoOrNull(row.completed_at),
    blockers: parseBlockers(row.last_blockers)
  };
}

export async function getAccountDeletionState(db: Queryable, userId: string, config: CommsConfig): Promise<AccountDeletionStateDto> {
  const [blockers, latest] = await Promise.all([
    collectDeletionBlockers(db, userId),
    db.query<RequestRow>(
      `select ${REQUEST_COLUMNS} from account_deletion_requests where user_id = $1
        order by (status in ('scheduled','blocked','processing')) desc, requested_at desc limit 1`,
      [userId]
    )
  ]);
  const row = latest.rows[0];
  return {
    eligible: blockers.length === 0,
    blockers,
    graceDays: config.accountDeletionGraceDays,
    request: row ? toRequestDto(row) : null,
    plan: DELETION_PLAN
  };
}

export async function requestAccountDeletion(
  pool: Pool,
  userId: string,
  input: { confirmation: string; reason?: string | undefined },
  config: CommsConfig,
  requestId?: string | null
): Promise<{ state: AccountDeletionStateDto; created: boolean }> {
  if (input.confirmation !== CONFIRMATION_WORD) {
    throw err("ACCOUNT_DELETION_CONFIRMATION_REQUIRED", 422, `Para confirmar, escribe exactamente «${CONFIRMATION_WORD}».`);
  }
  const reason = input.reason?.trim() ? input.reason.trim().slice(0, 500) : null;
  const created = await tx(pool, async client => {
    await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`account_deletion:${userId}`]);
    const active = await client.query(
      `select 1 from account_deletion_requests where user_id = $1 and status in ('scheduled','blocked','processing') limit 1`,
      [userId]
    );
    if ((active.rowCount ?? 0) > 0) return false;

    const blockers = await collectDeletionBlockers(client, userId);
    if (blockers.length > 0) {
      throw err("ACCOUNT_DELETION_BLOCKED", 409, "Ahora mismo no podemos programar la eliminación de tu cuenta: tienes asuntos pendientes.", { blockers });
    }
    const inserted = await client.query<{ id: string; scheduled_for: Date }>(
      `insert into account_deletion_requests(user_id, reason, scheduled_for)
       values ($1, $2, now() + ($3 || ' days')::interval)
       returning id, scheduled_for`,
      [userId, reason, String(config.accountDeletionGraceDays)]
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("account deletion insert returned no row");
    await notify(client, {
      userId,
      category: "system",
      kind: "account_deletion_scheduled",
      title: "Eliminación de cuenta programada",
      body: `Eliminaremos tu cuenta el ${formatDateEs(row.scheduled_for)}. Puedes cancelarlo antes desde Ajustes.`,
      data: { requestId: row.id }
    });
    await writeAudit(client, {
      actorUserId: userId,
      action: "account.deletion.requested",
      entityType: "account_deletion_request",
      entityId: row.id,
      requestId: requestId ?? null,
      metadata: { scheduledFor: row.scheduled_for.toISOString(), graceDays: config.accountDeletionGraceDays }
    });
    return true;
  });
  return { state: await getAccountDeletionState(pool, userId, config), created };
}

export async function cancelAccountDeletion(
  pool: Pool,
  userId: string,
  config: CommsConfig,
  requestId?: string | null
): Promise<AccountDeletionStateDto> {
  await tx(pool, async client => {
    const active = await client.query<RequestRow>(
      `select ${REQUEST_COLUMNS} from account_deletion_requests
        where user_id = $1 and status in ('scheduled','blocked','processing') for update`,
      [userId]
    );
    const row = active.rows[0];
    if (!row) throw err("ACCOUNT_DELETION_NOT_FOUND", 404, "No tienes ninguna eliminación de cuenta programada.");
    if (row.status === "processing") {
      throw err("ACCOUNT_DELETION_IN_PROGRESS", 409, "La eliminación de tu cuenta ya está en curso y no se puede cancelar.");
    }
    await client.query(`update account_deletion_requests set status = 'cancelled', cancelled_at = now(), updated_at = now() where id = $1`, [row.id]);
    await notify(client, {
      userId,
      category: "system",
      kind: "account_deletion_cancelled",
      title: "Eliminación de cuenta cancelada",
      body: "Hemos cancelado la eliminación de tu cuenta. Todo sigue como antes.",
      data: { requestId: row.id }
    });
    await writeAudit(client, {
      actorUserId: userId,
      action: "account.deletion.cancelled",
      entityType: "account_deletion_request",
      entityId: row.id,
      requestId: requestId ?? null
    });
  });
  return getAccountDeletionState(pool, userId, config);
}

/* ───────────── Ejecución ───────────── */

async function collectStorageKeys(db: Queryable, userId: string): Promise<string[]> {
  const keys = new Set<string>();
  const add = (rows: Array<{ key: string | null }>) => {
    for (const row of rows) if (row.key) keys.add(row.key);
  };
  add((await db.query<{ key: string | null }>(`select storage_key as key from private_documents where owner_user_id = $1`, [userId])).rows);
  add((await db.query<{ key: string | null }>(`select storage_key as key from private_upload_intents where owner_user_id = $1`, [userId])).rows);
  add((await db.query<{ key: string | null }>(`select storage_key as key from support_attachments where owner_user_id = $1`, [userId])).rows);
  add((await db.query<{ key: string | null }>(`select storage_key as key from support_upload_intents where owner_user_id = $1`, [userId])).rows);
  add((await db.query<{ key: string | null }>(`select storage_key as key from data_export_requests where user_id = $1`, [userId])).rows);
  add(
    (
      await db.query<{ key: string | null }>(
        `select unnest(array[private_selfie_key, public_photo_key]) as key from profiles where user_id = $1`,
        [userId]
      )
    ).rows
  );
  for (const step of getErasureSteps()) {
    if (step.storageKeys) for (const key of await step.storageKeys(db, userId)) keys.add(key);
  }
  return [...keys];
}

async function affected(db: Queryable, sql: string, params: unknown[]): Promise<number> {
  const result = await db.query(sql, params);
  return result.rowCount ?? 0;
}

/** Borra/anonimiza los datos de la persona dentro de la transacción y devuelve los recuentos (sin datos personales). */
async function anonymiseAccount(client: PoolClient, userId: string): Promise<Record<string, number>> {
  const summary: Record<string, number> = {};
  const phoneRow = await client.query<{ phone_e164: string | null }>(`select phone_e164 from app_users where id = $1`, [userId]);
  const phone = phoneRow.rows[0]?.phone_e164 ?? null;

  summary.sessionsRevoked = await affected(client, `update auth_sessions set revoked_at = now() where user_id = $1 and revoked_at is null`, [userId]);
  if (phone) summary.authChallengesDeleted = await affected(client, `delete from auth_challenges where phone_e164 = $1`, [phone]);

  // Documentos y vehículos (los objetos del almacenamiento ya se han borrado antes de llegar aquí).
  await client.query(`update vehicles set vehicle_photo_document_id = null, insurance_document_id = null where driver_user_id = $1`, [userId]);
  summary.documentsDeleted = await affected(client, `delete from private_documents where owner_user_id = $1`, [userId]);
  summary.uploadIntentsDeleted = await affected(client, `delete from private_upload_intents where owner_user_id = $1`, [userId]);
  summary.vehiclesAnonymised = await affected(
    client,
    `update vehicles
        set make = 'Eliminado', model = 'Eliminado', plate = 'ELIM-' || substr(replace(id::text, '-', ''), 1, 12),
            insurance_expires_on = null, updated_at = now()
      where driver_user_id = $1`,
    [userId]
  );

  summary.profilesAnonymised = await affected(
    client,
    `update profiles
        set display_name = null, public_photo_key = null, public_photo_status = 'pending', private_selfie_key = null,
            identity_status = 'unverified', presence_status = null, updated_at = now()
      where user_id = $1`,
    [userId]
  );

  summary.notificationsDeleted = await affected(client, `delete from notifications where user_id = $1`, [userId]);
  await client.query(`delete from notification_preferences where user_id = $1`, [userId]);
  summary.pushTokensDeleted = await affected(client, `delete from push_tokens where user_id = $1`, [userId]);
  await client.query(`delete from user_settings where user_id = $1`, [userId]);
  summary.blocksDeleted = await affected(client, `delete from user_blocks where blocker_user_id = $1`, [userId]);

  // Mensajes: se borra el CONTENIDO; las filas se conservan para que el hilo de la otra persona no se rompa.
  summary.directMessagesErased = await affected(
    client,
    `update trip_direct_messages
        set body = '[Mensaje eliminado]', kind = 'text', location_lat = null, location_lng = null, location_label = null
      where sender_user_id = $1 and body <> '[Mensaje eliminado]'`,
    [userId]
  );
  summary.groupMessagesErased = await affected(
    client,
    `update chat_group_messages
        set body = '[Mensaje eliminado]', kind = 'text', location_lat = null, location_lng = null, location_label = null
      where sender_user_id = $1 and body <> '[Mensaje eliminado]'`,
    [userId]
  );
  await client.query(`delete from chat_participants where user_id = $1`, [userId]);

  // Centro de ayuda: se borra el texto del usuario y los adjuntos; el registro (referencia, categoría, fechas) se conserva cerrado.
  summary.supportMessagesErased = await affected(
    client,
    `update support_ticket_messages set body = '[Mensaje eliminado]'
      where author_type = 'user' and ticket_id in (select id from support_tickets where user_id = $1)`,
    [userId]
  );
  summary.supportTicketsClosed = await affected(
    client,
    `update support_tickets
        set body = '[Consulta eliminada]', status = 'closed', closed_at = coalesce(closed_at, now()),
            closed_by = coalesce(closed_by, 'user'), idempotency_key = null
      where user_id = $1`,
    [userId]
  );
  summary.supportAttachmentsDeleted = await affected(client, `delete from support_attachments where owner_user_id = $1`, [userId]);
  await client.query(`delete from support_upload_intents where owner_user_id = $1`, [userId]);

  summary.exportsRetired = await affected(
    client,
    `update data_export_requests
        set status = case when status in ('queued','processing') then 'failed' when status = 'ready' then 'expired' else status end,
            error_code = case when status in ('queued','processing') then 'ACCOUNT_DELETED' else error_code end,
            storage_provider = null, storage_key = null, size_bytes = null, sha256 = null, updated_at = now()
      where user_id = $1`,
    [userId]
  );

  for (const step of getErasureSteps()) {
    const counts = await step.run(client, userId);
    if (counts) for (const [key, value] of Object.entries(counts)) summary[`${step.name}.${key}`] = value;
  }

  await client.query(`delete from user_roles where user_id = $1`, [userId]);
  summary.userAnonymised = await affected(client, `update app_users set status = 'deleted', phone_e164 = null, updated_at = now() where id = $1`, [userId]);
  return summary;
}

type ProcessOutcome = { outcome: "completed" | "blocked" | "failed" | "idle"; requestId: string | null };

async function processOneDeletion(deps: DataRightsDeps, now: Date, exclude: string[]): Promise<ProcessOutcome> {
  const { pool } = deps;
  const log = deps.log ?? silentLogger;
  const client = await pool.connect();
  let claimedId: string | null = null;
  try {
    await client.query("begin");
    const claimed = await client.query<RequestRow>(
      `select ${REQUEST_COLUMNS} from account_deletion_requests
        where status in ('scheduled','blocked','processing') and scheduled_for <= $1
          and (last_error is null or updated_at < $1::timestamptz - ($2 || ' minutes')::interval)
          and id <> all($3::uuid[])
        order by scheduled_for
        for update skip locked
        limit 1`,
      [now, String(RETRY_AFTER_FAILURE_MINUTES), exclude]
    );
    const request = claimed.rows[0];
    if (!request) {
      await client.query("rollback");
      return { outcome: "idle", requestId: null };
    }
    claimedId = request.id;
    const userId = request.user_id;

    const blockers = await collectDeletionBlockers(client, userId);
    if (blockers.length > 0) {
      const previous = parseBlockers(request.last_blockers).map(b => b.code).sort().join(",");
      const current = blockers.map(b => b.code).sort().join(",");
      await client.query(
        `update account_deletion_requests set status = 'blocked', last_blockers = $2::jsonb, last_error = null, updated_at = now() where id = $1`,
        [request.id, JSON.stringify(blockers)]
      );
      if (request.status !== "blocked" || previous !== current) {
        await notify(client, {
          userId,
          category: "system",
          kind: "account_deletion_blocked",
          title: "Todavía no podemos eliminar tu cuenta",
          body: "Tienes viajes, reservas o pagos pendientes. Cuando se resuelvan, reintentaremos la eliminación automáticamente.",
          data: { requestId: request.id, blockers: blockers.map(b => b.code) }
        });
        await writeAudit(client, {
          actorUserId: null,
          action: "account.deletion.blocked",
          entityType: "account_deletion_request",
          entityId: request.id,
          metadata: { userId, blockers: blockers.map(b => ({ code: b.code, count: b.count })) }
        });
      }
      await client.query("commit");
      return { outcome: "blocked", requestId: request.id };
    }

    const keys = await collectStorageKeys(client, userId);
    if (keys.length > 0) {
      if (!deps.eraser) {
        throw new Error("STORAGE_UNAVAILABLE");
      }
      await deps.eraser.deleteObjects(keys);
    }
    const summary = await anonymiseAccount(client, userId);
    summary.storageObjectsDeleted = keys.length;
    await client.query(
      `update account_deletion_requests
          set status = 'completed', completed_at = now(), reason = null, last_blockers = '[]'::jsonb, last_error = null,
              erasure_summary = $2::jsonb, updated_at = now()
        where id = $1`,
      [request.id, JSON.stringify(summary)]
    );
    await writeAudit(client, {
      actorUserId: null,
      action: "account.deletion.completed",
      entityType: "account_deletion_request",
      entityId: request.id,
      metadata: { userId, summary }
    });
    await client.query("commit");
    return { outcome: "completed", requestId: request.id };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    const code = error instanceof Error && /^[A-Z0-9_]{3,60}$/.test(error.message) ? error.message : "DELETION_FAILED";
    log.error({ requestId: claimedId, errorCode: code }, "account deletion failed");
    if (claimedId) {
      // La ventana de espera tras un fallo se mide con el mismo reloj que usa la pasada para decidir qué está vencido.
      await pool
        .query(`update account_deletion_requests set status = 'processing', last_error = $2, updated_at = $3::timestamptz where id = $1`, [claimedId, code, now])
        .catch(() => undefined);
    }
    return { outcome: "failed", requestId: claimedId };
  } finally {
    client.release();
  }
}

/** Ejecuta las eliminaciones vencidas (seguro con varias réplicas). Una solicitud con bloqueos pasa a `blocked` y se reevalúa en el siguiente ciclo. */
export async function executeDueAccountDeletions(
  deps: DataRightsDeps,
  now: Date = new Date()
): Promise<{ processed: number; completed: number; blocked: number; failed: number }> {
  const summary = { processed: 0, completed: 0, blocked: 0, failed: 0 };
  const exclude: string[] = [];
  for (let guard = 0; guard < 50; guard += 1) {
    const { outcome, requestId } = await processOneDeletion(deps, now, exclude);
    if (outcome === "idle") break;
    summary.processed += 1;
    if (outcome === "completed") summary.completed += 1;
    else if (outcome === "blocked") summary.blocked += 1;
    else summary.failed += 1;
    // Una bloqueada o fallida volvería a salir en esta misma pasada: se aparta hasta el siguiente ciclo.
    if (requestId && outcome !== "completed") exclude.push(requestId);
  }
  return summary;
}
