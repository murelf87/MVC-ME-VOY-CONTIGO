import type { Pool, PoolClient } from "pg";
import { requireAnyRole, type AuthPrincipal } from "../../auth/session.js";
import { DomainError } from "../../errors.js";
import { writeAudit } from "../../lib/audit.js";
import { moneyDefined, moneyPending, type MoneyDto } from "../../lib/dto.js";
import { notify } from "../../lib/notify.js";
import { computeProvinceCompliantRoute } from "../../maps/province-route-service.js";
import type { RouteCandidate, RouteProvider } from "../../maps/types.js";
import { geoJsonToPoints, loadPublicUser, loadPublicUsers, point, tx, type Db } from "./common.js";
import { liveSettings } from "./config.js";
import {
  computeEta, currentProgress, journeySums, loadLiveFix, loadRouteModel, progressOf, signalOf, stopFractions,
  type LiveFix, type RouteModel
} from "./eta.js";
import { computePriceImpact, loadPricingBasis, type PriceImpact } from "./price-impact.js";
import type {
  LiveDecision, LivePendingRouteChange, LiveRouteChange, LiveRouteChangeCounts, LiveRouteChangeImpact,
  LiveRouteChangeParticipantRow, LiveRouteChangeResolution, LiveRouteChangeStatus, LiveSignal, LiveStop
} from "./types.js";

/* ────────────────────────────── Tipos internos ────────────────────────────── */

type ProposalRow = {
  id: string;
  trip_id: string;
  created_by_user_id: string;
  from_route_version: number;
  proposed_route_version: number;
  proposed_distance_m: number;
  proposed_duration_s: number;
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
  planned_arrival_at: Date | null;
  payload: ProposalPayload;
  expires_at: Date | null;
  resolved_at: Date | null;
  created_at: Date;
  idempotency_key: string | null;
};

type ProposalPayload = {
  legs: Array<{ distanceM: number; durationS: number; provider: string; providerRef: string }>;
  oldSegment: { distanceM: number; durationS: number; capacity: number };
  dwellS: number;
};

type ImpactRow = {
  proposal_id: string;
  booking_id: string;
  passenger_user_id: string;
  pickup_stop_seq: number;
  dropoff_stop_seq: number;
  pickup_before_at: Date | null;
  pickup_after_at: Date | null;
  dropoff_before_at: Date | null;
  dropoff_after_at: Date | null;
  schedule_delta_s: number;
  schedule_material: boolean;
  price_status: "defined" | "pending_definition";
  price_before_cents: number | null;
  price_after_cents: number | null;
  price_delta_cents: number | null;
  price_material: boolean;
  requires_acceptance: boolean;
};

const PROPOSAL_COLUMNS = `p.id,p.trip_id,p.created_by_user_id,p.from_route_version,p.proposed_route_version,p.proposed_distance_m,
  p.proposed_duration_s,p.status,p.resolution,p.auto_applied,p.linked_request_id,p.after_stop_seq,p.new_stop_label,
  ST_Y(p.new_stop_geom) as new_lat,ST_X(p.new_stop_geom) as new_lng,p.new_stop_seq,p.added_distance_m,p.added_duration_s,
  p.max_detour_m,p.planned_arrival_at,p.payload,p.expires_at,p.resolved_at,p.created_at,p.idempotency_key`;

const SHIFT = 100000;

function arrivalChangeText(deltaSeconds: number, conditional = false): string {
  if (Math.abs(deltaSeconds) < 30) return conditional ? "Tu hora de llegada apenas cambiaría." : "Tu hora de llegada apenas cambia.";
  const minutes = Math.max(1, Math.round(Math.abs(deltaSeconds) / 60));
  return `Tu llegada estimada ${conditional ? "cambiaría" : "cambia"} en ${deltaSeconds > 0 ? "+" : "-"}${minutes} min.`;
}

/** Variación de importe (solo por kilómetros reales): texto para el aviso; vacío si no hay variación definida. */
function priceChangeText(price: PriceImpact): string {
  if (price.status !== "defined" || price.deltaCents === null || price.deltaCents === 0) return "";
  const euros = (Math.abs(price.deltaCents) / 100).toFixed(2).replace(".", ",");
  return ` El importe cambiaría en ${price.deltaCents > 0 ? "+" : "-"}${euros} € por los kilómetros añadidos.`;
}

/* ────────────────────────────── Caducidad ────────────────────────────── */

/**
 * Marca como `expired` las propuestas pendientes cuyo plazo venció (nunca se aplican) y avisa al conductor y a los pasajeros
 * que debían responder. Pensada para llamarse de forma perezosa y desde un barrido periódico.
 */
export async function expireDueRouteChanges(
  db: Db,
  filter: { tripId?: string; proposalId?: string } = {},
  now: Date = new Date()
): Promise<number> {
  const result = await db.query<{ id: string; trip_id: string; created_by_user_id: string }>(
    `update route_change_proposals
        set status='expired', resolution='expired', resolved_at=$1
      where status='pending' and expires_at is not null and expires_at <= $1
        and ($2::uuid is null or trip_id=$2::uuid)
        and ($3::uuid is null or id=$3::uuid)
      returning id, trip_id, created_by_user_id`,
    [now, filter.tripId ?? null, filter.proposalId ?? null]
  );
  for (const row of result.rows) {
    await notify(db, {
      userId: row.created_by_user_id, category: "trip", kind: "route_change_expired",
      title: "La propuesta de cambio de ruta ha caducado",
      body: "Ningún pasajero respondió a tiempo, así que la ruta sigue igual.",
      data: { proposalId: row.id, tripId: row.trip_id }
    });
    await notifyRequiredPassengers(db, row.id, row.trip_id, "route_change_expired",
      "La propuesta de cambio de ruta ha caducado", "Tu viaje sigue igual: no se ha aplicado ningún cambio.");
  }
  return result.rowCount ?? 0;
}

/**
 * Avisa a TODOS los pasajeros que debían responder (también a quien ya había aceptado y esperaba al resto) de que la propuesta
 * no sigue adelante. `exceptUserId` excluye a quien acaba de actuar (p. ej. quien rechazó).
 */
async function notifyRequiredPassengers(
  db: Db, proposalId: string, tripId: string, kind: string, title: string, body: string, exceptUserId?: string
): Promise<void> {
  const rows = await db.query<{ passenger_user_id: string; booking_id: string }>(
    `select distinct on (i.passenger_user_id) i.passenger_user_id, i.booking_id
       from route_change_impacts i
      where i.proposal_id=$1 and i.requires_acceptance
      order by i.passenger_user_id, i.booking_id`,
    [proposalId]
  );
  for (const row of rows.rows) {
    if (row.passenger_user_id === exceptUserId) continue;
    await notify(db, {
      userId: row.passenger_user_id, category: "trip", kind, title, body,
      data: { proposalId, tripId, bookingId: row.booking_id }
    });
  }
}

