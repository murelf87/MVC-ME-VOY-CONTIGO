import crypto from "node:crypto";
import type { Pool } from "pg";
import { writeAudit } from "../../lib/audit.js";
import type { PrivateObjectStorage } from "../../storage/private-object-storage.js";
import { loadTripLabels, type TripStatusCode } from "./chat-inbox.js";
import {
  containsNul,
  decodeTimeIdCursor,
  encodeCursor,
  iso,
  isoOrNull,
  loadPublicUsers,
  pageLimit,
  truncate,
  tsUs,
  tx,
  type Queryable
} from "./common.js";
import type { CommsConfig } from "./config.js";
import { err } from "./errors.js";
import { involvedInTrip } from "./moderation.js";

export type SupportCategory = "trip_issue" | "payment_issue" | "account_profile";
export type SupportTicketStatus = "open" | "answered" | "closed";

export const SUPPORT_LIMITS = {
  /** Texto de la consulta («0/500» de la pantalla 35). */
  ticketBody: 500,
  replyBody: 1000,
  attachmentsPerMessage: 4,
  imageMaxBytes: 10 * 1024 * 1024,
  openTickets: 10,
  ticketsPerDay: 5,
  repliesPerTicketPerDay: 20,
  unlinkedAttachments: 12
} as const;

export const SUPPORT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
export type SupportImageType = (typeof SUPPORT_IMAGE_TYPES)[number];

const STAFF_NAME = "Equipo MVC";

function requireStorage(storage: PrivateObjectStorage | null): PrivateObjectStorage {
  if (!storage || storage.providerName === "disabled") {
    throw err(
      "PRIVATE_STORAGE_NOT_CONFIGURED",
      503,
      "El almacenamiento privado de archivos no está disponible en este momento, así que no se pueden adjuntar imágenes. Puedes enviar tu consulta sin ellas."
    );
  }
  return storage;
}

/* ───────────── Selector «Selecciona un viaje (opcional)» ───────────── */

export type SupportTripOptionDto = {
  tripId: string;
  bookingId: string | null;
  role: "driver" | "passenger";
  departureAt: string | null;
  originLabel: string | null;
  destinationLabel: string | null;
  status: TripStatusCode;
};

export async function listSupportTrips(
  db: Queryable,
  userId: string,
  input: { limit?: number; cursor?: string }
): Promise<{ items: SupportTripOptionDto[]; nextCursor: string | null }> {
  const limit = pageLimit(input.limit);
  const params: unknown[] = [userId];
  let cursorWhere = "";
  if (input.cursor) {
    const cursor = decodeTimeIdCursor(input.cursor);
    params.push(cursor.t, cursor.id);
    cursorWhere = `where (q.departure_at, q.trip_id) < ($2::timestamptz, $3::uuid)`;
  }
  params.push(limit + 1);
  const rows = await db.query<{
    trip_id: string;
    booking_id: string | null;
    role: "driver" | "passenger";
    departure_at: Date;
    status: TripStatusCode;
    departure_us: string;
  }>(
    `select q.*, ${tsUs("q.departure_at")} as departure_us
       from (
         select t.id as trip_id, null::uuid as booking_id, 'driver'::text as role, t.departure_at, t.status::text as status
           from trips t
          where t.driver_user_id = $1 and t.status <> 'draft' and t.departure_at is not null
         union all
         select p.trip_id, p.booking_id, p.role, p.departure_at, p.status
           from (
             select distinct on (t.id) t.id as trip_id, b.id as booking_id, 'passenger'::text as role, t.departure_at, t.status::text as status
               from bookings b
               join ride_requests r on r.id = b.request_id
               join trips t on t.id = r.trip_id
              where r.passenger_user_id = $1 and t.status <> 'draft' and t.departure_at is not null
              order by t.id, b.created_at desc
           ) p
       ) q
      ${cursorWhere}
      order by q.departure_at desc, q.trip_id desc
      limit $${params.length}`,
    params
  );
  const page = rows.rows.slice(0, limit);
  const labels = await loadTripLabels(db, page.map(row => row.trip_id));
  const items: SupportTripOptionDto[] = page.map(row => ({
    tripId: row.trip_id,
    bookingId: row.booking_id,
    role: row.role,
    departureAt: iso(row.departure_at),
    originLabel: labels.get(row.trip_id)?.originLabel ?? null,
    destinationLabel: labels.get(row.trip_id)?.destinationLabel ?? null,
    status: row.status
  }));
  const last = page[page.length - 1];
  return { items, nextCursor: rows.rows.length > limit && last ? encodeCursor({ t: last.departure_us, id: last.trip_id }) : null };
}

