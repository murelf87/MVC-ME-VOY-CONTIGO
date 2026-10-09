/**
 * Favoritos y rutina semanal (pantalla 31) en el backend en memoria de la vista previa (SIMULACIÓN, solo con
 * `EXPO_PUBLIC_PREVIEW=1`). Port de las reglas de `docs/contracts/trips.md` §11:
 *
 *   GET|POST /v1/me/favorites · PATCH|DELETE /v1/me/favorites/:id          máx. 20; dentro de una provincia; en uso → 409
 *   GET /v1/me/routine · POST /v1/me/routine/entries · PATCH|DELETE …/:id    máx. 40 filas; duplicado → 409; mismo sitio → 422
 *   POST /v1/me/routine/suspensions · DELETE …/:weekStart                    retira solicitudes semanales pendientes
 *   PUT  /v1/me/routine/weekly-offer                                         preferencia del conductor (1–8 plazas)
 */
import type {
  CreateFavoriteBody,
  CreateRoutineEntryBody,
  CreateRoutineSuspensionBody,
  FavoriteKind,
  FavoritePlace,
  RoutineEntry,
  RoutineResponse,
  RoutineSuspension,
  UpdateFavoriteBody,
  UpdateRoutineEntryBody,
  UpdateWeeklySeatOfferBody,
  Weekday,
  WeeklySeatOffer,
} from "@/api/types";
import {
  addDaysToDate,
  fail,
  isoWeekdayOf,
  madridDate,
  moneyPending,
  pointInRing,
  reply,
  uuidParam,
  writeAudit,
} from "@/preview";
import type { Collection, JsonSchema, PreviewDb, PreviewRouter } from "@/preview";

export const MAX_FAVORITES = 20;
export const MAX_ROUTINE_ENTRIES = 40;
const WEEKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const KINDS: readonly FavoriteKind[] = ["work", "campus", "home", "other"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEK_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface FavoriteRow {
  id: string;
  user_id: string;
  kind: FavoriteKind;
  name: string;
  address: string;
  lat: number;
  lng: number;
  province_id: string | null;
  created_at: number;
}
export interface RoutineEntryRow {
  id: string;
  user_id: string;
  weekday: Weekday;
  time: string;
  from_place_id: string;
  to_place_id: string;
  enabled: boolean;
  created_at: number;
}
export interface SuspensionRow {
  /** `${user_id}:${week_start}` */
  id: string;
  user_id: string;
  week_start: string;
  created_at: number;
}
export interface WeeklyOfferRow {
  /** user_id */
  id: string;
  enabled: boolean;
  seats: number;
}

export const favorites = (db: PreviewDb): Collection<FavoriteRow> => db.collection<FavoriteRow>("favorite_places");
export const entries = (db: PreviewDb): Collection<RoutineEntryRow> => db.collection<RoutineEntryRow>("routine_entries");
export const suspensions = (db: PreviewDb): Collection<SuspensionRow> => db.collection<SuspensionRow>("routine_suspensions");
export const offers = (db: PreviewDb): Collection<WeeklyOfferRow> => db.collection<WeeklyOfferRow>("weekly_seat_offers");

const iso = (ms: number): string => new Date(ms).toISOString();
const clean = (s: string): string => s.replace(/\s+/g, " ").trim();

function favoriteWire(row: Readonly<FavoriteRow>): FavoritePlace {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    address: row.address,
    location: { lat: row.lat, lng: row.lng },
    provinceId: row.province_id,
    createdAt: iso(row.created_at),
  };
}

function entryWire(db: PreviewDb, row: Readonly<RoutineEntryRow>): RoutineEntry {
  const from = favorites(db).get(row.from_place_id);
  const to = favorites(db).get(row.to_place_id);
  const ref = (p: Readonly<FavoriteRow> | undefined, id: string) => ({ id, kind: p?.kind ?? ("other" as FavoriteKind), name: p?.name ?? "" });
  return { id: row.id, weekday: row.weekday, time: row.time, fromPlace: ref(from, row.from_place_id), toPlace: ref(to, row.to_place_id), enabled: row.enabled };
}

function provinceOf(db: PreviewDb, lat: number, lng: number): string | null {
  for (const province of db.provinces.all()) if (pointInRing(lat, lng, province.ring)) return province.id;
  return null;
}

const mine = <T extends { user_id: string }>(rows: readonly T[], userId: string): T[] => rows.filter((r) => r.user_id === userId);

