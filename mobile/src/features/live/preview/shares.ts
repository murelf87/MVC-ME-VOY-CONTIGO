/**
 * Compartir viaje, PRIVADO y revocable (contrato `live.md` §6): el pasajero crea un enlace con caducidad, lo envía a
 * quien quiera y lo puede revocar. El servidor solo guarda la huella del token. La vista pública
 * (`GET /v1/shared-trips/:token`) no necesita sesión y entrega lo mínimo: nombres de pila, vehículo (matrícula solo si
 * se pidió), recogida y destino, hora prevista y una posición APROXIMADA (cuadrícula de ~1 km); nunca teléfono ni
 * distancia restante. SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`).
 */
import type { LivePhase, LiveShare, LiveShareCreated, LiveSharedTrip, LiveShareStatus } from "@/api/types";
import { fail, iso, isoReq, publicUser, reply, sha256Hex, snapToGrid, uuidParam } from "@/preview";
import type { PreviewDb, PreviewRouter } from "@/preview";
import { geoPoint, liveSnapshot, loadBookingContext, pickupPoint, scheduledAtMs, vehicleOf } from "./engine";
import { liveShares, type LiveShareRow } from "./rows";

export const SHARE_MIN_MINUTES = 15;
export const SHARE_MAX_MINUTES = 1440;
export const SHARE_DEFAULT_MINUTES = 360;
export const SHARE_TOKEN_PREFIX = "mvc_share_";

const MIN_MS = 60_000;
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** base64url sin relleno (32 bytes → 43 caracteres). */
function base64UrlOf(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const chunk = (a << 16) | (b << 8) | c;
    out += BASE64URL.charAt((chunk >> 18) & 63) + BASE64URL.charAt((chunk >> 12) & 63);
    if (i + 1 < bytes.length) out += BASE64URL.charAt((chunk >> 6) & 63);
    if (i + 2 < bytes.length) out += BASE64URL.charAt(chunk & 63);
  }
  return out;
}

/** Token reproducible a partir de un texto (solo las semillas de la vista previa: el servidor real nunca lo hace). */
export function tokenFromSeed(key: string): string {
  const hex = sha256Hex(key);
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return `${SHARE_TOKEN_PREFIX}${base64UrlOf(bytes)}`;
}

export function shareStatusOf(row: Readonly<LiveShareRow>, nowMs: number): LiveShareStatus {
  if (row.revoked_at !== null) return "revoked";
  return row.expires_at <= nowMs ? "expired" : "active";
}

export function shareWire(row: Readonly<LiveShareRow>, nowMs: number): LiveShare {
  return {
    id: row.id,
    bookingId: row.booking_id,
    tripId: row.trip_id,
    includePlate: row.include_plate,
    status: shareStatusOf(row, nowMs),
    createdAt: isoReq(row.created_at),
    expiresAt: isoReq(row.expires_at),
    revokedAt: iso(row.revoked_at),
    lastViewedAt: iso(row.last_viewed_at),
    viewCount: row.view_count,
  };
}

interface ShareOptions {
  includePlate: boolean;
  expiresInMinutes: number;
}

/** El cuerpo entero es opcional (sin él: 6 h y sin matrícula). */
function parseShareBody(body: unknown): ShareOptions {
  if (body === undefined || body === null) return { includePlate: false, expiresInMinutes: SHARE_DEFAULT_MINUTES };
  if (typeof body !== "object" || Array.isArray(body)) fail("VALIDATION_ERROR", "La petición no es válida.", 400);
  const input = body as { includePlate?: unknown; expiresInMinutes?: unknown };
  if (input.includePlate !== undefined && typeof input.includePlate !== "boolean") {
    fail("VALIDATION_ERROR", "La petición no es válida.", 400, [{ path: "/includePlate", message: "must be boolean", keyword: "type" }]);
  }
  const minutes = input.expiresInMinutes ?? SHARE_DEFAULT_MINUTES;
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < SHARE_MIN_MINUTES || minutes > SHARE_MAX_MINUTES) {
    fail("SHARE_INVALID_DURATION", `La vigencia del enlace debe ir de ${SHARE_MIN_MINUTES} a ${SHARE_MAX_MINUTES} minutos.`, 400, {
      min: SHARE_MIN_MINUTES,
      max: SHARE_MAX_MINUTES,
    });
  }
  return { includePlate: input.includePlate === true, expiresInMinutes: minutes };
}

function activeSharesOf(db: PreviewDb, bookingId: string): Array<Readonly<LiveShareRow>> {
  const now = db.nowMs();
  return liveShares(db).filter((s) => s.booking_id === bookingId && s.revoked_at === null && s.expires_at > now);
}

const PHASES_WITHOUT_TRACKING: ReadonlySet<LivePhase> = new Set<LivePhase>(["completed", "cancelled"]);

