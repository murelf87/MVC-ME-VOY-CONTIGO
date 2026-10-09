import type { Pool, PoolClient } from "pg";
import { addDays, localDateOf, madridLocalToUtc, tx, WEEKDAY_ORDER } from "./common.js";
import { tripsSettings } from "./settings.js";
import type { IsoDate, LocalTime, TripCategory, TripLeg, Weekday } from "./types.js";

/** Plantilla de un sentido (ida o vuelta): paradas, geometría de la ruta y tramos del proveedor de rutas. */
export type TemplateStop = {
  lat: number;
  lng: number;
  label: string | null;
  kind: "origin" | "pickup" | "stop" | "dropoff" | "destination";
  optional: boolean;
  detourMinutes: number | null;
};

export type TripTemplate = {
  stops: TemplateStop[];
  route: {
    geometry: { type: "LineString"; coordinates: [number, number][] };
    distanceM: number;
    durationS: number;
    provider: string;
    providerRef: string;
  };
  segments: { distanceM: number; durationS: number }[];
};

export type SeriesRow = {
  id: string;
  driver_user_id: string;
  vehicle_id: string;
  province_id: string;
  category: TripCategory;
  status: "active" | "paused" | "ended";
  frequency: "daily_workdays" | "one_off";
  weekdays: Weekday[];
  outbound_local: LocalTime;
  return_local: LocalTime | null;
  seats: number;
  max_detour_minutes: number;
  pickup_on_route: boolean;
  flexibility_minutes: number;
  start_date: IsoDate;
  end_date: IsoDate | null;
  outbound_template: TripTemplate;
  return_template: TripTemplate | null;
  materialized_until: IsoDate | null;
};

export const SERIES_SELECT = `
  select id, driver_user_id, vehicle_id, province_id, category, status, frequency, weekdays,
         outbound_local::text as outbound_local, return_local::text as return_local, seats,
         max_detour_minutes, pickup_on_route, flexibility_minutes,
         start_date::text as start_date, end_date::text as end_date,
         outbound_template, return_template, materialized_until::text as materialized_until
    from trip_series`;

function hhmm(value: string): LocalTime {
  return value.slice(0, 5);
}

/** Convierte una fila de BD en `SeriesRow` normalizando las horas a «HH:mm». */
export function normalizeSeries(row: SeriesRow): SeriesRow {
  return { ...row, outbound_local: hhmm(row.outbound_local), return_local: row.return_local ? hhmm(row.return_local) : null };
}

/**
 * Inserta un viaje real (`published`) con sus paradas y tramos a partir de una plantilla.
 * Devuelve el id, o null si ya existía la ocurrencia (índice único serie/sentido/día → idempotente).
 */
export async function insertTripFromTemplate(
  client: PoolClient,
  input: {
    driverUserId: string;
    vehicleId: string;
    provinceId: string;
    category: TripCategory;
    kind: "single" | "recurring";
    leg: TripLeg;
    departureAt: Date;
    flexibilityMinutes: number;
    maxDetourMinutes: number;
    pickupOnRoute: boolean;
    seats: number;
    seriesId: string | null;
    template: TripTemplate;
  }
): Promise<string | null> {
  const { template } = input;
  const first = template.stops[0]!;
  const last = template.stops[template.stops.length - 1]!;
  const inserted = await client.query<{ id: string }>(
    `insert into trips(
       driver_user_id, vehicle_id, province_id, category, kind, leg, status, departure_at,
       flexibility_minutes, max_detour_m, max_detour_minutes, pickup_on_route, offered_seats,
       origin_geom, destination_geom, route_geom, route_distance_m, route_duration_s, route_provider, route_provider_ref,
       series_id
     ) values(
       $1,$2,$3,$4,$5,$6,'published',$7,
       $8,$9,$10,$11,$12,
       ST_SetSRID(ST_Point($13,$14),4326), ST_SetSRID(ST_Point($15,$16),4326),
       ST_SetSRID(ST_GeomFromGeoJSON($17),4326)::geometry(LineString,4326), $18,$19,$20,$21,
       $22
     )
     on conflict (series_id, leg, service_date) where series_id is not null do nothing
     returning id`,
    [
      input.driverUserId, input.vehicleId, input.provinceId, input.category, input.kind, input.leg,
      input.departureAt.toISOString(), input.flexibilityMinutes, input.maxDetourMinutes * 500, input.maxDetourMinutes,
      input.pickupOnRoute, input.seats, first.lng, first.lat, last.lng, last.lat,
      JSON.stringify(template.route.geometry), template.route.distanceM, template.route.durationS,
      template.route.provider, template.route.providerRef, input.seriesId
    ]
  );
  const id = inserted.rows[0]?.id;
  if (!id) return null;
  await client.query(
    `insert into trip_stops(trip_id, seq, kind, label, geom, optional, detour_minutes)
     select $1::uuid, s.seq - 1, s.kind, s.label, ST_SetSRID(ST_Point(s.lng, s.lat), 4326), s.optional, s.detour
       from unnest($2::text[], $3::text[], $4::float8[], $5::float8[], $6::boolean[], $7::int[])
            with ordinality as s(kind, label, lat, lng, optional, detour, seq)`,
    [
      id,
      template.stops.map(stop => stop.kind),
      template.stops.map(stop => stop.label),
      template.stops.map(stop => stop.lat),
      template.stops.map(stop => stop.lng),
      template.stops.map(stop => stop.optional),
      template.stops.map(stop => stop.detourMinutes)
    ]
  );
  await client.query(
    `insert into trip_segments(trip_id, seq, from_stop_seq, to_stop_seq, distance_m, duration_s, capacity)
     select $1::uuid, s.seq - 1, s.seq - 1, s.seq, s.distance, s.duration, $4::int
       from unnest($2::int[], $3::int[]) with ordinality as s(distance, duration, seq)`,
    [id, template.segments.map(segment => segment.distanceM), template.segments.map(segment => segment.durationS), input.seats]
  );
  return id;
}

