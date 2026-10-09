-- comms · denuncias de personas (con prueba literal) y ajustes de usuario.
-- Solo referencia tablas base (001–012) y las del módulo. El módulo `trust` lee y resuelve las denuncias.

create table user_reports(
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references app_users(id) on delete cascade,
  reported_user_id uuid not null references app_users(id) on delete cascade,
  reason text not null check (reason in ('harassment','unsafe_behavior','inappropriate_content','spam_or_fraud','no_show','other')),
  details text check (details is null or char_length(details) <= 1000),
  trip_id uuid references trips(id) on delete set null,
  conversation_id uuid references chat_conversations(id) on delete set null,
  status text not null default 'open' check (status in ('open','in_review','actioned','dismissed')),
  idempotency_key uuid,
  -- Solo uso interno del personal: nunca se muestra al denunciante ni al denunciado.
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 2000),
  resolved_by_user_id uuid references app_users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (reporter_user_id <> reported_user_id)
);
create unique index user_reports_idempotency_uidx on user_reports(reporter_user_id, idempotency_key) where idempotency_key is not null;
create index user_reports_reporter_idx on user_reports(reporter_user_id, created_at desc, id desc);
create index user_reports_queue_idx on user_reports(status, created_at);
create index user_reports_reported_idx on user_reports(reported_user_id, created_at desc);

-- Copia literal de los mensajes aportados como prueba, tomada en el momento de denunciar
-- (el contenido original puede retirarse, anonimizarse o borrarse después).
create table user_report_evidence(
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references user_reports(id) on delete cascade,
  message_source text not null check (message_source in ('direct','group')),
  message_id uuid not null,
  sender_user_id uuid not null,
  kind text not null check (kind in ('text','location')),
  body text not null,
  location_lat double precision,
  location_lng double precision,
  message_created_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (report_id, message_id)
);

create or replace function user_report_before_update()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status in ('actioned','dismissed') and old.status is distinct from new.status then
    new.resolved_at := coalesce(new.resolved_at, now());
    -- Aviso genérico al denunciante: no revela el resultado ni datos de la persona denunciada.
    insert into notifications(user_id, category, kind, title, body, data)
    values (old.reporter_user_id, 'system', 'report_update', 'Hemos revisado tu denuncia',
            'El equipo de MVC ha revisado tu denuncia. Gracias por ayudarnos a mantener una comunidad segura.',
            jsonb_build_object('reportId', old.id));
  end if;
  return new;
end $$;

create trigger trg_user_report_before_update
before update on user_reports
for each row execute function user_report_before_update();

-- Ajustes de la pantalla 34. Sin fila = valores por defecto (compartir ubicación activado, letra normal, español).
create table user_settings(
  user_id uuid primary key references app_users(id) on delete cascade,
  -- «Compartir ubicación en viaje — Solo durante el trayecto activo». El módulo `live` la consulta antes de mostrar posición precisa.
  share_live_location_in_trip boolean not null default true,
  font_scale text not null default 'normal' check (font_scale in ('small','normal','large','extra_large')),
  language text not null default 'es' check (language in ('es')),
  updated_at timestamptz not null default now()
);
