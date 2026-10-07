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
};

export type Vehicle = {
  id: string;
  make: string;
  model: string;
  plate: string;
  passenger_seats: number;
  review_status: string;
  documentation_status: string;
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
