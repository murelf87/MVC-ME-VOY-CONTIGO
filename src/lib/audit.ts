import type { Pool, PoolClient } from "pg";

type Queryable = Pick<PoolClient, "query"> | Pick<Pool, "query">;

export type AuditInput = {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  requestId?: string | null;
  /** Sin datos personales innecesarios: identificadores, estados, importes en céntimos. */
  metadata?: Record<string, unknown>;
};

/** Registro auditable de operaciones sensibles (tabla audit_events). */
export async function writeAudit(db: Queryable, input: AuditInput): Promise<void> {
  await db.query(
    `insert into audit_events(actor_user_id,action,entity_type,entity_id,request_id,metadata)
     values($1,$2,$3,$4,$5,$6::jsonb)`,
    [input.actorUserId, input.action, input.entityType, input.entityId ?? null, input.requestId ?? null, JSON.stringify(input.metadata ?? {})]
  );
}
