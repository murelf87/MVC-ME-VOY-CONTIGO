-- Sign-in with email and password replaces SMS codes. Phone columns stay for existing data only.
alter table app_users
  add column if not exists email text,
  add column if not exists password_hash text,
  add column if not exists email_verified_at timestamptz,
  add column if not exists failed_login_count integer not null default 0,
  add column if not exists locked_until timestamptz,
  add column if not exists password_changed_at timestamptz;
create unique index if not exists app_users_email_uidx on app_users(lower(email)) where email is not null;

-- Six-digit codes sent by email to confirm the address or reset the password. Only a salted hash is kept.
create table if not exists auth_email_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  purpose text not null check (purpose in ('verify_email','reset_password')),
  salt text not null,
  code_hash text not null,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists auth_email_codes_open on auth_email_codes(user_id,purpose,created_at desc) where used_at is null;
