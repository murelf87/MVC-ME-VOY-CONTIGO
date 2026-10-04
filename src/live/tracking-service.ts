import type { Pool, PoolClient } from "pg";
import { DomainError } from "../errors.js";

export type LocationEventInput = {
  eventId: string;
  tripId: string;
  driverUserId: string;
  recordedAt: string;
  latitude: number;
  longitude: number;
  accuracyM?: number;
  speedMps?: number;
  headingDegrees?: number;
};

export type LocationWriteResult = {
  eventRowId: string;
  duplicate: boolean;
  acceptedAsCurrent: boolean;
};

export type VisibleTripLocation = {
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
  headingDegrees?: number;
};

function assertUuid(value: string, label: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new DomainError("INVALID_LOCATION_EVENT", `${label} must be a UUID`);
  }
}

function finiteInRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new DomainError("INVALID_LOCATION_EVENT", `${label} is outside its valid range`);
  }
}

function optionalFinite(value: number | undefined, min: number, max: number, label: string): void {
  if (value === undefined) return;
  finiteInRange(value, min, max, label);
}

function parseRecordedAt(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DomainError("INVALID_LOCATION_EVENT", "recordedAt must be a valid ISO timestamp");
  }
  const now = Date.now();
  if (date.getTime() > now + 120_000) {
    throw new DomainError("LOCATION_EVENT_FROM_FUTURE", "GPS timestamp is too far in the future", 422);
  }
  if (date.getTime() < now - 86_400_000) {
    throw new DomainError("LOCATION_EVENT_TOO_OLD", "GPS event is older than 24 hours", 422);
  }
  return date;
}

async function tx<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordDriverLocation(
  pool: Pool,
  input: LocationEventInput
): Promise<LocationWriteResult> {
  assertUuid(input.eventId, "eventId");
  finiteInRange(input.latitude, -90, 90, "latitude");
  finiteInRange(input.longitude, -180, 180, "longitude");
  optionalFinite(input.accuracyM, 0, 10_000, "accuracyM");
  optionalFinite(input.speedMps, 0, 150, "speedMps");
  optionalFinite(input.headingDegrees, 0, 359.999, "headingDegrees");
  const recordedAt = parseRecordedAt(input.recordedAt);

  return tx(pool, async client => {
    const tripResult = await client.query<{ driver_user_id: string; status: string }>(
      `select driver_user_id,status from trips where id=$1`,
      [input.tripId]
    );
    const trip = tripResult.rows[0];
    if (!trip) throw new DomainError("TRIP_NOT_FOUND", "Trip not found", 404);
    if (trip.driver_user_id !== input.driverUserId) {
      throw new DomainError("LOCATION_FORBIDDEN", "Only the trip driver may publish location", 403);
    }
    if (trip.status !== "active") {
      throw new DomainError("TRIP_NOT_LIVE", "Location may only be published for an active trip", 409);
    }

    const inserted = await client.query<{ id: string; received_at: Date }>(
      `insert into trip_location_events(
         event_id,trip_id,driver_user_id,recorded_at,geom,accuracy_m,speed_mps,heading_degrees
       ) values(
         $1,$2,$3,$4,ST_SetSRID(ST_Point($5,$6),4326),$7,$8,$9
       )
       on conflict(trip_id,event_id) do nothing
       returning id,received_at`,
      [
        input.eventId,
        input.tripId,
        input.driverUserId,
        recordedAt.toISOString(),
        input.longitude,
        input.latitude,
        input.accuracyM ?? null,
        input.speedMps ?? null,
        input.headingDegrees ?? null
      ]
    );

    let eventRowId: string;
    let receivedAt: Date;
    let duplicate = false;

    if (inserted.rowCount) {
      eventRowId = inserted.rows[0]!.id;
      receivedAt = inserted.rows[0]!.received_at;
    } else {
      duplicate = true;
      const existing = await client.query<{ id: string; received_at: Date }>(
        `select id,received_at from trip_location_events where trip_id=$1 and event_id=$2`,
        [input.tripId, input.eventId]
      );
      const row = existing.rows[0];
      if (!row) throw new Error("duplicate location event disappeared");
      eventRowId = row.id;
      receivedAt = row.received_at;
    }

    if (!duplicate) {
      await client.query(
        `insert into trip_live_state(
           trip_id,event_row_id,driver_user_id,recorded_at,received_at,geom,
           accuracy_m,speed_mps,heading_degrees
         )
         select trip_id,id,driver_user_id,recorded_at,received_at,geom,
                accuracy_m,speed_mps,heading_degrees
           from trip_location_events
          where id=$1
         on conflict(trip_id) do update set
           event_row_id=excluded.event_row_id,
           driver_user_id=excluded.driver_user_id,
           recorded_at=excluded.recorded_at,
           received_at=excluded.received_at,
           geom=excluded.geom,
           accuracy_m=excluded.accuracy_m,
           speed_mps=excluded.speed_mps,
           heading_degrees=excluded.heading_degrees,
           updated_at=now()
         where excluded.recorded_at > trip_live_state.recorded_at
            or (excluded.recorded_at = trip_live_state.recorded_at
                and excluded.received_at > trip_live_state.received_at)`,
        [eventRowId]
      );
    }

    const current = await client.query<{ event_row_id: string }>(
      `select event_row_id from trip_live_state where trip_id=$1`,
      [input.tripId]
    );

    return {
      eventRowId,
      duplicate,
      acceptedAsCurrent: current.rows[0]?.event_row_id === eventRowId
    };
  });
}

