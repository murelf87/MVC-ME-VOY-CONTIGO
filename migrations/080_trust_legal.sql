-- Módulo trust · documentos legales versionados y registros de aceptación.
-- Solo referencia tablas base (001–012).
--
-- IMPORTANTE: el texto sembrado aquí NO es texto legal. Términos, privacidad y cancelación son estructuras neutras
-- («Contenido pendiente de revisión legal») y el aviso de la comprobación privada es el copy de la pantalla 07 aprobada.
-- Todos nacen como `draft_pending_legal_review` (sin validez legal) y solo pueden publicarse con una referencia de revisión legal.

-- Huella estable del contenido (título + secciones) calculada por la base de datos para que semillas y altas desde la API coincidan.
create or replace function trust_legal_content_hash(p_title text, p_sections jsonb)
returns char(64)
language sql
immutable
as $$
  select encode(digest(convert_to(p_title || E'\n' || p_sections::text, 'UTF8'), 'sha256'), 'hex')::char(64)
$$;

create table trust_legal_documents(
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('terms','privacy','cancellation','private_check_notice')),
  version integer not null check (version > 0),
  status text not null default 'draft_pending_legal_review'
    check (status in ('draft_pending_legal_review','published','retired')),
  title text not null check (char_length(title) between 3 and 200),
  locale text not null default 'es-ES' check (locale = 'es-ES'),
  -- [{ "heading": text, "paragraphs": text[], "bullets": text[] }]
  sections jsonb not null check (jsonb_typeof(sections) = 'array' and jsonb_array_length(sections) between 1 and 60),
  content_sha256 char(64) not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  -- Quién/qué aprobó el texto (acta, ticket, informe del despacho). Obligatoria para publicar.
  legal_review_reference text check (legal_review_reference is null or char_length(legal_review_reference) between 3 and 300),
  effective_from timestamptz,
  published_at timestamptz,
  published_by_user_id uuid references app_users(id),
  retired_at timestamptz,
  created_by_user_id uuid references app_users(id),
  created_at timestamptz not null default now(),
  unique (kind, version),
  check (status <> 'published'
         or (published_at is not null and effective_from is not null and legal_review_reference is not null)),
  check (status <> 'retired' or retired_at is not null)
);
-- A lo sumo una versión publicada vigente por tipo.
create unique index trust_legal_one_published_uidx on trust_legal_documents(kind) where status = 'published';
create index trust_legal_kind_version_idx on trust_legal_documents(kind, version desc);

-- El contenido de una versión es inmutable (una corrección es una versión nueva) y un documento publicado no vuelve a borrador.
create or replace function trust_legal_documents_guard()
returns trigger
language plpgsql
as $$
begin
  if new.kind is distinct from old.kind
     or new.version is distinct from old.version
     or new.title is distinct from old.title
     or new.sections is distinct from old.sections
     or new.content_sha256 is distinct from old.content_sha256 then
    raise exception 'trust_legal_documents: el contenido de una version es inmutable' using errcode = '23514';
  end if;
  if old.status in ('published','retired') and new.status = 'draft_pending_legal_review' then
    raise exception 'trust_legal_documents: un documento publicado no vuelve a borrador' using errcode = '23514';
  end if;
  if old.status = 'retired' and new.status <> 'retired' then
    raise exception 'trust_legal_documents: un documento retirado no se reactiva' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger trg_trust_legal_documents_guard
before update on trust_legal_documents
for each row execute function trust_legal_documents_guard();

-- Registro de aceptación: usuario, versión, instante y HMAC de la IP (nunca la IP; sin pepper no se guarda hash).
create table trust_legal_acceptances(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  document_id uuid not null references trust_legal_documents(id),
  kind text not null check (kind in ('terms','privacy','cancellation','private_check_notice')),
  version integer not null check (version > 0),
  context text not null default 'account'
    check (context in ('registration','account','booking','private_check','other')),
  -- Estado legal del documento en el momento de aceptar (un borrador pendiente de revisión legal no es vinculante).
  document_status text not null check (document_status in ('draft_pending_legal_review','published','retired')),
  accepted_at timestamptz not null default now(),
  ip_hash char(64) check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  unique (user_id, document_id)
);
create index trust_legal_acceptances_user_idx on trust_legal_acceptances(user_id, accepted_at desc, id desc);
create index trust_legal_acceptances_doc_idx on trust_legal_acceptances(document_id);

