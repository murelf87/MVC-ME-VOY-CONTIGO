/**
 * Presupuesto («Ver desglose», «Revisa tu solicitud») del servidor simulado: `POST /v1/trips/:tripId/quote`.
 *
 * Porta `src/modules/trips/{quote-service,requests,endpoints}.ts`. REGLAS: NO crea nada (sin efectos); sin tarifa →
 * todo importe `pending_definition` («Por definir»); con la tarifa de EJEMPLO de la vista previa (`browseMeta.ts`) los
 * importes salen `illustrative` y la app los rotula «ilustrativo». Dinero siempre en céntimos enteros.
 *
 * SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`).
 */
import type { Money, RequestPoint, TripQuote, TripQuoteRequest, TripQuoteResponse, Weekday } from "@/api/types";
import { fail, isoReq, moneyIllustrative, moneyPending, type PreviewDb, type TripRow } from "@/preview";
import {
  canAlightAt,
  canBoardAt,
  declaredOption,
  decodePickupId,
  detourEstimateMinutes,
  freeSeatsInRange,
  loadTripGeometry,
  positionOnRoute,
  projectOnRoute,
  type PickupOption,
  type StopView,
  type TripGeometry,
} from "./browseGeometry";
import { metaFor, readPreviewTariff, type PreviewTariff, type TripMetaRow } from "./browseMeta";
import { bookability, loadVisibleTrip, localTimeOf, pointInProvince, viewerStanding, viewPoint } from "./browseShared";

// ---------------------------------------------------------------------------------------------------------------
// Importes
// ---------------------------------------------------------------------------------------------------------------

interface LegAmounts {
  contribution: number | null;
  fee: number | null;
  total: number | null;
}

/** `roundHalfUp(n, d)` del backend con enteros seguros (n ≤ 2·10¹¹: exacto en doble precisión). */
function roundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

/** Importes de UN trayecto; null en cada componente que la tarifa no define. */
export function legAmounts(tariff: PreviewTariff, roadDistanceM: number): LegAmounts {
  if (tariff.rateMicrosPerKm === null) return { contribution: null, fee: null, total: null };
  let contribution = roundHalfUp(Math.max(0, Math.round(roadDistanceM)) * tariff.rateMicrosPerKm, 10_000_000);
  if (tariff.sharedCostCapCents !== null) contribution = Math.min(contribution, tariff.sharedCostCapCents);
  const fee = tariff.passengerCommissionBps === null ? null : roundHalfUp(contribution * tariff.passengerCommissionBps, 10_000);
  return { contribution, fee, total: fee === null ? null : contribution + fee };
}

const asMoney = (cents: number | null): Money => (cents === null ? moneyPending() : moneyIllustrative(cents));

/** Presupuesto de un trayecto con la tarifa de ejemplo (o `null`: sin tarifa → «Por definir»). */
export function computeQuote(tariff: PreviewTariff | null, roadDistanceM: number): TripQuote {
  const base: TripQuote = {
    state: "pending_definition",
    tariff: tariff ? { state: "approved", version: tariff.version } : { state: "none_approved", version: null },
    basis: { roadDistanceM, rateMicrosPerKm: tariff?.rateMicrosPerKm ?? null },
    contribution: moneyPending(),
    managementFee: moneyPending(),
    total: moneyPending(),
    weekly: null,
    lockedAt: null,
  };
  if (!tariff) return base;
  const amounts = legAmounts(tariff, roadDistanceM);
  const allDefined = amounts.contribution !== null && amounts.fee !== null && amounts.total !== null;
  return {
    ...base,
    state: allDefined ? "defined" : "pending_definition",
    contribution: asMoney(amounts.contribution),
    managementFee: asMoney(amounts.fee),
    total: asMoney(amounts.total),
  };
}

/** Presupuesto semanal: suma de los trayectos de una semana (ida × días + vuelta × días). */
export function computeWeeklyQuote(
  tariff: PreviewTariff | null,
  distances: { outboundM: number; returnM: number | null },
  weekdays: readonly Weekday[]
): TripQuote {
  const quote = computeQuote(tariff, distances.outboundM);
  const legsPerDay: 1 | 2 = distances.returnM === null ? 1 : 2;
  let contributionPerWeek: Money = moneyPending();
  let totalPerWeek: Money = moneyPending();
  if (tariff) {
    const out = legAmounts(tariff, distances.outboundM);
    const back = distances.returnM === null ? null : legAmounts(tariff, distances.returnM);
    const days = weekdays.length;
    if (out.contribution !== null && (back === null || back.contribution !== null)) {
      contributionPerWeek = moneyIllustrative(days * (out.contribution + (back?.contribution ?? 0)));
    }
    if (out.total !== null && (back === null || back.total !== null)) {
      totalPerWeek = moneyIllustrative(days * (out.total + (back?.total ?? 0)));
    }
  }
  return { ...quote, weekly: { weekdays: [...weekdays], legsPerDay, tripsPerWeek: weekdays.length * legsPerDay, contributionPerWeek, totalPerWeek } };
}

