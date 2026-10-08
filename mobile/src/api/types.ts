export type Role = "passenger" | "driver";

export type AuthUser = {
  id: string;
  roles: Role[];
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

export type MeProfile = {
  id: string;
  phone_e164: string | null;
  status: string;
  display_name: string | null;
  public_photo_key: string | null;
  public_photo_status: "pending" | "approved" | "rejected";
  identity_status: "unverified" | "pending" | "verified" | "rejected";
  presence_status: string | null;
  roles: Role[];
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
  seriesId?: string | null;
  seriesWeekdays?: number[] | null;
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

export type PassengerRideRequest = {
  id: string;
  trip_id: string;
  from_segment_seq: number;
  to_segment_seq: number;
  status: string;
  requested_at: string;
  updated_at: string;
  hold_expires_at?: string | null;
  driver_user_id: string;
  driver_display_name: string | null;
  trip_status: string;
  departure_at: string | null;
  booking_id: string | null;
  booking_status: string | null;
  picked_up_at: string | null;
  my_rating_score?: number | null;
  weekly_group_id?: string | null;
  refund_cents?: number | null;
  refund_status?: string | null;
};

export type OwnTrip = {
  id: string;
  province_id: string;
  status: string;
  departure_at: string | null;
  category: string;
  offered_seats: number;
  route_distance_m?: number | null;
  route_duration_s?: number | null;
  series_id?: string | null;
  series_weekdays?: number[] | null;
  series_status?: string | null;
};

export type DriverRideRequest = {
  id: string;
  tripId: string;
  passenger_user_id: string;
  passenger_display_name: string | null;
  from_segment_seq: number;
  to_segment_seq: number;
  status: string;
  requested_at: string;
  updated_at: string;
  booking_id: string | null;
  booking_status: string | null;
  picked_up_at: string | null;
  my_rating_score?: number | null;
  weekly_group_id?: string | null;
};

export type ChatMessage = {
  id: string;
  trip_id?: string;
  sender_user_id: string;
  recipient_user_id?: string;
  body: string;
  created_at: string;
};

export type Conversation = {
  tripId: string;
  peerUserId: string;
  peerName: string;
  departureAt: string | null;
  tripStatus: string;
};

export type TripLocation = {
  tripId: string;
  precision: "precise" | "approximate";
  latitude: number;
  longitude: number;
  recordedAt: string;
  receivedAt: string;
  stale: boolean;
  ageSeconds: number;
  accuracyM?: number;
  speedMps?: number;
};

export type PublicLiveTrip = {
  tripId: string;
  latitude: number;
  longitude: number;
  recordedAt: string;
  stale: boolean;
  ageSeconds: number;
};
