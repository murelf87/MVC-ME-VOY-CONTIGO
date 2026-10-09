import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { notify, type NotificationInput } from "../src/lib/notify.js";
import { buildCommsApp, clientFor, createPool, keysOf, seedWorld, sessionTokenFor, truncateAll, type Client, type World } from "./comms-support.js";

/**
 * Notificaciones (pantalla 27), preferencias («Avisos esenciales del viaje» / «Avisos opcionales de llegada») y dispositivos push.
 * BD de pruebas propia: mvc_comms.
 */
describe("comms · notificaciones", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let world: World;
  let miguel: Client;
  let laura: Client;
  let ana: Client;

  before(async () => {
    pool = createPool();
    app = await buildCommsApp(pool);
  });

  after(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(pool);
    world = await seedWorld(pool);
    miguel = await clientFor(app, pool, world.miguel);
    laura = await clientFor(app, pool, world.laura);
    ana = await clientFor(app, pool, world.ana);
  });

  /** Inserta una notificación con una antigüedad concreta (minutos) para que el orden sea determinista. */
  async function seed(input: NotificationInput, minutesAgo = 0): Promise<string> {
    const id = await notify(pool, input);
    await pool.query(`update notifications set created_at = now() - make_interval(mins => $2::int) where id = $1`, [id, minutesAgo]);
    return id;
  }

  const forMiguel = (kind: string, category: NotificationInput["category"], title = "Aviso", data: Record<string, unknown> = {}): NotificationInput => ({
    userId: world.miguel,
    category,
    kind,
    title,
    body: `${title} · Sevilla`,
    data
  });

  it("lista solo mis notificaciones, la más reciente primero, con el indicador de aviso esencial y los filtros de la pantalla", async () => {
    const tripId = "7d5f2d62-2d6a-4c52-9c43-0d7cf7c4f5a1";
    await seed(forMiguel("system_notice", "system", "Mantenimiento"), 50);
    await seed(forMiguel("payment_completed", "payment", "Pago completado"), 40);
    await seed(forMiguel("chat_message", "message", "Nuevo mensaje de Ana"), 30);
    await seed(forMiguel("arrival_near", "trip", "Ana está cerca", { tripId }), 20);
    await seed(forMiguel("pickup_soon", "trip", "Recogida en 10 minutos", { tripId }), 10);
    await seed({ userId: world.laura, category: "trip", kind: "pickup_soon", title: "Recogida de Laura", body: "Solo para Laura" }, 5);

    const all = await miguel.get("/v1/notifications");
    assert.equal(all.status, 200);
    assert.deepEqual(keysOf(all.body), ["items", "nextCursor", "unreadCount"]);
    assert.equal(all.body.nextCursor, null);
    assert.equal(all.body.unreadCount, 5);
    assert.deepEqual(
      all.body.items.map((n: { kind: string }) => n.kind),
      ["pickup_soon", "arrival_near", "chat_message", "payment_completed", "system_notice"]
    );
    assert.deepEqual(keysOf(all.body.items[0]), ["body", "category", "createdAt", "data", "essential", "id", "kind", "read", "readAt", "title"]);
    assert.deepEqual(all.body.items[0].data, { tripId });
    assert.equal(all.body.items[0].read, false);
    assert.equal(all.body.items[0].readAt, null);
    assert.match(all.body.items[0].createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // Esenciales: recogida, pago, sistema. Opcionales: llegada y mensaje.
    const essential = Object.fromEntries(all.body.items.map((n: { kind: string; essential: boolean }) => [n.kind, n.essential]));
    assert.deepEqual(essential, {
      pickup_soon: true,
      arrival_near: false,
      chat_message: false,
      payment_completed: true,
      system_notice: true
    });
    assert.ok(!all.body.items.some((n: { title: string }) => n.title === "Recogida de Laura"), "no debe verse la de Laura");

    const trips = await miguel.get("/v1/notifications?category=trip");
    assert.deepEqual(trips.body.items.map((n: { kind: string }) => n.kind), ["pickup_soon", "arrival_near"]);
    const payments = await miguel.get("/v1/notifications?category=payment");
    assert.deepEqual(payments.body.items.map((n: { kind: string }) => n.kind), ["payment_completed"]);
    const messages = await miguel.get("/v1/notifications?category=message");
    assert.deepEqual(messages.body.items.map((n: { kind: string }) => n.kind), ["chat_message"]);
    // La insignia es el total, no el de la categoría filtrada.
    assert.equal(messages.body.unreadCount, 5);

    const badCategory = await miguel.get("/v1/notifications?category=promo");
    assert.equal(badCategory.status, 400);
    assert.equal(badCategory.body.error.code, "VALIDATION_ERROR");
  });

  it("autorización: nadie lee, cuenta ni marca las notificaciones de otra persona", async () => {
    const lauraNotification = await seed({ userId: world.laura, category: "payment", kind: "payment_completed", title: "Pago de Laura", body: "Importe privado" });
    await seed(forMiguel("pickup_soon", "trip"));

    const mark = await miguel.post(`/v1/notifications/${lauraNotification}/read`);
    assert.equal(mark.status, 404);
    assert.equal(mark.body.error.code, "NOTIFICATION_NOT_FOUND");
    const row = await pool.query<{ read_at: Date | null }>(`select read_at from notifications where id = $1`, [lauraNotification]);
    assert.equal(row.rows[0]!.read_at, null, "la notificación ajena no debe cambiar");

    const unknown = await miguel.post(`/v1/notifications/6f2f1c0a-0000-4000-8000-000000000001/read`);
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error.code, "NOTIFICATION_NOT_FOUND");
    const malformed = await miguel.post(`/v1/notifications/no-es-un-uuid/read`);
    assert.equal(malformed.status, 400);

    // «Marcar todas» solo toca las propias.
    const readAll = await miguel.post("/v1/notifications/read-all", {});
    assert.equal(readAll.status, 200);
    assert.equal(readAll.body.updated, 1);
    const lauraUnread = await laura.get("/v1/notifications/unread-count");
    assert.equal(lauraUnread.body.total, 1);

    // Sin sesión: 401 en todas las rutas.
    const anonymous = await (await clientFor(app, pool, world.ana)).request("GET", "/v1/notifications", undefined, { authorization: "Bearer token-que-no-existe" });
    assert.equal(anonymous.status, 401);
    const noHeader = await app.inject({ method: "GET", url: "/v1/notifications/unread-count" });
    assert.equal(noHeader.statusCode, 401);
    const noHeaderPrefs = await app.inject({ method: "GET", url: "/v1/me/notification-preferences" });
    assert.equal(noHeaderPrefs.statusCode, 401);
  });

  it("paginación por cursor: cada notificación aparece una sola vez aunque compartan la misma marca de tiempo", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 7; i += 1) ids.push(await seed(forMiguel("pickup_soon", "trip", `Aviso ${i}`), 0));
    // Misma marca de tiempo exacta en todas: el desempate es el id.
    await pool.query(`update notifications set created_at = '2026-10-12T05:00:00.123456Z' where user_id = $1`, [world.miguel]);

    const seen: string[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await miguel.get(`/v1/notifications?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      assert.equal(page.status, 200);
      sizes.push(page.body.items.length);
      seen.push(...page.body.items.map((n: { id: string }) => n.id));
      cursor = page.body.nextCursor;
      if (!cursor) break;
    }
    assert.deepEqual(sizes, [3, 3, 1]);
    assert.equal(new Set(seen).size, 7);
    assert.deepEqual([...seen].sort(), [...ids].sort());

    const invalid = await miguel.get("/v1/notifications?cursor=esto-no-es-un-cursor");
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, "INVALID_CURSOR");
    const tooMany = await miguel.get("/v1/notifications?limit=500");
    assert.equal(tooMany.status, 400);
    assert.equal(tooMany.body.error.code, "VALIDATION_ERROR");
  });

  it("contadores de no leídas por categoría: marcar una, marcar una categoría y marcar todas; marcar es idempotente", async () => {
    const first = await seed(forMiguel("pickup_soon", "trip"), 3);
    await seed(forMiguel("eta_changed", "trip"), 2);
    await seed(forMiguel("chat_message", "message"), 1);
    await seed(forMiguel("payment_completed", "payment"), 0);

    const initial = await miguel.get("/v1/notifications/unread-count");
    assert.equal(initial.status, 200);
    assert.deepEqual(keysOf(initial.body), ["byCategory", "total"]);
    assert.deepEqual(initial.body, { total: 4, byCategory: { trip: 2, message: 1, payment: 1, system: 0 } });

    const marked = await miguel.post(`/v1/notifications/${first}/read`);
    assert.equal(marked.status, 200);
    assert.equal(marked.body.read, true);
    assert.ok(marked.body.readAt);
    const again = await miguel.post(`/v1/notifications/${first}/read`);
    assert.equal(again.status, 200);
    assert.equal(again.body.readAt, marked.body.readAt, "repetir no cambia la hora de lectura");

    assert.deepEqual((await miguel.get("/v1/notifications/unread-count")).body, { total: 3, byCategory: { trip: 1, message: 1, payment: 1, system: 0 } });
    const unreadOnly = await miguel.get("/v1/notifications?unread=true");
    assert.equal(unreadOnly.body.items.length, 3);
    assert.ok(unreadOnly.body.items.every((n: { read: boolean }) => !n.read));

    const category = await miguel.post("/v1/notifications/read-all", { category: "trip" });
    assert.deepEqual(category.body, { updated: 1 });
    assert.deepEqual((await miguel.get("/v1/notifications/unread-count")).body, { total: 2, byCategory: { trip: 0, message: 1, payment: 1, system: 0 } });

    // Sin cuerpo y sin tipo de contenido también es válido («marcar todas»).
    const bare = await app.inject({ method: "POST", url: "/v1/notifications/read-all", headers: { authorization: `Bearer ${await sessionTokenFor(pool, world.miguel)}` } });
    assert.equal(bare.statusCode, 200, bare.body);
    assert.deepEqual(JSON.parse(bare.body), { updated: 2 });
    assert.equal((await miguel.get("/v1/notifications/unread-count")).body.total, 0);
    assert.deepEqual((await miguel.post("/v1/notifications/read-all", {})).body, { updated: 0 });
    // Un cliente que siempre envía «Content-Type: application/json» aunque el cuerpo esté vacío tampoco recibe un 400.
    await notify(pool, forMiguel("pickup_soon", "trip", "Otra"));
    const emptyJson = await app.inject({
      method: "POST",
      url: "/v1/notifications/read-all",
      headers: { authorization: `Bearer ${await sessionTokenFor(pool, world.miguel)}`, "content-type": "application/json" },
      payload: ""
    });
    assert.equal(emptyJson.statusCode, 200, emptyJson.body);
    assert.deepEqual(JSON.parse(emptyJson.body), { updated: 1 });
    // Pero un JSON mal formado sigue siendo un error de validación estable.
    const malformedJson = await app.inject({
      method: "POST",
      url: "/v1/notifications/read-all",
      headers: { authorization: `Bearer ${await sessionTokenFor(pool, world.miguel)}`, "content-type": "application/json" },
      payload: "{no es json"
    });
    assert.equal(malformedJson.statusCode, 400);
    assert.equal(JSON.parse(malformedJson.body).error.code, "VALIDATION_ERROR");
  });

  it("los avisos esenciales del viaje NO se pueden desactivar: servicio (422), restricción de la base de datos y filtro de entrega", async () => {
    const initial = await miguel.get("/v1/me/notification-preferences");
    assert.equal(initial.status, 200);
    assert.deepEqual(keysOf(initial.body), ["arrivalAlerts", "essentialTripNotices", "messages", "push", "updatedAt"]);
    assert.equal(initial.body.essentialTripNotices, true);
    assert.equal(initial.body.arrivalAlerts, true);
    assert.equal(initial.body.messages, true);
    assert.equal(initial.body.updatedAt, null);

    const locked = await miguel.patch("/v1/me/notification-preferences", { essentialTripNotices: false });
    assert.equal(locked.status, 422);
    assert.equal(locked.body.error.code, "ESSENTIAL_NOTICES_LOCKED");
    // Mezclarlo con un cambio legítimo tampoco lo desactiva ni aplica el cambio a medias.
    const mixed = await miguel.patch("/v1/me/notification-preferences", { essentialTripNotices: false, arrivalAlerts: false });
    assert.equal(mixed.status, 422);
    const stillDefault = await miguel.get("/v1/me/notification-preferences");
    assert.equal(stillDefault.body.arrivalAlerts, true, "una petición rechazada no aplica nada");
    const stored = await pool.query(`select 1 from notification_preferences where user_id = $1`, [world.miguel]);
    assert.equal(stored.rowCount, 0);

    // Enviar `true` es válido (no cambia nada).
    const ok = await miguel.patch("/v1/me/notification-preferences", { essentialTripNotices: true });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.essentialTripNotices, true);

    // Capa 2: aunque algo escribiera directamente en la tabla, la base de datos lo impide.
    await assert.rejects(
      pool.query(`insert into notification_preferences(user_id, essential_trip_notices) values($1,false)`, [world.laura]),
      (error: { code?: string }) => error.code === "23514"
    );
  });

  it("los avisos opcionales respetan las preferencias en el servidor y los esenciales se entregan siempre", async () => {
    const off = await miguel.patch("/v1/me/notification-preferences", { arrivalAlerts: false, messages: false });
    assert.equal(off.status, 200);
    assert.equal(off.body.arrivalAlerts, false);
    assert.equal(off.body.messages, false);
    assert.equal(off.body.essentialTripNotices, true);
    assert.ok(off.body.updatedAt);

    const essentialKinds: Array<[string, NotificationInput["category"]]> = [
      ["pickup_soon", "trip"],
      ["eta_changed", "trip"],
      ["request_accepted", "trip"],
      ["trip_cancelled", "trip"],
      ["payment_completed", "payment"],
      ["safety_alert", "system"]
    ];
    for (const [kind, category] of essentialKinds) await notify(pool, forMiguel(kind, category));
    await notify(pool, forMiguel("arrival_near", "trip", "Ana está cerca"));
    await notify(pool, forMiguel("arrival_at_pickup", "trip", "Ana ha llegado"));
    await notify(pool, forMiguel("chat_message", "message", "Mensaje nuevo"));

    const list = await miguel.get("/v1/notifications");
    assert.equal(list.body.items.length, essentialKinds.length, "solo se listan los esenciales");
    assert.ok(list.body.items.every((n: { essential: boolean }) => n.essential));
    assert.equal(list.body.unreadCount, essentialKinds.length);
    assert.equal((await miguel.get("/v1/notifications/unread-count")).body.total, essentialKinds.length);
    const suppressed = await pool.query<{ kind: string }>(
      `select kind from notifications where user_id = $1 and delivery_state = 'suppressed' order by kind`,
      [world.miguel]
    );
    assert.deepEqual(suppressed.rows.map(r => r.kind), ["arrival_at_pickup", "arrival_near", "chat_message"]);

    // Las preferencias son por persona: Laura sigue recibiéndolo todo.
    await notify(pool, { userId: world.laura, category: "trip", kind: "arrival_near", title: "Ana está cerca", body: "Llega en 3 minutos" });
    assert.equal((await laura.get("/v1/notifications")).body.items.length, 1);

    // Reactivar: los siguientes avisos vuelven a llegar; los suprimidos no reaparecen (nunca se entregaron).
    const on = await miguel.patch("/v1/me/notification-preferences", { arrivalAlerts: true });
    assert.equal(on.body.arrivalAlerts, true);
    assert.equal(on.body.messages, false, "un cambio parcial no toca el otro interruptor");
    await notify(pool, forMiguel("arrival_near", "trip", "Ana está cerca otra vez"));
    const after = await miguel.get("/v1/notifications");
    assert.equal(after.body.items.length, essentialKinds.length + 1);
    assert.equal(after.body.items[0].title, "Ana está cerca otra vez");
    assert.equal(after.body.items[0].essential, false);
  });

  it("dispositivos push: registrar, refrescar, traspasar a otra cuenta, listar sin el token y dar de baja solo los propios", async () => {
    const token = "ExponentPushToken[abcDEF123456_xyz-789]";
    const created = await miguel.post("/v1/me/push-tokens", { token, platform: "ios", provider: "expo", deviceId: "iphone-miguel", appVersion: "1.0.0", locale: "es-ES" });
    assert.equal(created.status, 201);
    assert.deepEqual(keysOf(created.body), ["appVersion", "createdAt", "deviceId", "id", "lastSeenAt", "platform", "provider"]);
    assert.equal(created.body.deviceId, "iphone-miguel");
    assert.ok(!JSON.stringify(created.body).includes("abcDEF"), "el token no se devuelve");

    const refreshed = await miguel.post("/v1/me/push-tokens", { token, platform: "ios", provider: "expo", deviceId: "iphone-miguel", appVersion: "1.0.1" });
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.id, created.body.id);
    assert.equal(refreshed.body.appVersion, "1.0.1");

    const listed = await miguel.get("/v1/me/push-tokens");
    assert.equal(listed.status, 200);
    assert.deepEqual(keysOf(listed.body), ["items", "nextCursor"]);
    assert.equal(listed.body.items.length, 1);
    assert.ok(!listed.raw.includes("abcDEF"), "el listado tampoco devuelve el token");

    // El estado real del push: no hay proveedor; el registro de dispositivos sí cuenta.
    const prefs = await miguel.get("/v1/me/notification-preferences");
    assert.deepEqual(prefs.body.push, { available: false, provider: "disabled", reason: "PROVIDER_DISABLED", registeredDevices: 1 });

    // El mismo dispositivo rota el token: el anterior se retira.
    const rotated = await miguel.post("/v1/me/push-tokens", { token: "ExponentPushToken[ROTATED0000000001]", platform: "ios", provider: "expo", deviceId: "iphone-miguel" });
    assert.equal(rotated.status, 201);
    assert.equal((await miguel.get("/v1/me/push-tokens")).body.items.length, 1);

    // Un dispositivo prestado: Laura registra el mismo token y pasa a ser suyo.
    const moved = await laura.post("/v1/me/push-tokens", { token: "ExponentPushToken[ROTATED0000000001]", platform: "ios", provider: "expo" });
    assert.equal(moved.status, 200);
    assert.equal((await miguel.get("/v1/me/push-tokens")).body.items.length, 0);
    assert.equal((await laura.get("/v1/me/push-tokens")).body.items.length, 1);

    // Baja: ajeno 404, propio 204 y repetir 404.
    const foreign = await miguel.delete(`/v1/me/push-tokens/${moved.body.id}`);
    assert.equal(foreign.status, 404);
    assert.equal(foreign.body.error.code, "PUSH_TOKEN_NOT_FOUND");
    const removed = await laura.delete(`/v1/me/push-tokens/${moved.body.id}`);
    assert.equal(removed.status, 204);
    assert.equal(removed.raw, "");
    assert.equal((await laura.delete(`/v1/me/push-tokens/${moved.body.id}`)).status, 404);

    // Validación: token con formato inválido para el proveedor → 422; demasiado corto → 400.
    const badFormat = await ana.post("/v1/me/push-tokens", { token: "esto-no-parece-un-token-expo", platform: "android", provider: "expo" });
    assert.equal(badFormat.status, 422);
    assert.equal(badFormat.body.error.code, "PUSH_TOKEN_INVALID");
    const tooShort = await ana.post("/v1/me/push-tokens", { token: "abc", platform: "android", provider: "fcm" });
    assert.equal(tooShort.status, 400);
    assert.equal(tooShort.body.error.code, "VALIDATION_ERROR");
    const nativeOk = await ana.post("/v1/me/push-tokens", { token: "fGh7-example:APA91bHun4MxP5q0aBcDeFgHiJkLmNoPqRsTuVwXyZ", platform: "android", provider: "fcm" });
    assert.equal(nativeOk.status, 201);
  });

  it("al eliminar la cuenta de la persona sus notificaciones y dispositivos desaparecen con ella (borrado en cascada)", async () => {
    await notify(pool, forMiguel("pickup_soon", "trip"));
    await miguel.post("/v1/me/push-tokens", { token: "ExponentPushToken[cascada0000000001]", platform: "ios", provider: "expo" });
    await pool.query(`delete from app_users where id = $1`, [world.miguel]);
    assert.equal((await pool.query(`select 1 from notifications where user_id = $1`, [world.miguel])).rowCount, 0);
    assert.equal((await pool.query(`select 1 from push_tokens where user_id = $1`, [world.miguel])).rowCount, 0);
  });
});
