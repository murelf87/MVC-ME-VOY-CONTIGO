import crypto from "node:crypto";
import { writeAudit } from "../../lib/audit.js";
import { DomainError } from "../../errors.js";
import { notify } from "../../lib/notify.js";
import { resolveAccess } from "./chat-access.js";
import { fetchMessageRows } from "./chat-messages.js";
import { groupTitle, loadRouteInfo } from "./chat-inbox.js";
import {
  decodeTimeIdCursor,
  encodeCursor,
  iso,
  isoOrNull,
  loadPublicUsers,
  pageLimit,
  tsUs,
  tx,
  type Queryable
} from "./common.js";
import { silentLogger, storageEnabled, type DataRightsDeps } from "./deps.js";
import { err } from "./errors.js";
import { getExportContributors, KNOWN_EXTERNAL_EXPORT_SECTIONS } from "./registry.js";
import type { CommsConfig } from "./config.js";

export type DataExportStatus = "queued" | "processing" | "ready" | "failed" | "blocked_storage_disabled" | "expired";

export type DataExportDto = {
  id: string;
  status: DataExportStatus;
  format: "json";
  requestedAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  sizeBytes: number | null;
  downloadable: boolean;
  errorCode: string | null;
};

type ExportRow = {
  id: string;
  user_id: string;
  status: DataExportStatus;
  storage_provider: string | null;
  storage_key: string | null;
  size_bytes: string | null;
  error_code: string | null;
  attempts: number;
  requested_at: Date;
  completed_at: Date | null;
  expires_at: Date | null;
};

const EXPORT_COLUMNS = `id, user_id, status, storage_provider, storage_key, size_bytes::text as size_bytes, error_code, attempts,
  requested_at, completed_at, expires_at`;

const MAX_ATTEMPTS = 3;
const STALE_PROCESSING_MINUTES = 15;

function toDto(row: ExportRow, now: Date = new Date()): DataExportDto {
  const expired = row.status === "ready" && row.expires_at !== null && row.expires_at.getTime() <= now.getTime();
  const status: DataExportStatus = expired ? "expired" : row.status;
  return {
    id: row.id,
    status,
    format: "json",
    requestedAt: iso(row.requested_at),
    completedAt: isoOrNull(row.completed_at),
    expiresAt: isoOrNull(row.expires_at),
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    downloadable: status === "ready",
    errorCode: row.error_code
  };
}

/* ───────────── Solicitud y consulta ───────────── */

export async function requestDataExport(
  deps: DataRightsDeps,
  userId: string,
  options: { idempotencyKey?: string | undefined; requestId?: string | null | undefined } = {}
): Promise<{ export: DataExportDto; created: boolean }> {
  const { pool } = deps;
  return tx(pool, async client => {
    await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`data_export:${userId}`]);

    if (options.idempotencyKey) {
      const replay = await client.query<ExportRow>(
        `select ${EXPORT_COLUMNS} from data_export_requests where user_id = $1 and idempotency_key = $2`,
        [userId, options.idempotencyKey]
      );
      if (replay.rows[0]) return { export: toDto(replay.rows[0]), created: false };
    }
    const inProgress = await client.query<ExportRow>(
      `select ${EXPORT_COLUMNS} from data_export_requests
        where user_id = $1 and status in ('queued','processing') order by requested_at desc limit 1`,
      [userId]
    );
    if (inProgress.rows[0]) return { export: toDto(inProgress.rows[0]), created: false };

    // Una exportación completada o en curso cada 24 h; las fallidas o bloqueadas no cuentan.
    const recent = await client.query(
      `select 1 from data_export_requests
        where user_id = $1 and status in ('queued','processing','ready') and requested_at > now() - interval '24 hours'
        limit 1`,
      [userId]
    );
    if ((recent.rowCount ?? 0) > 0) {
      throw err("EXPORT_RATE_LIMITED", 429, "Ya has pedido una exportación en las últimas 24 horas. Descarga la anterior o inténtalo más tarde.");
    }

    const enabled = storageEnabled(deps.storage);
    const inserted = await client.query<ExportRow>(
      `insert into data_export_requests(user_id, status, idempotency_key, error_code)
       values ($1, $2, $3, $4)
       returning ${EXPORT_COLUMNS}`,
      [userId, enabled ? "queued" : "blocked_storage_disabled", options.idempotencyKey ?? null, enabled ? null : "PRIVATE_STORAGE_NOT_CONFIGURED"]
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("data export insert returned no row");
    await writeAudit(client, {
      actorUserId: userId,
      action: "privacy.export.requested",
      entityType: "data_export_request",
      entityId: row.id,
      requestId: options.requestId ?? null,
      metadata: { status: row.status }
    });
    return { export: toDto(row), created: true };
  });
}

