import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  BERMEJALES,
  CARTUJA,
  type StaffWorld,
  auditCount,
  buildTrustApp,
  call,
  createPool,
  hasTable,
  lastAudit,
  resetDatabase,
  seedBooking,
  seedIncident,
  seedLivePosition,
  seedProvince,
  seedRefund,
  seedStaffWorld,
  seedTrip,
  seedUser,
  seedVehicle
} from "./trust-helpers.js";

/**
 * Pantalla 37 (resumen: KPIs con comparación de periodo, finanzas «por definir», actividad de vehículos) y pantalla 39 (reservas).
 * Reloj fijo = 2026-10-09T13:41:00Z (en Madrid, CEST, UTC+2: 15:41), el mismo instante que los ejemplos del contrato.
 * Las pruebas que dependen de tablas de otros módulos (incident_reports, refund_requests) se omiten si la base no las tiene
 * (`mvc_trust` solo lleva 001–012 + 080–099; `mvc_trust_full` lleva todo).
 */

const NOW = new Date("2026-10-09T13:41:00.000Z");
const at = (iso: string) => new Date(iso);

const pool = createPool();
let app: FastifyInstance;
let world: StaffWorld;
let sevilla: string;
let cadiz: string;
let vehicleId: string;
let hasIncidents = false;
let hasRefunds = false;

before(async () => {
  await pool.query("select 1 from trust_operations_settings limit 1");
  hasIncidents = await hasTable(pool, "incident_reports");
  hasRefunds = await hasTable(pool, "refund_requests");
});
beforeEach(async () => {
  await resetDatabase(pool);
  app = (await buildTrustApp(pool, { now: () => NOW })).app;
  world = await seedStaffWorld(pool);
  sevilla = await seedProvince(pool, "41", "Sevilla");
  cadiz = await seedProvince(pool, "11", "Cádiz");
  vehicleId = await seedVehicle(pool, world.driver.id);
});
after(async () => {
  await app?.close();
  await pool.end();
});

const summary = (query: Record<string, string> = {}, as = world.admin) => call(app, "GET", "/v1/admin/summary", { as, query });

/* ───────────────────────────── Resumen (pantalla 37) ───────────────────────────── */

test("resumen: base vacía → ceros reales, ventana de Madrid del contrato, finanzas «por definir» e incidencias según exista la fuente", async () => {
  const res = await summary();
  assert.equal(res.status, 200);
  assert.equal(res.headers["cache-control"], "no-store");
  const b = res.body;
  assert.equal(b.generatedAt, "2026-10-09T13:41:00.000Z");
  assert.deepEqual(b.window, {
    period: "today",
    timeZone: "Europe/Madrid",
    from: "2026-10-08T22:00:00.000Z",
    to: "2026-10-09T13:41:00.000Z",
    previousFrom: "2026-10-07T22:00:00.000Z",
    previousTo: "2026-10-08T13:41:00.000Z"
  });
  assert.equal(b.province, null);
  assert.deepEqual(
    { value: b.kpis.activeTrips.value, previous: b.kpis.activeTrips.previous, delta: b.kpis.activeTrips.deltaPercent, trend: b.kpis.activeTrips.trend, available: b.kpis.activeTrips.available },
    { value: 0, previous: 0, delta: null, trend: "flat", available: true }
  );
  assert.equal(b.kpis.requests.value, 0);
  assert.match(b.kpis.activeTrips.definition, /Viajes publicados, en curso o completados/);
  assert.equal(b.liveNow.tripsInProgress, 0);
  if (hasIncidents) {
    assert.deepEqual([b.kpis.incidents.value, b.kpis.incidents.available, b.kpis.incidents.trend], [0, true, "flat"]);
  } else {
    assert.deepEqual(
      { value: b.kpis.incidents.value, previous: b.kpis.incidents.previous, delta: b.kpis.incidents.deltaPercent, trend: b.kpis.incidents.trend, available: b.kpis.incidents.available },
      { value: null, previous: null, delta: null, trend: "unavailable", available: false },
      "sin la fuente de incidencias no se inventa un 0"
    );
    assert.ok(b.notes.some((n: string) => /Incidencias/.test(n)));
  }
  // Finanzas: nada se inventa
  assert.equal(b.finance.economicsActivated, false);
  const pending = { cents: null, currency: "EUR", status: "pending_definition" };
  assert.deepEqual(b.finance.grossRevenue.amount, pending);
  assert.equal(b.finance.grossRevenue.source, "none");
  assert.match(b.finance.grossRevenue.note, /Economía no activada/);
  assert.deepEqual(b.finance.operatingCosts.amount, pending);
  assert.deepEqual(b.finance.result.amount, pending);
  assert.doesNotMatch(res.raw, /illustrative/, "el backend nunca emite importes ilustrativos en el resumen");
  const audit = await lastAudit(pool, "admin.summary.viewed");
  assert.equal(audit?.actor_user_id, world.admin.id);
  assert.deepEqual(audit?.metadata, { period: "today", provinceId: null, financeIncluded: true });
});

