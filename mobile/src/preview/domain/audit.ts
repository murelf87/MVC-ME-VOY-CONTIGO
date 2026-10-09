/** Registro auditable (tabla `audit_events`). Equivale a `writeAudit` de `src/lib/audit.ts`. */
import type { PreviewDb } from "../core/db";

export interface AuditInput {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}

export function writeAudit(db: PreviewDb, input: AuditInput): void {
  db.audit.insert({
    id: String(db.ids.seq("audit_events")),
    actor_user_id: input.actorUserId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    request_id: input.requestId ?? null,
    metadata: input.metadata ?? {},
    created_at: db.nowMs(),
  });
}
