/**
 * Conversión de filas de la base en memoria a las formas «de cable» del backend 0.14 (snake_case, `bigint` y
 * `numeric` como texto, fechas ISO). Cada función dice de qué `select` real procede.
 */
import { bigintText, iso, numericText } from "../core/wire";
import type { DocumentRow, ProfileRow, RideRequestRow, TripRow, UserRow, VehicleRow } from "../core/rows";
import type { UserRole } from "../core/types";

export type AnyRoleDto = UserRole;

/** `GET /me` (fila SQL tal cual). */
export function meWire(user: Readonly<UserRow>, profile: Readonly<ProfileRow> | undefined, roles: UserRole[]) {
  return {
    id: user.id,
    phone_e164: user.phone_e164,
    status: user.status,
    display_name: profile?.display_name ?? null,
    public_photo_key: profile?.public_photo_key ?? null,
    public_photo_status: profile?.public_photo_status ?? "pending",
    identity_status: profile?.identity_status ?? "unverified",
    presence_status: profile?.presence_status ?? null,
    roles,
  };
}

/** `POST /v1/me/vehicles` y `PUT /v1/me/vehicles/:id` (RETURNING del INSERT/UPDATE). */
export function vehicleSaveWire(v: Readonly<VehicleRow>) {
  return {
    id: v.id,
    make: v.make,
    model: v.model,
    plate: v.plate,
    passenger_seats: v.passenger_seats,
    color: v.color,
    review_status: v.review_status,
    documentation_status: v.documentation_status,
    vehicle_photo_status: v.vehicle_photo_status,
    insurance_status: v.insurance_status,
    insurance_expires_on: v.insurance_expires_on,
    created_at: iso(v.created_at),
    updated_at: iso(v.updated_at),
  };
}

/** `GET /v1/me/vehicles`. */
export function vehicleListWire(v: Readonly<VehicleRow>) {
  return {
    id: v.id,
    make: v.make,
    model: v.model,
    plate: v.plate,
    passenger_seats: v.passenger_seats,
    color: v.color,
    review_status: v.review_status,
    documentation_status: v.documentation_status,
    vehicle_photo_status: v.vehicle_photo_status,
    vehicle_photo_document_id: v.vehicle_photo_document_id,
    insurance_status: v.insurance_status,
    insurance_expires_on: v.insurance_expires_on,
    insurance_document_id: v.insurance_document_id,
    insurance_reviewed_at: iso(v.insurance_reviewed_at),
    review_reason: v.review_reason,
    reviewed_at: iso(v.reviewed_at),
    created_at: iso(v.created_at),
    updated_at: iso(v.updated_at),
  };
}

/** `POST /v1/admin/vehicles/:id/review`. */
export function vehicleReviewWire(v: Readonly<VehicleRow>) {
  return {
    id: v.id,
    driver_user_id: v.driver_user_id,
    make: v.make,
    model: v.model,
    plate: v.plate,
    passenger_seats: v.passenger_seats,
    review_status: v.review_status,
    documentation_status: v.documentation_status,
    vehicle_photo_status: v.vehicle_photo_status,
    insurance_status: v.insurance_status,
    insurance_expires_on: v.insurance_expires_on,
    review_reason: v.review_reason,
    reviewed_at: iso(v.reviewed_at),
  };
}

/** `POST /v1/me/uploads/:id/complete` (primer alta): RETURNING de `registerVerifiedPrivateDocument`. */
export function documentRegisteredWire(d: Readonly<DocumentRow>) {
  return {
    id: d.id,
    vehicle_id: d.vehicle_id,
    kind: d.kind,
    content_type: d.content_type,
    size_bytes: bigintText(d.size_bytes),
    sha256: d.sha256,
    review_status: d.review_status,
    analysis_status: d.analysis_status,
    detected_expires_on: d.detected_expires_on,
    verified_expires_on: d.verified_expires_on,
    created_at: iso(d.created_at),
    updated_at: iso(d.updated_at),
  };
}

