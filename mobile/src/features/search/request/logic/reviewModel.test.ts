// Pruebas de «Revisa tu solicitud» (15): filas, bloqueos y cuerpos de petición.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Money, TripDetail, TripQuote, TripQuoteResponse, WeeklyRequestPreview } from "@/api/types";
import {
  blockFromReason,
  blockOf,
  buildReviewModel,
  cleanMessage,
  currentDropoffSeq,
  driverCard,
  dropoffOptions,
  dropoffLabel,
  routeBar,
  singleRequestBody,
  weeklyRequestBody,
  type ReviewSources,
  type ReviewWeekly,
} from "./reviewModel";

const plain = (text: string): string => text.replace(/\u00a0/g, " ");
const money = (cents: number | null, status: Money["status"]): Money => ({ cents, currency: "EUR", status });
const PENDING = money(null, "pending_definition");

function quoteOf(over: Partial<TripQuote> = {}): TripQuote {
  return {
    state: "pending_definition",
    tariff: { state: "approved", version: 1 },
    basis: { roadDistanceM: 6000, rateMicrosPerKm: 1_000_000 },
    contribution: money(600, "illustrative"),
    managementFee: PENDING,
    total: PENDING,
    weekly: null,
    lockedAt: null,
    ...over,
  };
}

function trip(over: Partial<TripDetail> = {}): TripDetail {
  const point = { lat: 37.38, lng: -5.99, precision: "precise" as const };
  const stop = (seq: number, kind: "origin" | "stop" | "destination", label: string | null) => ({
    seq,
    kind,
    label,
    location: point,
    etaAt: "2026-10-05T06:00:00.000Z",
    etaLocal: "08:00",
    optional: false,
    detourMinutes: null,
    isYourPickup: false,
    isYourDropoff: false,
    canBoard: true,
    canAlight: true,
  });
  return {
    id: "t1",
    seriesId: "s1",
    status: "published",
    kind: "recurring",
    leg: "outbound",
    category: "university",
    provinceId: "p1",
    provinceName: "Provincia de Sevilla",
    driver: { id: "u1", displayName: "Ana García", firstName: "Ana", photoUrl: null, ratingAverage: 4.8, ratingCount: 32 },
    vehicle: { id: null, make: "Seat", model: "Arona", color: "Gris", displayName: "Seat Arona · Gris", plateHint: "MBC", plate: null, passengerSeats: 3 },
    departureAt: "2026-10-05T06:00:00.000Z",
    flexibilityMinutes: 0,
    recurrence: { weekdays: ["mon", "tue", "wed", "thu", "fri"], outboundLocal: "08:05", returnLocal: "18:00" },
    pickupPolicy: { onRoute: true, maxDetourMinutes: 5 },
    seats: { offered: 3, available: 2, perSegment: [] },
    route: { distanceM: 6000, durationMinutes: 20, geometry: { type: "LineString", coordinates: [], precision: "precise" } },
    stops: [stop(0, "origin", "Sevilla Centro"), stop(1, "destination", "Universidad de Sevilla")],
    totals: { roadDistanceM: 6000, durationMinutes: 20, detourMinutes: 0 },
    price: PENDING,
    breakdownAvailable: true,
    viewer: { relation: "public", precision: "approximate", openRequest: null },
    owner: null,
    canRequest: true,
    cannotRequestReason: null,
    ...over,
  };
}

function quoteResponse(over: Partial<TripQuoteResponse> = {}): TripQuoteResponse {
  const at = "2026-10-05T06:00:00.000Z";
  return {
    tripId: "t1",
    quote: quoteOf(),
    pickup: { label: "Aparcamiento público", address: null, location: { lat: 1, lng: 2, precision: "precise" }, atLocal: "08:00", at, walkMinutes: 4, detourMinutes: 2 },
    dropoff: { label: "Universidad de Sevilla", address: null, location: { lat: 1, lng: 2, precision: "precise" }, atLocal: "08:25", at, walkMinutes: null, detourMinutes: null },
    seatsAvailable: 2,
    roadDistanceM: 6000,
    canRequest: true,
    cannotRequestReason: null,
    ...over,
  };
}

