/**
 * Reserva semanal (pantalla 14): vista previa de días y plazas, creación (UNA solicitud por día y sentido), lectura y
 * retirada. Porta `src/modules/trips/weekly.ts`.
 *
 * Reglas del contrato: solo viajes recurrentes; los días pedidos deben estar entre los que ofrece el conductor; «vuelta»
 * exige que el conductor la ofrezca; el inicio no puede estar en el pasado; 1–4 semanas; las excepciones (vacaciones,
 * festivos) se omiten; sin `allowPartial`, una sola fecha sin plaza rechaza TODA la reserva; el conductor decide la reserva
 * entera (todo o nada). Cada día es una solicitud con su propio hold: la reserva semanal no es más que su agrupación.
 *
 * Los viajes de cada fecha se «materializan» al crear la reserva (copia del viaje ancla desplazada de día; la vuelta es el
 * mismo recorrido en sentido inverso). La vista previa no crea nada. SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`).
 */
import type {
  IsoDate,
  RequestHold,
  RequestNextAction,
  RideRequestStatus,
  TripLeg,
  TripQuote,
  Weekday,
  WeeklyLegSummary,
  WeeklyOccurrence,
  WeeklyRequestBody,
  WeeklyRequestPreview,
  WeeklyReservation,
} from "@/api/types";
import {
  addDaysToDate,
  createRideRequestForTrip,
  fail,
  isoReq,
  isoWeekdayOf,
  madridDate,
  madridDateTimeMs,
  publicUser,
  stableUuid,
  type PreviewDb,
  type Principal,
  type RideRequestRow,
  type TripRow,
} from "@/preview";
import { freeSeatsInRange, loadTripGeometry, type PickupOption, type TripGeometry } from "./browseGeometry";
import { WEEKDAY_ORDER, metaFor, readPreviewTariff, tripMetaTable, type TripMetaRow } from "./browseMeta";
import { computeQuote, computeWeeklyQuote, resolveDropoff, resolvePickupPointId } from "./browseQuote";
import { loadVisibleTrip, localTimeOf } from "./browseShared";
import { cleanMessage } from "./requestCreate";
import { buildNextAction, quoteLocks } from "./requestDetail";

const MAX_WEEKS = 4;

/** Cabecera de una reserva semanal (las ocurrencias son las solicitudes con su `weekly_reservation_id`). */
export interface WeeklyRow {
  id: string;
  series_id: string;
  passenger_user_id: string;
  anchor_trip_id: string;
  weekdays: Weekday[];
  legs: TripLeg[];
  start_date: string;
  weeks: number;
  exception_dates: string[];
  policy_version: string | null;
  pickup_point_id: string;
  dropoff_seq: number;
  /** Importe semanal fijado al crear. */
  quote: TripQuote;
  created_at: number;
}

export const weeklyTable = (db: PreviewDb) => db.collection<WeeklyRow>("weekly_reservations");

// ── Plan de cada sentido ────────────────────────────────────────────────────────────────────────────────────────

interface PlannedLeg {
  leg: TripLeg;
  departLocal: string;
  fromSeq: number;
  toSeq: number;
  pickupOffsetS: number;
  dropoffOffsetS: number;
  roadM: number;
  fromLabel: string | null;
  toLabel: string | null;
  pickupLat: number;
  pickupLng: number;
  pickupSource: "driver_stop" | "route_projection";
  detourMinutes: number;
  walkMinutes: number | null;
}