export function registerShares(r: PreviewRouter, db: PreviewDb): void {
  r.post<{ Params: { bookingId: string }; Body: unknown }>(
    "/v1/bookings/:bookingId/share",
    { summary: "Crear un enlace privado y revocable para compartir el viaje", tags: ["live"], schema: { params: uuidParam("bookingId") } },
    (req) => {
      const me = req.auth();
      const ctx = loadBookingContext(db, req.params.bookingId, me.userId);
      if (ctx.booking.status !== "confirmed" || (ctx.trip.status !== "published" && ctx.trip.status !== "active")) {
        fail("SHARE_NOT_ALLOWED", "Solo se puede compartir una reserva confirmada de un viaje que no ha terminado.", 409);
      }
      const options = parseShareBody(req.body);
      const now = db.nowMs();
      const shares = liveShares(db);
      for (const previous of activeSharesOf(db, ctx.booking.id)) shares.update(previous.id, { revoked_at: now });

      const token = `${SHARE_TOKEN_PREFIX}${base64UrlOf(db.ids.bytes(32))}`;
      const row = shares.insert({
        id: db.ids.uuid(),
        booking_id: ctx.booking.id,
        trip_id: ctx.trip.id,
        owner_user_id: me.userId,
        token_hash: sha256Hex(token),
        include_plate: options.includePlate,
        created_at: now,
        expires_at: now + options.expiresInMinutes * MIN_MS,
        revoked_at: null,
        last_viewed_at: null,
        view_count: 0,
      });
      const created: LiveShareCreated = { ...shareWire(row, now), token, url: null };
      return reply.created(created);
    }
  );

  r.get<{ Params: { bookingId: string } }>(
    "/v1/bookings/:bookingId/share",
    { summary: "Enlace de este viaje que sigue activo (sin el token)", tags: ["live"], schema: { params: uuidParam("bookingId") } },
    (req) => {
      const me = req.auth();
      const ctx = loadBookingContext(db, req.params.bookingId, me.userId);
      const now = db.nowMs();
      const newest = activeSharesOf(db, ctx.booking.id).sort((a, b) => b.created_at - a.created_at)[0];
      return { share: newest ? shareWire(newest, now) : null };
    }
  );

  r.delete<{ Params: { bookingId: string } }>(
    "/v1/bookings/:bookingId/share",
    { summary: "Revocar el enlace activo (idempotente)", tags: ["live"], schema: { params: uuidParam("bookingId") } },
    (req) => {
      const me = req.auth();
      const ctx = loadBookingContext(db, req.params.bookingId, me.userId);
      const now = db.nowMs();
      for (const share of activeSharesOf(db, ctx.booking.id)) liveShares(db).update(share.id, { revoked_at: now });
      return reply.noContent();
    }
  );

  r.get<{ Params: { token: string } }>(
    "/v1/shared-trips/:token",
    {
      summary: "Vista pública de un viaje compartido (sin sesión)",
      tags: ["live"],
      schema: { params: { type: "object", required: ["token"], properties: { token: { type: "string", minLength: 1, maxLength: 200 } } } },
    },
    (req): LiveSharedTrip => {
      const share = liveShares(db).find((s) => s.token_hash === sha256Hex(req.params.token));
      if (!share) fail("SHARE_NOT_FOUND", "Este enlace no existe.", 404);
      if (share.revoked_at !== null) fail("SHARE_REVOKED", "Quien compartió el viaje ha retirado este enlace.", 410);
      const now = db.nowMs();
      if (share.expires_at <= now) fail("SHARE_EXPIRED", "Este enlace ha caducado.", 410);
      liveShares(db).update(share.id, { last_viewed_at: now, view_count: share.view_count + 1 });

      const ctx = loadBookingContext(db, share.booking_id, share.owner_user_id);
      const snap = liveSnapshot(db, ctx);
      const hidden = PHASES_WITHOUT_TRACKING.has(snap.phase);
      const vehicle = vehicleOf(db, ctx.trip);
      const pickup = pickupPoint(ctx);
      const dropoffStop = ctx.stops.find((s) => s.seq === ctx.dropoffSeq);
      const fix = snap.fix;
      return {
        phase: snap.phase,
        serverTime: isoReq(now),
        expiresAt: isoReq(share.expires_at),
        passengerFirstName: publicUser(db, share.owner_user_id).firstName,
        driverFirstName: publicUser(db, ctx.trip.driver_user_id).firstName,
        vehicle: { make: vehicle.make, model: vehicle.model, color: vehicle.color, plate: share.include_plate ? vehicle.plate : null },
        route: { originLabel: pickup.label, destinationLabel: dropoffStop?.label ?? null },
        plannedDepartureAt: iso(scheduledAtMs(snap.model, ctx.pickupSeq)),
        // La distancia restante por la ruta revelaría el punto exacto del coche: en la vista pública es SIEMPRE nula.
        eta: hidden || snap.etaDropoff === null ? null : { ...snap.etaDropoff, distanceM: null },
        signal: hidden ? "none" : snap.signal,
        position:
          hidden || fix === null
            ? null
            : {
                location: geoPoint(snapToGrid(fix.lat), snapToGrid(fix.lng)),
                recordedAt: isoReq(fix.recordedAtMs),
                ageSeconds: Math.max(0, Math.floor((now - fix.recordedAtMs) / 1000)),
                stale: snap.signal === "stale",
                precision: "approximate",
              },
      };
    }
  );
}
