/**
 * Visor de auditoría (pestaña «Auditoría»): filtros, paginación y datos personales ocultos.
 * Espejo de `src/modules/trust/audit-browser.ts`. Lee la tabla `audit_events` del núcleo (`db.audit`).
 */
import type { AdminAuditEvent, AdminAuditPage } from "@/api/types";
import { fail, writeAudit, type PreviewDb, type Principal } from "@/preview";
import { actorRef, iso, redactMetadata, sliceOf } from "./common";

export interface AuditFilters {
  actorUserId?: string | undefined;
  action?: string | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

const SIMPLE = /^[A-Za-z0-9_.:-]{1,100}$/;

function invalid(field: string, message: string): never {
  return fail("AUDIT_FILTER_INVALID", "Los filtros de auditoría no son válidos.", 422, { fields: [{ field, message }] });
}

export function listAuditEvents(db: PreviewDb, filters: AuditFilters): AdminAuditPage {
  let actionExact: string | null = null;
  let actionPrefix: string | null = null;
  if (filters.action !== undefined) {
    const prefix = filters.action.endsWith("*");
    const base = prefix ? filters.action.slice(0, -1) : filters.action;
    if (!SIMPLE.test(base) || (prefix && base.length === 0)) invalid("action", "texto sin espacios; admite «*» solo al final");
    if (prefix) actionPrefix = base;
    else actionExact = base;
  }
  if (filters.entityType !== undefined && !SIMPLE.test(filters.entityType)) invalid("entityType", "texto sin espacios");
  if (filters.entityId !== undefined && (filters.entityId.length < 1 || filters.entityId.length > 200)) invalid("entityId", "entre 1 y 200 caracteres");
  let fromMs: number | null = null;
  let toMs: number | null = null;
  if (filters.from !== undefined) {
    fromMs = Date.parse(filters.from);
    if (Number.isNaN(fromMs)) invalid("from", "fecha ISO-8601 válida");
  }
  if (filters.to !== undefined) {
    toMs = Date.parse(filters.to);
    if (Number.isNaN(toMs)) invalid("to", "fecha ISO-8601 válida");
  }
  if (fromMs !== null && toMs !== null && fromMs >= toMs) invalid("from", "debe ser anterior a «to»");

  const rows = db.audit
    .filter(
      (row) =>
        (filters.actorUserId === undefined || row.actor_user_id === filters.actorUserId) &&
        (actionExact === null || row.action === actionExact) &&
        (actionPrefix === null || row.action.startsWith(actionPrefix)) &&
        (filters.entityType === undefined || row.entity_type === filters.entityType) &&
        (filters.entityId === undefined || row.entity_id === filters.entityId) &&
        (fromMs === null || row.created_at >= fromMs) &&
        (toMs === null || row.created_at < toMs),
    )
    // Más recientes primero: el id es un contador (`bigserial`), así que manda el orden de inserción.
    .sort((a, b) => Number(b.id) - Number(a.id));
  const page = sliceOf(rows, filters.cursor, filters.limit);
  return {
    items: page.items.map((row): AdminAuditEvent => {
      const redacted = redactMetadata(row.metadata);
      return {
        id: row.id,
        createdAt: iso(row.created_at),
        actor: actorRef(db, row.actor_user_id),
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        requestId: row.request_id,
        metadata: redacted.value,
        redactions: redacted.redactions,
      };
    }),
    nextCursor: page.nextCursor,
  };
}

/** Auditoría de una operación del panel (falla cerrado: si no se pudiera auditar, la petición falla). */
export function auditAdmin(
  db: PreviewDb,
  requestId: string,
  principal: Principal,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
): void {
  writeAudit(db, { actorUserId: principal.userId, action, entityType, entityId, requestId, metadata });
}