async function viewerCanSeePreciseLocation(
  pool: Pool,
  tripId: string,
  driverUserId: string,
  viewerUserId: string | null
): Promise<boolean> {
  if (!viewerUserId) return false;
  if (viewerUserId === driverUserId) return true;

  const result = await pool.query(
    `select 1
       from bookings b
       join ride_requests r on r.id=b.request_id
      where r.trip_id=$1
        and r.passenger_user_id=$2
        and r.status='confirmed'
        and b.status='confirmed'
      limit 1`,
    [tripId, viewerUserId]
  );
  return Boolean(result.rowCount);
}

export async function getTripLocationForViewer(
  pool: Pool,
  tripId: string,
  viewerUserId: string | null,
  staleAfterSeconds = 60
): Promise<VisibleTripLocation | null> {
  if (!Number.isInteger(staleAfterSeconds) || staleAfterSeconds < 5 || staleAfterSeconds > 3600) {
    throw new DomainError("INVALID_STALE_THRESHOLD", "staleAfterSeconds must be between 5 and 3600");
  }

  const tripResult = await pool.query<{ driver_user_id: string; status: string }>(
    `select driver_user_id,status from trips where id=$1`,
    [tripId]
  );
  const trip = tripResult.rows[0];
  if (!trip) throw new DomainError("TRIP_NOT_FOUND", "Trip not found", 404);
  if (trip.status !== "active") return null;

  const precise = await viewerCanSeePreciseLocation(pool, tripId, trip.driver_user_id, viewerUserId);
  const location = await pool.query<{
    latitude: number;
    longitude: number;
    recorded_at: Date;
    received_at: Date;
    accuracy_m: string | null;
    speed_mps: string | null;
    heading_degrees: string | null;
  }>(
    precise
      ? `select ST_Y(geom) as latitude,ST_X(geom) as longitude,
                recorded_at,received_at,accuracy_m,speed_mps,heading_degrees
           from trip_live_state where trip_id=$1`
      : `select ST_Y(ST_SnapToGrid(geom,0.01,0.01)) as latitude,
                ST_X(ST_SnapToGrid(geom,0.01,0.01)) as longitude,
                recorded_at,received_at,
                null::numeric as accuracy_m,null::numeric as speed_mps,null::numeric as heading_degrees
           from trip_live_state where trip_id=$1`,
    [tripId]
  );

  const row = location.rows[0];
  if (!row) return null;

  const ageSeconds = Math.max(0, Math.floor((Date.now() - row.recorded_at.getTime()) / 1000));
  const result: VisibleTripLocation = {
    tripId,
    precision: precise ? "precise" : "approximate",
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    recordedAt: row.recorded_at.toISOString(),
    receivedAt: row.received_at.toISOString(),
    stale: ageSeconds > staleAfterSeconds,
    ageSeconds
  };

  if (precise) {
    if (row.accuracy_m !== null) result.accuracyM = Number(row.accuracy_m);
    if (row.speed_mps !== null) result.speedMps = Number(row.speed_mps);
    if (row.heading_degrees !== null) result.headingDegrees = Number(row.heading_degrees);
  }

  return result;
}
