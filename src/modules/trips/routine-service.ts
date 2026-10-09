import type { Pool } from "pg";
import type { AuthPrincipal } from "../../auth/session.js";
import { writeAudit } from "../../lib/audit.js";
import { moneyPending } from "../../lib/dto.js";
import {
  addDays, isIsoDate, isLocalTime, localDateOf, mondayOf, requireRole, sortWeekdays, tx, WEEKDAY_ORDER, WORKDAYS
} from "./common.js";
import { err } from "./errors.js";
import { FAVORITE_SELECT, toFavorite } from "./favorites-service.js";
import { LIMITS } from "./settings.js";
import { withdrawPendingInReservation } from "./weekly.js";
import type {
  CreateRoutineEntryBody, FavoritePlace, IsoDate, RoutineEntry, RoutineResponse, RoutineSuspension, UpdateRoutineEntryBody,
  UpdateWeeklySeatOfferBody, Weekday, WeeklySeatOffer
} from "./types.js";

type EntryRow = {
  id: string;
  weekday: Weekday;
  time_local: string;
  from_id: string;
  from_kind: FavoritePlace["kind"];
  from_name: string;
  to_id: string;
  to_kind: FavoritePlace["kind"];
  to_name: string;
  enabled: boolean;
};

const ENTRY_SELECT = `
  select e.id, e.weekday, e.time_local::text as time_local, e.enabled,
         f.id as from_id, f.kind as from_kind, f.name as from_name,
         t.id as to_id, t.kind as to_kind, t.name as to_name
    from routine_entries e
    join favorite_places f on f.id = e.from_place_id
    join favorite_places t on t.id = e.to_place_id`;

function toEntry(row: EntryRow): RoutineEntry {
  return {
    id: row.id,
    weekday: row.weekday,
    time: row.time_local.slice(0, 5),
    fromPlace: { id: row.from_id, kind: row.from_kind, name: row.from_name },
    toPlace: { id: row.to_id, kind: row.to_kind, name: row.to_name },
    enabled: row.enabled
  };
}

function sortEntries(rows: EntryRow[]): EntryRow[] {
  return [...rows].sort((a, b) =>
    WEEKDAY_ORDER.indexOf(a.weekday) - WEEKDAY_ORDER.indexOf(b.weekday) ||
    (a.time_local < b.time_local ? -1 : a.time_local > b.time_local ? 1 : 0) ||
    (a.id < b.id ? -1 : 1));
}

const weekEnd = (weekStart: IsoDate): IsoDate => addDays(weekStart, 6);

/** Lunes de la próxima semana (Europe/Madrid). */
export function nextWeekStart(now: Date): IsoDate {
  return addDays(mondayOf(localDateOf(now)), 7);
}

/* ───────────────────────────── Plaza semanal ofrecida ───────────────────────────── */

type OfferRow = { enabled: boolean; seats: number; weekdays: Weekday[] };