export async function listDataExports(
  db: Queryable,
  userId: string,
  input: { limit?: number; cursor?: string }
): Promise<{ items: DataExportDto[]; nextCursor: string | null }> {
  const limit = pageLimit(input.limit);
  const params: unknown[] = [userId];
  let where = "user_id = $1";
  if (input.cursor) {
    const cursor = decodeTimeIdCursor(input.cursor);
    params.push(cursor.t, cursor.id);
    where += ` and (requested_at, id) < ($2::timestamptz, $3::uuid)`;
  }
  params.push(limit + 1);
  const rows = await db.query<ExportRow & { requested_us: string }>(
    `select ${EXPORT_COLUMNS}, ${tsUs("requested_at")} as requested_us
       from data_export_requests where ${where}
      order by requested_at desc, id desc limit $${params.length}`,
    params
  );
  const page = rows.rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(row => toDto(row)),
    nextCursor: rows.rows.length > limit && last ? encodeCursor({ t: last.requested_us, id: last.id }) : null
  };
}

async function loadOwnExport(db: Queryable, userId: string, exportId: string): Promise<ExportRow> {
  const result = await db.query<ExportRow>(`select ${EXPORT_COLUMNS} from data_export_requests where id = $1 and user_id = $2`, [exportId, userId]);
  const row = result.rows[0];
  if (!row) throw err("EXPORT_NOT_FOUND", 404, "No encontramos esa exportación.");
  return row;
}

export async function getDataExport(db: Queryable, userId: string, exportId: string): Promise<DataExportDto> {
  return toDto(await loadOwnExport(db, userId, exportId));
}

export async function createDataExportDownload(
  deps: DataRightsDeps,
  userId: string,
  exportId: string,
  requestId?: string | null
): Promise<{ url: string; expiresAt: string }> {
  const row = await loadOwnExport(deps.pool, userId, exportId);
  const now = new Date();
  if (row.status === "expired" || (row.status === "ready" && row.expires_at !== null && row.expires_at.getTime() <= now.getTime())) {
    throw err("EXPORT_EXPIRED", 410, "Esta exportación ha caducado. Solicita una nueva.");
  }
  if (row.status !== "ready" || !row.storage_key) {
    throw err("EXPORT_NOT_READY", 409, "La exportación todavía no está lista para descargar.");
  }
  if (!storageEnabled(deps.storage) || deps.storage.providerName !== row.storage_provider) {
    throw err("PRIVATE_STORAGE_NOT_CONFIGURED", 503, "El almacenamiento privado no está disponible en este momento. Inténtalo más tarde.");
  }
  const url = await deps.storage.createDownloadUrl(row.storage_key, 300);
  await deps.pool.query(`update data_export_requests set last_downloaded_at = now(), updated_at = now() where id = $1`, [exportId]);
  await writeAudit(deps.pool, {
    actorUserId: userId,
    action: "privacy.export.downloaded",
    entityType: "data_export_request",
    entityId: exportId,
    requestId: requestId ?? null
  });
  return { url, expiresAt: new Date(now.getTime() + 300_000).toISOString() };
}

/* ───────────── Contenido del archivo ───────────── */

const SECTION_LIMIT = 5000;
const MESSAGE_LIMIT = 20000;
const LOCATION_LIMIT = 20000;
const ACTIVITY_LIMIT = 1000;

export type UserDataExport = Record<string, unknown>;