test("resumen: viajes y solicitudes comparados con el periodo anterior; solo cuentan los estados del contrato; filtro de provincia", async () => {
  const trip = (departure: string, status: "draft" | "published" | "active" | "completed" | "cancelled", provinceId = sevilla) =>
    seedTrip(pool, world.driver.id, vehicleId, provinceId, { status, departureAt: at(departure) });
  // Hoy (2026-10-08T22:00Z → 13:41Z): 3 válidos + 1 borrador + 1 cancelado + 1 futuro (no ha salido) → cuentan 3
  const activeTrip = await trip("2026-10-09T06:00:00Z", "active");
  await trip("2026-10-09T08:00:00Z", "completed");
  await trip("2026-10-09T12:00:00Z", "published");
  await trip("2026-10-09T07:00:00Z", "draft");
  await trip("2026-10-09T07:30:00Z", "cancelled");
  await trip("2026-10-09T18:00:00Z", "published");
  // Periodo anterior (2026-10-07T22:00Z → 2026-10-08T13:41Z): 2 válidos; uno justo fuera de la ventana
  await trip("2026-10-08T07:00:00Z", "completed");
  await trip("2026-10-08T12:00:00Z", "completed");
  await trip("2026-10-08T15:00:00Z", "completed"); // ni hoy ni periodo anterior comparable
  // Otra provincia: hoy 1
  await trip("2026-10-09T09:00:00Z", "published", cadiz);

  const all = (await summary()).body;
  assert.deepEqual(
    { v: all.kpis.activeTrips.value, p: all.kpis.activeTrips.previous, d: all.kpis.activeTrips.deltaPercent, t: all.kpis.activeTrips.trend },
    { v: 4, p: 2, d: 100, t: "up" }
  );
  assert.equal(all.liveNow.tripsInProgress, 1);
  const seville = (await summary({ provinceId: sevilla })).body;
  assert.deepEqual(
    { v: seville.kpis.activeTrips.value, p: seville.kpis.activeTrips.previous, d: seville.kpis.activeTrips.deltaPercent, t: seville.kpis.activeTrips.trend },
    { v: 3, p: 2, d: 50, t: "up" }
  );
  assert.deepEqual(seville.province, { id: sevilla, code: "41", name: "Sevilla" });
  const cadizBody = (await summary({ provinceId: cadiz })).body;
  assert.deepEqual(
    { v: cadizBody.kpis.activeTrips.value, p: cadizBody.kpis.activeTrips.previous, d: cadizBody.kpis.activeTrips.deltaPercent, t: cadizBody.kpis.activeTrips.trend },
    { v: 1, p: 0, d: null, t: "new" }
  );
  assert.equal(cadizBody.liveNow.tripsInProgress, 0);
  assert.equal((await summary({ provinceId: sevilla })).body.liveNow.tripsInProgress, 1);
  void activeTrip;

  // Solicitudes: 2 hoy, 4 en el periodo anterior (−50 %)
  const tripId = await trip("2026-10-09T10:00:00Z", "published");
  for (const when of ["2026-10-09T08:00:00Z", "2026-10-09T10:30:00Z"]) {
    await seedBooking(pool, { tripId, passengerId: world.rider.id, requestedAt: at(when), updatedAt: at(when) });
  }
  for (const when of ["2026-10-08T06:00:00Z", "2026-10-08T07:00:00Z", "2026-10-08T08:00:00Z", "2026-10-08T09:00:00Z"]) {
    await seedBooking(pool, { tripId, passengerId: world.rider.id, requestedAt: at(when), updatedAt: at(when) });
  }
  const requests = (await summary({ provinceId: sevilla })).body.kpis.requests;
  assert.deepEqual({ v: requests.value, p: requests.previous, d: requests.deltaPercent, t: requests.trend }, { v: 2, p: 4, d: -50, t: "down" });
  const other = (await summary({ provinceId: cadiz })).body.kpis.requests;
  assert.deepEqual([other.value, other.previous, other.trend], [0, 0, "flat"]);
});

