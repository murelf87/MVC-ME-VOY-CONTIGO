// Pruebas de la lógica pura del seguimiento en directo (tiempo, señal, fase, ETA y mapa) del slice live.
// Ejecutar:  cd mobile && node --import tsx --test "src/features/live/**/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LiveBookingStatusView, LiveEta, LivePosition } from "@/api/types";
import { etaView, remainingLine } from "./eta";
import { carDrawMode, liveMapModel, ringExtremes, ringPoints } from "./mapModel";
import {
  IN_CAR_POLL_MS,
  LIVE_POLL_MS,
  SCHEDULED_POLL_MS,
  inCarPollInterval,
  redirectFromInCar,
  redirectFromWaiting,
  waitingBanner,
  waitingPollInterval,
} from "./phase";
import { resolveSignal, showsCarMarker, showsZone } from "./signal";
import { ageNow, elapsedSince, formatAge, secondsUntil, secondsUntilNow } from "./time";

import { NBSP } from "@/i18n";

function position(overrides: Partial<LivePosition> = {}): LivePosition {
  return {
    location: { lat: 37.3878, lng: -5.9811 },
    headingDegrees: 128.5,
    speedMps: 9.4,
    accuracyM: 7,
    recordedAt: "2026-10-05T05:16:55.000Z",
    receivedAt: "2026-10-05T05:16:56.000Z",
    ageSeconds: 5,
    stale: false,
    precision: "precise",
    ...overrides,
  };
}

function eta(overrides: Partial<LiveEta> = {}): LiveEta {
  return { at: "2026-10-05T05:25:00.000Z", minutes: 8, distanceM: 2400, source: "live_route", approximate: false, ...overrides };
}

function view(overrides: Partial<LiveBookingStatusView> = {}): LiveBookingStatusView {
  return {
    bookingId: "b1",
    tripId: "t1",
    phase: "driver_en_route",
    tripStatus: "active",
    bookingStatus: "confirmed",
    serverTime: "2026-10-05T05:17:00.000Z",
    driver: { id: "d1", displayName: "Ana García López", firstName: "Ana", photoUrl: null, ratingAverage: 4.8, ratingCount: 32 },
    vehicle: { make: "Seat", model: "León", color: "Blanco", plate: "1234 LBC" },
    pickup: { seq: 0, label: "C. Luis Montoto", location: { lat: 37.3849, lng: -5.9738 }, plannedAt: "2026-10-05T05:25:00.000Z" },
    dropoff: { seq: 2, label: "Universidad de Sevilla", location: { lat: 37.3589, lng: -5.9865 }, plannedAt: "2026-10-05T06:20:00.000Z" },
    etaTarget: "pickup",
    eta: eta(),
    signal: "live",
    lastUpdateAt: "2026-10-05T05:16:55.000Z",
    lastUpdateAgeSeconds: 5,
    staleAfterSeconds: 60,
    position: position(),
    arrival: { warning: false, arrived: false, warningThresholdSeconds: 300 },
    chat: { peerUserId: "d1", available: true },
    pendingRouteChange: null,
    ...overrides,
  };
}

