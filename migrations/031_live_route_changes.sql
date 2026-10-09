-- Cambio de ruta con consenso (extiende route_change_proposals / route_change_acceptances de 001).
-- Estados: pending -> accepted | rejected | expired | cancelled (ver docs/contracts/live.md).

alter table route_change_proposals
  add column kind text not null default 'new_stop' check (kind in ('new_stop')),
  add column resolution text check (resolution in (
    'auto_applied','all_accepted','rejected_by_passenger','expired','cancelled_by_driver','capacity_lost','superseded'
  )),
  add column auto_applied boolean not null default false,
  -- Solicitud de plaza (ride_requests) del pasajero que subirá en la nueva parada (opcional).
  add column linked_request_id uuid references ride_requests(id) on delete set null,
  -- La parada nueva se inserta DESPUÉS de la parada con este seq (numeración previa al cambio).
  add column after_stop_seq integer check (after_stop_seq >= 0),
  add column new_stop_label text,
  add column new_stop_geom geometry(Point,4326),
  add column new_stop_seq integer,
  -- Ruta antes del cambio (para pintar «antes / ahora» aunque el cambio ya se haya aplicado).
  add column before_route_geom geometry(LineString,4326),
  add column added_distance_m integer not null default 0,
  add column added_duration_s integer not null default 0,
  add column max_detour_m integer not null default 0,
  add column planned_arrival_at timestamptz,
  -- Tramos calculados por el proveedor de rutas y tramo sustituido: {legs:[{distanceM,durationS,provider,providerRef}x2], oldSegment:{distanceM,durationS,capacity}, dwellS}
  add column payload jsonb not null default '{}'::jsonb,
  add column expires_at timestamptz,
  add column resolved_at timestamptz,
  add column idempotency_key text;

-- Solo una propuesta pendiente por viaje.
create unique index route_change_one_pending_per_trip
  on route_change_proposals(trip_id) where status='pending';
create unique index route_change_idempotency_uidx
  on route_change_proposals(created_by_user_id, idempotency_key) where idempotency_key is not null;
create index route_change_trip_created_idx on route_change_proposals(trip_id, created_at desc);
create index route_change_pending_expiry_idx on route_change_proposals(expires_at) where status='pending';

-- Impacto por reserva afectada (lo que ve cada pasajero en «Antes / Ahora»).
-- Los seq son los de ANTES del cambio.
create table route_change_impacts(
  proposal_id uuid not null references route_change_proposals(id) on delete cascade,
  booking_id uuid not null references bookings(id) on delete cascade,
  passenger_user_id uuid not null references app_users(id),
  pickup_stop_seq integer not null,
  dropoff_stop_seq integer not null,
  pickup_geom geometry(Point,4326) not null,
  dropoff_geom geometry(Point,4326) not null,
  pickup_before_at timestamptz,
  pickup_after_at timestamptz,
  dropoff_before_at timestamptz,
  dropoff_after_at timestamptz,
  schedule_delta_s integer not null default 0,
  schedule_material boolean not null default false,
  distance_before_m integer not null,
  distance_after_m integer not null,
  price_status text not null check (price_status in ('defined','pending_definition')),
  price_before_cents integer,
  price_after_cents integer,
  price_delta_cents integer,
  price_material boolean not null default false,
  requires_acceptance boolean not null default false,
  primary key(proposal_id, booking_id)
);
create index route_change_impacts_passenger_idx on route_change_impacts(passenger_user_id, proposal_id);
