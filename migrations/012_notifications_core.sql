-- Núcleo compartido de notificaciones in-app. Lo escriben todos los módulos (src/lib/notify.ts);
-- las preferencias, tokens push y endpoints de lectura pertenecen al módulo `comms` (migraciones 060–079).
create table notifications(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  category text not null check(category in ('trip','message','payment','system')),
  kind text not null,
  title text not null check(length(title) between 1 and 160),
  body text not null check(length(body) between 1 and 600),
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_created_idx on notifications(user_id,created_at desc);
create index notifications_user_unread_idx on notifications(user_id) where read_at is null;
