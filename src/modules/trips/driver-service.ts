import type { Pool, PoolClient } from "pg";
import type { AuthPrincipal } from "../../auth/session.js";
import { assertVehicleCanDrive } from "../../vehicles/compliance-service.js";
import {
  encodeCursor, iso, localTimeOf, requireRole, vehicleDisplayName, sortWeekdays, type Db
} from "./common.js";
import { err } from "./errors.js";
import { loadPublicUsers, publicUserOrUnknown } from "./public-user.js";
import { expireIfDue } from "./request-detail.js";
import {
  freeSeatsInRange, loadSegmentLoads, loadStops, loadTrips, stopOffsets, type SegmentLoad, type StopRow, type TripRow
} from "./trip-data.js";
import type {
  DriverReadiness, DriverRequestItem, DriverRequestOccupancy, Page, ReadinessItem, ReadinessKey, RideRequestStatus, TripLeg,
  TripCategory, Weekday
} from "./types.js";

/* ───────────────────────────── Requisitos para publicar (pantalla 17) ───────────────────────────── */

type ReviewStatus = "pending" | "approved" | "rejected";

type VehicleReadinessRow = {
  id: string;
  make: string;
  model: string;
  plate: string;
  color: string | null;
  passenger_seats: number;
  review_status: ReviewStatus;
  documentation_status: ReviewStatus;
  vehicle_photo_status: ReviewStatus;
  has_photo_document: boolean;
  insurance_status: ReviewStatus;
  has_insurance_document: boolean;
  insurance_expires_on: string | null;
  has_registration_document: boolean;
};

type ProfileReadinessRow = {
  public_photo_status: ReviewStatus;
  has_public_photo: boolean;
  identity_status: "unverified" | "pending" | "verified" | "rejected";
  license_status: ReviewStatus | null;
};

function reviewState(status: ReviewStatus, hasEvidence: boolean): ReadinessItem["state"] {
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  return hasEvidence ? "in_review" : "missing";
}

const DETAILS: Record<ReadinessKey, Record<ReadinessItem["state"], string | null>> = {
  public_photo: {
    approved: null, in_review: "Foto en revisión", missing: "Añade una foto de perfil", rejected: "Foto rechazada: sube otra", expired: null
  },
  identity: {
    approved: null, in_review: "Verificación en revisión", missing: "Verifica tu identidad", rejected: "Verificación rechazada", expired: null
  },
  vehicle: {
    approved: null, in_review: "Vehículo en revisión", missing: "Añade tu vehículo", rejected: "Vehículo rechazado", expired: null
  },
  vehicle_documents: {
    approved: null, in_review: "Documentación en revisión", missing: "Sube la documentación del vehículo",
    rejected: "Documentación rechazada", expired: null
  },
  vehicle_photo: {
    approved: null, in_review: "Foto en revisión", missing: "Sube una foto del vehículo", rejected: "Foto rechazada: sube otra", expired: null
  },
  insurance: {
    approved: "Documento subido", in_review: "Documento subido", missing: "Sube el seguro del vehículo",
    rejected: "Seguro rechazado: sube otro", expired: "Seguro caducado: sube la renovación"
  },
  driver_license: {
    approved: "Documento subido", in_review: "Documento subido", missing: "Sube tu permiso de conducir",
    rejected: "Documento rechazado", expired: null
  }
};

const LABELS: Record<ReadinessKey, string> = {
  public_photo: "Foto pública",
  identity: "Identidad",
  vehicle: "Vehículo",
  vehicle_documents: "Documentación del vehículo",
  vehicle_photo: "Foto del vehículo",
  insurance: "Seguro (uso particular)",
  driver_license: "Permiso de conducir"
};

