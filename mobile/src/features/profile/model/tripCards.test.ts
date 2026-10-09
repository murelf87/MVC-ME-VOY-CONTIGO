import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OverviewCard, PublicUser, TripOverviewCard, WeeklyReservationCard } from "@/api/types";
import { buildTripCardView, splitUpcoming, statusTone, tabFromParam, tabLabels, tripSubtitle, type Viewer } from "./tripCards";

/** Lunes 5 de octubre de 2026, 07:18 en Madrid. */
const NOW = Date.parse("2026-10-05T07:18:00+02:00");

function user(id: string, name: string): PublicUser {
  return { id, displayName: name, firstName: name.split(" ")[0] ?? name, photoUrl: null, ratingAverage: null, ratingCount: 0 };
}

const miguel: Viewer = { id: "u-miguel", name: "Miguel Torres", photoUrl: "https://x/miguel.png" };

function weekly(overrides: Partial<WeeklyReservationCard> = {}): WeeklyReservationCard {
  return {
    kind: "weekly_reservation",
    id: "res-1",
    seriesId: "ser-1",
    reservationId: "res-1",
    category: "university",
    title: "Universidad",
    from: { label: "Sevilla (Los Bermejales)", timeLocal: "07:30" },
    to: { label: "U. Pablo de Olavide", timeLocal: "07:50" },
    riders: [user("u-laura", "Laura Gómez"), user("u-carlos", "Carlos Ruiz")],
    occupancy: { occupied: 3, total: 4 },
    status: { code: "confirmed", label: "Confirmada" },
    recurrence: { weekdays: ["mon", "tue", "wed", "thu", "fri"], recurring: true, label: "Lun - Vie · Recurrente" },
    ...overrides,
  };
}

function trip(overrides: Partial<TripOverviewCard> = {}): TripOverviewCard {
  return {
    kind: "trip",
    id: "req-1",
    tripId: "trip-1",
    requestId: "req-1",
    bookingId: "book-1",
    role: "passenger",
    leg: "outbound",
    category: "university",
    title: "Campus – U. Pablo de Olavide",
    from: { label: "Sevilla (Los Bermejales)", timeLocal: "07:30" },
    to: { label: "U. Pablo de Olavide", timeLocal: "07:50" },
    departureAt: "2026-10-05T05:30:00.000Z",
    startsInMinutes: 12,
    phase: "scheduled",
    riders: [user("u-laura", "Laura Gómez"), user("u-carlos", "Carlos Ruiz")],
    occupancy: { occupied: 3, total: 4 },
    status: { code: "confirmed", label: "Confirmada" },
    liveEta: { minutes: 10, phrase: "El conductor llegará en unos 10 min", stale: false },
    ...overrides,
  };
}

describe("tripSubtitle", () => {
  it("«Hoy · 07:30 – 07:50» y días siguientes", () => {
    assert.equal(tripSubtitle("2026-10-05T05:30:00.000Z", "07:30", "07:50", NOW), "Hoy · 07:30 – 07:50");
    assert.equal(tripSubtitle("2026-10-06T05:30:00.000Z", "07:30", "07:50", NOW), "Mañana · 07:30 – 07:50");
    assert.equal(tripSubtitle("2026-10-09T05:30:00.000Z", "07:30", "07:50", NOW), "Vie, 9 oct · 07:30 – 07:50");
  });
});

