/**
 * Cambio de ruta con consentimiento (pantalla 22 y consola del conductor) para la vista previa: el conductor propone una
 * parada nueva, el servidor recalcula el desvío, calcula el impacto de horario por pasajero y exige la aceptación de quien
 * tenga un cambio material. Es el equivalente en memoria de `src/modules/live/route-change-service.ts` (misma validación,
 * mismos códigos de error, mismos umbrales y mismas máquinas de estado) sobre el proveedor de rutas SIMULADO.
 *
 * Lo comparten el paquete `driver-ops` (crear, retirar y ver la propuesta pendiente desde la consola) y el paquete `live`
 * (ver y responder como pasajero): ambos usan estas funciones, nadie escribe las colecciones a mano.
 *
 * Colecciones (prefijo `live_`, igual que las tablas del módulo): `live_route_change_proposals`, `live_route_change_impacts`
 * y `live_route_change_acceptances`. Las fechas son milisegundos desde epoch.
 *
 * Honestidad económica: no existe tarifa aprobada, así que el impacto de precio es SIEMPRE «Por definir» y nunca exige
 * aceptación por sí mismo (`price-impact.ts` sin base de cálculo). Nunca hay recargo por molestias.
 *
 * Avisos: cada aviso del backend real (`notify`) se emite como evento `route_change.notice` con un `RouteChangeNotice`;
 * el paquete `driver-ops` los convierte en filas de `comms_notifications`. Quien llame a estas funciones no tiene que
 * hacer nada más.
 */
import type {
  GeoPoint,
  LiveDecision,
  LivePendingRouteChange,
  LiveRouteChange,
  LiveRouteChangeCounts,
  LiveRouteChangeImpact,
  LiveRouteChangeParticipantRow,
  LiveRouteChangeResolution,
  LiveRouteChangeStatus,
  LiveSignal,
  LiveStop,
} from "@/api/types";
import { requireAnyRole } from "../core/auth";
import type { PreviewDb } from "../core/db";
import { ApiFailure } from "../core/errors";
import { distanceM } from "../core/geo";
import { moneyPending } from "../core/money";
import type { Principal } from "../core/types";
import { iso, isoReq } from "../core/wire";
import { writeAudit } from "./audit";
import {
  LIVE_SETTINGS,
  computeEta,
  journeySums,
  loadLiveFix,
  loadRouteModel,
  progressOf,
  projectOnRoute,
  signalOf,
} from "./liveEta";
import { computeProvinceCompliantSegmentPlan, pointCoveredByProvince, requireProvince } from "./trips";
import { publicUser } from "./users";

// ── Filas ────────────────────────────────────────────────────────────────────────────────────────────────────────────

type LngLat = [number, number];

export interface RouteChangeLeg {
  distance_m: number;
  duration_s: number;
  geometry: LngLat[];
}

/** `route_change_proposals`. */
export interface RouteChangeProposalRow {
  id: string;
  trip_id: string;
  created_by_user_id: string;
  from_route_version: number;
  status: LiveRouteChangeStatus;
  resolution: LiveRouteChangeResolution | null;
  auto_applied: boolean;
  linked_request_id: string | null;
  after_stop_seq: number;
  new_stop_label: string | null;
  new_lat: number;
  new_lng: number;
  new_stop_seq: number | null;
  added_distance_m: number;
  added_duration_s: number;
  max_detour_m: number;
  planned_arrival_at: number | null;
  proposed_distance_m: number;
  proposed_duration_s: number;
  before_geometry: LngLat[];
  proposed_geometry: LngLat[];
  /** Tramo antiguo `stop k → stop k+1` sustituido por estos dos. */
  legs: [RouteChangeLeg, RouteChangeLeg];
  old_segment: { distance_m: number; duration_s: number; capacity: number };
  dwell_s: number;
  expires_at: number | null;
  resolved_at: number | null;
  created_at: number;
}

/** `route_change_impacts`: una fila por reserva afectada. */
export interface RouteChangeImpactRow {
  /** `${proposal_id}:${booking_id}` */
  id: string;
  proposal_id: string;
  booking_id: string;
  passenger_user_id: string;
  pickup_stop_seq: number;
  dropoff_stop_seq: number;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  pickup_before_at: number | null;
  pickup_after_at: number | null;
  dropoff_before_at: number | null;
  dropoff_after_at: number | null;
  schedule_delta_s: number;
  schedule_material: boolean;
  distance_before_m: number;
  distance_after_m: number;
  /** Sin tarifa aprobada: siempre `pending_definition` (los céntimos son `null`). */
  price_status: "defined" | "pending_definition";
  price_before_cents: number | null;
  price_after_cents: number | null;
  price_delta_cents: number | null;
  price_material: boolean;
  requires_acceptance: boolean;
}

/** `route_change_acceptances`. */
export interface RouteChangeAcceptanceRow {
  /** `${proposal_id}:${passenger_user_id}` */
  id: string;
  proposal_id: string;
  passenger_user_id: string;
  accepted: boolean;
  decided_at: number;
}

export const ROUTE_CHANGE_PROPOSALS = "live_route_change_proposals";
export const ROUTE_CHANGE_IMPACTS = "live_route_change_impacts";
export const ROUTE_CHANGE_ACCEPTANCES = "live_route_change_acceptances";

const declared = new WeakSet<PreviewDb>();

/** Las tres colecciones. La primera vez declara el índice parcial «una propuesta pendiente por viaje». */
export function routeChangeTables(db: PreviewDb) {
  if (!declared.has(db)) {
    declared.add(db);
    db.collection<RouteChangeProposalRow>(ROUTE_CHANGE_PROPOSALS).unique("one_pending_per_trip", (row) =>
      row.status === "pending" ? row.trip_id : null
    );
  }
  return {
    proposals: db.collection<RouteChangeProposalRow>(ROUTE_CHANGE_PROPOSALS),
    impacts: db.collection<RouteChangeImpactRow>(ROUTE_CHANGE_IMPACTS),
    acceptances: db.collection<RouteChangeAcceptanceRow>(ROUTE_CHANGE_ACCEPTANCES),
  };
}

// ── Avisos ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export const ROUTE_CHANGE_NOTICE_EVENT = "route_change.notice";

export type RouteChangeNoticeKind =
  | "route_change_proposed"
  | "route_change_applied"
  | "route_change_accepted"
  | "route_change_rejected"
  | "route_change_cancelled"
  | "route_change_expired";

/** Aviso al que corresponde un `notify()` del backend real (categoría `trip`, siempre esencial). */
export interface RouteChangeNotice {
  userId: string;
  kind: RouteChangeNoticeKind;
  title: string;
  body: string;
  data: { proposalId: string; tripId: string; bookingId?: string };
}

