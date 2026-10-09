import type { Pool } from "pg";
import { writeAudit } from "../../lib/audit.js";
import { groupVisibilitySql, loadConversation, resolveAccess, type ConversationRow } from "./chat-access.js";
import {
  containsNul,
  decodeTimeIdCursor,
  encodeCursor,
  iso,
  isoOrNull,
  loadPublicUsers,
  pageLimit,
  tsUs,
  tx,
  type PublicUserDto,
  type Queryable
} from "./common.js";
import type { CommsConfig } from "./config.js";
import { err } from "./errors.js";

/* ───────────── Bloqueados ───────────── */

export type BlockedUserDto = { user: PublicUserDto; blockedAt: string };

export async function listBlockedUsers(
  db: Queryable,
  userId: string,
  input: { limit?: number; cursor?: string },
  config: CommsConfig
): Promise<{ items: BlockedUserDto[]; nextCursor: string | null }> {
  const limit = pageLimit(input.limit);
  const params: unknown[] = [userId];
  let where = "ub.blocker_user_id = $1";
  if (input.cursor) {
    const cursor = decodeTimeIdCursor(input.cursor);
    params.push(cursor.t, cursor.id);
    where += ` and (ub.created_at, ub.blocked_user_id) < ($2::timestamptz, $3::uuid)`;
  }
  params.push(limit + 1);
  const rows = await db.query<{ blocked_user_id: string; created_at: Date; created_us: string }>(
    `select ub.blocked_user_id, ub.created_at, ${tsUs("ub.created_at")} as created_us
       from user_blocks ub
      where ${where}
      order by ub.created_at desc, ub.blocked_user_id desc
      limit $${params.length}`,
    params
  );
  const page = rows.rows.slice(0, limit);
  const users = await loadPublicUsers(db, page.map(row => row.blocked_user_id), config);
  const items: BlockedUserDto[] = [];
  for (const row of page) {
    const user = users.get(row.blocked_user_id);
    if (user) items.push({ user, blockedAt: iso(row.created_at) });
  }
  const last = page[page.length - 1];
  return { items, nextCursor: rows.rows.length > limit && last ? encodeCursor({ t: last.created_us, id: last.blocked_user_id }) : null };
}

/* ───────────── Denuncias ───────────── */

export type ReportReason = "harassment" | "unsafe_behavior" | "inappropriate_content" | "spam_or_fraud" | "no_show" | "other";
export type ReportStatus = "open" | "in_review" | "actioned" | "dismissed";

export type UserReportDto = {
  id: string;
  reportedUser: PublicUserDto;
  reason: ReportReason;
  details: string | null;
  tripId: string | null;
  conversationId: string | null;
  evidenceCount: number;
  status: ReportStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

type ReportRow = {
  id: string;
  reported_user_id: string;
  reason: ReportReason;
  details: string | null;
  trip_id: string | null;
  conversation_id: string | null;
  status: ReportStatus;
  evidence_count: number;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
  created_us: string;
};

const REPORT_COLUMNS = `r.id, r.reported_user_id, r.reason, r.details, r.trip_id, r.conversation_id, r.status,
  (select count(*)::int from user_report_evidence e where e.report_id = r.id) as evidence_count,
  r.created_at, r.updated_at, r.resolved_at, ${tsUs("r.created_at")} as created_us`;

async function toReportDtos(db: Queryable, rows: ReportRow[], config: CommsConfig): Promise<UserReportDto[]> {
  const users = await loadPublicUsers(db, rows.map(row => row.reported_user_id), config);
  const out: UserReportDto[] = [];
  for (const row of rows) {
    const reportedUser = users.get(row.reported_user_id);
    if (!reportedUser) continue;
    out.push({
      id: row.id,
      reportedUser,
      reason: row.reason,
      details: row.details,
      tripId: row.trip_id,
      conversationId: row.conversation_id,
      evidenceCount: row.evidence_count,
      status: row.status,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      resolvedAt: isoOrNull(row.resolved_at)
    });
  }
  return out;
}

export async function listMyReports(
  db: Queryable,
  userId: string,
  input: { limit?: number; cursor?: string },
  config: CommsConfig
): Promise<{ items: UserReportDto[]; nextCursor: string | null }> {
  const limit = pageLimit(input.limit);
  const params: unknown[] = [userId];
  let where = "r.reporter_user_id = $1";
  if (input.cursor) {
    const cursor = decodeTimeIdCursor(input.cursor);
    params.push(cursor.t, cursor.id);
    where += ` and (r.created_at, r.id) < ($2::timestamptz, $3::uuid)`;
  }
  params.push(limit + 1);
  const rows = await db.query<ReportRow>(
    `select ${REPORT_COLUMNS} from user_reports r where ${where} order by r.created_at desc, r.id desc limit $${params.length}`,
    params
  );
  const page = rows.rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: await toReportDtos(db, page, config),
    nextCursor: rows.rows.length > limit && last ? encodeCursor({ t: last.created_us, id: last.id }) : null
  };
}