function planLegs(anchor: Readonly<TripRow>, meta: TripMetaRow, geo: TripGeometry, pickup: PickupOption, dropoffSeq: number, legs: readonly TripLeg[]): PlannedLeg[] {
  const last = geo.stops.length - 1;
  const total = geo.offsets[last] ?? 0;
  const totalM = geo.distances[last] ?? 0;
  const dropoffStop = geo.stops[dropoffSeq];
  const plans: PlannedLeg[] = [];
  if (legs.includes("outbound")) {
    plans.push({
      leg: "outbound",
      departLocal: localTimeOf(anchor.departure_at ?? 0),
      fromSeq: pickup.segmentSeq,
      toSeq: dropoffSeq,
      pickupOffsetS: pickup.offsetS,
      dropoffOffsetS: geo.offsets[dropoffSeq] ?? 0,
      roadM: Math.max(0, (geo.distances[dropoffSeq] ?? 0) - pickup.distanceFromStartM),
      fromLabel: pickup.label ?? geo.stops[pickup.segmentSeq]?.label ?? null,
      toLabel: dropoffStop?.label ?? null,
      pickupLat: pickup.location.lat,
      pickupLng: pickup.location.lng,
      pickupSource: pickup.source,
      detourMinutes: pickup.detourMinutes,
      walkMinutes: pickup.walkMinutes,
    });
  }
  if (legs.includes("return") && meta.returnLocal !== null) {
    const atStop = pickup.stopSeq !== null;
    const toSeq = atStop ? last - (pickup.stopSeq ?? 0) : last;
    plans.push({
      leg: "return",
      departLocal: meta.returnLocal,
      fromSeq: last - dropoffSeq,
      toSeq,
      pickupOffsetS: total - (geo.offsets[dropoffSeq] ?? 0),
      dropoffOffsetS: atStop ? total - (geo.offsets[pickup.stopSeq ?? 0] ?? 0) : total,
      roadM: atStop ? Math.max(0, (geo.distances[dropoffSeq] ?? 0) - pickup.distanceFromStartM) : (geo.distances[dropoffSeq] ?? 0),
      fromLabel: dropoffStop?.label ?? null,
      toLabel: atStop ? pickup.label : (geo.stops[last]?.label ?? null),
      pickupLat: dropoffStop?.lat ?? 0,
      pickupLng: dropoffStop?.lng ?? 0,
      pickupSource: "driver_stop",
      detourMinutes: 0,
      walkMinutes: null,
    });
  }
  void totalM;
  return plans;
}

const legLabel = (leg: TripLeg): string => (leg === "outbound" ? "Ida (mañana)" : "Vuelta (tarde)");

function summarize(plans: readonly PlannedLeg[]): WeeklyLegSummary[] {
  return plans.map((p) => {
    const dep = madridDateTimeMs("2000-01-03", p.departLocal);
    return {
      leg: p.leg,
      label: legLabel(p.leg),
      fromLabel: p.fromLabel,
      toLabel: p.toLabel,
      boardsAtLocal: localTimeOf(dep + p.pickupOffsetS * 1000),
      arrivesAtLocal: localTimeOf(dep + p.dropoffOffsetS * 1000),
    };
  });
}

// ── Ocurrencias ─────────────────────────────────────────────────────────────────────────────────────────────────

const weekdayOf = (date: string): Weekday => WEEKDAY_ORDER[isoWeekdayOf(date) - 1] ?? "mon";

/** Viaje ya materializado de esa serie, fecha y sentido (el ancla cuenta como la ida de su fecha). */
function existingOccurrenceTrip(db: PreviewDb, anchor: Readonly<TripRow>, meta: TripMetaRow, date: string, leg: TripLeg): Readonly<TripRow> | null {
  if (leg === "outbound" && anchor.departure_at !== null && madridDate(anchor.departure_at) === date) return anchor;
  const id = stableUuid(`trip:occurrence:${anchor.id}:${date}:${leg}`);
  void meta;
  return db.trips.get(id) ?? null;
}