function emitNotice(db: PreviewDb, notice: RouteChangeNotice): void {
  db.events.emit(ROUTE_CHANGE_NOTICE_EVENT, notice);
}

/** «Tu llegada estimada cambia en +5 min.» (texto del servidor real, `arrivalChangeText`). */
export function arrivalChangeText(deltaSeconds: number, conditional = false): string {
  if (Math.abs(deltaSeconds) < 30) return conditional ? "Tu hora de llegada apenas cambiaría." : "Tu hora de llegada apenas cambia.";
  const minutes = Math.max(1, Math.round(Math.abs(deltaSeconds) / 60));
  return `Tu llegada estimada ${conditional ? "cambiaría" : "cambia"} en ${deltaSeconds > 0 ? "+" : "-"}${minutes} min.`;
}

// ── Geometría ────────────────────────────────────────────────────────────────────────────────────────────────────────

function cumulativeM(points: ReadonlyArray<readonly [number, number]>): { cum: number[]; total: number } {
  const cum = [0];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as readonly [number, number];
    const b = points[i] as readonly [number, number];
    total += distanceM(a[1], a[0], b[1], b[0]);
    cum.push(total);
  }
  return { cum, total };
}

function pointAtM(points: ReadonlyArray<readonly [number, number]>, cum: readonly number[], meters: number): LngLat {
  for (let i = 1; i < points.length; i += 1) {
    const from = cum[i - 1] as number;
    const to = cum[i] as number;
    if (meters <= to || i === points.length - 1) {
      const a = points[i - 1] as readonly [number, number];
      const b = points[i] as readonly [number, number];
      const span = to - from;
      const t = span > 0 ? Math.min(1, Math.max(0, (meters - from) / span)) : 0;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
  }
  const first = points[0] as readonly [number, number];
  return [first[0], first[1]];
}

function dedupe(points: readonly LngLat[]): LngLat[] {
  const out: LngLat[] = [];
  for (const point of points) {
    const previous = out[out.length - 1];
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) out.push([point[0], point[1]]);
  }
  return out;
}

/** `ST_LineSubstring`: el trozo de la polilínea entre dos fracciones (0..1) de su longitud. */
export function sliceByFraction(points: ReadonlyArray<readonly [number, number]>, from: number, to: number): LngLat[] {
  if (points.length < 2) return dedupe(points.map((p) => [p[0], p[1]] as LngLat));
  const { cum, total } = cumulativeM(points);
  const a = Math.min(1, Math.max(0, Math.min(from, to))) * total;
  const b = Math.min(1, Math.max(0, Math.max(from, to))) * total;
  const out: LngLat[] = [pointAtM(points, cum, a)];
  for (let i = 0; i < points.length; i += 1) {
    const at = cum[i] as number;
    if (at > a && at < b) {
      const p = points[i] as readonly [number, number];
      out.push([p[0], p[1]]);
    }
  }
  out.push(pointAtM(points, cum, b));
  return dedupe(out);
}

const toGeoPoints = (points: readonly LngLat[]): GeoPoint[] => points.map(([lng, lat]) => ({ lat, lng }));

// ── Caducidad, contadores y propuestas pendientes ────────────────────────────────────────────────────────────────────

function requiredPassengerIds(db: PreviewDb, proposalId: string): string[] {
  const { impacts } = routeChangeTables(db);
  const seen = new Map<string, string>();
  for (const impact of impacts.filter((i) => i.proposal_id === proposalId && i.requires_acceptance).sort((a, b) => a.booking_id.localeCompare(b.booking_id))) {
    if (!seen.has(impact.passenger_user_id)) seen.set(impact.passenger_user_id, impact.booking_id);
  }
  return [...seen.keys()];
}

/**
 * Avisa a TODOS los pasajeros que debían responder (también a quien ya había aceptado y esperaba al resto) de que la
 * propuesta no sigue adelante. `exceptUserId` excluye a quien acaba de actuar.
 */
function notifyRequiredPassengers(
  db: PreviewDb,
  proposal: Readonly<RouteChangeProposalRow>,
  kind: RouteChangeNoticeKind,
  title: string,
  body: string,
  exceptUserId?: string
): void {
  const { impacts } = routeChangeTables(db);
  const sent = new Set<string>();
  for (const impact of impacts.filter((i) => i.proposal_id === proposal.id && i.requires_acceptance).sort((a, b) => a.booking_id.localeCompare(b.booking_id))) {
    if (impact.passenger_user_id === exceptUserId || sent.has(impact.passenger_user_id)) continue;
    sent.add(impact.passenger_user_id);
    emitNotice(db, {
      userId: impact.passenger_user_id,
      kind,
      title,
      body,
      data: { proposalId: proposal.id, tripId: proposal.trip_id, bookingId: impact.booking_id },
    });
  }
}

/**
 * Marca como `expired` las propuestas pendientes cuyo plazo venció (nunca se aplican) y avisa al conductor y a los
 * pasajeros que debían responder. Se llama de forma perezosa (al leer) y desde la tarea periódica del paquete.
 */
export function expireDueRouteChanges(db: PreviewDb, filter: { tripId?: string; proposalId?: string } = {}): number {
  const { proposals } = routeChangeTables(db);
  const now = db.nowMs();
  const due = proposals.filter(
    (p) =>
      p.status === "pending" &&
      p.expires_at !== null &&
      p.expires_at <= now &&
      (filter.tripId === undefined || p.trip_id === filter.tripId) &&
      (filter.proposalId === undefined || p.id === filter.proposalId)
  );
  if (due.length === 0) return 0;
  db.tx(() => {
    for (const row of due) {
      const expired = proposals.update(row.id, { status: "expired", resolution: "expired", resolved_at: now });
      emitNotice(db, {
        userId: expired.created_by_user_id,
        kind: "route_change_expired",
        title: "La propuesta de cambio de ruta ha caducado",
        body: "Ningún pasajero respondió a tiempo, así que la ruta sigue igual.",
        data: { proposalId: expired.id, tripId: expired.trip_id },
      });
      notifyRequiredPassengers(
        db,
        expired,
        "route_change_expired",
        "La propuesta de cambio de ruta ha caducado",
        "Tu viaje sigue igual: no se ha aplicado ningún cambio."
      );
    }
  });
  return due.length;
}

export function routeChangeCounts(db: PreviewDb, proposalId: string): LiveRouteChangeCounts {
  const { acceptances } = routeChangeTables(db);
  const required = new Set(requiredPassengerIds(db, proposalId));
  let accepted = 0;
  let rejected = 0;
  for (const row of acceptances.filter((a) => a.proposal_id === proposalId && required.has(a.passenger_user_id))) {
    if (row.accepted) accepted += 1;
    else rejected += 1;
  }
  return { required: required.size, accepted, rejected, pending: Math.max(0, required.size - accepted - rejected) };
}