/** Lunes de la próxima semana (Madrid). */
export function nextWeekStart(db: PreviewDb): string {
  const today = madridDate(db.nowMs());
  return addDaysToDate(today, 8 - isoWeekdayOf(today));
}

function sortedEntries(db: PreviewDb, userId: string): RoutineEntryRow[] {
  return mine(entries(db).all(), userId).sort((a, b) => WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday) || a.time.localeCompare(b.time) || a.created_at - b.created_at);
}

function weeklyOfferWire(db: PreviewDb, userId: string): WeeklySeatOffer {
  const row = offers(db).get(userId);
  const list = sortedEntries(db, userId);
  const active = list.filter((e) => e.enabled);
  const days = [...new Set(active.map((e) => e.weekday))].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
  const weekdays: Weekday[] = days.length > 0 ? days : ["mon", "tue", "wed", "thu", "fri"];
  const seats = row?.seats ?? 1;
  // Trayecto de la rutina que más días se repite.
  const counts = new Map<string, { n: number; entry: RoutineEntryRow }>();
  for (const e of active) {
    const key = `${e.from_place_id}|${e.to_place_id}|${e.time}`;
    const cur = counts.get(key);
    counts.set(key, { n: (cur?.n ?? 0) + 1, entry: cur?.entry ?? e });
  }
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  let prefill: WeeklySeatOffer["prefill"] = null;
  if (best !== undefined) {
    const from = favorites(db).get(best.entry.from_place_id);
    const to = favorites(db).get(best.entry.to_place_id);
    if (from !== undefined && to !== undefined) {
      prefill = {
        frequency: "daily_workdays",
        outboundLocal: best.entry.time,
        weekdays,
        seats,
        origin: { lat: from.lat, lng: from.lng, label: from.name },
        destination: { lat: to.lat, lng: to.lng, label: to.name },
      };
    }
  }
  return { enabled: row?.enabled ?? false, seats, weekdays, conditions: { label: "Propuesta", price: moneyPending() }, prefill };
}

function routineWire(db: PreviewDb, userId: string): RoutineResponse {
  const next = nextWeekStart(db);
  const today = madridDate(db.nowMs());
  const future = mine(suspensions(db).all(), userId).filter((s) => s.week_start >= addDaysToDate(today, -6)).sort((a, b) => a.week_start.localeCompare(b.week_start));
  const toSuspension = (weekStart: string): RoutineSuspension => ({ weekStart, weekEnd: addDaysToDate(weekStart, 6) });
  return {
    places: mine(favorites(db).all(), userId).sort((a, b) => a.created_at - b.created_at).map(favoriteWire),
    entries: sortedEntries(db, userId).map((e) => entryWire(db, e)),
    suspensions: future.map((s) => toSuspension(s.week_start)),
    nextWeek: { ...toSuspension(next), suspended: future.some((s) => s.week_start === next) },
    weeklyOffer: weeklyOfferWire(db, userId),
  };
}

/** Retira las solicitudes semanales aún `pending` cuyo viaje sale esa semana; las demás se cuentan como conservadas. */
function withdrawWeek(db: PreviewDb, userId: string, weekStart: string): { withdrawn: number; kept: number } {
  const weekEnd = addDaysToDate(weekStart, 6);
  let withdrawn = 0;
  let kept = 0;
  const now = db.nowMs();
  for (const request of db.rideRequests.filter((r) => r.passenger_user_id === userId && (r.weekly_reservation_id ?? null) !== null)) {
    const trip = db.trips.get(request.trip_id);
    if (trip === undefined || trip.departure_at === null) continue;
    const day = madridDate(trip.departure_at);
    if (day < weekStart || day > weekEnd) continue;
    if (request.status === "pending") {
      const updated = db.rideRequests.update(request.id, { status: "cancelled", updated_at: now });
      db.events.emit("ride_request.withdrawn", { request: updated, trip });
      withdrawn += 1;
    } else if (request.status === "accepted" || request.status === "payment_pending" || request.status === "confirmed") {
      kept += 1;
    }
  }
  return { withdrawn, kept };
}

const weekParam: JsonSchema = { type: "object", required: ["weekStart"], properties: { weekStart: { type: "string" } } };
const pageQuery: JsonSchema = { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 }, cursor: { type: "string", maxLength: 100 } } };

