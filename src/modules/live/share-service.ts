import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { AuthPrincipal } from "../../auth/session.js";
import { DomainError } from "../../errors.js";
import { writeAudit } from "../../lib/audit.js";
import { loadBookingById, loadPassengerBooking } from "./booking-context.js";
import { ageSecondsOf, approximateCoordinate, isoOrNull, loadPublicUser, point, tx, type Db } from "./common.js";
import { liveSettings } from "./config.js";
import { computeEta, plannedArrival, stopAt } from "./eta.js";
import { toLiveEta, trackPassenger } from "./tracking.js";
import type { LiveShare, LiveShareCreated, LiveShareStatus, LiveSharedTrip } from "./types.js";

export const SHARE_DEFAULT_MINUTES = 360;
export const SHARE_MIN_MINUTES = 15;
export const SHARE_MAX_MINUTES = 1440;
const TOKEN_PATTERN = /^mvc_share_[A-Za-z0-9_-]{32,64}$/;

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function newShareToken(): string {
  return `mvc_share_${randomBytes(32).toString("base64url")}`;
}

type ShareRow = {
  id: string;
  booking_id: string;
  trip_id: string;
  include_plate: boolean;
  expires_at: Date;
  revoked_at: Date | null;
  last_viewed_at: Date | null;
  view_count: number;
  created_at: Date;
};

const SHARE_COLUMNS = "id, booking_id, trip_id, include_plate, expires_at, revoked_at, last_viewed_at, view_count, created_at";

function shareStatus(row: ShareRow, now: Date): LiveShareStatus {
  if (row.revoked_at) return "revoked";
  return row.expires_at.getTime() <= now.getTime() ? "expired" : "active";
}

function toShare(row: ShareRow, now: Date): LiveShare {
  return {
    id: row.id,
    bookingId: row.booking_id,
    tripId: row.trip_id,
    includePlate: row.include_plate,
    status: shareStatus(row, now),
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    revokedAt: isoOrNull(row.revoked_at),
    lastViewedAt: isoOrNull(row.last_viewed_at),
    viewCount: row.view_count
  };
}

/** Estado del botón «Compartir viaje (privado)» en «En el coche». */
export async function activeShareState(
  db: Db, bookingId: string, now: Date
): Promise<{ active: boolean; expiresAt: string | null }> {
  const row = (await db.query<{ expires_at: Date }>(
    `select expires_at from trip_shares
      where booking_id=$1 and revoked_at is null and expires_at > $2
      order by created_at desc limit 1`,
    [bookingId, now]
  )).rows[0];
  return row ? { active: true, expiresAt: row.expires_at.toISOString() } : { active: false, expiresAt: null };
}

export async function createShare(
  pool: Pool,
  principal: AuthPrincipal,
  bookingId: string,
  input: { includePlate?: boolean | undefined; expiresInMinutes?: number | undefined },
  now: Date = new Date()
): Promise<LiveShareCreated> {
  const ctx = await loadPassengerBooking(pool, bookingId, principal.userId);
  const minutes = input.expiresInMinutes ?? SHARE_DEFAULT_MINUTES;
  if (!Number.isInteger(minutes) || minutes < SHARE_MIN_MINUTES || minutes > SHARE_MAX_MINUTES) {
    throw new DomainError(
      "SHARE_INVALID_DURATION", "The share duration must be between 15 minutes and 24 hours", 400,
      { min: SHARE_MIN_MINUTES, max: SHARE_MAX_MINUTES }
    );
  }
  if (ctx.bookingStatus !== "confirmed" || (ctx.tripStatus !== "published" && ctx.tripStatus !== "active")) {
    throw new DomainError("SHARE_NOT_ALLOWED", "Only a confirmed booking of a published or active trip can be shared", 409);
  }

  const token = newShareToken();
  const expiresAt = new Date(now.getTime() + minutes * 60_000);
  const row = await tx(pool, async client => {
    // Serializa las creaciones concurrentes sobre la misma reserva (un único enlace activo).
    await client.query(`select 1 from bookings where id=$1 for update`, [bookingId]);
    await client.query(`update trip_shares set revoked_at=$2 where booking_id=$1 and revoked_at is null`, [bookingId, now]);
    const inserted = await client.query<ShareRow>(
      `insert into trip_shares(booking_id, trip_id, created_by_user_id, token_hash, include_plate, expires_at, created_at)
       values($1,$2,$3,$4,$5,$6,$7)
       returning ${SHARE_COLUMNS}`,
      [bookingId, ctx.tripId, principal.userId, hashShareToken(token), input.includePlate === true, expiresAt, now]
    );
    const created = inserted.rows[0];
    if (!created) throw new Error("trip share insert returned no row");
    await writeAudit(client, {
      actorUserId: principal.userId, action: "trip_share.created", entityType: "trip_share", entityId: created.id,
      metadata: { bookingId, tripId: ctx.tripId, includePlate: created.include_plate, expiresInMinutes: minutes }
    });
    return created;
  });

  const base = liveSettings().publicShareBaseUrl;
  return { ...toShare(row, now), token, url: base ? `${base}/${token}` : null };
}

