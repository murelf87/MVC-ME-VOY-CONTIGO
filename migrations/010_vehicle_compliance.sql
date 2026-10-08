alter table private_documents
  drop constraint if exists private_documents_kind_check;

alter table private_documents
  add constraint private_documents_kind_check
  check(kind in (
    'identity_document',
    'driver_license',
    'vehicle_registration',
    'vehicle_insurance',
    'vehicle_photo',
    'other'
  ));

alter table private_documents
  add column analysis_status text not null default 'not_required'
    check(analysis_status in ('not_required','pending','processing','succeeded','needs_review','failed')),
  add column detected_expires_on date,
  add column verified_expires_on date,
  add column analysis_confidence numeric(5,4)
    check(analysis_confidence is null or (analysis_confidence >= 0 and analysis_confidence <= 1)),
  add column analyzer_provider text,
  add column analyzer_reference text,
  add column analyzed_at timestamptz,
  add column expiry_verification_source text
    check(expiry_verification_source is null or expiry_verification_source in ('automatic','manual'));

alter table vehicles
  add column vehicle_photo_status vehicle_review_status not null default 'pending',
  add column vehicle_photo_document_id uuid references private_documents(id),
  add column insurance_status vehicle_review_status not null default 'pending',
  add column insurance_expires_on date,
  add column insurance_document_id uuid references private_documents(id),
  add column insurance_reviewed_at timestamptz;

create index private_documents_insurance_analysis_idx
  on private_documents(vehicle_id,analysis_status,created_at desc)
  where kind='vehicle_insurance';

create index vehicles_insurance_expiry_idx
  on vehicles(insurance_expires_on)
  where insurance_status='approved';
