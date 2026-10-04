create table province_dataset_imports(
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  source_url text not null,
  source_date date not null,
  source_license text not null,
  source_version text,
  file_sha256 char(64) not null unique check(file_sha256 ~ '^[0-9a-f]{64}$'),
  feature_count integer not null check(feature_count > 0),
  status text not null check(status in ('loading','active','failed','superseded')),
  imported_at timestamptz not null default now(),
  activated_at timestamptz,
  notes text
);

alter table provinces
  add column dataset_import_id uuid references province_dataset_imports(id);

create index provinces_dataset_import_idx on provinces(dataset_import_id);
create index province_dataset_imports_status_idx on province_dataset_imports(status,imported_at desc);