/** `POST /v1/me/uploads/:id/complete` (ya completado): select reducido del servicio. */
export function documentExistingWire(d: Readonly<DocumentRow>) {
  return {
    id: d.id,
    vehicle_id: d.vehicle_id,
    kind: d.kind,
    content_type: d.content_type,
    size_bytes: bigintText(d.size_bytes),
    sha256: d.sha256,
    review_status: d.review_status,
    analysis_status: d.analysis_status,
    detected_expires_on: d.detected_expires_on,
    verified_expires_on: d.verified_expires_on,
    analysis_confidence: numericText(d.analysis_confidence, 4),
  };
}

/** `GET /v1/me/documents`. */
export function documentListWire(d: Readonly<DocumentRow>) {
  return {
    id: d.id,
    vehicle_id: d.vehicle_id,
    kind: d.kind,
    content_type: d.content_type,
    size_bytes: bigintText(d.size_bytes),
    sha256: d.sha256,
    review_status: d.review_status,
    review_reason: d.review_reason,
    reviewed_at: iso(d.reviewed_at),
    analysis_status: d.analysis_status,
    detected_expires_on: d.detected_expires_on,
    verified_expires_on: d.verified_expires_on,
    analysis_confidence: numericText(d.analysis_confidence, 4),
    analyzer_provider: d.analyzer_provider,
    analyzed_at: iso(d.analyzed_at),
    expiry_verification_source: d.expiry_verification_source,
    created_at: iso(d.created_at),
    updated_at: iso(d.updated_at),
  };
}

/** `POST /v1/admin/documents/:id/review`. */
export function documentReviewWire(d: Readonly<DocumentRow>) {
  return {
    id: d.id,
    owner_user_id: d.owner_user_id,
    vehicle_id: d.vehicle_id,
    kind: d.kind,
    content_type: d.content_type,
    size_bytes: bigintText(d.size_bytes),
    sha256: d.sha256,
    review_status: d.review_status,
    review_reason: d.review_reason,
    reviewed_at: iso(d.reviewed_at),
    analysis_status: d.analysis_status,
    detected_expires_on: d.detected_expires_on,
    verified_expires_on: d.verified_expires_on,
    analysis_confidence: numericText(d.analysis_confidence, 4),
    expiry_verification_source: d.expiry_verification_source,
  };
}

/** `POST /v1/me/trips` (RETURNING) y `GET /v1/me/trips`. */
export function tripDraftWire(t: Readonly<TripRow>, options: { withOwner: boolean }) {
  const base = {
    id: t.id,
    ...(options.withOwner ? { driver_user_id: t.driver_user_id } : {}),
    vehicle_id: t.vehicle_id,
    province_id: t.province_id,
    category: t.category,
    kind: t.kind,
    leg: t.leg,
    status: t.status,
    departure_at: iso(t.departure_at),
    flexibility_minutes: t.flexibility_minutes,
    max_detour_m: t.max_detour_m,
    offered_seats: t.offered_seats,
    route_distance_m: t.route_distance_m,
    route_duration_s: t.route_duration_s,
    route_provider: t.route_provider,
    route_provider_ref: t.route_provider_ref,
    route_version: t.route_version,
    created_at: iso(t.created_at),
    updated_at: iso(t.updated_at),
  };
  return base;
}

/** `POST /v1/trips/:id/requests` (INSERT … RETURNING). */
export function rideRequestCreatedWire(r: Readonly<RideRequestRow>) {
  return {
    id: r.id,
    trip_id: r.trip_id,
    passenger_user_id: r.passenger_user_id,
    from_segment_seq: r.from_segment_seq,
    to_segment_seq: r.to_segment_seq,
    status: r.status,
    requested_at: iso(r.requested_at),
    updated_at: iso(r.updated_at),
  };
}
