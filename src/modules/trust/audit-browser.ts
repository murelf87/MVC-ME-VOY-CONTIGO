import { clampLimit, decodeCursor, encodeCursor, iso, sliceOverflow, trustError } from "./common.js";
import type { Db } from "./context.js";
import { redactMetadata } from "./redaction.js";

export type AuditFilters = {
  actorUserId?: string | undefined;
  action?: string | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
};

type Row = {
  id: string;
  created_at: Date;
  actor_user_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  request_id: string | null;
  metadata: unknown;
};

const SIMPLE = /^[A-Za-z0-9_.:-]{1,100}$/;

function invalid(field: string, message: string): never {
  throw trustError("AUDIT_FILTER_INVALID", "Los filtros de auditoría no son válidos.", 422, { fields: [{ field, message }] });
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/** Visor de auditoría con filtros, paginación por cursor y redacción de datos personales. */
export async function listAuditEvents(db: Db, filters: AuditFilters) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };

  if (filters.actorUserId) add("e.actor_user_id = ?::uuid", filters.actorUserId);
  if (filters.action !== undefined) {
    const prefix = filters.action.endsWith("*");
    const base = prefix ? filters.action.slice(0, -1) : filters.action;
    if (!SIMPLE.test(base) || (prefix && base.length === 0)) invalid("action", "texto sin espacios; admite «*» solo al final");
    if (prefix) add("e.action like ? escape '\\'", `${escapeLike(base)}%`);
    else add("e.action = ?", base);
  }
  if (filters.entityType !== undefined) {
    if (!SIMPLE.test(filters.entityType)) invalid("entityType", "texto sin espacios");
    add("e.entity_type = ?", filters.entityType);
  }
  if (filters.entityId !== undefined) {
    if (filters.entityId.length < 1 || filters.entityId.length > 200) invalid("entityId", "entre 1 y 200 caracteres");
    add("e.entity_id = ?", filters.entityId);
  }
  let fromMs: number | null = null;
  let toMs: number | null = null;
  if (filters.from !== undefined) {
    fromMs = Date.parse(filters.from);
    if (Number.isNaN(fromMs)) invalid("from", "fecha ISO-8601 válida");
    add("e.created_at >= ?::timestamptz", new Date(fromMs).toISOString());
  }
  if (filters.to !== undefined) {
    toMs = Date.parse(filters.to);
    if (Number.isNaN(toMs)) invalid("to", "fecha ISO-8601 válida");
    add("e.created_at < ?::timestamptz", new Date(toMs).toISOString());
  }
  if (fromMs !== null && toMs !== null && fromMs >= toMs) invalid("from", "debe ser anterior a «to»");
  if (filters.cursor) {
    const cursor = decodeCursor(filters.cursor, { id: "bigint" });
    add("e.id < ?::bigint", String(cursor.id));
  }

  const limit = clampLimit(filters.limit);
  const rows = await db.query<Row>(
    `select e.id::text as id, e.created_at, e.actor_user_id, p.display_name as actor_name, e.action, e.entity_type, e.entity_id,
            e.request_id, e.metadata
       from audit_events e
       left join profiles p on p.user_id = e.actor_user_id
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by e.id desc
      limit ${limit + 1}`,
    params
  );
  const { page, hasMore } = sliceOverflow(rows.rows, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(r => {
      const redacted = redactMetadata(r.metadata);
      return {
        id: r.id,
        createdAt: iso(r.created_at),
        actor: r.actor_user_id ? { id: r.actor_user_id, displayName: r.actor_name } : null,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        requestId: r.request_id,
        metadata: redacted.value,
        redactions: redacted.redactions
      };
    }),
    nextCursor: hasMore && last ? encodeCursor({ id: last.id }) : null
  };
}
