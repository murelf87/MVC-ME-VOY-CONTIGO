import type { Pool } from "pg";
import type { AuthPrincipal } from "../../auth/session.js";
import { writeAudit } from "../../lib/audit.js";
import {
  addDays, iso, isIsoDate, isLocalTime, localDateOf, madridLocalToUtc, requireRole, sortWeekdays, WORKDAYS
} from "./common.js";
import { assertDriverReady } from "./driver-service.js";
import { err } from "./errors.js";
import { withIdempotency } from "./idempotency.js";
import {
  computeLegPlan, loadProvince, nextDepartureFor, plannedRouteOf, pointsFromBody, type LegPlan, type PlannerDeps, type PlanPoint
} from "./route-planner.js";
import { horizonDate, insertTripFromTemplate, materializeSeries, type TripTemplate } from "./series-service.js";
import type { IsoDate, PublishedTripRef, PublishRouteBody, PublishRouteResponse, TripLeg, TripStatus, Weekday } from "./types.js";

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** Plantilla de un sentido: paradas (con desvío de las opcionales), geometría COMPLETA y tramos del proveedor. */
export function templateOf(plan: LegPlan): TripTemplate {
  return {
    stops: plan.points.map((point, index) => ({
      lat: point.lat,
      lng: point.lng,
      label: point.label,
      kind: point.kind,
      optional: point.optional,
      detourMinutes: plan.detours[index] ?? null
    })),
    route: {
      geometry: plan.route.geometry,
      distanceM: Math.max(1, Math.round(plan.route.distanceMeters)),
      durationS: Math.max(1, Math.round(plan.route.durationSeconds)),
      provider: plan.route.provider,
      providerRef: plan.route.providerRef
    },
    segments: plan.segments.map(segment => ({
      distanceM: Math.max(1, Math.round(segment.distanceMeters)),
      durationS: Math.max(1, Math.round(segment.durationSeconds))
    }))
  };
}

/** La vuelta recorre las MISMAS paradas en sentido contrario (se calcula de forma independiente). */
export function reversePoints(points: readonly PlanPoint[]): PlanPoint[] {
  const reversed = [...points].reverse();
  return reversed.map((point, index) => ({
    ...point,
    kind: index === 0 ? "origin" : index === reversed.length - 1 ? "destination" : "stop"
  }));
}

type Checked = {
  frequency: PublishRouteBody["frequency"];
  startDate: IsoDate;
  endDate: IsoDate | null;
  weekdays: Weekday[];
};

function validateSchedule(body: PublishRouteBody, now: Date): Checked {
  if (!isLocalTime(body.outboundLocal)) throw err("INVALID_TIME", 422, "La hora de ida no es válida (usa HH:mm).");
  if (body.returnLocal !== undefined && body.returnLocal !== null && !isLocalTime(body.returnLocal)) {
    throw err("INVALID_TIME", 422, "La hora de vuelta no es válida (usa HH:mm).");
  }
  const today = localDateOf(now);
  let startDate: IsoDate;
  if (body.frequency === "one_off") {
    if (body.startDate === undefined) throw err("ONE_OFF_DATE_REQUIRED", 422, "Indica el día del viaje puntual.");
    startDate = body.startDate;
  } else {
    startDate = body.startDate ?? today;
  }
  if (!isIsoDate(startDate)) throw err("INVALID_DATE_RANGE", 422, "La fecha de inicio no es válida.");
  if (startDate < today) throw err("PUBLISH_START_DATE_IN_PAST", 422, "La fecha de inicio no puede estar en el pasado.");
  if (startDate > addDays(today, 90)) throw err("INVALID_DATE_RANGE", 422, "Solo se puede publicar con hasta 90 días de antelación.");
  let endDate: IsoDate | null = null;
  if (body.endDate !== undefined && body.endDate !== null) {
    if (body.frequency === "one_off") throw err("INVALID_DATE_RANGE", 422, "Un viaje puntual no tiene fecha de fin.");
    if (!isIsoDate(body.endDate) || body.endDate < startDate) {
      throw err("INVALID_DATE_RANGE", 422, "La fecha de fin no puede ser anterior a la de inicio.");
    }
    endDate = body.endDate;
  }
  const weekdays = sortWeekdays([...new Set<Weekday>(body.weekdays ?? WORKDAYS)]);
  if (weekdays.length === 0) throw err("INVALID_DATE_RANGE", 422, "Elige al menos un día de la semana.");
  return { frequency: body.frequency, startDate, endDate, weekdays };
}