/** La propuesta pendiente del viaje (a lo sumo una), o `undefined`. */
export function pendingProposalOf(db: PreviewDb, tripId: string): Readonly<RouteChangeProposalRow> | undefined {
  return routeChangeTables(db).proposals.find((p) => p.trip_id === tripId && p.status === "pending");
}

/** Resumen de la propuesta pendiente para la consola del conductor (`LiveConsole.pendingRouteChange`). */
export function pendingRouteChangeForDriver(
  db: PreviewDb,
  tripId: string
): { id: string; createdAt: string; expiresAt: string | null; counts: LiveRouteChangeCounts } | null {
  const row = pendingProposalOf(db, tripId);
  if (!row) return null;
  return { id: row.id, createdAt: isoReq(row.created_at), expiresAt: iso(row.expires_at), counts: routeChangeCounts(db, row.id) };
}

/** Propuesta pendiente que requiere MI decisión (`pendingRouteChange` de /live e /in-car). */
export function pendingRouteChangeForPassenger(db: PreviewDb, tripId: string, userId: string): LivePendingRouteChange | null {
  const { acceptances, impacts } = routeChangeTables(db);
  const row = pendingProposalOf(db, tripId);
  if (!row) return null;
  const mine = impacts.find((i) => i.proposal_id === row.id && i.passenger_user_id === userId && i.requires_acceptance);
  if (!mine) return null;
  const decided = acceptances.has(`${row.id}:${userId}`);
  return { proposalId: row.id, expiresAt: iso(row.expires_at), awaitingMyDecision: !decided };
}

// ── Capacidad ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** ¿Cabe 1 pasajero más en todos los tramos antiguos [fromOld, toOld)? (`assertCapacityForNewPassenger`). */
function assertCapacityForNewPassenger(db: PreviewDb, tripId: string, fromOld: number, toOld: number, excludeRequestId: string | null): void {
  const nowMs = db.nowMs();
  for (const segment of db.tripSegments.filter((s) => s.trip_id === tripId && s.seq >= fromOld && s.seq < toOld).sort((a, b) => a.seq - b.seq)) {
    let occupied = 0;
    for (const hold of db.seatHolds.all()) {
      if (hold.status !== "active" || hold.expires_at <= nowMs) continue;
      const request = db.rideRequests.get(hold.request_id);
      if (!request || request.trip_id !== tripId || request.id === excludeRequestId) continue;
      if (request.from_segment_seq <= segment.seq && request.to_segment_seq > segment.seq) occupied += 1;
    }
    for (const booking of db.bookings.all()) {
      if (booking.status !== "confirmed" && booking.status !== "completed") continue;
      const request = db.rideRequests.get(booking.request_id);
      if (!request || request.trip_id !== tripId || request.id === excludeRequestId) continue;
      if (request.from_segment_seq <= segment.seq && request.to_segment_seq > segment.seq) occupied += 1;
    }
    if (occupied + 1 > segment.capacity) {
      throw new ApiFailure("NO_CAPACITY_ON_SEGMENT", "No seat capacity on at least one affected segment", 409, { segmentSeq: segment.seq });
    }
  }
}

// ── Crear la propuesta ───────────────────────────────────────────────────────────────────────────────────────────────

export interface CreateRouteChangeInput {
  tripId: string;
  stop: { lat: number; lng: number; label?: string | undefined };
  afterStopSeq?: number | undefined;
  requestId?: string | undefined;
}

interface AffectedBooking {
  bookingId: string;
  requestId: string;
  passengerUserId: string;
  f: number;
  t: number;
  pickedUp: boolean;
}

function validLeg(distanceMeters: number, durationSeconds: number): void {
  if (!(distanceMeters >= 1) || !(durationSeconds >= 1)) {
    throw new ApiFailure("ROUTE_CHANGE_STOP_TOO_CLOSE", "The new stop is too close to an existing stop to form a route leg", 422);
  }
}

/**
 * `POST /v1/trips/{tripId}/route-changes`. Solo el conductor propietario, con el viaje publicado o en curso. Sin cambios
 * materiales para ningún pasajero la parada se aplica al instante; si no, queda pendiente `routeChangeTtlSeconds` (5 min).
 */