test("resumen: periodos del contrato (hoy, ayer, 7 y 30 días, este mes) con la ventana de comparación de la misma duración", async () => {
  const windows: Record<string, { from: string; to: string; previousFrom: string; previousTo: string }> = {
    today: { from: "2026-10-08T22:00:00.000Z", to: "2026-10-09T13:41:00.000Z", previousFrom: "2026-10-07T22:00:00.000Z", previousTo: "2026-10-08T13:41:00.000Z" },
    yesterday: { from: "2026-10-07T22:00:00.000Z", to: "2026-10-08T22:00:00.000Z", previousFrom: "2026-10-06T22:00:00.000Z", previousTo: "2026-10-07T22:00:00.000Z" },
    last_7_days: { from: "2026-10-02T13:41:00.000Z", to: "2026-10-09T13:41:00.000Z", previousFrom: "2026-09-25T13:41:00.000Z", previousTo: "2026-10-02T13:41:00.000Z" },
    last_30_days: { from: "2026-09-09T13:41:00.000Z", to: "2026-10-09T13:41:00.000Z", previousFrom: "2026-08-10T13:41:00.000Z", previousTo: "2026-09-09T13:41:00.000Z" },
    // mes en curso (1 oct 00:00 Madrid) frente a los mismos 8 d 15 h 41 min transcurridos del mes anterior (1 sep 00:00 Madrid)
    this_month: { from: "2026-09-30T22:00:00.000Z", to: "2026-10-09T13:41:00.000Z", previousFrom: "2026-08-31T22:00:00.000Z", previousTo: "2026-09-09T13:41:00.000Z" }
  };
  for (const [period, expected] of Object.entries(windows)) {
    const res = await summary({ period });
    assert.equal(res.status, 200, period);
    assert.deepEqual({ ...res.body.window, period: undefined, timeZone: undefined }, { ...expected, period: undefined, timeZone: undefined }, period);
    assert.equal(res.body.window.period, period);
  }
  // este mes: el periodo anterior no sobrepasa el comienzo del mes actual
  const month = (await summary({ period: "this_month" })).body.window;
  assert.ok(new Date(month.previousTo) <= new Date(month.from));
});

test("resumen: provincia inexistente → 404 PROVINCE_NOT_FOUND; identificador inválido o periodo desconocido → 400", async () => {
  const unknown = await summary({ provinceId: crypto.randomUUID() });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, "PROVINCE_NOT_FOUND");
  assert.equal((await summary({ provinceId: "no-es-uuid" })).status, 400);
  assert.equal((await summary({ period: "siempre" })).status, 400);
  assert.equal(await auditCount(pool, "admin.summary.viewed"), 0, "las lecturas fallidas no se auditan como realizadas");
});

test("resumen: finanzas solo para admin y finanzas; soporte recibe finance:null; el importe sigue «por definir» aunque haya reservas", async () => {
  const tripId = await seedTrip(pool, world.driver.id, vehicleId, sevilla, { status: "published", departureAt: at("2026-10-09T10:00:00Z") });
  await seedBooking(pool, { tripId, passengerId: world.rider.id, status: "confirmed", amountCents: 1500, requestedAt: at("2026-10-09T09:00:00Z"), updatedAt: at("2026-10-09T09:00:00Z") });
  await seedBooking(pool, { tripId, passengerId: world.rider.id, status: "completed", amountCents: 800, requestedAt: at("2026-10-09T09:30:00Z"), updatedAt: at("2026-10-09T09:30:00Z") });

  const asAdmin = (await summary({}, world.admin)).body;
  const asFinance = (await summary({}, world.finance)).body;
  for (const body of [asAdmin, asFinance]) {
    assert.ok(body.finance);
    assert.equal(body.finance.economicsActivated, false);
    assert.equal(body.finance.grossRevenue.amount.status, "pending_definition");
    assert.equal(body.finance.grossRevenue.amount.cents, null, "sin tarifa aprobada no hay ingresos que calcular (ni siquiera la suma de lo cobrado)");
  }
  const asSupport = await summary({}, world.support);
  assert.equal(asSupport.status, 200);
  assert.equal(asSupport.body.finance, null);
  assert.doesNotMatch(asSupport.raw, /grossRevenue|operatingCosts/);
  assert.equal((await lastAudit(pool, "admin.summary.viewed"))?.metadata.financeIncluded, false);
  // el resto de KPIs sí los ve soporte
  assert.equal(asSupport.body.kpis.requests.value, 2);
  for (const who of [world.verification, world.rider, world.driver]) assert.equal((await summary({}, who)).status, 403);
});

