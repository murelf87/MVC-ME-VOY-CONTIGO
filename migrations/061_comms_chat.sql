-- comms · mensajes: amplía el chat directo (008) y añade conversaciones, punteros de lectura y grupos de ruta.
-- Solo referencia tablas base (001–012). Compatible hacia atrás: las columnas nuevas tienen valor por defecto,
-- así que el código existente (src/chat/chat-service.ts) sigue funcionando sin cambios.

alter table trip_direct_messages
  add column seq bigint generated always as identity,
  add column kind text not null default 'text' check (kind in ('text','location')),
  add column location_lat double precision check (location_lat between -90 and 90),
  add column location_lng double precision check (location_lng between -180 and 180),
  add column location_label text check (location_label is null or char_length(location_label) <= 200),
  add column hidden_at timestamptz,
  add column hidden_by_user_id uuid references app_users(id) on delete set null,
  add column hidden_reason text check (hidden_reason is null or char_length(hidden_reason) <= 500),
  add constraint trip_direct_messages_location_chk
    check ((kind = 'location') = (location_lat is not null and location_lng is not null));

create unique index trip_direct_messages_seq_uidx on trip_direct_messages(seq);
create index trip_direct_messages_pair_seq_idx
  on trip_direct_messages(trip_id, sender_user_id, recipient_user_id, seq desc);

-- Una conversación = un hilo con identidad estable.
--   direct: (viaje, pasajero); el otro participante es el conductor del viaje.
--   group : (conductor, clave de ruta recurrente). La pertenencia NO se guarda: se deriva de las reservas en cada petición.
create table chat_conversations(
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct','group')),
  trip_id uuid references trips(id) on delete cascade,
  driver_user_id uuid not null references app_users(id) on delete cascade,
  passenger_user_id uuid references app_users(id) on delete cascade,
  route_key text,
  created_at timestamptz not null default now(),
  check (
    (kind = 'direct' and trip_id is not null and passenger_user_id is not null and route_key is null)
    or
    (kind = 'group' and passenger_user_id is null and route_key is not null)
  )
);
create unique index chat_conversations_direct_uidx on chat_conversations(trip_id, passenger_user_id) where kind = 'direct';
create unique index chat_conversations_group_uidx on chat_conversations(driver_user_id, route_key) where kind = 'group';
create index chat_conversations_driver_idx on chat_conversations(driver_user_id);
create index chat_conversations_passenger_idx on chat_conversations(passenger_user_id) where passenger_user_id is not null;

-- Punteros por persona. NO conceden acceso: el acceso se recalcula siempre desde reservas y bloqueos.
-- last_*_seq se refieren al `seq` de la tabla de mensajes de esa conversación (trip_direct_messages o chat_group_messages).
create table chat_participants(
  conversation_id uuid not null references chat_conversations(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  last_delivered_seq bigint not null default 0 check (last_delivered_seq >= 0),
  last_read_seq bigint not null default 0 check (last_read_seq >= 0),
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index chat_participants_user_idx on chat_participants(user_id);

create table chat_group_messages(
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,
  conversation_id uuid not null references chat_conversations(id) on delete cascade,
  sender_user_id uuid not null references app_users(id) on delete cascade,
  client_message_id uuid not null,
  kind text not null default 'text' check (kind in ('text','location')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  location_lat double precision check (location_lat between -90 and 90),
  location_lng double precision check (location_lng between -180 and 180),
  location_label text check (location_label is null or char_length(location_label) <= 200),
  hidden_at timestamptz,
  hidden_by_user_id uuid references app_users(id) on delete set null,
  hidden_reason text check (hidden_reason is null or char_length(hidden_reason) <= 500),
  created_at timestamptz not null default now(),
  unique (sender_user_id, client_message_id),
  check ((kind = 'location') = (location_lat is not null and location_lng is not null))
);
create index chat_group_messages_conv_seq_idx on chat_group_messages(conversation_id, seq desc);

-- Clave estable de «ruta recurrente» derivada solo de tablas base: mismo conductor, provincia, categoría, sentido,
-- origen y destino (redondeados a ~100 m). Si el módulo de viajes aporta un identificador de ruta propio, basta con
-- redefinir esta vista (`create or replace view`) sin tocar el resto del módulo.
create view chat_trip_route_keys as
select t.id as trip_id,
       t.driver_user_id,
       md5(concat_ws('|',
         t.driver_user_id::text, t.province_id::text, t.category::text, t.leg::text,
         round(ST_X(t.origin_geom)::numeric, 3)::text, round(ST_Y(t.origin_geom)::numeric, 3)::text,
         round(ST_X(t.destination_geom)::numeric, 3)::text, round(ST_Y(t.destination_geom)::numeric, 3)::text
       )) as route_key
  from trips t
 where t.kind = 'recurring'
   and t.origin_geom is not null
   and t.destination_geom is not null;
