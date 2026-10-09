/** «Calcular ruta» / «Guardar ruta» (18 y 19) contra el servidor simulado: provincia por parada, horas de paso, series y requisitos. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SEED_IDS } from "@/preview";
import { asArray, asRecord, createApi, num, str, testRuntime, tokenFor } from "@/preview/testing/harness";

const PROVINCE = "5e2c1a52-0a43-4e6b-9c11-5c1a0b7f0001";
const PALOMARES = { lat: 37.3103, lng: -6.0486, label: "Palomares del Río" };
const MAIRENA = { lat: 37.3445, lng: -6.0603, label: "Mairena del Aljarafe" };
const SEVILLA = { lat: 37.3891, lng: -5.9845, label: "Sevilla (Trabajo)" };
const HUELVA = { lat: 37.2614, lng: -6.9447, label: "Huelva (sugerida)" };

function setup(seed = "default") {
  const rt = testRuntime({ profile: "driver", seed });
  const api = createApi(rt);
  const ana = tokenFor(rt, "ana");
  return { rt, api, ana };
}

describe("POST /v1/me/routes/plan", () => {
  it("todo dentro: ruta, horas de paso desde la salida y «Toda la ruta está dentro de la provincia de Sevilla.»", async () => {
    const { api, ana } = setup();
    const res = await api("POST", "/v1/me/routes/plan", { token: ana, body: { provinceId: PROVINCE, origin: PALOMARES, destination: SEVILLA, stops: [MAIRENA], departureLocal: "07:00" } });
    assert.equal(res.status, 200);
    const body = asRecord(res.body);
    assert.equal(body.canSave, true);
    assert.equal(body.headline, "Toda la ruta está dentro de la provincia de Sevilla.");
    const stops = asArray(body.stops).map((s) => asRecord(s));
    assert.equal(stops.length, 3);
    assert.equal(stops[0]?.etaLocal, "07:00");
    assert.ok(num(stops[2]?.offsetMinutes) > num(stops[1]?.offsetMinutes), "las horas crecen");
    assert.ok(asRecord(body.route).distanceM);
  });

  it("una parada fuera de la provincia no es un error: verdict por parada, sin ruta, con alternativas dentro", async () => {
    const { api, ana } = setup();
    const res = await api("POST", "/v1/me/routes/plan", { token: ana, body: { provinceId: PROVINCE, origin: PALOMARES, destination: SEVILLA, stops: [HUELVA] } });
    assert.equal(res.status, 200);
    const body = asRecord(res.body);
    assert.equal(body.canSave, false);
    assert.equal(body.route, null);
    assert.equal(body.blockingMessage, "Corrige los puntos fuera de la provincia para guardar.");
    const middle = asRecord(asArray(body.stops)[1]);
    assert.equal(middle.verdict, "outside_province");
    assert.equal(middle.message, "Esta parada no está en la provincia de Sevilla.");
    assert.ok(asArray(middle.alternatives).length > 0, "ofrece sitios dentro de la provincia");
    assert.equal(asRecord(asArray(body.issues)[0]).code, "STOP_OUTSIDE_PROVINCE");
  });

  it("origen y destino casi iguales → ROUTE_TOO_SHORT; más de 10 paradas → TOO_MANY_STOPS", async () => {
    const { api, ana } = setup();
    const short = await api("POST", "/v1/me/routes/plan", { token: ana, body: { provinceId: PROVINCE, origin: SEVILLA, destination: { ...SEVILLA, lat: SEVILLA.lat + 0.0005 } } });
    assert.equal(asRecord(asRecord(short.body).error).code, "ROUTE_TOO_SHORT");
    const many = await api("POST", "/v1/me/routes/plan", { token: ana, body: { provinceId: PROVINCE, origin: PALOMARES, destination: SEVILLA, stops: Array.from({ length: 11 }, () => MAIRENA) } });
    assert.equal(asRecord(asRecord(many.body).error).code, "TOO_MANY_STOPS");
  });
});

describe("POST /v1/me/routes", () => {
  const body = (over: Record<string, unknown> = {}) => ({
    vehicleId: SEED_IDS.vehicles.anaArona,
    provinceId: PROVINCE,
    category: "work",
    origin: PALOMARES,
    destination: SEVILLA,
    stops: [MAIRENA],
    frequency: "daily_workdays",
    outboundLocal: "07:00",
    returnLocal: "15:00",
    startDate: "2026-10-06",
    seats: 3,
    maxDetourMinutes: 5,
    pickupOnRoute: true,
    ...over,
  });

  it("serie diaria: crea ida y vuelta de los próximos 28 días y se puede buscar", async () => {
    const { api, ana } = setup();
    const res = await api("POST", "/v1/me/routes", { token: ana, headers: { "idempotency-key": "route-publish-0001" }, body: body() });
    assert.equal(res.status, 201);
    const out = asRecord(res.body);
    assert.ok(str(out.seriesId));
    const trips = asArray(out.trips).map((t) => asRecord(t));
    assert.deepEqual(trips.map((t) => t.leg), ["outbound", "return"]);
    assert.ok(num(out.occurrencesCreated) >= 30, `ocurrencias: ${String(out.occurrencesCreated)}`);
    const detail = await api("GET", `/v1/trips/${str(trips[0]?.id)}`, { token: ana });
    assert.equal(detail.status, 200);
  });

  it("misma Idempotency-Key = misma respuesta, sin duplicar la serie", async () => {
    const { api, ana } = setup();
    const first = await api("POST", "/v1/me/routes", { token: ana, headers: { "idempotency-key": "route-publish-0002" }, body: body() });
    const again = await api("POST", "/v1/me/routes", { token: ana, headers: { "idempotency-key": "route-publish-0002" }, body: body() });
    assert.equal(asRecord(again.body).seriesId, asRecord(first.body).seriesId);
  });

  it("puntual: un viaje (+ vuelta); exige fecha y no admite fecha de fin", async () => {
    const { api, ana } = setup();
    const ok = await api("POST", "/v1/me/routes", { token: ana, headers: { "idempotency-key": "route-publish-0003" }, body: body({ frequency: "one_off", startDate: "2026-10-07" }) });
    assert.equal(ok.status, 201);
    assert.equal(asRecord(ok.body).seriesId, null);
    assert.equal(num(asRecord(ok.body).occurrencesCreated), 2);
    const noDate = await api("POST", "/v1/me/routes", { token: ana, headers: { "idempotency-key": "route-publish-0004" }, body: { ...body({ frequency: "one_off" }), startDate: undefined } });
    assert.equal(asRecord(asRecord(noDate.body).error).code, "ONE_OFF_DATE_REQUIRED");
  });

  it("reglas: parada fuera de provincia, plazas de más, fecha pasada y hora no válida", async () => {
    const { api, ana } = setup();
    const call = async (n: number, over: Record<string, unknown>) =>
      asRecord(asRecord((await api("POST", "/v1/me/routes", { token: ana, headers: { "idempotency-key": `route-publish-1${n}00` }, body: body(over) })).body).error);
    assert.equal((await call(1, { stops: [HUELVA] })).code, "ROUTE_POINT_OUTSIDE_PROVINCE");
    assert.equal((await call(2, { seats: 5 })).code, "OFFERED_SEATS_EXCEED_VEHICLE");
    assert.equal((await call(3, { startDate: "2026-09-01" })).code, "PUBLISH_START_DATE_IN_PAST");
    assert.equal((await call(4, { outboundLocal: "25:00" })).code, "INVALID_TIME");
  });

  it("sin los requisitos (conductor nuevo) no se publica: DRIVER_NOT_READY", async () => {
    const { api, rt } = setup("fresh-driver");
    const token = rt.sessionToken("driver");
    const res = await api("POST", "/v1/me/routes", { token, headers: { "idempotency-key": "route-publish-0009" }, body: body({ vehicleId: SEED_IDS.vehicles.anaArona }) });
    assert.ok([403, 404, 409].includes(res.status), `estado ${res.status}`);
  });
});
