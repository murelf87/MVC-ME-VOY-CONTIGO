create type series_status as enum ('active','paused','ended');

create table trip_series(
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null references app_users(id) on delete cascade,
  template_trip_id uuid not null references trips(id),
  weekdays smallint[] not null check(
    cardinality(weekdays) between 1 and 7 and weekdays <@ array[1,2,3,4,5,6,7]::smallint[]
  ),
  local_time time not null,
  timezone text not null default 'Europe/Madrid',
  starts_on date not null,
  ends_on date,
  status series_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(ends_on is null or ends_on >= starts_on)
);

create index trip_series_driver_idx on trip_series(driver_user_id,created_at desc);

alter table trips add column series_id uuid references trip_series(id);

-- One occurrence per series and departure: re-running materialisation never duplicates trips.
create unique index trips_series_departure_uidx on trips(series_id,departure_at) where series_id is not null;

alter table ride_requests add column weekly_group_id uuid;
create index ride_requests_weekly_group_idx on ride_requests(weekly_group_id) where weekly_group_id is not null;
