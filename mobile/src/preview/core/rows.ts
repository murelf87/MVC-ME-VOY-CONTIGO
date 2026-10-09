/**
 * Filas de las tablas base del backend (migraciones 001–012) tal y como las guarda la base en memoria.
 *
 * Convenciones (distintas del cable, que fija `wire.ts`):
 *  - Las columnas `timestamptz` se guardan como milisegundos desde epoch (`number`).
 *  - Las columnas `date` se guardan como `YYYY-MM-DD` (`string`).
 *  - `bigint`/`numeric` se guardan como `number`; se emiten como texto al responder.
 *  - Los nombres de columna conservan el snake_case de SQL.
 */
import type { UserRole } from "./types";

export type UserStatus = "active" | "suspended" | "deleted";
export type ProfileReviewStatus = "pending" | "approved" | "rejected";
export type IdentityStatus = "unverified" | "pending" | "verified" | "rejected";
export type VehicleReviewStatus = "pending" | "approved" | "rejected";
export type TripStatus = "draft" | "published" | "active" | "completed" | "cancelled";
export type TripCategory = "work" | "university" | "fp_academies" | "hospital" | "sport" | "other";
export type TripKind = "single" | "recurring";
export type TripLeg = "outbound" | "return";
export type RequestStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "payment_pending"
  | "confirmed"
  | "expired"
  | "cancelled"
  | "payment_late";
export type HoldStatus = "active" | "released" | "consumed";
export type BookingStatus = "confirmed" | "completed" | "cancelled" | "driver_cancelled" | "no_show";
export type DocumentKind =
  | "identity_document"
  | "driver_license"
  | "vehicle_registration"
  | "vehicle_insurance"
  | "vehicle_photo"
  | "other";
export type AnalysisStatus = "not_required" | "pending" | "succeeded" | "needs_review" | "failed";
export type ChallengeStatus =
  | "dispatching"
  | "pending"
  | "provider_approved"
  | "verified"
  | "expired"
  | "failed"
  | "cancelled";

export interface UserRow {
  id: string;
  phone_e164: string;
  status: UserStatus;
  created_at: number;
  updated_at: number;
}

export interface UserRoleRow {
  /** `${user_id}:${role}` */
  id: string;
  user_id: string;
  role: UserRole;
  created_at: number;
}

export interface ProfileRow {
  user_id: string;
  display_name: string | null;
  public_photo_key: string | null;
  public_photo_status: ProfileReviewStatus;
  identity_status: IdentityStatus;
  presence_status: string | null;
  created_at: number;
  updated_at: number;
}

export interface ChallengeRow {
  id: string;
  phone_e164: string;
  requested_roles: Array<"passenger" | "driver">;
  provider: string;
  provider_challenge_id: string | null;
  provider_status: string | null;
  status: ChallengeStatus;
  check_attempts: number;
  expires_at: number;
  requested_at: number;
  verified_at: number | null;
  provider_approved_at: number | null;
  updated_at: number;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: number;
  revoked_at: number | null;
  last_seen_at: number;
  created_at: number;
}

