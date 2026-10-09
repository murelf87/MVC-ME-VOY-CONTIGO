-- Módulo trust · identidad: foto de perfil, comprobación privada (selfie) y subidas al almacenamiento privado.
-- Solo referencia tablas base (001–012) y las de trust. Los documentos de identidad y el permiso de conducir siguen
-- viviendo en `private_documents` (servicio existente); aquí solo hay lo que ese modelo no cubre.
--
-- NO hay biometría facial: la revisión la hace una persona. La selfie por sí sola nunca marca `profiles.identity_status`.

-- Intenciones de subida directa (URL firmada de un solo uso). Misma mecánica que `private_upload_intents`, sin atarse a un vehículo.
create table trust_upload_intents(
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references app_users(id) on delete cascade,
  purpose text not null check (purpose in ('profile_photo','identity_selfie','identity_document','driver_license')),
  storage_provider text not null,
  storage_key text not null unique,
  content_type text not null,
  expected_size_bytes bigint not null check (expected_size_bytes between 1 and 20971520),
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index trust_upload_intents_owner_idx on trust_upload_intents(owner_user_id, created_at desc);

-- Entregas de foto de perfil (la visible para otros usuarios está en profiles.public_photo_key + public_photo_status='approved').
create table trust_profile_photos(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  intent_id uuid unique references trust_upload_intents(id) on delete set null,
  storage_provider text not null,
  storage_key text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  sha256 char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'in_review' check (status in ('in_review','approved','rejected','superseded')),
  -- Código estable (TRUST_PHOTO_REASON_CODES) y nota interna del revisor (no se muestra al usuario).
  reason_code text,
  reason_note text check (reason_note is null or char_length(reason_note) <= 1000),
  decided_by_user_id uuid references app_users(id),
  decided_at timestamptz,
  submitted_at timestamptz not null default now(),
  unique (storage_provider, storage_key),
  check (status not in ('approved','rejected') or decided_at is not null)
);
create index trust_profile_photos_user_idx on trust_profile_photos(user_id, submitted_at desc, id desc);
create index trust_profile_photos_queue_idx on trust_profile_photos(submitted_at) where status = 'in_review';
-- A lo sumo una entrega esperando revisión por usuario (la anterior pasa a `superseded`).
create unique index trust_profile_photos_one_pending_uidx on trust_profile_photos(user_id) where status = 'in_review';

-- Estado de la comprobación privada (selfie) por usuario. Una fila por usuario: sirve de cerrojo para el límite de 3 intentos.
create table trust_identity_checks(
  user_id uuid primary key references app_users(id) on delete cascade,
  state text not null default 'not_started' check (state in ('not_started','in_review','needs_retry','completed','rejected')),
  attempts_used integer not null default 0 check (attempts_used between 0 and 3),
  reason_code text,
  reason_note text check (reason_note is null or char_length(reason_note) <= 1000),
  decided_by_user_id uuid references app_users(id),
  decided_at timestamptz,
  updated_at timestamptz not null default now()
);

create table trust_identity_check_attempts(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  attempt_no integer not null check (attempt_no between 1 and 3),
  intent_id uuid unique references trust_upload_intents(id) on delete set null,
  storage_provider text not null,
  storage_key text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  sha256 char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'in_review' check (status in ('in_review','accepted','needs_retry','rejected','superseded')),
  reason_code text,
  reason_note text check (reason_note is null or char_length(reason_note) <= 1000),
  -- Versión del aviso de privacidad (pantalla 07) aceptada al capturar: prueba del consentimiento.
  notice_document_id uuid references trust_legal_documents(id),
  decided_by_user_id uuid references app_users(id),
  decided_at timestamptz,
  submitted_at timestamptz not null default now(),
  unique (user_id, attempt_no),
  unique (storage_provider, storage_key)
);
create index trust_identity_check_attempts_user_idx on trust_identity_check_attempts(user_id, submitted_at desc, id desc);
create index trust_identity_check_attempts_queue_idx on trust_identity_check_attempts(submitted_at) where status = 'in_review';
