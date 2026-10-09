-- Módulo money · propuestas de devolución (cancelaciones, no-show, pagos tardíos) revisadas por finanzas.
-- Una propuesta NUNCA se resuelve sola salvo lo que dicte una política aprobada; las consecuencias de la cancelación
-- del conductor y del no-show están «no definidas» y quedan siempre en pending_review.

create table refund_requests(
  id uuid primary key default gen_random_uuid(),
  origin text not null check (origin in (
    'passenger_cancellation','driver_cancellation','platform_cancellation','force_majeure','no_show','late_payment','other'
  )),
  status text not null default 'pending_review' check (status in (
    'pending_review','approved','executing','refunded','rejected','failed','not_applicable'
  )),
  request_id uuid not null references ride_requests(id),
  booking_id uuid references bookings(id),
  payment_id uuid references payments(id),
  compensation_id uuid references payment_compensations(id),
  trip_id uuid not null references trips(id),
  passenger_user_id uuid not null references app_users(id),
  driver_user_id uuid references app_users(id),
  cancelled_by text check (cancelled_by in ('passenger','driver','platform','system')),
  cancelled_by_user_id uuid references app_users(id),
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 80),
  cancel_note text check (cancel_note is null or length(cancel_note) <= 500),
  cancelled_at timestamptz,
  paid_cents integer not null check (paid_cents >= 0),
  -- NULL = «Por definir» (sin política aprobada). Pagos tardíos: devolución íntegra.
  proposed_cents integer check (proposed_cents is null or (proposed_cents >= 0 and proposed_cents <= paid_cents)),
  approved_cents integer check (approved_cents is null or (approved_cents >= 0 and approved_cents <= paid_cents)),
  -- Comisión que la plataforma retendría según la propuesta (NULL = «Por definir»).
  retained_commission_cents integer check (retained_commission_cents is null or retained_commission_cents >= 0),
  policy_id uuid references cancellation_policies(id),
  policy_status text not null default 'pending_review' check (policy_status in ('pending_review','approved')),
  decision_basis text check (decision_basis in ('policy','manual_override','manual_without_policy','late_payment_full_refund')),
  decided_by_user_id uuid references app_users(id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 1000),
  execution_status text not null default 'not_started' check (execution_status in (
    'not_started','awaiting_provider','submitted','succeeded','failed'
  )),
  provider_refund_ref text check (provider_refund_ref is null or length(provider_refund_ref) <= 200),
  -- Nº de peticiones de ejecución enviadas al proveedor (parte de su clave idempotente: un reintento tras fallo es otra petición).
  execution_attempts integer not null default 0 check (execution_attempts >= 0),
  failure_code text check (failure_code is null or length(failure_code) <= 80),
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status not in ('approved','executing','refunded') or (approved_cents is not null and approved_cents > 0)),
  check (status <> 'refunded' or refunded_at is not null),
  check (policy_status <> 'approved' or policy_id is not null)
);
-- Una consecuencia por reserva y origen (idempotencia de la materialización de cancelaciones/no-show).
create unique index refund_requests_booking_origin_uidx on refund_requests(booking_id, origin) where booking_id is not null;
create unique index refund_requests_compensation_uidx on refund_requests(compensation_id) where compensation_id is not null;
create unique index refund_requests_provider_ref_uidx on refund_requests(provider_refund_ref) where provider_refund_ref is not null;
create index refund_requests_status_created_idx on refund_requests(status, created_at desc, id);
create index refund_requests_passenger_idx on refund_requests(passenger_user_id, created_at desc, id);
create index refund_requests_payment_idx on refund_requests(payment_id) where payment_id is not null;
create index refund_requests_trip_idx on refund_requests(trip_id);

alter table ledger_transactions
  add constraint ledger_transactions_refund_fk foreign key (refund_request_id) references refund_requests(id);
alter table receipts
  add constraint receipts_refund_fk foreign key (refund_request_id) references refund_requests(id);