/* ───────────── Adjuntos (imágenes) ───────────── */

export type SupportAttachmentDto = { id: string; contentType: string; sizeBytes: number; createdAt: string };

function extensionFor(contentType: string): string {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    default:
      return "bin";
  }
}

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis"]);
const HEIF_BRANDS = new Set(["mif1", "msf1"]);

/** Tipo real de una imagen por sus primeros bytes («magic numbers»); null si no es un formato admitido. */
export function sniffImageType(bytes: Uint8Array): SupportImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (HEIC_BRANDS.has(brand)) return "image/heic";
    if (HEIF_BRANDS.has(brand)) return "image/heif";
  }
  return null;
}

function sameImageFamily(declared: string, actual: SupportImageType): boolean {
  if (declared === actual) return true;
  const heif = (type: string) => type === "image/heic" || type === "image/heif";
  return heif(declared) && heif(actual);
}

export async function createSupportUploadIntent(
  pool: Pool,
  userId: string,
  storage: PrivateObjectStorage | null,
  ttlSeconds: number,
  input: { contentType: string; sizeBytes: number }
): Promise<{ intentId: string; uploadUrl: string; headers: Record<string, string>; expiresAt: string }> {
  const store = requireStorage(storage);
  if (!(SUPPORT_IMAGE_TYPES as readonly string[]).includes(input.contentType)) {
    throw err("PRIVATE_UPLOAD_TYPE_NOT_ALLOWED", 422, "Solo se admiten imágenes JPEG, PNG, WebP, HEIC o HEIF.");
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > SUPPORT_LIMITS.imageMaxBytes) {
    throw err("PRIVATE_UPLOAD_SIZE_INVALID", 422, "La imagen debe pesar entre 1 byte y 10 MB.");
  }
  const pending = await pool.query<{ total: number }>(
    `select (select count(*) from support_attachments where owner_user_id = $1 and ticket_id is null)
          + (select count(*) from support_upload_intents where owner_user_id = $1 and completed_at is null and expires_at > now()) as total`,
    [userId]
  );
  if (Number(pending.rows[0]?.total ?? 0) >= SUPPORT_LIMITS.unlinkedAttachments) {
    throw err(
      "SUPPORT_ATTACHMENT_LIMIT",
      422,
      "Tienes demasiadas imágenes sin enviar. Envía tu consulta o espera unos minutos antes de añadir más."
    );
  }
  const id = crypto.randomUUID();
  const key = ["users", userId, "support", `${id}.${extensionFor(input.contentType)}`].join("/");
  const signed = await store.createUploadUrl({ key, contentType: input.contentType, expiresInSeconds: ttlSeconds });
  await pool.query(
    `insert into support_upload_intents(id, owner_user_id, storage_provider, storage_key, content_type, expected_size_bytes, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [id, userId, store.providerName, key, input.contentType, input.sizeBytes, signed.expiresAt]
  );
  return { intentId: id, uploadUrl: signed.url, headers: signed.headers, expiresAt: signed.expiresAt };
}

type AttachmentRow = { id: string; content_type: string; size_bytes: string; created_at: Date };

function toAttachmentDto(row: AttachmentRow): SupportAttachmentDto {
  return { id: row.id, contentType: row.content_type, sizeBytes: Number(row.size_bytes), createdAt: iso(row.created_at) };
}

export async function completeSupportUpload(
  pool: Pool,
  userId: string,
  storage: PrivateObjectStorage | null,
  intentId: string
): Promise<{ attachment: SupportAttachmentDto; created: boolean }> {
  const store = requireStorage(storage);
  const intentRow = await pool.query<{
    id: string;
    storage_provider: string;
    storage_key: string;
    content_type: string;
    expected_size_bytes: string;
    expires_at: Date;
    completed_at: Date | null;
    attachment_id: string | null;
  }>(`select * from support_upload_intents where id = $1 and owner_user_id = $2`, [intentId, userId]);
  const intent = intentRow.rows[0];
  if (!intent) throw err("UPLOAD_INTENT_NOT_FOUND", 404, "No encontramos esa subida.");

  if (intent.completed_at && intent.attachment_id) {
    const existing = await pool.query<AttachmentRow>(
      `select id, content_type, size_bytes::text as size_bytes, created_at from support_attachments where id = $1`,
      [intent.attachment_id]
    );
    if (existing.rows[0]) return { attachment: toAttachmentDto(existing.rows[0]), created: false };
  }
  if (intent.expires_at.getTime() < Date.now()) {
    throw err("UPLOAD_INTENT_EXPIRED", 410, "La subida ha caducado. Vuelve a seleccionar la imagen.");
  }
  if (intent.storage_provider !== store.providerName) {
    throw err("UPLOAD_STORAGE_MISMATCH", 409, "El almacenamiento de esta subida ya no coincide con el actual.");
  }

  const expected = Number(intent.expected_size_bytes);
  let info;
  try {
    info = await store.headObject(intent.storage_key);
  } catch {
    throw err("UPLOAD_OBJECT_MISSING", 409, "Todavía no hemos recibido la imagen. Súbela de nuevo e inténtalo otra vez.");
  }
  if (info.sizeBytes !== expected) {
    throw err("UPLOADED_FILE_SIZE_MISMATCH", 422, "El tamaño de la imagen subida no coincide con el declarado.", {
      expected,
      actual: info.sizeBytes
    });
  }
  if (info.contentType && info.contentType.split(";")[0]?.trim() !== intent.content_type) {
    throw err("UPLOADED_FILE_TYPE_MISMATCH", 422, "El tipo de archivo subido no coincide con el declarado.");
  }
  const bytes = await store.readObject(intent.storage_key, SUPPORT_LIMITS.imageMaxBytes);
  if (bytes.byteLength !== expected) {
    throw err("UPLOADED_FILE_SIZE_MISMATCH", 422, "El tamaño de la imagen subida no coincide con el declarado.");
  }
  const sniffed = sniffImageType(bytes);
  if (!sniffed || !sameImageFamily(intent.content_type, sniffed)) {
    throw err("UPLOADED_FILE_TYPE_MISMATCH", 422, "El archivo subido no es una imagen válida del tipo declarado.");
  }
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");

  const attachment = await tx(pool, async client => {
    const inserted = await client.query<AttachmentRow>(
      `insert into support_attachments(owner_user_id, storage_provider, storage_key, content_type, size_bytes, sha256)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (storage_provider, storage_key) do nothing
       returning id, content_type, size_bytes::text as size_bytes, created_at`,
      [userId, intent.storage_provider, intent.storage_key, intent.content_type, bytes.byteLength, sha256]
    );
    let row = inserted.rows[0];
    if (!row) {
      const existing = await client.query<AttachmentRow>(
        `select id, content_type, size_bytes::text as size_bytes, created_at
           from support_attachments where storage_provider = $1 and storage_key = $2 and owner_user_id = $3`,
        [intent.storage_provider, intent.storage_key, userId]
      );
      row = existing.rows[0];
    }
    if (!row) throw new Error("support attachment could not be registered");
    await client.query(`update support_upload_intents set completed_at = now(), attachment_id = $2 where id = $1`, [intentId, row.id]);
    return row;
  });
  return { attachment: toAttachmentDto(attachment), created: true };
}

export async function createSupportAttachmentDownload(
  pool: Pool,
  userId: string,
  storage: PrivateObjectStorage | null,
  attachmentId: string
): Promise<{ url: string; expiresAt: string }> {
  const row = await pool.query<{ storage_provider: string; storage_key: string }>(
    `select storage_provider, storage_key from support_attachments where id = $1 and owner_user_id = $2`,
    [attachmentId, userId]
  );
  const attachment = row.rows[0];
  if (!attachment) throw err("SUPPORT_ATTACHMENT_NOT_FOUND", 404, "No encontramos ese archivo adjunto.");
  const store = requireStorage(storage);
  if (attachment.storage_provider !== store.providerName) {
    throw err("UPLOAD_STORAGE_MISMATCH", 409, "El almacenamiento de este archivo ya no coincide con el actual.");
  }
  const url = await store.createDownloadUrl(attachment.storage_key, 300);
  await writeAudit(pool, {
    actorUserId: userId,
    action: "support.attachment.downloaded",
    entityType: "support_attachment",
    entityId: attachmentId
  });
  return { url, expiresAt: new Date(Date.now() + 300_000).toISOString() };
}

/* ───────────── Consultas (tickets) ───────────── */

export type SupportTicketSummaryDto = {
  id: string;
  reference: string;
  category: SupportCategory;
  status: SupportTicketStatus;
  bodyPreview: string;
  tripId: string | null;
  bookingId: string | null;
  attachmentCount: number;
  hasStaffReply: boolean;
  lastActivityAt: string;
  createdAt: string;
};

export type SupportTicketMessageDto = {
  id: string;
  authorType: "user" | "staff";
  authorName: string;
  body: string;
  attachments: SupportAttachmentDto[];
  createdAt: string;
};

export type SupportTicketDetailDto = SupportTicketSummaryDto & {
  body: string;
  messages: SupportTicketMessageDto[];
  closedAt: string | null;
};

type TicketRow = {
  id: string;
  reference: string;
  user_id: string;
  category: SupportCategory;
  status: SupportTicketStatus;
  body: string;
  trip_id: string | null;
  booking_id: string | null;
  last_staff_message_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
  attachment_count: number;
  activity_at: Date;
  activity_us: string;
};

const TICKET_SELECT = `select t.id, t.reference, t.user_id, t.category, t.status, t.body, t.trip_id, t.booking_id,
       t.last_staff_message_at, t.closed_at, t.created_at,
       (select count(*)::int from support_attachments a where a.ticket_id = t.id) as attachment_count,
       greatest(t.created_at, t.last_user_message_at, coalesce(t.last_staff_message_at, t.created_at), coalesce(t.closed_at, t.created_at)) as activity_at
  from support_tickets t`;

function toSummary(row: TicketRow): SupportTicketSummaryDto {
  return {
    id: row.id,
    reference: row.reference,
    category: row.category,
    status: row.status,
    bodyPreview: truncate(row.body, 140),
    tripId: row.trip_id,
    bookingId: row.booking_id,
    attachmentCount: row.attachment_count,
    hasStaffReply: row.last_staff_message_at !== null,
    lastActivityAt: iso(row.activity_at),
    createdAt: iso(row.created_at)
  };
}

async function loadOwnTicketRow(db: Queryable, userId: string, ticketId: string, lock = false): Promise<TicketRow> {
  const result = await db.query<TicketRow>(
    `select q.*, ${tsUs("q.activity_at")} as activity_us
       from (${TICKET_SELECT} where t.id = $1 and t.user_id = $2${lock ? " for update of t" : ""}) q`,
    [ticketId, userId]
  );
  const row = result.rows[0];
  if (!row) throw err("SUPPORT_TICKET_NOT_FOUND", 404, "No encontramos esa consulta.");
  return row;
}

async function buildDetail(db: Queryable, row: TicketRow, config: CommsConfig): Promise<SupportTicketDetailDto> {
  const messages = await db.query<{
    id: string;
    author_type: "user" | "staff";
    body: string;
    created_at: Date;
  }>(
    `select id, author_type, body, created_at from support_ticket_messages where ticket_id = $1 order by created_at, id`,
    [row.id]
  );
  const attachments = await db.query<AttachmentRow & { message_id: string | null }>(
    `select id, message_id, content_type, size_bytes::text as size_bytes, created_at
       from support_attachments where ticket_id = $1 order by created_at, id`,
    [row.id]
  );
  const byMessage = new Map<string, SupportAttachmentDto[]>();
  for (const attachment of attachments.rows) {
    if (!attachment.message_id) continue;
    const list = byMessage.get(attachment.message_id) ?? [];
    list.push(toAttachmentDto(attachment));
    byMessage.set(attachment.message_id, list);
  }
  const owner = (await loadPublicUsers(db, [row.user_id], config)).get(row.user_id);
  const ownerName = owner?.displayName ?? "Tú";
  return {
    ...toSummary(row),
    body: row.body,
    messages: messages.rows.map(message => ({
      id: message.id,
      authorType: message.author_type,
      authorName: message.author_type === "staff" ? STAFF_NAME : ownerName,
      body: message.body,
      attachments: byMessage.get(message.id) ?? [],
      createdAt: iso(message.created_at)
    })),
    closedAt: isoOrNull(row.closed_at)
  };
}

export async function getSupportTicket(db: Queryable, userId: string, ticketId: string, config: CommsConfig): Promise<SupportTicketDetailDto> {
  return buildDetail(db, await loadOwnTicketRow(db, userId, ticketId), config);
}

export async function listSupportTickets(
  db: Queryable,
  userId: string,
  input: { status?: SupportTicketStatus; limit?: number; cursor?: string }
): Promise<{ items: SupportTicketSummaryDto[]; nextCursor: string | null }> {
  const limit = pageLimit(input.limit);
  const params: unknown[] = [userId];
  let where = "t.user_id = $1";
  if (input.status) {
    params.push(input.status);
    where += ` and t.status = $${params.length}`;
  }
  let outer = "";
  if (input.cursor) {
    const cursor = decodeTimeIdCursor(input.cursor);
    params.push(cursor.t, cursor.id);
    outer = `where (q.activity_at, q.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }
  params.push(limit + 1);
  const rows = await db.query<TicketRow>(
    `select q.*, ${tsUs("q.activity_at")} as activity_us
       from (${TICKET_SELECT} where ${where}) q
      ${outer}
      order by q.activity_at desc, q.id desc
      limit $${params.length}`,
    params
  );
  const page = rows.rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toSummary),
    nextCursor: rows.rows.length > limit && last ? encodeCursor({ t: last.activity_us, id: last.id }) : null
  };
}