test("resumen: los ingresos solo se calculan con una tarifa APROBADA en vigor (suma de comisiones de reservas confirmadas o completadas)", async () => {
  const tripId = await seedTrip(pool, world.driver.id, vehicleId, sevilla, { status: "published", departureAt: at("2026-10-09T10:00:00Z") });
  const confirmed = await seedBooking(pool, { tripId, passengerId: world.rider.id, status: "confirmed", requestedAt: at("2026-10-09T09:00:00Z"), updatedAt: at("2026-10-09T09:00:00Z") });
  const cancelled = await seedBooking(pool, { tripId, passengerId: world.rider.id, status: "cancelled", requestedAt: at("2026-10-09T09:10:00Z"), updatedAt: at("2026-10-09T09:10:00Z") });
  const tariff = (
    await pool.query<{ id: string }>(
      `insert into tariff_versions(version, status, rate_micros_per_km, passenger_commission_bps, driver_commission_bps, effective_from)
       values(1,'approved',180000,1000,1000,'2026-01-01T00:00:00Z') returning id`
    )
  ).rows[0]!.id;
  for (const [requestId, p, d] of [[confirmed.requestId, 32, 32], [cancelled.requestId, 99, 99]] as const) {
    await pool.query(
      `insert into quote_snapshots(request_id, tariff_version_id, road_distance_m, contribution_cents, passenger_commission_cents, driver_commission_cents, passenger_total_cents, driver_net_cents)
       values($1,$2,18000,324,$3,$4,356,292)`,
      [requestId, tariff, p, d]
    );
  }
  const finance = (await summary({}, world.finance)).body.finance;
  assert.equal(finance.economicsActivated, true);
  assert.deepEqual(finance.grossRevenue.amount, { cents: 64, currency: "EUR", status: "defined" }, "solo la reserva confirmada: 32 + 32; la cancelada no suma");
  assert.equal(finance.grossRevenue.source, "commissions_of_confirmed_bookings");
  assert.equal(finance.operatingCosts.amount.status, "pending_definition", "no existe fuente de costes operativos");
  assert.equal(finance.result.amount.status, "pending_definition", "el resultado necesita ingresos Y costes");
  // una tarifa aprobada con entrada en vigor futura no cuenta
  await pool.query(`update tariff_versions set effective_from = '2027-01-01T00:00:00Z' where id = $1`, [tariff]);
  assert.equal((await summary({}, world.finance)).body.finance.economicsActivated, false);
});

test("resumen: incidencias reales del módulo live cuando existe la tabla (con comparación y filtro de provincia)", async (t) => {
  if (!hasIncidents) return t.skip("la base no tiene incident_reports (módulo live no migrado)");
  const seville = await seedTrip(pool, world.driver.id, vehicleId, sevilla, { status: "completed", departureAt: at("2026-10-09T05:00:00Z") });
  const cadizTrip = await seedTrip(pool, world.driver.id, vehicleId, cadiz, { status: "completed", departureAt: at("2026-10-09T05:00:00Z") });
  for (const when of ["2026-10-09T06:00:00Z", "2026-10-09T07:00:00Z"]) await seedIncident(pool, { tripId: seville, reporterId: world.rider.id, createdAt: at(when) });
  await seedIncident(pool, { tripId: seville, reporterId: world.rider.id, createdAt: at("2026-10-08T07:00:00Z") });
  await seedIncident(pool, { tripId: cadizTrip, reporterId: world.rider.id, createdAt: at("2026-10-09T08:00:00Z") });

  const all = (await summary()).body.kpis.incidents;
  assert.deepEqual({ v: all.value, p: all.previous, a: all.available }, { v: 3, p: 1, a: true });
  assert.equal(all.deltaPercent, 200);
  assert.equal(all.trend, "up");
  const bySevilla = (await summary({ provinceId: sevilla })).body.kpis.incidents;
  assert.deepEqual([bySevilla.value, bySevilla.previous, bySevilla.deltaPercent], [2, 1, 100]);
});