/**
 * Materializa las ocurrencias de una serie hasta `untilDate` (inclusive, Europe/Madrid). Idempotente y segura en
 * concurrencia: un cerrojo consultivo por serie + índice único (serie, sentido, día). No crea ocurrencias pasadas.
 * Devuelve cuántas ocurrencias nuevas se han creado.
 */
export async function materializeSeries(client: PoolClient, seriesId: string, untilDate: IsoDate, now = new Date()): Promise<number> {
  await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`trip_series:${seriesId}`]);
  const found = await client.query<SeriesRow>(`${SERIES_SELECT} where id = $1`, [seriesId]);
  const raw = found.rows[0];
  if (!raw || raw.status !== "active") return 0;
  const series = normalizeSeries(raw);
  const today = localDateOf(now);
  let first = series.start_date > today ? series.start_date : today;
  if (series.materialized_until) {
    // Solo se materializa lo que falta: lo ya creado hasta `materialized_until` no se vuelve a intentar.
    const next = addDays(series.materialized_until, 1);
    if (next > first) first = next;
  }
  const lastDay = series.end_date && series.end_date < untilDate ? series.end_date : untilDate;
  let created = 0;
  for (let date = first; date <= lastDay; date = addDays(date, 1)) {
    const weekday = WEEKDAY_ORDER[(new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7]!;
    if (!series.weekdays.includes(weekday)) continue;
    const legs: Array<{ leg: TripLeg; time: LocalTime; template: TripTemplate }> = [
      { leg: "outbound", time: series.outbound_local, template: series.outbound_template }
    ];
    if (series.return_local && series.return_template) {
      legs.push({ leg: "return", time: series.return_local, template: series.return_template });
    }
    for (const entry of legs) {
      const departureAt = madridLocalToUtc(date, entry.time);
      if (departureAt.getTime() <= now.getTime()) continue;
      const id = await insertTripFromTemplate(client, {
        driverUserId: series.driver_user_id,
        vehicleId: series.vehicle_id,
        provinceId: series.province_id,
        category: series.category,
        kind: series.frequency === "one_off" ? "single" : "recurring",
        leg: entry.leg,
        departureAt,
        flexibilityMinutes: series.flexibility_minutes,
        maxDetourMinutes: series.max_detour_minutes,
        pickupOnRoute: series.pickup_on_route,
        seats: series.seats,
        seriesId: series.id,
        template: entry.template
      });
      if (id) created += 1;
    }
  }
  if (lastDay >= first) {
    await client.query(
      `update trip_series
          set materialized_until = greatest(coalesce(materialized_until, $2::date), $2::date), updated_at = now()
        where id = $1`,
      [seriesId, lastDay]
    );
  }
  return created;
}

/** Amplía la ventana de todas las series activas hasta hoy + horizonte. Lo ejecuta el barrido interno. */
export async function extendSeriesHorizon(pool: Pool, now = new Date()): Promise<number> {
  const horizon = addDays(localDateOf(now), tripsSettings().horizonDays);
  const due = await pool.query<{ id: string }>(
    `select id from trip_series
      where status = 'active' and (materialized_until is null or materialized_until < $1::date)
        and (end_date is null or end_date >= $2::date)
      order by materialized_until nulls first
      limit 100`,
    [horizon, localDateOf(now)]
  );
  let created = 0;
  for (const row of due.rows) {
    created += await tx(pool, client => materializeSeries(client, row.id, horizon, now));
  }
  return created;
}

export function horizonDate(now = new Date()): IsoDate {
  return addDays(localDateOf(now), tripsSettings().horizonDays);
}

