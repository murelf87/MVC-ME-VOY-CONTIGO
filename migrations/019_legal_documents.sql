-- Versioned terms of use and privacy notice. MVC stores and serves what the team publishes;
-- it never ships a default legal text of its own.
create table if not exists legal_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('terms','privacy')),
  version integer not null check (version > 0),
  title text not null check (length(title) between 1 and 200),
  body text not null check (length(body) between 1 and 200000),
  status text not null default 'draft' check (status in ('draft','published','retired')),
  created_by uuid not null references app_users(id),
  created_at timestamptz not null default now(),
  published_by uuid references app_users(id),
  published_at timestamptz,
  retired_at timestamptz,
  unique (kind, version)
);
create unique index if not exists legal_documents_one_published
  on legal_documents(kind) where status = 'published';

-- Published text is evidence of what a user agreed to: it can be retired, never rewritten.
create or replace function legal_documents_freeze() returns trigger language plpgsql as $$
begin
  if old.status <> 'draft' and (new.title <> old.title or new.body <> old.body or new.kind <> old.kind or new.version <> old.version) then
    raise exception 'MVC_LEGAL_DOCUMENT_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists legal_documents_freeze on legal_documents;
create trigger legal_documents_freeze before update on legal_documents
  for each row execute function legal_documents_freeze();

create table if not exists legal_acceptances (
  user_id uuid not null references app_users(id) on delete cascade,
  document_id uuid not null references legal_documents(id),
  accepted_at timestamptz not null default now(),
  primary key (user_id, document_id)
);