/* ───────────────────────────── Actividad de vehículos ───────────────────────────── */

test("actividad de vehículos: celdas aproximadas de ~2 km, solo viajes en curso con posición reciente, sin identidades ni posiciones precisas", async () => {
  const activeA = await seedTrip(pool, world.driver.id, vehicleId, sevilla, { status: "active", departureAt: at("2026-10-09T12:00:00Z") });
  const activeB = await seedTrip(pool, world.driver.id, vehicleId, sevilla, { status: "active", departureAt: at("2026-10-09T12:05:00Z") });
  const activeC = await seedTrip(pool, world.driver.id, vehicleId, sevilla, { status: "active", departureAt: at("2026-10-09T12:10:00Z") });
  const stale = await seedTrip(pool, world.driver.id, vehicleId, sevilla, { status: "active", departureAt: at("2026-10-09T11:00:00Z") });
  const finished = await seedTrip(pool, world.driver.id, vehicleId, sevilla, { status: "completed", departureAt: at("2026-10-09T10:00:00Z") });
  const inCadiz = await seedTrip(pool, world.driver.id, vehicleId, cadiz, { status: "active", departureAt: at("2026-10-09T12:15:00Z") });
  const fresh = at("2026-10-09T13:39:00Z"); // hace 2 minutos
  await seedLivePosition(pool, { tripId: activeA, driverId: world.driver.id, lat: 37.3898, lng: -5.9845, receivedAt: fresh });
  await seedLivePosition(pool, { tripId: activeB, driverId: world.driver.id, lat: 37.3902, lng: -5.984, receivedAt: fresh });
  await seedLivePosition(pool, { tripId: activeC, driverId: world.driver.id, lat: 37.3398, lng: -5.9879, receivedAt: fresh });
  await seedLivePosition(pool, { tripId: stale, driverId: world.driver.id, lat: 37.4094, lng: -6.0049, receivedAt: at("2026-10-09T13:20:00Z") }); // hace 21 min
  await seedLivePosition(pool, { tripId: finished, driverId: world.driver.id, lat: 37.4094, lng: -6.0049, receivedAt: fresh });
  await seedLivePosition(pool, { tripId: inCadiz, driverId: world.driver.id, lat: 36.5271, lng: -6.2886, receivedAt: fresh });

  const res = await call(app, "GET", "/v1/admin/summary/vehicle-activity", { as: world.support, query: { provinceId: sevilla } });
  assert.equal(res.status, 200);
  const b = res.body;
  assert.equal(b.label, "Actividad de vehículos (aproximada)");
  assert.equal(b.precision, "approximate");
  assert.equal(b.gridDegrees, 0.02);
  assert.equal(b.freshnessSeconds, 600);
  assert.equal(b.generatedAt, "2026-10-09T13:41:00.000Z");
  assert.deepEqual(b.province, { id: sevilla, code: "41", name: "Sevilla" });
  assert.equal(b.totalVehicles, 3, "dos en la misma celda + uno en otra; ni la posición antigua, ni el viaje terminado, ni Cádiz");
  assert.equal(b.items.length, 2);
  assert.deepEqual(b.items.map((i: any) => [i.kind, i.count, i.lat, i.lng, i.precisionMeters]), [
    ["cluster", 2, 37.39, -5.99, 2200],
    ["vehicle", 1, 37.33, -5.99, 2200]
  ]);
  for (const item of b.items) {
    assert.deepEqual(Object.keys(item).sort(), ["count", "id", "kind", "lat", "lng", "precisionMeters"]);
    assert.match(item.id, /^-?\d+\.\d{2}:-?\d+\.\d{2}$/);
  }
  // nada que identifique a nadie ni posiciones exactas
  for (const secret of [world.driver.id, activeA, activeB, activeC, "37.3898", "37.3902", "-5.9845", "-5.984", "37.3398", "-5.9879", "37.4094"]) {
    assert.ok(!res.raw.includes(secret), `la respuesta no debe contener ${secret}`);
  }
  assert.equal((await lastAudit(pool, "admin.vehicle_activity.viewed"))?.metadata.totalVehicles, 3);

  const everywhere = await call(app, "GET", "/v1/admin/summary/vehicle-activity", { as: world.admin });
  assert.equal(everywhere.body.totalVehicles, 4);
  assert.equal(everywhere.body.province, null);
  const onlyCadiz = await call(app, "GET", "/v1/admin/summary/vehicle-activity", { as: world.admin, query: { provinceId: cadiz } });
  assert.equal(onlyCadiz.body.totalVehicles, 1);
  assert.equal((await call(app, "GET", "/v1/admin/summary/vehicle-activity", { as: world.admin, query: { provinceId: crypto.randomUUID() } })).status, 404);
});

