import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AuthPrincipal } from "../../auth/session.js";
import { DomainError } from "../../errors.js";
import { writeAudit } from "../../lib/audit.js";
import type { PrivateObjectStorage } from "../../storage/private-object-storage.js";
import { tx, type Db } from "./common.js";
import { liveSettings, MAX_INCIDENT_ATTACHMENTS, MAX_INCIDENT_ATTACHMENT_BYTES } from "./config.js";
import type {
  LiveCreateIncidentBody, LiveIncidentAttachment, LiveIncidentAttachmentIntent, LiveIncidentAttachmentIntentBody,
  LiveIncidentCategory, LiveIncidentReport, LiveIncidentStatus, LiveRating
} from "./types.js";

/* ───────────────────────────── Valoraciones ───────────────────────────── */

export type CreateRatingInput = { rateeUserId: string; stars: number; comment?: string | undefined };

function normalizeText(value: string | undefined, max: number, code: string): string | null {
  if (value === undefined) return null;
  const text = value.trim();
  if (text.length === 0) return null;
  if (text.length > max) throw new DomainError(code, `The text must have at most ${max} characters`, 400);
  return text;
}

/**
 * Una valoración por (viaje, quien valora, valorado), solo con el viaje `completed` y dentro de `LIVE_RATING_WINDOW_DAYS`.
 *  - el pasajero (reserva `completed`) valora al conductor;
 *  - el conductor valora a cada pasajero con reserva `completed`.
 * El agregado se actualiza en la MISMA transacción (profiles.rating_sum / rating_count).
 */
export async function createRating(
  pool: Pool, principal: AuthPrincipal, tripId: string, input: CreateRatingInput, now: Date = new Date()
): Promise<LiveRating> {
  if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) {
    throw new DomainError("RATING_INVALID_STARS", "stars must be an integer between 1 and 5", 400);
  }
  const comment = normalizeText(input.comment, 500, "RATING_COMMENT_TOO_LONG");
  const settings = liveSettings();

  return tx(pool, async client => {
    const trip = (await client.query<{ status: string; driver_user_id: string; completed_at: Date | null }>(
      `select status, driver_user_id, completed_at from trips where id=$1`, [tripId]
    )).rows[0];
    if (!trip) throw new DomainError("TRIP_NOT_FOUND", "Trip not found", 404);

    const isDriver = trip.driver_user_id === principal.userId;
    let raterRole: "driver" | "passenger" = "driver";
    let bookingId: string | null = null;

    if (isDriver) {
      if (input.rateeUserId === principal.userId) {
        throw new DomainError("RATING_INVALID_RATEE", "You cannot rate yourself", 422);
      }
    } else {
      raterRole = "passenger";
      const mine = (await client.query<{ id: string; status: string }>(
        `select b.id, b.status from bookings b join ride_requests r on r.id=b.request_id
          where r.trip_id=$1 and r.passenger_user_id=$2
          order by (b.status='completed') desc, b.created_at desc`,
        [tripId, principal.userId]
      )).rows;
      if (mine.length === 0) {
        throw new DomainError("RATING_NOT_PARTICIPANT", "Only the driver or a passenger of this trip can rate", 403);
      }
      if (trip.status === "completed" && mine[0]?.status !== "completed") {
        throw new DomainError("RATING_BOOKING_NOT_COMPLETED", "Only a passenger who completed the ride can rate", 409);
      }
      bookingId = mine[0]?.id ?? null;
    }

    if (trip.status !== "completed" || !trip.completed_at) {
      throw new DomainError("RATING_TRIP_NOT_COMPLETED", "The trip can only be rated once it has finished", 409);
    }

    if (isDriver) {
      const passenger = (await client.query<{ id: string }>(
        `select b.id from bookings b join ride_requests r on r.id=b.request_id
          where r.trip_id=$1 and r.passenger_user_id=$2 and b.status='completed' limit 1`,
        [tripId, input.rateeUserId]
      )).rows[0];
      if (!passenger) {
        throw new DomainError("RATING_INVALID_RATEE", "You can only rate passengers who completed this trip", 422);
      }
      bookingId = passenger.id;
    } else if (input.rateeUserId !== trip.driver_user_id) {
      throw new DomainError("RATING_INVALID_RATEE", "A passenger can only rate the driver of the trip", 422);
    }

    const windowEnd = new Date(trip.completed_at.getTime() + settings.ratingWindowDays * 86_400_000);
    if (now.getTime() > windowEnd.getTime()) {
      throw new DomainError("RATING_WINDOW_CLOSED", "The rating window for this trip has closed", 409, {
        windowEndsAt: windowEnd.toISOString()
      });
    }

    let row: { id: string; created_at: Date };
    try {
      const inserted = await client.query<{ id: string; created_at: Date }>(
        `insert into trip_ratings(trip_id, booking_id, rater_user_id, ratee_user_id, rater_role, stars, comment, created_at)
         values($1,$2,$3,$4,$5,$6,$7,$8)
         returning id, created_at`,
        [tripId, bookingId, principal.userId, input.rateeUserId, raterRole, input.stars, comment, now]
      );
      const first = inserted.rows[0];
      if (!first) throw new Error("rating insert returned no row");
      row = first;
    } catch (error: unknown) {
      if ((error as { code?: string }).code === "23505") {
        throw new DomainError("RATING_ALREADY_SUBMITTED", "You already rated this person for this trip", 409);
      }
      throw error;
    }

    await client.query(
      `insert into profiles(user_id, rating_sum, rating_count) values($1,$2,1)
       on conflict (user_id) do update
         set rating_sum = profiles.rating_sum + excluded.rating_sum,
             rating_count = profiles.rating_count + 1,
             updated_at = now()`,
      [input.rateeUserId, input.stars]
    );
    await writeAudit(client, {
      actorUserId: principal.userId, action: "rating.created", entityType: "trip_rating", entityId: row.id,
      metadata: { tripId, rateeUserId: input.rateeUserId, stars: input.stars, raterRole }
    });

    return {
      id: row.id, tripId, raterUserId: principal.userId, rateeUserId: input.rateeUserId,
      stars: input.stars, comment, createdAt: row.created_at.toISOString()
    };
  });
}

