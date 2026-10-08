-- Payment core that does not depend on which regulated provider is chosen.
-- MVC never holds funds: the ledger only mirrors what the provider reports, in exact integer cents.

-- Inbox of provider webhooks. The unique key makes duplicate deliveries harmless.
create table payment_provider_events(
  id bigserial primary key,
  provider text not null,
  event_id text not null,
  event_type text not null,
  internal_type text,
  object_id text,
  occurred_at timestamptz not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  status text not null default 'received'
    check(status in ('received','processed','deferred','ignored','failed')),
  attempts integer not null default 0,
  last_error text,
  processed_at timestamptz,
  unique(provider,event_id)
);
create index payment_provider_events_status_idx on payment_provider_events(status,occurred_at);

-- Double entry: every transaction sums to zero (debit positive, credit negative).
create table ledger_transactions(
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('capture','release','refund','payout_reserve','payout_paid','payout_failed','dispute_lost','dispute_won')),
  idempotency_key text not null unique,
  booking_id uuid references bookings(id),
  payout_id uuid,
  provider_event_id bigint references payment_provider_events(id),
  created_at timestamptz not null default now()
);

create table ledger_entries(
  id bigserial primary key,
  txn_id uuid not null references ledger_transactions(id),
  account text not null check(account in (
    'provider_clearing',   -- money held by the provider on MVC's behalf
    'driver_pending',      -- owed to a driver, trip not completed yet
    'driver_available',    -- owed to a driver, can be paid out
    'driver_in_transit',   -- reserved for a payout the provider has not confirmed
    'platform_revenue',    -- MVC commissions
    'dispute_losses'       -- amounts taken back by a lost dispute
  )),
  user_id uuid references app_users(id),
  amount_cents bigint not null check(amount_cents <> 0),
  created_at timestamptz not null default now(),
  check((account like 'driver_%') = (user_id is not null))
);
create index ledger_entries_account_user_idx on ledger_entries(account,user_id);
create index ledger_entries_txn_idx on ledger_entries(txn_id);

create or replace function mvc_ledger_balanced() returns trigger language plpgsql as $$
begin
  if (select coalesce(sum(amount_cents),0) from ledger_entries where txn_id=new.txn_id) <> 0 then
    raise exception using errcode='23514', message='MVC_LEDGER_UNBALANCED';
  end if;
  return null;
end $$;
create constraint trigger trg_ledger_balanced
  after insert on ledger_entries deferrable initially deferred
  for each row execute function mvc_ledger_balanced();

create or replace function mvc_ledger_immutable() returns trigger language plpgsql as $$
begin
  raise exception using errcode='23514', message='MVC_LEDGER_IMMUTABLE';
end $$;
create trigger trg_ledger_entries_immutable before update or delete on ledger_entries
  for each row execute function mvc_ledger_immutable();
create trigger trg_ledger_transactions_immutable before update or delete on ledger_transactions
  for each row execute function mvc_ledger_immutable();

-- Refund split, so the ledger can reverse driver and platform shares exactly.
alter table booking_cancellations
  add column refund_contribution_cents integer check(refund_contribution_cents is null or refund_contribution_cents >= 0),
  add column refund_fee_cents integer check(refund_fee_cents is null or refund_fee_cents >= 0),
  add column provider_refund_id text unique,
  add column refunded_at timestamptz,
  add column refund_error text;

alter table payment_compensations
  add column provider_refund_id text unique,
  add column completed_at timestamptz;

create table payouts(
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null references app_users(id),
  period_month date not null check(extract(day from period_month) = 1),
  amount_cents bigint not null check(amount_cents > 0),
  status text not null default 'pending_provider'
    check(status in ('pending_provider','paid','failed')),
  provider_payout_id text unique,
  failure_reason text,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  last_event_at timestamptz,
  unique(driver_user_id,period_month)
);

create table payment_disputes(
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_dispute_id text not null unique,
  booking_id uuid references bookings(id),
  provider_payment_id text,
  amount_cents integer not null check(amount_cents >= 0),
  status text not null check(status in ('open','won','lost')),
  reason text,
  opened_at timestamptz,
  closed_at timestamptz,
  last_event_at timestamptz not null
);