/**
 * `POST /v1/me/routes` — «Guardar ruta». RECALCULA todo en el servidor (no confía en ningún plan previo) y aplica la
 * puerta de publicación. Un viaje puntual crea `trips` sueltos (`kind:"single"`); «Diaria (laborables)» crea una serie
 * y materializa sus ocurrencias en una ventana móvil. No se publican ocurrencias pasadas.
 */
export async function publishRoute(
  pool: Pool,
  deps: PlannerDeps,
  principal: AuthPrincipal,
  body: PublishRouteBody,
  idempotencyKey: string | undefined
) {
  requireRole(principal, "driver", "Necesitas el rol de conductor para publicar rutas.");
  return withIdempotency(
    pool,
    { userId: principal.userId, scope: "route:publish", key: idempotencyKey, fingerprintOf: body },
    async client => {
      const now = new Date();
      const schedule = validateSchedule(body, now);
      const points = pointsFromBody(body);

      const vehicle = (await client.query<{ driver_user_id: string; passenger_seats: number }>(
        `select driver_user_id, passenger_seats from vehicles where id = $1`, [body.vehicleId]
      )).rows[0];
      if (!vehicle) throw err("VEHICLE_NOT_FOUND", 404, "El vehículo no existe.");
      if (vehicle.driver_user_id !== principal.userId) throw err("VEHICLE_NOT_OWNED", 403, "Ese vehículo no es tuyo.");
      if (body.seats > vehicle.passenger_seats) {
        throw err("OFFERED_SEATS_EXCEED_VEHICLE", 422, "Ofreces más plazas de las que tiene tu vehículo.", {
          offered: body.seats, vehicleSeats: vehicle.passenger_seats
        });
      }
      await assertDriverReady(client, principal.userId, body.vehicleId);
      const province = await loadProvince(client, body.provinceId);

      const oneOff = schedule.frequency === "one_off";
      const outboundAt = oneOff ? madridLocalToUtc(schedule.startDate, body.outboundLocal) : nextDepartureFor(body.outboundLocal, now);
      if (oneOff && outboundAt.getTime() <= now.getTime()) {
        throw err("PUBLISH_START_DATE_IN_PAST", 422, "La hora de salida de ese día ya ha pasado.");
      }
      const outbound = await computeLegPlan(pool, deps, province.id, points, outboundAt);

      let returnPlan: LegPlan | null = null;
      if (body.returnLocal !== undefined && body.returnLocal !== null) {
        const arrival = minutesOf(body.outboundLocal) + Math.ceil(outbound.route.durationSeconds / 60);
        if (minutesOf(body.returnLocal) < arrival) {
          throw err("INVALID_TIME", 422, "La vuelta debe salir después de que llegue la ida (el mismo día).");
        }
        const returnAt = oneOff ? madridLocalToUtc(schedule.startDate, body.returnLocal) : nextDepartureFor(body.returnLocal, now);
        returnPlan = await computeLegPlan(pool, deps, province.id, reversePoints(points), returnAt);
      }

      const outboundTemplate = templateOf(outbound);
      const returnTemplate = returnPlan ? templateOf(returnPlan) : null;
      const common = {
        driverUserId: principal.userId,
        vehicleId: body.vehicleId,
        provinceId: province.id,
        category: body.category,
        flexibilityMinutes: body.flexibilityMinutes ?? 0,
        maxDetourMinutes: body.maxDetourMinutes,
        pickupOnRoute: body.pickupOnRoute,
        seats: body.seats
      };

      let seriesId: string | null = null;
      let horizonUntil: IsoDate | null = null;
      let occurrencesCreated = 0;
      let trips: PublishedTripRef[] = [];

      if (oneOff) {
        const created: Array<{ id: string; leg: TripLeg; departureAt: Date }> = [];
        const outId = await insertTripFromTemplate(client, {
          ...common, kind: "single", leg: "outbound", departureAt: outboundAt, seriesId: null, template: outboundTemplate
        });
        if (outId) created.push({ id: outId, leg: "outbound", departureAt: outboundAt });
        if (returnTemplate && body.returnLocal) {
          const returnAt = madridLocalToUtc(schedule.startDate, body.returnLocal);
          const retId = await insertTripFromTemplate(client, {
            ...common, kind: "single", leg: "return", departureAt: returnAt, seriesId: null, template: returnTemplate
          });
          if (retId) created.push({ id: retId, leg: "return", departureAt: returnAt });
        }
        occurrencesCreated = created.length;
        trips = created.map(item => ({ id: item.id, leg: item.leg, departureAt: iso(item.departureAt), status: "published" as TripStatus }));
      } else {
        const inserted = await client.query<{ id: string }>(
          `insert into trip_series(
             driver_user_id, vehicle_id, province_id, category, status, frequency, weekdays, outbound_local, return_local,
             seats, max_detour_minutes, pickup_on_route, flexibility_minutes, start_date, end_date, outbound_template, return_template
           ) values($1,$2,$3,$4,'active','daily_workdays',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb)
           returning id`,
          [
            principal.userId, body.vehicleId, province.id, body.category, schedule.weekdays, body.outboundLocal,
            body.returnLocal ?? null, body.seats, body.maxDetourMinutes, body.pickupOnRoute, body.flexibilityMinutes ?? 0,
            schedule.startDate, schedule.endDate, JSON.stringify(outboundTemplate),
            returnTemplate ? JSON.stringify(returnTemplate) : null
          ]
        );
        seriesId = inserted.rows[0]!.id;
        const horizon = horizonDate(now);
        await materializeSeries(client, seriesId, horizon, now);
        const summary = await client.query<{ n: number; until: string | null }>(
          `select (select count(*)::int from trips where series_id = $1) as n,
                  (select materialized_until::text from trip_series where id = $1) as until`,
          [seriesId]
        );
        occurrencesCreated = summary.rows[0]?.n ?? 0;
        horizonUntil = summary.rows[0]?.until ?? null;
        if (occurrencesCreated === 0 && schedule.endDate !== null && schedule.endDate <= horizon) {
          throw err("PUBLISH_START_DATE_IN_PAST", 422, "Con esas fechas y días no queda ninguna salida futura que publicar.");
        }
        const first = await client.query<{ id: string; leg: TripLeg; departure_at: Date; status: TripStatus }>(
          `select distinct on (leg) id, leg, departure_at, status from trips where series_id = $1 order by leg, departure_at`,
          [seriesId]
        );
        trips = first.rows.map(row => ({ id: row.id, leg: row.leg, departureAt: iso(row.departure_at), status: row.status }));
      }

      await writeAudit(client, {
        actorUserId: principal.userId,
        action: "route.published",
        entityType: seriesId ? "trip_series" : "trip",
        entityId: seriesId ?? trips[0]?.id ?? null,
        metadata: {
          frequency: body.frequency, vehicleId: body.vehicleId, provinceId: province.id, category: body.category,
          distanceM: outboundTemplate.route.distanceM, occurrencesCreated, hasReturn: returnTemplate !== null,
          tripIds: trips.map(trip => trip.id)
        }
      });

      const response: PublishRouteResponse = {
        seriesId,
        frequency: body.frequency,
        trips,
        occurrencesCreated,
        horizonUntil,
        route: await plannedRouteOf(client, outbound)
      };
      return { status: 201, body: response };
    }
  );
}