/* ───────────────────────────── Incidencias ───────────────────────────── */

type IncidentRow = {
  id: string;
  trip_id: string;
  booking_id: string | null;
  category: LiveIncidentCategory;
  description: string;
  status: LiveIncidentStatus;
  reporter_role: "driver" | "passenger";
  created_at: Date;
  updated_at: Date;
  cursor_ts?: string;
};

const INCIDENT_COLUMNS = `r.id, r.trip_id, r.booking_id, r.category, r.description, r.status, r.reporter_role, r.created_at, r.updated_at`;

const ALLOWED_ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif"
};

async function loadAttachments(db: Db, reportIds: string[], now: Date): Promise<Map<string, LiveIncidentAttachment[]>> {
  const result = new Map<string, LiveIncidentAttachment[]>();
  if (reportIds.length === 0) return result;
  const rows = (await db.query<{
    id: string; report_id: string; content_type: string; size_bytes: string; status: "pending" | "uploaded"; created_at: Date;
  }>(
    `select id, report_id, content_type, coalesce(size_bytes, expected_size_bytes) as size_bytes, status, created_at
       from incident_attachments
      where report_id = any($1::uuid[]) and (status='uploaded' or expires_at > $2)
      order by created_at, id`,
    [reportIds, now]
  )).rows;
  for (const row of rows) {
    const list = result.get(row.report_id) ?? [];
    list.push({
      id: row.id, contentType: row.content_type, sizeBytes: Number(row.size_bytes),
      status: row.status, createdAt: row.created_at.toISOString()
    });
    result.set(row.report_id, list);
  }
  return result;
}

function toIncident(row: IncidentRow, attachments: LiveIncidentAttachment[]): LiveIncidentReport {
  return {
    id: row.id,
    tripId: row.trip_id,
    bookingId: row.booking_id,
    category: row.category,
    description: row.description,
    status: row.status,
    reporterRole: row.reporter_role,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    attachments
  };
}

async function viewIncident(db: Db, row: IncidentRow, now: Date): Promise<LiveIncidentReport> {
  const attachments = await loadAttachments(db, [row.id], now);
  return toIncident(row, attachments.get(row.id) ?? []);
}