function preview(over: Partial<WeeklyRequestPreview> = {}): WeeklyRequestPreview {
  return {
    tripId: "t1",
    seriesId: "s1",
    legs: [
      { leg: "outbound", label: "Ida (mañana)", fromLabel: "A", toLabel: "B", boardsAtLocal: "08:00", arrivesAtLocal: "08:25" },
      { leg: "return", label: "Vuelta (tarde)", fromLabel: "B", toLabel: "A", boardsAtLocal: "18:00", arrivesAtLocal: "18:25" },
    ],
    occurrences: [],
    quote: quoteOf({
      weekly: {
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
        legsPerDay: 2,
        tripsPerWeek: 10,
        contributionPerWeek: money(1800, "illustrative"),
        totalPerWeek: PENDING,
      },
      contribution: money(180, "illustrative"),
    }),
    canSubmit: true,
    issues: [],
    ...over,
  };
}

const weekly: ReviewWeekly = { weekdays: ["mon", "tue", "wed", "thu", "fri"], startDate: "2026-10-05", weeks: 1, legs: ["outbound", "return"] };

function sources(over: Partial<ReviewSources> = {}): ReviewSources {
  return {
    trip: trip(),
    quote: quoteResponse(),
    preview: null,
    weekly: null,
    pickup: { code: "A", name: "Aparcamiento público", address: "Av. Manuel Siurot", walkMinutes: 4, detourMinutes: 2 },
    dropoffStopSeq: null,
    ...over,
  };
}

describe("cabecera, conductor y destino", () => {
  it("barra: origen del viaje y categoría del destino", () => {
    assert.deepEqual(routeBar(trip()), { from: "Sevilla Centro", to: "Universidad", category: "university" });
  });
  it("categoría «Otros»: usa el nombre del último punto", () => {
    assert.equal(routeBar(trip({ category: "other" })).to, "Universidad de Sevilla");
  });
  it("conductor: nombre de pila, valoración, hábito y vehículo", () => {
    const d = driverCard(trip());
    assert.equal(d.name, "Ana");
    assert.equal(d.rating, "4,8");
    assert.match(d.ratings, /^\(32\s+valoraciones\)$/);
    assert.equal(d.habit, "Conduce este trayecto habitualmente.");
    assert.equal(d.vehicle, "Seat Arona · Gris");
  });
  it("sin valoraciones ni viaje periódico", () => {
    const d = driverCard(trip({ kind: "single", driver: { ...trip().driver, ratingAverage: null, ratingCount: 0 } }));
    assert.equal(d.rating, null);
    assert.equal(d.ratings, "Sin valoraciones todavía");
    assert.equal(d.habit, "Viaje puntual.");
  });
  it("destino: el del presupuesto; si no, el de la parada; si no, el último punto", () => {
    assert.equal(dropoffLabel(trip(), quoteResponse(), null), "Universidad de Sevilla");
    assert.equal(dropoffLabel(trip(), null, 1), "Universidad de Sevilla");
    assert.equal(dropoffLabel(trip(), null, null), "Universidad de Sevilla");
  });
});

