import type { AuthPrincipal } from "../../auth/session.js";
import { writeAudit } from "../../lib/audit.js";
import { UUID_RE, clampLimit, decodeCursor, encodeCursor, iso, isoOrNull, nameParts, sliceOverflow, trustError } from "./common.js";
import type { Db, TrustContext } from "./context.js";
import { publicPhotoUrl } from "./public-photo-url.js";
import { tableExists } from "./summary.js";
import { requireStorage } from "./uploads.js";

/**
 * Atención al cliente del lado del personal. Lee/escribe las tablas de be-comms (migración 062; docs/contracts/comms.md §9).
 * Los disparadores de esa migración mantienen estado y notificación al usuario: aquí solo se inserta/actualiza lo indicado.
 */
export type TicketStatus = "open" | "answered" | "closed";
export type TicketCategory = "trip_issue" | "payment_issue" | "account_profile";

const CATEGORY_LABEL: Record<TicketCategory, string> = {
  trip_issue: "Problema con un viaje",
  payment_issue: "Problema de pago",
  account_profile: "Cuenta y perfil"
};

export async function requireSupportTables(db: Db): Promise<void> {
  if (!(await tableExists(db, "support_tickets")) || !(await tableExists(db, "support_ticket_messages"))) {
    throw trustError("SUPPORT_UNAVAILABLE", "La atención al cliente no está disponible todavía en este entorno.", 503);
  }
}

type TicketRow = {
  id: string;
  reference: string;
  status: TicketStatus;
  category: TicketCategory;
  user_id: string;
  trip_id: string | null;
  booking_id: string | null;
  body: string;
  assigned_to_user_id: string | null;
  assignee_name: string | null;
  last_user_message_at: Date;
  last_user_message_at_text: string;
  last_staff_message_at: Date | null;
  closed_at: Date | null;
  closed_by: string | null;
  created_at: Date;
  user_name: string | null;
  public_photo_key: string | null;
  public_photo_status: string | null;
  message_count: string;
  attachment_count: string;
};

const TICKET_SELECT = `
  select t.id, t.reference, t.status, t.category, t.user_id, t.trip_id, t.booking_id, t.body, t.assigned_to_user_id,
         ap.display_name as assignee_name, t.last_user_message_at,
         to_char(t.last_user_message_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as last_user_message_at_text,
         t.last_staff_message_at, t.closed_at, t.closed_by, t.created_at,
         up.display_name as user_name, up.public_photo_key, up.public_photo_status::text as public_photo_status,
         (select count(*) from support_ticket_messages m where m.ticket_id = t.id)::text as message_count,
         (select count(*) from support_attachments a where a.ticket_id = t.id)::text as attachment_count
    from support_tickets t
    left join profiles up on up.user_id = t.user_id
    left join profiles ap on ap.user_id = t.assigned_to_user_id`;

function toTicketRow(row: TicketRow) {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    category: row.category,
    categoryLabel: CATEGORY_LABEL[row.category],
    user: { id: row.user_id, ...nameParts(row.user_name), photoUrl: publicPhotoUrl(row.user_id, row.public_photo_key, row.public_photo_status) },
    preview: row.body.length > 140 ? `${row.body.slice(0, 137)}…` : row.body,
    createdAt: iso(row.created_at),
    lastUserMessageAt: iso(row.last_user_message_at),
    lastStaffMessageAt: isoOrNull(row.last_staff_message_at),
    assignedTo: row.assigned_to_user_id ? { id: row.assigned_to_user_id, displayName: row.assignee_name } : null,
    messageCount: Number(row.message_count),
    attachmentCount: Number(row.attachment_count),
    waitingForStaff: row.status === "open"
  };
}

export async function listTickets(
  db: Db,
  principal: AuthPrincipal,
  input: {
    status: TicketStatus | "all";
    category?: TicketCategory | undefined;
    assigned: "any" | "me" | "unassigned";
    cursor?: string | undefined;
    limit?: number | undefined;
  }
) {
  await requireSupportTables(db);
  const limit = clampLimit(input.limit);
  const params: unknown[] = [input.status === "all" ? null : input.status, input.category ?? null, input.assigned, principal.userId];
  let keyset = "";
  if (input.cursor) {
    const cursor = decodeCursor(input.cursor, { t: "iso", id: "uuid" });
    params.push(String(cursor.t), String(cursor.id));
    keyset = `and (t.last_user_message_at, t.id) < ($5::timestamptz, $6::uuid)`;
  }
  const rows = await db.query<TicketRow>(
    `${TICKET_SELECT}
      where ($1::text is null or t.status = $1::text) and ($2::text is null or t.category = $2::text)
        and ($3::text = 'any' or ($3::text = 'me' and t.assigned_to_user_id = $4::uuid) or ($3::text = 'unassigned' and t.assigned_to_user_id is null))
        ${keyset}
      order by t.last_user_message_at desc, t.id desc
      limit ${limit + 1}`,
    params
  );
  const { page, hasMore } = sliceOverflow(rows.rows, limit);
  const last = page[page.length - 1];
  const countsQ = await db.query<{ status: TicketStatus; n: string }>(`select status, count(*)::text as n from support_tickets group by status`);
  const counts = { open: 0, answered: 0, closed: 0 };
  for (const c of countsQ.rows) counts[c.status] = Number(c.n);
  return {
    items: page.map(toTicketRow),
    nextCursor: hasMore && last ? encodeCursor({ t: last.last_user_message_at_text, id: last.id }) : null,
    counts
  };
}

