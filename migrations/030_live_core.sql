-- Módulo `live` (rango 030–039). Núcleo: color de vehículo, agregados de valoración y privacidad del mapa en vivo.

-- Color visible para el pasajero («Seat León · Blanco»). Nullable: el formulario de vehículo lo rellenará el módulo propietario.
alter table vehicles
  add column if not exists color text check (color is null or char_length(color) between 1 and 40);

-- Agregados de valoración (alimentan PublicUser.ratingAverage / ratingCount en todos los módulos).
-- media = round(rating_sum::numeric / rating_count, 1)
alter table profiles
  add column if not exists rating_sum integer not null default 0 check (rating_sum >= 0),
  add column if not exists rating_count integer not null default 0 check (rating_count >= 0);

-- Privacidad en «En el coche»: por defecto el copasajero aparece como «1 pasajero» (sin nombre ni foto).
create table live_privacy_preferences(
  user_id uuid primary key references app_users(id) on delete cascade,
  show_profile_to_copassengers boolean not null default false,
  updated_at timestamptz not null default now()
);