function cleanBody(raw: string, max: number, label: string): string {
  const body = raw.trim();
  if (body.length < 1) throw err("VALIDATION_ERROR", 400, `Escribe ${label} antes de enviarla.`);
  if (body.length > max) throw err("VALIDATION_ERROR", 400, `El texto no puede superar los ${max} caracteres.`);
  if (containsNul(body)) throw err("VALIDATION_ERROR", 400, "El texto contiene caracteres no válidos.");
  return body;
}

async function resolveLinks(
  db: Queryable,
  userId: string,
  tripId: string | undefined,
  bookingId: string | undefined
): Promise<{ tripId: string | null; bookingId: string | null }> {
  let trip = tripId ?? null;
  const booking = bookingId ?? null;
  const forbidden = (message: string) => err("SUPPORT_LINK_FORBIDDEN", 403, message);
  if (booking) {
    const row = await db.query<{ trip_id: string; passenger_user_id: string; driver_user_id: string }>(
      `select r.trip_id, r.passenger_user_id, t.driver_user_id
         from bookings b join ride_requests r on r.id = b.request_id join trips t on t.id = r.trip_id
        where b.id = $1`,
      [booking]
    );
    const found = row.rows[0];
    if (!found || (found.passenger_user_id !== userId && found.driver_user_id !== userId)) {
      throw forbidden("Solo puedes vincular reservas en las que has participado.");
    }
    if (trip && trip !== found.trip_id) throw forbidden("La reserva no corresponde al viaje indicado.");
    trip = found.trip_id;
  }
  if (trip && !(await involvedInTrip(db, trip, userId))) {
    throw forbidden("Solo puedes vincular viajes en los que has participado.");
  }
  return { tripId: trip, bookingId: booking };
}