export async function createIncident(
  pool: Pool,
  principal: AuthPrincipal,
  input: LiveCreateIncidentBody,
  idempotencyKey: string | undefined,
  now: Date = new Date()
): Promise<{ view: LiveIncidentReport; created: boolean }> {
  const description = input.description.trim();
  if (description.length < 10 || description.length > 2000) {
    throw new DomainError("INCIDENT_DESCRIPTION_INVALID", "The description must have between 10 and 2000 characters", 400);
  }

  if (idempotencyKey) {
    const existing = (await pool.query<IncidentRow>(
      `select ${INCIDENT_COLUMNS} from incident_reports r where r.reporter_user_id=$1 and r.idempotency_key=$2`,
      [principal.userId, idempotencyKey]
    )).rows[0];
    if (existing) {
      if (existing.trip_id !== input.tripId) {
        throw new DomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was already used for a different report", 409);
      }
      return { view: await viewIncident(pool, existing, now), created: false };
    }
  }

  const trip = (await pool.query<{ status: string; driver_user_id: string; route_version: number }>(
    `select status, driver_user_id, route_version from trips where id=$1`, [input.tripId]
  )).rows[0];
  if (!trip) throw new DomainError("TRIP_NOT_FOUND", "Trip not found", 404);

  const isDriver = trip.driver_user_id === principal.userId;
  let bookingId: string | null = null;
  let bookingStatus: string | null = null;
  if (isDriver) {
    if (input.bookingId) {
      const booking = (await pool.query<{ id: string; status: string }>(
        `select b.id, b.status from bookings b join ride_requests r on r.id=b.request_id
          where b.id=$1 and r.trip_id=$2`,
        [input.bookingId, input.tripId]
      )).rows[0];
      if (!booking) {
        throw new DomainError("INCIDENT_BOOKING_MISMATCH", "The booking does not belong to this trip", 422);
      }
      bookingId = booking.id;
      bookingStatus = booking.status;
    }
  } else {
    const mine = (await pool.query<{ id: string; status: string }>(
      `select b.id, b.status from bookings b join ride_requests r on r.id=b.request_id
        where r.trip_id=$1 and r.passenger_user_id=$2
        order by b.created_at desc, b.id`,
      [input.tripId, principal.userId]
    )).rows;
    if (mine.length === 0) {
      throw new DomainError("INCIDENT_NOT_PARTICIPANT", "Only participants of the trip can report an incident", 403);
    }
    const chosen = input.bookingId ? mine.find(b => b.id === input.bookingId) : mine[0];
    if (!chosen) {
      throw new DomainError("INCIDENT_BOOKING_MISMATCH", "The booking is not yours or does not belong to this trip", 422);
    }
    bookingId = chosen.id;
    bookingStatus = chosen.status;
  }

  const role: "driver" | "passenger" = isDriver ? "driver" : "passenger";
  const context = { tripStatus: trip.status, bookingStatus, routeVersion: trip.route_version };

  const row = await tx(pool, async client => {
    const inserted = await client.query<IncidentRow>(
      `insert into incident_reports as r(
         reporter_user_id, reporter_role, trip_id, booking_id, category, description, context, idempotency_key,
         created_at, updated_at
       ) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$9)
       on conflict (reporter_user_id, idempotency_key) where idempotency_key is not null do nothing
       returning ${INCIDENT_COLUMNS}`,
      [
        principal.userId, role, input.tripId, bookingId, input.category, description, JSON.stringify(context),
        idempotencyKey ?? null, now
      ]
    );
    const created = inserted.rows[0];
    if (!created) return null;
    await writeAudit(client, {
      actorUserId: principal.userId, action: "incident.created", entityType: "incident_report", entityId: created.id,
      metadata: { tripId: input.tripId, bookingId, category: input.category, reporterRole: role }
    });
    return created;
  });

  if (!row) {
    // Carrera de idempotencia: otro hilo insertó la misma clave entre la comprobación y el insert.
    const winner = (await pool.query<IncidentRow>(
      `select ${INCIDENT_COLUMNS} from incident_reports r where r.reporter_user_id=$1 and r.idempotency_key=$2`,
      [principal.userId, idempotencyKey]
    )).rows[0];
    if (!winner) throw new Error("incident idempotency conflict without existing row");
    if (winner.trip_id !== input.tripId) {
      throw new DomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was already used for a different report", 409);
    }
    return { view: await viewIncident(pool, winner, now), created: false };
  }
  return { view: toIncident(row, []), created: true };
}

