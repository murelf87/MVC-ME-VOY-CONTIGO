-- Route changes caused by a passenger who asks to be picked up off the published route,
-- before departure or while the car is already moving. Nothing changes the trip until the
-- driver accepts and every confirmed passenger with a material delay has accepted too.
-- 001 sketched route_change_proposals/route_change_acceptances but no code ever wrote to them.
-- Replace them with the shape the flow needs; refuse if anything was stored there.
do $$
begin
  if exists(select 1 from route_change_proposals) or exists(select 1 from route_change_acceptances) then
    raise exception 'route_change tables from 001 contain rows; migrate them by hand before 017';
  end if;
end $$;
drop table route_change_acceptances;
drop table route_change_proposals;

create type route_change_status as enum(
  'awaiting_driver','awaiting_passengers','applied','rejected','cancelled','expired'
);

create table route_change_proposals(
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  requester_user_id uuid not null references app_users(id),
  base_route_version integer not null,
  pickup_geom geometry(Point,4326) not null,
  dropoff_geom geometry(Point,4326) not null,
  pickup_label text check(pickup_label is null or char_length(pickup_label) <= 200),
  dropoff_label text check(dropoff_label is null or char_length(dropoff_label) <= 200),
  -- Positions in the new stop numbering the plan produces.
  pickup_stop_seq integer not null check(pickup_stop_seq > 0),
  dropoff_stop_seq integer not null check(dropoff_stop_seq > pickup_stop_seq),
  -- Full recomputed plan: stops, segments with capacity and the provider route.
  plan jsonb not null,
  added_distance_m integer not null check(added_distance_m >= 0),
  added_duration_s integer not null check(added_duration_s >= 0),
  status route_change_status not null default 'awaiting_driver',
  request_id uuid references ride_requests(id),
  expires_at timestamptz not null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index route_change_one_open_per_requester
  on route_change_proposals(trip_id,requester_user_id)
  where status in ('awaiting_driver','awaiting_passengers');
create index route_change_trip_status_idx on route_change_proposals(trip_id,status);

create table route_change_responses(
  proposal_id uuid not null references route_change_proposals(id) on delete cascade,
  passenger_user_id uuid not null references app_users(id),
  booking_id uuid not null references bookings(id),
  extra_delay_s integer not null check(extra_delay_s >= 0),
  decision text not null default 'pending' check(decision in ('pending','accepted','rejected')),
  decided_at timestamptz,
  primary key(proposal_id,passenger_user_id)
);

-- One "your driver is arriving" notice per booking.
alter table bookings add column arrival_notified_at timestamptz;