export function registerRoutinePreview(r: PreviewRouter, db: PreviewDb): void {
  // ── Favoritos ────────────────────────────────────────────────────────────────────────────────────────────────
  r.get("/v1/me/favorites", { summary: "Mis destinos", tags: ["trips"], schema: { querystring: pageQuery } }, (req) => {
    const me = req.auth();
    const items = mine(favorites(db).all(), me.userId).sort((a, b) => a.created_at - b.created_at).map(favoriteWire);
    return { items, nextCursor: null };
  });

  r.post<{ Body: CreateFavoriteBody }>(
    "/v1/me/favorites",
    {
      summary: "Añadir destino",
      tags: ["trips"],
      idempotent: true,
      schema: {
        body: {
          type: "object",
          required: ["kind", "name", "address", "lat", "lng"],
          properties: { kind: { type: "string", enum: [...KINDS] }, name: { type: "string" }, address: { type: "string" }, lat: { type: "number" }, lng: { type: "number" } },
        },
      },
    },
    (req) => {
      const me = req.auth();
      const body = req.body;
      const name = clean(body.name);
      const address = clean(body.address);
      if (name.length < 1 || name.length > 60) return fail("INVALID_REQUEST_SHAPE", "El nombre debe tener entre 1 y 60 caracteres.", 422);
      if (address.length < 1 || address.length > 200) return fail("INVALID_REQUEST_SHAPE", "La dirección debe tener entre 1 y 200 caracteres.", 422);
      if (Math.abs(body.lat) > 90 || Math.abs(body.lng) > 180) return fail("INVALID_REQUEST_SHAPE", "Las coordenadas no son válidas.", 422);
      const provinceId = provinceOf(db, body.lat, body.lng);
      if (provinceId === null) return fail("FAVORITE_OUTSIDE_PROVINCES", "Ese punto está fuera de las provincias donde funciona MVC.", 422);
      return db.tx(() => {
        if (mine(favorites(db).all(), me.userId).length >= MAX_FAVORITES) return fail("FAVORITES_LIMIT_REACHED", `Puedes guardar hasta ${MAX_FAVORITES} destinos.`, 409);
        const row = favorites(db).insert({ id: db.ids.uuid(), user_id: me.userId, kind: body.kind, name, address, lat: body.lat, lng: body.lng, province_id: provinceId, created_at: db.nowMs() });
        writeAudit(db, { actorUserId: me.userId, action: "favorite.created", entityType: "favorite", entityId: row.id, requestId: req.requestId });
        return reply.created(favoriteWire(row));
      });
    },
  );

  const ownFavorite = (userId: string, id: string): Readonly<FavoriteRow> => {
    const row = favorites(db).get(id);
    return row !== undefined && row.user_id === userId ? row : fail("FAVORITE_NOT_FOUND", "Ese destino no existe.", 404);
  };

  r.patch<{ Params: { favoriteId: string }; Body: UpdateFavoriteBody }>(
    "/v1/me/favorites/:favoriteId",
    { summary: "Editar destino", tags: ["trips"], schema: { params: uuidParam("favoriteId") } },
    (req) => {
      const me = req.auth();
      const id = req.params.favoriteId;
      const row = ownFavorite(me.userId, id);
      const body = req.body ?? {};
      const keys = Object.keys(body).filter((k) => (body as Record<string, unknown>)[k] !== undefined);
      if (keys.length === 0) return fail("INVALID_REQUEST", "Indica al menos un campo.", 400);
      if ((body.lat === undefined) !== (body.lng === undefined)) return fail("INVALID_REQUEST_SHAPE", "Para mover el destino envía lat y lng juntas.", 422);
      const patch: Partial<FavoriteRow> = {};
      if (body.kind !== undefined) {
        if (!KINDS.includes(body.kind)) return fail("INVALID_REQUEST_SHAPE", "Tipo de destino no válido.", 422);
        patch.kind = body.kind;
      }
      if (body.name !== undefined) {
        const name = clean(body.name);
        if (name.length < 1 || name.length > 60) return fail("INVALID_REQUEST_SHAPE", "El nombre debe tener entre 1 y 60 caracteres.", 422);
        patch.name = name;
      }
      if (body.address !== undefined) {
        const address = clean(body.address);
        if (address.length < 1 || address.length > 200) return fail("INVALID_REQUEST_SHAPE", "La dirección debe tener entre 1 y 200 caracteres.", 422);
        patch.address = address;
      }
      if (body.lat !== undefined && body.lng !== undefined) {
        const provinceId = provinceOf(db, body.lat, body.lng);
        if (provinceId === null) return fail("FAVORITE_OUTSIDE_PROVINCES", "Ese punto está fuera de las provincias donde funciona MVC.", 422);
        patch.lat = body.lat;
        patch.lng = body.lng;
        patch.province_id = provinceId;
      }
      return favoriteWire(favorites(db).update(row.id, patch));
    },
  );

  r.delete<{ Params: { favoriteId: string } }>(
    "/v1/me/favorites/:favoriteId",
    { summary: "Eliminar destino", tags: ["trips"], schema: { params: uuidParam("favoriteId") } },
    (req) => {
      const me = req.auth();
      const row = ownFavorite(me.userId, req.params.favoriteId);
      const using = entries(db).filter((e) => e.user_id === me.userId && (e.from_place_id === row.id || e.to_place_id === row.id));
      if (using.length > 0) return fail("FAVORITE_IN_USE", "Este destino se usa en tu rutina.", 409, { entryIds: using.map((e) => e.id) });
      favorites(db).delete(row.id);
      writeAudit(db, { actorUserId: me.userId, action: "favorite.deleted", entityType: "favorite", entityId: row.id, requestId: req.requestId });
      return reply.noContent();
    },
  );

  // ── Rutina ───────────────────────────────────────────────────────────────────────────────────────────────────
  r.get("/v1/me/routine", { summary: "Mi rutina semanal", tags: ["trips"] }, (req) => routineWire(db, req.auth().userId));

  const checkPlaces = (userId: string, fromId: string, toId: string): void => {
    ownFavorite(userId, fromId);
    ownFavorite(userId, toId);
    if (fromId === toId) fail("ROUTINE_SAME_PLACE", "El origen y el destino no pueden ser el mismo.", 422);
  };
  const duplicates = (userId: string, weekday: Weekday, time: string, fromId: string, toId: string, ignoreId?: string): boolean =>
    entries(db).filter((e) => e.user_id === userId && e.id !== ignoreId && e.weekday === weekday && e.time === time && e.from_place_id === fromId && e.to_place_id === toId).length > 0;

  r.post<{ Body: CreateRoutineEntryBody }>(
    "/v1/me/routine/entries",
    {
      summary: "Añadir filas de rutina",
      tags: ["trips"],
      idempotent: true,
      schema: {
        body: {
          type: "object",
          required: ["weekdays", "time", "fromPlaceId", "toPlaceId"],
          properties: { weekdays: { type: "array", items: { type: "string", enum: [...WEEKDAYS] }, minItems: 1, maxItems: 7 }, time: { type: "string" }, fromPlaceId: { type: "string" }, toPlaceId: { type: "string" }, enabled: { type: "boolean" } },
        },
      },
    },
    (req) => {
      const me = req.auth();
      const body = req.body;
      if (!TIME.test(body.time)) return fail("INVALID_REQUEST", "La hora debe tener el formato HH:mm.", 400);
      const days = [...new Set(body.weekdays)];
      checkPlaces(me.userId, body.fromPlaceId, body.toPlaceId);
      return db.tx(() => {
        const taken = days.filter((d) => duplicates(me.userId, d, body.time, body.fromPlaceId, body.toPlaceId));
        if (taken.length > 0) return fail("ROUTINE_ENTRY_EXISTS", "Ya tienes esa fila en tu rutina.", 409, { weekdays: taken });
        if (mine(entries(db).all(), me.userId).length + days.length > MAX_ROUTINE_ENTRIES) return fail("ROUTINE_LIMIT_REACHED", `Tu rutina admite hasta ${MAX_ROUTINE_ENTRIES} filas.`, 409);
        const now = db.nowMs();
        const created = days.map((weekday, i) =>
          entries(db).insert({ id: db.ids.uuid(), user_id: me.userId, weekday, time: body.time, from_place_id: body.fromPlaceId, to_place_id: body.toPlaceId, enabled: body.enabled ?? true, created_at: now + i }),
        );
        return reply.created({ items: created.map((e) => entryWire(db, e)) });
      });
    },
  );

  const ownEntry = (userId: string, id: string): Readonly<RoutineEntryRow> => {
    const row = entries(db).get(id);
    return row !== undefined && row.user_id === userId ? row : fail("ROUTINE_ENTRY_NOT_FOUND", "Esa fila de la rutina no existe.", 404);
  };

  r.patch<{ Params: { entryId: string }; Body: UpdateRoutineEntryBody }>(
    "/v1/me/routine/entries/:entryId",
    { summary: "Editar o activar una fila", tags: ["trips"], schema: { params: uuidParam("entryId") } },
    (req) => {
      const me = req.auth();
      const row = ownEntry(me.userId, req.params.entryId);
      const body = req.body ?? {};
      if (Object.values(body).every((v) => v === undefined)) return fail("INVALID_REQUEST", "Indica al menos un campo.", 400);
      if (body.time !== undefined && !TIME.test(body.time)) return fail("INVALID_REQUEST", "La hora debe tener el formato HH:mm.", 400);
      const time = body.time ?? row.time;
      const from = body.fromPlaceId ?? row.from_place_id;
      const to = body.toPlaceId ?? row.to_place_id;
      checkPlaces(me.userId, from, to);
      if (duplicates(me.userId, row.weekday, time, from, to, row.id)) return fail("ROUTINE_ENTRY_EXISTS", "Ya tienes esa fila en tu rutina.", 409, { weekdays: [row.weekday] });
      return entryWire(db, entries(db).update(row.id, { time, from_place_id: from, to_place_id: to, enabled: body.enabled ?? row.enabled }));
    },
  );

  r.delete<{ Params: { entryId: string } }>(
    "/v1/me/routine/entries/:entryId",
    { summary: "Eliminar fila de la rutina", tags: ["trips"], schema: { params: uuidParam("entryId") } },
    (req) => {
      const row = ownEntry(req.auth().userId, req.params.entryId);
      entries(db).delete(row.id);
      return reply.noContent();
    },
  );

  // ── Suspensión de semana ─────────────────────────────────────────────────────────────────────────────────────
  r.post<{ Body: CreateRoutineSuspensionBody }>(
    "/v1/me/routine/suspensions",
    { summary: "Suspender una semana", tags: ["trips"], idempotent: true, schema: { body: { type: "object", properties: { weekStart: { type: "string" } } } } },
    (req) => {
      const me = req.auth();
      const today = madridDate(db.nowMs());
      const weekStart = req.body?.weekStart ?? nextWeekStart(db);
      if (!WEEK_DATE.test(weekStart) || isoWeekdayOf(weekStart) !== 1 || weekStart < today || weekStart > addDaysToDate(today, 365)) {
        return fail("INVALID_WEEK_START", "La semana debe empezar en lunes, no estar en el pasado y estar a menos de un año.", 422);
      }
      const id = `${me.userId}:${weekStart}`;
      const existed = suspensions(db).has(id);
      return db.tx(() => {
        if (!existed) suspensions(db).insert({ id, user_id: me.userId, week_start: weekStart, created_at: db.nowMs() });
        const { withdrawn, kept } = withdrawWeek(db, me.userId, weekStart);
        if (!existed) writeAudit(db, { actorUserId: me.userId, action: "routine.suspended", entityType: "routine", entityId: id, requestId: req.requestId });
        const body = { weekStart, weekEnd: addDaysToDate(weekStart, 6), withdrawnRequests: withdrawn, keptRequests: kept };
        return existed ? body : reply.created(body);
      });
    },
  );

  r.delete<{ Params: { weekStart: string } }>(
    "/v1/me/routine/suspensions/:weekStart",
    { summary: "Reanudar una semana", tags: ["trips"], schema: { params: weekParam } },
    (req) => {
      const me = req.auth();
      const weekStart = req.params.weekStart;
      if (!WEEK_DATE.test(weekStart) || isoWeekdayOf(weekStart) !== 1) return fail("INVALID_WEEK_START", "La semana debe empezar en lunes.", 422);
      suspensions(db).delete(`${me.userId}:${weekStart}`);
      return reply.noContent();
    },
  );

  // ── Plaza semanal (preferencia del conductor) ────────────────────────────────────────────────────────────────
  r.put<{ Body: UpdateWeeklySeatOfferBody }>(
    "/v1/me/routine/weekly-offer",
    {
      summary: "Plaza disponible (semanal)",
      tags: ["trips"],
      idempotent: true,
      schema: { body: { type: "object", required: ["enabled", "seats"], properties: { enabled: { type: "boolean" }, seats: { type: "integer" } } } },
    },
    (req) => {
      const me = req.auth();
      if (!me.roles.includes("driver")) return fail("AUTH_FORBIDDEN", "Para ofrecer plazas necesitas el modo conductor.", 403);
      const { enabled, seats } = req.body;
      if (!Number.isInteger(seats) || seats < 1 || seats > 8) return fail("INVALID_REQUEST_SHAPE", "Las plazas deben estar entre 1 y 8.", 422);
      if (offers(db).has(me.userId)) offers(db).update(me.userId, { enabled, seats });
      else offers(db).insert({ id: me.userId, enabled, seats });
      return weeklyOfferWire(db, me.userId);
    },
  );
}
