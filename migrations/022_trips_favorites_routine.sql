-- Módulo «trips» · pantalla 31 «Favoritos y rutina».
-- Todo pertenece al propio usuario (on delete cascade con app_users).

create table if not exists favorite_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  kind text not null check (kind in ('work','campus','home','other')),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  address text not null check (char_length(btrim(address)) between 1 and 200),
  geom geometry(Point,4326) not null,
  province_id uuid references provinces(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists favorite_places_user_idx on favorite_places(user_id, created_at);

create table if not exists routine_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  weekday text not null check (weekday in ('mon','tue','wed','thu','fri','sat','sun')),
  time_local time not null,
  from_place_id uuid not null references favorite_places(id) on delete restrict,
  to_place_id uuid not null references favorite_places(id) on delete restrict,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_place_id <> to_place_id),
  unique (user_id, weekday, time_local, from_place_id, to_place_id)
);
create index if not exists routine_entries_user_idx on routine_entries(user_id, weekday, time_local);
create index if not exists routine_entries_from_idx on routine_entries(from_place_id);
create index if not exists routine_entries_to_idx on routine_entries(to_place_id);

create table if not exists routine_suspensions (
  user_id uuid not null references app_users(id) on delete cascade,
  -- Lunes de la semana suspendida (Europe/Madrid).
  week_start date not null check (extract(isodow from week_start) = 1),
  created_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

-- «Plaza disponible (semanal)»: preferencia del conductor; no publica nada por sí misma.
create table if not exists weekly_seat_offers (
  user_id uuid primary key references app_users(id) on delete cascade,
  enabled boolean not null default false,
  seats integer not null default 1 check (seats between 1 and 8),
  weekdays text[] not null default array['mon','tue','wed','thu','fri']::text[] check (
    cardinality(weekdays) between 1 and 7
    and weekdays <@ array['mon','tue','wed','thu','fri','sat','sun']::text[]
  ),
  updated_at timestamptz not null default now()
);
