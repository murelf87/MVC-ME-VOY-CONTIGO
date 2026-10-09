-- comms · notificaciones: preferencias del usuario, registro de dispositivos push y filtro de entrega.
-- Solo referencia tablas base (001–012). La tabla `notifications` (012) la escriben todos los módulos con notify().

create table notification_preferences(
  user_id uuid primary key references app_users(id) on delete cascade,
  -- «Avisos esenciales del viaje»: SIEMPRE activos. El CHECK impide guardarlos desactivados aunque falle el servicio.
  essential_trip_notices boolean not null default true,
  -- «Avisos opcionales de llegada (recomendado)»: kinds que empiezan por «arrival_».
  arrival_alerts boolean not null default true,
  -- Avisos de mensajes nuevos del chat (categoría `message`).
  message_notices boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint notification_preferences_essential_locked check (essential_trip_notices)
);

create table push_tokens(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  platform text not null check (platform in ('ios','android','web')),
  provider text not null check (provider in ('expo','fcm','apns')),
  token text not null check (char_length(token) between 16 and 4096),
  device_id text check (device_id is null or char_length(device_id) between 1 and 128),
  app_version text check (app_version is null or char_length(app_version) <= 32),
  locale text check (locale is null or char_length(locale) <= 16),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Lo fija el emisor push cuando el proveedor informa de un token inválido (hoy no hay emisor: PUSH_PROVIDER=disabled).
  disabled_at timestamptz,
  unique (provider, token)
);
create index push_tokens_user_idx on push_tokens(user_id) where disabled_at is null;

-- Entrega: `suppressed` = el usuario desactivó ese tipo opcional; no se lista, no se cuenta y no genera push.
alter table notifications
  add column delivery_state text not null default 'delivered'
    check (delivery_state in ('delivered','suppressed'));

create index notifications_user_delivered_idx
  on notifications(user_id, created_at desc, id desc)
  where delivery_state = 'delivered';

-- Aplica las preferencias EN EL SERVIDOR al insertar, venga la notificación del módulo que venga.
-- Solo se pueden suprimir los avisos opcionales de llegada (`arrival_*`) y la categoría `message`.
-- Todo lo demás (cambios de hora, recogida, aceptaciones, cancelaciones, pagos, seguridad…) se entrega siempre.
create or replace function comms_apply_notification_preferences()
returns trigger language plpgsql as $$
declare
  prefs notification_preferences%rowtype;
begin
  select * into prefs from notification_preferences where user_id = new.user_id;
  if found then
    if left(new.kind, 8) = 'arrival_' and not prefs.arrival_alerts then
      new.delivery_state := 'suppressed';
    elsif new.category = 'message' and not prefs.message_notices then
      new.delivery_state := 'suppressed';
    end if;
  end if;
  return new;
end $$;

create trigger trg_comms_apply_notification_preferences
before insert on notifications
for each row execute function comms_apply_notification_preferences();