describe("reserva semanal (pasajero)", () => {
  const view = buildTripCardView(weekly(), { role: "passenger", now: NOW, viewer: miguel });
  it("usa el texto de recurrencia del servidor y la franja de estado", () => {
    assert.equal(view.kind, "weekly");
    assert.equal(view.title, "Universidad");
    assert.equal(view.subtitle, "Lun - Vie · Recurrente");
    assert.equal(view.pill, null);
    assert.deepEqual(view.strip, { kind: "status", label: "Confirmada", tone: "green", icon: "calendarCheck", action: { kind: "weekly", reservationId: "res-1" } });
  });
  it("la persona que mira abre la fila de avatares cuando su plaza está confirmada", () => {
    assert.deepEqual(view.people.map((p) => p.key), ["u-miguel", "u-laura", "u-carlos"]);
    assert.deepEqual(view.seats, { label: "3/4 plazas", a11y: "3 de 4 plazas ocupadas" });
  });
  it("abre la reserva semanal", () => {
    assert.deepEqual(view.primary, { kind: "weekly", reservationId: "res-1" });
    assert.equal(view.menu.length, 1);
  });
  it("sin reservationId no hay acción", () => {
    const sin = buildTripCardView(weekly({ reservationId: null }), { role: "passenger", now: NOW, viewer: miguel });
    assert.equal(sin.primary, null);
    assert.deepEqual(sin.menu, []);
  });
  it("una solicitud pendiente no cuenta como plaza ocupada por quien mira", () => {
    const pendiente = buildTripCardView(weekly({ status: { code: "pending", label: "Pendiente" } }), { role: "passenger", now: NOW, viewer: miguel });
    assert.deepEqual(pendiente.people.map((p) => p.key), ["u-laura", "u-carlos"]);
    assert.equal(pendiente.strip?.kind, "status");
    assert.equal(pendiente.strip?.kind === "status" ? pendiente.strip.tone : "", "amber");
  });
});

describe("serie semanal (conductor)", () => {
  it("abre la ruta semanal y no añade al conductor a los avatares", () => {
    const view = buildTripCardView(weekly({ id: "ser-1", reservationId: null, status: { code: "scheduled", label: "Programado" } }), { role: "driver", now: NOW, viewer: miguel });
    assert.deepEqual(view.primary, { kind: "series", seriesId: "ser-1" });
    assert.deepEqual(view.people.map((p) => p.key), ["u-laura", "u-carlos"]);
  });
});

describe("viaje de pasajero", () => {
  it("«En 12 min» con visto y franja con la llegada del conductor", () => {
    const view = buildTripCardView(trip(), { role: "passenger", now: NOW, viewer: miguel });
    assert.deepEqual(view.pill, { label: "En 12 min", tone: "green", icon: "check" });
    assert.equal(view.subtitle, "Hoy · 07:30 – 07:50");
    assert.deepEqual(view.strip, { kind: "eta", label: "El conductor llegará en unos 10 min", stale: false, action: { kind: "follow", bookingId: "book-1" } });
    assert.deepEqual(view.primary, { kind: "booking", requestId: "req-1" });
  });

  it("menú de un viaje confirmado: detalle, seguir y cancelar", () => {
    const view = buildTripCardView(trip(), { role: "passenger", now: NOW, viewer: miguel });
    assert.deepEqual(view.menu.map((item) => item.id), ["detail", "follow", "cancel"]);
    assert.equal(view.menu.find((item) => item.id === "cancel")?.destructive, true);
  });

  it("una solicitud pendiente muestra su estado, no la cuenta atrás, y permite retirarla", () => {
    const view = buildTripCardView(trip({ status: { code: "pending", label: "Pendiente" }, bookingId: null, liveEta: null }), { role: "passenger", now: NOW, viewer: miguel });
    assert.deepEqual(view.pill, { label: "Pendiente", tone: "amber" });
    assert.equal(view.strip, null);
    assert.deepEqual(view.menu.map((item) => item.id), ["detail", "withdraw"]);
    assert.deepEqual(view.menu.find((item) => item.id === "withdraw")?.action, { kind: "withdraw", requestId: "req-1" });
    assert.deepEqual(view.people.map((p) => p.key), ["u-laura", "u-carlos"]);
  });

  it("pago pendiente ofrece ir a pagar", () => {
    const view = buildTripCardView(trip({ status: { code: "payment_pending", label: "Pago pendiente" }, startsInMinutes: null, liveEta: null }), { role: "passenger", now: NOW, viewer: miguel });
    assert.deepEqual(view.pill, { label: "Pago pendiente", tone: "orange" });
    assert.ok(view.menu.some((item) => item.id === "pay"));
  });

  it("viaje terminado: resumen del viaje y sin franja", () => {
    const view = buildTripCardView(
      trip({ status: { code: "completed", label: "Completado" }, phase: "finished", startsInMinutes: null, liveEta: null, departureAt: "2026-10-01T05:30:00.000Z" }),
      { role: "passenger", now: NOW, viewer: miguel },
    );
    assert.deepEqual(view.pill, { label: "Completado", tone: "gray" });
    assert.deepEqual(view.menu.map((item) => item.id), ["detail", "finished"]);
    assert.equal(view.strip, null);
    assert.equal(view.subtitle, "Jue, 1 oct · 07:30 – 07:50");
  });

  it("sin requestId abre el viaje", () => {
    const view = buildTripCardView(trip({ requestId: null }), { role: "passenger", now: NOW, viewer: miguel });
    assert.deepEqual(view.primary, { kind: "tripDetail", tripId: "trip-1" });
  });
});