async function claimAttachments(
  db: Queryable,
  userId: string,
  attachmentIds: string[],
  ticketId: string,
  messageId: string
): Promise<void> {
  if (attachmentIds.length === 0) return;
  const invalid = () => err("SUPPORT_ATTACHMENT_INVALID", 422, "Alguna imagen no es válida, no es tuya o ya se envió con otra consulta.");
  const rows = await db.query<{ id: string }>(
    `select id from support_attachments where id = any($1::uuid[]) and owner_user_id = $2 and ticket_id is null for update`,
    [attachmentIds, userId]
  );
  if (rows.rows.length !== attachmentIds.length) throw invalid();
  await db.query(`update support_attachments set ticket_id = $1, message_id = $2 where id = any($3::uuid[])`, [
    ticketId,
    messageId,
    attachmentIds
  ]);
}

function checkAttachmentCount(attachmentIds: string[]): string[] {
  const unique = [...new Set(attachmentIds)];
  if (unique.length > SUPPORT_LIMITS.attachmentsPerMessage) {
    throw err("SUPPORT_ATTACHMENT_LIMIT", 422, `Puedes adjuntar como máximo ${SUPPORT_LIMITS.attachmentsPerMessage} imágenes.`);
  }
  return unique;
}

export type CreateTicketInput = {
  category: SupportCategory;
  body: string;
  tripId?: string | undefined;
  bookingId?: string | undefined;
  attachmentIds?: string[] | undefined;
  idempotencyKey?: string | undefined;
};

