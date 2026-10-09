/**
 * Ciclo de reserva: buscar → solicitar → aceptar (hold de plaza) → pagar → reserva. Incluye la caducidad del hold con
 * el reloj virtual, la capacidad por tramo, el rechazo y los permisos.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { SEVILLA_PROVINCE_ID } from "../data/provinces";
import { SEED_TRIP_IDS, SEED_USER_IDS } from "../seeds";
import { asArray, asRecord, createApi, num, str, testRuntime, tokenFor, type Api } from "../testing/harness";
import { confirmProviderPayment } from "./requests";
import { segmentsOf } from "./seats";
import type { PreviewRuntime } from "../runtime";

const SEARCH = new URLSearchParams({
  provinceId: SEVILLA_PROVINCE_ID,
  originLatitude: "37.3256",
  originLongitude: "-5.9396",
  destinationLatitude: "37.3796",
  destinationLongitude: "-5.9919",
}).toString();

let rt: PreviewRuntime;
let api: Api;
let miguel: string;
let ana: string;
const tripId = SEED_TRIP_IDS.anaMorning;

beforeEach(() => {
  rt = testRuntime({ profile: "passenger", slices: false });
  api = createApi(rt);
  miguel = rt.sessionToken() ?? "";
  ana = tokenFor(rt, "ana");
});

async function seatsOnAnaTrip(): Promise<number | null> {
  const res = await api("GET", `/v1/trips/search?${SEARCH}`);
  const trip = (asRecord(res.body).trips as Array<Record<string, unknown>>).find((t) => t.tripId === tripId);
  return trip ? num(trip.availableSeats) : null;
}

async function myRequest(id: string): Promise<Record<string, unknown>> {
  const res = await api("GET", "/v1/me/ride-requests", { token: miguel });
  const found = (asRecord(res.body).requests as Array<Record<string, unknown>>).find((r) => r.id === id);
  assert.ok(found, "la solicitud aparece en «mis solicitudes»");
  return found;
}

describe("la búsqueda de la lámina", () => {
  it("Montequinto → Universidad: el viaje de Ana de las 08:05, 24 km, 23 min y 2 plazas libres", async () => {
    const res = await api("GET", `/v1/trips/search?${SEARCH}`);
    assert.equal(res.status, 200);
    const [first] = asArray(asRecord(res.body).trips, "trips");
    const trip = asRecord(first);
    assert.equal(trip.tripId, tripId);
    assert.equal(trip.departureAt, "2026-10-05T06:05:00.000Z", "08:05 en Madrid");
    assert.equal(trip.roadDistanceM, 24000);
    assert.equal(trip.estimatedDurationS, 1380);
    assert.equal(trip.availableSeats, 2);
    assert.equal(trip.driverDisplayName, "Ana García López");
    assert.equal(trip.fromSegmentSeq, 0);
    assert.equal(trip.toSegmentSeq, 2);
  });

  it("ordena por salida y no ofrece viajes de otro origen", async () => {
    const res = await api("GET", `/v1/trips/search?${SEARCH}`);
    const ids = (asRecord(res.body).trips as Array<{ tripId: string }>).map((t) => t.tripId);
    assert.ok(!ids.includes(SEED_TRIP_IDS.carlosWork), "Carlos va a otra parte");
    const departures = (asRecord(res.body).trips as Array<{ departureAt: string }>).map((t) => Date.parse(t.departureAt));
    assert.deepEqual([...departures].sort((a, b) => a - b), departures);
  });
});

describe("solicitar y decidir", () => {
  it("flujo feliz: solicitud pending → Ana acepta → hold de 10 min → payment_pending → pago → reserva confirmada", async () => {
    assert.equal(await seatsOnAnaTrip(), 2);

    const created = await api("POST", `/v1/trips/${tripId}/requests`, { token: miguel, body: { fromSegmentSeq: 0, toSegmentSeq: 2 } });
    assert.equal(created.status, 201);
    const request = asRecord(created.body);
    assert.equal(request.status, "pending");
    assert.equal(request.passenger_user_id, SEED_USER_IDS.miguel);
    const requestId = str(request.id);
    assert.equal(await seatsOnAnaTrip(), 2, "una solicitud pendiente NO reserva plaza");

    const dup = await api("POST", `/v1/trips/${tripId}/requests`, { token: miguel, body: { fromSegmentSeq: 0, toSegmentSeq: 2 } });
    assert.equal(dup.status, 409);
    assert.equal(asRecord(asRecord(dup.body).error).code, "DUPLICATE_OPEN_REQUEST");

    const forDriver = await api("GET", `/v1/trips/${tripId}/requests`, { token: ana });
    const listed = (asRecord(forDriver.body).requests as Array<Record<string, unknown>>).find((r) => r.id === requestId);
    assert.equal(listed?.status, "pending");

    const forbidden = await api("POST", `/v1/ride-requests/${requestId}/decision`, { token: miguel, body: { decision: "accept" } });
    assert.equal(forbidden.status, 403);

    const accepted = await api("POST", `/v1/ride-requests/${requestId}/decision`, { token: ana, body: { decision: "accept" } });
    assert.equal(accepted.status, 200);
    const decision = asRecord(accepted.body);
    assert.equal(asRecord(decision.request).status, "payment_pending");
    assert.equal(asRecord(decision.hold).expiresAt, "2026-10-05T05:27:00.000Z", "10 minutos de hold");
    assert.equal(await seatsOnAnaTrip(), 1, "el hold SÍ reserva plaza");

    const mine = await myRequest(requestId);
    assert.equal(mine.status, "payment_pending");
    assert.equal(mine.hold_expires_at, "2026-10-05T05:27:00.000Z");

    const again = await api("POST", `/v1/ride-requests/${requestId}/decision`, { token: ana, body: { decision: "accept" } });
    assert.equal(again.status, 409);
    assert.equal(asRecord(asRecord(again.body).error).code, "REQUEST_NOT_PENDING");

    // el módulo de pagos confirma el cobro (no hay ruta HTTP): se llama a la función de dominio
    const events: string[] = [];
    rt.db.events.on("booking.confirmed", () => events.push("booking.confirmed"));
    const paid = confirmProviderPayment(rt.db, { requestId, providerPaymentId: "pay_test_1", amountCents: 290 });
    assert.equal(paid.status, "confirmed");
    assert.deepEqual(events, ["booking.confirmed"]);

    const confirmed = await myRequest(requestId);
    assert.equal(confirmed.status, "confirmed");
    assert.equal(confirmed.hold_expires_at, null);
    assert.equal(await seatsOnAnaTrip(), 1, "la reserva ocupa la plaza que el hold ya reservaba");

    const replay = confirmProviderPayment(rt.db, { requestId, providerPaymentId: "pay_test_1", amountCents: 290 });
    assert.deepEqual(replay, paid, "confirmar dos veces el mismo pago es idempotente");
    assert.equal(rt.db.bookings.filter((b) => b.request_id === requestId).length, 1);
  });

  it("si el hold caduca, la plaza se libera sola y la solicitud pasa a expired (reloj virtual)", async () => {
    const created = await api("POST", `/v1/trips/${tripId}/requests`, { token: miguel, body: { fromSegmentSeq: 0, toSegmentSeq: 2 } });
    const requestId = str(asRecord(created.body).id);
    await api("POST", `/v1/ride-requests/${requestId}/decision`, { token: ana, body: { decision: "accept" } });
    assert.equal(await seatsOnAnaTrip(), 1);

    const expiredEvents: unknown[] = [];
    rt.db.events.on("ride_request.expired", (payload) => expiredEvents.push(payload));
    rt.db.clock.advance(9 * 60_000);
    assert.equal(await seatsOnAnaTrip(), 1, "a los 9 minutos el hold sigue vivo");
    rt.db.clock.advance(61_000);
    assert.equal(await seatsOnAnaTrip(), 2, "a los 10 min y 1 s la plaza vuelve a estar libre");
    assert.equal((await myRequest(requestId)).status, "expired");
    assert.equal((await myRequest(requestId)).hold_expires_at, null);
    assert.equal(expiredEvents.length, 1, "se avisa una sola vez");
  });

  it("pagar tarde (hold ya caducado): no hay reserva, la solicitud queda payment_late y se anota la devolución", async () => {
    const created = await api("POST", `/v1/trips/${tripId}/requests`, { token: miguel, body: { fromSegmentSeq: 0, toSegmentSeq: 2 } });
    const requestId = str(asRecord(created.body).id);
    await api("POST", `/v1/ride-requests/${requestId}/decision`, { token: ana, body: { decision: "accept" } });
    rt.db.clock.advance(11 * 60_000);
    // ni una petición HTTP entre medias: la comprobación es perezosa y no depende del barrido
    const late = confirmProviderPayment(rt.db, { requestId, providerPaymentId: "pay_late", amountCents: 290 });
    assert.equal(late.status, "compensation_required");
    assert.equal(rt.db.bookings.filter((b) => b.request_id === requestId).length, 0);
    assert.equal((await myRequest(requestId)).status, "payment_late");
    assert.equal(rt.db.collection("payment_compensations").size, 1);
  });

  it("Ana rechaza: no hay hold, no se reserva plaza y Miguel puede volver a solicitar", async () => {
    const created = await api("POST", `/v1/trips/${tripId}/requests`, { token: miguel, body: { fromSegmentSeq: 0, toSegmentSeq: 2 } });
    const requestId = str(asRecord(created.body).id);
    const rejected = await api("POST", `/v1/ride-requests/${requestId}/decision`, { token: ana, body: { decision: "reject" } });
    assert.equal(rejected.status, 200);
    assert.equal(asRecord(asRecord(rejected.body).request).status, "rejected");
    assert.equal(asRecord(rejected.body).hold, null);
    assert.equal(await seatsOnAnaTrip(), 2);
    const retry = await api("POST", `/v1/trips/${tripId}/requests`, { token: miguel, body: { fromSegmentSeq: 0, toSegmentSeq: 2 } });
    assert.equal(retry.status, 201);
  });

  it("capacidad por tramo: un viaje lleno no admite ni solicitudes nuevas (409 NO_CAPACITY_ON_SEGMENT)", async () => {
    const full = SEED_TRIP_IDS.martaWork;
    const segments = segmentsOf(rt.db, full);
    assert.ok(segments.length >= 1);
    const res = await api("POST", `/v1/trips/${full}/requests`, {
      token: miguel,
      body: { fromSegmentSeq: 0, toSegmentSeq: segments.length },
    });
    assert.equal(res.status, 409);
    assert.equal(asRecord(asRecord(res.body).error).code, "NO_CAPACITY_ON_SEGMENT");
    assert.equal(asRecord(asRecord(res.body).error).message, "No seat capacity on at least one affected segment");
  });

  it("dos solicitudes pendientes compiten por la última plaza: la segunda aceptación falla por capacidad", async () => {
    // Viaje de Ana: 3 plazas, Laura ya tiene una; quedan 2. Hugo (tramo 1→2) y Nuria (0→2) ya están pendientes.
    const created = await api("POST", `/v1/trips/${tripId}/requests`, { token: miguel, body: { fromSegmentSeq: 0, toSegmentSeq: 2 } });
    assert.equal(created.status, 201);
    const list = await api("GET", `/v1/trips/${tripId}/requests`, { token: ana });
    const pending = (asRecord(list.body).requests as Array<Record<string, unknown>>).filter((r) => r.status === "pending");
    assert.equal(pending.length, 3, "Hugo, Nuria y Miguel");
    const decide = (id: unknown) => api("POST", `/v1/ride-requests/${str(id)}/decision`, { token: ana, body: { decision: "accept" } });
    const outcomes: number[] = [];
    for (const request of pending) outcomes.push((await decide(request.id)).status);
    assert.deepEqual(outcomes, [200, 200, 409], "las dos primeras caben; la tercera ya no");
    const lastFailure = await decide(pending[2]?.id);
    assert.equal(asRecord(asRecord(lastFailure.body).error).code, "NO_CAPACITY_ON_SEGMENT");
  });

  it("validaciones: rango de tramos, viaje propio, viaje inexistente, sin rol de pasajero", async () => {
    const bad = await api("POST", `/v1/trips/${tripId}/requests`, { token: miguel, body: { fromSegmentSeq: 1, toSegmentSeq: 1 } });
    assert.equal(asRecord(asRecord(bad.body).error).code, "INVALID_SEGMENT_RANGE");
    const outOfRange = await api("POST", `/v1/trips/${tripId}/requests`, { token: miguel, body: { fromSegmentSeq: 0, toSegmentSeq: 9 } });
    assert.equal(asRecord(asRecord(outOfRange.body).error).message, "Requested segment range is not contiguous");
    const own = await api("POST", `/v1/trips/${tripId}/requests`, { token: ana, body: { fromSegmentSeq: 0, toSegmentSeq: 2 } });
    assert.equal(asRecord(asRecord(own.body).error).code, "DRIVER_CANNOT_REQUEST_OWN_TRIP");
    const missing = await api("POST", "/v1/trips/11111111-1111-4111-8111-111111111111/requests", {
      token: miguel,
      body: { fromSegmentSeq: 0, toSegmentSeq: 1 },
    });
    assert.equal(missing.status, 404);
    assert.equal(asRecord(asRecord(missing.body).error).code, "TRIP_NOT_FOUND");
    const anon = await api("POST", `/v1/trips/${tripId}/requests`, { body: { fromSegmentSeq: 0, toSegmentSeq: 2 } });
    assert.equal(anon.status, 401);
  });

  it("solo la conductora del viaje ve y decide sus solicitudes", async () => {
    const created = await api("POST", `/v1/trips/${tripId}/requests`, { token: miguel, body: { fromSegmentSeq: 0, toSegmentSeq: 2 } });
    const requestId = str(asRecord(created.body).id);
    const otherDriver = tokenFor(rt, "miguelAngel");
    const list = await api("GET", `/v1/trips/${tripId}/requests`, { token: otherDriver });
    assert.equal(list.status, 403);
    assert.equal(asRecord(asRecord(list.body).error).code, "TRIP_NOT_OWNED");
    const decide = await api("POST", `/v1/ride-requests/${requestId}/decision`, { token: otherDriver, body: { decision: "accept" } });
    assert.equal(decide.status, 403);
    const unknown = await api("POST", "/v1/ride-requests/11111111-1111-4111-8111-111111111111/decision", {
      token: ana,
      body: { decision: "accept" },
    });
    assert.equal(unknown.status, 404);
    assert.equal(asRecord(asRecord(unknown.body).error).code, "REQUEST_NOT_FOUND");
  });

  it("las solicitudes de Ana sembradas (Hugo y Nuria) aparecen en su viaje y se pueden decidir", async () => {
    const list = await api("GET", `/v1/trips/${tripId}/requests`, { token: ana });
    const pending = (asRecord(list.body).requests as Array<Record<string, unknown>>).filter((r) => r.status === "pending");
    assert.ok(pending.length >= 2, `esperaba al menos 2 pendientes y hay ${pending.length}`);
    const [first] = pending;
    const decided = await api("POST", `/v1/ride-requests/${str(first?.id)}/decision`, { token: ana, body: { decision: "accept" } });
    assert.equal(decided.status, 200);
  });
});