test("actividad de vehículos: la frescura es configurable y sin viajes en curso devuelve una lista vacía (sin inventar actividad)", async () => {
  const empty = await call(app, "GET", "/v1/admin/summary/vehicle-activity", { as: world.admin });
  assert.deepEqual([empty.status, empty.body.totalVehicles, empty.body.items], [200, 0, []]);
  const trip = await seedTrip(pool, world.driver.id, vehicleId, sevilla, { status: "active", departureAt: at("2026-10-09T12:00:00Z") });
  await seedLivePosition(pool, { tripId: trip, driverId: world.driver.id, lat: BERMEJALES.lat, lng: BERMEJALES.lng, receivedAt: at("2026-10-09T13:30:00Z") }); // hace 11 min
  assert.equal((await call(app, "GET", "/v1/admin/summary/vehicle-activity", { as: world.admin })).body.totalVehicles, 0);
  const lenient = await buildTrustApp(pool, { now: () => NOW, trustConfig: { vehicleActivityFreshnessSeconds: 1200 } });
  try {
    const res = await call(lenient.app, "GET", "/v1/admin/summary/vehicle-activity", { as: world.admin });
    assert.equal(res.body.totalVehicles, 1);
    assert.equal(res.body.freshnessSeconds, 1200);
  } finally {
    await lenient.app.close();
  }
});

/* ───────────────────────────── Reservas y devoluciones (pantalla 39) ───────────────────────────── */

type Seeded = Awaited<ReturnType<typeof seedWorldOfBookings>>;

async function seedWorldOfBookings() {
  const tripA = await seedTrip(pool, world.driver.id, vehicleId, sevilla, { status: "published", departureAt: at("2026-10-10T06:12:00Z"), origin: BERMEJALES, destination: CARTUJA });
  const tripCadiz = await seedTrip(pool, world.driver.id, vehicleId, cadiz, { status: "published", departureAt: at("2026-10-10T07:00:00Z") });
  const mk = (tripId: string, status: "confirmed" | "completed" | "cancelled" | "driver_cancelled", amountCents: number, when: string) =>
    seedBooking(pool, { tripId, passengerId: world.rider.id, status, amountCents, requestedAt: at(when), updatedAt: at(when) });
  return {
    tripA,
    tripCadiz,
    b1: await mk(tripA, "confirmed", 500, "2026-10-08T10:00:00Z"),
    b2: await mk(tripA, "cancelled", 500, "2026-10-07T09:00:00Z"),
    b3: await mk(tripA, "driver_cancelled", 700, "2026-10-06T09:00:00Z"),
    b4: await mk(tripA, "completed", 400, "2026-09-20T09:00:00Z"),
    b5: await mk(tripA, "confirmed", 450, "2026-08-01T00:00:00Z"), // fuera de los últimos 30 días
    b6: await mk(tripCadiz, "cancelled", 600, "2026-10-08T12:00:00Z")
  };
}
const bookings = (query: Record<string, string | number> = {}, as = world.finance) => call(app, "GET", "/v1/admin/bookings", { as, query });
const bookingIds = (res: { body: any }) => res.body.items.map((i: any) => i.bookingId);

