-- «Compartir viaje (privado)»: enlace revocable con información limitada. Solo se guarda el hash del token.

create table trip_shares(
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  trip_id uuid not null references trips(id) on delete cascade,
  created_by_user_id uuid not null references app_users(id),
  token_hash char(64) not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- La matrícula solo se comparte si el pasajero lo decide expresamente.
  include_plate boolean not null default false,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer not null default 0 check (view_count >= 0),
  created_at timestamptz not null default now()
);
-- Un único enlace sin revocar por reserva (crear otro revoca el anterior en la misma transacción).
create unique index trip_shares_one_active_uidx on trip_shares(booking_id) where revoked_at is null;
create index trip_shares_trip_idx on trip_shares(trip_id);
