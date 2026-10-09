/**
 * Servidor simulado de «buscar y ver viajes»: los cinco endpoints del paquete contra el mundo sembrado (cifras de las
 * láminas 09, 11 y 12), privacidad del mapa, errores del contrato, cursor, sugerencias, presupuesto sin efectos y tarifa de
 * ejemplo. Se ejecuta con: `node --import tsx --test "src/features/search/preview/*.test.ts"` (desde `mobile/`).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SEED_IDS } from "@/preview";
import { createApi, asArray, asRecord, num, str, testRuntime, tokenFor } from "@/preview/testing/harness";
import { encodePickupId } from "./browseGeometry";

const PROVINCE = SEED_IDS.province;
const ANA_TRIP = SEED_IDS.trips.anaMorning;
const BOARD_11_CLOCK = "2026-10-05T07:58:00+02:00";

/** Origen a ≈ 923 m de la parada de Montequinto (1,2 km a pie con el factor 1,3) y destino junto a la Universidad. */
const SEARCH = {
  provinceId: PROVINCE,
  originLat: 37.3403,
  originLng: -5.937,
  destLat: 37.3825,
  destLng: -5.9919,
  arriveBy: "08:30",
  mode: "weekly",
} as const;

function qs(params: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join("&");
}

function world(options: { seed?: string; clock?: string; profile?: "new" | "passenger" | "driver" } = {}) {
  const rt = testRuntime({ profile: options.profile ?? "passenger", seed: options.seed ?? "default", ...(options.clock ? { clock: options.clock } : {}) });
  return { rt, api: createApi(rt) };
}

describe("GET /v1/trip-categories", () => {
  it("devuelve las seis categorías en el orden de las pantallas, sin sesión", async () => {
    const { api } = world({ profile: "new" });
    const res = await api("GET", "/v1/trip-categories");
    assert.equal(res.status, 200);
    const items = asArray(asRecord(res.body).items);
    assert.deepEqual(
      items.map((item) => asRecord(item).label),
      ["Trabajo", "Universidad", "FP", "Hospital", "Deporte", "Otros"]
    );
    assert.deepEqual(
      items.map((item) => asRecord(item).id),
      ["work", "university", "fp_academies", "hospital", "sport", "other"]
    );
  });
});

