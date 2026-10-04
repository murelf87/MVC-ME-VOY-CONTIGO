alter table vehicles
  add column plate_normalized text
    generated always as (upper(regexp_replace(plate,'[^A-Za-z0-9]','','g'))) stored,
  add column review_reason text,
  add column reviewed_by_user_id uuid references app_users(id),
  add column reviewed_at timestamptz;

create unique index vehicles_plate_normalized_uidx
  on vehicles(plate_normalized);

create index vehicles_driver_idx
  on vehicles(driver_user_id,created_at desc);

create table private_documents(
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references app_users(id) on delete cascade,
  vehicle_id uuid references vehicles(id) on delete cascade,
  kind text not null check(kind in (
    'identity_document',
    'driver_license',
    'vehicle_registration',
    'vehicle_insurance',
    'other'
  )),
  storage_provider text not null,
  storage_key text not null,
  content_type text not null,
  size_bytes bigint not null check(size_bytes > 0 and size_bytes <= 20971520),
  sha256 char(64) not null check(sha256 ~ '^[0-9a-f]{64}$'),
  review_status profile_review_status not null default 'pending',
  review_reason text,
  reviewed_by_user_id uuid references app_users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(storage_provider,storage_key)
);

create index private_documents_owner_idx
  on private_documents(owner_user_id,created_at desc);
create index private_documents_vehicle_idx
  on private_documents(vehicle_id,created_at desc)
  where vehicle_id is not null;
create index private_documents_review_idx
  on private_documents(review_status,created_at);
