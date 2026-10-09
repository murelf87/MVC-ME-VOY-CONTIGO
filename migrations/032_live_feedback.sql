-- Valoraciones e incidencias de viaje (lado usuario). El lado de administración de incidencias vive en `trust`,
-- que lee/actualiza incident_reports (status, resolution_note, resolved_at).

create table trip_ratings(
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  -- Reserva del pasajero implicado (el que valora o el valorado).
  booking_id uuid references bookings(id) on delete set null,
  rater_user_id uuid not null references app_users(id),
  ratee_user_id uuid not null references app_users(id),
  rater_role text not null check (rater_role in ('driver','passenger')),
  stars smallint not null check (stars between 1 and 5),
  comment text check (comment is null or char_length(comment) between 1 and 500),
  created_at timestamptz not null default now(),
  -- Una valoración por participante, por viaje y por persona valorada.
  unique(trip_id, rater_user_id, ratee_user_id),
  check (rater_user_id <> ratee_user_id)
);
create index trip_ratings_ratee_idx on trip_ratings(ratee_user_id, created_at desc);

create table incident_reports(
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references app_users(id),
  reporter_role text not null check (reporter_role in ('driver','passenger')),
  trip_id uuid not null references trips(id),
  booking_id uuid references bookings(id),
  category text not null check (category in (
    'safety','driver_behavior','passenger_behavior','vehicle','route_or_schedule','payment','lost_item','other'
  )),
  description text not null check (char_length(description) between 10 and 2000),
  status text not null default 'open' check (status in ('open','in_review','resolved','dismissed')),
  -- Instantánea mínima del contexto al crear (estado de viaje/reserva); sin datos personales.
  context jsonb not null default '{}'::jsonb,
  idempotency_key text,
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index incident_reports_reporter_idx on incident_reports(reporter_user_id, created_at desc, id desc);
create index incident_reports_status_idx on incident_reports(status, created_at);
create index incident_reports_trip_idx on incident_reports(trip_id);
create unique index incident_reports_idempotency_uidx
  on incident_reports(reporter_user_id, idempotency_key) where idempotency_key is not null;

-- Adjuntos privados (fotos) de una incidencia: URL firmada de subida, nunca públicos.
create table incident_attachments(
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references incident_reports(id) on delete cascade,
  owner_user_id uuid not null references app_users(id),
  storage_provider text not null,
  storage_key text not null unique,
  content_type text not null,
  expected_size_bytes bigint not null check (expected_size_bytes between 1 and 10485760),
  size_bytes bigint,
  sha256 char(64) check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending','uploaded')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index incident_attachments_report_idx on incident_attachments(report_id);