function buildOffer(offer: OfferRow | undefined, entries: readonly EntryRow[], places: ReadonlyMap<string, FavoritePlace>): WeeklySeatOffer {
  const enabledEntries = entries.filter(entry => entry.enabled);
  // Los días ofrecidos salen de la rutina activa; sin rutina, lo guardado (por defecto lunes a viernes).
  const routineDays = sortWeekdays([...new Set(enabledEntries.map(entry => entry.weekday))]);
  const weekdays = routineDays.length > 0 ? routineDays : sortWeekdays(offer?.weekdays ?? [...WORKDAYS]);
  const seats = offer?.seats ?? 1;

  // «Publica tu ruta» desde la rutina: el trayecto (hora + origen + destino) que se repite en más días.
  const groups = new Map<string, EntryRow[]>();
  for (const entry of enabledEntries) {
    const key = `${entry.time_local}|${entry.from_id}|${entry.to_id}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const best = [...groups.values()].sort((a, b) =>
    b.length - a.length || (a[0]!.time_local < b[0]!.time_local ? -1 : 1))[0];
  let prefill: WeeklySeatOffer["prefill"] = null;
  if (best) {
    const sample = best[0]!;
    const from = places.get(sample.from_id);
    const to = places.get(sample.to_id);
    if (from && to) {
      prefill = {
        frequency: "daily_workdays",
        outboundLocal: sample.time_local.slice(0, 5),
        weekdays: sortWeekdays(best.map(entry => entry.weekday)),
        seats,
        origin: { lat: from.location.lat, lng: from.location.lng, label: from.name },
        destination: { lat: to.location.lat, lng: to.location.lng, label: to.name }
      };
    }
  }
  return {
    enabled: offer?.enabled ?? false,
    seats,
    weekdays,
    conditions: { label: "Propuesta", price: moneyPending() },
    prefill
  };
}

/* ───────────────────────────── Lectura ───────────────────────────── */

export async function getRoutine(pool: Pool, principal: AuthPrincipal, now = new Date()): Promise<RoutineResponse> {
  const userId = principal.userId;
  const [places, entries, suspensions, offer] = await Promise.all([
    pool.query(`${FAVORITE_SELECT} where f.user_id = $1 order by f.created_at, f.id`, [userId]),
    pool.query<EntryRow>(`${ENTRY_SELECT} where e.user_id = $1`, [userId]),
    pool.query<{ week_start: string }>(
      `select week_start::text as week_start from routine_suspensions where user_id = $1 and week_start >= $2::date order by week_start`,
      [userId, mondayOf(localDateOf(now))]
    ),
    pool.query<OfferRow>(`select enabled, seats, weekdays from weekly_seat_offers where user_id = $1`, [userId])
  ]);
  const placeList = places.rows.map(toFavorite);
  const sorted = sortEntries(entries.rows);
  const next = nextWeekStart(now);
  return {
    places: placeList,
    entries: sorted.map(toEntry),
    suspensions: suspensions.rows.map(row => ({ weekStart: row.week_start, weekEnd: weekEnd(row.week_start) })),
    nextWeek: { weekStart: next, weekEnd: weekEnd(next), suspended: suspensions.rows.some(row => row.week_start === next) },
    weeklyOffer: buildOffer(offer.rows[0], sorted, new Map(placeList.map(place => [place.id, place])))
  };
}

/* ───────────────────────────── Filas de rutina ───────────────────────────── */

async function assertOwnPlaces(db: Pick<Pool, "query">, userId: string, ids: readonly string[]): Promise<void> {
  const found = await db.query<{ id: string }>(
    `select id from favorite_places where user_id = $1 and id = any($2::uuid[])`, [userId, [...new Set(ids)]]
  );
  if (found.rowCount !== new Set(ids).size) throw err("FAVORITE_NOT_FOUND", 404, "Alguno de los destinos no existe.");
}

export async function createRoutineEntries(
  pool: Pool, principal: AuthPrincipal, body: CreateRoutineEntryBody
): Promise<RoutineEntry[]> {
  if (!isLocalTime(body.time)) throw err("INVALID_TIME", 422, "La hora no es válida (usa HH:mm).");
  if (body.fromPlaceId === body.toPlaceId) throw err("ROUTINE_SAME_PLACE", 422, "El origen y el destino no pueden ser el mismo lugar.");
  const weekdays = sortWeekdays([...new Set(body.weekdays)]);
  if (weekdays.length === 0) throw err("VALIDATION_ERROR", 400, "Elige al menos un día de la semana.");
  return tx(pool, async client => {
    await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`routine:${principal.userId}`]);
    await assertOwnPlaces(client, principal.userId, [body.fromPlaceId, body.toPlaceId]);
    const count = await client.query<{ n: number }>(`select count(*)::int as n from routine_entries where user_id = $1`, [principal.userId]);
    if ((count.rows[0]?.n ?? 0) + weekdays.length > LIMITS.maxRoutineEntries) {
      throw err("ROUTINE_LIMIT_REACHED", 409, `Tu rutina admite hasta ${LIMITS.maxRoutineEntries} filas.`);
    }
    const clash = await client.query<{ weekday: Weekday }>(
      `select weekday from routine_entries
        where user_id = $1 and time_local = $2::time and from_place_id = $3 and to_place_id = $4 and weekday = any($5::text[])`,
      [principal.userId, body.time, body.fromPlaceId, body.toPlaceId, weekdays]
    );
    if (clash.rowCount) {
      throw err("ROUTINE_ENTRY_EXISTS", 409, "Ya tienes ese trayecto a esa hora en alguno de los días elegidos.", {
        weekdays: sortWeekdays(clash.rows.map(row => row.weekday))
      });
    }
    const inserted = await client.query<{ id: string }>(
      `insert into routine_entries(user_id, weekday, time_local, from_place_id, to_place_id, enabled)
       select $1::uuid, d, $3::time, $4::uuid, $5::uuid, $6::boolean from unnest($2::text[]) as d
       returning id`,
      [principal.userId, weekdays, body.time, body.fromPlaceId, body.toPlaceId, body.enabled ?? true]
    );
    const rows = await client.query<EntryRow>(`${ENTRY_SELECT} where e.user_id = $1 and e.id = any($2::uuid[])`, [
      principal.userId, inserted.rows.map(row => row.id)
    ]);
    return sortEntries(rows.rows).map(toEntry);
  });
}

export async function updateRoutineEntry(
  pool: Pool, principal: AuthPrincipal, entryId: string, body: UpdateRoutineEntryBody
): Promise<RoutineEntry> {
  if (body.time === undefined && body.fromPlaceId === undefined && body.toPlaceId === undefined && body.enabled === undefined) {
    throw err("EMPTY_UPDATE", 422, "Indica al menos un campo que cambiar.");
  }
  if (body.time !== undefined && !isLocalTime(body.time)) throw err("INVALID_TIME", 422, "La hora no es válida (usa HH:mm).");
  return tx(pool, async client => {
    const current = await client.query<{ weekday: Weekday; time_local: string; from_place_id: string; to_place_id: string; enabled: boolean }>(
      `select weekday, time_local::text as time_local, from_place_id, to_place_id, enabled
         from routine_entries where id = $1 and user_id = $2 for update`,
      [entryId, principal.userId]
    );
    const row = current.rows[0];
    if (!row) throw err("ROUTINE_ENTRY_NOT_FOUND", 404, "La fila de la rutina no existe.");
    const time = body.time ?? row.time_local.slice(0, 5);
    const fromId = body.fromPlaceId ?? row.from_place_id;
    const toId = body.toPlaceId ?? row.to_place_id;
    if (fromId === toId) throw err("ROUTINE_SAME_PLACE", 422, "El origen y el destino no pueden ser el mismo lugar.");
    if (body.fromPlaceId !== undefined || body.toPlaceId !== undefined) await assertOwnPlaces(client, principal.userId, [fromId, toId]);
    const clash = await client.query(
      `select 1 from routine_entries
        where user_id = $1 and id <> $2 and weekday = $3 and time_local = $4::time and from_place_id = $5 and to_place_id = $6`,
      [principal.userId, entryId, row.weekday, time, fromId, toId]
    );
    if (clash.rowCount) throw err("ROUTINE_ENTRY_EXISTS", 409, "Ya tienes ese trayecto a esa hora ese día.", { weekdays: [row.weekday] });
    await client.query(
      `update routine_entries set time_local = $3::time, from_place_id = $4, to_place_id = $5, enabled = $6, updated_at = now()
        where id = $1 and user_id = $2`,
      [entryId, principal.userId, time, fromId, toId, body.enabled ?? row.enabled]
    );
    const updated = await client.query<EntryRow>(`${ENTRY_SELECT} where e.id = $1`, [entryId]);
    return toEntry(updated.rows[0]!);
  });
}

export async function deleteRoutineEntry(pool: Pool, principal: AuthPrincipal, entryId: string): Promise<void> {
  const removed = await pool.query(`delete from routine_entries where id = $1 and user_id = $2`, [entryId, principal.userId]);
  if (!removed.rowCount) throw err("ROUTINE_ENTRY_NOT_FOUND", 404, "La fila de la rutina no existe.");
}

/* ───────────────────────────── «Suspender próxima semana» ───────────────────────────── */

export type SuspensionResult = {
  suspension: RoutineSuspension;
  withdrawnRequests: number;
  keptRequests: number;
  created: boolean;
};

/**
 * Suspende una semana de la rutina del pasajero. Efecto REAL: se retiran las solicitudes semanales aún `pending` de esa
 * semana; las ya aceptadas o confirmadas no se tocan (su cancelación sigue la política de `money`) y se cuentan en
 * `keptRequests` para que la app ofrezca «Cancelar reservas confirmadas». Idempotente.
 */
export async function createSuspension(
  pool: Pool, principal: AuthPrincipal, weekStartInput: string | undefined, now = new Date()
): Promise<SuspensionResult> {
  const today = localDateOf(now);
  const weekStart = weekStartInput ?? nextWeekStart(now);
  if (!isIsoDate(weekStart) || weekStart !== mondayOf(weekStart)) {
    throw err("INVALID_WEEK_START", 422, "La semana debe empezar en lunes.");
  }
  if (weekEnd(weekStart) < today) throw err("INVALID_WEEK_START", 422, "No se puede suspender una semana que ya ha pasado.");
  if (weekStart > addDays(today, 365)) throw err("INVALID_WEEK_START", 422, "Esa semana queda demasiado lejos.");
  const end = weekEnd(weekStart);

  return tx(pool, async client => {
    const inserted = await client.query(
      `insert into routine_suspensions(user_id, week_start) values($1,$2) on conflict do nothing returning 1`,
      [principal.userId, weekStart]
    );
    const created = (inserted.rowCount ?? 0) > 0;
    let withdrawn = 0;
    // Aunque la suspensión ya existiera, se reintenta retirar lo que siga pendiente (p. ej. reservas creadas después).
    const reservations = await client.query<{ id: string }>(
      `select distinct w.id
         from weekly_reservations w
         join ride_requests r on r.weekly_reservation_id = w.id
         join trips t on t.id = r.trip_id
        where w.passenger_user_id = $1 and r.status = 'pending' and t.service_date between $2::date and $3::date
        order by w.id`,
      [principal.userId, weekStart, end]
    );
    for (const reservation of reservations.rows) {
      withdrawn += (await withdrawPendingInReservation(client, reservation.id, principal.userId, { from: weekStart, to: end })).length;
    }
    const kept = await client.query<{ n: number }>(
      `select count(*)::int as n
         from ride_requests r join trips t on t.id = r.trip_id
        where r.passenger_user_id = $1 and r.status in ('accepted','payment_pending','confirmed')
          and t.service_date between $2::date and $3::date`,
      [principal.userId, weekStart, end]
    );
    if (created || withdrawn > 0) {
      await writeAudit(client, {
        actorUserId: principal.userId, action: "routine.suspended", entityType: "routine_suspension", entityId: weekStart,
        metadata: { weekStart, withdrawnRequests: withdrawn, keptRequests: kept.rows[0]?.n ?? 0 }
      });
    }
    return {
      suspension: { weekStart, weekEnd: end },
      withdrawnRequests: withdrawn,
      keptRequests: kept.rows[0]?.n ?? 0,
      created
    };
  });
}

export async function deleteSuspension(pool: Pool, principal: AuthPrincipal, weekStart: string): Promise<void> {
  if (!isIsoDate(weekStart) || weekStart !== mondayOf(weekStart)) {
    throw err("INVALID_WEEK_START", 422, "La semana debe empezar en lunes.");
  }
  await pool.query(`delete from routine_suspensions where user_id = $1 and week_start = $2`, [principal.userId, weekStart]);
}

/* ───────────────────────────── «Plaza disponible (semanal)» ───────────────────────────── */

/** Preferencia del conductor. No publica nada por sí misma: `prefill` entrega el cuerpo para abrir «Publica tu ruta». */
export async function putWeeklyOffer(pool: Pool, principal: AuthPrincipal, body: UpdateWeeklySeatOfferBody): Promise<WeeklySeatOffer> {
  requireRole(principal, "driver", "Necesitas el rol de conductor para ofrecer una plaza semanal.");
  const entries = await pool.query<EntryRow>(`${ENTRY_SELECT} where e.user_id = $1 and e.enabled`, [principal.userId]);
  const days = sortWeekdays([...new Set(entries.rows.map(row => row.weekday))]);
  const weekdays = days.length > 0 ? days : [...WORKDAYS];
  await pool.query(
    `insert into weekly_seat_offers(user_id, enabled, seats, weekdays, updated_at) values($1,$2,$3,$4,now())
     on conflict (user_id) do update set enabled = excluded.enabled, seats = excluded.seats, weekdays = excluded.weekdays, updated_at = now()`,
    [principal.userId, body.enabled, body.seats, weekdays]
  );
  const [places, all, offer] = await Promise.all([
    pool.query(`${FAVORITE_SELECT} where f.user_id = $1`, [principal.userId]),
    pool.query<EntryRow>(`${ENTRY_SELECT} where e.user_id = $1`, [principal.userId]),
    pool.query<OfferRow>(`select enabled, seats, weekdays from weekly_seat_offers where user_id = $1`, [principal.userId])
  ]);
  return buildOffer(offer.rows[0], sortEntries(all.rows), new Map(places.rows.map(toFavorite).map(place => [place.id, place])));
}
