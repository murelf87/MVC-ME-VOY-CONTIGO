// Pruebas del modelo de vista de la consola del conductor (driver-ops).
// Ejecutar:  cd mobile && node --import tsx --test "src/features/driver/**/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  STALE_AFTER_SECONDS,
  bannerFor,
  confirmedCount,
  consolePhase,
  effectiveSignal,
  etaView,
  formatAge,
  mapModel,
  nextPickup,
  orderPassengers,
  passengerRows,
  passengerState,
  positionAgeSeconds,
  routeChangeBanner,
  serverNowMs,
} from "./console";
import { NOW_ISO, eta, makeConsole, passenger, position } from "./consoleFixture";

const NOW_MS = Date.parse(NOW_ISO);

describe("reloj del servidor", () => {
  it("suma al serverTime lo transcurrido desde que llegó la respuesta", () => {
    assert.equal(serverNowMs(NOW_ISO, 1_000, 11_000), NOW_MS + 10_000);
  });
  it("un reloj del móvil que va hacia atrás no resta", () => {
    assert.equal(serverNowMs(NOW_ISO, 5_000, 1_000), NOW_MS);
  });
  it("un serverTime ilegible usa el reloj del móvil", () => {
    assert.equal(serverNowMs("no-es-fecha", 0, 123), 123);
  });
});

describe("antigüedad de la posición", () => {
  it("suma el tiempo desde la respuesta", () => {
    assert.equal(positionAgeSeconds(position({ ageSeconds: 5 }), 0, 12_000), 17);
    assert.equal(positionAgeSeconds(null, 0, 1), null);
  });
  it("una posición «en directo» vieja pasa a «sin señal»", () => {
    assert.equal(effectiveSignal("live", 5), "live");
    assert.equal(effectiveSignal("live", STALE_AFTER_SECONDS + 1), "stale");
    assert.equal(effectiveSignal("stale", 5), "stale");
    assert.equal(effectiveSignal("none", null), "none");
  });
  it("se escribe como en las láminas", () => {
    assert.equal(formatAge(5, NOW_MS), "hace 5 s");
    assert.equal(formatAge(120, NOW_MS), "hace 2 min");
    assert.equal(formatAge(2, NOW_MS), "ahora mismo");
  });
});

describe("ETA", () => {
  it("hora local, minutos desde el reloj del servidor y distancia", () => {
    const view = etaView(eta("2026-10-05T05:25:00.000Z", 2400), NOW_MS);
    assert.ok(view);
    assert.equal(view.time, "07:25");
    assert.equal(view.minutes, 8);
    assert.equal(view.minutesText, "8\u00a0min");
    assert.equal(view.distanceText, "2,4\u00a0km");
  });
  it("sin distancia no la inventa; a punto de llegar dice «Ahora»", () => {
    const view = etaView(eta("2026-10-05T05:17:10.000Z", null, true), NOW_MS + 30_000);
    assert.ok(view);
    assert.equal(view.distanceText, null);
    assert.equal(view.minutes, 0);
    assert.equal(view.minutesText, "Ahora");
    assert.equal(view.approximate, true);
  });
  it("sin ETA → null", () => {
    assert.equal(etaView(null, NOW_MS), null);
  });
});

describe("fase y banner", () => {
  it("published es «scheduled»", () => {
    assert.equal(consolePhase("published"), "scheduled");
    assert.equal(consolePhase("active"), "active");
  });
  it("viaje publicado: hora de salida y pasajeros confirmados", () => {
    const banner = bannerFor(makeConsole({ status: "published", startedAt: null }));
    assert.equal(banner.phase, "scheduled");
    assert.equal(banner.kind, "info");
    assert.equal(banner.title, "Tu viaje sale a las 08:05");
    assert.match(banner.message, /2\s+pasajeros confirmados/);
  });
  it("viaje publicado sin pasajeros", () => {
    const banner = bannerFor(makeConsole({ status: "published", passengers: [] }));
    assert.equal(banner.message, "Aún no tienes pasajeros confirmados.");
  });
  it("en curso, terminado y cancelado", () => {
    assert.deepEqual(
      [bannerFor(makeConsole()).title, bannerFor(makeConsole()).message, bannerFor(makeConsole()).kind],
      ["Viaje en curso", "Empezaste a las 07:13", "success"],
    );
    assert.equal(bannerFor(makeConsole({ status: "completed", completedAt: "2026-10-05T06:30:00.000Z" })).message, "Terminaste a las 08:30");
    const cancelled = bannerFor(makeConsole({ status: "cancelled" }));
    assert.equal(cancelled.kind, "error");
  });
  it("cuenta solo las reservas confirmadas", () => {
    const c = makeConsole({ passengers: [passenger("Laura"), passenger("Ana", { bookingStatus: "no_show" })] });
    assert.equal(confirmedCount(c), 1);
  });
});

