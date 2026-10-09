import type { Pool, PoolClient } from "pg";
import type { AuthPrincipal } from "../../auth/session.js";
import { writeAudit } from "../../lib/audit.js";
import { notify } from "../../lib/notify.js";
import { acceptRequestInTx, insertRideRequestInTx, rejectRequestInTx } from "../../services/request-service.js";
import {
  addDays, inParallel, iso, localDateOf, localTimeOf, minutesFromSeconds, sortWeekdays, spanishDay, tx, weekdayOfDate,
  isIsoDate, type Db
} from "./common.js";
import { err } from "./errors.js";
import { withIdempotency } from "./idempotency.js";
import { resolveDropoff, resolvePickupPointId } from "./pickup-service.js";
import { loadPublicUsers, publicUserOrUnknown } from "./public-user.js";
import {
  computeWeeklyQuote, loadApprovedTariff, lockQuoteForRequest, type ApprovedTariff
} from "./quote-service.js";
import { buildHold, buildNextAction, expireIfDue } from "./request-detail.js";
import { normalizeMessage } from "./requests.js";
import { SERIES_SELECT, horizonDate, materializeSeries, normalizeSeries, type SeriesRow } from "./series-service.js";
import { tripsSettings } from "./settings.js";
import {
  freeSeatsInRange, loadSegmentLoads, loadStops, loadTrips, stopDistances, stopOffsets, type SegmentLoad, type StopRow, type TripRow
} from "./trip-data.js";
import type {
  DecideRequestResponse, IsoDate, RequestHold, RideRequestStatus, TripLeg, TripQuote, Weekday, WeeklyLegSummary,
  WeeklyOccurrence, WeeklyOccurrenceState, WeeklyRequestBody, WeeklyRequestPreview, WeeklyReservation
} from "./types.js";

const POLICY_VERSION = /^[A-Za-z0-9._:-]{1,80}$/;
const OPEN = ["pending", "accepted", "payment_pending", "confirmed"] as const;

type PlannedOccurrence = {
  view: WeeklyOccurrence;
  trip: TripRow | null;
  from: number;
  to: number;
  boardOffsetS: number;
  roadDistanceM: number;
  boardStop: StopRow | null;
};

export type WeeklyPlan = {
  anchor: TripRow;
  series: SeriesRow;
  legsRequested: TripLeg[];
  weekdays: Weekday[];
  startDate: IsoDate;
  endDate: IsoDate;
  weeks: number;
  exceptionDates: IsoDate[];
  pickup: { lat: number; lng: number; label: string | null; address: string | null; source: "driver_stop" | "route_projection"; stopSeq: number | null; walkMinutes: number | null; detourMinutes: number };
  dropoffStopSeq: number;
  legs: WeeklyLegSummary[];
  occurrences: PlannedOccurrence[];
  quote: TripQuote;
  issues: WeeklyRequestPreview["issues"];
  blocking: boolean;
  tariff: ApprovedTariff | null;
};