export function createRouteChange(db: PreviewDb, principal: Principal, input: CreateRouteChangeInput): LiveRouteChange {
  requireAnyRole(principal, ["driver"]);
  const { lat, lng } = input.stop;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new ApiFailure("INVALID_ROUTE_CHANGE_STOP", "The new stop coordinates are invalid", 400);
  }
  expireDueRouteChanges(db, { tripId: input.tripId });

  const settings = LIVE_SETTINGS;
  const nowMs = db.nowMs();
  const model = loadRouteModel(db, input.tripId);
  if (model.driverUserId !== principal.userId) {
    throw new ApiFailure("TRIP_NOT_OWNED", "Only the trip driver may propose a route change", 403);
  }
  if (model.status !== "published" && model.status !== "active") {
    throw new ApiFailure("ROUTE_CHANGE_TRIP_NOT_CHANGEABLE", "Only a published or active trip can change its route", 409);
  }
  if (model.stops.length < 2 || model.segments.length < 1) {
    throw new ApiFailure("TRIP_ROUTE_DATA_MISSING", "The trip has no stops or segments to change", 409);
  }
  if (pendingProposalOf(db, input.tripId)) {
    throw new ApiFailure("ROUTE_CHANGE_ALREADY_PENDING", "This trip already has a pending route change", 409);
  }

  const trip = db.trips.get(input.tripId);
  if (!trip) throw new ApiFailure("TRIP_NOT_FOUND", "Trip not found", 404);
  const fix = model.status === "active" ? loadLiveFix(db, input.tripId) : null;
  const progress = progressOf(model, fix);
  if (model.status === "active" && !progress) {
    throw new ApiFailure("DRIVER_POSITION_UNAVAILABLE", "A route change during an active trip needs a known driver position", 409);
  }

  const fractions = model.stops.map((s) => s.frac);
  const projection = projectOnRoute(trip.route_geometry, lat, lng);
  const province = requireProvince(db, model.provinceId);
  if (!pointCoveredByProvince(province, { latitude: lat, longitude: lng })) {
    throw new ApiFailure("ROUTE_CHANGE_STOP_OUTSIDE_PROVINCE", "The new stop must be inside the province of the trip", 422);
  }

  const segmentCount = model.segments.length;
  let k: number;
  if (input.afterStopSeq !== undefined) {
    k = input.afterStopSeq;
    if (!Number.isInteger(k) || k < 0 || k > segmentCount - 1) {
      throw new ApiFailure("ROUTE_CHANGE_INVALID_STOP_INDEX", "afterStopSeq must reference a stop that has a following stop", 422, { segmentCount });
    }
  } else {
    k = 0;
    const frac = projection?.fraction ?? 0;
    for (let j = 0; j < segmentCount; j += 1) {
      if ((fractions[j] as number) <= frac) k = j;
      else break;
    }
  }
  if (progress && fix && fix.frac !== null) {
    const stopFrac = projection?.fraction ?? 0;
    if (k < progress.c || (k === progress.c && stopFrac < fix.frac - 1e-6)) {
      throw new ApiFailure("ROUTE_CHANGE_STOP_BEHIND_VEHICLE", "The new stop is behind the vehicle on the route", 422);
    }
  }

  const stopK = model.stops.find((s) => s.seq === k);
  const stopK1 = model.stops.find((s) => s.seq === k + 1);
  const oldSegment = model.segments.find((s) => s.seq === k);
  if (!stopK || !stopK1 || !oldSegment) {
    throw new ApiFailure("TRIP_ROUTE_DATA_MISSING", "The trip is missing stops or segments around the insertion point", 409);
  }

  // Recalculo con el proveedor de rutas simulado, dentro de la provincia.
  const newPoint = { latitude: lat, longitude: lng };
  const leg1 = computeProvinceCompliantSegmentPlan(db, {
    provinceId: model.provinceId,
    origin: { latitude: stopK.lat, longitude: stopK.lng },
    destination: newPoint,
  }).route;
  const leg2 = computeProvinceCompliantSegmentPlan(db, {
    provinceId: model.provinceId,
    origin: newPoint,
    destination: { latitude: stopK1.lat, longitude: stopK1.lng },
  }).route;
  validLeg(leg1.distanceMeters, leg1.durationSeconds);
  validLeg(leg2.distanceMeters, leg2.durationSeconds);

  const addedDistanceM = leg1.distanceMeters + leg2.distanceMeters - oldSegment.distanceM;
  const addedDurationS = leg1.durationSeconds + leg2.durationSeconds - oldSegment.durationS + settings.stopDwellSeconds;
  if (addedDistanceM > model.maxDetourM) {
    throw new ApiFailure("ROUTE_CHANGE_DETOUR_TOO_LARGE", "The detour exceeds the maximum allowed for this trip", 422, {
      addedDistanceM,
      maxDetourM: model.maxDetourM,
    });
  }

  // Solicitud enlazada: la persona que subirá en la nueva parada.
  let linkedToOld: number | null = null;
  if (input.requestId) {
    const request = db.rideRequests.get(input.requestId);
    if (!request || request.trip_id !== input.tripId) {
      throw new ApiFailure("ROUTE_CHANGE_REQUEST_INVALID", "The linked ride request does not belong to this trip", 422);
    }
    if (!["pending", "accepted", "payment_pending"].includes(request.status)) {
      throw new ApiFailure("ROUTE_CHANGE_REQUEST_INVALID", "The linked ride request is not awaiting a decision", 422);
    }
    if (request.passenger_user_id === principal.userId) {
      throw new ApiFailure("ROUTE_CHANGE_REQUEST_INVALID", "The driver cannot be the new passenger", 422);
    }
    if (request.to_segment_seq < k + 1) {
      throw new ApiFailure("ROUTE_CHANGE_REQUEST_INVALID", "The linked ride request drops off before the new stop", 422);
    }
    linkedToOld = request.to_segment_seq;
  }

  // Impacto por reserva afectada (horario; el precio queda «Por definir»).
  const affected: AffectedBooking[] = [];
  for (const booking of db.bookings.all()) {
    if (booking.status !== "confirmed") continue;
    const request = db.rideRequests.get(booking.request_id);
    if (!request || request.trip_id !== input.tripId || request.to_segment_seq < k + 1) continue;
    affected.push({
      bookingId: booking.id,
      requestId: request.id,
      passengerUserId: request.passenger_user_id,
      f: request.from_segment_seq,
      t: request.to_segment_seq,
      pickedUp: booking.picked_up_at !== null,
    });
  }
  affected.sort((a, b) => a.f - b.f || a.bookingId.localeCompare(b.bookingId));

  const threshold = Math.max(settings.materialScheduleDeltaS, model.flexibilityMinutes * 60);
  const impacts: Array<Omit<RouteChangeImpactRow, "id" | "proposal_id">> = [];
  for (const b of affected) {
    const pickupBefore = b.pickedUp ? null : (computeEta(model, b.f, fix, nowMs)?.atMs ?? null);
    const dropoffBefore = computeEta(model, b.t, fix, nowMs)?.atMs ?? null;
    const pickupShiftS = !b.pickedUp && b.f >= k + 1 ? addedDurationS : 0;
    const spansDetour = b.f <= k && k < b.t;
    const distanceBefore = journeySums(model, b.f, b.t).distanceM;
    const distanceAfter = distanceBefore + (spansDetour ? addedDistanceM : 0);
    const scheduleMaterial = addedDurationS >= threshold;
    const pickupStop = model.stops.find((s) => s.seq === b.f);
    const dropoffStop = model.stops.find((s) => s.seq === b.t);
    if (!pickupStop || !dropoffStop) {
      throw new ApiFailure("TRIP_ROUTE_DATA_MISSING", "The trip is missing a stop required by this booking", 409, { seq: pickupStop ? b.t : b.f });
    }
    impacts.push({
      booking_id: b.bookingId,
      passenger_user_id: b.passengerUserId,
      pickup_stop_seq: b.f,
      dropoff_stop_seq: b.t,
      pickup_lat: pickupStop.lat,
      pickup_lng: pickupStop.lng,
      dropoff_lat: dropoffStop.lat,
      dropoff_lng: dropoffStop.lng,
      pickup_before_at: pickupBefore,
      pickup_after_at: pickupBefore !== null ? pickupBefore + pickupShiftS * 1000 : null,
      dropoff_before_at: dropoffBefore,
      dropoff_after_at: dropoffBefore !== null ? dropoffBefore + addedDurationS * 1000 : null,
      schedule_delta_s: Math.round(addedDurationS),
      schedule_material: scheduleMaterial,
      distance_before_m: Math.round(distanceBefore),
      distance_after_m: Math.round(distanceAfter),
      price_status: "pending_definition",
      price_before_cents: null,
      price_after_cents: null,
      price_delta_cents: null,
      price_material: false,
      requires_acceptance: scheduleMaterial,
    });
  }

  const nextStopEtaBefore = computeEta(model, k + 1, fix, nowMs)?.atMs ?? null;
  const plannedArrivalAt = nextStopEtaBefore !== null ? nextStopEtaBefore + (leg1.durationSeconds - oldSegment.durationS) * 1000 : null;
  const requiredCount = new Set(impacts.filter((i) => i.requires_acceptance).map((i) => i.passenger_user_id)).size;

  const proposedGeometry = dedupe([
    ...sliceByFraction(trip.route_geometry, 0, fractions[k] as number),
    ...leg1.geometry.coordinates,
    ...leg2.geometry.coordinates,
    ...sliceByFraction(trip.route_geometry, fractions[k + 1] as number, 1),
  ]);

  const proposalId = db.tx(() => {
    const { proposals, impacts: impactTable } = routeChangeTables(db);
    const current = db.trips.get(input.tripId);
    if (!current || (current.status !== "published" && current.status !== "active")) {
      throw new ApiFailure("ROUTE_CHANGE_TRIP_NOT_CHANGEABLE", "Only a published or active trip can change its route", 409);
    }
    if (current.route_version !== model.routeVersion) {
      throw new ApiFailure("ROUTE_CHANGE_ROUTE_STALE", "The route changed while the proposal was being computed; retry", 409);
    }
    if (input.requestId && linkedToOld !== null) {
      const linked = db.rideRequests.get(input.requestId);
      if (!linked || !["pending", "accepted", "payment_pending"].includes(linked.status)) {
        throw new ApiFailure("ROUTE_CHANGE_REQUEST_INVALID", "The linked ride request is not awaiting a decision", 422);
      }
      assertCapacityForNewPassenger(db, input.tripId, k, linkedToOld, input.requestId);
    }

    const id = db.ids.uuid();
    const label = input.stop.label?.trim() || null;
    proposals.insert({
      id,
      trip_id: input.tripId,
      created_by_user_id: principal.userId,
      from_route_version: model.routeVersion,
      status: "pending",
      resolution: null,
      auto_applied: false,
      linked_request_id: input.requestId ?? null,
      after_stop_seq: k,
      new_stop_label: label,
      new_lat: lat,
      new_lng: lng,
      new_stop_seq: null,
      added_distance_m: Math.round(addedDistanceM),
      added_duration_s: Math.round(addedDurationS),
      max_detour_m: model.maxDetourM,
      planned_arrival_at: plannedArrivalAt,
      proposed_distance_m: Math.max(1, (model.routeDistanceM ?? 0) + Math.round(addedDistanceM)),
      proposed_duration_s: Math.max(1, (model.routeDurationS ?? 0) + leg1.durationSeconds + leg2.durationSeconds - oldSegment.durationS),
      before_geometry: trip.route_geometry.map(([x, y]) => [x, y] as LngLat),
      proposed_geometry: proposedGeometry,
      legs: [
        { distance_m: leg1.distanceMeters, duration_s: leg1.durationSeconds, geometry: leg1.geometry.coordinates.map(([x, y]) => [x, y] as LngLat) },
        { distance_m: leg2.distanceMeters, duration_s: leg2.durationSeconds, geometry: leg2.geometry.coordinates.map(([x, y]) => [x, y] as LngLat) },
      ],
      old_segment: { distance_m: oldSegment.distanceM, duration_s: oldSegment.durationS, capacity: oldSegment.capacity },
      dwell_s: settings.stopDwellSeconds,
      expires_at: requiredCount > 0 ? nowMs + settings.routeChangeTtlSeconds * 1000 : null,
      resolved_at: null,
      created_at: nowMs,
    });
    for (const impact of impacts) impactTable.insert({ ...impact, id: `${id}:${impact.booking_id}`, proposal_id: id });

    writeAudit(db, {
      actorUserId: principal.userId,
      action: "route_change.proposed",
      entityType: "route_change_proposal",
      entityId: id,
      metadata: {
        tripId: input.tripId,
        afterStopSeq: k,
        addedDistanceM,
        addedDurationS,
        affected: impacts.length,
        required: requiredCount,
        linkedRequestId: input.requestId ?? null,
      },
    });

    if (requiredCount === 0) {
      applyProposal(db, id, "auto_applied", null);
    } else {
      const driverName = publicUser(db, principal.userId).firstName;
      const notified = new Set<string>();
      for (const impact of impacts.filter((i) => i.requires_acceptance)) {
        if (notified.has(impact.passenger_user_id)) continue;
        notified.add(impact.passenger_user_id);
        emitNotice(db, {
          userId: impact.passenger_user_id,
          kind: "route_change_proposed",
          title: `${driverName} propone una nueva parada`,
          body: `${arrivalChangeText(impact.schedule_delta_s, true)} Se aplicará solo si lo aceptas.`,
          data: { proposalId: id, tripId: input.tripId, bookingId: impact.booking_id },
        });
      }
    }
    return id;
  });

  return getRouteChangeView(db, principal.userId, proposalId);
}

