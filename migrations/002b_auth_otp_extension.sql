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
  created_at timestamptz not null default now(),
  check(phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
  check(code_hash ~ '^[0-9a-f]{64}$')
);

create index auth_otp_phone_created_idx
  on auth_otp_challenges(phone_e164,created_at desc);

alter table auth_sessions
  add column user_agent text,
  add column ip_address inet;