describe("buildReviewModel", () => {
  it("solicitud de un trayecto (15a): filas y detalle de la aportación", () => {
    const model = buildReviewModel(sources());
    assert.equal(plain(model.distance), "6 km");
    assert.equal(model.weekly, false);
    assert.equal(model.seat.title, "Tu plaza");
    assert.match(model.seat.lines[0] ?? "", /de octubre de 2026$/);
    assert.equal(model.seat.lines[1], "Recogida 08:00 · Llegada 08:25");
    assert.deepEqual(model.pickup.lines, ["Aparcamiento público", "Av. Manuel Siurot (4 min a pie)"]);
    assert.deepEqual(model.dropoff.lines, ["Universidad de Sevilla"]);
    assert.equal(model.quote.layout, "perTrip");
    assert.equal(model.block, null);
  });
  it("reserva semanal (15b): días, horas de ida y vuelta y desglose semanal", () => {
    const model = buildReviewModel(sources({ weekly, preview: preview() }));
    assert.equal(model.weekly, true);
    assert.deepEqual(model.seat.lines, ["Lunes a viernes", "Ida 08:00 · Vuelta 18:00"]);
    assert.equal(model.quote.layout, "weekly");
    assert.equal(model.quote.total.label, "Total · Pendiente de tarifa final");
  });
  it("reserva semanal solo de ida: no enseña la vuelta", () => {
    const model = buildReviewModel(sources({ weekly: { ...weekly, legs: ["outbound"] }, preview: preview() }));
    assert.deepEqual(model.seat.lines, ["Lunes a viernes", "Ida 08:00"]);
  });
  it("sin nombre ni dirección del punto: texto de reserva; sin minutos a pie no inventa nada", () => {
    const model = buildReviewModel(
      sources({
        pickup: null,
        quote: quoteResponse({ pickup: { ...quoteResponse().pickup, label: null, walkMinutes: null } }),
      }),
    );
    assert.deepEqual(model.pickup.lines, ["Punto de recogida elegido"]);
  });
  it("solo la dirección: línea única con los minutos a pie", () => {
    const model = buildReviewModel(sources({ quote: null, pickup: { address: "Calle Feria 3", walkMinutes: 5 } }));
    assert.deepEqual(model.pickup.lines, ["Calle Feria 3 (5 min a pie)"]);
  });
  it("sin datos del servidor todavía: todo «Por definir», nunca un importe inventado", () => {
    const model = buildReviewModel(sources({ quote: null }));
    assert.equal(model.quote.total.value, "Por definir");
    assert.equal(model.quote.lines[0]?.value, "Por definir");
  });
});

describe("bloqueos", () => {
  it("mapea los códigos del contrato", () => {
    assert.equal(blockFromReason(null, null), null);
    assert.equal(blockFromReason("DRIVER_CANNOT_REQUEST_OWN_TRIP", null)?.kind, "ownTrip");
    assert.equal(blockFromReason("TRIP_NOT_BOOKABLE", null)?.kind, "notBookable");
    assert.equal(blockFromReason("AUTH_REQUIRED", null)?.kind, "auth");
    assert.equal(blockFromReason("NO_CAPACITY", null)?.kind, "noSeats");
    assert.equal(blockFromReason("NO_CAPACITY_ON_SEGMENT", null)?.kind, "noSeats");
    assert.equal(blockFromReason("ALGO_NUEVO", null)?.kind, "unknown");
    assert.deepEqual(blockFromReason("OPEN_REQUEST_EXISTS", "r1"), {
      kind: "openRequest",
      message: "Mientras esté abierta no puedes enviar otra igual.",
      requestId: "r1",
    });
  });
  it("un trayecto sin plaza bloquea; una reserva semanal con otro día libre, no", () => {
    const full = quoteResponse({ canRequest: false, cannotRequestReason: "NO_CAPACITY" });
    assert.equal(blockOf(sources({ quote: full }))?.kind, "noSeats");
    const fullTrip = trip({ canRequest: false, cannotRequestReason: "NO_CAPACITY" });
    assert.equal(blockOf(sources({ trip: fullTrip, quote: full, weekly, preview: preview() })), null);
  });
  it("solicitud abierta: lleva el id para abrirla", () => {
    const open = trip({ canRequest: false, cannotRequestReason: "OPEN_REQUEST_EXISTS", viewer: { relation: "requester", precision: "precise", openRequest: { id: "r9", status: "pending" } } });
    const block = blockOf(sources({ trip: open, quote: quoteResponse({ canRequest: false, cannotRequestReason: "OPEN_REQUEST_EXISTS" }) }));
    assert.equal(block?.kind, "openRequest");
    assert.equal(block !== null && block.kind === "openRequest" ? block.requestId : null, "r9");
  });
  it("reserva semanal que el servidor no deja enviar: dice su motivo", () => {
    const blocked = preview({ canSubmit: false, issues: [{ code: "WEEKLY_OCCURRENCE_UNAVAILABLE", message: "No hay plaza el martes.", date: "2026-10-06" }] });
    const block = blockOf(sources({ weekly, preview: blocked }));
    assert.equal(block?.kind, "weekly");
    assert.equal(block?.message, "No hay plaza el martes.");
  });
});