async function loadReport(db: Queryable, reportId: string, config: CommsConfig): Promise<UserReportDto> {
  const rows = await db.query<ReportRow>(`select ${REPORT_COLUMNS} from user_reports r where r.id = $1`, [reportId]);
  const [dto] = await toReportDtos(db, rows.rows, config);
  if (!dto) throw new Error("report not found after insert");
  return dto;
}

/* ───────────── Relación entre las dos personas ───────────── */

/** ¿Comparten (o compartieron) un viaje con reserva o una conversación? Solo entonces puede una denunciar a la otra. */
async function haveSharedContext(db: Queryable, a: string, b: string): Promise<boolean> {
  const result = await db.query(
    `select 1 where
        exists (select 1 from trips t
                 where t.driver_user_id = $1
                   and exists (select 1 from ride_requests r join bookings bk on bk.request_id = r.id
                                where r.trip_id = t.id and r.passenger_user_id = $2))
     or exists (select 1 from trips t
                 where t.driver_user_id = $2
                   and exists (select 1 from ride_requests r join bookings bk on bk.request_id = r.id
                                where r.trip_id = t.id and r.passenger_user_id = $1))
     or exists (select 1
                  from ride_requests r1 join bookings b1 on b1.request_id = r1.id
                  join ride_requests r2 on r2.trip_id = r1.trip_id and r2.passenger_user_id = $2
                  join bookings b2 on b2.request_id = r2.id
                 where r1.passenger_user_id = $1)
     or exists (select 1 from chat_participants p1
                  join chat_participants p2 on p2.conversation_id = p1.conversation_id
                 where p1.user_id = $1 and p2.user_id = $2)
     or exists (select 1 from chat_conversations c join chat_participants p on p.conversation_id = c.id
                 where c.kind = 'group'
                   and ((c.driver_user_id = $1 and p.user_id = $2) or (c.driver_user_id = $2 and p.user_id = $1)))`,
    [a, b]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Participó en el viaje: conductor o pasajero con reserva (de cualquier estado). */
export async function involvedInTrip(db: Queryable, tripId: string, userId: string): Promise<boolean> {
  const result = await db.query<{ ok: boolean }>(
    `select exists (
        select 1 from trips t
         where t.id = $1
           and (t.driver_user_id = $2
             or exists (select 1 from ride_requests r join bookings bk on bk.request_id = r.id
                         where r.trip_id = t.id and r.passenger_user_id = $2))
     ) as ok`,
    [tripId, userId]
  );
  return result.rows[0]?.ok === true;
}

/** Parte de la conversación aunque ya no tenga acceso (para poder denunciar hechos pasados). */
async function involvedInConversation(db: Queryable, conversation: ConversationRow, userId: string): Promise<boolean> {
  if (conversation.kind === "direct") {
    return userId === conversation.driver_user_id || userId === conversation.passenger_user_id;
  }
  if (userId === conversation.driver_user_id) return true;
  const result = await db.query(
    `select 1 from chat_participants where conversation_id = $1 and user_id = $2
     union all
     select 1 from chat_group_messages where conversation_id = $1 and sender_user_id = $2
     limit 1`,
    [conversation.id, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

/* ───────────── Prueba (copia literal) ───────────── */

type EvidenceMessage = {
  id: string;
  source: "direct" | "group";
  senderId: string;
  kind: "text" | "location";
  body: string;
  lat: number | null;
  lng: number | null;
  createdAt: Date;
};

type EvidenceRaw = {
  id: string;
  sender_user_id: string;
  kind: "text" | "location";
  body: string;
  location_lat: number | null;
  location_lng: number | null;
  created_at: Date;
};

/** Mensajes de `ids` que `reporterId` puede ver en la conversación (nunca los retirados por moderación). */
async function loadEvidenceMessages(db: Queryable, reporterId: string, conversation: ConversationRow, ids: string[]): Promise<EvidenceMessage[]> {
  if (ids.length === 0) return [];
  if (conversation.kind === "direct") {
    if (conversation.trip_id === null || conversation.passenger_user_id === null) return [];
    const rows = await db.query<EvidenceRaw>(
      `select m.id, m.sender_user_id, m.kind, m.body, m.location_lat, m.location_lng, m.created_at
         from trip_direct_messages m
        where m.id = any($1::uuid[]) and m.trip_id = $2 and m.hidden_at is null
          and ((m.sender_user_id = $3 and m.recipient_user_id = $4) or (m.sender_user_id = $4 and m.recipient_user_id = $3))`,
      [ids, conversation.trip_id, conversation.driver_user_id, conversation.passenger_user_id]
    );
    return rows.rows.map(row => ({
      id: row.id,
      source: "direct" as const,
      senderId: row.sender_user_id,
      kind: row.kind,
      body: row.body,
      lat: row.location_lat,
      lng: row.location_lng,
      createdAt: row.created_at
    }));
  }
  // Grupo: hace falta seguir siendo miembro para saber desde cuándo ve mensajes y a quién tiene bloqueado.
  let access;
  try {
    access = await resolveAccess(db, reporterId, conversation.id);
  } catch {
    return [];
  }
  if (access.kind !== "group") return [];
  const rows = await db.query<EvidenceRaw>(
    `select m.id, m.sender_user_id, m.kind, m.body, m.location_lat, m.location_lng, m.created_at
       from chat_group_messages m
      where m.id = any($1::uuid[]) and m.conversation_id = $2 and m.hidden_at is null and ${groupVisibilitySql("$3", "$4")}`,
    [ids, conversation.id, reporterId, access.visibleFrom]
  );
  return rows.rows.map(row => ({
    id: row.id,
    source: "group" as const,
    senderId: row.sender_user_id,
    kind: row.kind,
    body: row.body,
    lat: row.location_lat,
    lng: row.location_lng,
    createdAt: row.created_at
  }));
}

/* ───────────── Crear denuncia ───────────── */

export type CreateReportInput = {
  reportedUserId: string;
  reason: ReportReason;
  details?: string | undefined;
  tripId?: string | undefined;
  conversationId?: string | undefined;
  evidenceMessageIds?: string[] | undefined;
  idempotencyKey?: string | undefined;
};

const MAX_EVIDENCE = 10;
const MAX_REPORTS_PER_DAY = 10;

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every(item => set.has(item));
}

export async function createUserReport(
  pool: Pool,
  reporterId: string,
  input: CreateReportInput,
  config: CommsConfig,
  requestId?: string | null
): Promise<{ report: UserReportDto; created: boolean }> {
  const details = input.details?.trim() ? input.details.trim() : null;
  if (details !== null && (details.length > 1000 || containsNul(details))) {
    throw err("VALIDATION_ERROR", 400, "Los detalles de la denuncia no pueden superar los 1000 caracteres.");
  }
  if (input.reportedUserId === reporterId) {
    throw err("REPORT_SELF_FORBIDDEN", 400, "No puedes denunciarte a ti mismo.");
  }
  const evidenceIds = [...new Set(input.evidenceMessageIds ?? [])];
  if (evidenceIds.length > MAX_EVIDENCE) {
    throw err("REPORT_EVIDENCE_INVALID", 422, `Puedes aportar como máximo ${MAX_EVIDENCE} mensajes como prueba.`);
  }
  if (evidenceIds.length > 0 && !input.conversationId) {
    throw err("REPORT_EVIDENCE_INVALID", 422, "Indica la conversación de la que proceden los mensajes de prueba.");
  }

  const reportId = await tx(pool, async client => {
    // Serializa las denuncias de la misma persona: límites y duplicados sin carreras.
    await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`user_report:${reporterId}`]);

    if (input.idempotencyKey) {
      const existing = await client.query<{
        id: string;
        reported_user_id: string;
        reason: string;
        details: string | null;
        trip_id: string | null;
        conversation_id: string | null;
        evidence_ids: string[];
      }>(
        `select r.id, r.reported_user_id, r.reason, r.details, r.trip_id, r.conversation_id,
                coalesce((select array_agg(e.message_id::text) from user_report_evidence e where e.report_id = r.id), '{}') as evidence_ids
           from user_reports r where r.reporter_user_id = $1 and r.idempotency_key = $2`,
        [reporterId, input.idempotencyKey]
      );
      const row = existing.rows[0];
      if (row) {
        const same =
          row.reported_user_id === input.reportedUserId &&
          row.reason === input.reason &&
          (row.details ?? null) === details &&
          (row.trip_id ?? null) === (input.tripId ?? null) &&
          (row.conversation_id ?? null) === (input.conversationId ?? null) &&
          sameSet(row.evidence_ids, evidenceIds);
        if (!same) throw err("REPORT_IDEMPOTENCY_CONFLICT", 409, "Esa clave de idempotencia ya se usó con otra denuncia.");
        return { id: row.id, created: false };
      }
    }

    const reported = await client.query<{ status: string }>(`select status from app_users where id = $1`, [input.reportedUserId]);
    if (!reported.rows[0] || reported.rows[0].status === "deleted") {
      throw err("USER_NOT_FOUND", 404, "No encontramos a esa persona.");
    }
    if (!(await haveSharedContext(client, reporterId, input.reportedUserId))) {
      throw err("REPORT_NOT_RELATED", 403, "Solo puedes denunciar a personas con las que has compartido un viaje o una conversación.");
    }
    if (input.tripId) {
      const [mine, theirs] = await Promise.all([
        involvedInTrip(client, input.tripId, reporterId),
        involvedInTrip(client, input.tripId, input.reportedUserId)
      ]);
      if (!mine || !theirs) {
        throw err("REPORT_NOT_RELATED", 403, "Ese viaje no corresponde a ninguna reserva compartida con la persona denunciada.");
      }
    }

    let evidence: EvidenceMessage[] = [];
    let conversation: ConversationRow | null = null;
    if (input.conversationId) {
      conversation = await loadConversation(client, input.conversationId);
      const parties = conversation
        ? await Promise.all([
            involvedInConversation(client, conversation, reporterId),
            involvedInConversation(client, conversation, input.reportedUserId)
          ])
        : [false, false];
      if (!conversation || !parties[0] || !parties[1]) {
        throw err("REPORT_NOT_RELATED", 403, "Esa conversación no incluye a las dos personas.");
      }
      evidence = await loadEvidenceMessages(client, reporterId, conversation, evidenceIds);
      const valid =
        evidence.length === evidenceIds.length &&
        evidence.every(message => message.senderId === reporterId || message.senderId === input.reportedUserId);
      if (!valid) {
        throw err(
          "REPORT_EVIDENCE_INVALID",
          422,
          "Alguno de los mensajes de prueba no existe, no es de esa conversación o ya no puedes verlo."
        );
      }
    }

    const duplicate = await client.query(
      `select 1 from user_reports
        where reporter_user_id = $1 and reported_user_id = $2 and reason = $3 and created_at > now() - interval '24 hours'
        limit 1`,
      [reporterId, input.reportedUserId, input.reason]
    );
    if ((duplicate.rowCount ?? 0) > 0) {
      throw err("REPORT_ALREADY_FILED", 409, "Ya denunciaste a esta persona por el mismo motivo en las últimas 24 horas. Nuestro equipo lo está revisando.");
    }
    const today = await client.query<{ total: number }>(
      `select count(*)::int as total from user_reports where reporter_user_id = $1 and created_at > now() - interval '24 hours'`,
      [reporterId]
    );
    if ((today.rows[0]?.total ?? 0) >= MAX_REPORTS_PER_DAY) {
      throw err("REPORT_RATE_LIMITED", 429, "Has alcanzado el máximo de denuncias de hoy. Inténtalo de nuevo mañana o contacta con el centro de ayuda.");
    }

    const inserted = await client.query<{ id: string }>(
      `insert into user_reports(reporter_user_id, reported_user_id, reason, details, trip_id, conversation_id, idempotency_key)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [reporterId, input.reportedUserId, input.reason, details, input.tripId ?? null, input.conversationId ?? null, input.idempotencyKey ?? null]
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error("report insert returned no row");
    for (const message of evidence) {
      await client.query(
        `insert into user_report_evidence(report_id, message_source, message_id, sender_user_id, kind, body, location_lat, location_lng, message_created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, message.source, message.id, message.senderId, message.kind, message.body, message.lat, message.lng, message.createdAt]
      );
    }
    await writeAudit(client, {
      actorUserId: reporterId,
      action: "chat.report.created",
      entityType: "user_report",
      entityId: id,
      requestId: requestId ?? null,
      metadata: {
        reportedUserId: input.reportedUserId,
        reason: input.reason,
        tripId: input.tripId ?? null,
        conversationId: input.conversationId ?? null,
        evidenceCount: evidence.length
      }
    });
    return { id, created: true };
  });

  return { report: await loadReport(pool, reportId.id, config), created: reportId.created };
}

/* ───────────── Denunciar un mensaje concreto ───────────── */

export async function reportChatMessage(
  pool: Pool,
  reporterId: string,
  conversationId: string,
  messageId: string,
  input: { reason: ReportReason; details?: string | undefined; idempotencyKey?: string | undefined },
  config: CommsConfig,
  requestId?: string | null
): Promise<{ report: UserReportDto; created: boolean }> {
  const notFound = () => err("MESSAGE_NOT_FOUND", 404, "No encontramos ese mensaje.");
  const conversation = await loadConversation(pool, conversationId);
  if (!conversation || !(await involvedInConversation(pool, conversation, reporterId))) throw notFound();

  const [message] = await loadEvidenceMessages(pool, reporterId, conversation, [messageId]);
  if (!message) throw notFound();
  if (message.senderId === reporterId) {
    throw err("REPORT_SELF_FORBIDDEN", 400, "No puedes denunciar un mensaje tuyo.");
  }
  return createUserReport(
    pool,
    reporterId,
    {
      reportedUserId: message.senderId,
      reason: input.reason,
      details: input.details,
      ...(conversation.kind === "direct" && conversation.trip_id ? { tripId: conversation.trip_id } : {}),
      conversationId,
      evidenceMessageIds: [messageId],
      idempotencyKey: input.idempotencyKey
    },
    config,
    requestId
  );
}