async function loadTicket(db: Db, ticketId: string): Promise<TicketRow> {
  if (!UUID_RE.test(ticketId)) throw trustError("TICKET_NOT_FOUND", "No existe esa consulta.", 404);
  const found = await db.query<TicketRow>(`${TICKET_SELECT} where t.id = $1`, [ticketId]);
  const row = found.rows[0];
  if (!row) throw trustError("TICKET_NOT_FOUND", "No existe esa consulta.", 404);
  return row;
}

export async function getTicketDetail(db: Db, ticketId: string) {
  await requireSupportTables(db);
  const ticket = await loadTicket(db, ticketId);
  const [messages, attachments] = await Promise.all([
    db.query<{ id: string; author_type: "user" | "staff"; author_user_id: string | null; author_name: string | null; body: string; created_at: Date }>(
      `select m.id, m.author_type, m.author_user_id, p.display_name as author_name, m.body, m.created_at
         from support_ticket_messages m left join profiles p on p.user_id = m.author_user_id
        where m.ticket_id = $1 order by m.created_at, m.id`,
      [ticketId]
    ),
    db.query<{ id: string; message_id: string | null; content_type: string; size_bytes: string | number; created_at: Date }>(
      `select id, message_id, content_type, size_bytes, created_at from support_attachments where ticket_id = $1 order by created_at, id`,
      [ticketId]
    )
  ]);
  const attachmentDto = (a: (typeof attachments.rows)[number]) => ({
    id: a.id,
    contentType: a.content_type,
    sizeBytes: Number(a.size_bytes),
    createdAt: iso(a.created_at)
  });
  return {
    ...toTicketRow(ticket),
    tripId: ticket.trip_id,
    bookingId: ticket.booking_id,
    closedAt: isoOrNull(ticket.closed_at),
    closedBy: (ticket.closed_by as "user" | "staff" | null) ?? null,
    messages: messages.rows.map(m => ({
      id: m.id,
      authorType: m.author_type,
      author: m.author_user_id ? { id: m.author_user_id, displayName: m.author_name } : null,
      body: m.body,
      createdAt: iso(m.created_at),
      attachments: attachments.rows.filter(a => a.message_id === m.id).map(attachmentDto)
    })),
    attachments: attachments.rows.filter(a => a.message_id === null).map(attachmentDto)
  };
}

