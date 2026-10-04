create type otp_purpose as enum ('login','register');
create type otp_delivery_status as enum ('created','sent','failed','consumed');

create table auth_otp_challenges(
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  purpose otp_purpose not null,
  salt text not null,
  code_hash text not null,
  status otp_delivery_status not null default 'created',
  provider_name text,
  provider_message_id text,
  attempts integer not null default 0 check(attempts between 0 and 20),
  max_attempts integer not null default 5 check(max_attempts between 1 and 20),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index auth_otp_phone_created_idx
  on auth_otp_challenges(phone_e164,created_at desc);

create table auth_sessions(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  user_agent text,
  ip_address inet
);
create index auth_sessions_user_idx on auth_sessions(user_id,expires_at desc);
