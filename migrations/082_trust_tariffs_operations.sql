-- Módulo trust · borradores de tarifas, restricciones/alertas de operación y alertas generadas.
-- Solo referencia tablas base (001–012). `tariff_versions` es de la base (001): aquí solo se AÑADEN columnas
-- (`if not exists`, compatibles con el resto de módulos). Nada de este módulo activa una tarifa.

alter table tariff_versions
  add column if not exists premium_monthly_cents integer check (premium_monthly_cents is null or premium_monthly_cents >= 0),
  add column if not exists approval_reference text check (approval_reference is null or char_length(approval_reference) between 3 and 300),
  add column if not exists created_by_user_id uuid references app_users(id),
  add column if not exists updated_by_user_id uuid references app_users(id),
  add column if not exists approved_by_user_id uuid references app_users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists retired_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists tariff_versions_status_version_idx on tariff_versions(status, version desc);

-- Configuración de operaciones (una sola fila). «Solo trayectos dentro de la provincia» no es configurable: está siempre activo.
create table trust_operations_settings(
  id boolean primary key default true check (id),
  realtime_alerts_enabled boolean not null default true,
  updated_at timestamptz,
  updated_by_user_id uuid references app_users(id)
);
insert into trust_operations_settings(id) values (true) on conflict (id) do nothing;

create table trust_alert_rules(
  kind text primary key check (kind in ('unusual_cancellations','schedule_price_changes','route_incidents')),
  enabled boolean not null default true,
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  updated_at timestamptz,
  updated_by_user_id uuid references app_users(id)
);
insert into trust_alert_rules(kind, enabled, params) values
  ('unusual_cancellations', true, '{"thresholdCount":5,"windowMinutes":60}'::jsonb),
  ('schedule_price_changes', true, '{"maxPendingMinutes":30}'::jsonb),
  ('route_incidents', true, '{"thresholdCount":1,"windowMinutes":60}'::jsonb)
on conflict (kind) do nothing;

-- Alertas generadas SOLO a partir de eventos reales por el evaluador (src/modules/trust/operations/evaluator.ts).
create table trust_admin_alerts(
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('unusual_cancellations','schedule_price_changes','route_incidents')),
  severity text not null check (severity in ('info','warning','critical')),
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  -- Una alerta abierta/reconocida por clave: el evaluador no duplica mientras siga viva.
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  title text not null check (char_length(title) between 1 and 160),
  body text not null check (char_length(body) between 1 and 600),
  province_id uuid references provinces(id),
  -- Solo identificadores y recuentos (sin datos personales).
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  detected_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by_user_id uuid references app_users(id),
  resolved_at timestamptz,
  resolved_by_user_id uuid references app_users(id),
  updated_at timestamptz not null default now(),
  check (status <> 'resolved' or resolved_at is not null),
  check (status <> 'acknowledged' or acknowledged_at is not null)
);
create unique index trust_admin_alerts_live_dedupe_uidx on trust_admin_alerts(dedupe_key) where status in ('open','acknowledged');
create index trust_admin_alerts_list_idx on trust_admin_alerts(status, detected_at desc, id desc);
create index trust_admin_alerts_kind_idx on trust_admin_alerts(kind, detected_at desc);
