import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import type { FastifyInstance, RouteOptions } from "fastify";
import type pg from "pg";
import { executeDueAccountDeletions } from "../src/modules/comms/account-deletion.js";
import { loadCommsConfig } from "../src/modules/comms/config.js";
import type { DataRightsDeps } from "../src/modules/comms/deps.js";
import { COMMS_CONTRACT, ContractReader, compareShapes, pageShape, shapeOfSchema, type Shape } from "./comms-contract-shapes.js";
import {
  Client,
  FakeEraser,
  FakeStorage,
  buildCommsApp,
  createPool,
  daysAfter,
  seedBooking,
  seedTrip,
  seedWorld,
  sessionTokenFor,
  truncateAll,
  type World
} from "./comms-support.js";

/**
 * Capa HTTP del módulo comms: catálogo de endpoints, contrato con la app (tipos TypeScript ↔ schemas del servidor), sesión
 * obligatoria, errores estables (validación, JSON mal formado, tipo de contenido, tamaño), cuerpos vacíos y límites reales de frecuencia.
 * BD de pruebas propia: mvc_comms.
 */
const uuid = () => crypto.randomUUID();

const methodsOf = (route: RouteOptions): string[] => (Array.isArray(route.method) ? route.method : [route.method]).map(String);
const routeKey = (method: string, url: string) => `${method} ${url}`;
const withIds = (url: string) => url.replace(/:[A-Za-z]+/g, () => uuid());

