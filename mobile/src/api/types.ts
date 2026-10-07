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
