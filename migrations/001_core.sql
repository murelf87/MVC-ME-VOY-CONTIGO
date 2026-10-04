create extension if not exists postgis;
create extension if not exists pgcrypto;

create type user_status as enum ('active','suspended','deleted');
create type profile_review_status as enum ('pending','approved','rejected');
create type identity_status as enum ('unverified','pending','verified','rejected');
create type user_role as enum ('passenger','driver','admin','verification_admin','finance_admin','support_admin');
create type vehicle_review_status as enum ('pending','approved','rejected');
create type trip_status as enum ('draft','published','active','completed','cancelled');
create type trip_category as enum ('work','university','fp_academies','hospital','sport','other');
create type trip_kind as enum ('single','recurring');
create type trip_leg as enum ('outbound','return');
create type request_status as enum ('pending','accepted','rejected','payment_pending','confirmed','expired','cancelled','payment_late');
create type hold_status as enum ('active','released','consumed');
create type booking_status as enum ('confirmed','completed','cancelled','driver_cancelled');
create type tariff_status as enum ('draft','approved','retired');
create type proposal_status as enum ('pending','accepted','rejected','expired','cancelled');
create type compensation_reason as enum ('hold_expired','capacity_lost','duplicate_payment','other');
create type compensation_action as enum ('refund_required','manual_review');

create table provinces(
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  source_name text not null,
  source_url text,
  source_date date,
  source_license text,
  geom geometry(MultiPolygon,4326) not null,
  created_at timestamptz not null default now()
);
create index provinces_geom_gix on provinces using gist(geom);