function addMinutesToHhmm(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function validateWeeklyBody(body: WeeklyRequestBody, series: SeriesRow, now: Date): {
  legs: TripLeg[]; weekdays: Weekday[]; weeks: number; exceptions: IsoDate[]; endDate: IsoDate;
} {
  if (!isIsoDate(body.startDate)) throw err("WEEKLY_START_DATE_IN_PAST", 422, "La fecha de inicio no es válida.");
  const today = localDateOf(now);
  if (body.startDate < today) throw err("WEEKLY_START_DATE_IN_PAST", 422, "La fecha de inicio no puede estar en el pasado.");
  const weeks = body.weeks ?? 1;
  const weekdays = sortWeekdays([...new Set(body.weekdays)]);
  const notOffered = weekdays.filter(day => !series.weekdays.includes(day));
  if (weekdays.length === 0 || notOffered.length > 0) {
    throw err("WEEKLY_WEEKDAY_NOT_OFFERED", 422, "El conductor no circula alguno de los días elegidos.", { weekdays: notOffered });
  }
  const legs = [...new Set(body.legs ?? ["outbound"])].sort((a, b) => (a === b ? 0 : a === "outbound" ? -1 : 1)) as TripLeg[];
  if (legs.includes("return") && !(series.return_local && series.return_template)) {
    throw err("SERIES_HAS_NO_RETURN", 409, "Este conductor no ofrece vuelta en esta ruta.");
  }
  if (body.cancellationPolicyVersion !== undefined && body.cancellationPolicyVersion !== null &&
      !POLICY_VERSION.test(body.cancellationPolicyVersion)) {
    throw err("INVALID_CANCELLATION_POLICY_VERSION", 422, "La versión de la política de cancelación no es válida.");
  }
  const exceptions = [...new Set(body.exceptionDates ?? [])].sort();
  for (const date of exceptions) {
    if (!isIsoDate(date)) throw err("WEEKLY_NO_OCCURRENCES", 422, "Una de las fechas de excepción no es válida.", { date });
  }
  const endDate = addDays(body.startDate, weeks * 7 - 1);
  if (endDate > addDays(today, 90)) {
    throw err("WEEKLY_NO_OCCURRENCES", 422, "Solo se puede reservar con hasta 90 días de antelación.");
  }
  return { legs, weekdays, weeks, exceptions, endDate };
}

/**
 * Calcula (sin escribir) las ocurrencias de una reserva semanal. Con `lock`, bloquea los viajes-ocurrencia en orden
 * `(departure_at, id)` antes de contar plazas (evita interbloqueos y garantiza la última plaza en concurrencia).
 */
export async function planWeekly(
  db: Db & Pick<PoolClient, "query">,
  passengerUserId: string,
  anchorTripId: string,
  body: WeeklyRequestBody,
  options: { lock: boolean; now?: Date }
): Promise<WeeklyPlan> {
  const now = options.now ?? new Date();
  const anchor = (await loadTrips(db, [anchorTripId])).get(anchorTripId);
  if (!anchor || anchor.status === "draft" || anchor.status === "cancelled") throw err("TRIP_NOT_FOUND", 404, "El viaje no existe.");
  if (!anchor.series_id) throw err("TRIP_NOT_RECURRING", 409, "Este viaje no es periódico.");
  if (anchor.driver_user_id === passengerUserId) {
    throw err("DRIVER_CANNOT_REQUEST_OWN_TRIP", 409, "No puedes solicitar plaza en tu propio viaje.");
  }
  const seriesRow = (await db.query<SeriesRow>(`${SERIES_SELECT} where id = $1`, [anchor.series_id])).rows[0];
  if (!seriesRow) throw err("TRIP_NOT_RECURRING", 409, "Este viaje no es periódico.");
  const series = normalizeSeries(seriesRow);
  if (series.frequency !== "daily_workdays") throw err("TRIP_NOT_RECURRING", 409, "Este viaje no es periódico.");
  if (series.status !== "active" || !anchor.vehicle_bookable) throw err("TRIP_NOT_BOOKABLE", 409, "Esta ruta ya no admite reservas.");
  if (anchor.leg !== "outbound") throw err("TRIP_NOT_RECURRING", 409, "Elige la ocurrencia de ida para reservar de forma semanal.");

  const checked = validateWeeklyBody(body, series, now);

  const [stopsMap, loadsMap] = await inParallel(db, [() => loadStops(db, [anchor.id]), () => loadSegmentLoads(db, [anchor.id])]);
  const stopsA = stopsMap.get(anchor.id) ?? [];
  const segmentsA = loadsMap.get(anchor.id) ?? [];
  const pickup = await resolvePickupPointId(db, anchor, stopsA, segmentsA, body.pickupPointId);
  const dropoff = resolveDropoff(stopsA, body.dropoffStopSeq, pickup);
  const n = stopsA.length;
  const outFrom = pickup.segmentSeq;
  const outTo = dropoff.seq;
  const retFrom = n - 1 - outTo;
  const retTo = n - 1 - pickup.segmentSeq;
  const distancesA = stopDistances(stopsA, segmentsA);
  const outRoadM = Math.max(0, (distancesA[outTo] ?? 0) - pickup.distanceFromStartM);

  // Ocurrencias existentes en el rango pedido.
  const trips = await db.query<{ id: string; leg: TripLeg; service_date: string; departure_at: Date; status: string }>(
    `select id, leg, service_date::text as service_date, departure_at, status
       from trips where series_id = $1 and service_date between $2::date and $3::date and leg = any($4::trip_leg[])
      order by departure_at, id`,
    [series.id, body.startDate, checked.endDate, checked.legs]
  );
  const tripByKey = new Map(trips.rows.map(row => [`${row.service_date}|${row.leg}`, row]));
  if (options.lock && trips.rows.length > 0) {
    await db.query(`select id from trips where id = any($1::uuid[]) order by departure_at, id for update`, [trips.rows.map(row => row.id)]);
  }
  const occTripIds = trips.rows.map(row => row.id);
  const occTrips = await loadTrips(db, occTripIds);
  const [occStops, occLoads] = await inParallel(db, [() => loadStops(db, occTripIds), () => loadSegmentLoads(db, occTripIds)]);
  const openRequests = occTripIds.length === 0 ? [] : (await db.query<{ trip_id: string; id: string; status: RideRequestStatus }>(
    `select trip_id, id, status from ride_requests
      where passenger_user_id = $1 and trip_id = any($2::uuid[]) and status = any($3::request_status[])`,
    [passengerUserId, occTripIds, OPEN]
  )).rows;
  const openByTrip = new Map(openRequests.map(row => [row.trip_id, row]));

  const today = localDateOf(now);
  const occurrences: PlannedOccurrence[] = [];
  const issues: WeeklyRequestPreview["issues"] = [];
  let blocking = false;
  for (let i = 0; i < checked.weeks * 7; i += 1) {
    const date = addDays(body.startDate, i);
    const weekday = weekdayOfDate(date);
    if (!checked.weekdays.includes(weekday)) continue;
    for (const leg of checked.legs) {
      const base: WeeklyOccurrence = {
        date, weekday, leg, tripId: null, boardsAtLocal: null, arrivesAtLocal: null, state: "available",
        seatsAvailable: null, requestId: null, requestStatus: null
      };
      const planned: PlannedOccurrence = { view: base, trip: null, from: 0, to: 0, boardOffsetS: 0, roadDistanceM: 0, boardStop: null };
      const skip = (state: WeeklyOccurrenceState): void => {
        planned.view = { ...base, state };
      };
      if (checked.exceptions.includes(date)) { skip("skipped_exception"); occurrences.push(planned); continue; }
      if (date < today) { skip("skipped_past"); occurrences.push(planned); continue; }
      const row = tripByKey.get(`${date}|${leg}`);
      const trip = row ? occTrips.get(row.id) : undefined;
      if (!row || !trip || trip.status !== "published" || !trip.vehicle_bookable) {
        skip("skipped_no_occurrence");
        issues.push({ code: "WEEKLY_NO_OCCURRENCE", message: `El ${spanishDay(date)} no hay viaje disponible.`, date });
        occurrences.push(planned);
        continue;
      }
      if (row.departure_at.getTime() <= now.getTime()) { skip("skipped_past"); occurrences.push(planned); continue; }
      const stops = occStops.get(trip.id) ?? [];
      const segments: SegmentLoad[] = occLoads.get(trip.id) ?? [];
      const from = leg === "outbound" ? outFrom : retFrom;
      const to = leg === "outbound" ? outTo : retTo;
      const offsets = stopOffsets(stops, segments);
      const distances = stopDistances(stops, segments);
      const boardOffsetS = leg === "outbound" ? pickup.offsetS : (offsets[from] ?? 0);
      const boards = new Date(row.departure_at.getTime() + boardOffsetS * 1000);
      const arrives = new Date(row.departure_at.getTime() + (offsets[to] ?? 0) * 1000);
      const free = freeSeatsInRange(segments, from, to);
      const open = openByTrip.get(trip.id);
      const view: WeeklyOccurrence = {
        ...base, tripId: trip.id, boardsAtLocal: localTimeOf(boards), arrivesAtLocal: localTimeOf(arrives),
        seatsAvailable: free, state: "available"
      };
      if (open) {
        view.state = "requested";
        view.requestId = open.id;
        view.requestStatus = open.status === "accepted" ? "payment_pending" : open.status;
        issues.push({ code: "DUPLICATE_OPEN_REQUEST", message: `Ya tienes una solicitud abierta el ${spanishDay(date)}.`, date });
        blocking = true;
      } else if (free <= 0) {
        view.state = "skipped_full";
        issues.push({ code: "WEEKLY_OCCURRENCE_UNAVAILABLE", message: `El ${spanishDay(date)} no quedan plazas en ese tramo.`, date });
        blocking = true;
      }
      occurrences.push({
        view, trip, from, to, boardOffsetS,
        roadDistanceM: Math.max(0, (distances[to] ?? 0) - (leg === "outbound" ? pickup.distanceFromStartM : (distances[from] ?? 0))),
        boardStop: stops[from] ?? null
      });
    }
  }

  // Resumen de tramos (usa la plantilla: «Ida (mañana)» 08:20 → 08:28).
  const outTemplateOffsets = cumulative(series.outbound_template.segments.map(s => s.durationS));
  const outBoards = addMinutesToHhmm(series.outbound_local, minutesFromSeconds(pickup.offsetS));
  const outArrives = addMinutesToHhmm(series.outbound_local, minutesFromSeconds(outTemplateOffsets[outTo] ?? 0));
  const legs: WeeklyLegSummary[] = [];
  const tail = stopsA[outFrom];
  for (const leg of checked.legs) {
    if (leg === "outbound") {
      legs.push({
        leg, label: "Ida (mañana)", fromLabel: pickup.label ?? tail?.label ?? null,
        toLabel: stopsA[outTo]?.label ?? null, boardsAtLocal: outBoards, arrivesAtLocal: outArrives
      });
    } else if (series.return_local && series.return_template) {
      const retOffsets = cumulative(series.return_template.segments.map(s => s.durationS));
      legs.push({
        leg, label: "Vuelta (tarde)", fromLabel: stopsA[outTo]?.label ?? null, toLabel: stopsA[outFrom]?.label ?? null,
        boardsAtLocal: addMinutesToHhmm(series.return_local, minutesFromSeconds(retOffsets[retFrom] ?? 0)),
        arrivesAtLocal: addMinutesToHhmm(series.return_local, minutesFromSeconds(retOffsets[retTo] ?? 0))
      });
    }
  }

  const retRoad = checked.legs.includes("return")
    ? occurrences.find(item => item.view.leg === "return" && item.trip)?.roadDistanceM ??
      returnRoadFromTemplate(series, retFrom, retTo)
    : null;
  const tariff = await loadApprovedTariff(db);
  const quote = computeWeeklyQuote(tariff, { outboundM: outRoadM, returnM: retRoad }, checked.weekdays);
  return {
    anchor, series, legsRequested: checked.legs, weekdays: checked.weekdays, startDate: body.startDate, endDate: checked.endDate,
    weeks: checked.weeks, exceptionDates: checked.exceptions,
    pickup: {
      lat: pickup.location.lat, lng: pickup.location.lng, label: pickup.label ?? tail?.label ?? null, address: null,
      source: pickup.source, stopSeq: pickup.stopSeq, walkMinutes: pickup.walkMinutes, detourMinutes: pickup.detourMinutes
    },
    dropoffStopSeq: outTo, legs, occurrences, quote, issues, blocking, tariff
  };
}

function cumulative(values: readonly number[]): number[] {
  const out: number[] = [0];
  for (const value of values) out.push((out[out.length - 1] ?? 0) + value);
  return out;
}

function returnRoadFromTemplate(series: SeriesRow, from: number, to: number): number {
  const segments = series.return_template?.segments ?? [];
  return segments.slice(from, to).reduce((sum, segment) => sum + segment.distanceM, 0);
}

/* ───────────────────────────── Vista previa ───────────────────────────── */

export async function previewWeekly(
  pool: Pool, principal: AuthPrincipal, anchorTripId: string, body: WeeklyRequestBody, now = new Date()
): Promise<WeeklyRequestPreview> {
  await prepareSeries(pool, anchorTripId, body, now);
  const plan = await planWeekly(pool, principal.userId, anchorTripId, body, { lock: false, now });
  const available = plan.occurrences.filter(item => item.view.state === "available").length;
  return {
    tripId: anchorTripId,
    seriesId: plan.series.id,
    legs: plan.legs,
    occurrences: plan.occurrences.map(item => item.view),
    quote: plan.quote,
    canSubmit: available > 0 && (body.allowPartial === true || !plan.blocking),
    issues: plan.issues
  };
}

/** Garantiza que las ocurrencias del rango pedido existen (la ventana móvil de 28 días se amplía bajo demanda). */
async function prepareSeries(pool: Pool, anchorTripId: string, body: WeeklyRequestBody, now: Date): Promise<void> {
  const anchor = await pool.query<{ series_id: string | null; status: string }>(`select series_id, status from trips where id = $1`, [anchorTripId]);
  const row = anchor.rows[0];
  if (!row || row.status === "draft" || row.status === "cancelled") throw err("TRIP_NOT_FOUND", 404, "El viaje no existe.");
  if (!row.series_id) throw err("TRIP_NOT_RECURRING", 409, "Este viaje no es periódico.");
  if (!isIsoDate(body.startDate)) throw err("WEEKLY_START_DATE_IN_PAST", 422, "La fecha de inicio no es válida.");
  const endDate = addDays(body.startDate, (body.weeks ?? 1) * 7 - 1);
  if (endDate > addDays(localDateOf(now), 90)) throw err("WEEKLY_NO_OCCURRENCES", 422, "Solo se puede reservar con hasta 90 días de antelación.");
  const needed = endDate > horizonDate(now) ? endDate : null;
  if (needed) await tx(pool, client => materializeSeries(client, row.series_id!, needed, now));
}

/* ───────────────────────────── Crear ───────────────────────────── */

export async function createWeeklyReservation(
  pool: Pool, principal: AuthPrincipal, anchorTripId: string, body: WeeklyRequestBody, idempotencyKey: string | undefined
) {
  if (!principal.roles.includes("passenger")) throw err("AUTH_FORBIDDEN", 403, "Necesitas el rol de pasajero para reservar plazas.");
  await prepareSeries(pool, anchorTripId, body, new Date());
  return withIdempotency(
    pool,
    { userId: principal.userId, scope: `weekly:${anchorTripId}`, key: idempotencyKey, fingerprintOf: body },
    async client => {
      const now = new Date();
      const plan = await planWeekly(client, principal.userId, anchorTripId, body, { lock: true, now });
      const available = plan.occurrences.filter(item => item.view.state === "available");
      const unavailable = plan.issues.filter(issue => issue.code === "WEEKLY_OCCURRENCE_UNAVAILABLE" || issue.code === "DUPLICATE_OPEN_REQUEST");
      if (!body.allowPartial && plan.blocking) {
        throw err("WEEKLY_OCCURRENCE_UNAVAILABLE", 409, "Alguno de los días elegidos ya no tiene plaza.", {
          dates: unavailable.map(issue => issue.date)
        });
      }
      if (available.length === 0) throw err("WEEKLY_NO_OCCURRENCES", 422, "No hay ningún día disponible con esos criterios.");

      const message = normalizeMessage(body.message);
      const created = await client.query<{ id: string; created_at: Date }>(
        `insert into weekly_reservations(
           series_id, passenger_user_id, driver_user_id, weekdays, legs, start_date, weeks, exception_dates,
           cancellation_policy_version, pickup_geom, pickup_label, pickup_address, pickup_source, pickup_stop_seq,
           dropoff_stop_seq, message
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,ST_SetSRID(ST_Point($11,$10),4326),$12,$13,$14,$15,$16,$17)
         returning id, created_at`,
        [
          plan.series.id, principal.userId, plan.series.driver_user_id, plan.weekdays, plan.legsRequested, plan.startDate,
          plan.weeks, plan.exceptionDates, body.cancellationPolicyVersion ?? null, plan.pickup.lat, plan.pickup.lng,
          plan.pickup.label, plan.pickup.address, plan.pickup.source, plan.pickup.stopSeq, plan.dropoffStopSeq, message
        ]
      );
      const reservationId = created.rows[0]!.id;
      for (const item of available) {
        if (!item.trip) continue;
        const row = await insertRideRequestInTx(
          client,
          { tripId: item.trip.id, passengerUserId: principal.userId, fromSegmentSeq: item.from, toSegmentSeq: item.to },
          {
            pickup: item.view.leg === "outbound"
              ? {
                  lat: plan.pickup.lat, lng: plan.pickup.lng, label: plan.pickup.label, address: plan.pickup.address,
                  source: plan.pickup.source, offsetS: item.boardOffsetS, walkMinutes: plan.pickup.walkMinutes,
                  detourMinutes: plan.pickup.detourMinutes
                }
              : item.boardStop
                ? {
                    lat: item.boardStop.lat, lng: item.boardStop.lng, label: item.boardStop.label, address: null,
                    source: "driver_stop", offsetS: item.boardOffsetS, walkMinutes: null, detourMinutes: item.boardStop.detour_minutes ?? 0
                  }
                : null,
            dropoffStopSeq: item.to,
            roadDistanceM: item.roadDistanceM,
            message,
            weeklyReservationId: reservationId
          }
        );
        await lockQuoteForRequest(client, { requestId: row.id, tariff: plan.tariff, roadDistanceM: item.roadDistanceM });
        item.view.requestId = row.id;
      }
      await writeAudit(client, {
        actorUserId: principal.userId, action: "weekly_request.created", entityType: "weekly_reservation", entityId: reservationId,
        metadata: { seriesId: plan.series.id, occurrences: available.length, weeks: plan.weeks, legs: plan.legsRequested }
      });
      const people = await loadPublicUsers(client, [principal.userId]);
      await notify(client, {
        userId: plan.series.driver_user_id,
        category: "trip",
        kind: "weekly_request_received",
        title: "Nueva reserva semanal",
        body: `${people.get(principal.userId)?.firstName ?? "Un pasajero"} quiere reservar plaza ${available.length} ${available.length === 1 ? "día" : "días"} en tu ruta.`,
        data: { reservationId, tripId: anchorTripId }
      });
      const reservation = await buildWeeklyReservation(client, reservationId, now);
      // `allowPartial`: los días omitidos por falta de plaza se devuelven con `state: "skipped_full"` (la lectura posterior de la
      // reserva solo lista las solicitudes creadas, que son lo único que existe en base de datos).
      const omitted = plan.occurrences.filter(item => item.view.state === "skipped_full").map(item => item.view);
      if (omitted.length > 0) {
        reservation.occurrences = [...reservation.occurrences, ...omitted].sort(
          (a, b) => (a.date === b.date ? (a.leg === b.leg ? 0 : a.leg === "outbound" ? -1 : 1) : a.date < b.date ? -1 : 1)
        );
      }
      return { status: 201, body: reservation };
    }
  );
}

/* ───────────────────────────── Lectura ───────────────────────────── */

type ReservationRow = {
  id: string;
  series_id: string;
  passenger_user_id: string;
  driver_user_id: string;
  weekdays: Weekday[];
  legs: TripLeg[];
  start_date: string;
  weeks: number;
  exception_dates: string[];
  cancellation_policy_version: string | null;
  pickup_label: string | null;
  pickup_stop_seq: number | null;
  dropoff_stop_seq: number;
  created_at: Date;
};

type OccurrenceRow = {
  request_id: string;
  trip_id: string;
  status: RideRequestStatus;
  leg: TripLeg;
  service_date: string;
  departure_at: Date;
  pickup_offset_s: number | null;
  road_distance_m: number | null;
  from_segment_seq: number;
  to_segment_seq: number;
  hold_status: string | null;
  hold_expires_at: Date | null;
  category: string;
};

function aggregateStatus(statuses: readonly RideRequestStatus[]): WeeklyReservation["status"] {
  const normalized = statuses.map(status => (status === "accepted" ? "payment_pending" : status));
  const open = normalized.filter(status => status === "pending" || status === "payment_pending" || status === "confirmed");
  if (open.length === 0) {
    if (normalized.length > 0 && normalized.every(status => status === "rejected")) return "rejected";
    if (normalized.some(status => status === "expired" || status === "payment_late")) return "expired";
    return "cancelled";
  }
  const confirmed = open.filter(status => status === "confirmed").length;
  if (confirmed === open.length) return "confirmed";
  if (confirmed > 0) return "partially_confirmed";
  if (open.some(status => status === "payment_pending")) return "payment_pending";
  return "pending";
}

export async function loadWeeklyReservation(pool: Pool, reservationId: string, viewerUserId: string, now = new Date()): Promise<WeeklyReservation> {
  const requests = await pool.query<{ id: string }>(`select id from ride_requests where weekly_reservation_id = $1`, [reservationId]);
  await expireIfDue(pool, requests.rows.map(row => row.id));
  const header = await pool.query<ReservationRow>(
    `select id, series_id, passenger_user_id, driver_user_id, weekdays, legs, start_date::text as start_date, weeks,
            exception_dates::text[] as exception_dates, cancellation_policy_version, pickup_label, pickup_stop_seq,
            dropoff_stop_seq, created_at
       from weekly_reservations where id = $1`,
    [reservationId]
  );
  const row = header.rows[0];
  if (!row || (row.passenger_user_id !== viewerUserId && row.driver_user_id !== viewerUserId)) {
    throw err("WEEKLY_RESERVATION_NOT_FOUND", 404, "La reserva semanal no existe.");
  }
  return buildWeeklyReservation(pool, reservationId, now);
}

export async function buildWeeklyReservation(db: Db, reservationId: string, now: Date): Promise<WeeklyReservation> {
  const header = (await db.query<ReservationRow>(
    `select id, series_id, passenger_user_id, driver_user_id, weekdays, legs, start_date::text as start_date, weeks,
            exception_dates::text[] as exception_dates, cancellation_policy_version, pickup_label, pickup_stop_seq,
            dropoff_stop_seq, created_at
       from weekly_reservations where id = $1`,
    [reservationId]
  )).rows[0]!;
  const seriesRow = (await db.query<SeriesRow>(`${SERIES_SELECT} where id = $1`, [header.series_id])).rows[0]!;
  const series = normalizeSeries(seriesRow);
  const occ = await db.query<OccurrenceRow>(
    `select r.id as request_id, r.trip_id, r.status, t.leg, t.service_date::text as service_date, t.departure_at,
            r.pickup_offset_s, r.road_distance_m, r.from_segment_seq, r.to_segment_seq,
            h.status as hold_status, h.expires_at as hold_expires_at, t.category
       from ride_requests r join trips t on t.id = r.trip_id
       left join seat_holds h on h.request_id = r.id
      where r.weekly_reservation_id = $1
      order by t.departure_at, r.id`,
    [reservationId]
  );
  const tripIds = [...new Set(occ.rows.map(row => row.trip_id))];
  const [stopsMap, loadsMap, people, tariff] = await inParallel(db, [
    () => loadStops(db, tripIds), () => loadSegmentLoads(db, tripIds),
    () => loadPublicUsers(db, [header.passenger_user_id, header.driver_user_id]), () => loadApprovedTariff(db)
  ]);
  const occurrences: WeeklyOccurrence[] = occ.rows.map(row => {
    const stops = stopsMap.get(row.trip_id) ?? [];
    const offsets = stopOffsets(stops, loadsMap.get(row.trip_id) ?? []);
    const boards = new Date(row.departure_at.getTime() + (row.pickup_offset_s ?? offsets[row.from_segment_seq] ?? 0) * 1000);
    const arrives = new Date(row.departure_at.getTime() + (offsets[row.to_segment_seq] ?? 0) * 1000);
    return {
      date: row.service_date, weekday: weekdayOfDate(row.service_date), leg: row.leg, tripId: row.trip_id,
      boardsAtLocal: localTimeOf(boards), arrivesAtLocal: localTimeOf(arrives), state: "requested", seatsAvailable: null,
      requestId: row.request_id, requestStatus: row.status === "accepted" ? "payment_pending" : row.status
    };
  });
  const statuses = occ.rows.map(row => row.status);
  const status = aggregateStatus(statuses);
  const activeHolds = occ.rows.filter(
    row => (row.status === "payment_pending" || row.status === "accepted") && row.hold_status === "active" && row.hold_expires_at
  );
  const minHold = activeHolds.length > 0
    ? activeHolds.map(row => row.hold_expires_at!).reduce((a, b) => (a.getTime() <= b.getTime() ? a : b))
    : null;
  const hold: RequestHold | null = minHold
    ? buildHold("payment_pending", { status: "active", expires_at: minHold }, now)
    : null;

  const firstOut = occ.rows.find(row => row.leg === "outbound");
  const firstRet = occ.rows.find(row => row.leg === "return");
  const outRoad = firstOut?.road_distance_m ?? 0;
  const retRoad = firstRet ? firstRet.road_distance_m ?? 0 : null;
  const quote = computeWeeklyQuote(tariff, { outboundM: outRoad, returnM: header.legs.includes("return") ? retRoad : null }, sortWeekdays(header.weekdays));

  // Etiquetas de tramos: ida desde la parada/punto elegido hasta la bajada; vuelta en sentido contrario.
  const anchorTrip = firstOut ?? occ.rows[0];
  const anchorStops = anchorTrip ? (stopsMap.get(anchorTrip.trip_id) ?? []) : [];
  const outFromSeq = firstOut?.from_segment_seq ?? 0;
  const legs: WeeklyLegSummary[] = [];
  for (const leg of header.legs) {
    const sample = leg === "outbound" ? firstOut : firstRet;
    const stops = sample ? stopsMap.get(sample.trip_id) ?? [] : [];
    const times = occurrences.find(o => o.leg === leg);
    legs.push({
      leg,
      label: leg === "outbound" ? "Ida (mañana)" : "Vuelta (tarde)",
      fromLabel: leg === "outbound" ? header.pickup_label ?? stops[outFromSeq]?.label ?? null : stops[sample?.from_segment_seq ?? 0]?.label ?? null,
      toLabel: stops[sample?.to_segment_seq ?? 0]?.label ?? (leg === "outbound" ? anchorStops[header.dropoff_stop_seq]?.label ?? null : null),
      boardsAtLocal: times?.boardsAtLocal ?? (leg === "outbound" ? series.outbound_local : series.return_local ?? series.outbound_local),
      arrivesAtLocal: times?.arrivesAtLocal ?? (leg === "outbound" ? series.outbound_local : series.return_local ?? series.outbound_local)
    });
  }
  const nextAction = status === "confirmed"
    ? buildNextAction("confirmed", null)
    : status === "payment_pending" || status === "partially_confirmed"
      ? buildNextAction("payment_pending", minHold)
      : status === "pending"
        ? buildNextAction("pending", null)
        : buildNextAction("cancelled", null);
  return {
    id: header.id,
    seriesId: header.series_id,
    status,
    passenger: publicUserOrUnknown(people, header.passenger_user_id),
    driver: publicUserOrUnknown(people, header.driver_user_id),
    category: series.category,
    weekdays: sortWeekdays(header.weekdays),
    legs,
    startDate: header.start_date,
    weeks: header.weeks,
    exceptionDates: header.exception_dates,
    cancellationPolicyVersion: header.cancellation_policy_version,
    occurrences,
    hold,
    quote,
    nextAction,
    createdAt: iso(header.created_at)
  };
}

/* ───────────────────────────── Decisión del conductor ───────────────────────────── */

export async function decideWeekly(
  pool: Pool, principal: AuthPrincipal, reservationId: string, decision: "accept" | "reject"
): Promise<DecideRequestResponse> {
  if (!principal.roles.includes("driver")) throw err("AUTH_FORBIDDEN", 403, "Necesitas el rol de conductor.");
  const ids = await pool.query<{ id: string }>(`select id from ride_requests where weekly_reservation_id = $1`, [reservationId]);
  await expireIfDue(pool, ids.rows.map(row => row.id));
  const ttl = tripsSettings().holdTtlSeconds;
  const tariff = await loadApprovedTariff(pool);
  return tx(pool, async client => {
    const reservation = (await client.query<{ id: string; passenger_user_id: string; driver_user_id: string }>(
      `select id, passenger_user_id, driver_user_id from weekly_reservations where id = $1 for update`, [reservationId]
    )).rows[0];
    if (!reservation || reservation.driver_user_id !== principal.userId) {
      throw err("WEEKLY_RESERVATION_NOT_FOUND", 404, "La reserva semanal no existe.");
    }
    const pending = await client.query<{
      id: string; trip_id: string; from_segment_seq: number; to_segment_seq: number; road_distance_m: number | null;
      service_date: string; departure_at: Date; trip_status: string;
    }>(
      `select r.id, r.trip_id, r.from_segment_seq, r.to_segment_seq, r.road_distance_m, t.service_date::text as service_date,
              t.departure_at, t.status as trip_status
         from ride_requests r join trips t on t.id = r.trip_id
        where r.weekly_reservation_id = $1 and r.status = 'pending'
        order by t.departure_at, r.id`,
      [reservationId]
    );
    if (pending.rows.length === 0) throw err("REQUEST_NOT_PENDING", 409, "No quedan solicitudes pendientes en esta reserva.");
    // Bloqueo de viajes en orden (departure_at, id) y de solicitudes antes de contar plazas.
    await client.query(`select id from trips where id = any($1::uuid[]) order by departure_at, id for update`, [pending.rows.map(row => row.trip_id)]);
    await client.query(`select id from ride_requests where id = any($1::uuid[]) order by id for update`, [pending.rows.map(row => row.id)]);

    const requestIds = pending.rows.map(row => row.id);
    if (decision === "reject") {
      for (const row of pending.rows) await rejectRequestInTx(client, row.id, principal.userId);
    } else {
      const loads = await loadSegmentLoads(client, [...new Set(pending.rows.map(row => row.trip_id))]);
      const lacking = pending.rows.filter(row =>
        !["published", "active"].includes(row.trip_status) ||
        freeSeatsInRange(loads.get(row.trip_id) ?? [], row.from_segment_seq, row.to_segment_seq) <= 0
      );
      if (lacking.length > 0) {
        throw err("NO_CAPACITY_ON_SEGMENT", 409, "Alguno de los días ya no tiene plaza: no se ha aceptado nada.", {
          dates: lacking.map(row => row.service_date)
        });
      }
      const expiresAt = new Date(Date.now() + ttl * 1000);
      for (const row of pending.rows) {
        await acceptRequestInTx(client, row, principal.userId, ttl, expiresAt);
        await lockQuoteForRequest(client, { requestId: row.id, tariff, roadDistanceM: row.road_distance_m ?? 0 });
      }
    }
    await writeAudit(client, {
      actorUserId: principal.userId, action: "weekly_request.decided", entityType: "weekly_reservation", entityId: reservationId,
      metadata: { decision, requests: requestIds.length }
    });
    const people = await loadPublicUsers(client, [principal.userId]);
    const driverName = people.get(principal.userId)?.firstName ?? "El conductor";
    await notify(client, {
      userId: reservation.passenger_user_id,
      category: "trip",
      kind: decision === "accept" ? "request_accepted" : "request_rejected",
      title: decision === "accept" ? "Reserva semanal aceptada" : "Reserva semanal rechazada",
      body: decision === "accept"
        ? `${driverName} ha aceptado tu reserva semanal. Completa el pago antes de que acabe el tiempo para asegurar tus plazas.`
        : `${driverName} no ha podido aceptar tu reserva semanal. Prueba con otro viaje.`,
      data: { reservationId }
    });
    const holdRow = decision === "accept"
      ? (await client.query<{ expires_at: Date }>(
          `select min(h.expires_at) as expires_at from seat_holds h join ride_requests r on r.id = h.request_id
            where r.weekly_reservation_id = $1 and h.status = 'active'`, [reservationId]
        )).rows[0]
      : undefined;
    return {
      id: reservationId,
      kind: "weekly" as const,
      status: decision === "accept" ? "payment_pending" as const : "rejected" as const,
      hold: decision === "accept" && holdRow?.expires_at ? { id: null, expiresAt: iso(holdRow.expires_at) } : null,
      requestIds
    };
  });
}

/* ───────────────────────────── Retirada ───────────────────────────── */

/** Retira las solicitudes `pending` de una reserva semanal (todas, o solo las de un rango de fechas). */
export async function withdrawPendingInReservation(
  client: PoolClient, reservationId: string, actorUserId: string, range?: { from: IsoDate; to: IsoDate }
): Promise<string[]> {
  const pending = await client.query<{ id: string }>(
    `select r.id from ride_requests r join trips t on t.id = r.trip_id
      where r.weekly_reservation_id = $1 and r.status = 'pending'
        and ($2::date is null or t.service_date between $2::date and $3::date)
      order by r.id for update of r`,
    [reservationId, range?.from ?? null, range?.to ?? null]
  );
  for (const row of pending.rows) {
    await client.query(`update ride_requests set status = 'cancelled', updated_at = now() where id = $1`, [row.id]);
    await writeAudit(client, { actorUserId, action: "ride_request.withdrawn", entityType: "ride_request", entityId: row.id, metadata: { reservationId } });
  }
  return pending.rows.map(row => row.id);
}

export async function withdrawWeekly(pool: Pool, principal: AuthPrincipal, reservationId: string): Promise<WeeklyReservation> {
  await tx(pool, async client => {
    const reservation = (await client.query<{ passenger_user_id: string; driver_user_id: string }>(
      `select passenger_user_id, driver_user_id from weekly_reservations where id = $1 for update`, [reservationId]
    )).rows[0];
    if (!reservation || reservation.passenger_user_id !== principal.userId) {
      throw err("WEEKLY_RESERVATION_NOT_FOUND", 404, "La reserva semanal no existe.");
    }
    const withdrawn = await withdrawPendingInReservation(client, reservationId, principal.userId);
    if (withdrawn.length === 0) {
      throw err("REQUEST_NOT_WITHDRAWABLE", 409, "No queda ninguna solicitud pendiente que retirar.");
    }
    const people = await loadPublicUsers(client, [principal.userId]);
    await notify(client, {
      userId: reservation.driver_user_id,
      category: "trip",
      kind: "request_withdrawn",
      title: "Reserva semanal retirada",
      body: `${people.get(principal.userId)?.firstName ?? "El pasajero"} ha retirado su reserva semanal.`,
      data: { reservationId }
    });
  });
  return loadWeeklyReservation(pool, reservationId, principal.userId);
}