test("reservas: listado por periodo (sobre updated_at), orden, recuentos, importes reales y campos «por definir»", async () => {
  const s: Seeded = await seedWorldOfBookings();
  const res = await bookings();
  assert.equal(res.status, 200);
  assert.deepEqual(bookingIds(res), [s.b6.bookingId, s.b1.bookingId, s.b2.bookingId, s.b3.bookingId, s.b4.bookingId]);
  assert.equal(res.body.nextCursor, null);
  assert.deepEqual(res.body.counts, { all: 5, cancelled: 3, refunded: hasRefunds ? 0 : null });

  const cancelled = res.body.items.find((i: any) => i.bookingId === s.b2.bookingId);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.statusLabel, "Cancelada");
  assert.equal(cancelled.cancelledBy, "passenger");
  assert.equal(cancelled.cancelledAt, "2026-10-07T09:00:00.000Z");
  assert.equal(cancelled.tripId, s.tripA);
  assert.equal(cancelled.tripDepartureAt, "2026-10-10T06:12:00.000Z");
  assert.deepEqual(cancelled.route, { originLabel: "Sevilla - Los Bermejales", destinationLabel: "Sevilla - Cartuja (Universidad)" });
  assert.deepEqual(cancelled.passenger, { id: world.rider.id, displayName: "Miguel Torres", firstName: "Miguel", photoUrl: null });
  assert.deepEqual(cancelled.driver, { id: world.driver.id, displayName: "Ana López", firstName: "Ana", photoUrl: null });
  const pending = { cents: null, currency: "EUR", status: "pending_definition" };
  assert.deepEqual(cancelled.money, {
    amountPaid: { cents: 500, currency: "EUR", status: "defined" },
    proposedRefund: pending,
    platformCommission: pending,
    finalPassengerCost: pending
  });
  assert.deepEqual(cancelled.refund, { status: "pending_definition", actionOwner: "money" });
  const driverCancelled = res.body.items.find((i: any) => i.bookingId === s.b3.bookingId);
  assert.equal(driverCancelled.cancelledBy, "driver");
  assert.equal(driverCancelled.statusLabel, "Cancelada por el conductor");
  assert.equal(driverCancelled.money.amountPaid.cents, 700);
  const confirmed = res.body.items.find((i: any) => i.bookingId === s.b1.bookingId);
  assert.deepEqual([confirmed.cancelledBy, confirmed.cancelledAt, confirmed.refund.status], [null, null, "not_applicable"]);
  assert.equal(confirmed.statusLabel, "Confirmada");
  assert.doesNotMatch(res.raw, /\+34|@|illustrative/, "ni teléfonos, ni correos, ni importes ilustrativos");
  assert.equal((await lastAudit(pool, "admin.bookings.listed"))?.metadata.returned, 5);
});

test("reservas: filtros de provincia, periodo y estado; paginación por cursor; roles con acceso", async () => {
  const s: Seeded = await seedWorldOfBookings();
  assert.deepEqual(bookingIds(await bookings({ provinceId: sevilla })), [s.b1.bookingId, s.b2.bookingId, s.b3.bookingId, s.b4.bookingId]);
  assert.deepEqual((await bookings({ provinceId: cadiz })).body.counts, { all: 1, cancelled: 1, refunded: hasRefunds ? 0 : null });
  assert.deepEqual(bookingIds(await bookings({ period: "yesterday" })), [s.b6.bookingId, s.b1.bookingId]);
  assert.deepEqual(bookingIds(await bookings({ period: "last_7_days" })), [s.b6.bookingId, s.b1.bookingId, s.b2.bookingId, s.b3.bookingId]);
  assert.deepEqual(bookingIds(await bookings({ period: "this_month" })), [s.b6.bookingId, s.b1.bookingId, s.b2.bookingId, s.b3.bookingId]);
  assert.deepEqual(bookingIds(await bookings({ status: "cancelled" })), [s.b6.bookingId, s.b2.bookingId, s.b3.bookingId]);
  const refunded = await bookings({ status: "refunded" });
  assert.deepEqual(bookingIds(refunded), [], "sin devoluciones efectuadas no hay reservas «devueltas»");
  assert.deepEqual((await bookings({ status: "cancelled", period: "yesterday" })).body.counts, { all: 2, cancelled: 1, refunded: hasRefunds ? 0 : null }, "los recuentos no dependen del filtro de estado");

  // cursor
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page: any = await bookings({ limit: 2, ...(cursor ? { cursor } : {}) });
    assert.ok(page.body.items.length <= 2);
    seen.push(...bookingIds(page));
    cursor = page.body.nextCursor;
    pages += 1;
  } while (cursor && pages < 6);
  assert.deepEqual(seen, [s.b6.bookingId, s.b1.bookingId, s.b2.bookingId, s.b3.bookingId, s.b4.bookingId]);
  assert.equal(pages, 3);

  assert.equal((await bookings({ cursor: "basura" })).body.error.code, "CURSOR_INVALID");
  assert.equal((await bookings({ provinceId: crypto.randomUUID() })).body.error.code, "PROVINCE_NOT_FOUND");
  for (const bad of [{ period: "siempre" }, { status: "pagadas" }, { limit: 0 }, { limit: 51 }, { provinceId: "x" }]) {
    assert.equal((await bookings(bad)).status, 400, JSON.stringify(bad));
  }
  for (const who of [world.admin, world.finance, world.support]) assert.equal((await bookings({}, who)).status, 200);
  for (const who of [world.verification, world.rider, world.driver]) assert.equal((await bookings({}, who)).status, 403);
});

