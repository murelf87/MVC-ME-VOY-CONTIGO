create table trip_location_events(
  id bigserial primary key,
  event_id uuid not null,
  trip_id uuid not null references trips(id) on delete cascade,
  driver_user_id uuid not null references app_users(id),
  recorded_at timestamptz not null,
  received_at timestamptz not null default now(),
  geom geometry(Point,4326) not null,
  accuracy_m numeric(8,2) check(accuracy_m is null or accuracy_m between 0 and 10000),
  speed_mps numeric(8,3) check(speed_mps is null or speed_mps >= 0),
  heading_degrees numeric(6,2) check(heading_degrees is null or (heading_degrees >= 0 and heading_degrees < 360)),
  unique(trip_id,event_id)
);
create index trip_location_events_trip_recorded_idx
  on trip_location_events(trip_id,recorded_at desc);
create index trip_location_events_geom_gix
  on trip_location_events using gist(geom);

create table trip_live_state(
  trip_id uuid primary key references trips(id) on delete cascade,
  event_row_id bigint not null unique references trip_location_events(id) on delete cascade,
  driver_user_id uuid not null references app_users(id),
  recorded_at timestamptz not null,
  received_at timestamptz not null,
  geom geometry(Point,4326) not null,
  accuracy_m numeric(8,2),
  speed_mps numeric(8,3),
  heading_degrees numeric(6,2),
  updated_at timestamptz not null default now()
);
create index trip_live_state_geom_gix on trip_live_state using gist(geom);
create index trip_live_state_recorded_idx on trip_live_state(recorded_at desc);