// ── Aplicar ──────────────────────────────────────────────────────────────────────────────────────────────────────────

type ApplyOutcome = { applied: true } | { applied: false; reason: "superseded" | "capacity_lost" };

/**
 * Aplica una propuesta (dentro de la transacción del llamante): inserta la parada, parte el tramo en dos con la capacidad
 * heredada, desplaza los `seq` posteriores y los rangos de solicitudes, actualiza la geometría, la distancia y la duración y
 * sube `route_version`. Si el viaje o las reservas cambiaron desde que se calculó, la cancela como `superseded`.
 */
function applyProposal(
  db: PreviewDb,
  proposalId: string,
  resolution: "auto_applied" | "all_accepted",
  actorUserId: string | null
): ApplyOutcome {
  const { proposals, impacts } = routeChangeTables(db);
  const proposal = proposals.get(proposalId);
  if (!proposal || proposal.status !== "pending") {
    throw new ApiFailure("ROUTE_CHANGE_NOT_PENDING", "The route change is not pending", 409);
  }
  const trip = db.trips.get(proposal.trip_id);
  const k = proposal.after_stop_seq;
  const now = db.nowMs();

  const cancel = (reason: "superseded" | "capacity_lost"): ApplyOutcome => {
    proposals.update(proposalId, { status: "cancelled", resolution: reason, resolved_at: now });
    return { applied: false, reason };
  };

  if (!trip || (trip.status !== "published" && trip.status !== "active") || trip.route_version !== proposal.from_route_version) {
    return cancel("superseded");
  }

  // El conjunto de pasajeros afectados no debe haber cambiado desde que se calculó el impacto.
  const currentAffected: string[] = [];
  for (const booking of db.bookings.all()) {
    if (booking.status !== "confirmed") continue;
    const request = db.rideRequests.get(booking.request_id);
    if (request && request.trip_id === proposal.trip_id && request.to_segment_seq >= k + 1) currentAffected.push(booking.id);
  }
  currentAffected.sort();
  const recorded = impacts
    .filter((i) => i.proposal_id === proposalId)
    .map((i) => i.booking_id)
    .sort();
  if (currentAffected.length !== recorded.length || currentAffected.some((id, index) => id !== recorded[index])) {
    return cancel("superseded");
  }

  if (proposal.linked_request_id) {
    const linked = db.rideRequests.get(proposal.linked_request_id);
    if (!linked || !["pending", "accepted", "payment_pending"].includes(linked.status)) return cancel("superseded");
    try {
      assertCapacityForNewPassenger(db, proposal.trip_id, k, linked.to_segment_seq, linked.id);
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "NO_CAPACITY_ON_SEGMENT") return cancel("capacity_lost");
      throw error;
    }
  }

  const [leg1, leg2] = proposal.legs;

  // Paradas: abrir hueco en k+1 (de mayor a menor para no chocar con la clave única) e insertar la nueva.
  const tripId = proposal.trip_id;
  for (const stop of db.tripStops.filter((s) => s.trip_id === tripId && s.seq > k).sort((a, b) => b.seq - a.seq)) {
    db.tripStops.delete(stop.id);
    db.tripStops.insert({ ...stop, id: `${tripId}:${stop.seq + 1}`, seq: stop.seq + 1 });
  }
  db.tripStops.insert({
    id: `${tripId}:${k + 1}`,
    trip_id: tripId,
    seq: k + 1,
    kind: "stop",
    lat: proposal.new_lat,
    lng: proposal.new_lng,
    label: proposal.new_stop_label,
  });

  // Tramos: sustituir el tramo k por dos (la capacidad se hereda) y desplazar los posteriores.
  db.tripSegments.delete(`${tripId}:${k}`);
  for (const segment of db.tripSegments.filter((s) => s.trip_id === tripId && s.seq > k).sort((a, b) => b.seq - a.seq)) {
    db.tripSegments.delete(segment.id);
    db.tripSegments.insert({
      ...segment,
      id: `${tripId}:${segment.seq + 1}`,
      seq: segment.seq + 1,
      from_stop_seq: segment.from_stop_seq + 1,
      to_stop_seq: segment.to_stop_seq + 1,
    });
  }
  db.tripSegments.insert({
    id: `${tripId}:${k}`,
    trip_id: tripId,
    seq: k,
    from_stop_seq: k,
    to_stop_seq: k + 1,
    distance_m: leg1.distance_m,
    duration_s: leg1.duration_s,
    capacity: proposal.old_segment.capacity,
  });
  db.tripSegments.insert({
    id: `${tripId}:${k + 1}`,
    trip_id: tripId,
    seq: k + 1,
    from_stop_seq: k + 1,
    to_stop_seq: k + 2,
    distance_m: leg2.distance_m,
    duration_s: leg2.duration_s,
    capacity: proposal.old_segment.capacity,
  });

  // Solicitudes: la numeración de paradas posteriores a k sube una posición (de mayor a menor).
  for (const request of db.rideRequests.filter((r) => r.trip_id === tripId).sort((a, b) => b.from_segment_seq - a.from_segment_seq || b.to_segment_seq - a.to_segment_seq)) {
    const nf = request.from_segment_seq > k ? request.from_segment_seq + 1 : request.from_segment_seq;
    const nt = request.to_segment_seq > k ? request.to_segment_seq + 1 : request.to_segment_seq;
    const dropoff = request.dropoff_stop_seq;
    const nd = dropoff !== undefined && dropoff !== null && dropoff > k ? dropoff + 1 : dropoff;
    if (nf !== request.from_segment_seq || nt !== request.to_segment_seq || nd !== dropoff) {
      db.rideRequests.update(request.id, { from_segment_seq: nf, to_segment_seq: nt, ...(nd !== undefined ? { dropoff_stop_seq: nd } : {}), updated_at: now });
    }
  }
  if (proposal.linked_request_id) {
    db.rideRequests.update(proposal.linked_request_id, { from_segment_seq: k + 1, updated_at: now });
  }

  // Viaje: nueva geometría, distancia, duración y versión de ruta.
  db.trips.update(tripId, {
    route_geometry: proposal.proposed_geometry,
    route_distance_m: proposal.proposed_distance_m,
    route_duration_s: proposal.proposed_duration_s,
    route_version: proposal.from_route_version + 1,
    route_provider_ref: `${trip.route_provider_ref}|route-change:${proposalId}`,
    updated_at: now,
  });

  proposals.update(proposalId, {
    status: "accepted",
    resolution,
    auto_applied: resolution === "auto_applied",
    resolved_at: now,
    new_stop_seq: k + 1,
  });
  writeAudit(db, {
    actorUserId: null,
    action: "route_change.applied",
    entityType: "route_change_proposal",
    entityId: proposalId,
    metadata: { tripId, resolution, newStopSeq: k + 1, routeVersion: proposal.from_route_version + 1 },
  });

  // Avisos: conductor y pasajeros afectados.
  const driverName = publicUser(db, proposal.created_by_user_id).firstName;
  emitNotice(db, {
    userId: proposal.created_by_user_id,
    kind: "route_change_accepted",
    title: "Cambio de ruta aplicado",
    body:
      resolution === "auto_applied"
        ? "La nueva parada se ha añadido a tu ruta (cambio no material para los pasajeros)."
        : "Los pasajeros afectados han aceptado: la nueva parada ya está en tu ruta.",
    data: { proposalId, tripId },
  });
  // Quien no tuvo que aceptar recibe el aviso informativo; quien aceptó (salvo quien cerró la votación) recibe la confirmación.
  const perPassenger = new Map<string, Readonly<RouteChangeImpactRow>>();
  for (const impact of impacts
    .filter((i) => i.proposal_id === proposalId)
    .sort((a, b) => Number(b.requires_acceptance) - Number(a.requires_acceptance) || a.booking_id.localeCompare(b.booking_id))) {
    if (!perPassenger.has(impact.passenger_user_id)) perPassenger.set(impact.passenger_user_id, impact);
  }
  for (const [passengerId, impact] of perPassenger) {
    if (impact.requires_acceptance && passengerId === actorUserId) continue;
    emitNotice(db, {
      userId: passengerId,
      kind: "route_change_applied",
      title: impact.requires_acceptance ? "Cambio de ruta aplicado" : "Tu viaje ha cambiado ligeramente",
      body: impact.requires_acceptance
        ? `Todos los pasajeros afectados han aceptado: ${driverName} ha añadido una parada. ${arrivalChangeText(impact.schedule_delta_s)}`
        : `${driverName} ha añadido una parada. ${arrivalChangeText(impact.schedule_delta_s)}`,
      data: { proposalId, tripId, bookingId: impact.booking_id },
    });
  }
  return { applied: true };
}