insert into trust_legal_documents(kind, version, status, title, sections, content_sha256)
select s.kind, 1, 'draft_pending_legal_review', s.title, s.sections::jsonb,
       trust_legal_content_hash(s.title, s.sections::jsonb)
from (values
  ('terms', 'Términos y condiciones de uso', $json$[
    {"heading":"Estado de este documento","paragraphs":["Esta es una estructura provisional. El texto definitivo lo redactará y aprobará el equipo legal de MVC antes de publicarse. Hasta entonces no tiene validez legal."],"bullets":[]},
    {"heading":"Objeto del servicio","paragraphs":["Contenido pendiente de revisión legal."],"bullets":[]},
    {"heading":"Cuenta y verificación","paragraphs":["Contenido pendiente de revisión legal."],"bullets":[]},
    {"heading":"Uso de la plataforma","paragraphs":["Contenido pendiente de revisión legal."],"bullets":[]},
    {"heading":"Aportaciones, comisiones y pagos","paragraphs":["Contenido pendiente de revisión legal."],"bullets":[]},
    {"heading":"Cancelaciones","paragraphs":["Contenido pendiente de revisión legal."],"bullets":[]},
    {"heading":"Responsabilidad","paragraphs":["Contenido pendiente de revisión legal."],"bullets":[]},
    {"heading":"Contacto","paragraphs":["Contenido pendiente de revisión legal."],"bullets":[]}
  ]$json$),
  ('privacy', 'Política de privacidad', $json$[
    {"heading":"Estado de este documento","paragraphs":["Esta es una estructura provisional. El texto definitivo lo redactará y aprobará el equipo legal de MVC antes de publicarse. Hasta entonces no tiene validez legal."],"bullets":[]},
    {"heading":"Responsable del tratamiento","paragraphs":["Contenido pendiente de revisión legal."],"bullets":[]},
    {"heading":"Datos que se tratan","paragraphs":["Contenido pendiente de revisión legal."],"bullets":[]},
    {"heading":"Finalidades y base jurídica","paragraphs":["Contenido pendiente de revisión legal."],"bullets":[]},
    {"heading":"Conservación","paragraphs":["Contenido pendiente de revisión legal."],"bullets":[]},
    {"heading":"Destinatarios","paragraphs":["Contenido pendiente de revisión legal."],"bullets":[]},
    {"heading":"Derechos de las personas usuarias","paragraphs":["Contenido pendiente de revisión legal."],"bullets":[]},
    {"heading":"Contacto","paragraphs":["Contenido pendiente de revisión legal."],"bullets":[]}
  ]$json$),
  ('cancellation', 'Política de cancelación', $json$[
    {"heading":"Estado de este documento","paragraphs":["Esta es una estructura provisional. La política de cancelación todavía no está definida: la aprobará el equipo de MVC con revisión legal antes de publicarse. Hasta entonces no tiene validez legal."],"bullets":[]},
    {"heading":"Cancelación por la persona pasajera","paragraphs":["Contenido pendiente de revisión legal."],"bullets":[]},
    {"heading":"Cancelación por la persona conductora","paragraphs":["Contenido pendiente de revisión legal."],"bullets":[]},
    {"heading":"Devoluciones","paragraphs":["Contenido pendiente de revisión legal."],"bullets":[]},
    {"heading":"Casos de fuerza mayor","paragraphs":["Contenido pendiente de revisión legal."],"bullets":[]}
  ]$json$),
  ('private_check_notice', 'Privacidad de la comprobación', $json$[
    {"heading":"Tus fotos, usos y privacidad","paragraphs":[],"bullets":["Foto visible en tu perfil: la ven otros usuarios para generar confianza en los trayectos.","Comprobación privada: solo la ve el equipo de MVC para revisar tu cuenta."]},
    {"heading":"Qué se usa y para qué","paragraphs":[],"bullets":["Comprobamos que la foto y la cuenta pertenecen a una persona real.","No se muestra esta foto a otros usuarios.","No se utiliza para ningún otro fin."]},
    {"heading":"Conservación y proveedor: por definir","paragraphs":["El tiempo de conservación y el proveedor del servicio se definirán en próximas fases."],"bullets":[]},
    {"heading":"Otra forma de verificar","paragraphs":["Puedes aportar un documento de identidad."],"bullets":[]}
  ]$json$)
) as s(kind, title, sections)
on conflict (kind, version) do nothing;
