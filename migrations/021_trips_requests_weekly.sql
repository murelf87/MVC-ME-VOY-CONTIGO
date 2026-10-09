-- Módulo «trips» · solicitudes ampliadas, reservas semanales e idempotencia.
--
--  * ride_requests.pickup_* …          punto de recogida elegido (inmutable tras crear la solicitud), bajada, distancia, mensaje.
--  * weekly_reservations               agrupa las solicitudes (una por ocurrencia) de una reserva semanal. Su estado agregado
--                                       se DERIVA de las solicitudes (no se almacena) para que no pueda desincronizarse.
--  * trip_idempotency_keys             repetición de respuestas para POST que crean (cabecera Idempotency-Key). Nombre propio:
--                                       el módulo `money` tiene su propia tabla `idempotency_keys`.

create table if not exists weekly_reservations (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references trip_series(id),
  passenger_user_id uuid not null references app_users(id),
  driver_user_id uuid not null references app_users(id),
  weekdays text[] not null check (
    cardinality(weekdays) between 1 and 7
    and weekdays <@ array['mon','tue','wed','thu','fri','sat','sun']::text[]
  ),
  legs text[] not null check (cardinality(legs) between 1 and 2 and legs <@ array['outbound','return']::text[]),
  start_date date not null,
  weeks integer not null check (weeks between 1 and 4),
  exception_dates date[] not null default '{}',
  cancellation_policy_version text check (cancellation_policy_version is null or char_length(cancellation_policy_version) <= 80),
  pickup_geom geometry(Point,4326) not null,
  pickup_label text,
  pickup_address text,
  pickup_source text check (pickup_source in ('driver_stop','route_projection')),
  pickup_stop_seq integer,
  dropoff_stop_seq integer not null,
  message text check (message is null or char_length(message) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists weekly_reservations_passenger_idx on weekly_reservations(passenger_user_id, created_at desc);
create index if not exists weekly_reservations_driver_idx on weekly_reservations(driver_user_id, created_at desc);
create index if not exists weekly_reservations_series_idx on weekly_reservations(series_id);

alter table ride_requests
  add column if not exists pickup_geom geometry(Point,4326),
  add column if not exists pickup_label text,
  add column if not exists pickup_address text,
  add column if not exists pickup_source text check (pickup_source in ('driver_stop','route_projection')),
  add column if not exists pickup_offset_s integer check (pickup_offset_s is null or pickup_offset_s >= 0),
  add column if not exists pickup_walk_minutes integer check (pickup_walk_minutes is null or pickup_walk_minutes between 0 and 240),
  add column if not exists pickup_detour_minutes integer check (pickup_detour_minutes is null or pickup_detour_minutes between 0 and 240),
  add column if not exists dropoff_stop_seq integer check (dropoff_stop_seq is null or dropoff_stop_seq >= 1),
  add column if not exists road_distance_m integer check (road_distance_m is null or road_distance_m >= 0),
  add column if not exists message text check (message is null or char_length(message) <= 300),
  add column if not exists weekly_reservation_id uuid references weekly_reservations(id),
  add column if not exists expired_at timestamptz;

create index if not exists ride_requests_passenger_idx on ride_requests(passenger_user_id, status, requested_at desc);
create index if not exists ride_requests_weekly_idx on ride_requests(weekly_reservation_id) where weekly_reservation_id is not null;
create index if not exists ride_requests_trip_passenger_idx on ride_requests(trip_id, passenger_user_id);
create index if not exists seat_holds_active_expiry_idx on seat_holds(expires_at) where status = 'active';

create table if not exists trip_idempotency_keys (
  user_id uuid not null references app_users(id) on delete cascade,
  scope text not null check (char_length(scope) between 1 and 60),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 80),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status_code integer,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, scope, idempotency_key)
);
create index if not exists trip_idempotency_keys_created_idx on trip_idempotency_keys(created_at);