export interface VehicleRow {
  id: string;
  driver_user_id: string;
  make: string;
  model: string;
  /** Matrícula tal y como se muestra («1234 MBC»). */
  plate: string;
  /** Matrícula normalizada (índice único). */
  plate_normalized: string;
  passenger_seats: number;
  /** Extensión del contrato `trips` (opcional, máx. 40). */
  color: string | null;
  review_status: VehicleReviewStatus;
  documentation_status: VehicleReviewStatus;
  vehicle_photo_status: VehicleReviewStatus;
  vehicle_photo_document_id: string | null;
  insurance_status: VehicleReviewStatus;
  insurance_expires_on: string | null;
  insurance_document_id: string | null;
  insurance_reviewed_at: number | null;
  review_reason: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface DocumentRow {
  id: string;
  owner_user_id: string;
  vehicle_id: string | null;
  kind: DocumentKind;
  storage_provider: string;
  storage_key: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  review_status: ProfileReviewStatus;
  review_reason: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: number | null;
  analysis_status: AnalysisStatus;
  detected_expires_on: string | null;
  verified_expires_on: string | null;
  analysis_confidence: number | null;
  analyzer_provider: string | null;
  analyzer_reference: string | null;
  analyzed_at: number | null;
  expiry_verification_source: "automatic" | "manual" | null;
  created_at: number;
  updated_at: number;
}

export interface UploadIntentRow {
  id: string;
  owner_user_id: string;
  vehicle_id: string;
  kind: "vehicle_photo" | "vehicle_insurance";
  storage_provider: string;
  storage_key: string;
  content_type: string;
  expected_size_bytes: number;
  expires_at: number;
  completed_at: number | null;
  created_at: number;
}

/** Contorno SIMPLIFICADO (no oficial) de la provincia: anillo exterior en [lng, lat]. */
export interface ProvinceRow {
  id: string;
  code: string;
  name: string;
  source_name: string | null;
  source_url: string | null;
  source_date: string | null;
  source_license: string | null;
  ring: Array<[number, number]>;
}

export interface TripRow {
  id: string;
  driver_user_id: string;
  vehicle_id: string;
  province_id: string;
  category: TripCategory;
  kind: TripKind;
  leg: TripLeg;
  status: TripStatus;
  departure_at: number | null;
  flexibility_minutes: number;
  max_detour_m: number;
  offered_seats: number;
  origin_lat: number;
  origin_lng: number;
  destination_lat: number;
  destination_lng: number;
  /** Geometría de la ruta completa [lng, lat]. */
  route_geometry: Array<[number, number]>;
  route_distance_m: number;
  route_duration_s: number;
  route_provider: string;
  route_provider_ref: string;
  route_version: number;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface TripStopRow {
  /** `${trip_id}:${seq}` */
  id: string;
  trip_id: string;
  seq: number;
  kind: "origin" | "stop" | "destination";
  lat: number;
  lng: number;
  /** Nombre legible del sitio (sembrado o del gazetteer simulado más cercano). */
  label: string | null;
}

export interface TripSegmentRow {
  /** `${trip_id}:${seq}` */
  id: string;
  trip_id: string;
  seq: number;
  from_stop_seq: number;
  to_stop_seq: number;
  distance_m: number;
  duration_s: number;
  capacity: number;
}

export interface RideRequestRow {
  id: string;
  trip_id: string;
  passenger_user_id: string;
  from_segment_seq: number;
  to_segment_seq: number;
  status: RequestStatus;
  requested_at: number;
  updated_at: number;
  // ---- ampliación del módulo `trips` (columnas opcionales; las solicitudes heredadas 0.14 no las tienen) ----
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  pickup_label?: string | null;
  pickup_address?: string | null;
  pickup_source?: "driver_stop" | "route_projection" | null;
  pickup_offset_s?: number | null;
  pickup_walk_minutes?: number | null;
  pickup_detour_minutes?: number | null;
  dropoff_stop_seq?: number | null;
  road_distance_m?: number | null;
  message?: string | null;
  weekly_reservation_id?: string | null;
}

export interface SeatHoldRow {
  id: string;
  request_id: string;
  status: HoldStatus;
  expires_at: number;
  released_at: number | null;
  consumed_at: number | null;
  created_at: number;
}

export interface BookingRow {
  id: string;
  request_id: string;
  provider_payment_id: string;
  amount_cents: number;
  status: BookingStatus;
  picked_up_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface PickupCodeRow {
  /** = booking_id */
  id: string;
  booking_id: string;
  salt: string;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  generated_at: number;
  verified_at: number | null;
}

export interface LocationEventRow {
  /** Id interno del evento (equivale a `trip_location_events.id`, `bigserial`). */
  id: string;
  event_id: string;
  trip_id: string;
  driver_user_id: string;
  recorded_at: number;
  received_at: number;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  speed_mps: number | null;
  heading_degrees: number | null;
}

export interface LiveStateRow {
  /** = trip_id */
  id: string;
  trip_id: string;
  event_row_id: string;
  driver_user_id: string;
  recorded_at: number;
  received_at: number;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  speed_mps: number | null;
  heading_degrees: number | null;
  updated_at: number;
}

export interface DirectMessageRow {
  id: string;
  trip_id: string;
  sender_user_id: string;
  recipient_user_id: string;
  client_message_id: string;
  body: string;
  created_at: number;
  // ---- ampliación del módulo `comms` (migración 061); las filas heredadas 0.14 no las tienen ----
  seq?: number;
  kind?: "text" | "location";
  location_lat?: number | null;
  location_lng?: number | null;
  location_label?: string | null;
  hidden_at?: number | null;
  hidden_by_user_id?: string | null;
  hidden_reason?: string | null;
}

export interface BlockRow {
  /** `${blocker}:${blocked}` */
  id: string;
  blocker_user_id: string;
  blocked_user_id: string;
  created_at: number;
}

export interface AuditRow {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  request_id: string | null;
  metadata: Record<string, unknown>;
  created_at: number;
}

/** Códigos SMS que «envía» el proveedor simulado (equivale al servicio de verificación de Twilio). */
export interface SimSmsVerificationRow {
  /** providerChallengeId: `VE` + 32 hex. */
  id: string;
  phone_e164: string;
  code: string;
  status: "pending" | "approved" | "canceled";
  attempts: number;
  created_at: number;
}
