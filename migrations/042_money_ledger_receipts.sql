-- Módulo money · libro mayor (solo-añadir, partida doble, céntimos enteros) y recibos (justificantes no fiscales).

create table ledger_transactions(
  id bigserial primary key,
  -- Clave idempotente de la operación contable (p. ej. «charge:<paymentId>»): el mismo asiento no se publica dos veces.
  tx_key text not null unique check (length(tx_key) between 3 and 200),
  kind text not null check (kind in ('charge','charge_unallocated','refund_approved','refund_executed','payout','adjustment')),
  payment_id uuid references payments(id),
  booking_id uuid references bookings(id),
  -- Referencias a tablas posteriores (refund_requests / payout_runs): las FK se añaden en 043 y 044.
  refund_request_id uuid,
  payout_run_id uuid,
  memo text check (memo is null or length(memo) <= 500),
  created_at timestamptz not null default now()
);
create index ledger_transactions_payment_idx on ledger_transactions(payment_id);
create index ledger_transactions_booking_idx on ledger_transactions(booking_id);

create table ledger_entries(
  id bigserial primary key,
  transaction_id bigint not null references ledger_transactions(id),
  -- passenger: quien paga (cargo = negativo) · driver_payable: deuda con el conductor · platform_revenue: comisiones ·
  -- processing_fees: coste de procesamiento · tax_payable: impuestos · suspense: cobrado sin reserva ·
  -- refund_payable: devolución aprobada pendiente de ejecutar · external_payout: abonos enviados al conductor.
  account text not null check (account in (
    'passenger','driver_payable','platform_revenue','processing_fees','tax_payable','suspense','refund_payable','external_payout'
  )),
  user_id uuid references app_users(id),
  amount_cents bigint not null check (amount_cents <> 0),
  created_at timestamptz not null default now(),
  check ((account in ('passenger','driver_payable','refund_payable','external_payout')) = (user_id is not null))
);
create index ledger_entries_tx_idx on ledger_entries(transaction_id);
create index ledger_entries_user_account_idx on ledger_entries(user_id, account) where user_id is not null;

-- Invariante 1: cada transacción suma 0 (comprobado al confirmar, tras insertar todas sus líneas).
create function mvc_ledger_assert_balanced() returns trigger language plpgsql as $$
declare
  total bigint;
begin
  select coalesce(sum(amount_cents), 0) into total from ledger_entries where transaction_id = new.transaction_id;
  if total <> 0 then
    raise exception using errcode = '23514', message = 'MVC_LEDGER_UNBALANCED';
  end if;
  return null;
end $$;
create constraint trigger ledger_entries_balanced
  after insert on ledger_entries
  deferrable initially deferred
  for each row execute function mvc_ledger_assert_balanced();

-- Invariante 2: solo-añadir. Un error contable se corrige con un asiento inverso, nunca editando.
create function mvc_append_only() returns trigger language plpgsql as $$
begin
  raise exception using errcode = '55000', message = 'MVC_APPEND_ONLY_TABLE';
end $$;
create trigger ledger_entries_append_only before update or delete on ledger_entries
  for each row execute function mvc_append_only();
create trigger ledger_transactions_append_only before update or delete on ledger_transactions
  for each row execute function mvc_append_only();

-- ───────── Recibos: JUSTIFICANTES NO FISCALES inmutables ─────────
-- Numeración correlativa anual sin huecos: el contador se incrementa en la misma transacción que emite el recibo.
create table receipt_counters(
  year integer primary key check (year between 2000 and 2200),
  last_value integer not null default 0 check (last_value >= 0)
);

create table receipts(
  id uuid primary key default gen_random_uuid(),
  number text not null unique check (number ~ '^MVC-J-[0-9]{4}-[0-9]{6}$'),
  user_id uuid not null references app_users(id),
  kind text not null check (kind in ('payment','refund','earning_statement')),
  payment_id uuid references payments(id),
  booking_id uuid references bookings(id),
  refund_request_id uuid,
  payout_run_id uuid,
  counterpart_user_id uuid references app_users(id),
  total_cents bigint not null check (total_cents >= 0),
  -- [{ "key": "contribution", "cents": 1800 }, …]
  lines jsonb not null check (jsonb_typeof(lines) = 'array'),
  -- { tripId, departureAt, originLabel, destinationLabel } congelado en la emisión.
  trip_snapshot jsonb,
  issued_at timestamptz not null default now()
);
create unique index receipts_payment_uidx on receipts(payment_id) where kind = 'payment';
create unique index receipts_refund_uidx on receipts(refund_request_id) where kind = 'refund';
create unique index receipts_payout_uidx on receipts(payout_run_id) where kind = 'earning_statement';
create index receipts_user_issued_idx on receipts(user_id, issued_at desc, id);
create trigger receipts_append_only before update or delete on receipts
  for each row execute function mvc_append_only();