/** Copia del viaje ancla para otra fecha (la vuelta recorre la ruta al revés). Idempotente por (ancla, fecha, sentido). */
function materializeTrip(db: PreviewDb, anchor: Readonly<TripRow>, meta: TripMetaRow, date: string, leg: TripLeg, departLocal: string): Readonly<TripRow> {
  const existing = existingOccurrenceTrip(db, anchor, meta, date, leg);
  if (existing) return existing;
  const id = stableUuid(`trip:occurrence:${anchor.id}:${date}:${leg}`);
  const now = db.nowMs();
  const reverse = leg === "return";
  const stops = db.tripStops.filter((s) => s.trip_id === anchor.id).sort((a, b) => a.seq - b.seq);
  const segments = db.tripSegments.filter((s) => s.trip_id === anchor.id).sort((a, b) => a.seq - b.seq);
  const last = stops.length - 1;
  const trip = db.trips.insert({
    ...anchor,
    id,
    kind: "single",
    leg,
    status: "published",
    departure_at: madridDateTimeMs(date, departLocal),
    origin_lat: reverse ? anchor.destination_lat : anchor.origin_lat,
    origin_lng: reverse ? anchor.destination_lng : anchor.origin_lng,
    destination_lat: reverse ? anchor.origin_lat : anchor.destination_lat,
    destination_lng: reverse ? anchor.origin_lng : anchor.destination_lng,
    route_geometry: reverse ? [...anchor.route_geometry].reverse() : anchor.route_geometry,
    started_at: null,
    completed_at: null,
    created_at: now,
    updated_at: now,
  });
  stops.forEach((_, i) => {
    const source = reverse ? stops[last - i] : stops[i];
    if (!source) return;
    db.tripStops.insert({
      id: `${id}:${i}`,
      trip_id: id,
      seq: i,
      kind: i === 0 ? "origin" : i === last ? "destination" : "stop",
      lat: source.lat,
      lng: source.lng,
      label: source.label,
    });
  });
  segments.forEach((_, i) => {
    const source = reverse ? segments[segments.length - 1 - i] : segments[i];
    if (!source) return;
    db.tripSegments.insert({
      id: `${id}:${i}`,
      trip_id: id,
      seq: i,
      from_stop_seq: i,
      to_stop_seq: i + 1,
      distance_m: source.distance_m,
      duration_s: source.duration_s,
      capacity: source.capacity,
    });
  });
  tripMetaTable(db).put({
    ...meta,
    id,
    returnLocal: null,
    optionalStops: reverse ? meta.optionalStops.map((o) => ({ ...o, seq: last - o.seq })) : meta.optionalStops,
  });
  return trip;
}

interface Planned {
  anchor: Readonly<TripRow>;
  meta: TripMetaRow;
  geo: TripGeometry;
  pickup: PickupOption;
  dropoffSeq: number;
  legs: TripLeg[];
  plans: PlannedLeg[];
  weekdays: Weekday[];
  weeks: number;
  exceptions: string[];
  startDate: string;
  occurrences: WeeklyOccurrence[];
  issues: WeeklyRequestPreview["issues"];
  quote: TripQuote;
  canSubmit: boolean;
}

