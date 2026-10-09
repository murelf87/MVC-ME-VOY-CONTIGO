-- Módulo trust · índices para el visor de auditoría (GET /v1/admin/audit-events).
-- `audit_events` es de la base (001); aquí solo se añaden índices (idempotentes).

create index if not exists audit_events_created_idx on audit_events(created_at desc, id desc);
create index if not exists audit_events_actor_idx on audit_events(actor_user_id, id desc) where actor_user_id is not null;
create index if not exists audit_events_action_idx on audit_events(action text_pattern_ops, id desc);
create index if not exists audit_events_entity_idx on audit_events(entity_type, entity_id, id desc);