export async function createSupportTicket(
  pool: Pool,
  userId: string,
  input: CreateTicketInput,
  config: CommsConfig,
  requestId?: string | null
): Promise<{ ticket: SupportTicketDetailDto; created: boolean }> {
  const body = cleanBody(input.body, SUPPORT_LIMITS.ticketBody, "tu consulta");
  const attachmentIds = checkAttachmentCount(input.attachmentIds ?? []);

  const outcome = await tx(pool, async client => {
    await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`support_ticket:${userId}`]);

    if (input.idempotencyKey) {
      const existing = await client.query<{
        id: string;
        category: string;
        body: string;
        trip_id: string | null;
        booking_id: string | null;
        attachment_ids: string[];
      }>(
        `select t.id, t.category, t.body, t.trip_id, t.booking_id,
                coalesce((select array_agg(a.id::text) from support_attachments a where a.ticket_id = t.id), '{}') as attachment_ids
           from support_tickets t where t.user_id = $1 and t.idempotency_key = $2`,
        [userId, input.idempotencyKey]
      );
      const row = existing.rows[0];
      if (row) {
        const sameAttachments =
          row.attachment_ids.length === attachmentIds.length && attachmentIds.every(id => row.attachment_ids.includes(id));
        const sameLinks = (row.trip_id ?? null) === (input.tripId ?? row.trip_id ?? null) && (row.booking_id ?? null) === (input.bookingId ?? null);
        if (row.category !== input.category || row.body !== body || !sameAttachments || !sameLinks) {
          throw err("SUPPORT_IDEMPOTENCY_CONFLICT", 409, "Esa clave de idempotencia ya se usó con otra consulta.");
        }
        return { id: row.id, created: false };
      }
    }

    const counts = await client.query<{ open_total: number; today_total: number }>(
      `select count(*) filter (where status in ('open','answered'))::int as open_total,
              count(*) filter (where created_at > now() - interval '24 hours')::int as today_total
         from support_tickets where user_id = $1`,
      [userId]
    );
    if ((counts.rows[0]?.open_total ?? 0) >= SUPPORT_LIMITS.openTickets) {
      throw err("SUPPORT_TICKET_LIMIT", 429, "Tienes demasiadas consultas abiertas. Espera a que respondamos o cierra alguna antes de enviar otra.", {
        limit: "open"
      });
    }
    if ((counts.rows[0]?.today_total ?? 0) >= SUPPORT_LIMITS.ticketsPerDay) {
      throw err("SUPPORT_TICKET_LIMIT", 429, "Has enviado muchas consultas hoy. Inténtalo de nuevo mañana o añade información a una consulta abierta.", {
        limit: "daily"
      });
    }

    const links = await resolveLinks(client, userId, input.tripId, input.bookingId);
    const ticket = await client.query<{ id: string }>(
      `insert into support_tickets(user_id, category, trip_id, booking_id, body, idempotency_key)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [userId, input.category, links.tripId, links.bookingId, body, input.idempotencyKey ?? null]
    );
    const ticketId = ticket.rows[0]?.id;
    if (!ticketId) throw new Error("support ticket insert returned no row");
    const message = await client.query<{ id: string }>(
      `insert into support_ticket_messages(ticket_id, author_type, author_user_id, body) values ($1, 'user', $2, $3) returning id`,
      [ticketId, userId, body]
    );
    const messageId = message.rows[0]?.id;
    if (!messageId) throw new Error("support message insert returned no row");
    await claimAttachments(client, userId, attachmentIds, ticketId, messageId);
    await writeAudit(client, {
      actorUserId: userId,
      action: "support.ticket.created",
      entityType: "support_ticket",
      entityId: ticketId,
      requestId: requestId ?? null,
      metadata: { category: input.category, tripId: links.tripId, bookingId: links.bookingId, attachments: attachmentIds.length }
    });
    return { id: ticketId, created: true };
  });
  return { ticket: await getSupportTicket(pool, userId, outcome.id, config), created: outcome.created };
}

export async function replyToSupportTicket(
  pool: Pool,
  userId: string,
  ticketId: string,
  input: { body: string; attachmentIds?: string[] | undefined },
  config: CommsConfig
): Promise<SupportTicketDetailDto> {
  const body = cleanBody(input.body, SUPPORT_LIMITS.replyBody, "tu respuesta");
  const attachmentIds = checkAttachmentCount(input.attachmentIds ?? []);
  await tx(pool, async client => {
    const ticket = await loadOwnTicketRow(client, userId, ticketId, true);
    if (ticket.status === "closed") {
      throw err("SUPPORT_TICKET_CLOSED", 409, "Esta consulta está cerrada. Si necesitas algo más, envía una consulta nueva.");
    }
    const recent = await client.query<{ total: number }>(
      `select count(*)::int as total from support_ticket_messages
        where ticket_id = $1 and author_type = 'user' and created_at > now() - interval '24 hours'`,
      [ticketId]
    );
    if ((recent.rows[0]?.total ?? 0) >= SUPPORT_LIMITS.repliesPerTicketPerDay) {
      throw err("SUPPORT_TICKET_LIMIT", 429, "Has enviado muchos mensajes en esta consulta. Espera a que el equipo responda.", { limit: "replies" });
    }
    const message = await client.query<{ id: string }>(
      `insert into support_ticket_messages(ticket_id, author_type, author_user_id, body) values ($1, 'user', $2, $3) returning id`,
      [ticketId, userId, body]
    );
    const messageId = message.rows[0]?.id;
    if (!messageId) throw new Error("support reply insert returned no row");
    await claimAttachments(client, userId, attachmentIds, ticketId, messageId);
  });
  return getSupportTicket(pool, userId, ticketId, config);
}

export async function closeSupportTicket(
  pool: Pool,
  userId: string,
  ticketId: string,
  config: CommsConfig,
  requestId?: string | null
): Promise<SupportTicketDetailDto> {
  await tx(pool, async client => {
    const ticket = await loadOwnTicketRow(client, userId, ticketId, true);
    if (ticket.status === "closed") return;
    await client.query(`update support_tickets set status = 'closed', closed_at = now(), closed_by = 'user' where id = $1`, [ticketId]);
    await writeAudit(client, {
      actorUserId: userId,
      action: "support.ticket.closed",
      entityType: "support_ticket",
      entityId: ticketId,
      requestId: requestId ?? null,
      metadata: { closedBy: "user" }
    });
  });
  return getSupportTicket(pool, userId, ticketId, config);
}
