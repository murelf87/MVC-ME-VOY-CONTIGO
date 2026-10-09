/**
 * Puntos de recogida propuestos (A, B…) para un origen: `GET /v1/trips/:tripId/pickup-points` (requiere sesión).
 * Porta `src/modules/trips/pickup-service.ts#proposePickupPoints` sobre la geometría del servidor simulado.
 *
 * Fuentes de candidatos: (1) paradas declaradas por el conductor desde las que se puede subir; (2) si el viaje es
 * «Recoger en ruta», la proyección del origen sobre la ruta. La distancia a pie es una ESTIMACIÓN (línea recta × 1,3):
 * no hay enrutado peatonal, y la respuesta lo declara (`walk.estimated: true`).
 *
 * SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`).
 */
import type { PickupPointsResponse, PickupProposal } from "@/api/types";
import { fail, isoReq, type PreviewDb } from "@/preview";
import {
  canAlightAt,
  canBoardAt,
  declaredOption,
  detourEstimateMinutes,
  distM,
  encodePickupId,
  loadTripGeometry,
  positionOnRoute,
  projectOnRoute,
  walkEstimate,
  type PickupOption,
} from "./browseGeometry";
import { metaFor } from "./browseMeta";
import { loadVisibleTrip, localTimeOf, viewPoint } from "./browseShared";

const DEFAULT_PROPOSALS = 2;
const MAX_PROPOSALS = 4;
/** Dos candidatos más cerca que esto entre sí son el mismo sitio para la persona. */
const DEDUPE_M = 60;
/** Más lejos que esto no se propone nada: nadie camina 12 km hasta un coche. */
const MAX_WALK_STRAIGHT_M = 12_000;

/** Dirección legible de una parada declarada («Av. Manuel Siurot»); solo la tienen los datos de las láminas. */
export interface StopAddressRow {
  /** `${tripId}:${seq}` */
  id: string;
  address: string;
}

export const stopAddresses = (db: PreviewDb) => db.collection<StopAddressRow>("trip_stop_addresses");

export const PICKUP_SAFETY_NOTICE = "Comprueba que el punto permite una parada segura y legal.";

export interface PickupQuery {
  lat: number;
  lng: number;
  dropoffStopSeq?: number;
  limit?: number;
}

function candidatesFor(db: PreviewDb, tripId: string, origin: { lat: number; lng: number }, dropoffSeq: number) {
  const trip = loadVisibleTrip(db, tripId, null);
  const meta = metaFor(db, trip.id);
  const geo = loadTripGeometry(db, trip, meta);
  const lastSeq = geo.stops.length - 1;
  const options: PickupOption[] = [];

  for (const stop of geo.stops) {
    if (!canBoardAt(stop, lastSeq) || stop.seq >= dropoffSeq) continue;
    // Las paradas opcionales solo se ofrecen si el conductor admite desvío suficiente.
    if (stop.optional && (stop.detourMinutes ?? 0) > meta.maxDetourMinutes) continue;
    options.push(declaredOption(stop, geo, origin));
  }

  if (meta.pickupOnRoute) {
    const projection = projectOnRoute(geo.route, origin);
    if (projection) {
      const position = positionOnRoute(geo, projection.fraction);
      const detour = detourEstimateMinutes(0);
      if (position.segmentSeq < dropoffSeq && detour <= meta.maxDetourMinutes) {
        const straightM = distM(origin, projection.point);
        options.push({
          source: "route_projection",
          location: projection.point,
          stopSeq: null,
          segmentSeq: position.segmentSeq,
          offsetS: position.offsetS,
          distanceFromStartM: position.distanceFromStartM,
          straightM,
          walkMinutes: walkEstimate(straightM).minutes,
          detourMinutes: detour,
          detourSource: "estimate",
          label: null,
        });
      }
    }
  }
  return { trip, geo, options };
}

export function proposePickupPoints(db: PreviewDb, userId: string, tripId: string, query: PickupQuery): PickupPointsResponse {
  const { lat, lng } = query;
  const limit = Math.min(MAX_PROPOSALS, Math.max(1, query.limit ?? DEFAULT_PROPOSALS));
  const trip = loadVisibleTrip(db, tripId, userId);
  if (trip.status !== "published" && trip.status !== "active") return fail("TRIP_NOT_BOOKABLE", "Este viaje ya no admite solicitudes.", 409);
  if (trip.driver_user_id === userId) return fail("DRIVER_CANNOT_REQUEST_OWN_TRIP", "No puedes solicitar plaza en tu propio viaje.", 409);

  const meta = metaFor(db, trip.id);
  const geoProbe = loadTripGeometry(db, trip, meta);
  const dropoffSeq = query.dropoffStopSeq ?? geoProbe.stops.length - 1;
  const dropoffStop = Number.isInteger(dropoffSeq) ? geoProbe.stops[dropoffSeq] : undefined;
  if (!dropoffStop || !canAlightAt(dropoffStop)) return fail("DROPOFF_STOP_INVALID", "La parada de bajada no es válida para este viaje.", 422);

  const origin = { lat, lng };
  const { geo, options } = candidatesFor(db, trip.id, origin, dropoffSeq);
  const ranked = options
    .filter((o) => o.straightM <= MAX_WALK_STRAIGHT_M)
    .sort((a, b) => a.straightM - b.straightM || a.offsetS - b.offsetS);

  const picked: PickupOption[] = [];
  for (const option of ranked) {
    if (picked.length >= limit) break;
    if (picked.some((p) => distM(p.location, option.location) < DEDUPE_M)) continue;
    picked.push(option);
  }
  if (picked.length === 0) {
    return fail("PICKUP_NOT_ON_ROUTE", "No hay ningún punto de recogida de este viaje cerca de ti.", 422, { maxWalkM: MAX_WALK_STRAIGHT_M });
  }

  const departure = trip.departure_at ?? db.nowMs();
  const proposals: PickupProposal[] = picked.map((option, index) => {
    const walk = walkEstimate(option.straightM);
    const boardsAt = departure + option.offsetS * 1000;
    return {
      id: encodePickupId(trip.id, option.location, option.stopSeq, walk.minutes),
      code: String.fromCharCode(65 + index),
      name: option.label,
      address: option.stopSeq === null ? null : (stopAddresses(db).get(`${trip.id}:${option.stopSeq}`)?.address ?? null),
      location: viewPoint(option.location, true),
      source: option.source,
      walk: { minutes: walk.minutes, distanceM: walk.distanceM, estimated: true },
      detour: { minutes: option.detourMinutes, source: option.detourSource === "stop" ? "stop" : "estimate" },
      fromSegmentSeq: option.segmentSeq,
      boardsAt: isoReq(boardsAt),
      boardsAtLocal: localTimeOf(boardsAt),
      distanceToDropoffM: Math.max(0, (geo.distances[dropoffSeq] ?? 0) - option.distanceFromStartM),
      recommended: index === 0,
    };
  });

  return {
    tripId: trip.id,
    origin: { lat, lng },
    dropoff: { stopSeq: dropoffStop.seq, label: dropoffStop.label, location: viewPoint({ lat: dropoffStop.lat, lng: dropoffStop.lng }, true) },
    proposals,
    safetyNotice: PICKUP_SAFETY_NOTICE,
  };
}