async function rows<T extends Record<string, unknown>>(db: Queryable, sql: string, params: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

export async function buildUserDataExport(db: Queryable, userId: string, config: CommsConfig, now: Date = new Date()): Promise<UserDataExport> {
  const subject = (
    await rows(
      db,
      `select u.id, u.phone_e164 as "phoneE164", u.status::text as status, u.created_at as "createdAt",
              coalesce(array(select r.role::text from user_roles r where r.user_id = u.id order by r.role::text), '{}') as roles
         from app_users u where u.id = $1`,
      [userId]
    )
  )[0];
  if (!subject) throw new Error("export subject not found");

  const profile =
    (
      await rows(
        db,
        `select display_name as "displayName", public_photo_status::text as "publicPhotoStatus", identity_status::text as "identityStatus",
                presence_status as "presenceStatus", (public_photo_key is not null) as "hasPublicPhoto",
                (private_selfie_key is not null) as "hasPrivateSelfie", created_at as "createdAt", updated_at as "updatedAt"
           from profiles where user_id = $1`,
        [userId]
      )
    )[0] ?? null;

  const settings =
    (
      await rows(
        db,
        `select share_live_location_in_trip as "shareLiveLocationInTrip", font_scale as "fontScale", language, updated_at as "updatedAt"
           from user_settings where user_id = $1`,
        [userId]
      )
    )[0] ?? { shareLiveLocationInTrip: true, fontScale: "normal", language: "es", updatedAt: null };

  const notificationPreferences =
    (
      await rows(
        db,
        `select essential_trip_notices as "essentialTripNotices", arrival_alerts as "arrivalAlerts", message_notices as "messages", updated_at as "updatedAt"
           from notification_preferences where user_id = $1`,
        [userId]
      )
    )[0] ?? { essentialTripNotices: true, arrivalAlerts: true, messages: true, updatedAt: null };

  const vehicles = await rows(
    db,
    `select id, make, model, plate, passenger_seats as "passengerSeats", review_status::text as "reviewStatus",
            documentation_status::text as "documentationStatus", vehicle_photo_status::text as "photoStatus",
            insurance_status::text as "insuranceStatus", insurance_expires_on as "insuranceExpiresOn", created_at as "createdAt"
       from vehicles where driver_user_id = $1 order by created_at limit ${SECTION_LIMIT}`,
    [userId]
  );
  const documents = await rows(
    db,
    `select id, vehicle_id as "vehicleId", kind, content_type as "contentType", size_bytes::text as "sizeBytes",
            review_status::text as "reviewStatus", analysis_status as "analysisStatus", verified_expires_on as "verifiedExpiresOn",
            created_at as "createdAt"
       from private_documents where owner_user_id = $1 order by created_at limit ${SECTION_LIMIT}`,
    [userId]
  );

  const trips = await rows<{ id: string }>(
    db,
    `select t.id, t.category::text as category, t.kind::text as kind, t.leg::text as leg, t.status::text as status,
            t.departure_at as "departureAt", t.offered_seats as "offeredSeats", t.flexibility_minutes as "flexibilityMinutes",
            t.route_distance_m as "routeDistanceM", t.route_duration_s as "routeDurationS",
            ST_Y(t.origin_geom) as "originLat", ST_X(t.origin_geom) as "originLng",
            ST_Y(t.destination_geom) as "destinationLat", ST_X(t.destination_geom) as "destinationLng",
            (select count(*)::int from ride_requests r join bookings b on b.request_id = r.id where r.trip_id = t.id) as "bookingsCount",
            t.created_at as "createdAt", t.updated_at as "updatedAt"
       from trips t where t.driver_user_id = $1 order by t.created_at desc limit ${SECTION_LIMIT}`,
    [userId]
  );
  const stops = await rows<{ tripId: string }>(
    db,
    `select trip_id as "tripId", seq, kind, label, ST_Y(geom) as lat, ST_X(geom) as lng
       from trip_stops where trip_id = any($1::uuid[]) order by trip_id, seq`,
    [trips.map(trip => trip.id)]
  );
  const tripsAsDriver = trips.map(trip => ({ ...trip, stops: stops.filter(stop => stop.tripId === trip.id).map(({ tripId: _t, ...rest }) => rest) }));

  const ridesAsPassenger = await rows(
    db,
    `select r.id as "requestId", r.trip_id as "tripId", r.status::text as "requestStatus", r.from_segment_seq as "fromSegment",
            r.to_segment_seq as "toSegment", r.requested_at as "requestedAt", b.id as "bookingId", b.status::text as "bookingStatus",
            b.amount_cents as "amountCents", b.created_at as "bookedAt", t.departure_at as "departureAt", t.category::text as category,
            t.status::text as "tripStatus"
       from ride_requests r
       join trips t on t.id = r.trip_id
       left join bookings b on b.request_id = r.id
      where r.passenger_user_id = $1 order by r.requested_at desc limit ${SECTION_LIMIT}`,
    [userId]
  );

  const locations = await rows(
    db,
    `select event_id as "eventId", trip_id as "tripId", recorded_at as "recordedAt", ST_Y(geom) as lat, ST_X(geom) as lng,
            accuracy_m::float8 as "accuracyM", speed_mps::float8 as "speedMps", heading_degrees::float8 as "headingDegrees"
       from trip_location_events where driver_user_id = $1 order by recorded_at desc limit ${LOCATION_LIMIT + 1}`,
    [userId]
  );

  const conversations = await buildConversationsSection(db, userId, config);

  const notificationRows = await rows(
    db,
    `select id, category, kind, title, body, data, read_at as "readAt", (delivery_state = 'delivered') as "shown", created_at as "createdAt"
       from notifications where user_id = $1 order by created_at desc limit ${SECTION_LIMIT}`,
    [userId]
  );

  const blockRows = await rows<{ blockedUserId: string; blockedAt: Date }>(
    db,
    `select blocked_user_id as "blockedUserId", created_at as "blockedAt" from user_blocks where blocker_user_id = $1 order by created_at desc`,
    [userId]
  );
  const reportRows = await rows<{ id: string; reportedUserId: string }>(
    db,
    `select id, reported_user_id as "reportedUserId", reason, details, status, trip_id as "tripId", conversation_id as "conversationId",
            created_at as "createdAt", resolved_at as "resolvedAt"
       from user_reports where reporter_user_id = $1 order by created_at desc limit ${SECTION_LIMIT}`,
    [userId]
  );
  const evidence = await rows<{ reportId: string }>(
    db,
    `select e.report_id as "reportId", e.message_source as source, (e.sender_user_id = $1) as "sentByMe", e.kind, e.body,
            e.message_created_at as "messageCreatedAt"
       from user_report_evidence e join user_reports r on r.id = e.report_id
      where r.reporter_user_id = $1 order by e.message_created_at`,
    [userId]
  );
  const names = await loadPublicUsers(db, [...blockRows.map(b => b.blockedUserId), ...reportRows.map(r => r.reportedUserId)], config);

  const tickets = await rows<{ id: string }>(
    db,
    `select id, reference, category, status, body, trip_id as "tripId", booking_id as "bookingId", created_at as "createdAt",
            closed_at as "closedAt"
       from support_tickets where user_id = $1 order by created_at desc limit ${SECTION_LIMIT}`,
    [userId]
  );
  const ticketMessages = await rows<{ ticketId: string }>(
    db,
    `select ticket_id as "ticketId", id, author_type as "authorType", body, created_at as "createdAt"
       from support_ticket_messages where ticket_id = any($1::uuid[]) order by created_at, id`,
    [tickets.map(t => t.id)]
  );
  const ticketAttachments = await rows<{ ticketId: string }>(
    db,
    `select ticket_id as "ticketId", id, content_type as "contentType", size_bytes::text as "sizeBytes", created_at as "createdAt"
       from support_attachments where owner_user_id = $1 and ticket_id is not null order by created_at`,
    [userId]
  );

  const pushDevices = await rows(
    db,
    `select platform, provider, device_id as "deviceId", app_version as "appVersion", locale, created_at as "createdAt",
            last_seen_at as "lastSeenAt", (disabled_at is not null) as disabled
       from push_tokens where user_id = $1 order by created_at`,
    [userId]
  );
  const dataExports = await rows(
    db,
    `select id, status, requested_at as "requestedAt", completed_at as "completedAt", expires_at as "expiresAt"
       from data_export_requests where user_id = $1 order by requested_at desc`,
    [userId]
  );
  const accountDeletionRequests = await rows(
    db,
    `select id, status, requested_at as "requestedAt", scheduled_for as "scheduledFor", cancelled_at as "cancelledAt", completed_at as "completedAt"
       from account_deletion_requests where user_id = $1 order by requested_at desc`,
    [userId]
  );
  const activity = await rows(
    db,
    `select action, entity_type as "entityType", entity_id as "entityId", created_at as "createdAt"
       from audit_events where actor_user_id = $1 order by id desc limit ${ACTIVITY_LIMIT + 1}`,
    [userId]
  );

  const modules: Record<string, unknown> = {};
  for (const contributor of getExportContributors()) modules[contributor.name] = await contributor.build(db, userId);
  const notIncluded = KNOWN_EXTERNAL_EXPORT_SECTIONS.filter(section => !(section.name in modules)).map(({ section, reason }) => ({ section, reason }));

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    subject,
    profile,
    settings,
    notificationPreferences,
    vehicles,
    documents,
    tripsAsDriver,
    ridesAsPassenger,
    driverLocationEvents: { items: locations.slice(0, LOCATION_LIMIT), truncated: locations.length > LOCATION_LIMIT },
    conversations,
    notifications: notificationRows,
    blocks: blockRows.map(block => ({ blockedUserDisplayName: names.get(block.blockedUserId)?.displayName ?? "Usuario eliminado", blockedAt: block.blockedAt })),
    reportsFiled: reportRows.map(({ reportedUserId, ...report }) => ({
      ...report,
      reportedUserDisplayName: names.get(reportedUserId)?.displayName ?? "Usuario eliminado",
      evidence: evidence.filter(item => item.reportId === report.id).map(({ reportId: _r, ...rest }) => rest)
    })),
    supportTickets: tickets.map(ticket => ({
      ...ticket,
      messages: ticketMessages.filter(m => m.ticketId === ticket.id).map(({ ticketId: _t, ...rest }) => rest),
      attachments: ticketAttachments.filter(a => a.ticketId === ticket.id).map(({ ticketId: _t, ...rest }) => rest)
    })),
    pushDevices,
    dataExports,
    accountDeletionRequests,
    activityLog: { items: activity.slice(0, ACTIVITY_LIMIT), truncated: activity.length > ACTIVITY_LIMIT },
    modules,
    notIncluded
  };
}

