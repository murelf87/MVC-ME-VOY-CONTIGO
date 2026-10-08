-- Devices that can receive push notices, and one outbox row per notice and device.
-- The outbox is filled in the same transaction as the in-app notice, so a push is never sent for
-- an action that rolled back. Delivery is a separate worker (npm run push:send).
create table if not exists push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  platform text not null check (platform in ('ios','android')),
  token text not null unique check (length(token) between 10 and 4096),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  disabled_reason text
);
create index if not exists push_devices_user on push_devices(user_id) where disabled_at is null;

create table if not exists push_outbox (
  id bigserial primary key,
  notification_id uuid not null references user_notifications(id) on delete cascade,
  device_id uuid not null references push_devices(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sent','failed','expired')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (notification_id, device_id)
);
create index if not exists push_outbox_pending on push_outbox(created_at) where status = 'pending';
