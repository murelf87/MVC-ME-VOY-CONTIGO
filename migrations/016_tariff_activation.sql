-- A tariff only applies once finance approves it; at most one is approved at a time.
create unique index tariff_versions_single_approved on tariff_versions((status)) where status='approved';

alter table tariff_versions
  add column created_by uuid references app_users(id),
  add column approved_by uuid references app_users(id),
  add column approved_at timestamptz,
  add column retired_at timestamptz;

alter table quote_snapshots
  add column from_segment_seq integer,
  add column to_segment_seq integer;

create unique index quote_snapshots_request_uidx on quote_snapshots(request_id) where request_id is not null;
