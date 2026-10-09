-- Módulo money · liquidaciones mensuales al conductor (una por conductor y mes natural).
-- El calendario de abonos NO está aprobado: scheduled_for es NULL («Por definir») hasta que lo fije Finanzas.

create table payout_runs(
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null references app_users(id),
  -- Primer día del mes natural liquidado (Europe/Madrid).
  period_month date not null check (period_month = date_trunc('month', period_month)::date),
  status text not null default 'draft' check (status in ('draft','processing','paid','failed','cancelled')),
  net_cents bigint not null check (net_cents > 0),
  bookings_count integer not null check (bookings_count > 0),
  scheduled_for date,
  payout_account_id uuid references payment_methods(id),
  provider text check (provider is null or length(provider) between 1 and 40),
  provider_payout_ref text check (provider_payout_ref is null or length(provider_payout_ref) <= 200),
  failure_code text check (failure_code is null or length(failure_code) <= 80),
  -- Peticiones de abono enviadas al proveedor (parte de su clave idempotente: un reintento tras fallo es otra petición).
  execution_attempts integer not null default 0 check (execution_attempts >= 0),
  paid_at timestamptz,
  created_by_user_id uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (driver_user_id, period_month),
  check (status <> 'paid' or paid_at is not null)
);
create unique index payout_runs_provider_ref_uidx on payout_runs(provider_payout_ref) where provider_payout_ref is not null;
create index payout_runs_period_idx on payout_runs(period_month, status);
create index payout_runs_driver_idx on payout_runs(driver_user_id, period_month desc);

-- Una reserva pertenece a lo sumo a una liquidación.
create table payout_run_items(
  payout_run_id uuid not null references payout_runs(id) on delete cascade,
  booking_id uuid not null unique references bookings(id),
  net_cents bigint not null,
  primary key (payout_run_id, booking_id)
);

alter table ledger_transactions
  add constraint ledger_transactions_payout_fk foreign key (payout_run_id) references payout_runs(id);
alter table receipts
  add constraint receipts_payout_fk foreign key (payout_run_id) references payout_runs(id);
