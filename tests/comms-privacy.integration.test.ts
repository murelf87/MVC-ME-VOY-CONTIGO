import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { notify } from "../src/lib/notify.js";
import { loadCommsConfig } from "../src/modules/comms/config.js";
import type { DataRightsDeps } from "../src/modules/comms/deps.js";
import { executeDueAccountDeletions } from "../src/modules/comms/account-deletion.js";
import { expireDataExports, processQueuedDataExports } from "../src/modules/comms/data-export.js";
import { runCommsJobsOnce } from "../src/modules/comms/jobs.js";
import {
  registerDeletionBlocker,
  registerErasureStep,
  registerExportContributor,
  resetCommsRegistries
} from "../src/modules/comms/registry.js";
import {
  DisabledStorage,
  FakeEraser,
  FakeStorage,
  PNG_BYTES,
  SEVILLA,
  blockUser,
  buildCommsApp,
  clientFor,
  createPool,
  daysAfter,
  fakeUploadFetch,
  hoursAfter,
  keysOf,
  seedBooking,
  seedTrip,
  seedUser,
  seedVehicle,
  seedWorld,
  truncateAll,
  type Client,
  type World
} from "./comms-support.js";

/**
 * Derechos sobre los datos: exportación (descarga de mis datos) y eliminación de cuenta con periodo de gracia.
 * BD de pruebas propia: mvc_comms.
 */
const uuid = () => crypto.randomUUID();
const expectKeys = (value: unknown, expected: string[]) => assert.deepEqual(keysOf(value), [...expected].sort());

const EXPORT_KEYS = ["id", "status", "format", "requestedAt", "completedAt", "expiresAt", "sizeBytes", "downloadable", "errorCode"];
const STATE_KEYS = ["eligible", "blockers", "graceDays", "request", "plan"];
const REQUEST_KEYS = ["id", "status", "requestedAt", "scheduledFor", "cancelledAt", "completedAt", "blockers"];

