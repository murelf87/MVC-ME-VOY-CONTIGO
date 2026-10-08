create table trip_ratings(
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  trip_id uuid not null references trips(id) on delete cascade,
  rater_user_id uuid not null references app_users(id) on delete cascade,
  rated_user_id uuid not null references app_users(id) on delete cascade,
  score smallint not null check(score between 1 and 5),
  comment text check(comment is null or char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  unique(booking_id,rater_user_id),
  check(rater_user_id <> rated_user_id)
);

create index trip_ratings_rated_idx on trip_ratings(rated_user_id,created_at desc);

create type report_category as enum ('safety','behaviour','no_show','vehicle','route','payment','other');
create type report_status as enum ('open','reviewing','resolved','dismissed');

create table incident_reports(
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references app_users(id) on delete cascade,
  reported_user_id uuid references app_users(id) on delete set null,
  trip_id uuid not null references trips(id) on delete cascade,
  category report_category not null,
  description text not null check(char_length(btrim(description)) between 10 and 2000),
  status report_status not null default 'open',
  resolution_note text check(resolution_note is null or char_length(resolution_note) <= 2000),
  resolved_by uuid references app_users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(reported_user_id is null or reported_user_id <> reporter_user_id)
);

create index incident_reports_status_idx on incident_reports(status,created_at);
create index incident_reports_reporter_idx on incident_reports(reporter_user_id,created_at desc);