describe("cuerpos de las peticiones", () => {
  it("solicitud suelta: solo lleva lo que existe", () => {
    assert.deepEqual(singleRequestBody({ pickupPointId: "pp1_a", dropoffStopSeq: null, message: "  " }), { pickupPointId: "pp1_a" });
    assert.deepEqual(singleRequestBody({ pickupPointId: "pp1_a", dropoffStopSeq: 2, message: " Hola " }), {
      pickupPointId: "pp1_a",
      dropoffStopSeq: 2,
      message: "Hola",
    });
  });
  it("el mensaje se recorta a 300 caracteres", () => {
    assert.equal(cleanMessage("x".repeat(400))?.length, 300);
    assert.equal(cleanMessage("   "), null);
  });
  it("reserva semanal: cuerpo del contrato, con excepciones y consentimiento solo si existen", () => {
    const body = weeklyRequestBody({
      weekly: { ...weekly, exceptionDates: ["2026-10-07"], allowPartial: true },
      pickupPointId: "pp1_a",
      dropoffStopSeq: 3,
      message: "Hola",
    });
    assert.deepEqual(body, {
      pickupPointId: "pp1_a",
      dropoffStopSeq: 3,
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      legs: ["outbound", "return"],
      startDate: "2026-10-05",
      weeks: 1,
      cancellationPolicyVersion: null,
      exceptionDates: ["2026-10-07"],
      allowPartial: true,
      message: "Hola",
    });
    const plain = weeklyRequestBody({ weekly, pickupPointId: "pp1_a", dropoffStopSeq: null, message: "" });
    assert.ok(!("allowPartial" in plain));
    assert.ok(!("exceptionDates" in plain));
    assert.ok(!("message" in plain));
  });
});

describe("bajada elegible", () => {
  const threeStops = trip({
    stops: [
      { ...trip().stops[0]!, seq: 0 },
      { ...trip().stops[0]!, seq: 1, kind: "stop", label: "Dos Hermanas", etaAt: "2026-10-05T06:10:00.000Z", etaLocal: "08:10" },
      { ...trip().stops[1]!, seq: 2, label: "Universidad de Sevilla", etaAt: "2026-10-05T06:25:00.000Z", etaLocal: "08:25" },
    ],
  });
  it("solo ofrece paradas posteriores a la recogida y donde se puede bajar", () => {
    const quote = quoteResponse({ pickup: { ...quoteResponse().pickup, at: "2026-10-05T06:05:00.000Z" } });
    assert.deepEqual(dropoffOptions(threeStops, quote).map((o) => o.seq), [1, 2]);
    const late = quoteResponse({ pickup: { ...quoteResponse().pickup, at: "2026-10-05T06:15:00.000Z" } });
    assert.deepEqual(dropoffOptions(threeStops, late).map((o) => o.label), ["Universidad de Sevilla"]);
  });
  it("sin presupuesto ofrece todas menos el origen; la vigente por defecto es el último punto", () => {
    assert.deepEqual(dropoffOptions(threeStops, null).map((o) => o.seq), [1, 2]);
    assert.equal(currentDropoffSeq(threeStops, null), 2);
    assert.equal(currentDropoffSeq(threeStops, 1), 1);
  });
});