describe("comms · derechos sobre los datos", () => {
  let pool: pg.Pool;
  let storage: FakeStorage;
  let eraser: FakeEraser;
  let deps: DataRightsDeps;
  let app: FastifyInstance;
  let world: World;
  let carlos: string;
  let ana: Client;
  let miguel: Client;
  let laura: Client;

  before(async () => {
    pool = createPool();
    storage = new FakeStorage();
    eraser = new FakeEraser(storage);
    const fetchImpl = fakeUploadFetch(storage);
    deps = { pool, config: loadCommsConfig({}), storage, eraser, fetchImpl };
    app = await buildCommsApp(pool, { privateStorage: storage, modules: { eraser, fetchImpl } });
  });

  after(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    resetCommsRegistries();
    storage.objects.clear();
    eraser.deleted = [];
    eraser.failWith = null;
    await truncateAll(pool);
    world = await seedWorld(pool);
    carlos = await seedUser(pool, "Carlos Ruiz", { phone: "+34600777888" });
    ana = await clientFor(app, pool, world.ana);
    miguel = await clientFor(app, pool, world.miguel);
    laura = await clientFor(app, pool, world.laura);
  });

  afterEach(() => resetCommsRegistries());

  /** Viaje COMPLETADO (no bloquea la eliminación) con la reserva de `passenger`. */
  async function completedRide(passenger: string, driver = world.ana, vehicleId = world.vehicleId) {
    const trip = await seedTrip(pool, driver, vehicleId, world.provinceId, {
      status: "completed", departureAt: daysAfter(new Date(), -3), stops: [SEVILLA.santaJusta, SEVILLA.universidad], category: "university"
    });
    const booking = await seedBooking(pool, trip.tripId, passenger, { status: "completed" });
    return { tripId: trip.tripId, bookingId: booking.bookingId! };
  }

  /* ───────────────────────────── Exportación ───────────────────────────── */

  it("exportación: se solicita (202), es única en curso, la genera el trabajo, se descarga con URL firmada y caduca", async () => {
    const requested = await miguel.post("/v1/me/data-exports", {}, { "idempotency-key": "22222222-2222-4222-8222-222222222222" });
    assert.equal(requested.status, 202, requested.raw);
    expectKeys(requested.body, EXPORT_KEYS);
    assert.equal(requested.body.status, "queued");
    assert.equal(requested.body.format, "json");
    assert.equal(requested.body.downloadable, false);
    assert.equal(requested.body.sizeBytes, null);

    // Repetir (con o sin clave) devuelve la misma, sin crear otra.
    const replay = await miguel.post("/v1/me/data-exports", {}, { "idempotency-key": "22222222-2222-4222-8222-222222222222" });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.id, requested.body.id);
    const again = await miguel.post("/v1/me/data-exports");
    assert.equal(again.status, 200);
    assert.equal(again.body.id, requested.body.id);
    assert.equal((await pool.query(`select 1 from data_export_requests`)).rowCount, 1);

    // Aún no está lista.
    const early = await miguel.get(`/v1/me/data-exports/${requested.body.id}/download`);
    assert.equal(early.status, 409);
    assert.equal(early.body.error.code, "EXPORT_NOT_READY");

    // Ajena o inexistente: 404 y nada se filtra.
    for (const path of [`/v1/me/data-exports/${requested.body.id}`, `/v1/me/data-exports/${requested.body.id}/download`]) {
      const foreign = await laura.get(path);
      assert.equal(foreign.status, 404, path);
      assert.equal(foreign.body.error.code, "EXPORT_NOT_FOUND");
    }
    assert.equal((await miguel.get(`/v1/me/data-exports/${uuid()}`)).status, 404);
    assert.deepEqual((await laura.get("/v1/me/data-exports")).body.items, []);

    // El trabajo la genera y la sube por URL firmada.
    const summary = await processQueuedDataExports(deps);
    assert.deepEqual(summary, { processed: 1, ready: 1, failed: 0, blocked: 0, retried: 0 });
    const ready = await miguel.get(`/v1/me/data-exports/${requested.body.id}`);
    assert.equal(ready.body.status, "ready");
    assert.equal(ready.body.downloadable, true);
    assert.ok(ready.body.sizeBytes > 500);
    assert.ok(ready.body.expiresAt && ready.body.completedAt);
    const hours = (new Date(ready.body.expiresAt).getTime() - new Date(ready.body.completedAt).getTime()) / 3_600_000;
    assert.ok(Math.abs(hours - 168) < 0.1, "caduca a los 7 días");
    const key = `users/${world.miguel}/exports/${requested.body.id}.json`;
    assert.ok(storage.objects.has(key));
    assert.equal(storage.objects.get(key)!.bytes.byteLength, ready.body.sizeBytes);
    const sha = (await pool.query(`select sha256 from data_export_requests where id = $1`, [requested.body.id])).rows[0].sha256;
    assert.equal(sha, crypto.createHash("sha256").update(storage.objects.get(key)!.bytes).digest("hex"));
    const notice = (await miguel.get("/v1/notifications")).body.items.find((n: { kind: string }) => n.kind === "data_export_ready");
    assert.ok(notice);
    assert.equal(notice.data.exportId, requested.body.id);

    const download = await miguel.get(`/v1/me/data-exports/${requested.body.id}/download`);
    assert.equal(download.status, 200);
    expectKeys(download.body, ["url", "expiresAt"]);
    assert.ok(download.body.url.startsWith(`https://download.invalid/${key}`));
    assert.equal((await pool.query(`select 1 from audit_events where action = 'privacy.export.downloaded' and actor_user_id = $1`, [world.miguel])).rowCount, 1);
    assert.equal((await laura.get(`/v1/me/data-exports/${requested.body.id}/download`)).status, 404);

    // Una completada en las últimas 24 h bloquea otra nueva.
    const limited = await miguel.post("/v1/me/data-exports");
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, "EXPORT_RATE_LIMITED");

    // Caducidad: deja de ser descargable y el trabajo retira el archivo del almacenamiento.
    await pool.query(`update data_export_requests set expires_at = now() - interval '1 minute' where id = $1`, [requested.body.id]);
    const expiredView = await miguel.get(`/v1/me/data-exports/${requested.body.id}`);
    assert.equal(expiredView.body.status, "expired");
    assert.equal(expiredView.body.downloadable, false);
    const gone = await miguel.get(`/v1/me/data-exports/${requested.body.id}/download`);
    assert.equal(gone.status, 410);
    assert.equal(gone.body.error.code, "EXPORT_EXPIRED");
    assert.deepEqual(await expireDataExports(deps), { expired: 1 });
    assert.ok(eraser.deleted.includes(key));
    assert.ok(!storage.objects.has(key));
    const row = await pool.query(`select status, storage_key from data_export_requests where id = $1`, [requested.body.id]);
    assert.deepEqual(row.rows[0], { status: "expired", storage_key: null });
    assert.deepEqual(await expireDataExports(deps), { expired: 0 });

    // Tras caducar se puede pedir otra.
    assert.equal((await miguel.post("/v1/me/data-exports")).status, 202);
  });

  it("contenido de la exportación: solo los datos de la persona (sin teléfonos ni mensajes ajenos) y con lo que falta declarado", async () => {
    // Miguel tiene datos de todo tipo: reserva, chat, grupo, aviso, ticket con imagen, dispositivo, bloqueo, denuncia y ajustes.
    const tripMon = (await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, { kind: "recurring", departureAt: hoursAfter(new Date(), 30) })).tripId;
    await seedBooking(pool, tripMon, world.miguel);
    await seedBooking(pool, tripMon, world.laura);
    const inbox = (await miguel.get("/v1/conversations")).body.items;
    const direct = inbox.find((c: { kind: string }) => c.kind === "direct");
    const group = inbox.find((c: { kind: string }) => c.kind === "group");
    await ana.post(`/v1/conversations/${direct.id}/messages`, { clientMessageId: uuid(), body: "Hola Miguel, te recojo en Sevilla Centro" });
    await miguel.post(`/v1/conversations/${direct.id}/messages`, { clientMessageId: uuid(), body: "Perfecto, gracias Ana" });
    await miguel.post(`/v1/conversations/${direct.id}/messages`, { clientMessageId: uuid(), kind: "location", location: { lat: 37.39, lng: -5.98, label: "Mi portal" } });
    await laura.post(`/v1/conversations/${group.id}/messages`, { clientMessageId: uuid(), body: "Mensaje de Laura en el grupo" });
    await miguel.post(`/v1/conversations/${group.id}/messages`, { clientMessageId: uuid(), body: "Mensaje de Miguel en el grupo" });
    await laura.post("/v1/me/support/tickets", { category: "payment_issue", body: "Consulta SECRETA de Laura" });
    await notify(pool, { userId: world.laura, category: "payment", kind: "payment_completed", title: "Pago de Laura", body: "Importe privado de Laura" });
    const intent = await miguel.post("/v1/me/support/uploads/intents", { contentType: "image/png", sizeBytes: PNG_BYTES.byteLength });
    storage.put(new URL(intent.body.uploadUrl).pathname.slice(1), PNG_BYTES, "image/png");
    const attachment = await miguel.post(`/v1/me/support/uploads/${intent.body.intentId}/complete`);
    await miguel.post("/v1/me/support/tickets", { category: "trip_issue", body: "Mi consulta con foto", attachmentIds: [attachment.body.id] });
    await miguel.post("/v1/me/push-tokens", { token: "ExponentPushToken[miguelDevice0000001]", platform: "ios", provider: "expo", deviceId: "iphone-miguel" });
    await miguel.patch("/v1/me/settings", { fontScale: "large" });
    await miguel.patch("/v1/me/notification-preferences", { arrivalAlerts: false });
    await blockUser(pool, world.miguel, carlos);
    await miguel.post("/v1/me/reports", { reportedUserId: world.laura, reason: "spam_or_fraud", conversationId: group.id, evidenceMessageIds: [] });
    const report = await miguel.post(`/v1/conversations/${direct.id}/messages/${(await miguel.get(`/v1/conversations/${direct.id}/messages`)).body.items[0].id}/report`, { reason: "inappropriate_content" });
    assert.equal(report.status, 201, report.raw);

    assert.equal((await miguel.post("/v1/me/data-exports")).status, 202);
    assert.equal((await processQueuedDataExports(deps)).ready, 1);
    const exportId = (await miguel.get("/v1/me/data-exports")).body.items[0].id;
    const file = storage.objects.get(`users/${world.miguel}/exports/${exportId}.json`)!;
    const text = new TextDecoder().decode(file.bytes);
    const data = JSON.parse(text);

    assert.equal(data.schemaVersion, 1);
    assert.ok(!Number.isNaN(Date.parse(data.generatedAt)));
    assert.equal(data.subject.id, world.miguel);
    assert.equal(data.subject.phoneE164, "+34600333444", "su propio teléfono sí");
    assert.equal(data.profile.displayName, "Miguel Torres");
    assert.equal(data.settings.fontScale, "large");
    assert.equal(data.notificationPreferences.arrivalAlerts, false);
    assert.equal(data.notificationPreferences.essentialTripNotices, true);
    assert.equal(data.ridesAsPassenger.length, 1);
    assert.equal(data.ridesAsPassenger[0].tripId, tripMon);
    assert.equal(data.tripsAsDriver.length, 0);
    assert.equal(data.pushDevices.length, 1);
    assert.ok(!text.includes("miguelDevice0000001"), "el token push no se exporta");
    assert.equal(data.blocks.length, 1);
    assert.equal(data.blocks[0].blockedUserDisplayName, "Carlos Ruiz");

    const directExport = data.conversations.items.find((c: { kind: string }) => c.kind === "direct");
    assert.equal(directExport.peerDisplayName, "Ana García López");
    assert.deepEqual(
      directExport.messages.map((m: { direction: string; body: string | null; kind: string }) => [m.direction, m.kind, m.body]),
      [["received", "text", "Hola Miguel, te recojo en Sevilla Centro"], ["sent", "text", "Perfecto, gracias Ana"], ["sent", "location", "Mi portal"]]
    );
    assert.deepEqual(directExport.messages[2].location, { lat: 37.39, lng: -5.98, label: "Mi portal" });
    const groupExport = data.conversations.items.find((c: { kind: string }) => c.kind === "group");
    assert.deepEqual(groupExport.messages.map((m: { body: string }) => m.body).sort(), ["Mensaje de Laura en el grupo", "Mensaje de Miguel en el grupo"]);

    assert.equal(data.supportTickets.length, 1);
    assert.equal(data.supportTickets[0].body, "Mi consulta con foto");
    assert.equal(data.supportTickets[0].attachments.length, 1);
    assert.ok(!text.includes("users/"), "ninguna clave de almacenamiento privado");
    assert.equal(data.reportsFiled.length, 2, "la denuncia a Laura y la denuncia de un mensaje de Ana");
    const reportOfAna = data.reportsFiled.find((r: { reportedUserDisplayName: string }) => r.reportedUserDisplayName === "Ana García López");
    const reportOfLaura = data.reportsFiled.find((r: { reportedUserDisplayName: string }) => r.reportedUserDisplayName === "Laura Pérez");
    assert.equal(reportOfAna.evidence.length, 1, "el mensaje denunciado queda como prueba");
    assert.equal(reportOfLaura.evidence.length, 0);
    assert.ok(!("reportedUserId" in reportOfAna) && !("reporterUserId" in reportOfAna), "solo el nombre público de la persona denunciada");
    assert.ok(data.activityLog.items.length >= 3);
    assert.ok(data.notifications.some((n: { kind: string }) => n.kind === "chat_message"));

    // Lo ajeno no está: ni teléfonos de otras personas, ni sus avisos, ni sus consultas.
    for (const secret of ["+34600111222", "+34600555666", "+34600777888", "Consulta SECRETA", "Importe privado de Laura", "Pago de Laura"]) {
      assert.ok(!text.includes(secret), `la exportación no debe contener «${secret}»`);
    }

    // Lo que otros módulos aún no aportan se declara, no se calla; al registrarse su sección deja de listarse.
    assert.deepEqual(
      data.notIncluded.map((s: { section: string }) => s.section.split(",")[0]).sort(),
      ["Lugares favoritos", "Pagos", "Revisión de identidad", "Valoraciones"].sort()
    );
    assert.deepEqual(data.modules, {});
    registerExportContributor({ name: "money", build: async (_db, userId) => ({ receipts: [], owner: userId }) });
    await pool.query(`update data_export_requests set requested_at = now() - interval '2 days'`);
    assert.equal((await miguel.post("/v1/me/data-exports")).status, 202);
    assert.equal((await processQueuedDataExports(deps)).ready, 1);
    const second = (await miguel.get("/v1/me/data-exports")).body.items[0];
    const secondData = JSON.parse(new TextDecoder().decode(storage.objects.get(`users/${world.miguel}/exports/${second.id}.json`)!.bytes));
    assert.deepEqual(secondData.modules.money, { receipts: [], owner: world.miguel });
    assert.equal(secondData.notIncluded.length, 3);
    assert.ok(!secondData.notIncluded.some((s: { section: string }) => s.section.startsWith("Pagos")));
  });

  it("exportación sin almacenamiento privado: queda «bloqueada» con su motivo y no se genera ni se entrega nada", async () => {
    const disabledApp = await buildCommsApp(pool, { privateStorage: new DisabledStorage() });
    try {
      const client = await clientFor(disabledApp, pool, world.miguel);
      const blocked = await client.post("/v1/me/data-exports");
      assert.equal(blocked.status, 202, blocked.raw);
      assert.equal(blocked.body.status, "blocked_storage_disabled");
      assert.equal(blocked.body.errorCode, "PRIVATE_STORAGE_NOT_CONFIGURED");
      assert.equal(blocked.body.downloadable, false);
      const download = await client.get(`/v1/me/data-exports/${blocked.body.id}/download`);
      assert.equal(download.status, 409);
      assert.equal(download.body.error.code, "EXPORT_NOT_READY");
      assert.equal(storage.objects.size, 0);
    } finally {
      await disabledApp.close();
    }

    // Una petición en cola cuando el almacenamiento se desactiva tampoco genera nada.
    await pool.query(`delete from data_export_requests`);
    assert.equal((await miguel.post("/v1/me/data-exports")).status, 202);
    const summary = await processQueuedDataExports({ ...deps, storage: new DisabledStorage() });
    assert.deepEqual(summary, { processed: 1, ready: 0, failed: 0, blocked: 1, retried: 0 });
    assert.equal((await pool.query(`select status from data_export_requests`)).rows[0].status, "blocked_storage_disabled");
    assert.equal(storage.objects.size, 0);
  });

  it("exportación: reintenta los fallos de subida, termina en «failed» y se puede pedir de nuevo; recupera trabajos abandonados", async () => {
    const failing: DataRightsDeps = { ...deps, fetchImpl: fakeUploadFetch(storage, { status: 500 }) };
    assert.equal((await miguel.post("/v1/me/data-exports")).status, 202);
    assert.deepEqual(await processQueuedDataExports(failing), { processed: 1, ready: 0, failed: 0, blocked: 0, retried: 1 });
    let row = (await pool.query(`select status, attempts, error_code from data_export_requests`)).rows[0];
    assert.deepEqual(row, { status: "queued", attempts: 1, error_code: "EXPORT_UPLOAD_FAILED_500" });
    await processQueuedDataExports(failing);
    const last = await processQueuedDataExports(failing);
    assert.equal(last.failed, 1);
    row = (await pool.query(`select status, attempts, error_code from data_export_requests`)).rows[0];
    assert.deepEqual(row, { status: "failed", attempts: 3, error_code: "EXPORT_UPLOAD_FAILED_500" });
    const failed = (await miguel.get("/v1/me/data-exports")).body.items[0];
    assert.equal(failed.status, "failed");
    assert.equal(failed.downloadable, false);

    // Una fallida no cuenta para el límite de 24 h.
    const retry = await miguel.post("/v1/me/data-exports");
    assert.equal(retry.status, 202);
    assert.notEqual(retry.body.id, failed.id);

    // Un trabajo «processing» abandonado (la réplica murió) vuelve a la cola y se completa.
    await pool.query(`update data_export_requests set status = 'processing', started_at = now() - interval '20 minutes', attempts = 1 where id = $1`, [retry.body.id]);
    const recovered = await processQueuedDataExports(deps);
    assert.equal(recovered.ready, 1);
    assert.equal((await pool.query(`select status from data_export_requests where id = $1`, [retry.body.id])).rows[0].status, "ready");
  });

  /* ───────────────────────────── Eliminación de cuenta ───────────────────────────── */

  it("estado de la eliminación: elegible, con el plan de qué se borra, anonimiza y conserva, y con los bloqueos reales", async () => {
    const clean = await laura.get("/v1/me/account-deletion");
    assert.equal(clean.status, 200);
    expectKeys(clean.body, STATE_KEYS);
    assert.equal(clean.body.eligible, true);
    assert.deepEqual(clean.body.blockers, []);
    assert.equal(clean.body.graceDays, 14);
    assert.equal(clean.body.request, null);
    expectKeys(clean.body.plan, ["deleted", "anonymised", "retained"]);
    assert.ok(clean.body.plan.deleted.length >= 4 && clean.body.plan.anonymised.length >= 1);
    expectKeys(clean.body.plan.retained[0], ["item", "reason", "period"]);
    assert.ok(clean.body.plan.retained.some((r: { item: string }) => /pago/i.test(r.item)), "se avisa de lo que se conserva por ley");

    // Conductora con un viaje publicado → bloqueo; pasajero con reserva confirmada futura → bloqueo.
    const trip = await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, { departureAt: daysAfter(new Date(), 2) });
    await seedBooking(pool, trip.tripId, world.miguel);
    const driver = await ana.get("/v1/me/account-deletion");
    assert.equal(driver.body.eligible, false);
    assert.deepEqual(driver.body.blockers.map((b: { code: string }) => b.code), ["ACTIVE_TRIP_AS_DRIVER"]);
    expectKeys(driver.body.blockers[0], ["code", "message", "count"]);
    assert.equal(driver.body.blockers[0].count, 1);
    assert.match(driver.body.blockers[0].message, /viaje/);
    assert.deepEqual((await miguel.get("/v1/me/account-deletion")).body.blockers.map((b: { code: string }) => b.code), ["UPCOMING_BOOKING_AS_PASSENGER"]);

    // Solicitud abierta y compensación de pago pendiente.
    const other = await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, { departureAt: daysAfter(new Date(), 3) });
    const open = await seedBooking(pool, other.tripId, world.laura, { requestStatus: "pending" });
    assert.deepEqual((await laura.get("/v1/me/account-deletion")).body.blockers.map((b: { code: string }) => b.code), ["OPEN_RIDE_REQUEST"]);
    await pool.query(`update ride_requests set status = 'cancelled' where id = $1`, [open.requestId]);
    const cancelledRequest = await seedBooking(pool, other.tripId, carlos, { requestStatus: "confirmed" });
    await pool.query(
      `insert into payment_compensations(request_id, provider_payment_id, amount_cents, reason, action, status) values($1,'pay-comp-1',400,'hold_expired','refund_required','pending')`,
      [cancelledRequest.requestId]
    );
    await pool.query(`update bookings set status = 'cancelled' where request_id = $1`, [cancelledRequest.requestId]);
    const carlosClient = await clientFor(app, pool, carlos);
    assert.deepEqual((await carlosClient.get("/v1/me/account-deletion")).body.blockers.map((b: { code: string }) => b.code), ["PENDING_PAYMENT_COMPENSATION"]);

    // Otros módulos registran sus propios bloqueos (pagos pendientes de liquidar, etc.).
    registerDeletionBlocker({
      name: "money",
      check: async (_db, userId) => (userId === world.laura ? [{ code: "UNSETTLED_PAYOUT", message: "Tienes una liquidación pendiente.", count: 1 }] : [])
    });
    const withModule = await laura.get("/v1/me/account-deletion");
    assert.equal(withModule.body.eligible, false);
    assert.deepEqual(withModule.body.blockers, [{ code: "UNSETTLED_PAYOUT", message: "Tienes una liquidación pendiente.", count: 1 }]);
    assert.equal((await miguel.get("/v1/me/account-deletion")).body.blockers.some((b: { code: string }) => b.code === "UNSETTLED_PAYOUT"), false);
    assert.equal((await app.inject({ method: "GET", url: "/v1/me/account-deletion" })).statusCode, 401);
  });

  it("solicitar, repetir y cancelar la eliminación: confirmación obligatoria, bloqueos con detalle, periodo de gracia y cuenta operativa", async () => {
    const wrong = await laura.post("/v1/me/account-deletion", { confirmation: "eliminar" });
    assert.equal(wrong.status, 422);
    assert.equal(wrong.body.error.code, "ACCOUNT_DELETION_CONFIRMATION_REQUIRED");
    assert.equal((await laura.post("/v1/me/account-deletion", {})).status, 400);
    assert.equal((await pool.query(`select 1 from account_deletion_requests`)).rowCount, 0);

    // Con bloqueos: 409 con la lista, sin crear nada.
    const trip = await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, { departureAt: daysAfter(new Date(), 2) });
    await seedBooking(pool, trip.tripId, world.miguel);
    const blocked = await miguel.post("/v1/me/account-deletion", { confirmation: "ELIMINAR" });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, "ACCOUNT_DELETION_BLOCKED");
    assert.deepEqual(blocked.body.error.details.blockers.map((b: { code: string }) => b.code), ["UPCOMING_BOOKING_AS_PASSENGER"]);
    assert.equal((await pool.query(`select 1 from account_deletion_requests`)).rowCount, 0);

    // Sin bloqueos: se programa con periodo de gracia.
    const before = Date.now();
    const scheduled = await laura.post("/v1/me/account-deletion", { confirmation: "ELIMINAR", reason: "Ya no uso la aplicación" });
    assert.equal(scheduled.status, 201, scheduled.raw);
    expectKeys(scheduled.body, STATE_KEYS);
    expectKeys(scheduled.body.request, REQUEST_KEYS);
    assert.equal(scheduled.body.request.status, "scheduled");
    assert.equal(scheduled.body.request.cancelledAt, null);
    const graceDays = (new Date(scheduled.body.request.scheduledFor).getTime() - before) / 86_400_000;
    assert.ok(Math.abs(graceDays - 14) < 0.01, `14 días de gracia (${graceDays})`);
    const notice = (await laura.get("/v1/notifications")).body.items.find((n: { kind: string }) => n.kind === "account_deletion_scheduled");
    assert.ok(notice);
    assert.equal(notice.essential, true);
    assert.equal((await laura.get("/v1/me/settings")).body.account.pendingDeletion.requestId, scheduled.body.request.id);
    assert.equal((await pool.query(`select 1 from audit_events where action = 'account.deletion.requested' and actor_user_id = $1`, [world.laura])).rowCount, 1);

    // Durante la gracia la cuenta sigue operativa y repetir devuelve la misma solicitud.
    assert.equal((await laura.get("/v1/me/settings")).status, 200);
    const repeat = await laura.post("/v1/me/account-deletion", { confirmation: "ELIMINAR" });
    assert.equal(repeat.status, 200);
    assert.equal(repeat.body.request.id, scheduled.body.request.id);
    assert.equal((await pool.query(`select 1 from account_deletion_requests`)).rowCount, 1);
    assert.equal((await pool.query(`select 1 from app_users where id = $1 and status = 'active'`, [world.laura])).rowCount, 1);

    // Cancelar: la cuenta vuelve a lo de antes; cancelar de nuevo no tiene nada que cancelar.
    const cancelled = await laura.post("/v1/me/account-deletion/cancel");
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.request.status, "cancelled");
    assert.ok(cancelled.body.request.cancelledAt);
    assert.equal((await laura.get("/v1/me/settings")).body.account.pendingDeletion, null);
    const nothing = await laura.post("/v1/me/account-deletion/cancel");
    assert.equal(nothing.status, 404);
    assert.equal(nothing.body.error.code, "ACCOUNT_DELETION_NOT_FOUND");
    assert.equal((await miguel.post("/v1/me/account-deletion/cancel")).status, 404, "no se puede cancelar la de otra persona");
    const again = await laura.post("/v1/me/account-deletion", { confirmation: "ELIMINAR" });
    assert.equal(again.status, 201);
    assert.notEqual(again.body.request.id, scheduled.body.request.id);

    // Si ya está en curso no se puede cancelar.
    await pool.query(`update account_deletion_requests set status = 'processing' where id = $1`, [again.body.request.id]);
    const inProgress = await laura.post("/v1/me/account-deletion/cancel");
    assert.equal(inProgress.status, 409);
    assert.equal(inProgress.body.error.code, "ACCOUNT_DELETION_IN_PROGRESS");
  });

  /** Laura con datos de todo tipo, sin ningún bloqueo de eliminación. */
  async function richLaura() {
    const lauraVehicle = await seedVehicle(pool, world.laura, "5678 LCD");
    await pool.query(`insert into user_roles(user_id, role) values($1,'driver') on conflict do nothing`, [world.laura]);
    const document = (
      await pool.query<{ id: string }>(
        `insert into private_documents(owner_user_id, vehicle_id, kind, storage_provider, storage_key, content_type, size_bytes, sha256)
         values($1,$2,'vehicle_insurance','fake',$3,'image/png',20,$4) returning id`,
        [world.laura, lauraVehicle, "docs/laura-insurance.png", "a".repeat(64)]
      )
    ).rows[0]!.id;
    await pool.query(`update vehicles set insurance_document_id = $2, insurance_expires_on = '2027-01-01' where id = $1`, [lauraVehicle, document]);
    await pool.query(`update profiles set private_selfie_key = $2 where user_id = $1`, [world.laura, "selfies/laura.jpg"]);
    storage.put("docs/laura-insurance.png", PNG_BYTES, "image/png");
    storage.put("selfies/laura.jpg", PNG_BYTES, "image/jpeg");
    storage.put(`profiles/${world.laura}.jpg`, PNG_BYTES, "image/jpeg");

    // Viajes completados: conduce uno con Miguel y viaja en otro con Ana (hilo de chat con mensajes de las dos).
    const lauraTrip = await seedTrip(pool, world.laura, lauraVehicle, world.provinceId, { status: "completed", departureAt: daysAfter(new Date(), -4) });
    await seedBooking(pool, lauraTrip.tripId, world.miguel, { status: "completed" });
    const ride = await completedRide(world.laura);
    const chat = (await laura.get("/v1/conversations")).body.items.find((c: { tripId: string; kind: string }) => c.kind === "direct" && c.tripId === ride.tripId);
    assert.ok(chat, "chat de la reserva completada");
    await laura.post(`/v1/conversations/${chat.id}/messages`, { clientMessageId: uuid(), body: "Hola Ana, mi dirección es Calle Feria 12" });
    await ana.post(`/v1/conversations/${chat.id}/messages`, { clientMessageId: uuid(), body: "Recibido, Laura" });
    await laura.post(`/v1/conversations/${chat.id}/messages`, { clientMessageId: uuid(), kind: "location", location: { lat: 37.4, lng: -5.99, label: "Mi casa" } });
    const groupId = (
      await pool.query<{ id: string }>(`insert into chat_conversations(kind, driver_user_id, route_key) values('group',$1,'ruta-historica') returning id`, [world.ana])
    ).rows[0]!.id;
    await pool.query(`insert into chat_participants(conversation_id, user_id) values($1,$2)`, [groupId, world.laura]);
    await pool.query(`insert into chat_group_messages(conversation_id, sender_user_id, client_message_id, body) values($1,$2,$3,'Mensaje de grupo de Laura')`, [groupId, world.laura, uuid()]);

    // Ayuda: consulta con imagen enviada; subida pendiente; exportación lista; dispositivo; ajustes; bloqueo; denuncia.
    const intent = await laura.post("/v1/me/support/uploads/intents", { contentType: "image/png", sizeBytes: PNG_BYTES.byteLength });
    const attachmentKey = new URL(intent.body.uploadUrl).pathname.slice(1);
    storage.put(attachmentKey, PNG_BYTES, "image/png");
    const attachment = await laura.post(`/v1/me/support/uploads/${intent.body.intentId}/complete`);
    const ticket = await laura.post("/v1/me/support/tickets", { category: "account_profile", body: "Mi DNI es 12345678Z, corrígelo", attachmentIds: [attachment.body.id] });
    assert.equal(ticket.status, 201, ticket.raw);
    const pending = await laura.post("/v1/me/support/uploads/intents", { contentType: "image/jpeg", sizeBytes: 100 });
    const pendingKey = new URL(pending.body.uploadUrl).pathname.slice(1);
    storage.put(pendingKey, PNG_BYTES, "image/jpeg");
    await laura.post("/v1/me/data-exports");
    await processQueuedDataExports(deps);
    const exportKey = (await pool.query<{ storage_key: string }>(`select storage_key from data_export_requests where user_id = $1`, [world.laura])).rows[0]!.storage_key;
    await laura.post("/v1/me/push-tokens", { token: "ExponentPushToken[lauraDevice00000001]", platform: "android", provider: "expo" });
    await laura.patch("/v1/me/settings", { fontScale: "large" });
    await laura.patch("/v1/me/notification-preferences", { arrivalAlerts: false });
    await blockUser(pool, world.laura, carlos);
    await notify(pool, { userId: world.laura, category: "payment", kind: "payment_completed", title: "Pago completado", body: "4,00 € a Ana" });
    const report = await laura.post(`/v1/conversations/${chat.id}/messages/${(await laura.get(`/v1/conversations/${chat.id}/messages`)).body.items.find((m: { mine: boolean }) => !m.mine).id}/report`, { reason: "other", details: "Prueba de retención" });
    assert.equal(report.status, 201, report.raw);
    const sessionBefore = await pool.query(`select count(*)::int as n from auth_sessions where user_id = $1 and revoked_at is null`, [world.laura]);
    assert.ok(sessionBefore.rows[0].n >= 1);
    return { lauraVehicle, document, chat: chat.id as string, groupId, ticketId: ticket.body.id as string, reportId: report.body.id as string, keys: { attachmentKey, pendingKey, exportKey } };
  }

  it("eliminación ejecutada tras el periodo de gracia: borra o anonimiza lo suyo, conserva lo que debe y deja intacto lo de las demás personas", async () => {
    const rich = await richLaura();
    const scheduled = await laura.post("/v1/me/account-deletion", { confirmation: "ELIMINAR", reason: "Ya no uso la aplicación" });
    assert.equal(scheduled.status, 201, scheduled.raw);
    const requestId = scheduled.body.request.id;

    // Antes de que acabe la gracia no se ejecuta nada.
    assert.deepEqual(await executeDueAccountDeletions(deps, new Date()), { processed: 0, completed: 0, blocked: 0, failed: 0 });
    assert.equal((await pool.query(`select status from app_users where id = $1`, [world.laura])).rows[0].status, "active");

    const result = await executeDueAccountDeletions(deps, daysAfter(new Date(), 15));
    assert.deepEqual(result, { processed: 1, completed: 1, blocked: 0, failed: 0 });
    assert.deepEqual(await executeDueAccountDeletions(deps, daysAfter(new Date(), 16)), { processed: 0, completed: 0, blocked: 0, failed: 0 }, "no se repite");

    // Cuenta: anonimizada, sin teléfono ni roles, sesiones revocadas y token inservible.
    const user = (await pool.query(`select status::text as status, phone_e164 from app_users where id = $1`, [world.laura])).rows[0];
    assert.deepEqual(user, { status: "deleted", phone_e164: null });
    assert.equal((await pool.query(`select 1 from user_roles where user_id = $1`, [world.laura])).rowCount, 0);
    assert.equal((await pool.query(`select 1 from auth_sessions where user_id = $1 and revoked_at is null`, [world.laura])).rowCount, 0);
    assert.equal((await laura.get("/v1/notifications")).status, 401);
    const profile = (await pool.query(`select display_name, public_photo_key, private_selfie_key, presence_status from profiles where user_id = $1`, [world.laura])).rows[0];
    assert.deepEqual(profile, { display_name: null, public_photo_key: null, private_selfie_key: null, presence_status: null });

    // Objetos privados borrados del almacenamiento (documento, selfie, foto, adjunto, subida pendiente, exportación).
    for (const key of ["docs/laura-insurance.png", "selfies/laura.jpg", `profiles/${world.laura}.jpg`, rich.keys.attachmentKey, rich.keys.pendingKey, rich.keys.exportKey]) {
      assert.ok(eraser.deleted.includes(key), `se borra ${key}`);
      assert.ok(!storage.objects.has(key), `ya no existe ${key}`);
    }
    assert.equal((await pool.query(`select 1 from private_documents where owner_user_id = $1`, [world.laura])).rowCount, 0);
    assert.equal((await pool.query(`select 1 from support_attachments where owner_user_id = $1`, [world.laura])).rowCount, 0);

    // Vehículo anonimizado: la matrícula queda libre y no se identifica a la persona.
    const vehicle = (await pool.query(`select make, model, plate, insurance_document_id, insurance_expires_on from vehicles where id = $1`, [rich.lauraVehicle])).rows[0];
    assert.equal(vehicle.make, "Eliminado");
    assert.match(vehicle.plate, /^ELIM-/);
    assert.equal(vehicle.insurance_document_id, null);
    assert.equal(vehicle.insurance_expires_on, null);
    await seedVehicle(pool, world.ana, "5678 LCD");

    // Mensajes: se borra el contenido, el hilo de Ana sigue y ella ve «Usuario eliminado».
    assert.deepEqual(
      (await pool.query(`select body, kind from trip_direct_messages where sender_user_id = $1 order by seq`, [world.laura])).rows,
      [{ body: "[Mensaje eliminado]", kind: "text" }, { body: "[Mensaje eliminado]", kind: "text" }]
    );
    assert.equal((await pool.query(`select body from chat_group_messages where sender_user_id = $1`, [world.laura])).rows[0].body, "[Mensaje eliminado]");
    const thread = await ana.get(`/v1/conversations/${rich.chat}/messages`);
    assert.equal(thread.status, 200, thread.raw);
    const fromLaura = thread.body.items.filter((m: { senderId: string }) => m.senderId === world.laura);
    assert.equal(fromLaura.length, 2);
    assert.ok(fromLaura.every((m: { senderName: string; body: string; location: unknown }) => m.senderName === "Usuario eliminado" && m.body === "[Mensaje eliminado]" && m.location === null));
    assert.ok(thread.body.items.some((m: { body: string }) => m.body === "Recibido, Laura"), "los mensajes de Ana no se tocan");
    assert.ok(!thread.raw.includes("Calle Feria"));
    const anaInbox = (await ana.get("/v1/conversations")).body.items.find((c: { id: string }) => c.id === rich.chat);
    assert.equal(anaInbox.peer.displayName, "Usuario eliminado");

    // Ayuda: texto borrado y consulta cerrada, sin adjuntos.
    const ticket = (await pool.query(`select body, status::text as status, closed_at from support_tickets where id = $1`, [rich.ticketId])).rows[0];
    assert.equal(ticket.body, "[Consulta eliminada]");
    assert.equal(ticket.status, "closed");
    assert.ok(ticket.closed_at);
    assert.equal((await pool.query(`select body from support_ticket_messages where ticket_id = $1`, [rich.ticketId])).rows[0].body, "[Mensaje eliminado]");

    // Preferencias, avisos, dispositivos, bloqueos y ajustes: fuera.
    const erasedTables: ReadonlyArray<readonly [table: string, ownerColumn: string]> = [
      ["notifications", "user_id"],
      ["push_tokens", "user_id"],
      ["notification_preferences", "user_id"],
      ["user_settings", "user_id"],
      ["support_upload_intents", "owner_user_id"]
    ];
    for (const [table, ownerColumn] of erasedTables) {
      assert.equal((await pool.query(`select 1 from ${table} where ${ownerColumn} = $1`, [world.laura])).rowCount, 0, table);
    }
    assert.equal((await pool.query(`select 1 from user_blocks where blocker_user_id = $1`, [world.laura])).rowCount, 0);
    assert.equal((await pool.query(`select 1 from chat_participants where user_id = $1`, [world.laura])).rowCount, 0);

    // Se conserva (obligación legal / seguridad): la denuncia con su prueba, la auditoría, y la solicitud con un resumen sin datos personales.
    assert.equal((await pool.query(`select 1 from user_reports where id = $1`, [rich.reportId])).rowCount, 1);
    assert.equal((await pool.query(`select 1 from user_report_evidence where report_id = $1`, [rich.reportId])).rowCount, 1);
    assert.ok((await pool.query(`select 1 from audit_events where actor_user_id = $1`, [world.laura])).rowCount! > 0);
    const completed = (await pool.query(`select status, reason, completed_at, erasure_summary from account_deletion_requests where id = $1`, [requestId])).rows[0];
    assert.equal(completed.status, "completed");
    assert.equal(completed.reason, null, "el motivo escrito por la persona también se borra");
    assert.ok(completed.completed_at);
    assert.equal(completed.erasure_summary.sessionsRevoked >= 1, true);
    assert.equal(completed.erasure_summary.directMessagesErased, 2);
    assert.equal(completed.erasure_summary.storageObjectsDeleted, 6);
    const auditJson = JSON.stringify((await pool.query(`select metadata from audit_events where action like 'account.deletion.%'`)).rows);
    assert.ok(!auditJson.includes("Calle Feria") && !auditJson.includes("12345678Z") && !auditJson.includes("+34600555666"), "la auditoría no lleva datos personales");

    // Lo de las demás personas queda intacto.
    assert.equal((await pool.query(`select status::text as status, phone_e164 from app_users where id = $1`, [world.ana])).rows[0].phone_e164, "+34600111222");
    assert.equal((await ana.get("/v1/notifications")).status, 200);
    const miguelRides = await miguel.get("/v1/conversations");
    assert.equal(miguelRides.status, 200);

    // Y la exportación de Miguel ya no contiene el texto borrado de Laura.
    assert.ok(!JSON.stringify((await pool.query(`select body from trip_direct_messages`)).rows).includes("Calle Feria"));
  });

  it("eliminación bloqueada al ejecutarse: se avisa, no se borra nada y se completa sola cuando el bloqueo desaparece; una bloqueada no frena a las demás", async () => {
    // Laura y Miguel piden eliminar; después Laura reserva un viaje futuro (aparece un bloqueo).
    assert.equal((await laura.post("/v1/me/account-deletion", { confirmation: "ELIMINAR" })).status, 201);
    assert.equal((await miguel.post("/v1/me/account-deletion", { confirmation: "ELIMINAR" })).status, 201);
    await pool.query(`update account_deletion_requests set scheduled_for = now() - interval '2 days' where user_id = $1`, [world.laura]);
    await pool.query(`update account_deletion_requests set scheduled_for = now() - interval '1 day' where user_id = $1`, [world.miguel]);
    const future = await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, { departureAt: daysAfter(new Date(), 2) });
    const booking = await seedBooking(pool, future.tripId, world.laura);

    const first = await executeDueAccountDeletions(deps, new Date());
    assert.deepEqual(first, { processed: 2, completed: 1, blocked: 1, failed: 0 }, "Miguel se elimina aunque la de Laura (más antigua) esté bloqueada");
    assert.equal((await pool.query(`select status::text as status from app_users where id = $1`, [world.laura])).rows[0].status, "active");
    assert.equal((await pool.query(`select status::text as status from app_users where id = $1`, [world.miguel])).rows[0].status, "deleted");
    const state = await laura.get("/v1/me/account-deletion");
    assert.equal(state.body.request.status, "blocked");
    assert.deepEqual(state.body.request.blockers.map((b: { code: string }) => b.code), ["UPCOMING_BOOKING_AS_PASSENGER"]);
    assert.equal(state.body.eligible, false);
    const notice = (await laura.get("/v1/notifications")).body.items.find((n: { kind: string }) => n.kind === "account_deletion_blocked");
    assert.ok(notice, "avisa de por qué no se ha eliminado todavía");
    assert.equal((await pool.query(`select 1 from audit_events where action = 'account.deletion.blocked'`)).rowCount, 1);

    // Reevaluarla con el mismo bloqueo no repite el aviso.
    assert.equal((await executeDueAccountDeletions(deps, new Date())).blocked, 1);
    assert.equal((await laura.get("/v1/notifications")).body.items.filter((n: { kind: string }) => n.kind === "account_deletion_blocked").length, 1);

    // Se resuelve el bloqueo y el siguiente ciclo la completa.
    await pool.query(`update bookings set status = 'cancelled' where id = $1`, [booking.bookingId]);
    assert.deepEqual(await executeDueAccountDeletions(deps, new Date()), { processed: 1, completed: 1, blocked: 0, failed: 0 });
    assert.equal((await pool.query(`select status::text as status from app_users where id = $1`, [world.laura])).rows[0].status, "deleted");
  });

  it("eliminación: si falla el borrado en el almacenamiento o un paso de otro módulo no se pierde nada a medias y se reintenta", async () => {
    const rich = await richLaura();
    assert.equal((await laura.post("/v1/me/account-deletion", { confirmation: "ELIMINAR" })).status, 201);
    const later = daysAfter(new Date(), 15);

    // Sin posibilidad de borrar los objetos privados no se anonimiza nada.
    const withoutEraser = await executeDueAccountDeletions({ ...deps, eraser: null }, later);
    assert.deepEqual(withoutEraser, { processed: 1, completed: 0, blocked: 0, failed: 1 });
    assert.equal((await pool.query(`select status::text as status, phone_e164 from app_users where id = $1`, [world.laura])).rows[0].status, "active");
    let request = (await pool.query(`select status, last_error from account_deletion_requests where user_id = $1`, [world.laura])).rows[0];
    assert.deepEqual(request, { status: "processing", last_error: "STORAGE_UNAVAILABLE" });
    const noCancel = await laura.post("/v1/me/account-deletion/cancel");
    assert.equal(noCancel.status, 409, "una vez iniciado ya no se cancela");

    // Un paso de otro módulo que falla deshace TODO el borrado de la base de datos.
    registerErasureStep({
      name: "money",
      storageKeys: async () => ["receipts/laura-1.pdf"],
      run: async () => {
        throw new Error("MONEY_ERASURE_FAILED");
      }
    });
    storage.put("receipts/laura-1.pdf", PNG_BYTES, "application/pdf");
    const afterRetryWindow = daysAfter(new Date(), 16);
    const failedStep = await executeDueAccountDeletions(deps, afterRetryWindow);
    assert.deepEqual(failedStep, { processed: 1, completed: 0, blocked: 0, failed: 1 });
    assert.equal((await pool.query(`select status::text as status from app_users where id = $1`, [world.laura])).rows[0].status, "active");
    assert.equal((await pool.query(`select count(*)::int as n from trip_direct_messages where sender_user_id = $1 and body = '[Mensaje eliminado]'`, [world.laura])).rows[0].n, 0);
    assert.equal((await pool.query(`select 1 from auth_sessions where user_id = $1 and revoked_at is null`, [world.laura])).rowCount! > 0, true);
    request = (await pool.query(`select status, last_error from account_deletion_requests where user_id = $1`, [world.laura])).rows[0];
    assert.deepEqual(request, { status: "processing", last_error: "MONEY_ERASURE_FAILED" });
    // Mientras dure la ventana de espera tras un fallo no se reintenta en bucle.
    assert.equal((await executeDueAccountDeletions(deps, afterRetryWindow)).processed, 0);

    // El paso se corrige, su clave de almacenamiento se borra y su recuento queda en el resumen.
    registerErasureStep({ name: "money", storageKeys: async () => ["receipts/laura-1.pdf"], run: async () => ({ receiptsErased: 3 }) });
    const done = await executeDueAccountDeletions(deps, daysAfter(new Date(), 17));
    assert.deepEqual(done, { processed: 1, completed: 1, blocked: 0, failed: 0 });
    assert.ok(eraser.deleted.includes("receipts/laura-1.pdf"));
    assert.equal((await pool.query(`select erasure_summary from account_deletion_requests where user_id = $1`, [world.laura])).rows[0].erasure_summary["money.receiptsErased"], 3);
    assert.equal((await pool.query(`select status::text as status from app_users where id = $1`, [world.laura])).rows[0].status, "deleted");
    assert.ok(rich.chat);
  });

  it("trabajos periódicos: una sola pasada ejecuta exportaciones, caducidades y eliminaciones vencidas", async () => {
    assert.equal((await miguel.post("/v1/me/data-exports")).status, 202);
    assert.equal((await laura.post("/v1/me/account-deletion", { confirmation: "ELIMINAR" })).status, 201);
    await pool.query(`update account_deletion_requests set scheduled_for = now() - interval '1 minute'`);
    const summary = await runCommsJobsOnce(deps);
    assert.equal(summary.exports.ready, 1);
    assert.equal(summary.deletions.completed, 1);
    assert.deepEqual(summary.cleanup, { intents: 0, attachments: 0 });
    assert.equal((await pool.query(`select status::text as status from app_users where id = $1`, [world.laura])).rows[0].status, "deleted");
    assert.equal((await miguel.get("/v1/me/data-exports")).body.items[0].status, "ready");
  });
});
