create table user_notifications(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  kind text not null check(kind ~ '^[a-z_.]{3,64}$'),
  trip_id uuid references trips(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index user_notifications_inbox_idx on user_notifications(user_id,created_at desc);
create index user_notifications_unread_idx on user_notifications(user_id) where read_at is null;