function planWeekly(db: PreviewDb, viewerUserId: string, tripId: string, body: WeeklyRequestBody): Planned {
  const anchor = loadVisibleTrip(db, tripId, viewerUserId);
  if (anchor.status !== "published" && anchor.status !== "active") return fail("TRIP_NOT_BOOKABLE", "Este viaje ya no admite solicitudes.", 409);
  if (anchor.driver_user_id === viewerUserId) return fail("DRIVER_CANNOT_REQUEST_OWN_TRIP", "No puedes solicitar plaza en tu propio viaje.", 409);
  const meta = metaFor(db, anchor.id);
  if (meta.weekdays === null || meta.seriesId === null) return fail("TRIP_NOT_RECURRING", "Este viaje no se repite: solicita una plaza puntual.", 422);

  const weekdays = [...new Set(body.weekdays)].sort((a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b));
  if (weekdays.length === 0 || weekdays.some((day) => !(meta.weekdays ?? []).includes(day))) {
    return fail("WEEKLY_WEEKDAY_NOT_OFFERED", "El conductor no ofrece alguno de los días elegidos.", 422, { offered: meta.weekdays });
  }
  const legs: TripLeg[] = body.legs && body.legs.length > 0 ? [...new Set(body.legs)] : ["outbound"];
  if (legs.includes("return") && meta.returnLocal === null) return fail("SERIES_HAS_NO_RETURN", "El conductor no ofrece vuelta en este viaje.", 422);
  const weeks = body.weeks ?? 1;
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_WEEKS) return fail("INVALID_REQUEST_SHAPE", "Puedes reservar de 1 a 4 semanas.", 422);
  const now = db.nowMs();
  if (body.startDate < madridDate(now)) return fail("WEEKLY_START_DATE_IN_PAST", "La fecha de inicio ya ha pasado.", 422);

  const geo = loadTripGeometry(db, anchor, meta);
  const pickup = resolvePickupPointId(db, anchor, meta, geo, body.pickupPointId);
  const dropoff = resolveDropoff(geo.stops, body.dropoffStopSeq, pickup);
  const plans = planLegs(anchor, meta, geo, pickup, dropoff.seq, legs);
  const exceptions = [...new Set(body.exceptionDates ?? [])];

  const occurrences: WeeklyOccurrence[] = [];
  const issues: WeeklyRequestPreview["issues"] = [];
  for (let offset = 0; offset < weeks * 7; offset += 1) {
    const date = addDaysToDate(body.startDate, offset);
    const weekday = weekdayOf(date);
    if (!weekdays.includes(weekday)) continue;
    for (const plan of plans) {
      const departure = madridDateTimeMs(date, plan.departLocal);
      const base: WeeklyOccurrence = {
        date,
        weekday,
        leg: plan.leg,
        tripId: null,
        boardsAtLocal: localTimeOf(departure + plan.pickupOffsetS * 1000),
        arrivesAtLocal: localTimeOf(departure + plan.dropoffOffsetS * 1000),
        state: "available",
        seatsAvailable: null,
        requestId: null,
        requestStatus: null,
      };
      if (exceptions.includes(date)) {
        occurrences.push({ ...base, boardsAtLocal: null, arrivesAtLocal: null, state: "skipped_exception" });
        continue;
      }
      if (departure <= now) {
        occurrences.push({ ...base, boardsAtLocal: null, arrivesAtLocal: null, state: "skipped_past" });
        continue;
      }
      const trip = existingOccurrenceTrip(db, anchor, meta, date, plan.leg);
      let seats = anchor.offered_seats;
      if (trip) {
        const view = loadTripGeometry(db, trip, metaFor(db, trip.id));
        seats = freeSeatsInRange(view.segments, plan.fromSeq, plan.toSeq);
      }
      const full = seats <= 0 || (trip !== null && trip.status !== "published" && trip.status !== "active");
      occurrences.push({ ...base, tripId: trip?.id ?? null, seatsAvailable: Math.max(0, seats), state: full ? "skipped_full" : "available" });
      if (full) {
        issues.push({ code: "WEEKLY_OCCURRENCE_UNAVAILABLE", message: `El ${date} (${legLabel(plan.leg).toLowerCase()}) ya no tiene plazas.`, date });
      }
    }
  }
  const requestable = occurrences.filter((o) => o.state === "available").length;
  const full = occurrences.filter((o) => o.state === "skipped_full").length;
  if (requestable === 0) issues.push({ code: "WEEKLY_NO_OCCURRENCES", message: "Ninguno de los días elegidos tiene viajes disponibles.", date: null });
  const quote = computeWeeklyQuote(
    readPreviewTariff(db),
    { outboundM: plans.find((p) => p.leg === "outbound")?.roadM ?? plans[0]?.roadM ?? 0, returnM: plans.find((p) => p.leg === "return")?.roadM ?? null },
    weekdays
  );
  return {
    anchor,
    meta,
    geo,
    pickup,
    dropoffSeq: dropoff.seq,
    legs,
    plans,
    weekdays,
    weeks,
    exceptions,
    startDate: body.startDate,
    occurrences,
    issues,
    quote,
    canSubmit: requestable > 0 && (body.allowPartial === true || full === 0),
  };
}

export function previewWeekly(db: PreviewDb, userId: string, tripId: string, body: WeeklyRequestBody): WeeklyRequestPreview {
  const plan = planWeekly(db, userId, tripId, body);
  return {
    tripId: plan.anchor.id,
    seriesId: plan.meta.seriesId ?? plan.anchor.id,
    legs: summarize(plan.plans),
    occurrences: plan.occurrences,
    quote: plan.quote,
    canSubmit: plan.canSubmit,
    issues: plan.issues,
  };
}

// ── Lectura de una reserva ──────────────────────────────────────────────────────────────────────────────────────

const OPEN: ReadonlySet<RideRequestStatus> = new Set(["pending", "accepted", "payment_pending", "confirmed"]);

export function aggregateStatus(statuses: readonly RideRequestStatus[]): WeeklyReservation["status"] {
  const normalized = statuses.map((s) => (s === "accepted" ? "payment_pending" : s));
  const open = normalized.filter((s) => OPEN.has(s));
  if (open.length === 0) {
    if (normalized.every((s) => s === "rejected")) return "rejected";
    if (normalized.every((s) => s === "cancelled")) return "cancelled";
    return "expired";
  }
  const confirmed = open.filter((s) => s === "confirmed").length;
  if (confirmed === open.length) return "confirmed";
  if (confirmed > 0) return "partially_confirmed";
  return open.some((s) => s === "pending") ? "pending" : "payment_pending";
}