type ExportMessage = {
  id: string;
  direction: "sent" | "received";
  kind: "text" | "location";
  body: string | null;
  location: { lat: number; lng: number; label: string | null } | null;
  hidden: boolean;
  createdAt: string;
};

/** Mensajes enviados y recibidos en conversaciones propias; de la otra persona solo su nombre público. */
async function buildConversationsSection(db: Queryable, userId: string, config: CommsConfig): Promise<{ items: unknown[]; truncated: boolean }> {
  const direct = await db.query<{
    id: string;
    trip_id: string;
    sender_user_id: string;
    recipient_user_id: string;
    kind: "text" | "location";
    body: string;
    location_lat: number | null;
    location_lng: number | null;
    location_label: string | null;
    hidden_at: Date | null;
    created_at: Date;
  }>(
    `select id, trip_id, sender_user_id, recipient_user_id, kind, body, location_lat, location_lng, location_label, hidden_at, created_at
       from trip_direct_messages where sender_user_id = $1 or recipient_user_id = $1
      order by seq limit ${MESSAGE_LIMIT + 1}`,
    [userId]
  );
  const truncated = direct.rows.length > MESSAGE_LIMIT;
  const peerIds = direct.rows.slice(0, MESSAGE_LIMIT).map(row => (row.sender_user_id === userId ? row.recipient_user_id : row.sender_user_id));
  const peers = await loadPublicUsers(db, peerIds, config);
  const grouped = new Map<string, { tripId: string; peerDisplayName: string; messages: ExportMessage[] }>();
  for (const row of direct.rows.slice(0, MESSAGE_LIMIT)) {
    const sent = row.sender_user_id === userId;
    const peerId = sent ? row.recipient_user_id : row.sender_user_id;
    const key = `${row.trip_id}:${peerId}`;
    let entry = grouped.get(key);
    if (!entry) {
      entry = { tripId: row.trip_id, peerDisplayName: peers.get(peerId)?.displayName ?? "Usuario eliminado", messages: [] };
      grouped.set(key, entry);
    }
    const hidden = row.hidden_at !== null;
    entry.messages.push({
      id: row.id,
      direction: sent ? "sent" : "received",
      kind: row.kind,
      body: hidden && !sent ? null : row.body,
      location:
        row.kind === "location" && row.location_lat !== null && row.location_lng !== null && !(hidden && !sent)
          ? { lat: row.location_lat, lng: row.location_lng, label: row.location_label }
          : null,
      hidden,
      createdAt: iso(row.created_at)
    });
  }
  const items: unknown[] = [...grouped.values()].map(entry => ({ kind: "direct", ...entry }));

  // Grupos de ruta: los que ve ahora (miembro) y, si ya no es miembro, solo lo que envió.
  const groups = await db.query<{ id: string; driver_user_id: string; route_key: string }>(
    `select c.id, c.driver_user_id, c.route_key from chat_conversations c
      where c.kind = 'group'
        and (c.driver_user_id = $1
             or exists (select 1 from chat_participants p where p.conversation_id = c.id and p.user_id = $1)
             or exists (select 1 from chat_group_messages m where m.conversation_id = c.id and m.sender_user_id = $1))`,
    [userId]
  );
  for (const group of groups.rows) {
    let messages: ExportMessage[];
    try {
      const access = await resolveAccess(db, userId, group.id);
      const visible = await fetchMessageRows(db, access, userId, { limit: SECTION_LIMIT });
      messages = visible.reverse().map(row => {
        const sent = row.sender_user_id === userId;
        const hidden = row.hidden_at !== null;
        return {
          id: row.id,
          direction: sent ? "sent" : "received",
          kind: row.kind,
          body: hidden && !sent ? null : row.body,
          location:
            row.kind === "location" && row.location_lat !== null && row.location_lng !== null && !(hidden && !sent)
              ? { lat: row.location_lat, lng: row.location_lng, label: row.location_label }
              : null,
          hidden,
          createdAt: iso(row.created_at)
        };
      });
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      const own = await db.query<{
        id: string;
        kind: "text" | "location";
        body: string;
        location_lat: number | null;
        location_lng: number | null;
        location_label: string | null;
        hidden_at: Date | null;
        created_at: Date;
      }>(
        `select id, kind, body, location_lat, location_lng, location_label, hidden_at, created_at
           from chat_group_messages where conversation_id = $1 and sender_user_id = $2 order by seq limit ${SECTION_LIMIT}`,
        [group.id, userId]
      );
      messages = own.rows.map(row => ({
        id: row.id,
        direction: "sent" as const,
        kind: row.kind,
        body: row.body,
        location:
          row.kind === "location" && row.location_lat !== null && row.location_lng !== null
            ? { lat: row.location_lat, lng: row.location_lng, label: row.location_label }
            : null,
        hidden: row.hidden_at !== null,
        createdAt: iso(row.created_at)
      }));
    }
    if (messages.length === 0) continue;
    const route = (await loadRouteInfo(db, [{ id: group.id, kind: "group", trip_id: null, driver_user_id: group.driver_user_id, passenger_user_id: null, route_key: group.route_key, created_at: new Date(0) }])).get(group.id);
    items.push({ kind: "group", title: route ? groupTitle(route.provinceName, route.category) : "Ruta", messages });
  }
  return { items, truncated };
}