describe("tiempo", () => {
  it("formatAge: ahora mismo, segundos, minutos y horas", () => {
    assert.equal(formatAge(0), "ahora mismo");
    assert.equal(formatAge(4.9), "ahora mismo");
    assert.equal(formatAge(5), `hace 5${NBSP}s`);
    assert.equal(formatAge(59), `hace 59${NBSP}s`);
    assert.equal(formatAge(120), `hace 2${NBSP}min`);
    assert.equal(formatAge(3 * 3600 + 5), `hace 3${NBSP}h`);
    assert.equal(formatAge(-10), "ahora mismo");
    assert.equal(formatAge(Number.NaN), "ahora mismo");
  });

  it("elapsedSince y ageNow suman el tiempo transcurrido sin ser negativos", () => {
    assert.equal(elapsedSince(null, 5000), 0);
    assert.equal(elapsedSince(1000, 6000), 5);
    assert.equal(elapsedSince(6000, 1000), 0);
    assert.equal(ageNow(5, 3), 8);
    assert.equal(ageNow(null, 3), null);
    assert.equal(ageNow(-4, 1), 1);
  });

  it("secondsUntil usa la referencia del servidor y resta lo transcurrido", () => {
    assert.equal(secondsUntil("2026-10-05T05:22:00.000Z", "2026-10-05T05:17:00.000Z", 0), 300);
    assert.equal(secondsUntil("2026-10-05T05:22:00.000Z", "2026-10-05T05:17:00.000Z", 45), 255);
    assert.equal(secondsUntil("2026-10-05T05:22:00.000Z", "2026-10-05T05:17:00.000Z", 400), -100);
    assert.equal(secondsUntil(null, "2026-10-05T05:17:00.000Z", 0), null);
    assert.equal(secondsUntil("no-es-fecha", "2026-10-05T05:17:00.000Z", 0), null);
    assert.equal(secondsUntilNow("2026-10-05T05:22:00.000Z", Date.parse("2026-10-05T05:21:00.000Z")), 60);
    assert.equal(secondsUntilNow(null, 0), null);
  });
});

describe("señal", () => {
  const base = { staleAfterSeconds: 60, elapsedSeconds: 0 };

  it("posición reciente y precisa = live", () => {
    const state = resolveSignal({ ...base, signal: "live", position: position(), lastUpdateAgeSeconds: 5 });
    assert.deepEqual(state, { kind: "live", ageSeconds: 5 });
  });

  it("el dato envejece entre sondeos y pasa a stale al cruzar el umbral aunque el servidor dijera live", () => {
    const fresh = resolveSignal({ ...base, elapsedSeconds: 30, signal: "live", position: position(), lastUpdateAgeSeconds: 5 });
    assert.equal(fresh.kind, "live");
    assert.equal(fresh.ageSeconds, 35);
    const old = resolveSignal({ ...base, elapsedSeconds: 60, signal: "live", position: position(), lastUpdateAgeSeconds: 5 });
    assert.equal(old.kind, "stale");
    assert.equal(old.ageSeconds, 65);
  });

  it("stale del servidor (Sin señal · Última posición: hace 2 min)", () => {
    const state = resolveSignal({ ...base, signal: "stale", position: position({ ageSeconds: 120, stale: true }), lastUpdateAgeSeconds: 120 });
    assert.deepEqual(state, { kind: "stale", ageSeconds: 120 });
  });

  it("posición aproximada = approximate (zona), también cuando es vieja pasa a stale", () => {
    const zone = resolveSignal({ ...base, signal: "live", position: position({ precision: "approximate", accuracyM: 1000, headingDegrees: null, speedMps: null }), lastUpdateAgeSeconds: 5 });
    assert.equal(zone.kind, "approximate");
    const staleZone = resolveSignal({ ...base, signal: "stale", position: position({ precision: "approximate", ageSeconds: 200, stale: true }), lastUpdateAgeSeconds: 200 });
    assert.equal(staleZone.kind, "stale");
  });

  it("sin posición o signal none = none", () => {
    assert.deepEqual(resolveSignal({ ...base, signal: "none", position: null, lastUpdateAgeSeconds: null }), { kind: "none", ageSeconds: null });
    assert.deepEqual(resolveSignal({ ...base, signal: "live", position: null, lastUpdateAgeSeconds: null }), { kind: "none", ageSeconds: null });
  });

  it("solo se dibuja coche con posición precisa; la aproximada es una zona", () => {
    assert.equal(showsCarMarker(position()), true);
    assert.equal(showsCarMarker(position({ precision: "approximate" })), false);
    assert.equal(showsCarMarker(null), false);
    assert.equal(showsZone(position({ precision: "approximate" })), true);
    assert.equal(showsZone(position()), false);
  });
});

