-- comms · centro de ayuda: consultas (tickets), hilo de respuestas, adjuntos privados e intents de subida.
-- Solo referencia tablas base (001–012). El módulo `trust` lee/escribe estas tablas (docs/contracts/comms.md §9).

create sequence support_ticket_ref_seq;

create table support_tickets(
  id uuid primary key default gen_random_uuid(),
  -- Referencia legible para el usuario: MVC-2026-000123
  reference text not null unique default (
    'MVC-' || to_char(now() at time zone 'Europe/Madrid', 'YYYY') || '-' || lpad(nextval('support_ticket_ref_seq')::text, 6, '0')
  ),
  user_id uuid not null references app_users(id) on delete cascade,
  category text not null check (category in ('trip_issue','payment_issue','account_profile')),
  status text not null default 'open' check (status in ('open','answered','closed')),
  trip_id uuid references trips(id) on delete set null,
  booking_id uuid references bookings(id) on delete set null,
  -- Consulta original (≤ 500 caracteres, contador «0/500» de la pantalla 35). El hilo completo está en support_ticket_messages.
  body text not null check (char_length(btrim(body)) between 1 and 500),
  idempotency_key uuid,
  assigned_to_user_id uuid references app_users(id) on delete set null,
  last_user_message_at timestamptz not null default now(),
  last_staff_message_at timestamptz,
  closed_at timestamptz,
  closed_by text check (closed_by in ('user','staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'closed') = (closed_at is not null))
);
create unique index support_tickets_idempotency_uidx on support_tickets(user_id, idempotency_key) where idempotency_key is not null;
create index support_tickets_user_idx on support_tickets(user_id, created_at desc);
create index support_tickets_queue_idx on support_tickets(status, last_user_message_at);

create table support_ticket_messages(
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  author_type text not null check (author_type in ('user','staff')),
  author_user_id uuid references app_users(id) on delete set null,
  -- Los usuarios escriben ≤ 500 (consulta) / ≤ 1000 (respuesta), validado en el servicio; el personal puede escribir más.
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index support_ticket_messages_ticket_idx on support_ticket_messages(ticket_id, created_at, id);

create table support_attachments(
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references app_users(id) on delete cascade,
  ticket_id uuid references support_tickets(id) on delete cascade,
  message_id uuid references support_ticket_messages(id) on delete cascade,
  storage_provider text not null,
  storage_key text not null,
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp','image/heic','image/heif')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  sha256 char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (storage_provider, storage_key),
  check (message_id is null or ticket_id is not null)
);
create index support_attachments_ticket_idx on support_attachments(ticket_id) where ticket_id is not null;
create index support_attachments_owner_unlinked_idx on support_attachments(owner_user_id) where ticket_id is null;

create table support_upload_intents(
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references app_users(id) on delete cascade,
  storage_provider text not null,
  storage_key text not null unique,
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp','image/heic','image/heif')),
  expected_size_bytes bigint not null check (expected_size_bytes between 1 and 10485760),
  expires_at timestamptz not null,
  completed_at timestamptz,
  attachment_id uuid references support_attachments(id) on delete set null,
  created_at timestamptz not null default now()
);
create index support_upload_intents_owner_idx on support_upload_intents(owner_user_id, created_at desc);

-- Invariantes del ticket para CUALQUIER escritor (servicio de usuario o `trust`):
--   · updated_at siempre fresco;
--   · pasar a closed rellena closed_at/closed_by; salir de closed los limpia.
create or replace function support_ticket_before_update()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status = 'closed' then
    if old.status is distinct from 'closed' then
      new.closed_at := coalesce(new.closed_at, now());
      new.closed_by := coalesce(new.closed_by, 'staff');
    end if;
  else
    new.closed_at := null;
    new.closed_by := null;
  end if;
  return new;
end $$;

create trigger trg_support_ticket_before_update
before update on support_tickets
for each row execute function support_ticket_before_update();

-- Responder (personal o usuario) mueve el estado y avisa al usuario cuando contesta el equipo.
create or replace function support_ticket_message_after_insert()
returns trigger language plpgsql as $$
declare
  t support_tickets%rowtype;
begin
  select * into t from support_tickets where id = new.ticket_id for update;
  if new.author_type = 'staff' then
    update support_tickets
       set last_staff_message_at = new.created_at,
           status = case when status = 'closed' then status else 'answered' end
     where id = new.ticket_id;
    insert into notifications(user_id, category, kind, title, body, data)
    values (t.user_id, 'system', 'support_reply', 'Respuesta de soporte',
            'Hemos respondido a tu consulta ' || t.reference || '.',
            jsonb_build_object('ticketId', t.id));
  else
    update support_tickets
       set last_user_message_at = new.created_at,
           status = case when status = 'answered' then 'open' else status end
     where id = new.ticket_id;
  end if;
  return new;
end $$;

create trigger trg_support_ticket_message_after_insert
after insert on support_ticket_messages
for each row execute function support_ticket_message_after_insert();
