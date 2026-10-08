-- Private files whose owner deleted the account. Rows are queued in the same transaction as the
-- deletion and removed from storage afterwards (npm run storage:purge), so a storage outage never
-- leaves an account half deleted or a file silently forgotten.
create table if not exists storage_purge_queue (
  id bigserial primary key,
  storage_provider text not null,
  storage_key text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  purged_at timestamptz,
  unique (storage_provider, storage_key)
);
create index if not exists storage_purge_queue_pending on storage_purge_queue(created_at) where purged_at is null;

alter table app_users add column if not exists deleted_at timestamptz;
