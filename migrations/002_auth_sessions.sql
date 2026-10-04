create type auth_challenge_status as enum (
  'dispatching',
  'pending',
  'provider_approved',
  'verified',
  'expired',
  'failed',
  'cancelled'
);

create table auth_challenges(
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null check(phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  requested_roles user_role[] not null,
  provider text not null,
  provider_challenge_id text,
  provider_status text,
  status auth_challenge_status not null default 'dispatching',
  check_attempts integer not null default 0 check(check_attempts >= 0),
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  provider_approved_at timestamptz,
  verified_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(provider,provider_challenge_id),
  check(cardinality(requested_roles) between 1 and 2),
  check(requested_roles <@ array['passenger'::user_role,'driver'::user_role])
);
create index auth_challenges_phone_requested_idx on auth_challenges(phone_e164,requested_at desc);
create index auth_challenges_status_expiry_idx on auth_challenges(status,expires_at);

create table auth_sessions(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash char(64) not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  check(expires_at > created_at)
);
create index auth_sessions_user_active_idx on auth_sessions(user_id,expires_at) where revoked_at is null;