function occurrenceOf(db: PreviewDb, row: Readonly<RideRequestRow>, plans: readonly PlannedLeg[]): WeeklyOccurrence {
  const trip = db.trips.get(row.trip_id);
  const departure = trip?.departure_at ?? 0;
  const leg = trip?.leg ?? "outbound";
  const plan = plans.find((p) => p.leg === leg);
  const date = madridDate(departure);
  return {
    date,
    weekday: weekdayOf(date),
    leg,
    tripId: row.trip_id,
    boardsAtLocal: localTimeOf(departure + (row.pickup_offset_s ?? plan?.pickupOffsetS ?? 0) * 1000),
    arrivesAtLocal: localTimeOf(departure + (plan?.dropoffOffsetS ?? 0) * 1000),
    state: "requested",
    seatsAvailable: null,
    requestId: row.id,
    requestStatus: row.status === "accepted" ? "payment_pending" : row.status,
  };
}

export function weeklyRequests(db: PreviewDb, reservationId: string): Array<Readonly<RideRequestRow>> {
  return db.rideRequests
    .filter((r) => r.weekly_reservation_id === reservationId)
    .sort((a, b) => (db.trips.get(a.trip_id)?.departure_at ?? 0) - (db.trips.get(b.trip_id)?.departure_at ?? 0));
}

function weeklyHold(db: PreviewDb, requests: readonly Readonly<RideRequestRow>[]): { hold: RequestHold | null; earliest: number | null } {
  const now = db.nowMs();
  const active = requests
    .map((r) => db.seatHolds.find((h) => h.request_id === r.id))
    .filter((h): h is NonNullable<typeof h> => h !== undefined && h.status === "active" && h.expires_at > now);
  if (active.length === 0) return { hold: null, earliest: null };
  const earliest = Math.min(...active.map((h) => h.expires_at));
  return { hold: { expiresAt: isoReq(earliest), remainingSeconds: Math.max(0, Math.floor((earliest - now) / 1000)), active: true }, earliest };
}

export function buildWeeklyReservation(db: PreviewDb, row: Readonly<WeeklyRow>, extra: readonly WeeklyOccurrence[] = []): WeeklyReservation {
  const anchor = db.trips.get(row.anchor_trip_id);
  if (!anchor) return fail("REQUEST_NOT_FOUND", "La reserva no existe.", 404);
  const meta = metaFor(db, anchor.id);
  const geo = loadTripGeometry(db, anchor, meta);
  const pickup = resolvePickupPointId(db, anchor, meta, geo, row.pickup_point_id);
  const plans = planLegs(anchor, meta, geo, pickup, row.dropoff_seq, row.legs);
  const requests = weeklyRequests(db, row.id);
  const status = aggregateStatus(requests.map((r) => r.status));
  const { hold, earliest } = weeklyHold(db, requests);
  const next: RequestNextAction =
    status === "pending"
      ? { kind: "wait_for_driver", deadlineAt: null }
      : status === "payment_pending" || status === "partially_confirmed"
        ? buildNextAction("payment_pending", earliest)
        : status === "confirmed"
          ? { kind: "view_booking", deadlineAt: null }
          : { kind: "search_again", deadlineAt: null };
  return {
    id: row.id,
    seriesId: row.series_id,
    status,
    passenger: publicUser(db, row.passenger_user_id),
    driver: publicUser(db, anchor.driver_user_id),
    category: anchor.category,
    weekdays: row.weekdays,
    legs: summarize(plans),
    startDate: row.start_date,
    weeks: row.weeks,
    exceptionDates: row.exception_dates,
    cancellationPolicyVersion: row.policy_version,
    occurrences: [...requests.map((r) => occurrenceOf(db, r, plans)), ...extra],
    hold,
    quote: { ...row.quote, lockedAt: isoReq(row.created_at) },
    nextAction: next,
    createdAt: isoReq(row.created_at),
  };
}

export function loadWeeklyFor(db: PreviewDb, reservationId: string, viewerUserId: string): Readonly<WeeklyRow> {
  const row = weeklyTable(db).get(reservationId);
  const anchor = row ? db.trips.get(row.anchor_trip_id) : undefined;
  if (!row || !anchor || (row.passenger_user_id !== viewerUserId && anchor.driver_user_id !== viewerUserId)) {
    return fail("REQUEST_NOT_FOUND", "La reserva no existe.", 404);
  }
  return row;
}

export function getWeekly(db: PreviewDb, reservationId: string, viewerUserId: string): WeeklyReservation {
  return buildWeeklyReservation(db, loadWeeklyFor(db, reservationId, viewerUserId));
}