// ── Responder y retirar ──────────────────────────────────────────────────────────────────────────────────────────────

/** `POST /v1/route-changes/{id}/respond`: solo un pasajero afectado que deba aceptar. Idempotente por decisión. */
export function respondToRouteChange(db: PreviewDb, principal: Principal, proposalId: string, decision: "accept" | "reject"): LiveRouteChange {
  expireDueRouteChanges(db, { proposalId });
  db.tx(() => {
    const { proposals, impacts, acceptances } = routeChangeTables(db);
    const proposal = proposals.get(proposalId);
    if (!proposal) throw new ApiFailure("ROUTE_CHANGE_NOT_FOUND", "Route change not found", 404);

    const mine = impacts.filter((i) => i.proposal_id === proposalId && i.passenger_user_id === principal.userId);
    if (mine.length === 0) throw new ApiFailure("ROUTE_CHANGE_NOT_FOUND", "Route change not found", 404);
    if (!mine.some((i) => i.requires_acceptance)) {
      throw new ApiFailure("ROUTE_CHANGE_ACCEPTANCE_NOT_REQUIRED", "This change does not require your acceptance", 409);
    }

    const wanted = decision === "accept";
    const previous = acceptances.get(`${proposalId}:${principal.userId}`);
    if (previous) {
      if (previous.accepted === wanted) return; // idempotente
      throw new ApiFailure("ROUTE_CHANGE_ALREADY_DECIDED", "You already answered this route change", 409);
    }
    if (proposal.status === "expired") throw new ApiFailure("ROUTE_CHANGE_EXPIRED", "The route change proposal has expired", 409);
    if (proposal.status !== "pending") throw new ApiFailure("ROUTE_CHANGE_NOT_PENDING", "The route change is no longer pending", 409);

    const now = db.nowMs();
    acceptances.insert({
      id: `${proposalId}:${principal.userId}`,
      proposal_id: proposalId,
      passenger_user_id: principal.userId,
      accepted: wanted,
      decided_at: now,
    });
    writeAudit(db, {
      actorUserId: principal.userId,
      action: wanted ? "route_change.accepted" : "route_change.rejected",
      entityType: "route_change_proposal",
      entityId: proposalId,
      metadata: { tripId: proposal.trip_id },
    });

    const passengerName = publicUser(db, principal.userId).firstName;
    if (!wanted) {
      const rejected = proposals.update(proposalId, { status: "rejected", resolution: "rejected_by_passenger", resolved_at: now });
      emitNotice(db, {
        userId: proposal.created_by_user_id,
        kind: "route_change_rejected",
        title: "Cambio de ruta rechazado",
        body: `${passengerName} ha rechazado la nueva parada: la ruta sigue igual.`,
        data: { proposalId, tripId: proposal.trip_id },
      });
      notifyRequiredPassengers(
        db,
        rejected,
        "route_change_cancelled",
        "La propuesta de cambio de ruta ya no sigue adelante",
        "Tu viaje sigue igual: no se ha aplicado ningún cambio.",
        principal.userId
      );
      return;
    }

    const counts = routeChangeCounts(db, proposalId);
    if (counts.required > 0 && counts.accepted >= counts.required && counts.rejected === 0) {
      const outcome = applyProposal(db, proposalId, "all_accepted", principal.userId);
      if (!outcome.applied) {
        const closed = proposals.get(proposalId) as Readonly<RouteChangeProposalRow>;
        emitNotice(db, {
          userId: proposal.created_by_user_id,
          kind: "route_change_cancelled",
          title: "No se pudo aplicar el cambio de ruta",
          body:
            outcome.reason === "capacity_lost"
              ? "Mientras tanto se ocuparon las plazas necesarias: vuelve a proponerlo si sigue siendo posible."
              : "La ruta o las reservas cambiaron mientras tanto: vuelve a proponer el cambio.",
          data: { proposalId, tripId: proposal.trip_id },
        });
        notifyRequiredPassengers(
          db,
          closed,
          "route_change_cancelled",
          "La propuesta de cambio de ruta ya no sigue adelante",
          "Tu viaje sigue igual: no se ha aplicado ningún cambio.",
          principal.userId
        );
      }
    }
  });
  return getRouteChangeView(db, principal.userId, proposalId);
}

