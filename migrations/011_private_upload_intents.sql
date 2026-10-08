create table private_upload_intents(
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references app_users(id) on delete cascade,
  vehicle_id uuid references vehicles(id) on delete cascade,
  kind text not null check(kind in ('vehicle_photo','vehicle_insurance')),
  storage_provider text not null,
  storage_key text not null unique,
  content_type text not null,
  expected_size_bytes bigint not null check(expected_size_bytes > 0 and expected_size_bytes <= 20971520),
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index private_upload_intents_owner_idx
  on private_upload_intents(owner_user_id,created_at desc);

create index private_upload_intents_expiry_idx
  on private_upload_intents(expires_at)
  where completed_at is null;
