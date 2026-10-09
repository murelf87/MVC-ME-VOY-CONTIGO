-- Módulo money · fundamentos: idempotencia de operaciones monetarias, métodos de pago tokenizados y
-- política de cancelación versionada. Solo referencia tablas base (001–012).

-- ───────── Idempotencia (cabecera Idempotency-Key) ─────────
-- La respuesta guardada se escribe en la MISMA transacción que los efectos: o existen ambos o ninguno.
create table idempotency_keys(
  user_id uuid not null references app_users(id) on delete cascade,
  idem_key text not null check (idem_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  scope text not null check (length(scope) between 1 and 200),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  response_status integer not null check (response_status between 200 and 299),
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, idem_key)
);
create index idempotency_keys_created_idx on idempotency_keys(created_at);

-- ───────── Métodos de pago: SOLO referencias tokenizadas del proveedor (nunca PAN/CVV/IBAN completo) ─────────
create table payment_methods(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  purpose text not null check (purpose in ('charge','payout')),
  provider text not null check (length(provider) between 1 and 40 and provider <> 'disabled'),
  provider_method_ref text not null
    check (length(provider_method_ref) between 3 and 200)
    -- defensa en profundidad: una referencia compuesta solo por dígitos/espacios/guiones (aspecto de PAN) no es un token.
    check (provider_method_ref !~ '^[0-9][0-9 -]{11,22}[0-9]$'),
  kind text not null check (kind in ('card','sepa_debit','bank_account','apple_pay','google_pay')),
  brand text check (brand is null or length(brand) <= 40),
  last4 char(4) check (last4 is null or last4 ~ '^[0-9]{4}$'),
  country char(2) check (country is null or country ~ '^[A-Z]{2}$'),
  exp_month smallint check (exp_month is null or exp_month between 1 and 12),
  exp_year smallint check (exp_year is null or exp_year between 2000 and 2100),
  is_default boolean not null default false,
  status text not null default 'active' check (status in ('active','requires_action','expired','removed')),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  unique (provider, provider_method_ref),
  check ((status = 'removed') = (removed_at is not null))
);
create unique index payment_methods_one_default_uidx
  on payment_methods(user_id, purpose) where is_default and status in ('active','requires_action');
create index payment_methods_user_idx on payment_methods(user_id, purpose, created_at desc) where status <> 'removed';

-- ───────── Política de cancelación versionada ─────────
-- NO existe ninguna política aprobada: la tabla se entrega vacía. Aprobar una exige decisión jurídica/comercial.
-- rules (array) = reglas por escenario; ver src/modules/money/cancellations/policy-engine.ts:
--   { scenario, minHoursBeforeDeparture, refundContributionBps, refundCommissionBps, refundProcessingBps, refundTaxesBps }
-- La retención de comisión es un DATO de la política (refundCommissionBps < 10000), nunca una regla fija del código.
create table cancellation_policies(
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version > 0),
  status text not null default 'draft' check (status in ('draft','pending_review','approved','retired')),
  title text not null check (length(title) between 1 and 200),
  summary text check (summary is null or length(summary) <= 2000),
  legal_notice text check (legal_notice is null or length(legal_notice) <= 2000),
  rules jsonb not null default '[]'::jsonb check (jsonb_typeof(rules) = 'array'),
  effective_from timestamptz,
  approved_by_user_id uuid references app_users(id),
  approved_at timestamptz,
  created_by_user_id uuid references app_users(id),
  created_at timestamptz not null default now(),
  check (status not in ('approved','retired')
         or (effective_from is not null and approved_at is not null and approved_by_user_id is not null))
);
-- A lo sumo una política aprobada vigente a la vez.
create unique index cancellation_policies_one_approved_uidx on cancellation_policies((true)) where status = 'approved';
