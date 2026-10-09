-- Módulo «trips» · fundamentos (be-trips).
-- Solo referencia tablas base 001–012 o las propias del módulo (rangos propios: 020–029).
--
--  * vehicles.color                    «Seat Arona · Gris» (pantalla 12). La migración 030 de `live` lo declara también con
--                                       `add column if not exists`: es idempotente y ambas definiciones son idénticas.
--  * trip_series                       plantilla de un viaje periódico (ida y vuelta opcional). Las ocurrencias son filas
--                                       reales de `trips` (una por día y sentido) para que cada una tenga sus tramos,
--                                       su capacidad, su GPS y su reserva.
--  * trips.series_id/service_date/…    identifican la ocurrencia; unicidad (serie, sentido, día) → materialización idempotente.
--  * trip_stops.optional/detour_*      paradas opcionales con desvío estimado («Dos Hermanas · +5 min»).

alter table vehicles
  add column if not exists color text check (color is null or char_length(color) between 1 and 40);

create table if not exists trip_series (
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null references app_users(id),
  vehicle_id uuid not null references vehicles(id),
  province_id uuid not null references provinces(id),
  category trip_category not null,
  status text not null default 'active' check (status in ('active','paused','ended')),
  frequency text not null check (frequency in ('daily_workdays','one_off')),
  -- subconjunto de mon..sun, en minúsculas
  weekdays text[] not null check (
    cardinality(weekdays) between 1 and 7
    and weekdays <@ array['mon','tue','wed','thu','fri','sat','sun']::text[]
  ),
  outbound_local time not null,
  return_local time,
  seats integer not null check (seats between 1 and 8),
  max_detour_minutes integer not null default 5 check (max_detour_minutes between 0 and 60),
  pickup_on_route boolean not null default false,
  flexibility_minutes integer not null default 0 check (flexibility_minutes between 0 and 60),
  start_date date not null,
  end_date date,
  -- Plantillas por sentido: {stops:[{lat,lng,label,kind,optional,detourMinutes}], route:{geojson,distanceM,durationS,provider,providerRef}, segments:[{distanceM,durationS}]}
  outbound_template jsonb not null,
  return_template jsonb,
  -- Último día (inclusive, Europe/Madrid) para el que ya existen ocurrencias.
  materialized_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index if not exists trip_series_driver_idx on trip_series(driver_user_id, status);
create index if not exists trip_series_active_idx on trip_series(status, materialized_until) where status = 'active';

alter table trips
  add column if not exists series_id uuid references trip_series(id),
  add column if not exists service_date date,
  add column if not exists max_detour_minutes integer not null default 5 check (max_detour_minutes between 0 and 60),
  add column if not exists pickup_on_route boolean not null default false;

-- service_date = día de calendario de la salida en Europe/Madrid. Se mantiene por trigger porque
-- `timestamptz AT TIME ZONE` no es inmutable (no admite columnas generadas) y los viajes heredados no lo informan.
create or replace function mvc_trips_set_service_date()
returns trigger language plpgsql as $$
begin
  if new.departure_at is null then
    new.service_date := null;
  else
    new.service_date := (new.departure_at at time zone 'Europe/Madrid')::date;
  end if;
  return new;
end $$;

drop trigger if exists trg_trips_set_service_date on trips;
create trigger trg_trips_set_service_date
before insert or update of departure_at on trips
for each row execute function mvc_trips_set_service_date();

update trips
   set service_date = (departure_at at time zone 'Europe/Madrid')::date
 where departure_at is not null and service_date is null;

create unique index if not exists trips_series_occurrence_uidx
  on trips(series_id, leg, service_date)
  where series_id is not null;
create index if not exists trips_series_departure_idx on trips(series_id, departure_at) where series_id is not null;
create index if not exists trips_service_date_idx on trips(province_id, service_date) where status in ('published','active');
create index if not exists trips_driver_departure_idx on trips(driver_user_id, departure_at desc);

alter table trip_stops
  add column if not exists optional boolean not null default false,
  add column if not exists detour_minutes integer check (detour_minutes is null or detour_minutes between 0 and 240);