/** `POST /v1/route-changes/{id}/cancel`: solo el conductor propietario y mientras esté pendiente. */
export function cancelRouteChange(db: PreviewDb, principal: Principal, proposalId: string): LiveRouteChange {
  expireDueRouteChanges(db, { proposalId });
  db.tx(() => {
    const { proposals, impacts } = routeChangeTables(db);
    const proposal = proposals.get(proposalId);
    if (!proposal) throw new ApiFailure("ROUTE_CHANGE_NOT_FOUND", "Route change not found", 404);
    const trip = db.trips.get(proposal.trip_id);
    const isOwner = proposal.created_by_user_id === principal.userId || trip?.driver_user_id === principal.userId;
    if (!isOwner) {
      const participant = impacts.find((i) => i.proposal_id === proposalId && i.passenger_user_id === principal.userId);
      if (!participant) throw new ApiFailure("ROUTE_CHANGE_NOT_FOUND", "Route change not found", 404);
      throw new ApiFailure("TRIP_NOT_OWNED", "Only the trip driver may cancel a route change", 403);
    }
    if (proposal.status !== "pending") throw new ApiFailure("ROUTE_CHANGE_NOT_PENDING", "The route change is no longer pending", 409);

    const cancelled = proposals.update(proposalId, { status: "cancelled", resolution: "cancelled_by_driver", resolved_at: db.nowMs() });
    writeAudit(db, {
      actorUserId: principal.userId,
      action: "route_change.cancelled",
      entityType: "route_change_proposal",
      entityId: proposalId,
      metadata: { tripId: proposal.trip_id },
    });
    notifyRequiredPassengers(
      db,
      cancelled,
      "route_change_cancelled",
      "El conductor ha retirado la propuesta de cambio de ruta",
      "Tu viaje sigue igual."
    );
  });
  return getRouteChangeView(db, principal.userId, proposalId);
}

// ── Vista ────────────────────────────────────────────────────────────────────────────────────────────────────────────