describe("comms · capa HTTP", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let storage: FakeStorage;
  let eraser: FakeEraser;
  let world: World;
  let miguel: Client;
  let laura: Client;
  const captured: RouteOptions[] = [];

  /** Rutas de la API (sin las HEAD automáticas que Fastify crea para cada GET). */
  const apiRoutes = (): Array<{ key: string; method: string; url: string; route: RouteOptions }> =>
    captured.flatMap(route => methodsOf(route).filter(method => method !== "HEAD" && method !== "OPTIONS").map(method => ({ key: routeKey(method, route.url), method, url: route.url, route })));

  const tokenOf = new Map<Client, string>();
  const inject = (client: Client, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, options: { payload?: string; headers?: Record<string, string> } = {}) =>
    app.inject({
      method,
      url,
      remoteAddress: client.ip,
      headers: { authorization: `Bearer ${tokenOf.get(client)}`, ...options.headers },
      ...(options.payload === undefined ? {} : { payload: options.payload })
    });

  async function clientWithToken(userId: string, ip?: string): Promise<Client> {
    const token = await sessionTokenFor(pool, userId);
    const client = new Client(app, token, ip);
    tokenOf.set(client, token);
    return client;
  }

  before(async () => {
    pool = createPool();
    storage = new FakeStorage();
    eraser = new FakeEraser(storage);
    app = await buildCommsApp(pool, { privateStorage: storage, modules: { eraser }, onRoute: route => captured.push(route) });
  });

  after(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    storage.objects.clear();
    eraser.deleted = [];
    await truncateAll(pool);
    world = await seedWorld(pool);
    miguel = await clientWithToken(world.miguel);
    laura = await clientWithToken(world.laura);
  });

  /* ───────────────────────────── Catálogo y contrato ───────────────────────────── */

  it("el módulo publica exactamente los 39 endpoints del contrato y todos aparecen en OpenAPI con resumen, etiqueta y seguridad", () => {
    const keys = apiRoutes().map(r => r.key).sort();
    assert.deepEqual(keys, COMMS_CONTRACT.map(entry => entry.route).sort(), "endpoints publicados ≠ endpoints del contrato");
    assert.equal(keys.length, 39);
    assert.equal(new Set(keys).size, 39, "ninguna ruta duplicada");

    const spec = app.swagger() as unknown as { paths: Record<string, Record<string, { summary?: string; tags?: string[]; security?: unknown[]; responses: Record<string, unknown> }>> };
    for (const { method, url } of apiRoutes()) {
      const operation = spec.paths[url.replace(/:([A-Za-z]+)/g, "{$1}")]?.[method.toLowerCase()];
      assert.ok(operation, `${method} ${url} falta en OpenAPI`);
      assert.ok(operation.summary && operation.summary.length >= 8, `${method} ${url}: resumen`);
      assert.ok(Array.isArray(operation.tags) && operation.tags.length > 0, `${method} ${url}: etiqueta`);
      assert.deepEqual(operation.security, [{ bearerAuth: [] }], `${method} ${url}: seguridad`);
      assert.ok("401" in operation.responses && "429" in operation.responses, `${method} ${url}: declara 401 y 429`);
    }
  });

  it("el contrato de la app (tipos TypeScript) y los schemas del servidor describen exactamente las mismas formas", () => {
    const reader = new ContractReader(path.resolve("mobile/src/api/types/comms.ts"));
    assert.deepEqual(reader.diagnostics(), [], "el contrato compila solo, con strict");

    const shapeOfRef = (ref: string | { page: string }): Shape => (typeof ref === "string" ? reader.shapeOfExport(ref) : pageShape(reader.shapeOfExport(ref.page)));
    const byKey = new Map(apiRoutes().map(r => [r.key, r.route]));
    const diffs: string[] = [];

    for (const entry of COMMS_CONTRACT) {
      const route = byKey.get(entry.route);
      assert.ok(route, `${entry.route}: no está registrada`);
      const schema = (route.schema ?? {}) as { body?: unknown; response?: Record<string, unknown> };

      if (entry.request) {
        assert.ok(schema.body, `${entry.route}: debería declarar cuerpo (${entry.request})`);
        compareShapes(reader.shapeOfExport(entry.request), shapeOfSchema(schema.body), `${entry.route} · petición ${entry.request}`, "request", diffs);
      } else {
        assert.equal(schema.body, undefined, `${entry.route}: no debería declarar cuerpo`);
      }

      const declared = Object.keys(schema.response ?? {}).filter(status => status.startsWith("2")).sort();
      assert.deepEqual(declared, Object.keys(entry.responses).sort(), `${entry.route}: respuestas 2xx declaradas ≠ contrato`);
      for (const [status, ref] of Object.entries(entry.responses)) {
        if (ref === null) continue;
        compareShapes(shapeOfRef(ref), shapeOfSchema(schema.response?.[status]), `${entry.route} · ${status} ${typeof ref === "string" ? ref : `Page<${ref.page}>`}`, "response", diffs);
      }
    }
    assert.deepEqual(diffs, [], `El contrato y los schemas difieren:\n${diffs.join("\n")}`);
  });

  /* ───────────────────────────── Sesión obligatoria ───────────────────────────── */

  it("sin sesión todas las rutas responden 401 (antes de validar), sin cachear y con el formato de error estable", async () => {
    const anonymous = new Client(app, null);
    for (const { method, url } of apiRoutes()) {
      // Con cuerpo inválido a propósito: un cliente sin sesión nunca debe recibir detalles de validación.
      const response = await anonymous.request(method as "GET", withIds(url), method === "GET" || method === "DELETE" ? undefined : { invalido: true });
      assert.equal(response.status, 401, `${method} ${url}`);
      assert.equal(response.body.error.code, "AUTH_REQUIRED", `${method} ${url}`);
      assert.equal(typeof response.body.requestId, "string");
      assert.equal(response.headers["cache-control"], "no-store", `${method} ${url}`);
    }

    // Token con forma incorrecta, inventado, revocado y caducado.
    const forged = new Client(app, "mvc_sess_" + "A".repeat(43));
    assert.equal((await forged.get("/v1/notifications")).body.error.code, "AUTH_INVALID_OR_EXPIRED");
    const wrongScheme = await app.inject({ method: "GET", url: "/v1/notifications", headers: { authorization: "Basic abc" } });
    assert.equal(wrongScheme.statusCode, 401);

    const revokedClient = await clientWithToken(world.miguel);
    assert.equal((await revokedClient.get("/v1/notifications")).status, 200);
    await pool.query(`update auth_sessions set revoked_at = now() where user_id = $1`, [world.miguel]);
    assert.equal((await revokedClient.get("/v1/notifications")).status, 401);
    assert.equal((await miguel.get("/v1/notifications")).status, 401, "revocar las sesiones de la persona las cierra todas");

    const fresh = await clientWithToken(world.laura);
    await pool.query(`update auth_sessions set created_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' where user_id = $1`, [world.laura]);
    assert.equal((await fresh.get("/v1/notifications")).status, 401, "sesión caducada");

    // Cuenta suspendida: 403 y no 200.
    const suspended = await clientWithToken(world.ana);
    await pool.query(`update app_users set status = 'suspended' where id = $1`, [world.ana]);
    const forbidden = await suspended.get("/v1/notifications");
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.error.code, "ACCOUNT_NOT_ACTIVE");
  });

  it("tras eliminar la cuenta, las sesiones antiguas dejan de funcionar en todas las rutas", async () => {
    assert.equal((await laura.post("/v1/me/account-deletion", { confirmation: "ELIMINAR" })).status, 201);
    assert.equal((await laura.get("/v1/me/settings")).body.account.pendingDeletion !== null, true, "durante la gracia la cuenta sigue operativa");
    await pool.query(`update account_deletion_requests set scheduled_for = now() - interval '1 minute' where user_id = $1`, [world.laura]);
    const deps: DataRightsDeps = { pool, config: loadCommsConfig({}), storage, eraser };
    assert.deepEqual(await executeDueAccountDeletions(deps, new Date()), { processed: 1, completed: 1, blocked: 0, failed: 0 });
    for (const url of ["/v1/notifications", "/v1/conversations", "/v1/me/settings", "/v1/me/support/tickets", "/v1/me/account-deletion"]) {
      const response = await laura.get(url);
      assert.equal(response.status, 401, url);
    }
    assert.equal((await miguel.get("/v1/me/settings")).status, 200, "la sesión de otra persona no se toca");
  });

  /* ───────────────────────────── Errores estables ───────────────────────────── */

  it("errores de validación: 400 VALIDATION_ERROR con la lista de fallos; sin caché; el resto de la app no se ve afectado", async () => {
    const empty = await miguel.post("/v1/me/reports", {});
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error.code, "VALIDATION_ERROR");
    assert.ok(Array.isArray(empty.body.error.details) && empty.body.error.details.length >= 1);
    for (const detail of empty.body.error.details) assert.deepEqual(Object.keys(detail).sort(), ["message", "path"]);
    assert.ok(empty.body.error.details.some((d: { message: string }) => /reportedUserId/.test(d.message)));
    assert.equal(empty.headers["cache-control"], "no-store");
    assert.equal(typeof empty.body.requestId, "string");

    const badEnum = await miguel.post("/v1/me/reports", { reportedUserId: world.laura, reason: "no_existe" });
    assert.equal(badEnum.status, 400);
    assert.ok(badEnum.body.error.details.some((d: { path: string }) => d.path === "/reason"));

    const badTypes = await miguel.post("/v1/me/reports", { reportedUserId: "no-es-uuid", reason: "other", evidenceMessageIds: "x" });
    assert.equal(badTypes.status, 400);

    for (const url of [
      "/v1/conversations?limit=0",
      "/v1/conversations?limit=51",
      "/v1/conversations?limit=abc",
      "/v1/conversations?filter=otros",
      "/v1/conversations?q=a",
      "/v1/notifications?category=weird",
      "/v1/notifications?unread=quizas",
      "/v1/me/support/tickets?status=archivado",
      "/v1/conversations/no-es-uuid",
      `/v1/conversations/${uuid()}/messages?afterSeq=-1`,
      `/v1/conversations/${uuid()}/messages?limit=101`
    ]) {
      const response = await miguel.get(url);
      assert.equal(response.status, 400, url);
      assert.equal(response.body.error.code, "VALIDATION_ERROR", url);
    }

    // Cursor inventado: error propio y estable, no 500.
    const cursor = await miguel.get("/v1/notifications?cursor=esto-no-es-un-cursor");
    assert.equal(cursor.status, 400);
    assert.equal(cursor.body.error.code, "INVALID_CURSOR");

    // Cuerpos que no son objeto, y propiedades desconocidas (se descartan sin error en los PATCH).
    assert.equal((await miguel.patch("/v1/me/settings", {})).status, 400, "un PATCH vacío no cambia nada");
    const stripped = await miguel.patch("/v1/me/settings", { fontScale: "large", isAdmin: true, roles: ["admin"] });
    assert.equal(stripped.status, 200);
    assert.deepEqual(Object.keys(stripped.body).sort(), ["account", "fontScale", "language", "shareLiveLocationInTrip", "updatedAt"]);
    assert.ok(!stripped.body.account.roles.includes("admin"), "no se puede escalar privilegios desde los ajustes");
    const roles = (await pool.query(`select role::text as role from user_roles where user_id = $1 order by 1`, [world.miguel])).rows.map(r => r.role);
    assert.ok(!roles.includes("admin"));
    assert.equal((await miguel.get("/v1/me/settings")).status, 200);
  });

  it("JSON mal formado, tipo de contenido no admitido, cuerpo enorme y envenenamiento de prototipo: errores 4xx estables (nunca 500)", async () => {
    const json = { "content-type": "application/json" };

    const malformed = await inject(miguel, "POST", "/v1/me/reports", { payload: '{"reason":', headers: json });
    assert.equal(malformed.statusCode, 400);
    assert.equal(JSON.parse(malformed.body).error.code, "VALIDATION_ERROR");

    const wrongType = await inject(miguel, "POST", "/v1/me/reports", { payload: "reason=other", headers: { "content-type": "application/x-www-form-urlencoded" } });
    assert.equal(wrongType.statusCode, 415);
    assert.equal(JSON.parse(wrongType.body).error.code, "UNSUPPORTED_MEDIA_TYPE");
    const plain = await inject(miguel, "POST", "/v1/me/reports", { payload: "hola", headers: { "content-type": "text/plain" } });
    assert.equal(plain.statusCode, 400, "text/plain llega como cadena y no es un objeto válido");
    assert.equal(JSON.parse(plain.body).error.code, "VALIDATION_ERROR");

    const huge = await inject(miguel, "POST", "/v1/me/reports", {
      payload: JSON.stringify({ reportedUserId: world.laura, reason: "other", details: "x".repeat(1_300_000) }),
      headers: json
    });
    assert.equal(huge.statusCode, 413);
    assert.equal(JSON.parse(huge.body).error.code, "PAYLOAD_TOO_LARGE");

    // Un `details` de 1 001 caracteres cabe en el cuerpo pero el schema lo rechaza.
    const longDetails = await miguel.post("/v1/me/reports", { reportedUserId: world.laura, reason: "other", details: "y".repeat(1001) });
    assert.equal(longDetails.status, 400);

    const poisoned = await inject(miguel, "POST", "/v1/me/reports", {
      payload: `{"__proto__":{"polluted":true},"reportedUserId":"${world.laura}","reason":"other"}`,
      headers: json
    });
    assert.equal(poisoned.statusCode, 400);
    assert.equal(({} as Record<string, unknown>).polluted, undefined, "Object.prototype intacto");
    const constructorPoison = await inject(miguel, "POST", "/v1/me/reports", {
      payload: `{"constructor":{"prototype":{"polluted":true}},"reportedUserId":"${world.laura}","reason":"other"}`,
      headers: json
    });
    assert.equal(constructorPoison.statusCode, 400);

    // Los mensajes de error no filtran trazas ni rutas internas.
    for (const response of [malformed, wrongType, huge, poisoned]) {
      assert.ok(!/at .*\.(ts|js):\d+|node_modules|\/home\//.test(response.body), "sin trazas en el error");
    }
  });

  it("cuerpo vacío: las rutas sin cuerpo lo toleran aunque el cliente envíe Content-Type JSON; las que lo exigen responden 400", async () => {
    const json = { "content-type": "application/json" };

    const readAll = await inject(miguel, "POST", "/v1/notifications/read-all", { payload: "", headers: json });
    assert.equal(readAll.statusCode, 200);
    assert.deepEqual(JSON.parse(readAll.body), { updated: 0 });
    const readAllNoHeader = await inject(miguel, "POST", "/v1/notifications/read-all");
    assert.equal(readAllNoHeader.statusCode, 200);
    const readAllNull = await inject(miguel, "POST", "/v1/notifications/read-all", { payload: "   ", headers: json });
    assert.equal(readAllNull.statusCode, 200);

    // Conversación real: marcar como leída sin cuerpo.
    const trip = await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, { departureAt: daysAfter(new Date(), 1) });
    await seedBooking(pool, trip.tripId, world.miguel);
    const conversationId = (await miguel.get("/v1/conversations")).body.items[0].id;
    const read = await inject(miguel, "POST", `/v1/conversations/${conversationId}/read`, { payload: "", headers: json });
    assert.equal(read.statusCode, 200);
    assert.equal(JSON.parse(read.body).conversationId, conversationId);

    const cancel = await inject(miguel, "POST", "/v1/me/account-deletion/cancel", { payload: "", headers: json });
    assert.equal(cancel.statusCode, 404, "sin solicitud vigente: 404 propio, no 400 de validación");
    assert.equal(JSON.parse(cancel.body).error.code, "ACCOUNT_DELETION_NOT_FOUND");

    const close = await inject(miguel, "POST", `/v1/me/support/tickets/${uuid()}/close`, { payload: "", headers: json });
    assert.equal(close.statusCode, 404);

    // Rutas con cuerpo obligatorio: vacío → 400 de validación (no 500, no 415).
    for (const url of ["/v1/me/reports", "/v1/me/account-deletion", "/v1/me/push-tokens", "/v1/conversations/direct", "/v1/me/support/tickets"]) {
      const response = await inject(miguel, "POST", url, { payload: "", headers: json });
      assert.equal(response.statusCode, 400, url);
      assert.equal(JSON.parse(response.body).error.code, "VALIDATION_ERROR", url);
    }
  });

  /* ───────────────────────────── Límites de frecuencia ───────────────────────────── */

  it("límite de frecuencia real: 429 RATE_LIMITED con Retry-After, por SESIÓN (no por IP) y sin sesión por IP", async () => {
    const shared = "203.0.113.50"; // misma IP para varias personas (NAT del operador, wifi de campus)
    const miguelOnNat = await clientWithToken(world.miguel, shared);
    const lauraOnNat = await clientWithToken(world.laura, shared);
    const anaOnNat = await clientWithToken(world.ana, shared);

    // Denuncias: 10 por hora y sesión. El cuerpo inválido da igual: el límite cuenta toda petición.
    for (let i = 0; i < 10; i += 1) {
      const response = await miguelOnNat.post("/v1/me/reports", {});
      assert.equal(response.status, 400, `petición ${i + 1}`);
    }
    const limited = await miguelOnNat.post("/v1/me/reports", {});
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, "RATE_LIMITED");
    assert.equal(typeof limited.body.requestId, "string");
    assert.equal(limited.headers["cache-control"], "no-store");
    assert.ok(Number(limited.headers["retry-after"]) >= 1, "Retry-After en segundos");
    assert.equal(limited.headers["x-ratelimit-limit"], "10");

    // Otras personas tras la MISMA IP no se ven afectadas.
    assert.equal((await lauraOnNat.post("/v1/me/reports", {})).status, 400);
    assert.equal((await anaOnNat.post("/v1/me/reports", {})).status, 400);
    // Y la misma persona sigue pudiendo usar el resto de rutas (cada ruta lleva su propio contador).
    assert.equal((await miguelOnNat.get("/v1/notifications")).status, 200);
    assert.equal((await miguelOnNat.get("/v1/conversations")).status, 200);

    // Una sesión nueva de la misma persona es otra clave: el límite protege contra abuso por sesión, no se esquiva con la IP.
    const anotherSession = await clientWithToken(world.miguel, shared);
    assert.equal((await anotherSession.post("/v1/me/reports", {})).status, 400);

    // Sin credenciales con forma de token la clave es la IP: 11 intentos anónimos desde una misma IP acaban en 429.
    const anonymous = new Client(app, null, "198.51.100.77");
    const codes: number[] = [];
    for (let i = 0; i < 11; i += 1) codes.push((await anonymous.post("/v1/me/reports", {})).status);
    assert.deepEqual(codes, [...Array(10).fill(401), 429]);
    // Otra IP anónima no comparte contador.
    assert.equal((await new Client(app, null, "198.51.100.78").post("/v1/me/reports", {})).status, 401);

    // La IP local de las pruebas (127.0.0.1) no se limita: así el resto de tests no se estorban.
    for (let i = 0; i < 12; i += 1) assert.equal((await miguel.post("/v1/me/reports", {})).status, 400);
  });

  it("el tope de una exportación cada 24 h vive en la base de datos: cambiar de sesión no lo esquiva", async () => {
    const exportCreated = await miguel.post("/v1/me/data-exports");
    assert.equal(exportCreated.status, 202);
    await pool.query(`update data_export_requests set status = 'ready', completed_at = now(), expires_at = now() + interval '7 days'`);
    const otherSession = await clientWithToken(world.miguel);
    const second = await otherSession.post("/v1/me/data-exports");
    assert.equal(second.status, 429);
    assert.equal(second.body.error.code, "EXPORT_RATE_LIMITED");
  });
});