test("reservas: foto pública solo si está aprobada (ruta, nunca la clave de almacenamiento)", async () => {
  const s: Seeded = await seedWorldOfBookings();
  await pool.query(`update profiles set public_photo_key = 'users/secreto/trust/profile_photo/x.jpg', public_photo_status = 'approved' where user_id = $1`, [world.driver.id]);
  await pool.query(`update profiles set public_photo_key = 'users/otro/trust/profile_photo/y.jpg', public_photo_status = 'pending' where user_id = $1`, [world.rider.id]);
  const res = await bookings({ provinceId: sevilla });
  const item = res.body.items.find((i: any) => i.bookingId === s.b1.bookingId);
  assert.match(item.driver.photoUrl, new RegExp(`^/v1/public/users/${world.driver.id}/photo\\?v=[0-9a-f]{8}$`));
  assert.equal(item.passenger.photoUrl, null);
  assert.doesNotMatch(res.raw, /secreto|users\/otro|storage/);
});

test("reservas: con las devoluciones de money (si la tabla existe) se leen propuestas y devueltas; sin ellas todo es «por definir»", async (t) => {
  if (!hasRefunds) return t.skip("la base no tiene refund_requests (módulo money no migrado)");
  const s: Seeded = await seedWorldOfBookings();
  // b2: devuelta (pagó 500, devolución aprobada 400, comisión retenida 50)
  await seedRefund(pool, {
    requestId: s.b2.requestId, bookingId: s.b2.bookingId, tripId: s.tripA, passengerId: world.rider.id, driverId: world.driver.id,
    status: "refunded", paidCents: 500, proposedCents: 400, approvedCents: 400, retainedCommissionCents: 50, cancelledAt: at("2026-10-07T08:55:00Z")
  });
  // b3: propuesta pendiente de revisión con importe
  await seedRefund(pool, {
    requestId: s.b3.requestId, bookingId: s.b3.bookingId, tripId: s.tripA, passengerId: world.rider.id, driverId: world.driver.id,
    status: "pending_review", paidCents: 700, proposedCents: 700, retainedCommissionCents: 0, cancelledAt: at("2026-10-06T08:55:00Z")
  });
  // b6: sin importe propuesto (política sin definir)
  await seedRefund(pool, {
    requestId: s.b6.requestId, bookingId: s.b6.bookingId, tripId: s.tripCadiz, passengerId: world.rider.id, driverId: world.driver.id,
    status: "pending_review", paidCents: 600, proposedCents: null, cancelledAt: at("2026-10-08T11:55:00Z")
  });
  const res = await bookings();
  assert.deepEqual(res.body.counts, { all: 5, cancelled: 3, refunded: 1 });
  const byId = (id: string) => res.body.items.find((i: any) => i.bookingId === id);
  assert.deepEqual(byId(s.b2.bookingId).refund, { status: "refunded", actionOwner: "money" });
  assert.deepEqual(byId(s.b2.bookingId).money, {
    amountPaid: { cents: 500, currency: "EUR", status: "defined" },
    proposedRefund: { cents: 400, currency: "EUR", status: "defined" },
    platformCommission: { cents: 50, currency: "EUR", status: "defined" },
    finalPassengerCost: { cents: 100, currency: "EUR", status: "defined" }
  });
  assert.equal(byId(s.b2.bookingId).cancelledAt, "2026-10-07T08:55:00.000Z", "usa la fecha de cancelación registrada por money");
  assert.deepEqual(byId(s.b3.bookingId).refund.status, "proposed");
  assert.equal(byId(s.b3.bookingId).money.proposedRefund.cents, 700);
  assert.equal(byId(s.b3.bookingId).money.finalPassengerCost.cents, 0);
  assert.equal(byId(s.b6.bookingId).refund.status, "pending_definition");
  assert.equal(byId(s.b6.bookingId).money.proposedRefund.status, "pending_definition");
  assert.deepEqual(bookingIds(await bookings({ status: "refunded" })), [s.b2.bookingId]);
});