/** Propuesta pendiente que requiere MI decisión (para /live e /in-car). */
export async function findPendingRouteChangeForPassenger(
  db: Db, tripId: string, userId: string
): Promise<LivePendingRouteChange | null> {
  const result = await db.query<{ id: string; expires_at: Date | null; decided: boolean }>(
    `select p.id, p.expires_at,
            exists (select 1 from route_change_acceptances a where a.proposal_id=p.id and a.passenger_user_id=$2) as decided
       from route_change_proposals p
       join route_change_impacts i on i.proposal_id=p.id and i.passenger_user_id=$2 and i.requires_acceptance
      where p.trip_id=$1 and p.status='pending'
      limit 1`,
    [tripId, userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { proposalId: row.id, expiresAt: row.expires_at ? row.expires_at.toISOString() : null, awaitingMyDecision: !row.decided };
}

export async function routeChangeCounts(db: Db, proposalId: string): Promise<LiveRouteChangeCounts> {
  const result = await db.query<{ required: number; accepted: number; rejected: number }>(
    `with req as (
       select distinct passenger_user_id from route_change_impacts where proposal_id=$1 and requires_acceptance
     )
     select (select count(*) from req)::int as required,
            (select count(*) from route_change_acceptances a join req r on r.passenger_user_id=a.passenger_user_id
              where a.proposal_id=$1 and a.accepted)::int as accepted,
            (select count(*) from route_change_acceptances a join req r on r.passenger_user_id=a.passenger_user_id
              where a.proposal_id=$1 and not a.accepted)::int as rejected`,
    [proposalId]
  );
  const row = result.rows[0] ?? { required: 0, accepted: 0, rejected: 0 };
  return {
    required: row.required, accepted: row.accepted, rejected: row.rejected,
    pending: Math.max(0, row.required - row.accepted - row.rejected)
  };
}

/* ────────────────────────────── Capacidad ────────────────────────────── */

/** Comprueba (con bloqueo de filas de tramo) que cabe 1 pasajero más en todos los tramos antiguos [fromOld, toOld). */
async function assertCapacityForNewPassenger(
  client: PoolClient, tripId: string, fromOld: number, toOld: number, excludeRequestId: string | null
): Promise<void> {
  const segments = await client.query<{ seq: number; capacity: number }>(
    `select seq, capacity from trip_segments
      where trip_id=$1 and seq >= $2 and seq < $3
      order by seq for update`,
    [tripId, fromOld, toOld]
  );
  for (const segment of segments.rows) {
    const occupancy = await client.query<{ occupied: number }>(
      `select
         (select count(*)::int
            from seat_holds h join ride_requests r on r.id=h.request_id
           where r.trip_id=$1 and h.status='active' and h.expires_at > now()
             and ($3::uuid is null or r.id <> $3::uuid)
             and r.from_segment_seq <= $2 and r.to_segment_seq > $2)
         +
         (select count(*)::int
            from bookings b join ride_requests r on r.id=b.request_id
           where r.trip_id=$1 and b.status in ('confirmed','completed')
             and ($3::uuid is null or r.id <> $3::uuid)
             and r.from_segment_seq <= $2 and r.to_segment_seq > $2) as occupied`,
      [tripId, segment.seq, excludeRequestId]
    );
    if ((occupancy.rows[0]?.occupied ?? 0) + 1 > segment.capacity) {
      throw new DomainError(
        "NO_CAPACITY_ON_SEGMENT", "No seat capacity on at least one affected segment", 409, { segmentSeq: segment.seq }
      );
    }
  }
}

/* ────────────────────────────── Crear propuesta ────────────────────────────── */

export type CreateRouteChangeInput = {
  tripId: string;
  stop: { lat: number; lng: number; label?: string | undefined };
  afterStopSeq?: number | undefined;
  requestId?: string | undefined;
  idempotencyKey?: string | undefined;
};

type AffectedBooking = {
  bookingId: string; requestId: string; passengerUserId: string; f: number; t: number; pickedUp: boolean;
};

type ComputedImpact = {
  booking: AffectedBooking;
  pickupBefore: Date | null;
  pickupAfter: Date | null;
  dropoffBefore: Date | null;
  dropoffAfter: Date | null;
  scheduleDeltaS: number;
  scheduleMaterial: boolean;
  distanceBefore: number;
  distanceAfter: number;
  price: PriceImpact;
  requires: boolean;
};

function validLeg(leg: RouteCandidate): void {
  if (!(leg.distanceMeters >= 1) || !(leg.durationSeconds >= 1)) {
    throw new DomainError(
      "ROUTE_CHANGE_STOP_TOO_CLOSE", "The new stop is too close to an existing stop to form a route leg", 422
    );
  }
}

export async function createRouteChange(
  pool: Pool,
  principal: AuthPrincipal,
  provider: RouteProvider | null,
  input: CreateRouteChangeInput,
  now: Date = new Date()
): Promise<{ view: LiveRouteChange; created: boolean }> {
  requireAnyRole(principal, ["driver"]);
  if (!provider) {
    throw new DomainError("MAPS_PROVIDER_UNAVAILABLE", "A real routing provider is not configured", 503);
  }
  if (!Number.isFinite(input.stop.lat) || !Number.isFinite(input.stop.lng)
      || Math.abs(input.stop.lat) > 90 || Math.abs(input.stop.lng) > 180) {
    throw new DomainError("INVALID_ROUTE_CHANGE_STOP", "The new stop coordinates are invalid", 400);
  }

  const existing = await findByIdempotency(pool, principal.userId, input.idempotencyKey);
  if (existing) {
    if (existing.trip_id !== input.tripId) {
      throw new DomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was already used for a different trip", 409);
    }
    return { view: await getRouteChangeView(pool, principal.userId, existing.id, now), created: false };
  }

  const settings = liveSettings();
  await expireDueRouteChanges(pool, { tripId: input.tripId }, now);

  /* 1) Instantánea sin bloqueo: los cálculos con el proveedor de rutas se hacen FUERA de la transacción. */
  const model = await loadRouteModel(pool, input.tripId);
  if (model.driverUserId !== principal.userId) {
    throw new DomainError("TRIP_NOT_OWNED", "Only the trip driver may propose a route change", 403);
  }
  if (model.status !== "published" && model.status !== "active") {
    throw new DomainError("ROUTE_CHANGE_TRIP_NOT_CHANGEABLE", "Only a published or active trip can change its route", 409);
  }
  if (model.stops.length < 2 || model.segments.length < 1) {
    throw new DomainError("TRIP_ROUTE_DATA_MISSING", "The trip has no stops or segments to change", 409);
  }
  const pendingNow = await pool.query(`select 1 from route_change_proposals where trip_id=$1 and status='pending'`, [input.tripId]);
  if (pendingNow.rowCount) {
    throw new DomainError("ROUTE_CHANGE_ALREADY_PENDING", "This trip already has a pending route change", 409);
  }

  const fix = model.status === "active" ? await loadLiveFix(pool, input.tripId) : null;
  const progress = progressOf(model, fix);
  if (model.status === "active" && !progress) {
    throw new DomainError(
      "DRIVER_POSITION_UNAVAILABLE", "A route change during an active trip needs a known driver position", 409
    );
  }

  const fractions = stopFractions(model);
  const projection = await pool.query<{ frac: number; covered: boolean }>(
    `select ST_LineLocatePoint(t.route_geom, x.g) as frac, ST_CoveredBy(x.g, p.geom) as covered
       from trips t
       join provinces p on p.id=t.province_id
       cross join (select ST_SetSRID(ST_Point($2,$3),4326) as g) x
      where t.id=$1`,
    [input.tripId, input.stop.lng, input.stop.lat]
  );
  const proj = projection.rows[0];
  if (!proj) throw new DomainError("TRIP_NOT_FOUND", "Trip not found", 404);
  if (!proj.covered) {
    throw new DomainError(
      "ROUTE_CHANGE_STOP_OUTSIDE_PROVINCE", "The new stop must be inside the province of the trip", 422
    );
  }

  const segmentCount = model.segments.length;
  let k: number;
  if (input.afterStopSeq !== undefined) {
    k = input.afterStopSeq;
    if (!Number.isInteger(k) || k < 0 || k > segmentCount - 1) {
      throw new DomainError(
        "ROUTE_CHANGE_INVALID_STOP_INDEX", "afterStopSeq must reference a stop that has a following stop", 422, { segmentCount }
      );
    }
  } else {
    k = 0;
    for (let j = 0; j < segmentCount; j += 1) {
      if ((fractions[j] as number) <= proj.frac) k = j;
      else break;
    }
  }
  if (progress && fix && fix.frac !== null) {
    if (k < progress.c || (k === progress.c && proj.frac < fix.frac - 1e-6)) {
      throw new DomainError(
        "ROUTE_CHANGE_STOP_BEHIND_VEHICLE", "The new stop is behind the vehicle on the route", 422
      );
    }
  }

  const stopK = model.stops.find(s => s.seq === k);
  const stopK1 = model.stops.find(s => s.seq === k + 1);
  const oldSegment = model.segments.find(s => s.seq === k);
  if (!stopK || !stopK1 || !oldSegment) {
    throw new DomainError("TRIP_ROUTE_DATA_MISSING", "The trip is missing stops or segments around the insertion point", 409);
  }

  /* 2) Recalculo determinista con rutas reales por carretera, dentro de la provincia. */
  const newStop = { latitude: input.stop.lat, longitude: input.stop.lng };
  // Google exige una hora de salida futura: solo se envía la hora publicada de un viaje que aún no salió; si no, «ahora» (por defecto).
  const departureTime = model.status === "published" && model.departureAt && model.departureAt.getTime() > now.getTime() + 60_000
    ? { departureTime: model.departureAt.toISOString() }
    : {};
  const leg1 = await computeProvinceCompliantRoute(pool, provider, {
    provinceId: model.provinceId,
    origin: { latitude: stopK.lat, longitude: stopK.lng },
    destination: newStop,
    ...departureTime
  });
  const leg2 = await computeProvinceCompliantRoute(pool, provider, {
    provinceId: model.provinceId,
    origin: newStop,
    destination: { latitude: stopK1.lat, longitude: stopK1.lng },
    ...departureTime
  });
  validLeg(leg1);
  validLeg(leg2);

  const addedDistanceM = leg1.distanceMeters + leg2.distanceMeters - oldSegment.distanceM;
  const addedDurationS = leg1.durationSeconds + leg2.durationSeconds - oldSegment.durationS + settings.stopDwellSeconds;
  if (addedDistanceM > model.maxDetourM) {
    throw new DomainError(
      "ROUTE_CHANGE_DETOUR_TOO_LARGE", "The detour exceeds the maximum allowed for this trip", 422,
      { addedDistanceM, maxDetourM: model.maxDetourM }
    );
  }

  /* 3) Solicitud enlazada (pasajero que subirá en la nueva parada). */
  let linkedToOld: number | null = null;
  if (input.requestId) {
    const request = (await pool.query<{ trip_id: string; passenger_user_id: string; status: string; to_segment_seq: number }>(
      `select trip_id, passenger_user_id, status, to_segment_seq from ride_requests where id=$1`, [input.requestId]
    )).rows[0];
    if (!request || request.trip_id !== input.tripId) {
      throw new DomainError("ROUTE_CHANGE_REQUEST_INVALID", "The linked ride request does not belong to this trip", 422);
    }
    if (!["pending", "accepted", "payment_pending"].includes(request.status)) {
      throw new DomainError("ROUTE_CHANGE_REQUEST_INVALID", "The linked ride request is not awaiting a decision", 422);
    }
    if (request.passenger_user_id === principal.userId) {
      throw new DomainError("ROUTE_CHANGE_REQUEST_INVALID", "The driver cannot be the new passenger", 422);
    }
    if (request.to_segment_seq < k + 1) {
      throw new DomainError(
        "ROUTE_CHANGE_REQUEST_INVALID", "The linked ride request drops off before the new stop", 422
      );
    }
    linkedToOld = request.to_segment_seq;
  }

  /* 4) Impacto por reserva afectada (horario y precio). */
  const bookingRows = await pool.query<{
    booking_id: string; request_id: string; passenger_user_id: string; f: number; t: number; picked_up_at: Date | null;
  }>(
    `select b.id as booking_id, r.id as request_id, r.passenger_user_id,
            r.from_segment_seq as f, r.to_segment_seq as t, b.picked_up_at
       from bookings b join ride_requests r on r.id=b.request_id
      where r.trip_id=$1 and b.status='confirmed'
      order by r.from_segment_seq, b.id`,
    [input.tripId]
  );
  const affected: AffectedBooking[] = bookingRows.rows
    .filter(r => r.t >= k + 1)
    .map(r => ({
      bookingId: r.booking_id, requestId: r.request_id, passengerUserId: r.passenger_user_id,
      f: r.f, t: r.t, pickedUp: r.picked_up_at !== null
    }));

  const threshold = Math.max(settings.materialScheduleDeltaS, model.flexibilityMinutes * 60);
  const impacts: ComputedImpact[] = [];
  for (const b of affected) {
    const pickupBefore = b.pickedUp ? null : computeEta(model, b.f, fix, now, settings)?.at ?? null;
    const dropoffBefore = computeEta(model, b.t, fix, now, settings)?.at ?? null;
    const pickupShiftS = !b.pickedUp && b.f >= k + 1 ? addedDurationS : 0;
    const spansDetour = b.f <= k && k < b.t;
    const distanceBefore = journeySums(model, b.f, b.t).distanceM;
    const distanceAfter = distanceBefore + (spansDetour ? addedDistanceM : 0);
    const basis = await loadPricingBasis(pool, b.requestId);
    const price = computePriceImpact(basis, distanceBefore, distanceAfter);
    const scheduleMaterial = addedDurationS >= threshold;
    impacts.push({
      booking: b,
      pickupBefore,
      pickupAfter: pickupBefore ? new Date(pickupBefore.getTime() + pickupShiftS * 1000) : null,
      dropoffBefore,
      dropoffAfter: dropoffBefore ? new Date(dropoffBefore.getTime() + addedDurationS * 1000) : null,
      scheduleDeltaS: addedDurationS,
      scheduleMaterial,
      distanceBefore,
      distanceAfter,
      price,
      requires: scheduleMaterial || price.material
    });
  }

  const nextStopEtaBefore = computeEta(model, k + 1, fix, now, settings)?.at ?? null;
  const plannedArrivalAt = nextStopEtaBefore
    ? new Date(nextStopEtaBefore.getTime() + (leg1.durationSeconds - oldSegment.durationS) * 1000)
    : null;

  const payload: ProposalPayload = {
    legs: [leg1, leg2].map(l => ({
      distanceM: l.distanceMeters, durationS: l.durationSeconds, provider: l.provider, providerRef: l.providerRef
    })),
    oldSegment: { distanceM: oldSegment.distanceM, durationS: oldSegment.durationS, capacity: oldSegment.capacity },
    dwellS: settings.stopDwellSeconds
  };
  const requiredCount = new Set(impacts.filter(i => i.requires).map(i => i.booking.passengerUserId)).size;

  /* 5) Persistir (con bloqueo) y, si no hay cambios materiales, aplicar al instante. */
  const createdId = await tx(pool, async client => {
    const lock = await client.query<{ status: string; route_version: number }>(
      `select status, route_version from trips where id=$1 for update`, [input.tripId]
    );
    const trip = lock.rows[0];
    if (!trip || (trip.status !== "published" && trip.status !== "active")) {
      throw new DomainError("ROUTE_CHANGE_TRIP_NOT_CHANGEABLE", "Only a published or active trip can change its route", 409);
    }
    if (trip.route_version !== model.routeVersion) {
      throw new DomainError("ROUTE_CHANGE_ROUTE_STALE", "The route changed while the proposal was being computed; retry", 409);
    }
    if (input.requestId && linkedToOld !== null) {
      const status = await client.query<{ status: string }>(`select status from ride_requests where id=$1 for update`, [input.requestId]);
      if (!["pending", "accepted", "payment_pending"].includes(status.rows[0]?.status ?? "")) {
        throw new DomainError("ROUTE_CHANGE_REQUEST_INVALID", "The linked ride request is not awaiting a decision", 422);
      }
      await assertCapacityForNewPassenger(client, input.tripId, k, linkedToOld, input.requestId);
    }

    const expiresAt = requiredCount > 0 ? new Date(now.getTime() + settings.routeChangeTtlSeconds * 1000) : null;
    let proposalId: string;
    try {
      const inserted = await client.query<{ id: string }>(
        `with src as (
           select t.route_geom as old_geom,
                  ST_SetSRID(ST_GeomFromGeoJSON($11),4326) as l1,
                  ST_SetSRID(ST_GeomFromGeoJSON($12),4326) as l2
             from trips t where t.id=$1
         ), built as (
           select old_geom,
                  ST_RemoveRepeatedPoints(ST_MakeLine(ARRAY[
                    ST_LineSubstring(old_geom, 0, $13::float8),
                    l1, l2,
                    ST_LineSubstring(old_geom, $14::float8, 1)
                  ])) as new_geom
             from src
         )
         insert into route_change_proposals(
           trip_id, created_by_user_id, from_route_version, proposed_route_version, proposed_route_geom,
           proposed_distance_m, proposed_duration_s, material_price_change, material_schedule_change, status,
           kind, linked_request_id, after_stop_seq, new_stop_label, new_stop_geom, before_route_geom,
           added_distance_m, added_duration_s, max_detour_m, planned_arrival_at, payload, expires_at, idempotency_key
         )
         select $1, $2, $3, $3 + 1, new_geom::geometry(LineString,4326),
                $4, $5, $6, $7, 'pending',
                'new_stop', $8, $9, $10, ST_SetSRID(ST_Point($15,$16),4326), old_geom,
                $17, $18, $19, $20, $21::jsonb, $22, $23
           from built
         returning id`,
        [
          input.tripId, principal.userId, model.routeVersion,
          Math.max(1, (model.routeDistanceM ?? 0) + addedDistanceM),
          Math.max(1, (model.routeDurationS ?? 0) + leg1.durationSeconds + leg2.durationSeconds - oldSegment.durationS),
          impacts.some(i => i.price.material), impacts.some(i => i.scheduleMaterial),
          input.requestId ?? null, k, input.stop.label?.trim() || null,
          JSON.stringify(leg1.geometry), JSON.stringify(leg2.geometry),
          (fractions[k] as number), (fractions[k + 1] as number),
          input.stop.lng, input.stop.lat,
          addedDistanceM, addedDurationS, model.maxDetourM,
          plannedArrivalAt, JSON.stringify(payload), expiresAt, input.idempotencyKey ?? null
        ]
      );
      const row = inserted.rows[0];
      if (!row) throw new DomainError("ROUTE_CHANGE_ROUTE_STALE", "The trip route could not be read", 409);
      proposalId = row.id;
    } catch (error: unknown) {
      const err = error as { code?: string; constraint?: string };
      if (err.code === "23505" && err.constraint === "route_change_one_pending_per_trip") {
        throw new DomainError("ROUTE_CHANGE_ALREADY_PENDING", "This trip already has a pending route change", 409);
      }
      throw error;
    }
    const covered = await client.query<{ covered: boolean }>(
      `select ST_CoveredBy(p.proposed_route_geom, pr.geom) as covered
         from route_change_proposals p
         join trips t on t.id=p.trip_id
         join provinces pr on pr.id=t.province_id
        where p.id=$1`,
      [proposalId]
    );
    if (covered.rows[0]?.covered !== true) {
      throw new DomainError(
        "ROUTE_CHANGE_STOP_OUTSIDE_PROVINCE", "The proposed route would leave the province of the trip", 422
      );
    }

    for (const impact of impacts) {
      const b = impact.booking;
      await client.query(
        `insert into route_change_impacts(
           proposal_id, booking_id, passenger_user_id, pickup_stop_seq, dropoff_stop_seq, pickup_geom, dropoff_geom,
           pickup_before_at, pickup_after_at, dropoff_before_at, dropoff_after_at, schedule_delta_s, schedule_material,
           distance_before_m, distance_after_m, price_status, price_before_cents, price_after_cents, price_delta_cents,
           price_material, requires_acceptance
         )
         select $1, $2, $3, $4, $5, ps.geom, ds.geom, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
           from trip_stops ps, trip_stops ds
          where ps.trip_id=$20 and ps.seq=$4 and ds.trip_id=$20 and ds.seq=$5`,
        [
          proposalId, b.bookingId, b.passengerUserId, b.f, b.t,
          impact.pickupBefore, impact.pickupAfter, impact.dropoffBefore, impact.dropoffAfter,
          Math.round(impact.scheduleDeltaS), impact.scheduleMaterial,
          Math.round(impact.distanceBefore), Math.round(impact.distanceAfter),
          impact.price.status, impact.price.beforeCents, impact.price.afterCents, impact.price.deltaCents,
          impact.price.material, impact.requires, input.tripId
        ]
      );
    }

    await writeAudit(client, {
      actorUserId: principal.userId, action: "route_change.proposed", entityType: "route_change_proposal",
      entityId: proposalId,
      metadata: {
        tripId: input.tripId, afterStopSeq: k, addedDistanceM, addedDurationS,
        affected: impacts.length, required: requiredCount, linkedRequestId: input.requestId ?? null
      }
    });

    if (requiredCount === 0) {
      await applyProposal(client, proposalId, "auto_applied");
    } else {
      const driver = await loadPublicUser(client, principal.userId);
      const notified = new Set<string>();
      for (const impact of impacts.filter(i => i.requires)) {
        if (notified.has(impact.booking.passengerUserId)) continue;
        notified.add(impact.booking.passengerUserId);
        await notify(client, {
          userId: impact.booking.passengerUserId, category: "trip", kind: "route_change_proposed",
          title: `${driver.firstName} propone una nueva parada`,
          body: `${arrivalChangeText(impact.scheduleDeltaS, true)}${priceChangeText(impact.price)} Se aplicará solo si lo aceptas.`,
          data: { proposalId, tripId: input.tripId, bookingId: impact.booking.bookingId }
        });
      }
    }
    return proposalId;
  });

  return { view: await getRouteChangeView(pool, principal.userId, createdId, now), created: true };
}

async function findByIdempotency(
  db: Db, userId: string, key: string | undefined
): Promise<{ id: string; trip_id: string } | null> {
  if (!key) return null;
  const result = await db.query<{ id: string; trip_id: string }>(
    `select id, trip_id from route_change_proposals where created_by_user_id=$1 and idempotency_key=$2`, [userId, key]
  );
  return result.rows[0] ?? null;
}

/* ────────────────────────────── Aplicar ────────────────────────────── */

type ApplyOutcome = { applied: true } | { applied: false; reason: "superseded" | "capacity_lost" };

/**
 * Aplica una propuesta (en la transacción del llamante, con la fila del viaje ya bloqueada): inserta la parada, parte el tramo en dos
 * con la capacidad heredada, desplaza los seq posteriores y los rangos de solicitudes/reservas, actualiza geometría/distancia/duración
 * y sube `route_version`. El trigger de base de datos vuelve a validar la geometría completa dentro de la provincia.
 */
async function applyProposal(
  client: PoolClient, proposalId: string, resolution: "auto_applied" | "all_accepted", actorUserId: string | null = null
): Promise<ApplyOutcome> {
  const proposal = (await client.query<ProposalRow>(
    `select ${PROPOSAL_COLUMNS} from route_change_proposals p where p.id=$1 for update`, [proposalId]
  )).rows[0];
  if (!proposal || proposal.status !== "pending") {
    throw new DomainError("ROUTE_CHANGE_NOT_PENDING", "The route change is not pending", 409);
  }
  const trip = (await client.query<{ route_version: number; status: string; route_provider_ref: string | null; route_distance_m: number; route_duration_s: number }>(
    `select route_version, status, route_provider_ref, route_distance_m, route_duration_s from trips where id=$1`, [proposal.trip_id]
  )).rows[0];
  const k = proposal.after_stop_seq;

  const cancel = async (reason: "superseded" | "capacity_lost"): Promise<ApplyOutcome> => {
    await client.query(
      `update route_change_proposals set status='cancelled', resolution=$2, resolved_at=now() where id=$1`, [proposalId, reason]
    );
    return { applied: false, reason };
  };

  if (!trip || (trip.status !== "published" && trip.status !== "active") || trip.route_version !== proposal.from_route_version) {
    return cancel("superseded");
  }

  // El conjunto de pasajeros afectados no debe haber cambiado desde que se calculó el impacto.
  const currentAffected = await client.query<{ booking_id: string }>(
    `select b.id as booking_id from bookings b join ride_requests r on r.id=b.request_id
      where r.trip_id=$1 and b.status='confirmed' and r.to_segment_seq >= $2 order by b.id`,
    [proposal.trip_id, k + 1]
  );
  const recorded = await client.query<{ booking_id: string }>(
    `select booking_id from route_change_impacts where proposal_id=$1 order by booking_id`, [proposalId]
  );
  const same = currentAffected.rows.length === recorded.rows.length
    && currentAffected.rows.every((row, index) => row.booking_id === recorded.rows[index]?.booking_id);
  if (!same) return cancel("superseded");

  if (proposal.linked_request_id) {
    const linked = (await client.query<{ status: string; to_segment_seq: number }>(
      `select status, to_segment_seq from ride_requests where id=$1 for update`, [proposal.linked_request_id]
    )).rows[0];
    if (!linked || !["pending", "accepted", "payment_pending"].includes(linked.status)) return cancel("superseded");
    try {
      await assertCapacityForNewPassenger(client, proposal.trip_id, k, linked.to_segment_seq, proposal.linked_request_id);
    } catch (error: unknown) {
      if (error instanceof DomainError && error.code === "NO_CAPACITY_ON_SEGMENT") return cancel("capacity_lost");
      throw error;
    }
  }

  const payload = proposal.payload;
  const [leg1, leg2] = payload.legs;
  if (!leg1 || !leg2) throw new Error("route change payload has no legs");

  // Paradas: abrir hueco en k+1 e insertar la nueva.
  await client.query(`update trip_stops set seq = seq + ${SHIFT} where trip_id=$1 and seq > $2`, [proposal.trip_id, k]);
  await client.query(`update trip_stops set seq = seq - ${SHIFT - 1} where trip_id=$1 and seq > ${SHIFT}`, [proposal.trip_id]);
  await client.query(
    `insert into trip_stops(trip_id, seq, kind, label, geom)
     select $1, $2, 'stop', $3, new_stop_geom from route_change_proposals where id=$4`,
    [proposal.trip_id, k + 1, proposal.new_stop_label, proposalId]
  );

  // Tramos: sustituir el tramo k por dos (la capacidad se hereda) y desplazar los posteriores.
  await client.query(`delete from trip_segments where trip_id=$1 and seq=$2`, [proposal.trip_id, k]);
  await client.query(
    `update trip_segments
        set seq = seq + ${SHIFT}, from_stop_seq = from_stop_seq + ${SHIFT}, to_stop_seq = to_stop_seq + ${SHIFT}
      where trip_id=$1 and seq > $2`,
    [proposal.trip_id, k]
  );
  await client.query(
    `update trip_segments
        set seq = seq - ${SHIFT - 1}, from_stop_seq = from_stop_seq - ${SHIFT - 1}, to_stop_seq = to_stop_seq - ${SHIFT - 1}
      where trip_id=$1 and seq > ${SHIFT}`,
    [proposal.trip_id]
  );
  await client.query(
    `insert into trip_segments(trip_id, seq, from_stop_seq, to_stop_seq, distance_m, duration_s, capacity)
     values($1,$2,$2,$3,$4,$5,$8), ($1,$6,$6,$7,$9,$10,$8)`,
    [
      proposal.trip_id, k, k + 1, leg1.distanceM, leg1.durationS, k + 1, k + 2,
      payload.oldSegment.capacity, leg2.distanceM, leg2.durationS
    ]
  );

  // Solicitudes/reservas: la numeración de paradas posteriores a k sube una posición (de mayor a menor para no chocar con índices únicos).
  const requests = await client.query<{ id: string; f: number; t: number }>(
    `select id, from_segment_seq as f, to_segment_seq as t from ride_requests
      where trip_id=$1 order by from_segment_seq desc, to_segment_seq desc, id for update`,
    [proposal.trip_id]
  );
  for (const request of requests.rows) {
    const nf = request.f > k ? request.f + 1 : request.f;
    const nt = request.t > k ? request.t + 1 : request.t;
    if (nf !== request.f || nt !== request.t) {
      await client.query(
        `update ride_requests set from_segment_seq=$2, to_segment_seq=$3, updated_at=now() where id=$1`,
        [request.id, nf, nt]
      );
    }
  }
  if (proposal.linked_request_id) {
    await client.query(
      `update ride_requests set from_segment_seq=$2, updated_at=now() where id=$1`, [proposal.linked_request_id, k + 1]
    );
  }

  // Viaje: nueva geometría/distancia/duración y versión de ruta.
  try {
    await client.query(
      `update trips t
          set route_geom = p.proposed_route_geom,
              route_distance_m = p.proposed_distance_m,
              route_duration_s = p.proposed_duration_s,
              route_version = p.proposed_route_version,
              route_provider_ref = $2,
              updated_at = now()
         from route_change_proposals p
        where p.id=$1 and t.id=p.trip_id`,
      [proposalId, `${trip.route_provider_ref ?? "route"}|route-change:${proposalId}`]
    );
  } catch (error: unknown) {
    if ((error as { code?: string }).code === "23514") {
      throw new DomainError(
        "ROUTE_CHANGE_STOP_OUTSIDE_PROVINCE", "The proposed route would leave the province of the trip", 422
      );
    }
    throw error;
  }

  await client.query(
    `update route_change_proposals
        set status='accepted', resolution=$2, auto_applied=$3, resolved_at=now(), new_stop_seq=$4
      where id=$1`,
    [proposalId, resolution, resolution === "auto_applied", k + 1]
  );
  await writeAudit(client, {
    actorUserId: null, action: "route_change.applied", entityType: "route_change_proposal", entityId: proposalId,
    metadata: { tripId: proposal.trip_id, resolution, newStopSeq: k + 1, routeVersion: proposal.proposed_route_version }
  });

  // Avisos: conductor y pasajeros afectados que no tuvieron que aceptar.
  const driver = await loadPublicUser(client, proposal.created_by_user_id);
  await notify(client, {
    userId: proposal.created_by_user_id, category: "trip", kind: "route_change_accepted",
    title: "Cambio de ruta aplicado",
    body: resolution === "auto_applied"
      ? "La nueva parada se ha añadido a tu ruta (cambio no material para los pasajeros)."
      : "Los pasajeros afectados han aceptado: la nueva parada ya está en tu ruta.",
    data: { proposalId, tripId: proposal.trip_id }
  });
  // Pasajeros afectados: quien no tuvo que aceptar recibe el aviso informativo; quien aceptó (salvo quien cerró la votación,
  // que ya ve el resultado en la respuesta) recibe la confirmación de que el cambio se aplicó.
  const affectedRows = await client.query<{
    passenger_user_id: string; booking_id: string; schedule_delta_s: number; requires_acceptance: boolean;
  }>(
    `select distinct on (passenger_user_id) passenger_user_id, booking_id, schedule_delta_s, requires_acceptance
       from route_change_impacts where proposal_id=$1
      order by passenger_user_id, requires_acceptance desc, booking_id`,
    [proposalId]
  );
  for (const row of affectedRows.rows) {
    if (row.requires_acceptance && row.passenger_user_id === actorUserId) continue;
    await notify(client, {
      userId: row.passenger_user_id, category: "trip", kind: "route_change_applied",
      title: row.requires_acceptance ? "Cambio de ruta aplicado" : "Tu viaje ha cambiado ligeramente",
      body: row.requires_acceptance
        ? `Todos los pasajeros afectados han aceptado: ${driver.firstName} ha añadido una parada. ${arrivalChangeText(row.schedule_delta_s)}`
        : `${driver.firstName} ha añadido una parada. ${arrivalChangeText(row.schedule_delta_s)}`,
      data: { proposalId, tripId: proposal.trip_id, bookingId: row.booking_id }
    });
  }
  return { applied: true };
}

/* ────────────────────────────── Responder / cancelar ────────────────────────────── */

export async function respondRouteChange(
  pool: Pool,
  principal: AuthPrincipal,
  proposalId: string,
  decision: "accept" | "reject",
  now: Date = new Date()
): Promise<LiveRouteChange> {
  await expireDueRouteChanges(pool, { proposalId }, now);

  await tx(pool, async client => {
    const head = (await client.query<{ trip_id: string }>(
      `select trip_id from route_change_proposals where id=$1`, [proposalId]
    )).rows[0];
    if (!head) throw new DomainError("ROUTE_CHANGE_NOT_FOUND", "Route change not found", 404);

    // Orden de bloqueo: viaje y después propuesta (igual que al crear/aplicar).
    await client.query(`select 1 from trips where id=$1 for update`, [head.trip_id]);
    const proposal = (await client.query<ProposalRow>(
      `select ${PROPOSAL_COLUMNS} from route_change_proposals p where p.id=$1 for update`, [proposalId]
    )).rows[0];
    if (!proposal) throw new DomainError("ROUTE_CHANGE_NOT_FOUND", "Route change not found", 404);

    const mine = await client.query<{ requires_acceptance: boolean }>(
      `select requires_acceptance from route_change_impacts where proposal_id=$1 and passenger_user_id=$2`,
      [proposalId, principal.userId]
    );
    if (!mine.rowCount) throw new DomainError("ROUTE_CHANGE_NOT_FOUND", "Route change not found", 404);
    if (!mine.rows.some(r => r.requires_acceptance)) {
      throw new DomainError(
        "ROUTE_CHANGE_ACCEPTANCE_NOT_REQUIRED", "This change does not require your acceptance", 409
      );
    }

    const wanted = decision === "accept";
    const previous = await client.query<{ accepted: boolean }>(
      `select accepted from route_change_acceptances where proposal_id=$1 and passenger_user_id=$2`,
      [proposalId, principal.userId]
    );
    if (previous.rowCount) {
      if (previous.rows[0]?.accepted === wanted) return; // idempotente
      throw new DomainError("ROUTE_CHANGE_ALREADY_DECIDED", "You already answered this route change", 409);
    }
    if (proposal.status === "expired") {
      throw new DomainError("ROUTE_CHANGE_EXPIRED", "The route change proposal has expired", 409);
    }
    if (proposal.status !== "pending") {
      throw new DomainError("ROUTE_CHANGE_NOT_PENDING", "The route change is no longer pending", 409);
    }

    await client.query(
      `insert into route_change_acceptances(proposal_id, passenger_user_id, accepted, decided_at) values($1,$2,$3,$4)`,
      [proposalId, principal.userId, wanted, now]
    );
    await writeAudit(client, {
      actorUserId: principal.userId,
      action: wanted ? "route_change.accepted" : "route_change.rejected",
      entityType: "route_change_proposal", entityId: proposalId, metadata: { tripId: proposal.trip_id }
    });

    const passenger = await loadPublicUser(client, principal.userId);
    if (!wanted) {
      await client.query(
        `update route_change_proposals set status='rejected', resolution='rejected_by_passenger', resolved_at=$2 where id=$1`,
        [proposalId, now]
      );
      await notify(client, {
        userId: proposal.created_by_user_id, category: "trip", kind: "route_change_rejected",
        title: "Cambio de ruta rechazado",
        body: `${passenger.firstName} ha rechazado la nueva parada: la ruta sigue igual.`,
        data: { proposalId, tripId: proposal.trip_id }
      });
      await notifyRequiredPassengers(
        client, proposalId, proposal.trip_id, "route_change_cancelled",
        "La propuesta de cambio de ruta ya no sigue adelante", "Tu viaje sigue igual: no se ha aplicado ningún cambio.",
        principal.userId
      );
      return;
    }

    const counts = await routeChangeCounts(client, proposalId);
    if (counts.required > 0 && counts.accepted >= counts.required && counts.rejected === 0) {
      const outcome = await applyProposal(client, proposalId, "all_accepted", principal.userId);
      if (!outcome.applied) {
        await notify(client, {
          userId: proposal.created_by_user_id, category: "trip", kind: "route_change_cancelled",
          title: "No se pudo aplicar el cambio de ruta",
          body: outcome.reason === "capacity_lost"
            ? "Mientras tanto se ocuparon las plazas necesarias: vuelve a proponerlo si sigue siendo posible."
            : "La ruta o las reservas cambiaron mientras tanto: vuelve a proponer el cambio.",
          data: { proposalId, tripId: proposal.trip_id }
        });
        await notifyRequiredPassengers(
          client, proposalId, proposal.trip_id, "route_change_cancelled",
          "La propuesta de cambio de ruta ya no sigue adelante", "Tu viaje sigue igual: no se ha aplicado ningún cambio.",
          principal.userId
        );
      }
    }
  });

  return getRouteChangeView(pool, principal.userId, proposalId, now);
}

export async function cancelRouteChange(
  pool: Pool, principal: AuthPrincipal, proposalId: string, now: Date = new Date()
): Promise<LiveRouteChange> {
  await expireDueRouteChanges(pool, { proposalId }, now);
  await tx(pool, async client => {
    const head = (await client.query<{ trip_id: string }>(
      `select trip_id from route_change_proposals where id=$1`, [proposalId]
    )).rows[0];
    if (!head) throw new DomainError("ROUTE_CHANGE_NOT_FOUND", "Route change not found", 404);
    await client.query(`select 1 from trips where id=$1 for update`, [head.trip_id]);
    const proposal = (await client.query<ProposalRow & { driver_user_id: string }>(
      `select ${PROPOSAL_COLUMNS}, (select driver_user_id from trips where id=p.trip_id) as driver_user_id
         from route_change_proposals p where p.id=$1 for update`, [proposalId]
    )).rows[0];
    if (!proposal) throw new DomainError("ROUTE_CHANGE_NOT_FOUND", "Route change not found", 404);
    if (proposal.created_by_user_id !== principal.userId && proposal.driver_user_id !== principal.userId) {
      const participant = await client.query(
        `select 1 from route_change_impacts where proposal_id=$1 and passenger_user_id=$2 limit 1`, [proposalId, principal.userId]
      );
      if (!participant.rowCount) throw new DomainError("ROUTE_CHANGE_NOT_FOUND", "Route change not found", 404);
      throw new DomainError("TRIP_NOT_OWNED", "Only the trip driver may cancel a route change", 403);
    }
    if (proposal.status !== "pending") {
      throw new DomainError("ROUTE_CHANGE_NOT_PENDING", "The route change is no longer pending", 409);
    }
    await client.query(
      `update route_change_proposals set status='cancelled', resolution='cancelled_by_driver', resolved_at=$2 where id=$1`,
      [proposalId, now]
    );
    await writeAudit(client, {
      actorUserId: principal.userId, action: "route_change.cancelled", entityType: "route_change_proposal",
      entityId: proposalId, metadata: { tripId: proposal.trip_id }
    });
    await notifyRequiredPassengers(
      client, proposalId, proposal.trip_id, "route_change_cancelled",
      "El conductor ha retirado la propuesta de cambio de ruta", "Tu viaje sigue igual."
    );
  });
  return getRouteChangeView(pool, principal.userId, proposalId, now);
}

/* ────────────────────────────── Vista ────────────────────────────── */

function scheduleView(before: Date | null, after: Date | null, deltaSeconds: number, material: boolean) {
  return {
    beforeAt: before ? before.toISOString() : null,
    afterAt: after ? after.toISOString() : null,
    deltaSeconds,
    material
  };
}

function priceFromRow(row: ImpactRow): { before: MoneyDto; after: MoneyDto; delta: MoneyDto } {
  if (row.price_status !== "defined" || row.price_before_cents === null || row.price_after_cents === null
      || row.price_delta_cents === null) {
    return { before: moneyPending(), after: moneyPending(), delta: moneyPending() };
  }
  return {
    before: moneyDefined(row.price_before_cents),
    after: moneyDefined(row.price_after_cents),
    delta: moneyDefined(row.price_delta_cents)
  };
}

export async function getRouteChangeView(
  db: Db, userId: string, proposalId: string, now: Date = new Date()
): Promise<LiveRouteChange> {
  await expireDueRouteChanges(db, { proposalId }, now);
  const proposal = (await db.query<ProposalRow & { driver_user_id: string }>(
    `select ${PROPOSAL_COLUMNS}, (select driver_user_id from trips where id=p.trip_id) as driver_user_id
       from route_change_proposals p where p.id=$1`, [proposalId]
  )).rows[0];
  if (!proposal) throw new DomainError("ROUTE_CHANGE_NOT_FOUND", "Route change not found", 404);

  const impacts = (await db.query<ImpactRow>(
    `select proposal_id, booking_id, passenger_user_id, pickup_stop_seq, dropoff_stop_seq, pickup_before_at, pickup_after_at,
            dropoff_before_at, dropoff_after_at, schedule_delta_s, schedule_material, price_status, price_before_cents,
            price_after_cents, price_delta_cents, price_material, requires_acceptance
       from route_change_impacts where proposal_id=$1 order by booking_id`, [proposalId]
  )).rows;

  const isDriver = proposal.created_by_user_id === userId || proposal.driver_user_id === userId;
  const mine = impacts
    .filter(i => i.passenger_user_id === userId)
    .sort((a, b) => Number(b.requires_acceptance) - Number(a.requires_acceptance) || b.schedule_delta_s - a.schedule_delta_s)[0];
  if (!isDriver && !mine) throw new DomainError("ROUTE_CHANGE_NOT_FOUND", "Route change not found", 404);

  const acceptances = (await db.query<{ passenger_user_id: string; accepted: boolean }>(
    `select passenger_user_id, accepted from route_change_acceptances where proposal_id=$1`, [proposalId]
  )).rows;
  const decisionOf = (passengerUserId: string): LiveDecision | null => {
    const found = acceptances.find(a => a.passenger_user_id === passengerUserId);
    return found ? (found.accepted ? "accepted" : "rejected") : null;
  };

  const counts = await routeChangeCounts(db, proposalId);
  const users = await loadPublicUsers(db, [proposal.created_by_user_id, ...impacts.map(i => i.passenger_user_id)]);
  const driver = users.get(proposal.created_by_user_id) ?? (await loadPublicUser(db, proposal.created_by_user_id));

  // Polilíneas: el pasajero ve solo su trayecto; el conductor, la ruta completa.
  const viewBooking = !isDriver && mine ? mine.booking_id : null;
  const paths = (await db.query<{ before_json: string | null; after_json: string | null }>(
    `with src as (
       select p.before_route_geom as bg, p.proposed_route_geom as ag, i.pickup_geom as pg, i.dropoff_geom as dg
         from route_change_proposals p
         left join route_change_impacts i on i.proposal_id=p.id and i.booking_id=$2::uuid
        where p.id=$1
     ), fr as (
       select bg, ag,
              case when pg is null then null else ST_LineLocatePoint(bg,pg) end as bf1,
              case when dg is null then null else ST_LineLocatePoint(bg,dg) end as bf2,
              case when pg is null then null else ST_LineLocatePoint(ag,pg) end as af1,
              case when dg is null then null else ST_LineLocatePoint(ag,dg) end as af2
         from src
     ), parts as (
       select case when bf1 is null or least(bf1,bf2)=greatest(bf1,bf2) then bg
                   else ST_LineSubstring(bg, least(bf1,bf2), greatest(bf1,bf2)) end as b,
              case when af1 is null or least(af1,af2)=greatest(af1,af2) then ag
                   else ST_LineSubstring(ag, least(af1,af2), greatest(af1,af2)) end as a
         from fr
     )
     select ST_AsGeoJSON(ST_SimplifyPreserveTopology(b, 0.0002)) as before_json,
            ST_AsGeoJSON(ST_SimplifyPreserveTopology(a, 0.0002)) as after_json
       from parts`,
    [proposalId, viewBooking]
  )).rows[0];

  // Paradas del pasajero con la numeración vigente (si ya se aplicó, los seq posteriores a k suben una posición).
  let stops: { pickup: LiveStop | null; dropoff: LiveStop | null } = { pickup: null, dropoff: null };
  if (!isDriver && mine) {
    const applied = proposal.status === "accepted" && proposal.new_stop_seq !== null;
    const k = proposal.after_stop_seq;
    const mapSeq = (seq: number) => (applied && seq > k ? seq + 1 : seq);
    const rows = (await db.query<{ seq: number; label: string | null; lat: number; lng: number }>(
      `select seq, label, ST_Y(geom) as lat, ST_X(geom) as lng from trip_stops
        where trip_id=$1 and seq = any($2::int[])`,
      [proposal.trip_id, [mapSeq(mine.pickup_stop_seq), mapSeq(mine.dropoff_stop_seq)]]
    )).rows;
    const toStop = (seq: number): LiveStop | null => {
      const row = rows.find(r => r.seq === seq);
      return row ? { seq: row.seq, label: row.label, location: point(row.lat, row.lng) } : null;
    };
    stops = { pickup: toStop(mapSeq(mine.pickup_stop_seq)), dropoff: toStop(mapSeq(mine.dropoff_stop_seq)) };
  }

  let myImpact: LiveRouteChangeImpact | null = null;
  if (!isDriver && mine) {
    const price = priceFromRow(mine);
    myImpact = {
      pickup: scheduleView(
        mine.pickup_before_at, mine.pickup_after_at,
        mine.pickup_before_at && mine.pickup_after_at
          ? Math.round((mine.pickup_after_at.getTime() - mine.pickup_before_at.getTime()) / 1000) : 0,
        false
      ),
      dropoff: scheduleView(mine.dropoff_before_at, mine.dropoff_after_at, mine.schedule_delta_s, mine.schedule_material),
      price: {
        ...price,
        changed: mine.price_delta_cents !== null && mine.price_delta_cents !== 0,
        material: mine.price_material
      },
      requiresAcceptance: mine.requires_acceptance
    };
  }

  let participants: LiveRouteChangeParticipantRow[] | null = null;
  if (isDriver) {
    participants = impacts.map(i => ({
      bookingId: i.booking_id,
      passenger: users.get(i.passenger_user_id) as LiveRouteChangeParticipantRow["passenger"],
      requiresAcceptance: i.requires_acceptance,
      decision: i.requires_acceptance ? decisionOf(i.passenger_user_id) : null,
      deltaSeconds: i.schedule_delta_s,
      priceDelta: priceFromRow(i).delta
    }));
  }

  const settings = liveSettings();
  const fix = await loadLiveFix(db, proposal.trip_id);
  const tripActive = (await db.query<{ status: string }>(`select status from trips where id=$1`, [proposal.trip_id]))
    .rows[0]?.status === "active";
  const signalState: LiveSignal = tripActive ? signalOf(fix, now, settings.staleAfterSeconds) : "none";
  const driverSignal = {
    state: signalState,
    lastUpdateAt: tripActive && fix ? fix.recordedAt.toISOString() : null,
    ageSeconds: tripActive && fix ? Math.max(0, Math.floor((now.getTime() - fix.recordedAt.getTime()) / 1000)) : null
  };

  return {
    id: proposal.id,
    tripId: proposal.trip_id,
    kind: "new_stop",
    status: proposal.status,
    resolution: proposal.resolution,
    autoApplied: proposal.auto_applied,
    role: isDriver ? "driver" : "passenger",
    createdAt: proposal.created_at.toISOString(),
    expiresAt: proposal.expires_at ? proposal.expires_at.toISOString() : null,
    resolvedAt: proposal.resolved_at ? proposal.resolved_at.toISOString() : null,
    driver,
    newStop: {
      label: proposal.new_stop_label,
      location: point(proposal.new_lat, proposal.new_lng),
      afterStopSeq: proposal.after_stop_seq,
      plannedArrivalAt: proposal.planned_arrival_at ? proposal.planned_arrival_at.toISOString() : null,
      seq: proposal.new_stop_seq
    },
    detour: {
      addedDistanceM: proposal.added_distance_m,
      addedDurationSeconds: proposal.added_duration_s,
      maxDetourM: proposal.max_detour_m
    },
    path: { before: geoJsonToPoints(paths?.before_json ?? null), after: geoJsonToPoints(paths?.after_json ?? null) },
    stops,
    myImpact,
    myDecision: !isDriver ? decisionOf(userId) : null,
    counts,
    participants,
    driverSignal,
    surcharge: "none",
    linkedRequestId: isDriver ? proposal.linked_request_id : null
  };
}

/** Resumen de la propuesta pendiente para la consola del conductor. */
export async function findPendingRouteChangeForDriver(db: Db, tripId: string) {
  const row = (await db.query<{ id: string; created_at: Date; expires_at: Date | null }>(
    `select id, created_at, expires_at from route_change_proposals where trip_id=$1 and status='pending' limit 1`, [tripId]
  )).rows[0];
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    counts: await routeChangeCounts(db, row.id)
  };
}

export type { LiveFix, RouteModel };
export { currentProgress };