describe("GET /v1/trips/map", () => {
  it("un invitado ve coches con plazas, «Completo» y posiciones en la cuadrícula de 0,01°", async () => {
    const { api } = world({ profile: "new" });
    const res = await api("GET", `/v1/trips/map?${qs({ provinceId: PROVINCE })}`);
    assert.equal(res.status, 200);
    const body = asRecord(res.body);
    const cars = asArray(body.cars).map((car) => asRecord(car));
    assert.ok(cars.length >= 4, "hay coches en la oferta de la mañana");
    const ana = cars.find((car) => car.tripId === ANA_TRIP);
    assert.ok(ana, "el coche de Ana está en el mapa");
    assert.equal(ana.seatsAvailable, 2);
    assert.equal(ana.full, false);
    assert.equal(ana.state, "scheduled");
    const position = asRecord(ana.position);
    assert.equal(position.precision, "approximate");
    assert.equal(position.source, "origin");
    for (const car of cars) {
      const p = asRecord(car.position);
      assert.equal(Math.round(num(p.lat) * 100) / 100, p.lat, "latitud en cuadrícula de 0,01°");
      assert.equal(Math.round(num(p.lng) * 100) / 100, p.lng, "longitud en cuadrícula de 0,01°");
    }
    const full = cars.find((car) => car.tripId === SEED_IDS.trips.martaWork);
    assert.equal(full?.full, true, "el coche de Marta va completo");
    assert.equal(full?.seatsAvailable, 0);
  });

  it("onlyWithSeats oculta los coches completos y category filtra", async () => {
    const { api } = world({ profile: "new" });
    const withSeats = asRecord((await api("GET", `/v1/trips/map?${qs({ provinceId: PROVINCE, onlyWithSeats: true })}`)).body);
    assert.ok(asArray(withSeats.cars).every((car) => asRecord(car).full === false));
    const hospital = asRecord((await api("GET", `/v1/trips/map?${qs({ provinceId: PROVINCE, category: "hospital" })}`)).body);
    const categories = new Set(asArray(hospital.cars).map((car) => asRecord(car).category));
    assert.deepEqual([...categories], ["hospital"]);
  });

  it("withinHours recorta por salida y limit marca truncated", async () => {
    const { api } = world({ profile: "new" });
    const narrow = asRecord((await api("GET", `/v1/trips/map?${qs({ provinceId: PROVINCE, withinHours: 1 })}`)).body);
    assert.equal(asArray(narrow.cars).length, 5, "a las 07:17, en la próxima hora salen los de las 07:35, 07:40, 07:50, 08:03 y 08:05");
    const normal = asRecord((await api("GET", `/v1/trips/map?${qs({ provinceId: PROVINCE })}`)).body);
    const wide = asRecord((await api("GET", `/v1/trips/map?${qs({ provinceId: PROVINCE, withinHours: 48 })}`)).body);
    assert.ok(asArray(wide.cars).length > asArray(normal.cars).length, "con 48 h aparecen también los de la tarde (19:45) y los de mañana");
    const one = asRecord((await api("GET", `/v1/trips/map?${qs({ provinceId: PROVINCE, limit: 1 })}`)).body);
    assert.equal(asArray(one.cars).length, 1);
    assert.equal(one.truncated, true);
  });

  it("provincia desconocida: 404 PROVINCE_NOT_FOUND; provinceId obligatorio: 400", async () => {
    const { api } = world({ profile: "new" });
    const unknown = await api("GET", `/v1/trips/map?${qs({ provinceId: "5e2c1a52-0a43-4e6b-9c11-5c1a0b7f9999" })}`);
    assert.equal(unknown.status, 404);
    assert.equal(asRecord(asRecord(unknown.body).error).code, "PROVINCE_NOT_FOUND");
    const missing = await api("GET", "/v1/trips/map");
    assert.equal(missing.status, 400);
  });

  it("un coche en marcha con posición en directo reciente sale `live`; con la posición vieja, `stale`", async () => {
    const { api } = world({ profile: "new", seed: "browse-live-cars" });
    const body = asRecord((await api("GET", `/v1/trips/map?${qs({ provinceId: PROVINCE })}`)).body);
    const cars = asArray(body.cars).map((car) => asRecord(car));
    const carlos = cars.find((car) => car.tripId === SEED_IDS.trips.carlosWork);
    const marta = cars.find((car) => car.tripId === SEED_IDS.trips.martaWork);
    assert.equal(carlos?.state, "live");
    assert.equal(asRecord(carlos?.position).source, "live_gps");
    assert.equal(asRecord(carlos?.position).stale, false);
    assert.equal(asRecord(marta?.position).stale, true);
  });

  it("browse-empty-map: sin coches", async () => {
    const { api } = world({ profile: "new", seed: "browse-empty-map" });
    const body = asRecord((await api("GET", `/v1/trips/map?${qs({ provinceId: PROVINCE })}`)).body);
    assert.deepEqual(body.cars, []);
  });

  it("con una cabecera Authorization inválida responde 401 (sesión opcional, pero válida si llega)", async () => {
    const { api } = world({ profile: "new" });
    const res = await api("GET", `/v1/trips/map?${qs({ provinceId: PROVINCE })}`, { token: "token-que-no-existe" });
    assert.equal(res.status, 401);
  });
});