/* ───────────── Trabajo en segundo plano ───────────── */

async function putViaSignedUrl(deps: DataRightsDeps, key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const storage = deps.storage;
  if (!storageEnabled(storage)) throw err("PRIVATE_STORAGE_NOT_CONFIGURED", 503, "Almacenamiento privado no disponible.");
  const signed = await storage.createUploadUrl({ key, contentType, expiresInSeconds: 300 });
  const doFetch = deps.fetchImpl ?? fetch;
  const response = await doFetch(signed.url, { method: "PUT", headers: signed.headers, body: bytes });
  if (!response.ok) throw new Error(`EXPORT_UPLOAD_FAILED_${response.status}`);
}

async function runExport(deps: DataRightsDeps, job: ExportRow, now: Date): Promise<"ready" | "failed" | "blocked" | "retry"> {
  const { pool, config } = deps;
  const log = deps.log ?? silentLogger;
  const finish = async (status: DataExportStatus, errorCode: string | null) => {
    await pool.query(
      `update data_export_requests set status = $2, error_code = $3, updated_at = now() where id = $1`,
      [job.id, status, errorCode]
    );
  };
  try {
    if (!storageEnabled(deps.storage)) {
      await finish("blocked_storage_disabled", "PRIVATE_STORAGE_NOT_CONFIGURED");
      return "blocked";
    }
    const owner = await pool.query<{ status: string }>(`select status::text as status from app_users where id = $1`, [job.user_id]);
    if (!owner.rows[0] || owner.rows[0].status === "deleted") {
      await finish("failed", "ACCOUNT_DELETED");
      return "failed";
    }
    const data = await buildUserDataExport(pool, job.user_id, config, now);
    const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const key = ["users", job.user_id, "exports", `${job.id}.json`].join("/");
    await putViaSignedUrl(deps, key, bytes, "application/json");
    const info = await deps.storage.headObject(key);
    if (info.sizeBytes !== bytes.byteLength) throw new Error("EXPORT_SIZE_MISMATCH");

    const expiresAt = new Date(now.getTime() + config.exportTtlHours * 3_600_000);
    await tx(pool, async client => {
      await client.query(
        `update data_export_requests
            set status = 'ready', storage_provider = $2, storage_key = $3, size_bytes = $4, sha256 = $5,
                error_code = null, completed_at = now(), expires_at = $6, updated_at = now()
          where id = $1`,
        [job.id, deps.storage?.providerName ?? "unknown", key, bytes.byteLength, sha256, expiresAt]
      );
      await notify(client, {
        userId: job.user_id,
        category: "system",
        kind: "data_export_ready",
        title: "Tu exportación de datos está lista",
        body: `Ya puedes descargar tu archivo desde Ajustes → Privacidad y datos. Estará disponible ${Math.round(config.exportTtlHours / 24)} días.`,
        data: { exportId: job.id }
      });
      await writeAudit(client, {
        actorUserId: null,
        action: "privacy.export.completed",
        entityType: "data_export_request",
        entityId: job.id,
        metadata: { userId: job.user_id, sizeBytes: bytes.byteLength }
      });
    });
    return "ready";
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]{3,60}$/.test(error.message) ? error.message : "EXPORT_FAILED";
    log.error({ exportId: job.id, errorCode: code }, "data export failed");
    if (job.attempts >= MAX_ATTEMPTS) {
      await finish("failed", code);
      return "failed";
    }
    await finish("queued", code);
    return "retry";
  }
}