describe("estado de cada pasajero", () => {
  it("lo que dice el servidor, sin adivinar", () => {
    assert.equal(passengerState(passenger("A"), "active"), "waiting");
    assert.equal(passengerState(passenger("A", { pickedUp: true, pickedUpAt: NOW_ISO, code: { status: "verified", attemptsRemaining: null } }), "active"), "picked");
    assert.equal(passengerState(passenger("A", { code: { status: "locked", attemptsRemaining: 0 } }), "active"), "code_locked");
    assert.equal(passengerState(passenger("A", { code: { status: "not_generated", attemptsRemaining: null } }), "active"), "code_missing");
    assert.equal(passengerState(passenger("A", { bookingStatus: "no_show" }), "completed"), "no_show");
    assert.equal(passengerState(passenger("A", { bookingStatus: "completed", pickedUp: true }), "completed"), "completed");
  });
  it("antes de iniciar el viaje el código no es un problema", () => {
    assert.equal(passengerState(passenger("A", { code: { status: "not_generated", attemptsRemaining: null } }), "published"), "waiting");
  });
});

describe("filas de pasajeros", () => {
  it("el siguiente va primero y solo se verifica lo que falta por recoger", () => {
    const laura = passenger("Laura", { etaToPickup: eta("2026-10-05T05:25:00.000Z") });
    const miguel = passenger("Miguel", { etaToPickup: eta("2026-10-05T05:20:00.000Z"), pickup: { seq: 1, label: "Dos Hermanas", location: { lat: 37.283, lng: -5.921 } } });
    const done = passenger("Nuria", { pickedUp: true, pickedUpAt: "2026-10-05T05:10:00.000Z", etaToPickup: null, code: { status: "verified", attemptsRemaining: null } });
    const c = makeConsole({
      passengers: [done, laura, miguel],
      next: { bookingId: miguel.bookingId, passenger: miguel.passenger, pickup: miguel.pickup, etaToPickup: miguel.etaToPickup },
    });
    const rows = passengerRows(c, NOW_MS);
    assert.deepEqual(rows.map((r) => r.passenger.firstName), ["Miguel", "Laura", "Nuria"]);
    assert.equal(rows[0]?.isNext, true);
    assert.equal(rows[0]?.canVerify, true);
    assert.equal(rows[2]?.canVerify, false);
    assert.equal(rows[2]?.state, "picked");
    assert.match(rows[2]?.detail ?? "", /^Recogido a las 07:10$/);
    assert.equal(rows[0]?.detail, "Dos Hermanas · 07:20");
  });
  it("con el viaje sin iniciar no se puede verificar a nadie", () => {
    const rows = passengerRows(makeConsole({ status: "published", next: null }), NOW_MS);
    assert.ok(rows.every((r) => !r.canVerify));
  });
  it("las paradas sin nombre se llaman «Parada n»", () => {
    const c = makeConsole({ passengers: [passenger("Laura", { pickup: { seq: 3, label: null, location: { lat: 37, lng: -5 } } })] });
    assert.match(passengerRows(c, NOW_MS)[0]?.detail ?? "", /Parada 3/);
  });
  it("orderPassengers conserva el orden relativo cuando todo empata", () => {
    const rows = passengerRows(makeConsole({ passengers: [passenger("A", { etaToPickup: null }), passenger("B", { etaToPickup: null })], next: null }), NOW_MS);
    assert.deepEqual(orderPassengers(rows).map((r) => r.passenger.firstName), ["A", "B"]);
  });
});

describe("siguiente recogida y mapa", () => {
  it("solo con el viaje en curso", () => {
    assert.equal(nextPickup(makeConsole({ status: "published" }), NOW_MS), null);
    const next = nextPickup(makeConsole(), NOW_MS);
    assert.ok(next);
    assert.equal(next.passenger.firstName, "Laura");
    assert.equal(next.place, "Montequinto");
    assert.equal(next.eta?.time, "07:25");
  });
  it("el mapa lleva el coche y las recogidas pendientes", () => {
    const model = mapModel(makeConsole(), false);
    assert.equal(model.pickups.length, 2);
    assert.equal(model.pickups.filter((p) => p.isNext).length, 1);
    assert.equal(model.pickups[0]?.time, "07:25");
    assert.ok(model.car);
    assert.equal(model.points.length, 3);
  });
  it("sin posición no hay coche", () => {
    const model = mapModel(makeConsole({ position: null, signal: "none" }), false);
    assert.equal(model.car, null);
  });
  it("los recogidos ya no son marcadores", () => {
    const done = passenger("Nuria", { pickedUp: true, pickedUpAt: NOW_ISO, code: { status: "verified", attemptsRemaining: null } });
    assert.equal(mapModel(makeConsole({ passengers: [done] }), false).pickups.length, 0);
  });
});

describe("aviso de propuesta pendiente", () => {
  it("resume quién ha aceptado y cuándo caduca", () => {
    const c = makeConsole({
      pendingRouteChange: { id: "rc-1", createdAt: NOW_ISO, expiresAt: "2026-10-05T05:22:00.000Z", counts: { required: 2, accepted: 1, rejected: 0, pending: 1 } },
    });
    const banner = routeChangeBanner(c);
    assert.ok(banner);
    assert.equal(banner.message, "1 de 2 ya han aceptado");
    assert.equal(banner.expires, "Caduca a las 07:22");
    assert.equal(routeChangeBanner(makeConsole()), null);
  });
});
