-- Módulo money · pagos y almacén de eventos del proveedor.
-- `payments.status` solo lo mueve el servidor a partir de eventos del proveedor (nunca el cliente).

create table payments(
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references ride_requests(id),
  payer_user_id uuid not null references app_users(id),
  provider text not null check (length(provider) between 1 and 40 and provider <> 'disabled'),
  provider_payment_ref text not null check (length(provider_payment_ref) between 3 and 200),
  amount_cents integer not null check (amount_cents > 0),
  -- Importe realmente cobrado según el evento firmado del proveedor (NULL hasta `succeeded`). Normalmente = amount_cents;
  -- si difiere, el pago queda en `amount_mismatch` (revisión manual) y las devoluciones se limitan a lo cobrado.
  collected_cents integer check (collected_cents is null or collected_cents > 0),
  currency char(3) not null default 'EUR' check (currency = 'EUR'),
  status text not null check (status in ('requires_action','processing','succeeded','failed','expired','refunded')),
  outcome text not null default 'awaiting_payment' check (outcome in (
    'awaiting_payment','booking_confirmed','late_payment','amount_mismatch','duplicate_payment',
    'request_not_payable','failed','expired','refunded'
  )),
  method_kind text not null check (method_kind in ('apple_pay','google_pay','card','sepa_debit','bank_account')),
  payment_method_id uuid references payment_methods(id),
  quote_snapshot_id uuid references quote_snapshots(id),
  tariff_version_id uuid references tariff_versions(id),
  -- Política aprobada vigente al pagar (versión «aceptada por el usuario»). NULL = no había política aprobada.
  cancellation_policy_id uuid references cancellation_policies(id),
  -- Instantánea del desglose: contributionCents, passengerCommissionCents, driverCommissionCents, processingCents, taxesCents, totalCents.
  breakdown jsonb not null,
  hold_id uuid references seat_holds(id),
  booking_id uuid references bookings(id),
  refunded_cents integer not null default 0 check (refunded_cents >= 0),
  failure_code text check (failure_code is null or length(failure_code) <= 80),
  last_event_at timestamptz,
  succeeded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_payment_ref),
  check (refunded_cents <= coalesce(collected_cents, amount_cents)),
  check (status <> 'refunded' or refunded_cents = coalesce(collected_cents, amount_cents)),
  check (status <> 'succeeded' or collected_cents is not null),
  check ((breakdown->>'totalCents')::integer = amount_cents)
);
-- A lo sumo un pago abierto por solicitud (evita doble cobro simultáneo).
create unique index payments_one_open_per_request_uidx on payments(request_id) where status in ('requires_action','processing');
create unique index payments_booking_uidx on payments(booking_id) where booking_id is not null;
create index payments_payer_created_idx on payments(payer_user_id, created_at desc);
create index payments_request_created_idx on payments(request_id, created_at desc);

-- Almacén idempotente de eventos del proveedor: (provider, provider_event_id) único.
-- No guarda el cuerpo crudo (podría contener datos personales): solo lo normalizado.
create table payment_events(
  id bigserial primary key,
  provider text not null check (length(provider) between 1 and 40),
  provider_event_id text not null check (length(provider_event_id) between 1 and 200),
  object_kind text not null check (object_kind in ('payment','refund','payout')),
  event_type text not null check (length(event_type) between 1 and 80),
  provider_object_ref text check (provider_object_ref is null or length(provider_object_ref) <= 200),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  outcome text not null check (outcome in ('applied','ignored_stale','ignored_conflict','ignored_unsupported','compensation_created')),
  detail jsonb not null default '{}'::jsonb,
  unique (provider, provider_event_id)
);
create index payment_events_object_idx on payment_events(provider, provider_object_ref, occurred_at);
