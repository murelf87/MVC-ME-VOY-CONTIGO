-- comms · derechos sobre los datos (RGPD): exportación y eliminación de cuenta.
-- Solo referencia tablas base (001–012). Las filas de estas tablas se conservan tras anonimizar la cuenta
-- (app_users no se borra: queda con status='deleted' y sin teléfono) para poder demostrar el cumplimiento.

create table data_export_requests(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued','processing','ready','failed','blocked_storage_disabled','expired')),
  format text not null default 'json' check (format = 'json'),
  idempotency_key uuid,
  storage_provider text,
  storage_key text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  sha256 char(64) check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  error_code text,
  attempts integer not null default 0 check (attempts >= 0),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  last_downloaded_at timestamptz,
  updated_at timestamptz not null default now()
);
create index data_export_requests_user_idx on data_export_requests(user_id, requested_at desc, id desc);
create index data_export_requests_queue_idx on data_export_requests(status, requested_at) where status in ('queued','processing');
create unique index data_export_requests_idempotency_uidx on data_export_requests(user_id, idempotency_key) where idempotency_key is not null;

create table account_deletion_requests(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  status text not null default 'scheduled' check (status in ('scheduled','blocked','processing','completed','cancelled')),
  reason text check (reason is null or char_length(reason) <= 500),
  requested_at timestamptz not null default now(),
  -- Fin del periodo de gracia: a partir de aquí el trabajo periódico puede ejecutarla.
  scheduled_for timestamptz not null,
  cancelled_at timestamptz,
  completed_at timestamptz,
  -- Bloqueos detectados en la última comprobación: [{code,message,count}]
  last_blockers jsonb not null default '[]'::jsonb,
  -- Qué hizo la ejecución (conteos), sin datos personales.
  erasure_summary jsonb,
  last_error text,
  updated_at timestamptz not null default now()
);
-- Una sola solicitud vigente por usuario.
create unique index account_deletion_requests_active_uidx on account_deletion_requests(user_id) where status in ('scheduled','blocked','processing');
create index account_deletion_requests_due_idx on account_deletion_requests(scheduled_for) where status in ('scheduled','blocked','processing');
create index account_deletion_requests_user_idx on account_deletion_requests(user_id, requested_at desc);