describe("GET /v1/search/trips", () => {
  it("lámina 11: Ana llega a las 08:28, recoge en Montequinto a 1,2 km y «en 7 min»; aportación «Por definir»", async () => {
    const { api } = world({ profile: "new", clock: BOARD_11_CLOCK });
    const res = await api("GET", `/v1/search/trips?${qs(SEARCH)}`);
    assert.equal(res.status, 200);
    const page = asRecord(res.body);
    const items = asArray(page.items).map((item) => asRecord(item));
    assert.equal(items.length, 1);
    const ana = items[0] as Record<string, unknown>;
    assert.equal(ana.tripId, ANA_TRIP);
    assert.equal(asRecord(ana.driver).displayName, "Ana García López");
    assert.equal(asRecord(ana.driver).ratingAverage, 4.8);
    assert.equal(asRecord(ana.driver).ratingCount, 32);
    assert.equal(ana.seatsAvailable, 2);
    const pickup = asRecord(ana.pickup);
    assert.equal(pickup.label, "Montequinto");
    assert.equal(pickup.minutesFromNow, 7);
    assert.equal(pickup.pickupAtLocal, "08:05");
    assert.equal(pickup.walkDistanceM, 1200);
    assert.equal(asRecord(pickup.location).precision, "approximate");
    const dropoff = asRecord(ana.dropoff);
    assert.equal(dropoff.arriveAtLocal, "08:28");
    assert.equal(ana.roadDistanceM, 24000);
    assert.equal(ana.durationMinutes, 23);
    assert.deepEqual(ana.price, { cents: null, currency: "EUR", status: "pending_definition" });
    assert.equal(asRecord(ana.recurrence).fullMatch, true);
    assert.deepEqual(asRecord(ana.return), { available: true, departsLocal: "18:00", matchesRequested: null });
    assert.equal(asRecord(ana.vehicle).plate, null, "la matrícula completa no se enseña en la búsqueda");
    assert.equal(asRecord(ana.vehicle).plateHint, "MBC");
    assert.equal(page.nextCursor, null);
    assert.deepEqual(asRecord(page.criteria).weekdays, ["mon", "tue", "wed", "thu", "fri"]);
    assert.equal(asRecord(page.criteria).toleranceMinutes, 20);
  });

  it("sin coincidencias en la franja: sugiere ampliar el horario y más días con los coches que aparecerían", async () => {
    const { api } = world({ profile: "new", clock: BOARD_11_CLOCK, seed: "browse-board-11" });
    const page = asRecord((await api("GET", `/v1/search/trips?${qs(SEARCH)}`)).body);
    assert.equal(asArray(page.items).length, 1, "solo Ana llega entre 08:10 y 08:50");
    const suggestions = asArray(page.suggestions).map((s) => asRecord(s));
    assert.deepEqual(suggestions.map((s) => s.kind).sort(), ["more_days", "widen_time"]);
    const widen = suggestions.find((s) => s.kind === "widen_time");
    assert.equal(widen?.wouldMatch, 1);
    assert.deepEqual(widen?.apply, { toleranceMinutes: 50 });
    assert.match(str(widen?.message), /ampliar el horario ±30 min/);
    const days = suggestions.find((s) => s.kind === "more_days");
    assert.deepEqual(days?.apply, { weekdays: "mon,tue,wed,thu,fri,sat,sun" });
    // Aplicar la sugerencia hace aparecer ese coche.
    const widened = asRecord((await api("GET", `/v1/search/trips?${qs({ ...SEARCH, toleranceMinutes: 50 })}`)).body);
    assert.equal(asArray(widened.items).length, 2);
  });

  it("sin ningún resultado: items vacío y sugerencias coherentes (no se inventan)", async () => {
    const { api } = world({ profile: "new", clock: BOARD_11_CLOCK });
    const page = asRecord((await api("GET", `/v1/search/trips?${qs({ ...SEARCH, arriveBy: "13:00" })}`)).body);
    assert.deepEqual(page.items, []);
    assert.ok(asArray(page.suggestions).every((s) => num(asRecord(s).wouldMatch) > 0));
  });

  it("modo puntual exige fecha y filtra por el día", async () => {
    const { api } = world({ profile: "new", clock: BOARD_11_CLOCK });
    const missing = await api("GET", `/v1/search/trips?${qs({ ...SEARCH, mode: "one_off" })}`);
    assert.equal(missing.status, 422);
    assert.equal(asRecord(asRecord(missing.body).error).code, "SEARCH_DATE_REQUIRED");
    const monday = asRecord((await api("GET", `/v1/search/trips?${qs({ ...SEARCH, mode: "one_off", date: "2026-10-05" })}`)).body);
    assert.equal(asArray(monday.items).length, 1);
    assert.equal(asRecord(monday.criteria).date, "2026-10-05");
    assert.equal(asRecord(monday.criteria).weekdays, null);
    const tuesday = asRecord((await api("GET", `/v1/search/trips?${qs({ ...SEARCH, mode: "one_off", date: "2026-10-06" })}`)).body);
    assert.equal(asArray(tuesday.items).length, 1);
    assert.equal(asRecord(asArray(tuesday.items)[0]).tripId, SEED_IDS.trips.anaTomorrow);
    const sunday = asRecord((await api("GET", `/v1/search/trips?${qs({ ...SEARCH, mode: "one_off", date: "2026-10-11" })}`)).body);
    assert.deepEqual(sunday.items, []);
  });

  it("origen o destino fuera de la provincia: 422 con el código del contrato", async () => {
    const { api } = world({ profile: "new", clock: BOARD_11_CLOCK });
    const origin = await api("GET", `/v1/search/trips?${qs({ ...SEARCH, originLat: 36.5271, originLng: -6.2886 })}`); // Cádiz
    assert.equal(origin.status, 422);
    assert.equal(asRecord(asRecord(origin.body).error).code, "ORIGIN_OUTSIDE_PROVINCE");
    const dest = await api("GET", `/v1/search/trips?${qs({ ...SEARCH, destLat: 37.1773, destLng: -3.5986 })}`); // Granada
    assert.equal(dest.status, 422);
    assert.equal(asRecord(asRecord(dest.body).error).code, "DESTINATION_OUTSIDE_PROVINCE");
  });

  it("días inválidos, cursor inválido y hora mal formada se rechazan", async () => {
    const { api } = world({ profile: "new", clock: BOARD_11_CLOCK });
    const days = await api("GET", `/v1/search/trips?${qs({ ...SEARCH, weekdays: "mon,funday" })}`);
    assert.equal(days.status, 422);
    assert.equal(asRecord(asRecord(days.body).error).code, "INVALID_SEARCH_WEEKDAYS");
    const cursor = await api("GET", `/v1/search/trips?${qs({ ...SEARCH, cursor: "no-es-un-cursor" })}`);
    assert.equal(cursor.status, 400);
    assert.equal(asRecord(asRecord(cursor.body).error).code, "INVALID_CURSOR");
    const time = await api("GET", `/v1/search/trips?${qs({ ...SEARCH, arriveBy: "25:99" })}`);
    assert.equal(time.status, 400);
  });

  it("pagina con cursor opaco y ordena por cercanía a la hora de llegada", async () => {
    const { api } = world({ profile: "new", clock: BOARD_11_CLOCK });
    // Sevilla capital: todos los coches de la mañana hacia el centro con radio amplio.
    const wide = { ...SEARCH, originLat: 37.3445, originLng: -6.0603, destLat: 37.383, destLng: -5.992, radiusM: 10000, toleranceMinutes: 90, onlyWithSeats: false };
    const all = asRecord((await api("GET", `/v1/search/trips?${qs(wide)}`)).body);
    const total = asArray(all.items).length;
    assert.ok(total >= 2, "varios coches cumplen");
    const first = asRecord((await api("GET", `/v1/search/trips?${qs({ ...wide, limit: 1 })}`)).body);
    assert.equal(asArray(first.items).length, 1);
    assert.equal(typeof first.nextCursor, "string");
    const second = asRecord((await api("GET", `/v1/search/trips?${qs({ ...wide, limit: 1, cursor: str(first.nextCursor) })}`)).body);
    assert.equal(asArray(second.items).length, 1);
    assert.notEqual(asRecord(asArray(second.items)[0]).tripId, asRecord(asArray(first.items)[0]).tripId);
    const diffs = asArray(all.items).map((item) => {
      const arrive = str(asRecord(asRecord(item).dropoff).arriveAtLocal);
      return Math.abs(Number(arrive.slice(0, 2)) * 60 + Number(arrive.slice(3)) - 510);
    });
    assert.deepEqual([...diffs].sort((a, b) => a - b), diffs, "primero los que llegan más cerca de las 08:30");
  });

  it("no ofrece al conductor su propio viaje", async () => {
    const { rt, api } = world({ profile: "driver", clock: BOARD_11_CLOCK });
    const page = asRecord((await api("GET", `/v1/search/trips?${qs(SEARCH)}`, { token: tokenFor(rt, "ana") })).body);
    assert.deepEqual(page.items, []);
  });
});

