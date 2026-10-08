create type policy_status as enum ('draft','active','retired');

create table cancellation_policy_versions(
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check(version > 0),
  status policy_status not null default 'draft',
  rules jsonb not null,
  notes text,
  created_by uuid references app_users(id),
  activated_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  retired_at timestamptz
);

create unique index cancellation_policy_single_active
  on cancellation_policy_versions((status)) where status='active';

alter table bookings
  add column cancellation_policy_version_id uuid references cancellation_policy_versions(id);

create type cancellation_actor as enum ('passenger','driver','platform','force_majeure');
create type refund_status as enum ('not_applicable','pending_policy','pending_provider','completed');

create table booking_cancellations(
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings(id) on delete cascade,
  actor cancellation_actor not null,
  cancelled_by_user_id uuid references app_users(id),
  reason text check(reason is null or char_length(reason) <= 500),
  trip_started boolean not null,
  minutes_before_departure integer,
  policy_version_id uuid references cancellation_policy_versions(id),
  rule_applied text,
  paid_cents integer not null check(paid_cents >= 0),
  refund_cents integer check(refund_cents >= 0),
  retained_cents integer check(retained_cents >= 0),
  refund_status refund_status not null,
  created_at timestamptz not null default now(),
  check(refund_cents is null or refund_cents + retained_cents = paid_cents)
);

create index booking_cancellations_refund_idx on booking_cancellations(refund_status,created_at);