/** Procesa las exportaciones en cola (seguro con varias réplicas: `FOR UPDATE SKIP LOCKED`). */
export async function processQueuedDataExports(
  deps: DataRightsDeps,
  now: Date = new Date()
): Promise<{ processed: number; ready: number; failed: number; blocked: number; retried: number }> {
  const { pool } = deps;
  const summary = { processed: 0, ready: 0, failed: 0, blocked: 0, retried: 0 };
  // Trabajos «processing» abandonados (la réplica murió): vuelven a la cola o fallan tras agotar los intentos.
  await pool.query(
    `update data_export_requests
        set status = case when attempts >= $2 then 'failed' else 'queued' end, error_code = 'PROCESSING_TIMEOUT', updated_at = now()
      where status = 'processing' and started_at < now() - ($1 || ' minutes')::interval`,
    [String(STALE_PROCESSING_MINUTES), MAX_ATTEMPTS]
  );
  for (let guard = 0; guard < 100; guard += 1) {
    const claimed = await pool.query<ExportRow>(
      `update data_export_requests
          set status = 'processing', started_at = now(), attempts = attempts + 1, updated_at = now()
        where id = (select id from data_export_requests where status = 'queued' order by requested_at for update skip locked limit 1)
        returning ${EXPORT_COLUMNS}`
    );
    const job = claimed.rows[0];
    if (!job) break;
    summary.processed += 1;
    const outcome = await runExport(deps, job, now);
    if (outcome === "ready") summary.ready += 1;
    else if (outcome === "failed") summary.failed += 1;
    else if (outcome === "blocked") summary.blocked += 1;
    else summary.retried += 1;
    // Un reintento no debe volver a cogerse en el mismo ciclo.
    if (outcome === "retry") break;
  }
  return summary;
}

/** Retira las exportaciones caducadas (borra el archivo del almacenamiento y deja el registro como `expired`). */
export async function expireDataExports(deps: DataRightsDeps, now: Date = new Date()): Promise<{ expired: number }> {
  const { pool } = deps;
  const log = deps.log ?? silentLogger;
  const due = await pool.query<{ id: string; storage_key: string | null }>(
    `select id, storage_key from data_export_requests where status = 'ready' and expires_at <= $1 order by expires_at limit 100`,
    [now]
  );
  let expired = 0;
  for (const row of due.rows) {
    try {
      if (row.storage_key) {
        if (!deps.eraser) continue; // sin borrado posible se reintenta cuando haya almacenamiento; mientras, no es descargable
        await deps.eraser.deleteObjects([row.storage_key]);
      }
      await pool.query(
        `update data_export_requests set status = 'expired', storage_key = null, storage_provider = null, updated_at = now() where id = $1 and status = 'ready'`,
        [row.id]
      );
      expired += 1;
    } catch (error) {
      log.error({ exportId: row.id, error: error instanceof Error ? error.name : "unknown" }, "could not delete expired export");
    }
  }
  return { expired };
}