describe("GET /v1/trips/:tripId", () => {
  it("lámina 12 (invitado): conductora, vehículo sin matrícula completa, paradas, totales y precio «Por definir»", async () => {
    const { api } = world({ profile: "new", clock: BOARD_11_CLOCK });
    const res = await api("GET", `/v1/trips/${ANA_TRIP}`);
    assert.equal(res.status, 200);
    const trip = asRecord(res.body);
    assert.equal(trip.provinceName, "Sevilla");
    assert.equal(asRecord(trip.driver).firstName, "Ana");
    assert.ok(typeof asRecord(trip.driver).photoUrl === "string", "foto aprobada");
    assert.equal(asRecord(trip.vehicle).displayName, "SEAT Arona");
    assert.equal(asRecord(trip.vehicle).plate, null);
    assert.equal(asRecord(trip.vehicle).id, null);
    assert.equal(asRecord(trip.vehicle).plateHint, "MBC");
    const stops = asArray(trip.stops).map((stop) => asRecord(stop));
    assert.deepEqual(
      stops.map((stop) => [stop.label, stop.etaLocal, stop.optional, stop.detourMinutes]),
      [
        ["Montequinto", "08:05", false, null],
        ["Dos Hermanas", "08:15", true, 5],
        ["Sevilla – Universidad", "08:28", false, null],
      ]
    );
    assert.ok(stops.every((stop) => asRecord(stop.location).precision === "approximate"));
    assert.deepEqual(asRecord(trip.totals), { roadDistanceM: 24000, durationMinutes: 23, detourMinutes: 5 });
    assert.deepEqual(trip.price, { cents: null, currency: "EUR", status: "pending_definition" });
    assert.equal(asRecord(trip.seats).available, 2);
    assert.equal(trip.canRequest, false);
    assert.equal(trip.cannotRequestReason, "AUTH_REQUIRED");
    assert.equal(asRecord(trip.viewer).relation, "public");
    assert.equal(trip.owner, null);
    const geometry = asRecord(asRecord(trip.route).geometry);
    assert.equal(geometry.precision, "approximate");
    assert.ok(asArray(geometry.coordinates).length >= 10);
  });

  it("con contexto de búsqueda marca «Tú te subes aquí» y el tramo del pasajero", async () => {
    const { rt, api } = world({ profile: "passenger", clock: BOARD_11_CLOCK });
    const res = await api("GET", `/v1/trips/${ANA_TRIP}?${qs({ pickupLat: 37.3403, pickupLng: -5.937 })}`, { token: tokenFor(rt, "miguel") });
    const trip = asRecord(res.body);
    const stops = asArray(trip.stops).map((stop) => asRecord(stop));
    assert.deepEqual(
      stops.map((stop) => [stop.isYourPickup, stop.isYourDropoff]),
      [
        [true, false],
        [false, false],
        [false, true],
      ]
    );
    assert.equal(trip.canRequest, true);
    assert.equal(trip.cannotRequestReason, null);
    const fromDosHermanas = asRecord(
      (await api("GET", `/v1/trips/${ANA_TRIP}?${qs({ pickupLat: 37.283, pickupLng: -5.921 })}`, { token: tokenFor(rt, "miguel") })).body
    );
    assert.deepEqual(
      asArray(fromDosHermanas.stops).map((stop) => asRecord(stop).isYourPickup),
      [false, true, false]
    );
  });

  it("la conductora ve su viaje con precisión, matrícula completa y las solicitudes pendientes", async () => {
    const { rt, api } = world({ profile: "driver", clock: BOARD_11_CLOCK });
    const trip = asRecord((await api("GET", `/v1/trips/${ANA_TRIP}`, { token: tokenFor(rt, "ana") })).body);
    assert.equal(asRecord(trip.viewer).relation, "driver");
    assert.equal(asRecord(trip.viewer).precision, "precise");
    assert.equal(asRecord(trip.vehicle).plate, "1234 MBC");
    assert.equal(trip.canRequest, false);
    assert.equal(trip.cannotRequestReason, "DRIVER_CANNOT_REQUEST_OWN_TRIP");
    const owner = asRecord(trip.owner);
    assert.equal(owner.pendingRequests, 2);
    assert.equal(asArray(owner.confirmedPassengers).length, 1);
  });

  it("viaje completo: no se puede solicitar (NO_CAPACITY); un borrador es 404 para los demás", async () => {
    const { rt, api } = world({ profile: "passenger", clock: BOARD_11_CLOCK });
    const full = asRecord((await api("GET", `/v1/trips/${SEED_IDS.trips.martaWork}`, { token: tokenFor(rt, "miguel") })).body);
    assert.equal(full.canRequest, false);
    assert.equal(full.cannotRequestReason, "NO_CAPACITY");
    assert.equal(asRecord(full.seats).available, 0);
    const draft = await api("GET", `/v1/trips/${SEED_IDS.trips.anaDraft}`);
    assert.equal(draft.status, 404);
    assert.equal(asRecord(asRecord(draft.body).error).code, "TRIP_NOT_FOUND");
    const none = await api("GET", "/v1/trips/9f0e1d2c-4b3a-4a59-8877-66554433ffff");
    assert.equal(none.status, 404);
  });

  it("dropoffStopSeq inválido: 422 DROPOFF_STOP_INVALID", async () => {
    const { api } = world({ profile: "new", clock: BOARD_11_CLOCK });
    const res = await api("GET", `/v1/trips/${ANA_TRIP}?${qs({ dropoffStopSeq: 7 })}`);
    assert.equal(res.status, 422);
    assert.equal(asRecord(asRecord(res.body).error).code, "DROPOFF_STOP_INVALID");
  });

  it("lámina 12 con la tarifa de ejemplo: «Propuesta: 3,50 €» llega como importe ilustrativo", async () => {
    const { api } = world({ profile: "new", clock: BOARD_11_CLOCK, seed: "browse-board-12" });
    const trip = asRecord((await api("GET", `/v1/trips/${ANA_TRIP}`)).body);
    assert.deepEqual(trip.price, { cents: 350, currency: "EUR", status: "illustrative" });
    assert.equal(asRecord(trip.vehicle).plateHint, "LKM");
    assert.equal(asRecord(trip.vehicle).displayName, "Seat Arona");
  });
});