describe("viaje de conductor", () => {
  const driverTrip = trip({ role: "driver", id: "trip-1", requestId: null, bookingId: null, liveEta: null, status: { code: "scheduled", label: "Programado" } });
  it("programado: gestionar y solicitudes", () => {
    const view = buildTripCardView(driverTrip, { role: "driver", now: NOW, viewer: miguel });
    assert.deepEqual(view.primary, { kind: "driverManage", tripId: "trip-1" });
    assert.deepEqual(view.menu.map((item) => item.id), ["manage", "requests"]);
    assert.equal(view.strip, null);
  });
  it("en curso abre la consola y terminado su resumen", () => {
    const live = buildTripCardView({ ...driverTrip, phase: "live", status: { code: "live", label: "En curso" } }, { role: "driver", now: NOW, viewer: miguel });
    assert.deepEqual(live.primary, { kind: "driverConsole", tripId: "trip-1" });
    const done = buildTripCardView({ ...driverTrip, phase: "finished", status: { code: "completed", label: "Completado" } }, { role: "driver", now: NOW, viewer: miguel });
    assert.deepEqual(done.primary, { kind: "driverFinished", tripId: "trip-1" });
  });
});

describe("secciones", () => {
  const cards: OverviewCard[] = [weekly(), trip({ id: "a" }), trip({ id: "b" }), weekly({ id: "res-2", seriesId: "ser-2" })];
  it("separa reservas semanales, próximo viaje y más viajes", () => {
    const sections = splitUpcoming(cards);
    assert.equal(sections.weekly.length, 2);
    assert.equal(sections.next?.id, "a");
    assert.deepEqual(sections.more.map((card) => card.id), ["b"]);
  });
  it("sin viajes sueltos no hay «próximo»", () => {
    const sections = splitUpcoming([weekly()]);
    assert.equal(sections.next, null);
    assert.deepEqual(sections.more, []);
  });
  it("etiquetas de pestañas con contadores", () => {
    assert.deepEqual(tabLabels({ upcoming: 2, inProgress: 1, history: 9 }), { upcoming: "Próximos (2)", in_progress: "En curso (1)", history: "Historial" });
    assert.deepEqual(tabLabels({ upcoming: 0, inProgress: 0, history: 0 }), { upcoming: "Próximos", in_progress: "En curso", history: "Historial" });
    assert.deepEqual(tabLabels(null), { upcoming: "Próximos", in_progress: "En curso", history: "Historial" });
  });
  it("pestaña inicial según el parámetro", () => {
    assert.equal(tabFromParam(undefined), "upcoming");
    assert.equal(tabFromParam("in_progress"), "in_progress");
    assert.equal(tabFromParam("history"), "history");
    assert.equal(tabFromParam("past"), "history");
    assert.equal(tabFromParam("weekly"), "upcoming");
  });
  it("tonos por estado", () => {
    assert.equal(statusTone("confirmed"), "green");
    assert.equal(statusTone("rejected"), "red");
    assert.equal(statusTone("cancelled"), "gray");
  });
});
