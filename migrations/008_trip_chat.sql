create table user_blocks(
  blocker_user_id uuid not null references app_users(id) on delete cascade,
  blocked_user_id uuid not null references app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(blocker_user_id,blocked_user_id),
  check(blocker_user_id <> blocked_user_id)
);

create index user_blocks_blocked_idx on user_blocks(blocked_user_id,blocker_user_id);

create table trip_direct_messages(
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  sender_user_id uuid not null references app_users(id) on delete cascade,
  recipient_user_id uuid not null references app_users(id) on delete cascade,
  client_message_id uuid not null,
  body text not null check(char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  unique(sender_user_id,client_message_id),
  check(sender_user_id <> recipient_user_id)
);

create index trip_direct_messages_conversation_idx
  on trip_direct_messages(trip_id,sender_user_id,recipient_user_id,created_at desc);