describe("POST /v1/trips/:tripId/quote", () => {
  it("sin tarifa: todo «Por definir», con los kilómetros del tramo", async () => {
    const { api } = world({ profile: "new", clock: BOARD_11_CLOCK });
    const res = await api("POST", `/v1/trips/${ANA_TRIP}/quote`, { body: {} });
    assert.equal(res.status, 200);
    const body = asRecord(res.body);
    const quote = asRecord(body.quote);
    assert.equal(quote.state, "pending_definition");
    assert.deepEqual(quote.tariff, { state: "none_approved", version: null });
    assert.deepEqual(quote.basis, { roadDistanceM: 24000, rateMicrosPerKm: null });
    for (const key of ["contribution", "managementFee", "total"] as const) {
      assert.deepEqual(quote[key], { cents: null, currency: "EUR", status: "pending_definition" });
    }
    assert.equal(body.roadDistanceM, 24000);
    assert.equal(body.canRequest, false);
    assert.equal(body.cannotRequestReason, "AUTH_REQUIRED");
    assert.equal(asRecord(body.pickup).label, "Montequinto");
    assert.equal(asRecord(body.dropoff).atLocal, "08:28");
  });

  it("con la tarifa de ejemplo: aportación + gestión = total, en céntimos enteros e ilustrativos", async () => {
    const { rt, api } = world({ profile: "passenger", clock: BOARD_11_CLOCK, seed: "browse-example-tariff" });
    const token = tokenFor(rt, "miguel");
    const full = asRecord(asRecord((await api("POST", `/v1/trips/${ANA_TRIP}/quote`, { token, body: {} })).body).quote);
    assert.equal(full.state, "defined");
    assert.deepEqual(full.contribution, { cents: 318, currency: "EUR", status: "illustrative" });
    assert.deepEqual(full.managementFee, { cents: 32, currency: "EUR", status: "illustrative" });
    assert.deepEqual(full.total, { cents: 350, currency: "EUR", status: "illustrative" });
    assert.deepEqual(asRecord(full.basis), { roadDistanceM: 24000, rateMicrosPerKm: 132500 });
    // Tramo Dos Hermanas → Universidad (15 km): 15 000 × 132 500 / 10⁷ = 198,75 → 199.
    const part = asRecord(asRecord((await api("POST", `/v1/trips/${ANA_TRIP}/quote`, { token, body: { fromSegmentSeq: 1, toSegmentSeq: 2 } })).body).quote);
    assert.deepEqual(part.contribution, { cents: 199, currency: "EUR", status: "illustrative" });
    assert.equal(asRecord(asRecord((await api("POST", `/v1/trips/${ANA_TRIP}/quote`, { token, body: {} })).body)).canRequest, true);
  });

  it("no tiene efectos: no crea solicitudes ni retiene plazas", async () => {
    const { rt, api } = world({ profile: "passenger", clock: BOARD_11_CLOCK, seed: "browse-example-tariff" });
    const before = JSON.stringify(rt.db.snapshot().collections.ride_requests);
    const holds = rt.db.seatHolds.count();
    await api("POST", `/v1/trips/${ANA_TRIP}/quote`, { token: tokenFor(rt, "miguel"), body: { fromSegmentSeq: 0, toSegmentSeq: 2 } });
    assert.equal(JSON.stringify(rt.db.snapshot().collections.ride_requests), before);
    assert.equal(rt.db.seatHolds.count(), holds);
  });

  it("acepta un pickupPointId (`pp1_…`) de una parada declarada y lo revalida", async () => {
    const { rt, api } = world({ profile: "passenger", clock: BOARD_11_CLOCK, seed: "browse-example-tariff" });
    const token = tokenFor(rt, "miguel");
    const id = encodePickupId(ANA_TRIP, { lat: 37.332, lng: -5.937 }, 0, 21);
    const ok = asRecord((await api("POST", `/v1/trips/${ANA_TRIP}/quote`, { token, body: { pickupPointId: id } })).body);
    assert.equal(ok.roadDistanceM, 24000);
    assert.equal(asRecord(ok.pickup).walkMinutes, 21);
    assert.equal(asRecord(asRecord(ok.pickup).location).precision, "precise");
    const other = encodePickupId(SEED_IDS.trips.carlosWork, { lat: 37.332, lng: -5.937 }, 0, 21);
    const bad = await api("POST", `/v1/trips/${ANA_TRIP}/quote`, { token, body: { pickupPointId: other } });
    assert.equal(bad.status, 422);
    assert.equal(asRecord(asRecord(bad.body).error).code, "PICKUP_POINT_INVALID");
    const dropoff = await api("POST", `/v1/trips/${ANA_TRIP}/quote`, { token, body: { pickupPointId: encodePickupId(ANA_TRIP, { lat: 37.283, lng: -5.921 }, 1, 6), dropoffStopSeq: 1 } });
    assert.equal(dropoff.status, 422);
    assert.equal(asRecord(asRecord(dropoff.body).error).code, "DROPOFF_BEFORE_PICKUP");
  });

  it("errores del contrato: forma mixta, rango inexistente, viaje que no existe", async () => {
    const { rt, api } = world({ profile: "passenger", clock: BOARD_11_CLOCK });
    const token = tokenFor(rt, "miguel");
    const both = await api("POST", `/v1/trips/${ANA_TRIP}/quote`, { token, body: { pickupPointId: "pp1_x", fromSegmentSeq: 0, toSegmentSeq: 1 } });
    assert.equal(asRecord(asRecord(both.body).error).code, "INVALID_REQUEST_SHAPE");
    const range = await api("POST", `/v1/trips/${ANA_TRIP}/quote`, { token, body: { fromSegmentSeq: 0, toSegmentSeq: 9 } });
    assert.equal(asRecord(asRecord(range.body).error).code, "INVALID_SEGMENT_RANGE");
    const dropoffOnly = await api("POST", `/v1/trips/${ANA_TRIP}/quote`, { token, body: { dropoffStopSeq: 2 } });
    assert.equal(asRecord(asRecord(dropoffOnly.body).error).code, "INVALID_REQUEST_SHAPE");
    const none = await api("POST", "/v1/trips/9f0e1d2c-4b3a-4a59-8877-66554433ffff/quote", { token, body: {} });
    assert.equal(none.status, 404);
  });
});
