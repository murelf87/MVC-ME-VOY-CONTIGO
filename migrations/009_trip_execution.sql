alter type booking_status add value if not exists 'no_show';

alter table trips
  add column started_at timestamptz,
  add column completed_at timestamptz;

alter table bookings
  add column picked_up_at timestamptz;

create table booking_pickup_codes(
  booking_id uuid primary key references bookings(id) on delete cascade,
  salt text not null,
  code_hash char(64) not null check(code_hash ~ '^[0-9a-f]{64}$'),
  attempts integer not null default 0 check(attempts between 0 and 20),
  max_attempts integer not null default 5 check(max_attempts between 1 and 20),
  generated_at timestamptz not null default now(),
  verified_at timestamptz
);