function priceImpactView(row: Readonly<RouteChangeImpactRow>) {
  // Sin tarifa aprobada no hay base de cálculo: «Por definir» y nunca exige aceptación por sí mismo.
  return {
    before: moneyPending(),
    after: moneyPending(),
    delta: moneyPending(),
    changed: row.price_delta_cents !== null && row.price_delta_cents !== 0,
    material: row.price_material,
  };
}

function scheduleView(before: number | null, after: number | null, deltaSeconds: number, material: boolean) {
  return { beforeAt: iso(before), afterAt: iso(after), deltaSeconds, material };
}

const stopView = (db: PreviewDb, tripId: string, seq: number): LiveStop | null => {
  const row = db.tripStops.get(`${tripId}:${seq}`);
  return row ? { seq: row.seq, label: row.label, location: { lat: row.lat, lng: row.lng } } : null;
};

/**
 * `GET /v1/route-changes/{id}`: lo ve el conductor que la propuso (`participants`) y los pasajeros afectados (`myImpact`).
 * Quien no participa recibe `404 ROUTE_CHANGE_NOT_FOUND`.
 */
export function getRouteChangeView(db: PreviewDb, userId: string, proposalId: string): LiveRouteChange {
  expireDueRouteChanges(db, { proposalId });
  const { proposals, impacts: impactTable, acceptances } = routeChangeTables(db);
  const proposal = proposals.get(proposalId);
  if (!proposal) throw new ApiFailure("ROUTE_CHANGE_NOT_FOUND", "Route change not found", 404);
  const trip = db.trips.get(proposal.trip_id);

  const impacts = impactTable.filter((i) => i.proposal_id === proposalId).sort((a, b) => a.pickup_stop_seq - b.pickup_stop_seq || a.booking_id.localeCompare(b.booking_id));
  const isDriver = proposal.created_by_user_id === userId || trip?.driver_user_id === userId;
  const mine = impacts
    .filter((i) => i.passenger_user_id === userId)
    .sort((a, b) => Number(b.requires_acceptance) - Number(a.requires_acceptance) || b.schedule_delta_s - a.schedule_delta_s)[0];
  if (!isDriver && !mine) throw new ApiFailure("ROUTE_CHANGE_NOT_FOUND", "Route change not found", 404);

  const decisionOf = (passengerUserId: string): LiveDecision | null => {
    const found = acceptances.get(`${proposalId}:${passengerUserId}`);
    return found ? (found.accepted ? "accepted" : "rejected") : null;
  };

  // Polilíneas: el pasajero ve solo su trayecto; el conductor, la ruta completa.
  let before: LngLat[] = proposal.before_geometry;
  let after: LngLat[] = proposal.proposed_geometry;
  if (!isDriver && mine) {
    const slice = (route: LngLat[]): LngLat[] => {
      const a = projectOnRoute(route, mine.pickup_lat, mine.pickup_lng);
      const b = projectOnRoute(route, mine.dropoff_lat, mine.dropoff_lng);
      return a && b && a.fraction !== b.fraction ? sliceByFraction(route, a.fraction, b.fraction) : route;
    };
    before = slice(before);
    after = slice(after);
  }

  // Paradas del pasajero con la numeración vigente (si ya se aplicó, los seq posteriores a k suben una posición).
  let stops: { pickup: LiveStop | null; dropoff: LiveStop | null } = { pickup: null, dropoff: null };
  if (!isDriver && mine) {
    const applied = proposal.status === "accepted" && proposal.new_stop_seq !== null;
    const k = proposal.after_stop_seq;
    const mapSeq = (seq: number): number => (applied && seq > k ? seq + 1 : seq);
    stops = { pickup: stopView(db, proposal.trip_id, mapSeq(mine.pickup_stop_seq)), dropoff: stopView(db, proposal.trip_id, mapSeq(mine.dropoff_stop_seq)) };
  }

  let myImpact: LiveRouteChangeImpact | null = null;
  if (!isDriver && mine) {
    myImpact = {
      pickup: scheduleView(
        mine.pickup_before_at,
        mine.pickup_after_at,
        mine.pickup_before_at !== null && mine.pickup_after_at !== null ? Math.round((mine.pickup_after_at - mine.pickup_before_at) / 1000) : 0,
        false
      ),
      dropoff: scheduleView(mine.dropoff_before_at, mine.dropoff_after_at, mine.schedule_delta_s, mine.schedule_material),
      price: priceImpactView(mine),
      requiresAcceptance: mine.requires_acceptance,
    };
  }

  let participants: LiveRouteChangeParticipantRow[] | null = null;
  if (isDriver) {
    participants = impacts.map((i) => ({
      bookingId: i.booking_id,
      passenger: publicUser(db, i.passenger_user_id),
      requiresAcceptance: i.requires_acceptance,
      decision: i.requires_acceptance ? decisionOf(i.passenger_user_id) : null,
      deltaSeconds: i.schedule_delta_s,
      priceDelta: moneyPending(),
    }));
  }

  const nowMs = db.nowMs();
  const fix = loadLiveFix(db, proposal.trip_id);
  const tripActive = trip?.status === "active";
  const signalState: LiveSignal = tripActive ? signalOf(fix, nowMs, LIVE_SETTINGS.staleAfterSeconds) : "none";
  const driverSignal = {
    state: signalState,
    lastUpdateAt: tripActive && fix ? isoReq(fix.recordedAtMs) : null,
    ageSeconds: tripActive && fix ? Math.max(0, Math.floor((nowMs - fix.recordedAtMs) / 1000)) : null,
  };

  return {
    id: proposal.id,
    tripId: proposal.trip_id,
    kind: "new_stop",
    status: proposal.status,
    resolution: proposal.resolution,
    autoApplied: proposal.auto_applied,
    role: isDriver ? "driver" : "passenger",
    createdAt: isoReq(proposal.created_at),
    expiresAt: iso(proposal.expires_at),
    resolvedAt: iso(proposal.resolved_at),
    driver: publicUser(db, proposal.created_by_user_id),
    newStop: {
      label: proposal.new_stop_label,
      location: { lat: proposal.new_lat, lng: proposal.new_lng },
      afterStopSeq: proposal.after_stop_seq,
      plannedArrivalAt: iso(proposal.planned_arrival_at),
      seq: proposal.new_stop_seq,
    },
    detour: { addedDistanceM: proposal.added_distance_m, addedDurationSeconds: proposal.added_duration_s, maxDetourM: proposal.max_detour_m },
    path: { before: toGeoPoints(before), after: toGeoPoints(after) },
    stops,
    myImpact,
    myDecision: !isDriver ? decisionOf(userId) : null,
    counts: routeChangeCounts(db, proposalId),
    participants,
    driverSignal,
    surcharge: "none",
    linkedRequestId: isDriver ? proposal.linked_request_id : null,
  };
}