describe("fase", () => {
  it("la franja superior cambia con la fase y usa el nombre y los minutos del servidor", () => {
    const enRoute = waitingBanner(view());
    assert.equal(enRoute.kind, "enRoute");
    assert.equal(enRoute.title, "Ana está en camino");
    assert.equal(enRoute.message, `Llegada en unos 8${NBSP}min`);
    assert.equal(waitingBanner(view({ eta: null })).message, "Calculando la llegada…");
    assert.equal(waitingBanner(view({ eta: eta({ minutes: 0 }) })).message, "Llegada en menos de 1 min");
    assert.equal(waitingBanner(view({ phase: "arriving" })).kind, "arriving");
    const atPickup = waitingBanner(view({ phase: "at_pickup" }));
    assert.equal(atPickup.kind, "atPickup");
    assert.equal(atPickup.title, "Ana ha llegado");
    const scheduled = waitingBanner(view({ phase: "scheduled" }));
    assert.equal(scheduled.kind, "scheduled");
    assert.match(scheduled.message, /Salida prevista a las 07:25/);
    assert.equal(waitingBanner(view({ phase: "cancelled" })).kind, "cancelled");
  });

  it("scheduled sin hora prevista no inventa una", () => {
    const banner = waitingBanner(view({ phase: "scheduled", pickup: { seq: 0, label: null, location: { lat: 1, lng: 1 }, plannedAt: null } }));
    assert.equal(banner.message, "Te avisaremos cuando Ana se ponga en marcha.");
  });

  it("redirecciones: subir al coche → En el coche; terminar → Viaje terminado", () => {
    assert.equal(redirectFromWaiting("in_vehicle"), "InCar");
    assert.equal(redirectFromWaiting("completed"), "TripFinished");
    assert.equal(redirectFromWaiting("driver_en_route"), null);
    assert.equal(redirectFromWaiting("cancelled"), null);
    assert.equal(redirectFromInCar("completed"), "TripFinished");
    assert.equal(redirectFromInCar("in_vehicle"), null);
    assert.equal(redirectFromInCar("cancelled"), null);
  });

  it("sondeo: frecuente mientras el coche se mueve, lento sin iniciar, ninguno en fases finales", () => {
    assert.equal(waitingPollInterval("driver_en_route"), LIVE_POLL_MS);
    assert.equal(waitingPollInterval("arriving"), LIVE_POLL_MS);
    assert.equal(waitingPollInterval("at_pickup"), LIVE_POLL_MS);
    assert.equal(waitingPollInterval("scheduled"), SCHEDULED_POLL_MS);
    assert.equal(waitingPollInterval("completed"), false);
    assert.equal(waitingPollInterval("cancelled"), false);
    assert.equal(waitingPollInterval(undefined), LIVE_POLL_MS);
    assert.equal(inCarPollInterval("in_vehicle"), IN_CAR_POLL_MS);
    assert.equal(inCarPollInterval("at_pickup"), IN_CAR_POLL_MS);
    assert.equal(inCarPollInterval("completed"), false);
    assert.ok(LIVE_POLL_MS >= 5_000 && LIVE_POLL_MS <= 10_000, "el contrato recomienda 5–10 s para /live");
    assert.ok(IN_CAR_POLL_MS >= 15_000 && IN_CAR_POLL_MS <= 30_000, "el contrato recomienda 15–30 s para /in-car");
  });
});

