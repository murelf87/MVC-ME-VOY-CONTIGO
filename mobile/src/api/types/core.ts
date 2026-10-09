/** Roles de autoservicio: se piden al registrarse. */
export type Role = "passenger" | "driver";
/** Roles de personal: solo los concede la administración; nunca vienen de un registro público. */
export type StaffRole = "admin" | "verification_admin" | "finance_admin" | "support_admin";
/** Todo lo que el backend puede devolver en `roles` (`/me`, `/v1/auth/session`). */
export type AnyRole = Role | StaffRole;

export type PublicPhotoStatus = "pending" | "approved" | "rejected";
export type IdentityStatus = "unverified" | "pending" | "verified" | "rejected";

export type AuthUser = {
  id: string;
  roles: AnyRole[];
};

export type SessionPayload = {
  token: string;
  expiresAt: string;
  user: AuthUser;
};

export type SessionInfo = {
  user: AuthUser;
  session: {
    id: string;
    expiresAt: string;
  };
};

/**
 * Respuesta real de `GET /me` (fila SQL tal cual: snake_case).
 * `public_photo_key` es null mientras no se haya subido foto pública.
 */
export type MeProfile = {
  id: string;
  phone_e164: string | null;
  status: string;
  display_name: string | null;
  public_photo_key: string | null;
  public_photo_status: PublicPhotoStatus;
  identity_status: IdentityStatus;
  presence_status: string | null;
  roles: AnyRole[];
};

/** Respuesta de `PATCH /v1/me/profile`. */
export type UpdatedProfile = {
  user_id: string;
  display_name: string | null;
  public_photo_status: PublicPhotoStatus;
  identity_status: IdentityStatus;
  presence_status: string | null;
  updated_at: string;
};

export type VerificationStart = {
  challengeId: string;
  expiresAt: string;
};

export type Province = {
  id: string;
  code: string;
  name: string;
  sourceName?: string | null;
  sourceUrl?: string | null;
  sourceDate?: string | null;
  sourceLicense?: string | null;
};

export type LatLng = {
  latitude: number;
  longitude: number;
};

export type GeocodeResult = {
  provider: string;
  placeId: string;
  formattedAddress: string;
  location: LatLng;
  types: string[];
};

export type TripSearchParams = {
  provinceId: string;
  provinceName: string;
  origin: GeocodeResult;
  destination: GeocodeResult;
};

export type TripSearchResult = {
  tripId: string;
  category: string;
  leg: string;
  departureAt: string | null;
  fromSegmentSeq: number;
  toSegmentSeq: number;
  pickupDistanceM: number;
  dropoffDistanceM: number;
  roadDistanceM: number;
  estimatedDurationS: number;
  availableSeats: number;
  driverDisplayName: string | null;
};

export type Vehicle = {
  id: string;
  make: string;
  model: string;
  plate: string;
  passenger_seats: number;
  review_status: string;
  documentation_status: string;
  vehicle_photo_status: string;
  vehicle_photo_document_id?: string | null;
  insurance_status: string;
  insurance_expires_on?: string | null;
  insurance_document_id?: string | null;
  insurance_reviewed_at?: string | null;
  review_reason?: string | null;
  reviewed_at?: string | null;
};

export type RideRequest = {
  id: string;
  trip_id: string;
  passenger_user_id: string;
  status: string;
  from_segment_seq: number;
  to_segment_seq: number;
  requested_at?: string;
  updated_at?: string;
};


export type PrivateDocument = {
  id: string;
  vehicle_id?: string | null;
  kind: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  review_status: string;
  review_reason?: string | null;
  analysis_status?: string | null;
  detected_expires_on?: string | null;
  verified_expires_on?: string | null;
  analysis_confidence?: number | null;
  analyzer_provider?: string | null;
  analyzed_at?: string | null;
  expiry_verification_source?: "automatic" | "manual" | null;
  reviewed_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type PrivateUploadIntent = {
  intentId: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
};

export type InsuranceAnalysis = {
  id?: string;
  vehicle_id?: string;
  analysis_status?: string;
  detected_expires_on?: string | null;
  analysis_confidence?: number | null;
  analyzer_provider?: string | null;
  analyzed_at?: string | null;
  status?: string;
  provider?: string;
};

export type CompletePrivateUpload = {
  document: PrivateDocument;
  analysis?: InsuranceAnalysis | null;
  alreadyCompleted: boolean;
};