function encodeCursor(timestamp: string, id: string): string {
  return Buffer.from(JSON.stringify({ t: timestamp, id }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { t: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { t?: unknown; id?: unknown };
    if (typeof parsed.t !== "string" || typeof parsed.id !== "string"
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(parsed.t)
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.id)) {
      throw new Error("bad cursor");
    }
    return { t: parsed.t, id: parsed.id };
  } catch {
    throw new DomainError("INVALID_CURSOR", "The pagination cursor is not valid", 400);
  }
}

export async function listMyIncidents(
  pool: Pool, userId: string, query: { cursor?: string | undefined; limit?: number | undefined }, now: Date = new Date()
): Promise<{ items: LiveIncidentReport[]; nextCursor: string | null }> {
  const limit = Math.min(50, Math.max(1, query.limit ?? 20));
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const rows = (await pool.query<IncidentRow & { cursor_ts: string }>(
    `select ${INCIDENT_COLUMNS},
            to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_ts
       from incident_reports r
      where r.reporter_user_id=$1
        and ($2::timestamptz is null or (r.created_at, r.id) < ($2::timestamptz, $3::uuid))
      order by r.created_at desc, r.id desc
      limit $4`,
    [userId, cursor ? cursor.t : null, cursor ? cursor.id : null, limit + 1]
  )).rows;
  const page = rows.slice(0, limit);
  const attachments = await loadAttachments(pool, page.map(r => r.id), now);
  const last = page[page.length - 1];
  return {
    items: page.map(r => toIncident(r, attachments.get(r.id) ?? [])),
    nextCursor: rows.length > limit && last ? encodeCursor(last.cursor_ts ?? last.created_at.toISOString(), last.id) : null
  };
}

async function ownedIncident(db: Db, userId: string, reportId: string): Promise<IncidentRow> {
  const row = (await db.query<IncidentRow>(
    `select ${INCIDENT_COLUMNS} from incident_reports r where r.id=$1 and r.reporter_user_id=$2`, [reportId, userId]
  )).rows[0];
  if (!row) throw new DomainError("INCIDENT_NOT_FOUND", "Incident report not found", 404);
  return row;
}

export async function getMyIncident(
  pool: Pool, userId: string, reportId: string, now: Date = new Date()
): Promise<LiveIncidentReport> {
  return viewIncident(pool, await ownedIncident(pool, userId, reportId), now);
}

/* ───────────────────────────── Adjuntos privados ───────────────────────────── */

/** El SDK de S3 lanza `NotFound` (HEAD) o `NoSuchKey` (GET) cuando el objeto aún no existe. */
function isMissingObject(error: unknown): boolean {
  const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return err.name === "NotFound" || err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404;
}

function requireStorage(storage: PrivateObjectStorage | null): PrivateObjectStorage {
  if (!storage) throw new DomainError("PRIVATE_STORAGE_NOT_CONFIGURED", "Private file storage is not configured", 503);
  return storage;
}

export async function createIncidentAttachmentIntent(
  pool: Pool,
  principal: AuthPrincipal,
  storage: PrivateObjectStorage | null,
  ttlSeconds: number,
  reportId: string,
  input: LiveIncidentAttachmentIntentBody,
  now: Date = new Date()
): Promise<LiveIncidentAttachmentIntent> {
  const store = requireStorage(storage);
  if (!(ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(input.contentType)) {
    throw new DomainError("INCIDENT_ATTACHMENT_TYPE", "Only images (JPEG, PNG, WebP, HEIC) can be attached", 422);
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_INCIDENT_ATTACHMENT_BYTES) {
    throw new DomainError("INCIDENT_ATTACHMENT_SIZE", "The image must weigh between 1 byte and 10 MiB", 422);
  }

  const attachmentId = randomUUID();
  const key = ["users", principal.userId, "incidents", reportId, `${attachmentId}.${EXTENSIONS[input.contentType] ?? "bin"}`].join("/");

  // Reserva el cupo dentro de la transacción (bloqueando la incidencia) para que el límite sea exacto.
  return tx(pool, async client => {
    const report = (await client.query<{ status: LiveIncidentStatus }>(
      `select status from incident_reports where id=$1 and reporter_user_id=$2 for update`, [reportId, principal.userId]
    )).rows[0];
    if (!report) throw new DomainError("INCIDENT_NOT_FOUND", "Incident report not found", 404);
    if (report.status === "resolved" || report.status === "dismissed") {
      throw new DomainError("INCIDENT_CLOSED", "This incident is closed and cannot receive more files", 409);
    }
    const count = (await client.query<{ n: number }>(
      `select count(*)::int as n from incident_attachments
        where report_id=$1 and (status='uploaded' or expires_at > $2)`, [reportId, now]
    )).rows[0]?.n ?? 0;
    if (count >= MAX_INCIDENT_ATTACHMENTS) {
      throw new DomainError("INCIDENT_ATTACHMENT_LIMIT", `An incident accepts at most ${MAX_INCIDENT_ATTACHMENTS} files`, 409);
    }

    const signed = await store.createUploadUrl({ key, contentType: input.contentType, expiresInSeconds: ttlSeconds });
    await client.query(
      `insert into incident_attachments(
         id, report_id, owner_user_id, storage_provider, storage_key, content_type, expected_size_bytes, status,
         expires_at, created_at
       ) values($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9)`,
      [attachmentId, reportId, principal.userId, store.providerName, key, input.contentType, input.sizeBytes, signed.expiresAt, now]
    );
    return { attachmentId, uploadUrl: signed.url, headers: signed.headers, expiresAt: signed.expiresAt };
  });
}

export async function completeIncidentAttachment(
  pool: Pool,
  principal: AuthPrincipal,
  storage: PrivateObjectStorage | null,
  reportId: string,
  attachmentId: string,
  now: Date = new Date()
): Promise<LiveIncidentAttachment> {
  const store = requireStorage(storage);
  await ownedIncident(pool, principal.userId, reportId);

  const row = (await pool.query<{
    id: string; storage_provider: string; storage_key: string; content_type: string; expected_size_bytes: string;
    size_bytes: string | null; status: "pending" | "uploaded"; expires_at: Date; created_at: Date;
  }>(
    `select id, storage_provider, storage_key, content_type, expected_size_bytes, size_bytes, status, expires_at, created_at
       from incident_attachments where id=$1 and report_id=$2 and owner_user_id=$3`,
    [attachmentId, reportId, principal.userId]
  )).rows[0];
  if (!row) throw new DomainError("INCIDENT_ATTACHMENT_NOT_FOUND", "Attachment not found", 404);

  const expected = Number(row.expected_size_bytes);
  if (row.status === "uploaded") {
    return {
      id: row.id, contentType: row.content_type, sizeBytes: Number(row.size_bytes ?? expected),
      status: "uploaded", createdAt: row.created_at.toISOString()
    };
  }
  if (row.expires_at.getTime() < now.getTime()) {
    throw new DomainError("INCIDENT_ATTACHMENT_EXPIRED", "The upload window has expired; request a new upload", 410);
  }
  if (row.storage_provider !== store.providerName) {
    throw new DomainError("INCIDENT_ATTACHMENT_MISMATCH", "Storage provider mismatch for this attachment", 422);
  }

  let sizeBytes: number;
  let sha256: string;
  try {
    const info = await store.headObject(row.storage_key);
    if (info.sizeBytes !== expected) {
      throw new DomainError("INCIDENT_ATTACHMENT_MISMATCH", "The uploaded file size does not match the declared size", 422, {
        expected, actual: info.sizeBytes
      });
    }
    if (info.contentType && info.contentType.split(";")[0] !== row.content_type) {
      throw new DomainError("INCIDENT_ATTACHMENT_MISMATCH", "The uploaded file type does not match the declared type", 422);
    }
    const bytes = await store.readObject(row.storage_key, MAX_INCIDENT_ATTACHMENT_BYTES);
    if (bytes.byteLength !== expected) {
      throw new DomainError("INCIDENT_ATTACHMENT_MISMATCH", "The uploaded file byte count is invalid", 422);
    }
    sizeBytes = bytes.byteLength;
    sha256 = createHash("sha256").update(bytes).digest("hex");
  } catch (error: unknown) {
    if (error instanceof DomainError) throw error;
    if (isMissingObject(error)) {
      throw new DomainError("INCIDENT_ATTACHMENT_MISMATCH", "The file has not been uploaded yet", 422);
    }
    throw error;
  }

  await pool.query(
    `update incident_attachments set status='uploaded', size_bytes=$2, sha256=$3, completed_at=$4 where id=$1`,
    [attachmentId, sizeBytes, sha256, now]
  );
  await writeAudit(pool, {
    actorUserId: principal.userId, action: "incident.attachment_uploaded", entityType: "incident_attachment",
    entityId: attachmentId, metadata: { reportId, sizeBytes }
  });
  return { id: row.id, contentType: row.content_type, sizeBytes, status: "uploaded", createdAt: row.created_at.toISOString() };
}
