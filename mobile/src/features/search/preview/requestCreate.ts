/**
 * Crear una solicitud de plaza con punto de recogida (`POST /v1/trips/:tripId/requests`, forma ampliada del módulo `trips`).
 *
 * Pasos (porta `src/modules/trips/requests.ts`): validar el viaje → resolver y REVALIDAR el `pickupPointId` en el servidor →
 * capacidad por tramo y solicitud abierta duplicada (las comprueba `createRideRequestForTrip`) → fijar el importe a la
 * solicitud (`quote_snapshots`) → devolver el detalle. Con la misma `Idempotency-Key` el router repite la respuesta original.
 *
 * SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`).
 */
import type { CreateRideRequestBody, RideRequestDetail } from "@/api/types";
import { createRideRequestForTrip, fail, type PreviewDb, type Principal, type RideRequestExtras } from "@/preview";
import { loadTripGeometry } from "./browseGeometry";
import { metaFor, readPreviewTariff } from "./browseMeta";
import { computeQuote, resolveRequestLeg, type ResolvedLeg } from "./browseQuote";
import { bookability, loadVisibleTrip, viewerStanding } from "./browseShared";
import { buildRequestDetail, quoteLocks } from "./requestDetail";

export function extrasFromLeg(leg: ResolvedLeg, message: string | null): Partial<RideRequestExtras> {
  const pickup = leg.pickup;
  return {
    pickup_lat: pickup?.location.lat ?? null,
    pickup_lng: pickup?.location.lng ?? null,
    pickup_label: pickup?.label ?? null,
    pickup_address: null,
    pickup_source: pickup?.source ?? null,
    pickup_offset_s: pickup?.offsetS ?? null,
    pickup_walk_minutes: pickup?.walkMinutes ?? null,
    pickup_detour_minutes: pickup?.detourMinutes ?? null,
    dropoff_stop_seq: leg.dropoffStopSeq,
    road_distance_m: leg.roadDistanceM,
    message,
  };
}

export function cleanMessage(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim();
  if (text.length > 300) return fail("INVALID_REQUEST_SHAPE", "El mensaje no puede superar los 300 caracteres.", 422);
  return text === "" ? null : text;
}

export function createRequestWithPickup(
  db: PreviewDb,
  principal: Principal,
  tripId: string,
  body: Record<string, unknown>,
  auditRequestId?: string
): RideRequestDetail {
  const input = body as CreateRideRequestBody;
  const trip = loadVisibleTrip(db, tripId, principal.userId);
  const meta = metaFor(db, trip.id);
  const geo = loadTripGeometry(db, trip, meta);
  const leg = resolveRequestLeg(db, trip, meta, geo, {
    ...(input.pickupPointId !== undefined ? { pickupPointId: input.pickupPointId } : {}),
    ...(input.dropoffStopSeq !== undefined ? { dropoffStopSeq: input.dropoffStopSeq } : {}),
    ...(input.fromSegmentSeq !== undefined ? { fromSegmentSeq: input.fromSegmentSeq } : {}),
    ...(input.toSegmentSeq !== undefined ? { toSegmentSeq: input.toSegmentSeq } : {}),
  });
  const message = cleanMessage(input.message);
  const standing = viewerStanding(db, trip, principal.userId);
  const can = bookability({ db, trip, userId: principal.userId, standing, freeSeats: Number.POSITIVE_INFINITY });
  if (!can.canRequest && can.reason === "TRIP_NOT_BOOKABLE") return fail("TRIP_NOT_BOOKABLE", "Este viaje ya no admite solicitudes.", 409);

  const { request } = createRideRequestForTrip(
    db,
    principal,
    { tripId: trip.id, fromSegmentSeq: leg.fromSegmentSeq, toSegmentSeq: leg.toSegmentSeq },
    extrasFromLeg(leg, message),
    auditRequestId
  );
  const lockedAt = db.nowMs();
  quoteLocks(db).put({ id: request.id, quote: computeQuote(readPreviewTariff(db), leg.roadDistanceM), locked_at: lockedAt });
  return buildRequestDetail(db, request, trip);
}