export async function getShare(
  pool: Pool, principal: AuthPrincipal, bookingId: string, now: Date = new Date()
): Promise<{ share: LiveShare | null }> {
  await loadPassengerBooking(pool, bookingId, principal.userId);
  const row = (await pool.query<ShareRow>(
    `select ${SHARE_COLUMNS} from trip_shares where booking_id=$1 order by created_at desc limit 1`, [bookingId]
  )).rows[0];
  return { share: row ? toShare(row, now) : null };
}

/** Revoca el enlace activo de la reserva. Idempotente: sin enlace activo también termina bien. */
export async function revokeShare(
  pool: Pool, principal: AuthPrincipal, bookingId: string, now: Date = new Date()
): Promise<void> {
  await loadPassengerBooking(pool, bookingId, principal.userId);
  const result = await pool.query<{ id: string }>(
    `update trip_shares set revoked_at=$2 where booking_id=$1 and revoked_at is null returning id`, [bookingId, now]
  );
  for (const row of result.rows) {
    await writeAudit(pool, {
      actorUserId: principal.userId, action: "trip_share.revoked", entityType: "trip_share", entityId: row.id,
      metadata: { bookingId }
    });
  }
}

/** Vista pública (sin sesión) del enlace. Errores: 404 SHARE_NOT_FOUND, 410 SHARE_REVOKED, 410 SHARE_EXPIRED. */
export async function getSharedTrip(pool: Pool, token: string, now: Date = new Date()): Promise<LiveSharedTrip> {
  if (!TOKEN_PATTERN.test(token)) throw new DomainError("SHARE_NOT_FOUND", "Shared trip not found", 404);
  const row = (await pool.query<ShareRow>(
    `select ${SHARE_COLUMNS} from trip_shares where token_hash=$1`, [hashShareToken(token)]
  )).rows[0];
  if (!row) throw new DomainError("SHARE_NOT_FOUND", "Shared trip not found", 404);
  if (row.revoked_at) throw new DomainError("SHARE_REVOKED", "This shared link was stopped by its owner", 410);
  if (row.expires_at.getTime() <= now.getTime()) throw new DomainError("SHARE_EXPIRED", "This shared link has expired", 410);

  const ctx = await loadBookingById(pool, row.booking_id);
  if (!ctx) throw new DomainError("SHARE_NOT_FOUND", "Shared trip not found", 404);

  await pool.query(`update trip_shares set last_viewed_at=$2, view_count=view_count+1 where id=$1`, [row.id, now]);

  const tracking = await trackPassenger(pool, ctx, now);
  const { model, settings } = tracking;
  const [passenger, driver] = await Promise.all([
    loadPublicUser(pool, ctx.passengerUserId),
    loadPublicUser(pool, ctx.driverUserId)
  ]);
  const pickup = stopAt(model, ctx.fromSeq);
  const dropoff = stopAt(model, ctx.toSeq);
  const plannedPickup = plannedArrival(model, ctx.fromSeq, settings.stopDwellSeconds, "schedule");

  // Quien mira el enlace quiere saber cuándo llegará la persona a su destino.
  const destinationCalc = ctx.bookingStatus === "confirmed"
    && (ctx.tripStatus === "active" || ctx.tripStatus === "published") && !tracking.journeyOver
    ? computeEta(model, ctx.toSeq, tracking.fix, now, settings)
    : null;

  const fix = tracking.fix;
  return {
    phase: tracking.phase,
    serverTime: now.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    passengerFirstName: passenger.firstName,
    driverFirstName: driver.firstName,
    vehicle: {
      make: ctx.vehicle.make, model: ctx.vehicle.model, color: ctx.vehicle.color,
      plate: row.include_plate ? ctx.vehicle.plate : null
    },
    route: { originLabel: pickup.label, destinationLabel: dropoff.label },
    plannedDepartureAt: plannedPickup ? plannedPickup.toISOString() : null,
    // Sin distancia restante: con la ruta, un valor en metros revelaría la posición exacta que el enlace no debe dar.
    eta: destinationCalc ? toLiveEta(destinationCalc, now, false) : null,
    signal: tracking.signal,
    position: fix
      ? {
          // Cuadrícula de ~1 km: el enlace compartido NUNCA da la posición exacta del coche.
          location: point(approximateCoordinate(fix.lat), approximateCoordinate(fix.lng)),
          recordedAt: fix.recordedAt.toISOString(),
          ageSeconds: ageSecondsOf(fix.recordedAt, now),
          stale: tracking.signal === "stale",
          precision: "approximate"
        }
      : null
  };
}