create table app_users(
  id uuid primary key default gen_random_uuid(),
  phone_e164 text unique,
  status user_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table user_roles(
  user_id uuid not null references app_users(id) on delete cascade,
  role user_role not null,
  primary key(user_id,role)
);

create table profiles(
  user_id uuid primary key references app_users(id) on delete cascade,
  display_name text,
  public_photo_key text,
  public_photo_status profile_review_status not null default 'pending',
  private_selfie_key text,
  identity_status identity_status not null default 'unverified',
  presence_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table vehicles(
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null references app_users(id),
  make text not null,
  model text not null,
  plate text not null,
  passenger_seats integer not null check(passenger_seats between 1 and 8),
  review_status vehicle_review_status not null default 'pending',
  documentation_status vehicle_review_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table trips(
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null references app_users(id),
  vehicle_id uuid not null references vehicles(id),
  province_id uuid not null references provinces(id),
  category trip_category not null,
  kind trip_kind not null,
  leg trip_leg not null,
  status trip_status not null default 'draft',
  departure_at timestamptz,
  flexibility_minutes integer not null default 0 check(flexibility_minutes between 0 and 60),
  max_detour_m integer not null default 0 check(max_detour_m >= 0),
  offered_seats integer not null check(offered_seats between 1 and 8),
  origin_geom geometry(Point,4326),
  destination_geom geometry(Point,4326),
  route_geom geometry(LineString,4326),
  route_distance_m integer check(route_distance_m > 0),
  route_duration_s integer check(route_duration_s > 0),
  route_provider text,
  route_provider_ref text,
  route_version integer not null default 1 check(route_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index trips_route_gix on trips using gist(route_geom);
create index trips_origin_gix on trips using gist(origin_geom);
create index trips_destination_gix on trips using gist(destination_geom);

create table trip_stops(
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  seq integer not null check(seq >= 0),
  kind text not null check(kind in ('origin','pickup','stop','dropoff','destination')),
  label text,
  geom geometry(Point,4326) not null,
  unique(trip_id,seq)
);
create index trip_stops_geom_gix on trip_stops using gist(geom);

create table trip_segments(
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  seq integer not null check(seq >= 0),
  from_stop_seq integer not null,
  to_stop_seq integer not null,
  distance_m integer not null check(distance_m > 0),
  duration_s integer not null check(duration_s > 0),
  capacity integer not null check(capacity between 1 and 8),
  unique(trip_id,seq),
  check(to_stop_seq = from_stop_seq + 1)
);

create table ride_requests(
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id),
  passenger_user_id uuid not null references app_users(id),
  from_segment_seq integer not null check(from_segment_seq >= 0),
  to_segment_seq integer not null check(to_segment_seq > from_segment_seq),
  status request_status not null default 'pending',
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ride_requests_trip_idx on ride_requests(trip_id,status);

create table seat_holds(
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references ride_requests(id) on delete cascade,
  status hold_status not null default 'active',
  expires_at timestamptz not null,
  released_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table bookings(
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references ride_requests(id),
  provider_payment_id text not null unique,
  amount_cents integer not null check(amount_cents >= 0),
  status booking_status not null default 'confirmed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table payment_compensations(
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references ride_requests(id),
  provider_payment_id text not null unique,
  amount_cents integer not null check(amount_cents >= 0),
  reason compensation_reason not null,
  action compensation_action not null,
  status text not null check(status in ('pending','completed','dismissed')),
  created_at timestamptz not null default now()
);

create table tariff_versions(
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  status tariff_status not null default 'draft',
  rate_micros_per_km integer check(rate_micros_per_km >= 0),
  passenger_commission_bps integer check(passenger_commission_bps between 0 and 10000),
  driver_commission_bps integer check(driver_commission_bps between 0 and 10000),
  shared_cost_cap_cents integer check(shared_cost_cap_cents >= 0),
  effective_from timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create table quote_snapshots(
  id uuid primary key default gen_random_uuid(),
  request_id uuid references ride_requests(id),
  tariff_version_id uuid references tariff_versions(id),
  road_distance_m integer not null check(road_distance_m >= 0),
  contribution_cents integer not null check(contribution_cents >= 0),
  passenger_commission_cents integer not null default 0 check(passenger_commission_cents >= 0),
  driver_commission_cents integer not null default 0 check(driver_commission_cents >= 0),
  processing_cents integer not null default 0 check(processing_cents >= 0),
  taxes_cents integer not null default 0 check(taxes_cents >= 0),
  passenger_total_cents integer not null check(passenger_total_cents >= 0),
  driver_net_cents integer not null,
  created_at timestamptz not null default now()
);

create table route_change_proposals(
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id),
  created_by_user_id uuid not null references app_users(id),
  from_route_version integer not null,
  proposed_route_version integer not null,
  proposed_route_geom geometry(LineString,4326) not null,
  proposed_distance_m integer not null check(proposed_distance_m > 0),
  proposed_duration_s integer not null check(proposed_duration_s > 0),
  material_price_change boolean not null default false,
  material_schedule_change boolean not null default false,
  status proposal_status not null default 'pending',
  created_at timestamptz not null default now()
);

create table route_change_acceptances(
  proposal_id uuid not null references route_change_proposals(id) on delete cascade,
  passenger_user_id uuid not null references app_users(id),
  accepted boolean not null,
  decided_at timestamptz not null default now(),
  primary key(proposal_id,passenger_user_id)
);

create table audit_events(
  id bigserial primary key,
  actor_user_id uuid references app_users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function mvc_validate_trip_geometry()
returns trigger language plpgsql as $$
declare
  province_geom geometry(MultiPolygon,4326);
begin
  if new.status not in ('published','active') then return new; end if;

  if new.origin_geom is null or new.destination_geom is null or new.route_geom is null or new.route_distance_m is null then
    raise exception using errcode='23514', message='MVC_ROUTE_UNVERIFIED';
  end if;

  select geom into province_geom from provinces where id=new.province_id;
  if province_geom is null then
    raise exception using errcode='23514', message='MVC_PROVINCE_GEOMETRY_MISSING';
  end if;

  if not ST_CoveredBy(new.origin_geom, province_geom)
     or not ST_CoveredBy(new.destination_geom, province_geom)
     or not ST_CoveredBy(new.route_geom, province_geom) then
    raise exception using errcode='23514', message='MVC_ROUTE_OUTSIDE_PROVINCE';
  end if;
  return new;
end $$;

create trigger trg_validate_trip_geometry
before insert or update of status,province_id,origin_geom,destination_geom,route_geom,route_distance_m
on trips for each row execute function mvc_validate_trip_geometry();

create or replace function mvc_validate_stop_geometry()
returns trigger language plpgsql as $$
declare
  t_status trip_status;
  province_geom geometry(MultiPolygon,4326);
begin
  select t.status,p.geom into t_status,province_geom
    from trips t join provinces p on p.id=t.province_id
   where t.id=new.trip_id;

  if t_status in ('published','active') and not ST_CoveredBy(new.geom,province_geom) then
    raise exception using errcode='23514', message='MVC_STOP_OUTSIDE_PROVINCE';
  end if;
  return new;
end $$;

create trigger trg_validate_stop_geometry
before insert or update of geom,trip_id
on trip_stops for each row execute function mvc_validate_stop_geometry();