// ---------------------------------------------------------------------------------------------------------------
// Resolución del tramo pedido
// ---------------------------------------------------------------------------------------------------------------

export interface ResolvedLeg {
  fromSegmentSeq: number;
  toSegmentSeq: number;
  pickup: PickupOption | null;
  dropoffStopSeq: number | null;
  roadDistanceM: number;
}

/** Valida el rango de bajada: entero, dentro del viaje, «bajable» y posterior a la subida. */
export function resolveDropoff(stops: readonly StopView[], dropoffStopSeq: number | undefined, pickup: PickupOption): StopView {
  const seq = dropoffStopSeq ?? stops.length - 1;
  const stop = Number.isInteger(seq) ? stops[seq] : undefined;
  if (!stop || !canAlightAt(stop)) return fail("DROPOFF_STOP_INVALID", "La parada de bajada no es válida para este viaje.", 422);
  if (stop.seq <= pickup.segmentSeq) return fail("DROPOFF_BEFORE_PICKUP", "La bajada debe ser posterior al punto de recogida.", 422);
  return stop;
}

/**
 * Descodifica y REVALIDA un `pickupPointId` en el servidor (nunca se confía en el cliente): pertenece al viaje, está dentro
 * de la provincia, sobre/cerca de la ruta y su desvío cabe en el máximo del conductor.
 */
export function resolvePickupPointId(db: PreviewDb, trip: Readonly<TripRow>, meta: TripMetaRow, geo: TripGeometry, pickupPointId: string): PickupOption {
  const decoded = decodePickupId(pickupPointId);
  if (!decoded || decoded.tripId !== trip.id) return fail("PICKUP_POINT_INVALID", "El punto de recogida no es válido para este viaje.", 422);
  const lastSeq = geo.stops.length - 1;
  const target = { lat: decoded.lat, lng: decoded.lng };

  if (decoded.stopSeq !== null) {
    const stop = geo.stops[decoded.stopSeq];
    if (!stop || !canBoardAt(stop, lastSeq)) return fail("PICKUP_POINT_INVALID", "El punto de recogida no es válido para este viaje.", 422);
    if (!pointInProvince(db, trip.province_id, { lat: stop.lat, lng: stop.lng })) {
      return fail("PICKUP_POINT_OUTSIDE_PROVINCE", "El punto de recogida está fuera de la provincia.", 422);
    }
    return { ...declaredOption(stop, geo, { lat: stop.lat, lng: stop.lng }), walkMinutes: decoded.walkMinutes };
  }

  if (!meta.pickupOnRoute) return fail("PICKUP_NOT_ON_ROUTE", "Este viaje solo recoge en las paradas indicadas por el conductor.", 422);
  if (!pointInProvince(db, trip.province_id, target)) {
    return fail("PICKUP_POINT_OUTSIDE_PROVINCE", "El punto de recogida está fuera de la provincia.", 422);
  }
  const projection = projectOnRoute(geo.route, target);
  if (!projection || projection.distanceM > 75) return fail("PICKUP_NOT_ON_ROUTE", "El punto de recogida no está sobre la ruta del viaje.", 422);
  const detour = detourEstimateMinutes(projection.distanceM);
  if (detour > meta.maxDetourMinutes) {
    return fail("PICKUP_DETOUR_TOO_LARGE", "El desvío necesario supera el máximo que acepta el conductor.", 422, {
      detourMinutes: detour,
      maxDetourMinutes: meta.maxDetourMinutes,
    });
  }
  const position = positionOnRoute(geo, projection.fraction);
  if (position.segmentSeq >= lastSeq) return fail("PICKUP_POINT_INVALID", "El punto de recogida no es válido para este viaje.", 422);
  return {
    source: "route_projection",
    location: projection.point,
    stopSeq: null,
    segmentSeq: position.segmentSeq,
    offsetS: position.offsetS,
    distanceFromStartM: position.distanceFromStartM,
    straightM: 0,
    walkMinutes: decoded.walkMinutes,
    detourMinutes: detour,
    detourSource: "estimate",
    label: null,
  };
}