/** Misma fecha de referencia que `assertVehicleCanDrive` (día UTC): la puerta de publicación y esta pantalla coinciden. */
function todayUtc(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Evalúa los requisitos para publicar con el vehículo indicado (o el más reciente del conductor).
 * Refleja lo que exige hoy `publishTrip` + `assertVehicleCanDrive`; el permiso de conducir se informa pero no bloquea.
 */
export async function evaluateReadiness(db: Db, userId: string, vehicleId: string | null, now = new Date()): Promise<DriverReadiness> {
  const profile = (await db.query<ProfileReadinessRow>(
    `select p.public_photo_status, (p.public_photo_key is not null) as has_public_photo, p.identity_status,
            (select d.review_status from private_documents d
              where d.owner_user_id = p.user_id and d.kind = 'driver_license'
              order by d.created_at desc, d.id desc limit 1) as license_status
       from profiles p where p.user_id = $1`,
    [userId]
  )).rows[0];
  const vehicle = (await db.query<VehicleReadinessRow>(
    `select v.id, v.make, v.model, v.plate, v.color, v.passenger_seats, v.review_status, v.documentation_status,
            v.vehicle_photo_status, (v.vehicle_photo_document_id is not null) as has_photo_document,
            v.insurance_status, (v.insurance_document_id is not null) as has_insurance_document,
            v.insurance_expires_on::text as insurance_expires_on,
            exists(select 1 from private_documents d where d.vehicle_id = v.id and d.kind = 'vehicle_registration') as has_registration_document
       from vehicles v
      where v.driver_user_id = $1 and ($2::uuid is null or v.id = $2::uuid)
      order by v.created_at desc, v.id
      limit 1`,
    [userId, vehicleId]
  )).rows[0];

  const items: ReadinessItem[] = [];
  const push = (key: ReadinessKey, state: ReadinessItem["state"], blocking: boolean, expiresOn: string | null = null, detail?: string | null): void => {
    items.push({ key, label: LABELS[key], state, blocking, detail: detail !== undefined ? detail : DETAILS[key][state], expiresOn });
  };

  const photoState = profile ? reviewState(profile.public_photo_status, profile.has_public_photo) : "missing";
  push("public_photo", photoState, true);
  const identityState: ReadinessItem["state"] = !profile ? "missing"
    : profile.identity_status === "verified" ? "approved"
    : profile.identity_status === "pending" ? "in_review"
    : profile.identity_status === "rejected" ? "rejected" : "missing";
  push("identity", identityState, true);

  if (!vehicle) {
    push("vehicle", "missing", true);
    push("vehicle_documents", "missing", true);
    push("vehicle_photo", "missing", true);
    push("insurance", "missing", true);
  } else {
    push("vehicle", reviewState(vehicle.review_status, true), true);
    push("vehicle_documents", reviewState(vehicle.documentation_status, vehicle.has_registration_document), true);
    push("vehicle_photo", reviewState(vehicle.vehicle_photo_status, vehicle.has_photo_document), true);
    let insurance = reviewState(vehicle.insurance_status, vehicle.has_insurance_document);
    let insuranceDetail: string | null | undefined;
    if (insurance === "approved") {
      if (!vehicle.insurance_expires_on) {
        insurance = "in_review";
        insuranceDetail = "Falta verificar la fecha de caducidad del seguro";
      } else if (vehicle.insurance_expires_on < todayUtc(now)) {
        insurance = "expired";
      }
    }
    push("insurance", insurance, true, vehicle.insurance_expires_on, insuranceDetail);
  }
  const license = profile?.license_status ?? null;
  push("driver_license", license ? reviewState(license, true) : "missing", false);

  const blockers = items.filter(item => item.blocking && item.state !== "approved").map(item => item.key);
  return {
    canPublish: blockers.length === 0 && vehicle !== undefined,
    vehicle: vehicle
      ? {
          id: vehicle.id,
          displayName: vehicleDisplayName(vehicle.make, vehicle.model),
          plate: vehicle.plate,
          color: vehicle.color,
          passengerSeats: vehicle.passenger_seats
        }
      : null,
    items,
    blockers
  };
}

export async function driverReadiness(pool: Pool, principal: AuthPrincipal): Promise<DriverReadiness> {
  requireRole(principal, "driver", "Necesitas el rol de conductor para publicar rutas.");
  return evaluateReadiness(pool, principal.userId, null);
}

/** Puerta de publicación: lanza `409 DRIVER_NOT_READY` (con los bloqueos) o devuelve la evaluación. */
export async function assertDriverReady(
  db: Pick<PoolClient, "query">,
  userId: string,
  vehicleId: string
): Promise<DriverReadiness> {
  const readiness = await evaluateReadiness(db, userId, vehicleId);
  if (!readiness.canPublish) {
    throw err("DRIVER_NOT_READY", 409, "Todavía no cumples los requisitos para publicar rutas.", { blockers: readiness.blockers });
  }
  // Defensa en profundidad: la comprobación autoritativa heredada del backend 0.14.
  await assertVehicleCanDrive(db, vehicleId);
  return readiness;
}

/* ───────────────────────────── Bandeja de solicitudes (pantalla 20) ───────────────────────────── */

export type InboxQuery = {
  status: "pending" | "open" | "all";
  tripId: string | null;
  offset: number;
  limit: number;
};

const STATUS_FILTER: Record<InboxQuery["status"], RideRequestStatus[]> = {
  pending: ["pending"],
  open: ["pending", "accepted", "payment_pending"],
  all: ["pending", "accepted", "payment_pending", "confirmed", "rejected", "expired", "cancelled", "payment_late"]
};

type SingleRow = {
  id: string;
  trip_id: string;
  passenger_user_id: string;
  status: RideRequestStatus;
  from_segment_seq: number;
  to_segment_seq: number;
  requested_at: Date;
  message: string | null;
  pickup_label: string | null;
  pickup_offset_s: number | null;
  pickup_detour_minutes: number | null;
  dropoff_stop_seq: number | null;
};

type WeeklyRow = {
  id: string;
  passenger_user_id: string;
  weekdays: Weekday[];
  legs: TripLeg[];
  start_date: string;
  message: string | null;
  created_at: Date;
  pickup_label: string | null;
  dropoff_stop_seq: number;
  first_request_id: string;
  first_trip_id: string;
  first_from: number;
  first_to: number;
  first_pickup_offset_s: number | null;
  first_detour: number | null;
  statuses: RideRequestStatus[];
  total: number;
};

type Entry = {
  sortDeparture: number;
  sortRequested: number;
  id: string;
  build: () => DriverRequestItem;
};

function aggregateInboxStatus(statuses: readonly RideRequestStatus[]): RideRequestStatus {
  if (statuses.includes("pending")) return "pending";
  if (statuses.some(status => status === "payment_pending" || status === "accepted")) return "payment_pending";
  if (statuses.includes("confirmed")) return "confirmed";
  if (statuses.length > 0 && statuses.every(status => status === "rejected")) return "rejected";
  if (statuses.some(status => status === "expired" || status === "payment_late")) return "expired";
  return "cancelled";
}

function occupancyFor(
  segments: readonly SegmentLoad[],
  stops: readonly StopRow[],
  from: number,
  to: number,
  ownSeatCounts: boolean
): DriverRequestOccupancy {
  const perSegment = segments.map(segment => {
    const inRange = segment.seq >= from && segment.seq < to;
    const occupied = Math.max(0, segment.occupied - (inRange && ownSeatCounts ? 1 : 0));
    return {
      seq: segment.seq,
      fromLabel: stops[segment.from_stop_seq]?.label ?? null,
      toLabel: stops[segment.to_stop_seq]?.label ?? null,
      occupied,
      capacity: segment.capacity,
      inRequestedRange: inRange
    };
  });
  const inRange = perSegment.filter(segment => segment.inRequestedRange);
  const worst = inRange.reduce<(typeof inRange)[number] | null>(
    (acc, segment) => (acc === null || segment.occupied > acc.occupied ? segment : acc), null
  );
  return {
    occupiedSeats: worst?.occupied ?? 0,
    totalSeats: inRange.reduce((max, segment) => Math.max(max, segment.capacity), 0),
    perSegment
  };
}

function blockedReasonFor(trip: TripRow, free: number, now: Date): string | null {
  const open = trip.status === "published" || trip.status === "active";
  const departed = trip.status !== "active" && trip.departure_at !== null && trip.departure_at.getTime() < now.getTime() - 5 * 60_000;
  if (!open || !trip.vehicle_bookable || departed) return "TRIP_NOT_BOOKABLE";
  if (free <= 0) return "NO_CAPACITY_ON_SEGMENT";
  return null;
}

/**
 * Bandeja del conductor. Solo solicitudes de SUS viajes. Las reservas semanales aparecen una sola vez
 * (`kind:"weekly"`, `id` = reserva semanal). `occupancy` no cuenta la propia solicitud.
 */
export async function driverRequests(
  pool: Pool,
  principal: AuthPrincipal,
  query: InboxQuery,
  now = new Date()
): Promise<Page<DriverRequestItem>> {
  requireRole(principal, "driver", "Necesitas el rol de conductor para ver solicitudes.");
  const statuses = STATUS_FILTER[query.status];

  // Caduca antes de listar los holds vencidos de los viajes del conductor (no se muestra una aceptación ya caducada).
  if (query.status !== "pending") {
    const overdue = await pool.query<{ id: string }>(
      `select r.id from ride_requests r join trips t on t.id = r.trip_id join seat_holds h on h.request_id = r.id
        where t.driver_user_id = $1 and h.status = 'active' and h.expires_at <= now() and r.status in ('payment_pending','accepted')
        limit 200`,
      [principal.userId]
    );
    await expireIfDue(pool, overdue.rows.map(row => row.id));
  }

  const take = query.offset + query.limit + 1;
  const orderPending = `order by t.departure_at asc nulls last, r.requested_at asc, r.id`;
  const orderAll = `order by r.requested_at desc, r.id`;
  const singles = (await pool.query<SingleRow>(
    `select r.id, r.trip_id, r.passenger_user_id, r.status, r.from_segment_seq, r.to_segment_seq, r.requested_at, r.message,
            r.pickup_label, r.pickup_offset_s, r.pickup_detour_minutes, r.dropoff_stop_seq
       from ride_requests r join trips t on t.id = r.trip_id
      where t.driver_user_id = $1 and r.weekly_reservation_id is null and r.status = any($2::request_status[])
        and ($3::uuid is null or r.trip_id = $3::uuid)
      ${query.status === "all" ? orderAll : orderPending}
      limit $4`,
    [principal.userId, statuses, query.tripId, take]
  )).rows;
  const weeklies = (await pool.query<WeeklyRow>(
    `select w.id, w.passenger_user_id, w.weekdays, w.legs, w.start_date::text as start_date, w.message, w.created_at,
            w.pickup_label, w.dropoff_stop_seq,
            f.request_id as first_request_id, f.trip_id as first_trip_id, f.from_segment_seq as first_from,
            f.to_segment_seq as first_to, f.pickup_offset_s as first_pickup_offset_s, f.pickup_detour_minutes as first_detour,
            agg.statuses, agg.total
       from weekly_reservations w
       cross join lateral (
         select r.id as request_id, r.trip_id, r.from_segment_seq, r.to_segment_seq, r.pickup_offset_s, r.pickup_detour_minutes
           from ride_requests r join trips t on t.id = r.trip_id
          where r.weekly_reservation_id = w.id and r.status = any($2::request_status[])
          order by t.departure_at, r.id
          limit 1
       ) f
       cross join lateral (
         select array_agg(r.status::text) as statuses, count(*)::int as total
           from ride_requests r where r.weekly_reservation_id = w.id
       ) agg
      where w.driver_user_id = $1
        and ($3::uuid is null or exists(select 1 from ride_requests rr where rr.weekly_reservation_id = w.id and rr.trip_id = $3::uuid))
      ${query.status === "all" ? "order by w.created_at desc, w.id" : "order by (select min(t2.departure_at) from ride_requests r2 join trips t2 on t2.id = r2.trip_id where r2.weekly_reservation_id = w.id and r2.status = any($2::request_status[])) asc nulls last, w.created_at asc, w.id"}
      limit $4`,
    [principal.userId, statuses, query.tripId, take]
  )).rows;

  const tripIds = [...new Set([...singles.map(row => row.trip_id), ...weeklies.map(row => row.first_trip_id)])];
  // Solicitudes pendientes de las reservas semanales (para decidir si TODAS se pueden aceptar).
  const pendingByWeekly = weeklies.length === 0 ? [] : (await pool.query<{
    weekly_reservation_id: string; trip_id: string; from_segment_seq: number; to_segment_seq: number;
  }>(
    `select r.weekly_reservation_id, r.trip_id, r.from_segment_seq, r.to_segment_seq
       from ride_requests r where r.weekly_reservation_id = any($1::uuid[]) and r.status = 'pending'`,
    [weeklies.map(row => row.id)]
  )).rows;
  const allTripIds = [...new Set([...tripIds, ...pendingByWeekly.map(row => row.trip_id)])];
  const [trips, stopsMap, loadsMap, people] = await Promise.all([
    loadTrips(pool, allTripIds), loadStops(pool, allTripIds), loadSegmentLoads(pool, allTripIds),
    loadPublicUsers(pool, [...singles.map(row => row.passenger_user_id), ...weeklies.map(row => row.passenger_user_id)])
  ]);

  const entries: Entry[] = [];
  for (const row of singles) {
    const trip = trips.get(row.trip_id);
    if (!trip) continue;
    const stops = stopsMap.get(row.trip_id) ?? [];
    const segments = loadsMap.get(row.trip_id) ?? [];
    const departure = trip.departure_at ?? now;
    entries.push({
      sortDeparture: departure.getTime(),
      sortRequested: row.requested_at.getTime(),
      id: row.id,
      build: () => {
        const offsets = stopOffsets(stops, segments);
        const toSeq = row.dropoff_stop_seq ?? row.to_segment_seq;
        const fromAt = new Date(departure.getTime() + (row.pickup_offset_s ?? offsets[row.from_segment_seq] ?? 0) * 1000);
        const toAt = new Date(departure.getTime() + (offsets[toSeq] ?? 0) * 1000);
        const holdsSeat = row.status === "payment_pending" || row.status === "accepted" || row.status === "confirmed";
        const free = freeSeatsInRange(segments, row.from_segment_seq, row.to_segment_seq) + (holdsSeat ? 1 : 0);
        const blockedReason = row.status === "pending" ? blockedReasonFor(trip, free, now) : null;
        return {
          id: row.id,
          kind: "single" as const,
          status: row.status === "accepted" ? "payment_pending" as const : row.status,
          passenger: publicUserOrUnknown(people, row.passenger_user_id),
          tripId: row.trip_id,
          leg: trip.leg,
          category: trip.category,
          departureAt: iso(departure),
          from: { label: row.pickup_label ?? stops[row.from_segment_seq]?.label ?? null, at: iso(fromAt), atLocal: localTimeOf(fromAt) },
          to: { label: stops[toSeq]?.label ?? null, at: iso(toAt), atLocal: localTimeOf(toAt) },
          detourMinutes: row.pickup_detour_minutes,
          occupancy: occupancyFor(segments, stops, row.from_segment_seq, row.to_segment_seq, holdsSeat),
          message: row.message,
          weekly: null,
          canAccept: row.status === "pending" && blockedReason === null,
          blockedReason,
          requestedAt: iso(row.requested_at)
        };
      }
    });
  }
  for (const row of weeklies) {
    const trip = trips.get(row.first_trip_id);
    if (!trip) continue;
    const stops = stopsMap.get(row.first_trip_id) ?? [];
    const segments = loadsMap.get(row.first_trip_id) ?? [];
    const departure = trip.departure_at ?? now;
    const status = aggregateInboxStatus(row.statuses);
    entries.push({
      sortDeparture: departure.getTime(),
      sortRequested: row.created_at.getTime(),
      id: row.id,
      build: () => {
        const offsets = stopOffsets(stops, segments);
        const fromAt = new Date(departure.getTime() + (row.first_pickup_offset_s ?? offsets[row.first_from] ?? 0) * 1000);
        const toAt = new Date(departure.getTime() + (offsets[row.dropoff_stop_seq] ?? 0) * 1000);
        let blockedReason: string | null = null;
        if (status === "pending") {
          for (const pending of pendingByWeekly.filter(item => item.weekly_reservation_id === row.id)) {
            const pendingTrip = trips.get(pending.trip_id);
            if (!pendingTrip) { blockedReason = "TRIP_NOT_BOOKABLE"; break; }
            const free = freeSeatsInRange(loadsMap.get(pending.trip_id) ?? [], pending.from_segment_seq, pending.to_segment_seq);
            blockedReason = blockedReasonFor(pendingTrip, free, now);
            if (blockedReason) break;
          }
        }
        return {
          id: row.id,
          kind: "weekly" as const,
          status,
          passenger: publicUserOrUnknown(people, row.passenger_user_id),
          tripId: row.first_trip_id,
          leg: trip.leg,
          category: trip.category as TripCategory,
          departureAt: iso(departure),
          from: { label: row.pickup_label ?? stops[row.first_from]?.label ?? null, at: iso(fromAt), atLocal: localTimeOf(fromAt) },
          to: { label: stops[row.dropoff_stop_seq]?.label ?? null, at: iso(toAt), atLocal: localTimeOf(toAt) },
          detourMinutes: row.first_detour,
          occupancy: occupancyFor(segments, stops, row.first_from, row.first_to, false),
          message: row.message,
          weekly: { weekdays: sortWeekdays(row.weekdays), legs: row.legs, occurrences: row.total, startDate: row.start_date },
          canAccept: status === "pending" && blockedReason === null,
          blockedReason,
          requestedAt: iso(row.created_at)
        };
      }
    });
  }

  entries.sort(query.status === "all"
    ? (a, b) => b.sortRequested - a.sortRequested || (a.id < b.id ? -1 : 1)
    : (a, b) => a.sortDeparture - b.sortDeparture || a.sortRequested - b.sortRequested || (a.id < b.id ? -1 : 1));
  const slice = entries.slice(query.offset, query.offset + query.limit);
  const next = query.offset + query.limit;
  return { items: slice.map(entry => entry.build()), nextCursor: entries.length > next ? encodeCursor({ o: next }) : null };
}
