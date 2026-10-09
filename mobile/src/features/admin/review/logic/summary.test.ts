// Pruebas de las baldosas del resumen y de la actividad de vehículos (admin-review).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminCountKpi, AdminMoneyKpi, AdminSummary, AdminVehicleCluster, Money } from "@/api/types";
import { activityInfoBody, activityMarkers, countKpiView, formatKpiMoney, freshnessMinutes, gridKm, moneyKpiView, summaryView, trendView } from "./summary";

function count(overrides: Partial<AdminCountKpi> = {}): AdminCountKpi {
  return { value: 42, previous: 37, deltaPercent: 12, trend: "up", available: true, definition: "Viajes con salida en el periodo", ...overrides };
}

function money(cents: number | null, status: Money["status"]): AdminMoneyKpi {
  return { amount: { cents, currency: "EUR", status }, source: status === "pending_definition" ? "none" : "commissions_of_confirmed_bookings", note: null };
}

describe("tendencias", () => {
  it("sube, baja, sin cambios y nuevo", () => {
    assert.deepEqual(trendView("activeTrips", "up", 12), { direction: "up", text: "+12%", tone: "positive" });
    assert.deepEqual(trendView("requests", "down", -8), { direction: "down", text: "−8%", tone: "negative" });
    assert.deepEqual(trendView("incidents", "flat", 0), { direction: "flat", text: "0%", tone: "neutral" });
    assert.deepEqual(trendView("requests", "new", null), { direction: "up", text: "Nuevo", tone: "neutral" });
    assert.equal(trendView("requests", "unavailable", null), null);
  });

  it("más incidencias es malo aunque la flecha suba", () => {
    assert.equal(trendView("incidents", "up", 50)?.tone, "negative");
    assert.equal(trendView("incidents", "down", -50)?.tone, "positive");
  });

  it("sin porcentaje no se inventa uno", () => {
    assert.equal(trendView("activeTrips", "up", null)?.text, "Sube");
    assert.equal(trendView("activeTrips", "down", null)?.text, "Baja");
  });
});

describe("indicadores de actividad", () => {
  it("reproducen la baldosa «42 · Viajes activos · +12%»", () => {
    const view = countKpiView("activeTrips", count());
    assert.equal(view.value, "42");
    assert.equal(view.label, "Viajes activos");
    assert.equal(view.trend?.text, "+12%");
    assert.equal(view.caption, null);
    assert.equal(view.icon, "car");
  });

  it("una fuente que aún no existe muestra «—», nunca un cero", () => {
    const view = countKpiView("incidents", count({ value: null, previous: null, deltaPercent: null, trend: "unavailable", available: false }));
    assert.equal(view.value, "—");
    assert.equal(view.trend, null);
    assert.equal(view.caption, "Sin datos todavía");
  });

  it("separa los millares con punto", () => {
    assert.equal(countKpiView("requests", count({ value: 1234 })).value, "1.234");
  });

  it("la etiqueta accesible cuenta la tendencia", () => {
    const view = countKpiView("requests", count({ value: 18, trend: "down", deltaPercent: -8 }));
    assert.equal(view.a11y, "Solicitudes: 18. baja −8%");
  });
});

describe("indicadores económicos", () => {
  it("sin tarifa aprobada todo es «Por definir»", () => {
    const view = moneyKpiView("grossRevenue", money(null, "pending_definition"));
    assert.equal(view.value, "Por definir");
    assert.equal(view.textual, true);
    assert.equal(view.caption, "Sin tarifa aprobada");
  });

  it("un importe de ejemplo se rotula «Datos ilustrativos»", () => {
    const view = moneyKpiView("grossRevenue", money(52000, "illustrative"));
    assert.equal(view.value, "520 €");
    assert.equal(view.caption, "Datos ilustrativos");
    assert.equal(view.textual, false);
  });

  it("un importe real lleva decimales solo si hacen falta", () => {
    assert.equal(formatKpiMoney(52000), "520 €");
    assert.equal(formatKpiMoney(52050), "520,50 €");
    assert.equal(formatKpiMoney(123456), "1.234,56 €");
    const view = moneyKpiView("result", { ...money(9000, "defined"), note: "Comisiones de reservas confirmadas" });
    assert.equal(view.value, "90 €");
    assert.equal(view.caption, "Comisiones de reservas confirmadas");
  });
});

describe("resumen completo", () => {
  const base: AdminSummary = {
    generatedAt: "2026-10-05T07:17:00.000Z",
    window: {
      period: "today",
      timeZone: "Europe/Madrid",
      from: "2026-10-04T22:00:00.000Z",
      to: "2026-10-05T07:17:00.000Z",
      previousFrom: "2026-10-03T22:00:00.000Z",
      previousTo: "2026-10-04T07:17:00.000Z",
    },
    province: { id: "p", code: "41", name: "Sevilla" },
    kpis: { activeTrips: count(), requests: count({ value: 18, trend: "down", deltaPercent: -8 }), incidents: count({ value: 3, trend: "flat", deltaPercent: 0 }) },
    liveNow: { tripsInProgress: 4 },
    finance: null,
    notes: [],
  };

  it("el rol sin finanzas no ve los tres importes y se le dice por qué", () => {
    const view = summaryView(base);
    assert.deepEqual(view.tiles.map((tile) => tile.key), ["activeTrips", "requests", "incidents"]);
    assert.equal(view.hasFinance, false);
    assert.equal(view.financeHidden, "Los indicadores económicos son solo para Finanzas y Administración.");
  });

  it("con finanzas salen seis baldosas en el orden de la lámina", () => {
    const view = summaryView({
      ...base,
      finance: { grossRevenue: money(52000, "illustrative"), operatingCosts: money(43000, "illustrative"), result: money(9000, "illustrative"), economicsActivated: false },
    });
    assert.deepEqual(view.tiles.map((tile) => tile.key), ["activeTrips", "requests", "incidents", "grossRevenue", "operatingCosts", "result"]);
    assert.deepEqual(view.tiles.map((tile) => tile.value), ["42", "18", "3", "520 €", "430 €", "90 €"]);
    assert.equal(view.financeHidden, null);
  });
});

describe("actividad de vehículos", () => {
  const items: AdminVehicleCluster[] = [
    { id: "c1", kind: "cluster", count: 12, lat: 37.39, lng: -5.97, precisionMeters: 2000 },
    { id: "v1", kind: "vehicle", count: 1, lat: 37.4, lng: -5.99, precisionMeters: 2000 },
    { id: "c2", kind: "cluster", count: 1, lat: 37.38, lng: -5.98, precisionMeters: 2000 },
  ];

  it("un grupo de varios es un disco con su número; uno solo es un coche", () => {
    const markers = activityMarkers(items);
    assert.equal(markers[0]?.kind, "cluster");
    assert.equal(markers[1]?.kind, "car");
    assert.equal(markers[2]?.kind, "car");
    const first = markers[0];
    if (first?.kind === "cluster") assert.equal(first.count, 12);
  });

  it("el texto de ayuda dice cuánto mide la celda y cuánto frescor exige", () => {
    assert.equal(gridKm(0.02), "2");
    assert.equal(gridKm(0.001), "1");
    assert.equal(freshnessMinutes(300), 5);
    assert.equal(freshnessMinutes(10), 1);
    assert.match(activityInfoBody({ gridDegrees: 0.02, freshnessSeconds: 300 }), /unos 2 km.*5 min/);
  });
});