/** Convierte el cuerpo del presupuesto en un tramo validado. Exactamente UNA forma: `pickupPointId` o el rango de tramos. */
export function resolveRequestLeg(
  db: PreviewDb,
  trip: Readonly<TripRow>,
  meta: TripMetaRow,
  geo: TripGeometry,
  body: Pick<TripQuoteRequest, "pickupPointId" | "dropoffStopSeq" | "fromSegmentSeq" | "toSegmentSeq">
): ResolvedLeg {
  const hasPoint = body.pickupPointId !== undefined;
  const hasRange = body.fromSegmentSeq !== undefined || body.toSegmentSeq !== undefined;
  if (hasPoint === hasRange) {
    return fail("INVALID_REQUEST_SHAPE", "Indica un punto de recogida (pickupPointId) o un rango de tramos, no ambos ni ninguno.", 422);
  }
  if (hasPoint && body.pickupPointId !== undefined) {
    const pickup = resolvePickupPointId(db, trip, meta, geo, body.pickupPointId);
    const dropoff = resolveDropoff(geo.stops, body.dropoffStopSeq, pickup);
    return {
      fromSegmentSeq: pickup.segmentSeq,
      toSegmentSeq: dropoff.seq,
      pickup,
      dropoffStopSeq: dropoff.seq,
      roadDistanceM: Math.max(0, (geo.distances[dropoff.seq] ?? 0) - pickup.distanceFromStartM),
    };
  }
  if (body.dropoffStopSeq !== undefined) {
    return fail("INVALID_REQUEST_SHAPE", "dropoffStopSeq solo puede usarse junto con pickupPointId.", 422);
  }
  const from = body.fromSegmentSeq;
  const to = body.toSegmentSeq;
  if (from === undefined || to === undefined || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from) {
    return fail("INVALID_SEGMENT_RANGE", "El rango de tramos no es válido.", 422);
  }
  if (!geo.segments.some((s) => s.seq === to - 1) || !geo.segments.some((s) => s.seq === from)) {
    return fail("INVALID_SEGMENT_RANGE", "El rango de tramos no existe en este viaje.", 422);
  }
  const fromStop = geo.stops[from];
  return {
    fromSegmentSeq: from,
    toSegmentSeq: to,
    pickup: fromStop ? declaredOption(fromStop, geo, { lat: fromStop.lat, lng: fromStop.lng }) : null,
    dropoffStopSeq: geo.stops[to] ? to : null,
    roadDistanceM: Math.max(0, (geo.distances[to] ?? 0) - (geo.distances[from] ?? 0)),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// POST /v1/trips/:tripId/quote
// ---------------------------------------------------------------------------------------------------------------

export function quoteTrip(db: PreviewDb, viewerUserId: string | null, tripId: string, body: TripQuoteRequest): TripQuoteResponse {
  const trip = loadVisibleTrip(db, tripId, viewerUserId);
  if (trip.status !== "published" && trip.status !== "active") {
    return fail("TRIP_NOT_BOOKABLE", "Este viaje ya no admite solicitudes.", 409);
  }
  const meta = metaFor(db, trip.id);
  const geo = loadTripGeometry(db, trip, meta);
  const standing = viewerStanding(db, trip, viewerUserId);
  const noShape =
    body.pickupPointId === undefined && body.fromSegmentSeq === undefined && body.toSegmentSeq === undefined && body.dropoffStopSeq === undefined;
  const leg = resolveRequestLeg(db, trip, meta, geo, noShape ? { fromSegmentSeq: 0, toSegmentSeq: Math.max(1, geo.stops.length - 1) } : body);

  const departure = trip.departure_at ?? db.nowMs();
  const pickupInfo = leg.pickup;
  const dropoffSeq = leg.dropoffStopSeq ?? leg.toSegmentSeq;
  const dropoffStop = geo.stops[dropoffSeq];
  const fromStop = geo.stops[leg.fromSegmentSeq];
  const boardsAt = departure + (pickupInfo?.offsetS ?? geo.offsets[leg.fromSegmentSeq] ?? 0) * 1000;
  const arrivesAt = departure + (geo.offsets[dropoffSeq] ?? 0) * 1000;

  // Un punto de recogida propuesto (A/B) es un punto de encuentro público: se enseña con precisión a quien lo pidió con sesión.
  const precise = body.pickupPointId !== undefined && viewerUserId !== null ? true : standing.precision === "precise";
  const pickup: RequestPoint = {
    label: pickupInfo?.label ?? fromStop?.label ?? null,
    address: null,
    location: viewPoint(pickupInfo ? pickupInfo.location : { lat: fromStop?.lat ?? 0, lng: fromStop?.lng ?? 0 }, precise),
    atLocal: localTimeOf(boardsAt),
    at: isoReq(boardsAt),
    walkMinutes: pickupInfo?.walkMinutes ?? null,
    detourMinutes: pickupInfo?.detourMinutes ?? null,
  };
  const dropoff: RequestPoint = {
    label: dropoffStop?.label ?? null,
    address: null,
    location: viewPoint({ lat: dropoffStop?.lat ?? 0, lng: dropoffStop?.lng ?? 0 }, precise),
    atLocal: localTimeOf(arrivesAt),
    at: isoReq(arrivesAt),
    walkMinutes: null,
    detourMinutes: null,
  };
  const free = freeSeatsInRange(geo.segments, leg.fromSegmentSeq, leg.toSegmentSeq);
  const can = bookability({ db, trip, userId: viewerUserId, standing, freeSeats: free });
  return {
    tripId,
    quote: computeQuote(readPreviewTariff(db), leg.roadDistanceM),
    pickup,
    dropoff,
    seatsAvailable: free,
    roadDistanceM: leg.roadDistanceM,
    canRequest: can.canRequest,
    cannotRequestReason: can.reason,
  };
}