describe("ETA", () => {
  it("minutos y distancia tal cual los da el servidor", () => {
    const v = etaView(eta());
    assert.ok(v);
    assert.equal(v.label, "Llegada estimada");
    assert.equal(v.time, "07:25");
    assert.equal(v.line, `8${NBSP}min · 2,4${NBSP}km`);
    assert.equal(v.approximate, false);
  });

  it("sin distancia (conductor que no comparte ubicación) se pinta solo con minutos", () => {
    const v = etaView(eta({ distanceM: null }));
    assert.ok(v);
    assert.equal(v.line, `8${NBSP}min`);
  });

  it("aproximada añade la marca; con la planificación como fuente cambia la etiqueta", () => {
    const approx = etaView(eta({ approximate: true }));
    assert.ok(approx);
    assert.equal(approx.line, `8${NBSP}min · 2,4${NBSP}km · aprox.`);
    const scheduled = etaView(eta({ source: "schedule", approximate: true }));
    assert.ok(scheduled);
    assert.equal(scheduled.label, "Hora prevista");
    assert.equal(scheduled.line, "Según la planificación del viaje");
    assert.equal(etaView(null), null);
  });

  it("remainingLine: Faltan 15 min · 6,8 km / solo minutos / nada", () => {
    assert.equal(remainingLine({ minutes: 15, distanceM: 6800 }), `Faltan 15${NBSP}min · 6,8${NBSP}km`);
    assert.equal(remainingLine({ minutes: 15, distanceM: null }), `Faltan 15${NBSP}min`);
    assert.equal(remainingLine(null), null);
  });
});

describe("mapa", () => {
  const base = {
    driverName: "Ana",
    pickup: { label: "C. Luis Montoto", location: { lat: 37.3849, lng: -5.9738 } },
    etaMinutes: 8,
  };

  it("posición precisa y reciente: coche, recogida y línea de aproximación discontinua", () => {
    const model = liveMapModel({ ...base, position: position(), signalKind: "live", ageSeconds: 5 });
    assert.equal(model.car, "precise");
    assert.deepEqual(model.markers.map((m) => m.kind).sort(), ["car", "destination"]);
    const car = model.markers.find((m) => m.kind === "car");
    assert.equal(car?.chip?.subtitle, `llega en 8${NBSP}min`);
    assert.deepEqual(model.routes.map((r) => r.kind), ["approach"]);
    assert.equal(model.fit.length, 2);
  });

  it("señal vieja: el coche lleva su antigüedad y NUNCA «llega en»", () => {
    const model = liveMapModel({ ...base, position: position({ ageSeconds: 120, stale: true }), signalKind: "stale", ageSeconds: 120 });
    assert.equal(model.car, "stale");
    const car = model.markers.find((m) => m.kind === "car");
    assert.equal(car?.chip?.subtitle, `hace 2${NBSP}min`);
    assert.equal(car?.chip?.tone, "warning");
  });

  it("posición aproximada: ZONA, sin coche y sin línea de aproximación", () => {
    const zonePosition = position({ precision: "approximate", accuracyM: 1000, headingDegrees: null, speedMps: null });
    const model = liveMapModel({ ...base, position: zonePosition, signalKind: "approximate", ageSeconds: 5 });
    assert.equal(model.car, "zone");
    assert.equal(model.markers.some((m) => m.kind === "car"), false);
    assert.equal(model.routes.some((r) => r.kind === "approach"), false);
    const ring = model.routes.find((r) => r.id === "zone");
    assert.ok(ring);
    assert.equal(ring.points.length, 49);
    assert.deepEqual(ring.points[0], ring.points[ring.points.length - 1]);
    assert.ok(model.fit.length >= 5);
  });

  it("sin posición solo se dibuja la recogida", () => {
    const model = liveMapModel({ ...base, position: null, signalKind: "none", ageSeconds: null });
    assert.equal(model.car, "none");
    assert.equal(model.markers.length, 1);
    assert.equal(model.routes.length, 0);
    assert.equal(carDrawMode(null, "none"), "none");
  });

  it("el anillo mide el radio pedido y los extremos lo encuadran", () => {
    const center = { lat: 37.39, lng: -5.98 };
    const ring = ringPoints(center, 1000, 32);
    const north = ring.reduce((max, p) => Math.max(max, p.lat), -90);
    assert.ok(Math.abs((north - center.lat) * 111_320 - 1000) < 5);
    const [n, s, e, w] = ringExtremes(center, 1000);
    assert.ok(n && s && e && w);
    assert.ok(n.lat > center.lat && s.lat < center.lat && e.lng > center.lng && w.lng < center.lng);
  });
});