export async function replyToTicket(ctx: TrustContext, principal: AuthPrincipal, ticketId: string, body: string, requestId: string) {
  await requireSupportTables(ctx.pool);
  const text = body.trim();
  if (text.length < 1 || text.length > 4000) {
    throw trustError("VALIDATION_ERROR", "La respuesta debe tener entre 1 y 4000 caracteres.", 400, {
      issues: [{ path: "body", message: "entre 1 y 4000 caracteres" }]
    });
  }
  if (!UUID_RE.test(ticketId)) throw trustError("TICKET_NOT_FOUND", "No existe esa consulta.", 404);
  const client = await ctx.pool.connect();
  let messageId: string;
  try {
    await client.query("begin");
    const found = await client.query<{ status: TicketStatus }>(`select status from support_tickets where id = $1 for update`, [ticketId]);
    const ticket = found.rows[0];
    if (!ticket) throw trustError("TICKET_NOT_FOUND", "No existe esa consulta.", 404);
    if (ticket.status === "closed") throw trustError("TICKET_CLOSED", "La consulta está cerrada: no admite más respuestas.", 409);
    // El disparador de la migración 062 pasa el ticket a «answered», fija last_staff_message_at y avisa a la persona usuaria.
    const inserted = await client.query<{ id: string }>(
      `insert into support_ticket_messages(ticket_id, author_type, author_user_id, body) values($1,'staff',$2,$3) returning id`,
      [ticketId, principal.userId, text]
    );
    messageId = inserted.rows[0]!.id;
    await writeAudit(client, {
      actorUserId: principal.userId,
      action: "admin.support.ticket_replied",
      entityType: "support_ticket",
      entityId: ticketId,
      requestId,
      metadata: { messageId, length: text.length }
    });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return getTicketDetail(ctx.pool, ticketId);
}

export async function assignTicket(ctx: TrustContext, principal: AuthPrincipal, ticketId: string, assignee: "me" | "none", requestId: string) {
  await requireSupportTables(ctx.pool);
  const ticket = await loadTicket(ctx.pool, ticketId);
  await ctx.pool.query(`update support_tickets set assigned_to_user_id = $2 where id = $1`, [ticketId, assignee === "me" ? principal.userId : null]);
  await writeAudit(ctx.pool, {
    actorUserId: principal.userId,
    action: "admin.support.ticket_assigned",
    entityType: "support_ticket",
    entityId: ticketId,
    requestId,
    metadata: { assignee, previousAssigneeId: ticket.assigned_to_user_id }
  });
  return getTicketDetail(ctx.pool, ticketId);
}

export async function closeTicket(ctx: TrustContext, principal: AuthPrincipal, ticketId: string, requestId: string) {
  await requireSupportTables(ctx.pool);
  if (!UUID_RE.test(ticketId)) throw trustError("TICKET_NOT_FOUND", "No existe esa consulta.", 404);
  const client = await ctx.pool.connect();
  try {
    await client.query("begin");
    const found = await client.query<{ status: TicketStatus }>(`select status from support_tickets where id = $1 for update`, [ticketId]);
    const ticket = found.rows[0];
    if (!ticket) throw trustError("TICKET_NOT_FOUND", "No existe esa consulta.", 404);
    if (ticket.status === "closed") throw trustError("TICKET_ALREADY_CLOSED", "La consulta ya está cerrada.", 409);
    await client.query(`update support_tickets set status = 'closed', closed_at = now(), closed_by = 'staff' where id = $1`, [ticketId]);
    await writeAudit(client, {
      actorUserId: principal.userId,
      action: "admin.support.ticket_closed",
      entityType: "support_ticket",
      entityId: ticketId,
      requestId,
      metadata: { previousStatus: ticket.status }
    });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return getTicketDetail(ctx.pool, ticketId);
}

/** Adjunto de soporte: URL firmada de vida corta + auditoría ANTES de devolverla (falla cerrado). */
export async function issueAttachmentAccess(
  ctx: TrustContext,
  principal: AuthPrincipal,
  attachmentId: string,
  input: { note?: string | undefined },
  requestId: string
) {
  await requireSupportTables(ctx.pool);
  if (!UUID_RE.test(attachmentId)) throw trustError("ATTACHMENT_NOT_FOUND", "No existe ese adjunto.", 404);
  const found = await ctx.pool.query<{ ticket_id: string | null; owner_user_id: string; storage_provider: string; storage_key: string; content_type: string }>(
    `select ticket_id, owner_user_id, storage_provider, storage_key, content_type from support_attachments where id = $1`,
    [attachmentId]
  );
  const row = found.rows[0];
  if (!row || !row.ticket_id) throw trustError("ATTACHMENT_NOT_FOUND", "No existe ese adjunto.", 404);
  if (row.owner_user_id === principal.userId) {
    throw trustError("SELF_REVIEW_FORBIDDEN", "No puedes acceder a tus propios adjuntos desde el panel.", 403);
  }
  const storage = requireStorage(ctx);
  if (row.storage_provider !== storage.providerName) {
    throw trustError("EVIDENCE_STORAGE_MISMATCH", "El archivo está en otro proveedor de almacenamiento.", 409);
  }
  const ttl = ctx.config.signedUrlTtlSeconds;
  const url = await storage.createDownloadUrl(row.storage_key, ttl);
  const note = input.note?.trim() || null;
  await writeAudit(ctx.pool, {
    actorUserId: principal.userId,
    action: "admin.support.attachment_access_url_issued",
    entityType: "support_attachment",
    entityId: attachmentId,
    requestId,
    metadata: { ticketId: row.ticket_id, purpose: "support_case", ...(note ? { note } : {}), ttlSeconds: ttl, ownerUserId: row.owner_user_id, contentType: row.content_type }
  });
  return {
    url,
    expiresAt: new Date(ctx.now().getTime() + ttl * 1000).toISOString(),
    ttlSeconds: ttl,
    contentType: row.content_type,
    attachmentId
  };
}