export function withdrawWeekly(db: PreviewDb, reservationId: string, userId: string): WeeklyReservation {
  const row = loadWeeklyFor(db, reservationId, userId);
  if (row.passenger_user_id !== userId) return fail("REQUEST_NOT_FOUND", "La reserva no existe.", 404);
  const requests = weeklyRequests(db, row.id);
  if (!requests.every((r) => r.status === "pending" || r.status === "cancelled")) {
    return fail("REQUEST_NOT_WITHDRAWABLE", "Solo puedes retirar una reserva semanal que el conductor aún no ha respondido.", 409);
  }
  const now = db.nowMs();
  for (const request of requests) {
    if (request.status === "pending") db.rideRequests.update(request.id, { status: "cancelled", updated_at: now });
  }
  return buildWeeklyReservation(db, row);
}

// ── Creación ────────────────────────────────────────────────────────────────────────────────────────────────────

export function createWeekly(db: PreviewDb, principal: Principal, tripId: string, body: WeeklyRequestBody, auditRequestId?: string): WeeklyReservation {
  if (body.cancellationPolicyVersion !== undefined && body.cancellationPolicyVersion !== null) {
    return fail("INVALID_CANCELLATION_POLICY_VERSION", "La política de cancelación indicada no está vigente.", 422);
  }
  const message = cleanMessage(body.message);
  const plan = planWeekly(db, principal.userId, tripId, body);
  if (plan.occurrences.filter((o) => o.state === "available").length === 0) {
    return fail("WEEKLY_NO_OCCURRENCES", "Ninguno de los días elegidos tiene viajes disponibles.", 409);
  }
  if (!plan.canSubmit) {
    const first = plan.issues.find((i) => i.code === "WEEKLY_OCCURRENCE_UNAVAILABLE");
    return fail("WEEKLY_OCCURRENCE_UNAVAILABLE", first?.message ?? "Alguno de los días ya no tiene plazas.", 409, { issues: plan.issues });
  }
  const reservationId = db.ids.uuid();
  const now = db.nowMs();
  const skippedFull: WeeklyOccurrence[] = [];
  db.tx(() => {
    for (const occurrence of plan.occurrences) {
      if (occurrence.state === "skipped_full") {
        skippedFull.push(occurrence);
        continue;
      }
      if (occurrence.state !== "available") continue;
      const leg = plan.plans.find((p) => p.leg === occurrence.leg);
      if (!leg) continue;
      const trip = materializeTrip(db, plan.anchor, plan.meta, occurrence.date, occurrence.leg, leg.departLocal);
      const { request } = createRideRequestForTrip(
        db,
        principal,
        { tripId: trip.id, fromSegmentSeq: leg.fromSeq, toSegmentSeq: leg.toSeq },
        {
          pickup_lat: leg.pickupLat,
          pickup_lng: leg.pickupLng,
          pickup_label: leg.fromLabel,
          pickup_address: null,
          pickup_source: leg.pickupSource,
          pickup_offset_s: leg.pickupOffsetS,
          pickup_walk_minutes: leg.walkMinutes,
          pickup_detour_minutes: leg.detourMinutes,
          dropoff_stop_seq: leg.toSeq,
          road_distance_m: leg.roadM,
          message,
          weekly_reservation_id: reservationId,
        },
        auditRequestId
      );
      quoteLocks(db).put({ id: request.id, quote: computeQuote(readPreviewTariff(db), leg.roadM), locked_at: now });
    }
    weeklyTable(db).insert({
      id: reservationId,
      series_id: plan.meta.seriesId ?? plan.anchor.id,
      passenger_user_id: principal.userId,
      anchor_trip_id: plan.anchor.id,
      weekdays: plan.weekdays,
      legs: plan.legs,
      start_date: plan.startDate,
      weeks: plan.weeks,
      exception_dates: plan.exceptions,
      policy_version: null,
      pickup_point_id: body.pickupPointId,
      dropoff_seq: plan.dropoffSeq,
      quote: plan.quote,
      created_at: now,
    });
  });
  const row = weeklyTable(db).get(reservationId);
  if (!row) return fail("INTERNAL_ERROR", "No se pudo crear la reserva.", 500);
  return buildWeeklyReservation(db, row, body.allowPartial === true ? skippedFull : []);
}

export type { IsoDate };
