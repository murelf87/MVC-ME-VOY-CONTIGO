import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import {
  type SeededUser,
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
  seedProvince,
  seedRouteChangeProposal,
  seedStaffWorld,
  seedTrip,
  seedUser,
  seedVehicle
} from "./trust-helpers.js";

/**
 * Pantalla 40 (tarifas y operaciones): borradores, ejemplo de aportación, historial, la PUERTA DURA de publicación
 * (ECONOMICS_ACTIVATION=disabled por defecto), restricciones/reglas de alertas y el evaluador de alertas con eventos reales.
 * Reloj fijo = 2026-10-09T13:41:00Z. Las pruebas que dependen de tablas de otros módulos se adaptan a lo que tenga la base.
 */

const NOW = new Date("2026-10-09T13:41:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

const pool = createPool();
let app: FastifyInstance;
let world: StaffWorld;
let sevilla: string;
let cadiz: string;
let vehicleId: string;
let hasIncidents = false;
const extraApps: FastifyInstance[] = [];

before(async () => {
  await pool.query("select 1 from trust_alert_rules limit 1");
  hasIncidents = await hasTable(pool, "incident_reports");
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
  for (const extra of extraApps) await extra.close();
  await pool.end();
});

async function enabledApp(): Promise<FastifyInstance> {
  const built = await buildTrustApp(pool, { now: () => NOW, trustConfig: { economicsActivation: "enabled" } });
  extraApps.push(built.app);
  return built.app;
}

/* ───────────────────────────── Ayudas ───────────────────────────── */

const draftBody = (over: Record<string, unknown> = {}) => ({
  ratePerKmMicros: 180000,
  passengerCommissionBps: 1000,
  driverCommissionBps: 1000,
  premiumMonthlyCents: 299,
  sharedCostCapCents: null,
  notes: null,
  ...over
});
const putDraft = (body: unknown, as: SeededUser | null = world.admin, target: FastifyInstance = app) =>
  call(target, "PUT", "/v1/admin/tariffs/draft", { as, body });
const example = (body: unknown, as: SeededUser | null = world.admin) => call(app, "POST", "/v1/admin/tariffs/example", { as, body });
const publish = (versionId: string, body: unknown, as: SeededUser | null = world.admin, target: FastifyInstance = app) =>
  call(target, "POST", `/v1/admin/tariffs/versions/${versionId}/publish`, { as, body });
const defined = (cents: number) => ({ cents, currency: "EUR", status: "illustrative" });
const pendingMoney = { cents: null, currency: "EUR", status: "pending_definition" };

async function insertTariff(input: {
  version: number;
  status: "draft" | "approved" | "retired";
  rate?: number | null;
  passengerBps?: number | null;
  driverBps?: number | null;
  effectiveFrom?: string | null;
  approvalReference?: string | null;
  notes?: string | null;
}): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `insert into tariff_versions(version, status, rate_micros_per_km, passenger_commission_bps, driver_commission_bps, effective_from, approval_reference, notes)
     values($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [
      input.version,
      input.status,
      input.rate === undefined ? 180000 : input.rate,
      input.passengerBps === undefined ? 1000 : input.passengerBps,
      input.driverBps === undefined ? 1000 : input.driverBps,
      input.effectiveFrom ?? null,
      input.approvalReference ?? null,
      input.notes ?? null
    ]
  );
  return row.rows[0]!.id;
}

/** Huella de las tablas que una tarifa NUNCA debe alterar (reservas y cotizaciones congeladas). */
async function moneyFingerprint(): Promise<string> {
  const rows = await pool.query<{ fp: string }>(
    `select md5(
       coalesce((select jsonb_agg(to_jsonb(b) order by b.id) from bookings b)::text, '') ||
       coalesce((select jsonb_agg(to_jsonb(q) order by q.id) from quote_snapshots q)::text, '')
     ) as fp`
  );
  return rows.rows[0]!.fp;
}

async function tariffRow(id: string) {
  return (await pool.query(`select * from tariff_versions where id = $1`, [id])).rows[0];
}

/* ───────────────────────────── Tarifas: lectura ───────────────────────────── */

test("tarifas: sin datos no hay tarifa en vigor ni borrador y la activación consta como desactivada (no se inventa nada)", async () => {
  const res = await call(app, "GET", "/v1/admin/tariffs", { as: world.admin });
  assert.equal(res.status, 200);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(res.body.active, null);
  assert.equal(res.body.draft, null);
  assert.equal(res.body.activation.mode, "disabled");
  assert.equal(res.body.activation.canPublish, false);
  assert.match(res.body.activation.message, /desactivada/);
  assert.match(res.body.applyNote, /futuras reservas/);
  assert.equal(typeof res.body.auditNote, "string");
  const audit = await lastAudit(pool, "admin.tariffs.viewed");
  assert.deepEqual(audit?.metadata, { hasDraft: false, hasActive: false, activationMode: "disabled" });
  // lectura permitida a administración y finanzas; el resto no
  assert.equal((await call(app, "GET", "/v1/admin/tariffs", { as: world.finance })).status, 200);
  for (const who of [world.support, world.verification, world.rider, world.driver]) {
    assert.equal((await call(app, "GET", "/v1/admin/tariffs", { as: who })).status, 403);
  }
  assert.equal((await call(app, "GET", "/v1/admin/tariffs")).status, 401);
});

/* ───────────────────────────── Tarifas: borradores ───────────────────────────── */

test("borrador: se crea como versión 1 con todo «por definir» (null) y las siguientes llamadas actualizan ese único borrador", async () => {
  const created = await putDraft(
    { ratePerKmMicros: null, passengerCommissionBps: null, driverCommissionBps: null, premiumMonthlyCents: null },
    world.finance
  );
  assert.equal(created.status, 200);
  assert.equal(created.body.version, 1);
  assert.equal(created.body.status, "draft");
  for (const key of ["ratePerKmMicros", "passengerCommissionBps", "driverCommissionBps", "premiumMonthlyCents", "sharedCostCapCents", "effectiveFrom", "approvalReference", "notes"]) {
    assert.equal(created.body[key], null, key);
  }
  assert.deepEqual(created.body.createdBy, { id: world.finance.id, displayName: "Marta Soler" });
  assert.deepEqual(created.body.updatedBy, { id: world.finance.id, displayName: "Marta Soler" });

  const updated = await putDraft(draftBody({ sharedCostCapCents: 5000, notes: "  Revisar con finanzas  " }), world.admin);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.id, created.body.id, "es el mismo borrador");
  assert.equal(updated.body.version, 1);
  assert.deepEqual(
    [updated.body.ratePerKmMicros, updated.body.passengerCommissionBps, updated.body.driverCommissionBps, updated.body.premiumMonthlyCents, updated.body.sharedCostCapCents],
    [180000, 1000, 1000, 299, 5000]
  );
  assert.equal(updated.body.notes, "Revisar con finanzas");
  assert.deepEqual(updated.body.createdBy, { id: world.finance.id, displayName: "Marta Soler" }, "el autor original no cambia");
  assert.deepEqual(updated.body.updatedBy, { id: world.admin.id, displayName: "Lucía Ramos" });
  assert.equal((await pool.query(`select count(*)::int as n from tariff_versions`)).rows[0].n, 1);

  const blankNotes = await putDraft(draftBody({ notes: "   " }));
  assert.equal(blankNotes.body.notes, null, "las notas en blanco se guardan como null");

  const overview = await call(app, "GET", "/v1/admin/tariffs", { as: world.finance });
  assert.equal(overview.body.draft.id, created.body.id);
  assert.equal(overview.body.active, null, "un borrador no es una tarifa en vigor");

  const audits = await pool.query(`select metadata from audit_events where action = 'admin.tariff_draft.saved' order by id`);
  assert.equal(audits.rowCount, 3);
  assert.deepEqual([audits.rows[0].metadata.created, audits.rows[1].metadata.created, audits.rows[2].metadata.created], [true, false, false]);
  assert.equal(audits.rows[1].metadata.ratePerKmMicros, 180000);

  for (const who of [world.support, world.verification, world.rider, world.driver]) {
    assert.equal((await putDraft(draftBody(), who)).status, 403);
  }
  assert.equal((await putDraft(draftBody(), null)).status, 401);
  assert.equal((await pool.query(`select count(*)::int as n from tariff_versions`)).rows[0].n, 1, "los intentos denegados no escriben");
});

test("borrador: rangos fuera de límite → 422 TARIFF_INVALID con el campo; formas incorrectas → 400; nada se guarda", async () => {
  const invalid: Array<[Record<string, unknown>, string]> = [
    [{ ratePerKmMicros: 5_000_001 }, "ratePerKmMicros"],
    [{ ratePerKmMicros: -1 }, "ratePerKmMicros"],
    [{ passengerCommissionBps: 10_001 }, "passengerCommissionBps"],
    [{ driverCommissionBps: -5 }, "driverCommissionBps"],
    [{ premiumMonthlyCents: 1_000_001 }, "premiumMonthlyCents"],
    [{ sharedCostCapCents: 1_000_001 }, "sharedCostCapCents"],
    [{ notes: "x".repeat(1001) }, "notes"]
  ];
  for (const [override, field] of invalid) {
    const res = await putDraft(draftBody(override));
    assert.equal(res.status, 422, field);
    assert.equal(res.body.error.code, "TARIFF_INVALID", field);
    assert.deepEqual(res.body.error.details.fields.map((f: { field: string }) => f.field), [field]);
  }
  const several = await putDraft(draftBody({ ratePerKmMicros: 9_999_999, driverCommissionBps: 20_000 }));
  assert.deepEqual(several.body.error.details.fields.map((f: { field: string }) => f.field).sort(), ["driverCommissionBps", "ratePerKmMicros"]);

  const { premiumMonthlyCents: _omitted, ...missing } = draftBody();
  void _omitted;
  assert.equal((await putDraft(missing)).status, 400, "faltan claves obligatorias (pueden ser null, pero deben venir)");
  assert.equal((await putDraft(draftBody({ ratePerKmMicros: 1.5 }))).status, 400, "no se admiten decimales");
  assert.equal((await putDraft(draftBody({ notes: "x".repeat(2001) }))).status, 400);
  assert.equal((await putDraft(null)).status, 400);
  assert.equal((await pool.query(`select count(*)::int as n from tariff_versions`)).rows[0].n, 0, "ningún intento inválido deja rastro");
  assert.equal(await auditCount(pool, "admin.tariff_draft.saved"), 0);

  // los límites exactos son válidos
  const edge = await putDraft(draftBody({ ratePerKmMicros: 5_000_000, passengerCommissionBps: 10_000, driverCommissionBps: 0, premiumMonthlyCents: 1_000_000, sharedCostCapCents: 1_000_000 }));
  assert.equal(edge.status, 200);
});

test("borrador: no toca la tarifa aprobada ni las reservas; la versión siguiente es máx+1 y sigue habiendo un único borrador", async () => {
  const trip = await seedTrip(pool, world.driver.id, vehicleId, sevilla, { status: "published", departureAt: minutesAgo(-600) });
  const booking = await seedBooking(pool, { tripId: trip, passengerId: world.rider.id, status: "confirmed", amountCents: 356 });
  const approved = await insertTariff({ version: 3, status: "approved", effectiveFrom: "2026-01-01T00:00:00Z", approvalReference: "ACTA-2026-01" });
  await pool.query(
    `insert into quote_snapshots(request_id, tariff_version_id, road_distance_m, contribution_cents, passenger_commission_cents, driver_commission_cents, passenger_total_cents, driver_net_cents)
     values($1,$2,18000,324,32,32,356,292)`,
    [booking.requestId, approved]
  );
  const before = { fingerprint: await moneyFingerprint(), tariff: await tariffRow(approved) };

  const first = await putDraft(draftBody({ ratePerKmMicros: 200000 }));
  assert.equal(first.body.version, 4, "máximo + 1");
  const second = await putDraft(draftBody({ ratePerKmMicros: 210000 }));
  assert.equal(second.body.version, 4, "sigue siendo el mismo borrador");
  assert.equal((await pool.query(`select count(*)::int as n from tariff_versions where status = 'draft'`)).rows[0].n, 1);

  assert.deepEqual(await tariffRow(approved), before.tariff, "la tarifa aprobada queda intacta");
  assert.equal(await moneyFingerprint(), before.fingerprint, "reservas y cotizaciones congeladas no cambian");
  const overview = await call(app, "GET", "/v1/admin/tariffs", { as: world.admin });
  assert.equal(overview.body.active.version, 3);
  assert.equal(overview.body.active.ratePerKmMicros, 180000);
  assert.equal(overview.body.draft.version, 4);
  assert.equal(overview.body.draft.ratePerKmMicros, 210000);
});

/* ───────────────────────────── Tarifas: ejemplo de aportación ───────────────────────────── */

test("ejemplo: 18 km a 0,18 €/km con 10 % / 10 % → 3,24 · 0,32 · 3,56 · 0,32 · 2,92 (importes «Ejemplo»), sin guardar nada", async () => {
  const res = await example({ distanceMeters: 18000, ratePerKmMicros: 180000, passengerCommissionBps: 1000, driverCommissionBps: 1000 });
  assert.equal(res.status, 200);
  assert.equal(res.body.distanceMeters, 18000);
  assert.equal(res.body.ratePerKmMicros, 180000);
  assert.deepEqual(res.body.contribution, defined(324));
  assert.deepEqual(res.body.passengerCommission, defined(32));
  assert.deepEqual(res.body.passengerTotal, defined(356));
  assert.deepEqual(res.body.driverCommission, defined(32));
  assert.deepEqual(res.body.driverNet, defined(292));
  assert.equal(res.body.roundingRule, "half_up_cents");
  assert.match(res.body.disclaimer, /gestión/);
  assert.equal((await pool.query(`select count(*)::int as n from tariff_versions`)).rows[0].n, 0, "es solo un cálculo");
  assert.deepEqual((await lastAudit(pool, "admin.tariff_example.calculated"))?.metadata, {
    distanceMeters: 18000,
    ratePerKmMicros: 180000,
    passengerCommissionBps: 1000,
    driverCommissionBps: 1000
  });
  assert.equal((await example({ distanceMeters: 18000, ratePerKmMicros: 180000 }, world.finance)).status, 200);
  for (const who of [world.support, world.verification, world.rider, world.driver]) {
    assert.equal((await example({ distanceMeters: 18000 }, who)).status, 403);
  }
});

test("ejemplo: redondea medio céntimo hacia arriba y lo que falta queda «por definir» sin inventar", async () => {
  // 1000 m a 0,175 €/km = 17,5 céntimos → 18
  assert.deepEqual((await example({ distanceMeters: 1000, ratePerKmMicros: 175000, passengerCommissionBps: 0, driverCommissionBps: 0 })).body.contribution, defined(18));
  // 10 céntimos con 5 % = 0,5 céntimos → 1
  const half = (await example({ distanceMeters: 1000, ratePerKmMicros: 100000, passengerCommissionBps: 500, driverCommissionBps: 0 })).body;
  assert.deepEqual([half.contribution, half.passengerCommission, half.passengerTotal, half.driverCommission, half.driverNet], [defined(10), defined(1), defined(11), defined(0), defined(10)]);
  // tarifa 0 es válida (aportación 0)
  assert.deepEqual((await example({ distanceMeters: 5000, ratePerKmMicros: 0, passengerCommissionBps: 1000, driverCommissionBps: 1000 })).body.contribution, defined(0));

  // sin tarifa por km no hay nada que calcular
  for (const body of [{ distanceMeters: 18000 }, { distanceMeters: 18000, ratePerKmMicros: null, passengerCommissionBps: 1000, driverCommissionBps: 1000 }]) {
    const noRate = (await example(body)).body;
    for (const key of ["contribution", "passengerCommission", "passengerTotal", "driverCommission", "driverNet"]) assert.deepEqual(noRate[key], pendingMoney, key);
  }
  // sin la comisión del pasajero solo falta lo que depende de ella
  const partial = (await example({ distanceMeters: 18000, ratePerKmMicros: 180000, driverCommissionBps: 1000 })).body;
  assert.deepEqual([partial.contribution, partial.passengerCommission, partial.passengerTotal], [defined(324), pendingMoney, pendingMoney]);
  assert.deepEqual([partial.driverCommission, partial.driverNet], [defined(32), defined(292)]);
  const partialDriver = (await example({ distanceMeters: 18000, ratePerKmMicros: 180000, passengerCommissionBps: 1000 })).body;
  assert.deepEqual([partialDriver.passengerTotal, partialDriver.driverCommission, partialDriver.driverNet], [defined(356), pendingMoney, pendingMoney]);
});

test("ejemplo: distancia 1–2 000 000 m y valores dentro de rango → 422 TARIFF_INVALID; formas incorrectas → 400", async () => {
  const invalid: Array<[Record<string, unknown>, string]> = [
    [{ distanceMeters: 0 }, "distanceMeters"],
    [{ distanceMeters: -10 }, "distanceMeters"],
    [{ distanceMeters: 2_000_001 }, "distanceMeters"],
    [{ distanceMeters: 1000, ratePerKmMicros: 5_000_001 }, "ratePerKmMicros"],
    [{ distanceMeters: 1000, passengerCommissionBps: 10_001 }, "passengerCommissionBps"],
    [{ distanceMeters: 1000, driverCommissionBps: -1 }, "driverCommissionBps"]
  ];
  for (const [body, field] of invalid) {
    const res = await example(body);
    assert.equal(res.status, 422, JSON.stringify(body));
    assert.equal(res.body.error.code, "TARIFF_INVALID");
    assert.deepEqual(res.body.error.details.fields.map((f: { field: string }) => f.field), [field]);
  }
  for (const body of [{}, { distanceMeters: 12.5 }, { distanceMeters: "lejos" }, null]) {
    assert.equal((await example(body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await example({ distanceMeters: 2_000_000, ratePerKmMicros: 5_000_000 })).status, 200, "los límites exactos son válidos");
});

/* ───────────────────────────── Tarifas: historial ───────────────────────────── */

test("historial de versiones: más recientes primero, paginación por cursor opaco y roles de lectura", async () => {
  assert.deepEqual((await call(app, "GET", "/v1/admin/tariffs/versions", { as: world.admin })).body, { items: [], nextCursor: null });
  await insertTariff({ version: 1, status: "retired", effectiveFrom: "2026-01-01T00:00:00Z", approvalReference: "ACTA-1" });
  await insertTariff({ version: 2, status: "approved", effectiveFrom: "2026-03-01T00:00:00Z", approvalReference: "ACTA-2", notes: "Primera revisión" });
  await insertTariff({ version: 3, status: "approved", effectiveFrom: "2026-06-01T00:00:00Z", approvalReference: "ACTA-3" });
  await insertTariff({ version: 4, status: "retired", effectiveFrom: "2026-07-01T00:00:00Z", approvalReference: "ACTA-4" });
  await insertTariff({ version: 5, status: "draft", rate: null, passengerBps: null, driverBps: null });

  const all = await call(app, "GET", "/v1/admin/tariffs/versions", { as: world.finance });
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.items.map((i: any) => [i.version, i.status]), [[5, "draft"], [4, "retired"], [3, "approved"], [2, "approved"], [1, "retired"]]);
  const v2 = all.body.items.find((i: any) => i.version === 2);
  assert.deepEqual([v2.ratePerKmMicros, v2.effectiveFrom, v2.approvalReference, v2.notes], [180000, "2026-03-01T00:00:00.000Z", "ACTA-2", "Primera revisión"]);
  assert.equal(all.body.items[0].ratePerKmMicros, null, "el borrador conserva sus «por definir»");

  const seen: number[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page: any = await call(app, "GET", "/v1/admin/tariffs/versions", { as: world.admin, query: { limit: 2, ...(cursor ? { cursor } : {}) } });
    assert.ok(page.body.items.length <= 2);
    seen.push(...page.body.items.map((i: any) => i.version));
    cursor = page.body.nextCursor;
    pages += 1;
  } while (cursor && pages < 6);
  assert.deepEqual(seen, [5, 4, 3, 2, 1]);
  assert.equal(pages, 3);

  assert.equal((await call(app, "GET", "/v1/admin/tariffs/versions", { as: world.admin, query: { cursor: "basura" } })).body.error.code, "CURSOR_INVALID");
  for (const limit of [0, 51]) assert.equal((await call(app, "GET", "/v1/admin/tariffs/versions", { as: world.admin, query: { limit } })).status, 400);
  assert.equal((await lastAudit(pool, "admin.tariff_versions.listed"))?.entity_type, "tariff");
  for (const who of [world.support, world.verification, world.rider]) {
    assert.equal((await call(app, "GET", "/v1/admin/tariffs/versions", { as: who })).status, 403);
  }
});

/* ───────────────────────────── Tarifas: PUERTA DURA de publicación ───────────────────────────── */

test("publicar con ECONOMICS_ACTIVATION=disabled (valor por defecto): 409 siempre, antes de validar nada; no modifica nada y deja el intento auditado", async () => {
  const draft = (await putDraft(draftBody())).body;
  const before = { row: await tariffRow(draft.id), fingerprint: await moneyFingerprint() };
  const valid = { approvalReference: "ACTA-2026-11", effectiveFrom: "2099-01-01T00:00:00Z" };

  const res = await publish(draft.id, valid);
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "ECONOMICS_ACTIVATION_DISABLED");
  assert.match(res.body.error.message, /No se ha modificado nada/);
  assert.deepEqual(await tariffRow(draft.id), before.row, "la fila no cambia ni siquiera en updated_at");
  assert.equal((await tariffRow(draft.id)).status, "draft");
  assert.equal((await tariffRow(draft.id)).effective_from, null);
  assert.equal(await moneyFingerprint(), before.fingerprint);
  const attempt = await lastAudit(pool, "admin.tariff.publish_attempted");
  assert.equal(attempt?.actor_user_id, world.admin.id);
  assert.equal(attempt?.entity_id, draft.id);
  assert.deepEqual(attempt?.metadata, { blocked: true, reason: "ECONOMICS_ACTIVATION_DISABLED", mode: "disabled" });
  assert.equal(await auditCount(pool, "admin.tariff.published"), 0);

  // La puerta va ANTES de validar cuerpo e identificador: cualquier combinación recibe lo mismo y se audita
  const attempts: Array<[string, unknown]> = [
    [draft.id, null],
    [draft.id, {}],
    [draft.id, { approvalReference: "", effectiveFrom: "" }],
    [draft.id, { approvalReference: "ACTA-2026-11", effectiveFrom: "2020-01-01T00:00:00Z" }],
    [draft.id, { approvalReference: "x", effectiveFrom: "no-es-una-fecha" }],
    ["no-es-un-uuid", valid],
    [crypto.randomUUID(), valid]
  ];
  for (const [id, body] of attempts) {
    const r = await publish(id, body);
    assert.equal(r.status, 409, `${id} ${JSON.stringify(body)}`);
    assert.equal(r.body.error.code, "ECONOMICS_ACTIVATION_DISABLED");
  }
  // sin cuerpo en absoluto también
  const noBody = await call(app, "POST", `/v1/admin/tariffs/versions/${draft.id}/publish`, { as: world.admin });
  assert.equal(noBody.status, 409);
  assert.equal(noBody.body.error.code, "ECONOMICS_ACTIVATION_DISABLED");
  assert.equal(await auditCount(pool, "admin.tariff.publish_attempted"), 1 + attempts.length + 1);
  const withBadId = await pool.query(`select entity_id from audit_events where action = 'admin.tariff.publish_attempted' order by id`);
  assert.ok(withBadId.rows.some(r => r.entity_id === null), "un identificador que no es UUID se audita sin entidad");

  // nada ha cambiado en toda la secuencia
  assert.deepEqual(await tariffRow(draft.id), before.row);
  assert.equal((await pool.query(`select count(*)::int as n from tariff_versions where status = 'approved'`)).rows[0].n, 0);
  assert.equal(await moneyFingerprint(), before.fingerprint);

  // y la pantalla lo refleja
  const overview = (await call(app, "GET", "/v1/admin/tariffs", { as: world.admin })).body;
  assert.equal(overview.activation.canPublish, false);
  assert.equal(overview.active, null);
});

test("publicar: solo administración; el resto de roles recibe 403 (auditado) antes de llegar a la puerta", async () => {
  const draft = (await putDraft(draftBody())).body;
  for (const who of [world.finance, world.support, world.verification, world.rider, world.driver]) {
    const r = await publish(draft.id, { approvalReference: "ACTA-1", effectiveFrom: "2099-01-01T00:00:00Z" }, who);
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, "AUTH_FORBIDDEN");
  }
  assert.equal((await publish(draft.id, null, null)).status, 401);
  assert.equal(await auditCount(pool, "admin.tariff.publish_attempted"), 0, "no es un intento de publicar: nunca llegó a la puerta");
  const denied = await lastAudit(pool, "admin.access_denied");
  assert.equal(denied?.metadata.resource, "tariff_activation");
});

test("publicar con la activación HABILITADA explícitamente: exige referencia, fecha futura y borrador completo; no retira versiones ni toca reservas", async () => {
  const on = await enabledApp();
  const overview = (await call(on, "GET", "/v1/admin/tariffs", { as: world.admin })).body;
  assert.deepEqual([overview.activation.mode, overview.activation.canPublish], ["enabled", true]);

  // tarifa anterior aprobada y reserva ya cotizada con ella
  const older = await insertTariff({ version: 1, status: "approved", effectiveFrom: "2026-01-01T00:00:00Z", approvalReference: "ACTA-2026-01" });
  const trip = await seedTrip(pool, world.driver.id, vehicleId, sevilla, { status: "published", departureAt: minutesAgo(-600) });
  const booking = await seedBooking(pool, { tripId: trip, passengerId: world.rider.id, status: "confirmed", amountCents: 356 });
  await pool.query(
    `insert into quote_snapshots(request_id, tariff_version_id, road_distance_m, contribution_cents, passenger_commission_cents, driver_commission_cents, passenger_total_cents, driver_net_cents)
     values($1,$2,18000,324,32,32,356,292)`,
    [booking.requestId, older]
  );
  const frozen = { fingerprint: await moneyFingerprint(), older: await tariffRow(older) };

  // borrador incompleto → no se puede publicar
  const incomplete = (await putDraft(draftBody({ ratePerKmMicros: null, driverCommissionBps: null }), world.admin, on)).body;
  const tooEarly = await publish(incomplete.id, { approvalReference: "ACTA-2026-11", effectiveFrom: "2099-01-01T00:00:00Z" }, world.admin, on);
  assert.equal(tooEarly.status, 422);
  assert.equal(tooEarly.body.error.code, "TARIFF_DRAFT_INCOMPLETE");
  assert.deepEqual(tooEarly.body.error.details.missing.sort(), ["driverCommissionBps", "ratePerKmMicros"]);
  assert.equal((await tariffRow(incomplete.id)).status, "draft");

  const draft = (await putDraft(draftBody({ ratePerKmMicros: 200000 }), world.admin, on)).body;
  assert.equal(draft.id, incomplete.id);
  const future = "2099-01-01T00:00:00Z";

  // validaciones de la entrada
  for (const reference of ["", "  ", "ab"]) {
    const r = await publish(draft.id, { approvalReference: reference, effectiveFrom: future }, world.admin, on);
    assert.equal(r.body.error.code, "APPROVAL_REFERENCE_REQUIRED", JSON.stringify(reference));
    assert.equal(r.status, 422);
  }
  for (const effectiveFrom of ["", "no-es-una-fecha", "2020-01-01T00:00:00Z", NOW.toISOString(), "2026-10-09T13:40:59Z"]) {
    const r = await publish(draft.id, { approvalReference: "ACTA-2026-11", effectiveFrom }, world.admin, on);
    assert.equal(r.body.error.code, "TARIFF_EFFECTIVE_FROM_INVALID", effectiveFrom);
    assert.equal(r.status, 422);
  }
  assert.equal((await publish(draft.id, null, world.admin, on)).body.error.code, "APPROVAL_REFERENCE_REQUIRED", "sin cuerpo no hay referencia");
  const unknown = await publish(crypto.randomUUID(), { approvalReference: "ACTA-2026-11", effectiveFrom: future }, world.admin, on);
  assert.deepEqual([unknown.status, unknown.body.error.code], [404, "TARIFF_NOT_FOUND"]);
  const notUuid = await publish("no-es-un-uuid", { approvalReference: "ACTA-2026-11", effectiveFrom: future }, world.admin, on);
  assert.deepEqual([notUuid.status, notUuid.body.error.code], [404, "TARIFF_NOT_FOUND"]);
  assert.equal((await tariffRow(draft.id)).status, "draft", "ninguna entrada inválida cambia el borrador");

  // publicar de verdad (la entrada en vigor queda lejos: no se activa nada hoy)
  const ok = await publish(draft.id, { approvalReference: "  ACTA-2026-11 Consejo  ", effectiveFrom: future }, world.admin, on);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, "approved");
  assert.equal(ok.body.approvalReference, "ACTA-2026-11 Consejo");
  assert.equal(ok.body.effectiveFrom, "2099-01-01T00:00:00.000Z");
  assert.equal(ok.body.ratePerKmMicros, 200000);
  const stored = await tariffRow(draft.id);
  assert.equal(stored.approved_by_user_id, world.admin.id);
  assert.ok(stored.approved_at);
  const published = await lastAudit(pool, "admin.tariff.published");
  assert.equal(published?.entity_id, draft.id);
  assert.deepEqual(published?.metadata, { version: 2, effectiveFrom: "2099-01-01T00:00:00.000Z", approvalReference: "ACTA-2026-11 Consejo" });
  assert.equal(await auditCount(pool, "admin.tariff.publish_attempted"), 0, "con la activación habilitada no hay intento bloqueado");

  // no retira versiones anteriores, no toca reservas y la tarifa en vigor sigue siendo la anterior hasta que llegue la fecha
  assert.deepEqual(await tariffRow(older), frozen.older);
  assert.equal(await moneyFingerprint(), frozen.fingerprint);
  assert.equal((await call(on, "GET", "/v1/admin/tariffs", { as: world.admin })).body.active.version, 1);
  await pool.query(`update tariff_versions set effective_from = '2026-06-01T00:00:00Z' where id = $1`, [draft.id]);
  const arrived = (await call(on, "GET", "/v1/admin/tariffs", { as: world.admin })).body;
  assert.equal(arrived.active.version, 2, "la vigente es la aprobada con mayor fecha de entrada ya alcanzada");
  assert.equal(arrived.draft, null);
  assert.equal((await tariffRow(older)).status, "approved", "la anterior sigue aprobada (histórico)");

  // una versión ya aprobada o retirada no se vuelve a publicar
  const again = await publish(draft.id, { approvalReference: "ACTA-2026-12", effectiveFrom: future }, world.admin, on);
  assert.deepEqual([again.status, again.body.error.code], [409, "TARIFF_NOT_DRAFT"]);
  const retired = await insertTariff({ version: 9, status: "retired" });
  assert.equal((await publish(retired, { approvalReference: "ACTA-2026-12", effectiveFrom: future }, world.admin, on)).body.error.code, "TARIFF_NOT_DRAFT");
  // el resto de roles sigue sin poder publicar aunque la activación esté habilitada
  const other = await putDraft(draftBody(), world.admin, on);
  assert.equal((await publish(other.body.id, { approvalReference: "ACTA-9", effectiveFrom: future }, world.finance, on)).status, 403);
});

/* ───────────────────────────── Operaciones ───────────────────────────── */

test("operaciones: valores por defecto — provincia bloqueada, tres reglas con sus parámetros y la fuente de sus eventos", async () => {
  const res = await call(app, "GET", "/v1/admin/operations", { as: world.support });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.provinceOnly, { enabled: true, locked: true, label: "Solo trayectos dentro de la provincia" });
  assert.equal(res.body.realtimeAlerts.enabled, true);
  const rules = res.body.realtimeAlerts.rules;
  assert.deepEqual(rules.map((r: any) => r.kind), ["unusual_cancellations", "schedule_price_changes", "route_incidents"]);
  assert.deepEqual(rules.map((r: any) => r.label), [
    "Cancelaciones inusuales",
    "Cambios de horario o precio (requiere aceptación)",
    "Incidencias en ruta"
  ]);
  assert.deepEqual(rules.map((r: any) => r.params), [
    { thresholdCount: 5, windowMinutes: 60 },
    { maxPendingMinutes: 30 },
    { thresholdCount: 1, windowMinutes: 60 }
  ]);
  assert.ok(rules.every((r: any) => r.enabled === true));
  assert.deepEqual([rules[0].source, rules[0].sourceNote, rules[1].source], ["available", null, "available"]);
  if (hasIncidents) {
    assert.deepEqual([rules[2].source, rules[2].sourceNote], ["available", null]);
  } else {
    assert.equal(rules[2].source, "unavailable");
    assert.match(rules[2].sourceNote, /incidencias/);
  }
  assert.deepEqual([res.body.updatedAt, res.body.updatedBy], [null, null]);
  assert.equal(await auditCount(pool, "admin.operations.viewed"), 1);
  assert.equal((await call(app, "GET", "/v1/admin/operations", { as: world.finance })).status, 200);
  for (const who of [world.verification, world.rider, world.driver]) assert.equal((await call(app, "GET", "/v1/admin/operations", { as: who })).status, 403);
});

test("operaciones: guardar interruptor y reglas (fusiona parámetros), auditado con antes y después; solo administración escribe", async () => {
  const res = await call(app, "PUT", "/v1/admin/operations", {
    as: world.admin,
    body: {
      realtimeAlertsEnabled: false,
      rules: [
        { kind: "unusual_cancellations", params: { thresholdCount: 3 } },
        { kind: "route_incidents", enabled: false }
      ]
    }
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.realtimeAlerts.enabled, false);
  const byKind = Object.fromEntries(res.body.realtimeAlerts.rules.map((r: any) => [r.kind, r]));
  assert.deepEqual(byKind.unusual_cancellations.params, { thresholdCount: 3, windowMinutes: 60 }, "los parámetros no enviados se conservan");
  assert.equal(byKind.unusual_cancellations.enabled, true);
  assert.equal(byKind.route_incidents.enabled, false);
  assert.deepEqual(byKind.route_incidents.params, { thresholdCount: 1, windowMinutes: 60 });
  assert.deepEqual(byKind.schedule_price_changes.params, { maxPendingMinutes: 30 });
  assert.deepEqual(res.body.updatedBy, { id: world.admin.id, displayName: "Lucía Ramos" });
  assert.ok(res.body.updatedAt);
  const audit = await lastAudit(pool, "admin.operations.updated");
  assert.equal(audit?.actor_user_id, world.admin.id);
  assert.equal(audit?.metadata.changes.realtimeAlertsEnabled, false);
  assert.deepEqual(audit?.metadata.changes.unusual_cancellations, {
    before: { enabled: true, params: { thresholdCount: 5, windowMinutes: 60 } },
    after: { enabled: true, params: { thresholdCount: 3, windowMinutes: 60 } }
  });
  assert.deepEqual(audit?.metadata.changes.route_incidents.after.enabled, false);

  // GET refleja lo guardado
  const reread = (await call(app, "GET", "/v1/admin/operations", { as: world.finance })).body;
  assert.deepEqual(reread.realtimeAlerts.rules.map((r: any) => r.enabled), [true, true, false]);

  // quien puede leer no puede escribir
  for (const who of [world.finance, world.support, world.verification, world.rider, world.driver]) {
    assert.equal((await call(app, "PUT", "/v1/admin/operations", { as: who, body: { realtimeAlertsEnabled: true } })).status, 403);
  }
  assert.equal((await call(app, "PUT", "/v1/admin/operations", { body: { realtimeAlertsEnabled: true } })).status, 401);
  assert.equal((await pool.query(`select realtime_alerts_enabled from trust_operations_settings`)).rows[0].realtime_alerts_enabled, false);

  // `provinceOnly:true` y un cuerpo vacío son válidos (no cambian nada, pero quedan auditados)
  assert.equal((await call(app, "PUT", "/v1/admin/operations", { as: world.admin, body: { provinceOnly: true } })).status, 200);
  const empty = await call(app, "PUT", "/v1/admin/operations", { as: world.admin, body: {} });
  assert.equal(empty.status, 200);
  assert.deepEqual((await lastAudit(pool, "admin.operations.updated"))?.metadata, { changes: {} });
});

test("operaciones: «Solo trayectos dentro de la provincia» no se puede desactivar (422 PROVINCE_ONLY_LOCKED) y no se aplica nada de lo demás", async () => {
  const res = await call(app, "PUT", "/v1/admin/operations", {
    as: world.admin,
    body: { provinceOnly: false, realtimeAlertsEnabled: false, rules: [{ kind: "unusual_cancellations", enabled: false }] }
  });
  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, "PROVINCE_ONLY_LOCKED");
  assert.equal((await pool.query(`select realtime_alerts_enabled from trust_operations_settings`)).rows[0].realtime_alerts_enabled, true);
  assert.equal((await pool.query(`select enabled from trust_alert_rules where kind = 'unusual_cancellations'`)).rows[0].enabled, true);
  assert.equal(await auditCount(pool, "admin.operations.updated"), 0);
  const after = (await call(app, "GET", "/v1/admin/operations", { as: world.admin })).body;
  assert.deepEqual([after.provinceOnly.enabled, after.provinceOnly.locked], [true, true]);
});

test("operaciones: parámetros no admitidos o fuera de rango → 400 VALIDATION_ERROR con la lista de problemas; no se guarda nada", async () => {
  const bad: Array<[Record<string, unknown>, string]> = [
    [{ kind: "unusual_cancellations", params: { maxPendingMinutes: 10 } }, "rules.0.params.maxPendingMinutes"],
    [{ kind: "unusual_cancellations", params: { thresholdCount: 0 } }, "rules.0.params.thresholdCount"],
    [{ kind: "unusual_cancellations", params: { thresholdCount: 1001 } }, "rules.0.params.thresholdCount"],
    [{ kind: "unusual_cancellations", params: { windowMinutes: 4 } }, "rules.0.params.windowMinutes"],
    [{ kind: "route_incidents", params: { windowMinutes: 1441 } }, "rules.0.params.windowMinutes"],
    [{ kind: "schedule_price_changes", params: { maxPendingMinutes: 0 } }, "rules.0.params.maxPendingMinutes"],
    [{ kind: "schedule_price_changes", params: { maxPendingMinutes: 1.5 } }, "rules.0.params.maxPendingMinutes"],
    [{ kind: "schedule_price_changes", params: { maxPendingMinutes: "mucho" } }, "rules.0.params.maxPendingMinutes"],
    [{ kind: "schedule_price_changes", params: { thresholdCount: 3 } }, "rules.0.params.thresholdCount"]
  ];
  for (const [rule, path] of bad) {
    const res = await call(app, "PUT", "/v1/admin/operations", { as: world.admin, body: { realtimeAlertsEnabled: false, rules: [rule] } });
    assert.equal(res.status, 400, path);
    assert.equal(res.body.error.code, "VALIDATION_ERROR");
    assert.ok(res.body.error.details.issues.some((i: { path: string }) => i.path === path), path);
  }
  const several = await call(app, "PUT", "/v1/admin/operations", {
    as: world.admin,
    body: { rules: [{ kind: "unusual_cancellations", params: { thresholdCount: 0 } }, { kind: "route_incidents", params: { nope: 1 } }] }
  });
  assert.deepEqual(
    several.body.error.details.issues.map((i: { path: string }) => i.path).sort(),
    ["rules.0.params.thresholdCount", "rules.1.params.nope"]
  );
  // formas incorrectas
  for (const body of [
    { rules: [{ kind: "otra_regla" }] },
    { rules: [{ enabled: true }] },
    { rules: [{ kind: "unusual_cancellations" }, { kind: "schedule_price_changes" }, { kind: "route_incidents" }, { kind: "route_incidents" }] },
    { realtimeAlertsEnabled: "quizás" }
  ]) {
    assert.equal((await call(app, "PUT", "/v1/admin/operations", { as: world.admin, body })).status, 400, JSON.stringify(body));
  }
  // los límites exactos valen
  const edge = await call(app, "PUT", "/v1/admin/operations", {
    as: world.admin,
    body: { rules: [{ kind: "unusual_cancellations", params: { thresholdCount: 1000, windowMinutes: 5 } }, { kind: "schedule_price_changes", params: { maxPendingMinutes: 1440 } }] }
  });
  assert.equal(edge.status, 200);
  // y nada de lo anterior se guardó
  assert.equal((await pool.query(`select realtime_alerts_enabled from trust_operations_settings`)).rows[0].realtime_alerts_enabled, true);
  assert.equal(await auditCount(pool, "admin.operations.updated"), 1);
});

/* ───────────────────────────── Evaluador de alertas ───────────────────────────── */

async function cancelledBookings(tripId: string, minutes: number[], status: "cancelled" | "driver_cancelled" = "cancelled"): Promise<void> {
  for (const m of minutes) {
    await seedBooking(pool, { tripId, passengerId: world.rider.id, status, amountCents: 356, requestedAt: minutesAgo(m + 5), updatedAt: minutesAgo(m) });
  }
}
const evaluate = (as: SeededUser | null = world.admin) => call(app, "POST", "/v1/admin/alerts/evaluate", { as });
const listAlerts = (query: Record<string, string | number> = {}, as: SeededUser = world.admin) => call(app, "GET", "/v1/admin/alerts", { as, query });
const ruleResult = (res: { body: any }, kind: string) => res.body.rules.find((r: any) => r.kind === kind);

test("evaluador · cancelaciones: umbral y ventana reales, una alerta viva por provincia, severidad, avisos solo a administración y soporte", async () => {
  const tripSevilla = await seedTrip(pool, world.driver.id, vehicleId, sevilla, { status: "published", departureAt: minutesAgo(-300) });
  const tripCadiz = await seedTrip(pool, world.driver.id, vehicleId, cadiz, { status: "published", departureAt: minutesAgo(-300) });

  // 4 cancelaciones recientes + 1 confirmada + 1 fuera de ventana: por debajo del umbral (5)
  await cancelledBookings(tripSevilla, [5, 12, 30], "cancelled");
  await cancelledBookings(tripSevilla, [50], "driver_cancelled");
  await seedBooking(pool, { tripId: tripSevilla, passengerId: world.driver.id, status: "confirmed", requestedAt: minutesAgo(10), updatedAt: minutesAgo(10) });
  await cancelledBookings(tripSevilla, [90]);
  const quiet = await evaluate();
  assert.equal(quiet.status, 200);
  assert.equal(quiet.body.evaluatedAt, NOW.toISOString());
  assert.equal(quiet.body.created, 0);
  assert.deepEqual(ruleResult(quiet, "unusual_cancellations"), { kind: "unusual_cancellations", enabled: true, evaluated: true, created: 0, skippedReason: null });
  assert.deepEqual((await listAlerts({ status: "all" })).body.items, [], "sin datos que superen el umbral no se inventa nada");
  assert.deepEqual((await lastAudit(pool, "admin.alerts.evaluated"))?.metadata, {
    via: "api",
    created: 0,
    autoResolved: 0,
    byKind: { unusual_cancellations: 0, schedule_price_changes: 0, route_incidents: 0 }
  });

  // la quinta (dentro de la ventana) cruza el umbral
  await cancelledBookings(tripSevilla, [58]);
  const first = await evaluate();
  assert.equal(first.body.created, 1);
  assert.equal(ruleResult(first, "unusual_cancellations").created, 1);
  const alerts = (await listAlerts()).body.items;
  assert.equal(alerts.length, 1);
  assert.deepEqual(
    { kind: alerts[0].kind, severity: alerts[0].severity, status: alerts[0].status, title: alerts[0].title, province: alerts[0].province, detectedAt: alerts[0].detectedAt },
    { kind: "unusual_cancellations", severity: "warning", status: "open", title: "Cancelaciones inusuales", province: { id: sevilla, code: "41", name: "Sevilla" }, detectedAt: NOW.toISOString() }
  );
  assert.equal(alerts[0].body, "5 reservas canceladas en los últimos 60 minutos (umbral: 5).");
  assert.deepEqual(alerts[0].data, { count: 5, windowMinutes: 60, thresholdCount: 5 });
  assert.deepEqual([alerts[0].acknowledgedAt, alerts[0].resolvedAt], [null, null]);

  // deduplicación: mientras siga viva no se repite (ni se vuelve a avisar)
  const notificationsBefore = (await pool.query(`select count(*)::int as n from notifications`)).rows[0].n;
  const again = await evaluate();
  assert.equal(again.body.created, 0);
  assert.equal((await listAlerts({ status: "all" })).body.items.length, 1);
  assert.equal((await pool.query(`select count(*)::int as n from notifications`)).rows[0].n, notificationsBefore);

  // avisos internos: solo administración y soporte, sin datos personales
  const notified = await pool.query(`select user_id, category, kind, title, body, data from notifications order by user_id`);
  assert.deepEqual(notified.rows.map(r => r.user_id).sort(), [world.admin.id, world.support.id].sort());
  for (const row of notified.rows) {
    assert.deepEqual([row.category, row.kind, row.title, row.body], ["system", "admin_alert", "Alerta de operaciones", "Cancelaciones inusuales"]);
    assert.deepEqual(row.data, { alertId: alerts[0].id, kind: "unusual_cancellations" });
  }
  const dump = JSON.stringify(notified.rows);
  assert.doesNotMatch(dump, /\+34|Miguel|Torres|Ana López/, "ni teléfonos ni nombres");

  // otra provincia: alerta propia; severidad crítica a partir de 2 × umbral
  await cancelledBookings(tripCadiz, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const second = await evaluate();
  assert.equal(second.body.created, 1);
  const cadizAlert = (await listAlerts()).body.items.find((a: any) => a.province?.code === "11");
  assert.equal(cadizAlert.severity, "critical");
  assert.equal(cadizAlert.data.count, 10);
  assert.equal((await listAlerts()).body.items.length, 2);

  // reconocer no la libera; resolver sí (el siguiente ciclo puede crear una nueva si el problema continúa)
  const sevillaAlert = (await listAlerts()).body.items.find((a: any) => a.province?.code === "41");
  assert.equal((await call(app, "POST", `/v1/admin/alerts/${sevillaAlert.id}/status`, { as: world.support, body: { status: "acknowledged" } })).status, 200);
  assert.equal((await evaluate()).body.created, 0, "una alerta reconocida sigue viva");
  assert.equal((await call(app, "POST", `/v1/admin/alerts/${sevillaAlert.id}/status`, { as: world.support, body: { status: "resolved" } })).status, 200);
  assert.equal((await evaluate()).body.created, 1, "resuelta y el problema continúa → nueva alerta");
  assert.equal((await listAlerts({ status: "all", kind: "unusual_cancellations" })).body.items.length, 3);
});

test("evaluador · interruptor general, reglas desactivadas y umbral configurable", async () => {
  const trip = await seedTrip(pool, world.driver.id, vehicleId, sevilla, { status: "published", departureAt: minutesAgo(-300) });
  await cancelledBookings(trip, [5, 10, 15]);

  // con el umbral por defecto (5) no hay nada; bajándolo a 3 sí
  assert.equal((await evaluate()).body.created, 0);
  await call(app, "PUT", "/v1/admin/operations", { as: world.admin, body: { rules: [{ kind: "unusual_cancellations", params: { thresholdCount: 3 } }] } });

  // regla desactivada
  await call(app, "PUT", "/v1/admin/operations", { as: world.admin, body: { rules: [{ kind: "unusual_cancellations", enabled: false }] } });
  const disabled = await evaluate();
  assert.deepEqual(ruleResult(disabled, "unusual_cancellations"), { kind: "unusual_cancellations", enabled: false, evaluated: false, created: 0, skippedReason: "disabled" });
  assert.equal(disabled.body.created, 0);

  // interruptor general apagado: ninguna regla se evalúa
  await call(app, "PUT", "/v1/admin/operations", { as: world.admin, body: { realtimeAlertsEnabled: false, rules: [{ kind: "unusual_cancellations", enabled: true }] } });
  const off = await evaluate();
  assert.deepEqual(off.body.rules.map((r: any) => [r.kind, r.evaluated, r.skippedReason]), [
    ["unusual_cancellations", false, "realtime_alerts_off"],
    ["schedule_price_changes", false, "realtime_alerts_off"],
    ["route_incidents", false, "realtime_alerts_off"]
  ]);
  assert.equal(off.body.created, 0);
  assert.equal((await listAlerts({ status: "all" })).body.items.length, 0);
  assert.equal(await auditCount(pool, "admin.alerts.evaluated"), 3, "cada evaluación queda auditada, también las que no hacen nada");

  // encendido de nuevo: ahora sí
  await call(app, "PUT", "/v1/admin/operations", { as: world.admin, body: { realtimeAlertsEnabled: true } });
  const on = await evaluate();
  assert.equal(on.body.created, 1);
  assert.equal((await listAlerts()).body.items[0].data.thresholdCount, 3);
  assert.equal((await listAlerts()).body.items[0].body, "3 reservas canceladas en los últimos 60 minutos (umbral: 3).");

  // permisos: administración y soporte evalúan; finanzas y verificación no
  assert.equal((await evaluate(world.support)).status, 200);
  for (const who of [world.finance, world.verification, world.rider, world.driver]) assert.equal((await evaluate(who)).status, 403);
  assert.equal((await evaluate(null)).status, 401);
});

test("evaluador · cambios de horario o precio sin responder: solo propuestas pendientes con impacto y pasado el máximo; se cierran solas al resolverse", async () => {
  const tripWithProposal = async (provinceId: string, input: { minutes: number; price?: boolean; schedule?: boolean; status?: string }) => {
    const trip = await seedTrip(pool, world.driver.id, vehicleId, provinceId, { status: "active", departureAt: minutesAgo(20) });
    const proposal = await seedRouteChangeProposal(pool, {
      tripId: trip,
      createdBy: world.driver.id,
      createdAt: minutesAgo(input.minutes),
      materialPrice: input.price ?? true,
      materialSchedule: input.schedule ?? false,
      status: input.status ?? "pending"
    });
    return { trip, proposal };
  };
  const price = await tripWithProposal(sevilla, { minutes: 31, price: true, schedule: false });
  const both = await tripWithProposal(cadiz, { minutes: 45, price: true, schedule: true });
  await tripWithProposal(sevilla, { minutes: 10 }); //                       reciente: aún dentro del máximo (30)
  await tripWithProposal(sevilla, { minutes: 90, price: false, schedule: false }); // sin impacto de precio ni horario
  await tripWithProposal(sevilla, { minutes: 90, status: "rejected" }); //   ya resuelta

  const res = await evaluate();
  assert.equal(res.status, 200);
  assert.deepEqual(ruleResult(res, "schedule_price_changes"), { kind: "schedule_price_changes", enabled: true, evaluated: true, created: 2, skippedReason: null });
  const items = (await listAlerts({ kind: "schedule_price_changes" })).body.items;
  assert.equal(items.length, 2);
  const priceAlert = items.find((a: any) => a.data.proposalId === price.proposal);
  assert.equal(priceAlert.severity, "warning");
  assert.equal(priceAlert.title, "Cambio de horario o precio sin respuesta");
  assert.equal(priceAlert.body, "Una propuesta de cambio de precio lleva 31 minutos esperando aceptación (máximo: 30).");
  assert.deepEqual(priceAlert.data, { proposalId: price.proposal, tripId: price.trip, pendingMinutes: 31, maxPendingMinutes: 30, priceChange: true, scheduleChange: false });
  assert.deepEqual(priceAlert.province, { id: sevilla, code: "41", name: "Sevilla" });
  const bothAlert = items.find((a: any) => a.data.proposalId === both.proposal);
  assert.match(bothAlert.body, /cambio de horario y precio lleva 45 minutos/);
  assert.equal(bothAlert.province.code, "11");

  assert.equal((await evaluate()).body.created, 0, "sin duplicados");

  // la propuesta se acepta → su alerta deja de tener motivo y se cierra sola
  await pool.query(`update route_change_proposals set status = 'accepted' where id = $1`, [price.proposal]);
  const closing = await evaluate();
  assert.equal(closing.body.created, 0);
  assert.equal(closing.body.autoResolved, 1);
  assert.deepEqual((await listAlerts({ kind: "schedule_price_changes" })).body.items.map((a: any) => a.data.proposalId), [both.proposal]);
  const resolved = (await listAlerts({ status: "resolved" })).body.items;
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].data.proposalId, price.proposal);
  assert.ok(resolved[0].resolvedAt);
  assert.equal((await lastAudit(pool, "admin.alerts.evaluated"))?.metadata.autoResolved, 1);

  // el máximo es configurable: con 5 minutos también salta la de 10 min
  await call(app, "PUT", "/v1/admin/operations", { as: world.admin, body: { rules: [{ kind: "schedule_price_changes", params: { maxPendingMinutes: 5 } }] } });
  assert.equal(ruleResult(await evaluate(), "schedule_price_changes").created, 1);
});

test("evaluador · incidencias en ruta: usa la tabla del módulo live si existe; si no, lo dice (source_unavailable) y no inventa", async () => {
  if (!hasIncidents) {
    const res = await evaluate();
    assert.deepEqual(ruleResult(res, "route_incidents"), { kind: "route_incidents", enabled: true, evaluated: false, created: 0, skippedReason: "source_unavailable" });
    assert.equal((await listAlerts({ status: "all", kind: "route_incidents" })).body.items.length, 0);
    return;
  }
  const trip = await seedTrip(pool, world.driver.id, vehicleId, sevilla, { status: "active", departureAt: minutesAgo(30) });
  const cadizTrip = await seedTrip(pool, world.driver.id, vehicleId, cadiz, { status: "active", departureAt: minutesAgo(30) });
  assert.deepEqual(ruleResult(await evaluate(), "route_incidents"), { kind: "route_incidents", enabled: true, evaluated: true, created: 0, skippedReason: null });

  await seedIncident(pool, { tripId: trip, reporterId: world.rider.id, category: "route_or_schedule", createdAt: minutesAgo(20) });
  await seedIncident(pool, { tripId: trip, reporterId: world.rider.id, category: "route_or_schedule", createdAt: minutesAgo(200) }); // fuera de ventana
  await seedIncident(pool, { tripId: cadizTrip, reporterId: world.rider.id, category: "safety", createdAt: minutesAgo(10) });
  const resolvedIncident = await seedIncident(pool, { tripId: cadizTrip, reporterId: world.rider.id, category: "vehicle", createdAt: minutesAgo(15) });
  await pool.query(`update incident_reports set status = 'resolved', resolved_at = now() where id = $1`, [resolvedIncident]);

  const res = await evaluate();
  assert.equal(ruleResult(res, "route_incidents").created, 2);
  const alerts = (await listAlerts({ kind: "route_incidents" })).body.items;
  const sevillaAlert = alerts.find((a: any) => a.province.code === "41");
  const cadizAlert = alerts.find((a: any) => a.province.code === "11");
  assert.equal(sevillaAlert.severity, "warning");
  assert.equal(sevillaAlert.body, "1 incidencias abiertas en los últimos 60 minutos (umbral: 1).");
  assert.equal(cadizAlert.severity, "critical", "una incidencia de seguridad sube la severidad");
  assert.deepEqual(cadizAlert.data, { count: 1, safetyCount: 1, windowMinutes: 60, thresholdCount: 1 });
  assert.equal((await evaluate()).body.created, 0);
});

test("alertas: listado con filtros, orden y paginación estable; transiciones válidas auditadas; errores tipados", async () => {
  const insert = async (n: number, status: "open" | "acknowledged" | "resolved", kind: string, detectedAt: Date) => {
    const resolvedAt = status === "resolved" ? detectedAt : null;
    const acknowledgedAt = status === "acknowledged" ? detectedAt : null;
    const row = await pool.query<{ id: string }>(
      `insert into trust_admin_alerts(kind, severity, status, dedupe_key, title, body, province_id, data, detected_at, acknowledged_at, resolved_at)
       values($1,'warning',$2,$3,'Alerta de prueba','Cuerpo de prueba',$4,'{}'::jsonb,$5,$6,$7) returning id`,
      [kind, status, `${kind}:${n}:${status}`, sevilla, detectedAt, acknowledgedAt, resolvedAt]
    );
    return row.rows[0]!.id;
  };
  const same = minutesAgo(30); // varias con exactamente el mismo instante: el cursor debe desempatar por id
  const ids = [
    await insert(1, "open", "unusual_cancellations", same),
    await insert(2, "open", "unusual_cancellations", same),
    await insert(3, "open", "route_incidents", same),
    await insert(4, "open", "schedule_price_changes", minutesAgo(10)),
    await insert(5, "acknowledged", "route_incidents", minutesAgo(20)),
    await insert(6, "resolved", "unusual_cancellations", minutesAgo(40))
  ];

  const open = await listAlerts();
  assert.equal(open.status, 200);
  assert.equal(open.body.items.length, 4, "por defecto solo las abiertas");
  assert.equal(open.body.items[0].id, ids[3], "la más reciente primero");
  assert.deepEqual((await listAlerts({ status: "acknowledged" })).body.items.map((a: any) => a.id), [ids[4]]);
  assert.deepEqual((await listAlerts({ status: "resolved" })).body.items.map((a: any) => a.id), [ids[5]]);
  assert.equal((await listAlerts({ status: "all" })).body.items.length, 6);
  assert.equal((await listAlerts({ status: "all", kind: "route_incidents" })).body.items.length, 2);
  assert.equal((await listAlerts({ status: "open", kind: "route_incidents" })).body.items.length, 1);

  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page: any = await listAlerts({ status: "all", limit: 2, ...(cursor ? { cursor } : {}) });
    seen.push(...page.body.items.map((a: any) => a.id));
    cursor = page.body.nextCursor;
    pages += 1;
  } while (cursor && pages < 8);
  assert.equal(pages, 3);
  assert.equal(new Set(seen).size, 6, "ninguna alerta se repite ni se pierde entre páginas");
  assert.deepEqual([...seen].sort(), [...ids].sort());

  assert.equal((await listAlerts({ cursor: "basura" })).body.error.code, "CURSOR_INVALID");
  for (const bad of [{ status: "todas" }, { kind: "otra" }, { limit: 0 }, { limit: 51 }]) assert.equal((await listAlerts(bad)).status, 400, JSON.stringify(bad));
  for (const who of [world.admin, world.finance, world.support]) assert.equal((await listAlerts({}, who)).status, 200);
  for (const who of [world.verification, world.rider, world.driver]) assert.equal((await listAlerts({}, who)).status, 403);

  // transiciones
  const setStatus = (id: string, status: string, as: SeededUser | null = world.admin) =>
    call(app, "POST", `/v1/admin/alerts/${id}/status`, { as, body: { status } });
  const ack = await setStatus(ids[0]!, "acknowledged");
  assert.equal(ack.status, 200);
  assert.equal(ack.body.status, "acknowledged");
  assert.ok(ack.body.acknowledgedAt);
  assert.equal((await pool.query(`select acknowledged_by_user_id from trust_admin_alerts where id = $1`, [ids[0]])).rows[0].acknowledged_by_user_id, world.admin.id);
  assert.deepEqual((await lastAudit(pool, "admin.alert.status_changed"))?.metadata, { from: "open", to: "acknowledged", kind: "unusual_cancellations" });
  const resolved = await setStatus(ids[0]!, "resolved", world.support);
  assert.equal(resolved.status, 200);
  assert.deepEqual([resolved.body.status, resolved.body.acknowledgedAt !== null, resolved.body.resolvedAt !== null], ["resolved", true, true]);
  assert.equal((await setStatus(ids[1]!, "resolved")).status, 200, "open → resolved directo");

  const again = await setStatus(ids[0]!, "resolved");
  assert.deepEqual([again.status, again.body.error.code, again.body.error.details], [409, "ALERT_INVALID_TRANSITION", { from: "resolved", to: "resolved" }]);
  assert.equal((await setStatus(ids[0]!, "acknowledged")).body.error.code, "ALERT_INVALID_TRANSITION");
  assert.equal((await setStatus(ids[4]!, "acknowledged")).body.error.code, "ALERT_INVALID_TRANSITION", "ya reconocida");
  const missing = await setStatus(crypto.randomUUID(), "resolved");
  assert.deepEqual([missing.status, missing.body.error.code], [404, "ALERT_NOT_FOUND"]);
  assert.equal((await setStatus("no-es-uuid", "resolved")).status, 400);
  assert.equal((await setStatus(ids[2]!, "open")).status, 400, "solo acknowledged|resolved");
  assert.equal((await call(app, "POST", `/v1/admin/alerts/${ids[2]}/status`, { as: world.admin, body: {} })).status, 400);
  assert.equal((await pool.query(`select status from trust_admin_alerts where id = $1`, [ids[2]])).rows[0].status, "open", "los intentos fallidos no cambian nada");
  for (const who of [world.finance, world.verification, world.rider, world.driver]) assert.equal((await setStatus(ids[2]!, "resolved", who)).status, 403);
  assert.equal((await setStatus(ids[2]!, "resolved", null)).status, 401);
});

test("evaluador por línea de comandos (run-evaluator.ts): usa solo DATABASE_URL, evalúa con la hora real y audita sin usuario", async () => {
  const trip = await seedTrip(pool, world.driver.id, vehicleId, sevilla, { status: "published", departureAt: new Date(Date.now() + 3 * 3600_000) });
  // eventos reales respecto al reloj real (la CLI no usa el reloj fijo de la prueba)
  for (const m of [1, 2, 3, 4, 5]) {
    await seedBooking(pool, {
      tripId: trip,
      passengerId: world.rider.id,
      status: "cancelled",
      requestedAt: new Date(Date.now() - (m + 5) * 60_000),
      updatedAt: new Date(Date.now() - m * 60_000)
    });
  }
  const run = spawnSync(process.execPath, ["--import", "tsx", path.resolve("src/modules/trust/operations/run-evaluator.ts")], {
    env: { PATH: process.env.PATH ?? "", DATABASE_URL: process.env.DATABASE_URL ?? "" },
    encoding: "utf8",
    timeout: 60_000
  });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.created, 1);
  assert.equal(result.rules.find((r: any) => r.kind === "unusual_cancellations").created, 1);
  assert.equal((await listAlerts()).body.items.length, 1);
  const audit = await lastAudit(pool, "admin.alerts.evaluated");
  assert.equal(audit?.actor_user_id, null);
  assert.equal(audit?.metadata.via, "cli");
  // idempotente: la segunda ejecución no duplica
  const second = spawnSync(process.execPath, ["--import", "tsx", path.resolve("src/modules/trust/operations/run-evaluator.ts")], {
    env: { PATH: process.env.PATH ?? "", DATABASE_URL: process.env.DATABASE_URL ?? "" },
    encoding: "utf8",
    timeout: 60_000
  });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).created, 0);
  // sin base de datos configurada falla con un mensaje claro
  const missingEnv = spawnSync(process.execPath, ["--import", "tsx", path.resolve("src/modules/trust/operations/run-evaluator.ts")], {
    env: { PATH: process.env.PATH ?? "" },
    encoding: "utf8",
    timeout: 60_000
  });
  assert.notEqual(missingEnv.status, 0);
  void seedUser;
});
