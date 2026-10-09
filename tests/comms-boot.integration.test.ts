import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import type pg from "pg";
import { COMMS_CONTRACT } from "./comms-contract-shapes.js";
import { bearer, daysAfter, seedBooking, seedTrip, seedWorld, sessionTokenFor, truncateAll, type World } from "./comms-support.js";

/**
 * El módulo dentro de la app REAL (`buildApp`, con todos los módulos, el manejador de errores global, el límite de frecuencia global y las
 * rutas antiguas del chat 1:1): arranque sin rutas duplicadas, publicación en OpenAPI y compatibilidad con `/v1/trips/:tripId/chat/…`
 * y `/v1/me/blocks/:userId`. BD de pruebas propia: mvc_comms (las tablas de otros módulos no existen aquí: solo se ejercitan rutas de comms y del chat antiguo).
 */
const uuid = () => crypto.randomUUID();

describe("comms · integrado en la app real", () => {
  let app: Awaited<ReturnType<(typeof import("../src/app.js"))["buildApp"]>>;
  let pool: pg.Pool;
  let world: World;
  let ana: string;
  let miguel: string;
  let laura: string;

  const call = (token: string, method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH", url: string, payload?: object) =>
    app.inject({ method, url, headers: bearer(token), ...(payload === undefined ? {} : { payload }) });
  const body = (response: { body: string }) => JSON.parse(response.body) as any;

  before(async () => {
    assert.match(process.env.DATABASE_URL ?? "", /\/mvc_comms(_full)?$/, "esta prueba solo se ejecuta contra la base de datos mvc_comms (o su copia con todas las migraciones, mvc_comms_full)");
    process.env.COMMS_JOBS_INTERVAL_SECONDS = "0"; // sin temporizadores: los trabajos se prueban a mano
    const { buildApp } = await import("../src/app.js");
    ({ pool } = await import("../src/db/pool.js"));
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(pool);
    world = await seedWorld(pool);
    ana = await sessionTokenFor(pool, world.ana);
    miguel = await sessionTokenFor(pool, world.miguel);
    laura = await sessionTokenFor(pool, world.laura);
  });

  it("la app arranca con todos los módulos sin rutas duplicadas y publica los 39 endpoints del contrato en OpenAPI", () => {
    const spec = app.swagger() as unknown as { paths: Record<string, Record<string, { summary?: string; security?: unknown[] }>> };
    for (const { route } of COMMS_CONTRACT) {
      const [method, url] = route.split(" ") as [string, string];
      assert.ok(app.hasRoute({ method: method as "GET", url }), `${route} no está registrada en la app real`);
      const operation = spec.paths[url.replace(/:([A-Za-z]+)/g, "{$1}")]?.[method.toLowerCase()];
      assert.ok(operation?.summary, `${route} falta en OpenAPI`);
      assert.deepEqual(operation?.security, [{ bearerAuth: [] }], route);
    }
    // Las rutas antiguas del chat y de bloqueos siguen ahí, y la nueva lista de bloqueados convive con ellas.
    for (const [method, url] of [
      ["POST", "/v1/trips/:tripId/chat/:peerUserId/messages"],
      ["GET", "/v1/trips/:tripId/chat/:peerUserId/messages"],
      ["PUT", "/v1/me/blocks/:userId"],
      ["DELETE", "/v1/me/blocks/:userId"],
      ["GET", "/v1/me/blocks"]
    ] as const) {
      assert.ok(app.hasRoute({ method, url }), `${method} ${url}`);
    }
  });

  it("el chat antiguo y el nuevo comparten mensajes: lo enviado por la ruta antigua aparece en la bandeja, y al revés; los reintentos no duplican", async () => {
    const trip = await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, { departureAt: daysAfter(new Date(), 1) });
    await seedBooking(pool, trip.tripId, world.miguel);

    // Miguel escribe por la ruta antigua.
    const clientMessageId = uuid();
    const legacy = await call(miguel, "POST", `/v1/trips/${trip.tripId}/chat/${world.ana}/messages`, { clientMessageId, body: "Hola Ana, ¿salimos de Sevilla Centro?" });
    assert.equal(legacy.statusCode, 201, legacy.body);

    // Ana lo ve en la bandeja nueva, sin leer, con la vista previa.
    const inbox = body(await call(ana, "GET", "/v1/conversations"));
    assert.equal(inbox.items.length, 1);
    assert.equal(inbox.items[0].kind, "direct");
    assert.equal(inbox.items[0].title, "Miguel");
    assert.equal(inbox.items[0].unreadCount, 1);
    assert.equal(inbox.items[0].lastMessage.preview, "Hola Ana, ¿salimos de Sevilla Centro?");
    assert.equal(inbox.unreadTotal, 1);
    const conversationId = inbox.items[0].id as string;

    const messages = body(await call(ana, "GET", `/v1/conversations/${conversationId}/messages`));
    assert.equal(messages.items.length, 1);
    assert.equal(messages.items[0].kind, "text");
    assert.equal(messages.items[0].body, "Hola Ana, ¿salimos de Sevilla Centro?");
    assert.equal(typeof messages.items[0].seq, "number");
    assert.equal(messages.items[0].mine, false);

    // Ana contesta por la ruta nueva; Miguel lo ve por la antigua.
    const reply = await call(ana, "POST", `/v1/conversations/${conversationId}/messages`, { clientMessageId: uuid(), body: "Sí, a las 07:25 en P1." });
    assert.equal(reply.statusCode, 201, reply.body);
    const legacyList = body(await call(miguel, "GET", `/v1/trips/${trip.tripId}/chat/${world.ana}/messages`));
    assert.deepEqual(
      legacyList.messages.map((m: { body: string }) => m.body),
      ["Hola Ana, ¿salimos de Sevilla Centro?", "Sí, a las 07:25 en P1."]
    );

    // Reintento idempotente por la ruta antigua: 200 y sin duplicar.
    const retry = await call(miguel, "POST", `/v1/trips/${trip.tripId}/chat/${world.ana}/messages`, { clientMessageId, body: "Hola Ana, ¿salimos de Sevilla Centro?" });
    assert.equal(retry.statusCode, 200);
    assert.equal(body(await call(ana, "GET", `/v1/conversations/${conversationId}/messages`)).items.length, 2);

    // Los acuses funcionan sobre los mensajes de la ruta antigua: Ana lo lee y Miguel ve «leído» en el suyo.
    assert.equal((await call(ana, "POST", `/v1/conversations/${conversationId}/read`)).statusCode, 200);
    const miguelView = body(await call(miguel, "GET", `/v1/conversations/${conversationId}/messages`));
    assert.equal(miguelView.items[0].mine, true);
    assert.equal(miguelView.items[0].receipt.state, "read");
  });

  it("los bloqueos de la ruta antigua cortan el chat nuevo y la lista nueva los muestra; desbloquear lo restaura", async () => {
    const trip = await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, { departureAt: daysAfter(new Date(), 1) });
    await seedBooking(pool, trip.tripId, world.miguel);
    const conversationId = body(await call(miguel, "GET", "/v1/conversations")).items[0].id as string;

    assert.equal((await call(miguel, "PUT", `/v1/me/blocks/${world.ana}`)).statusCode, 204);
    const blocks = body(await call(miguel, "GET", "/v1/me/blocks"));
    assert.deepEqual(blocks.items.map((item: { user: { id: string } }) => item.user.id), [world.ana]);

    for (const token of [miguel, ana]) {
      assert.equal(body(await call(token, "GET", "/v1/conversations")).items.length, 0, "desaparece de la bandeja de ambas personas");
      const detail = await call(token, "GET", `/v1/conversations/${conversationId}`);
      assert.equal(detail.statusCode, 403);
      assert.equal(body(detail).error.code, "CHAT_BLOCKED");
    }
    const sendWhileBlocked = await call(ana, "POST", `/v1/conversations/${conversationId}/messages`, { clientMessageId: uuid(), body: "¿Hola?" });
    assert.equal(sendWhileBlocked.statusCode, 403);

    assert.equal((await call(miguel, "DELETE", `/v1/me/blocks/${world.ana}`)).statusCode, 204);
    assert.deepEqual(body(await call(miguel, "GET", "/v1/me/blocks")).items, []);
    assert.equal(body(await call(miguel, "GET", "/v1/conversations")).items.length, 1);
    assert.equal((await call(ana, "POST", `/v1/conversations/${conversationId}/messages`, { clientMessageId: uuid(), body: "Ya está todo bien." })).statusCode, 201);
  });

  it("con el manejador de errores global real, las rutas de comms siguen devolviendo 400/401/404/422 estables (no 500)", async () => {
    const validation = await call(miguel, "POST", "/v1/me/reports", {});
    assert.equal(validation.statusCode, 400);
    assert.equal(body(validation).error.code, "VALIDATION_ERROR");

    const anonymous = await app.inject({ method: "GET", url: "/v1/notifications" });
    assert.equal(anonymous.statusCode, 401);
    assert.equal(body(anonymous).error.code, "AUTH_REQUIRED");

    const missing = await call(miguel, "GET", `/v1/conversations/${uuid()}`);
    assert.equal(missing.statusCode, 404);
    assert.equal(body(missing).error.code, "CONVERSATION_NOT_FOUND");

    const locked = await call(miguel, "PATCH", "/v1/me/notification-preferences", { essentialTripNotices: false });
    assert.equal(locked.statusCode, 422);
    assert.equal(body(locked).error.code, "ESSENTIAL_NOTICES_LOCKED");

    const limited = await call(laura, "GET", "/v1/me/settings");
    assert.equal(limited.statusCode, 200);
    assert.equal(limited.headers["cache-control"], "no-store");
    assert.equal(body(limited).account.userId, world.laura);
  });
});
