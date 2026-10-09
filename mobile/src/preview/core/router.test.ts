/**
 * Router y tubería del servidor simulado: coincidencia de rutas, orden de validación, errores, respuestas, idempotencia,
 * filtrado de la respuesta, 404 por defecto de Fastify y rutas duplicadas / `override`.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ApiFailure, fail } from "./errors";
import { createRouter, reply, type PreviewRouter } from "./router";
import { setUnexpectedErrorReporter } from "./server";
import { asRecord, bareServer, clearShell, type BareServer } from "../testing/harness";
import { createSession } from "./auth";
import { createUser } from "../domain/users";

const silenced: unknown[] = [];

describe("PreviewRouter: coincidencia y registro", () => {
  it("la ruta literal gana a la ruta con parámetro, sin importar el orden de registro", () => {
    const r = createRouter();
    r.get("/v1/me/trips/:tripId", () => "param");
    r.get("/v1/me/trips/drafts", () => "literal");
    assert.equal(r.match("GET", "/v1/me/trips/drafts")?.route.pattern, "/v1/me/trips/drafts");
    assert.equal(r.match("GET", "/v1/me/trips/abc")?.route.pattern, "/v1/me/trips/:tripId");
    assert.deepEqual(r.match("GET", "/v1/me/trips/abc")?.params, { tripId: "abc" });
  });

  it("decodifica los parámetros, casa un segmento vacío como find-my-way (parámetro «») y no casa rutas de otra longitud", () => {
    const r = createRouter();
    r.get("/v1/places/:name", () => null);
    r.get("/v1/trips/:tripId/requests", () => null);
    assert.deepEqual(r.match("GET", "/v1/places/Dos%20Hermanas")?.params, { name: "Dos Hermanas" });
    assert.deepEqual(r.match("GET", "/v1/places/")?.params, { name: "" });
    assert.deepEqual(r.match("GET", "/v1/trips//requests")?.params, { tripId: "" });
    assert.equal(r.match("GET", "/v1/places"), null, "sin la barra final es otra ruta (404)");
    assert.equal(r.match("GET", "/v1/places/a/b"), null);
    assert.equal(r.match("GET", "/v1"), null);
  });

  it("el método cuenta: la misma ruta con otro método no existe (Fastify responde 404, no 405)", () => {
    const r = createRouter();
    r.post("/v1/things", () => null);
    assert.equal(r.match("GET", "/v1/things"), null);
    assert.equal(r.has("POST", "/v1/things"), true);
    assert.equal(r.has("GET", "/v1/things"), false);
  });

  it("una ruta duplicada es un error, y dos parámetros con distinto nombre son la misma ruta", () => {
    const r = createRouter();
    r.get("/v1/items/:id", () => 1);
    assert.throws(() => r.get("/v1/items/:itemId", () => 2), /Ruta duplicada GET \/v1\/items\/:itemId/);
  });

  it("el mensaje de duplicado dice quién la registró primero", () => {
    const root = createRouter();
    root.scoped("search").get("/v1/x", () => 1);
    assert.throws(() => root.scoped("driver").get("/v1/x", () => 2), /ya la registró «search»/);
  });

  it("override sustituye una ruta existente y falla si no existe (no admite typos)", () => {
    const r = createRouter();
    r.get("/v1/a", () => "viejo");
    r.scoped("live").override("GET", "/v1/a", () => "nuevo");
    assert.equal(r.routes().find((x) => x.pattern === "/v1/a")?.owner, "live");
    assert.equal(r.size(), 1);
    assert.throws(() => r.override("GET", "/v1/b", () => 1), /no hay ninguna ruta registrada que sustituir/);
  });

  it("rechaza patrones mal formados y manejadores ausentes", () => {
    const r = createRouter();
    assert.throws(() => r.get("sin-barra", () => 1), /debe empezar por/);
    assert.throws(() => r.get("/v1/:1mal", () => 1), /Parámetro de ruta no válido/);
    assert.throws(() => r.on("GET", "/v1/z", {}), /Falta el manejador/);
  });

  it("routes() lista método, patrón, resumen, etiquetas y dueño", () => {
    const r = createRouter();
    r.scoped("auth").post("/v1/auth/logout", { summary: "Cerrar sesión", tags: ["auth"] }, () => reply.noContent());
    assert.deepEqual(r.routes(), [
      { method: "POST", pattern: "/v1/auth/logout", summary: "Cerrar sesión", tags: ["auth"], owner: "auth" },
    ]);
  });
});

describe("tubería del servidor simulado", () => {
  let t: BareServer;
  let router: PreviewRouter;

  beforeEach(() => {
    silenced.length = 0;
    setUnexpectedErrorReporter((error) => {
      silenced.push(error);
    });
    t = bareServer((r, db) => {
      router = r;
      r.get("/ping", () => ({ pong: true }));
      r.post(
        "/echo/:id",
        {
          schema: {
            params: { type: "object", required: ["id"], properties: { id: { type: "integer", minimum: 1 } } },
            querystring: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50, default: 10 } } },
            body: {
              type: "object",
              required: ["name"],
              additionalProperties: false,
              properties: { name: { type: "string", minLength: 2 }, age: { type: "integer" } },
            },
          },
        },
        (req) => ({ params: req.params, query: req.query, body: req.body })
      );
      r.get("/secure", (req) => ({ userId: req.auth().userId }));
      r.get("/boom", () => {
        throw new Error("fallo inesperado");
      });
      r.get("/fail", () => fail("THING_NOT_FOUND", "Thing not found", 404, { id: 7 }));
      r.get("/failheaders", () => {
        throw new ApiFailure("RATE_LIMITED", "slow down", 429, undefined, { "retry-after": "30" });
      });
      r.post("/created", () => reply.created({ id: 1 }));
      r.post("/accepted", () => reply.accepted({ queued: true }));
      r.post("/nocontent", () => reply.noContent());
      r.get("/filtered", {
        schema: {
          response: {
            200: {
              type: "object",
              properties: { id: { type: "string" }, nested: { type: "object", properties: { keep: { type: "string" } } } },
            },
          },
        },
      }, () => ({ id: "1", secret: "no", nested: { keep: "sí", hidden: "no" } }));
      let counter = 0;
      r.post("/idem", { idempotent: true }, (req) => {
        req.auth();
        counter += 1;
        return reply.created({ n: counter, body: req.body });
      });
      let flaky = 0;
      r.post("/idem-flaky", { idempotent: true }, (req) => {
        req.auth();
        flaky += 1;
        if (flaky === 1) fail("NO_CAPACITY_ON_SEGMENT", "No capacity on segment", 409);
        return reply.created({ n: flaky });
      });
      let paid = 0;
      r.post("/pay", { idempotent: "required" }, (req) => {
        req.auth();
        paid += 1;
        return reply.created({ n: paid, body: req.body });
      });
      r.post("/pay-other", { idempotent: "required" }, (req) => {
        req.auth();
        return reply.created({ other: true });
      });
      r.get("/whoami", (req) => ({ roles: req.auth().roles, optional: req.authOptional()?.userId ?? null }));
      r.get("/admin-only", (req) => {
        req.requireRole(req.auth(), ["admin"]);
        return { ok: true };
      });
      r.get("/now", (req) => ({ iso: req.now().toISOString(), ms: req.nowMs(), db: db.nowMs() }));
    });
  });

  afterEach(() => {
    clearShell();
    setUnexpectedErrorReporter((error, method, path) => {
      if (typeof console !== "undefined") console.error(`[mvc-preview] error inesperado en ${method} ${path}`, error);
    });
  });

  it("responde 200 con JSON y marca cada respuesta como simulación", async () => {
    const res = await t.api("GET", "/ping");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { pong: true });
    assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
    assert.match(res.headers["x-mvc-simulation"] ?? "", /simulacion en memoria/);
  });

  it("una ruta o un método inexistentes devuelven el 404 por defecto de Fastify", async () => {
    const res = await t.api("GET", "/no-existe");
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { message: "Route GET:/no-existe not found", error: "Not Found", statusCode: 404 });
    const wrongMethod = await t.api("DELETE", "/ping");
    assert.equal(wrongMethod.status, 404);
  });

  it("valida params, cuerpo y query, coerciona tipos, aplica defaults y elimina propiedades no declaradas", async () => {
    const res = await t.api("POST", "/echo/5?limit=7", { body: { name: "Ana", age: 31, extra: "se elimina" } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { params: { id: 5 }, query: { limit: 7 }, body: { name: "Ana", age: 31 } });
    const defaults = await t.api("POST", "/echo/5", { body: { name: "Ana" } });
    assert.deepEqual(asRecord(defaults.body).query, { limit: 10 });
  });

  it("un fallo de validación es 400 VALIDATION_ERROR con details [{path,message,keyword}] y requestId", async () => {
    const res = await t.api("POST", "/echo/5", { body: { name: "A" } });
    assert.equal(res.status, 400);
    const body = asRecord(res.body);
    assert.deepEqual(body.error, {
      code: "VALIDATION_ERROR",
      message: "La petición no es válida.",
      details: [{ path: "/name", message: "must NOT have fewer than 2 characters", keyword: "minLength" }],
    });
    assert.match(String(body.requestId), /^req-[0-9a-z]+$/);
  });

  it("falta de propiedad obligatoria: path vacío y mensaje con el nombre", async () => {
    const res = await t.api("POST", "/echo/5", { body: {} });
    assert.equal(res.status, 400);
    const details = (asRecord(asRecord(res.body).error).details as Array<Record<string, unknown>>)[0];
    assert.equal(details?.path, "");
    assert.equal(details?.keyword, "required");
    assert.match(String(details?.message), /required property 'name'/);
  });

  it("orden de validación: params, cuerpo y query (el primero que falla manda)", async () => {
    const firstPath = (body: unknown): string | undefined =>
      (asRecord(asRecord(body).error).details as Array<{ path: string }>)[0]?.path;
    const bad = await t.api("POST", "/echo/0?limit=999", { body: { name: "A" } });
    assert.equal(firstPath(bad.body), "/id");
    const second = await t.api("POST", "/echo/1?limit=999", { body: { name: "A" } });
    assert.equal(firstPath(second.body), "/name");
    const third = await t.api("POST", "/echo/1?limit=999", { body: { name: "Ana" } });
    assert.equal(firstPath(third.body), "/limit");
  });

  it("un segmento de ruta vacío casa con el parámetro y lo decide el esquema (como Fastify: /echo/ es un 400, no un 404)", async () => {
    const res = await t.api("POST", "/echo/", { body: { name: "Ana" } });
    assert.equal(res.status, 400);
    const details = (asRecord(asRecord(res.body).error).details as Array<Record<string, unknown>>)[0];
    assert.equal(details?.path, "/id");
    assert.equal(details?.keyword, "type");
    const withoutSlash = await t.api("POST", "/echo", { body: { name: "Ana" } });
    assert.equal(withoutSlash.status, 404, "sin la barra final es otra ruta");
  });

  it("la validación va ANTES que la autenticación (como Fastify): un cuerpo inválido sin sesión es 400, no 401", async () => {
    const res = await t.api("POST", "/echo/5", { body: {} });
    assert.equal(res.status, 400);
  });

  it("JSON mal formado es 400 VALIDATION_ERROR", async () => {
    const res = await t.api("POST", "/echo/5", { rawBody: "{no es json", headers: { "content-type": "application/json" } });
    assert.equal(res.status, 400);
    assert.equal(asRecord(asRecord(res.body).error).code, "VALIDATION_ERROR");
  });

  it("ApiFailure se convierte en el error del contrato, con details y cabeceras", async () => {
    const res = await t.api("GET", "/fail");
    assert.equal(res.status, 404);
    assert.deepEqual(asRecord(res.body).error, { code: "THING_NOT_FOUND", message: "Thing not found", details: { id: 7 } });
    const limited = await t.api("GET", "/failheaders");
    assert.equal(limited.status, 429);
    assert.equal(limited.headers["retry-after"], "30");
    assert.equal("details" in asRecord(asRecord(limited.body).error), false);
  });

  it("una excepción inesperada es 500 INTERNAL_ERROR genérico y se anota", async () => {
    const res = await t.api("GET", "/boom");
    assert.equal(res.status, 500);
    assert.deepEqual(asRecord(res.body).error, { code: "INTERNAL_ERROR", message: "Internal server error" });
    assert.equal(silenced.length, 1);
  });

  it("reply.created / accepted / noContent fijan 201 / 202 / 204 (sin cuerpo ni content-type)", async () => {
    assert.equal((await t.api("POST", "/created")).status, 201);
    assert.equal((await t.api("POST", "/accepted")).status, 202);
    const empty = await t.api("POST", "/nocontent");
    assert.equal(empty.status, 204);
    assert.equal(empty.text, "");
    assert.equal(empty.headers["content-type"], undefined);
  });

  it("filtra la respuesta con el schema declarado, como fast-json-stringify", async () => {
    const res = await t.api("GET", "/filtered");
    assert.deepEqual(res.body, { id: "1", nested: { keep: "sí" } });
  });

  it("autenticación: AUTH_REQUIRED, AUTH_INVALID y AUTH_INVALID_OR_EXPIRED", async () => {
    const none = await t.api("GET", "/secure");
    assert.equal(none.status, 401);
    assert.equal(asRecord(asRecord(none.body).error).code, "AUTH_REQUIRED");
    const malformed = await t.api("GET", "/secure", { headers: { authorization: "Basic abc" } });
    assert.equal(malformed.status, 401);
    assert.equal(asRecord(asRecord(malformed.body).error).code, "AUTH_INVALID");
    const unknown = await t.api("GET", "/secure", { token: "mvc_sess_desconocido" });
    assert.equal(unknown.status, 401);
    assert.equal(asRecord(asRecord(unknown.body).error).code, "AUTH_INVALID_OR_EXPIRED");
  });

  it("sesión válida: roles, authOptional y AUTH_FORBIDDEN al faltar el rol", async () => {
    const user = createUser(t.db, { phone: "+34611222333", roles: ["passenger"], displayName: "Prueba" });
    const { token } = createSession(t.db, user.id);
    const who = await t.api("GET", "/whoami", { token });
    assert.deepEqual(who.body, { roles: ["passenger"], optional: user.id });
    const guest = await t.api("GET", "/whoami");
    assert.equal(guest.status, 401, "whoami usa auth(): sin sesión no pasa");
    const forbidden = await t.api("GET", "/admin-only", { token });
    assert.equal(forbidden.status, 403);
    assert.deepEqual(asRecord(forbidden.body).error, { code: "AUTH_FORBIDDEN", message: "Insufficient permissions" });
  });

  it("una sesión caducada con el reloj virtual deja de valer", async () => {
    const user = createUser(t.db, { phone: "+34611222444", roles: ["passenger"] });
    const { token } = createSession(t.db, user.id, { ttlSeconds: 60 });
    assert.equal((await t.api("GET", "/secure", { token })).status, 200);
    t.db.clock.advance(61_000);
    const res = await t.api("GET", "/secure", { token });
    assert.equal(res.status, 401);
    assert.equal(asRecord(asRecord(res.body).error).code, "AUTH_INVALID_OR_EXPIRED");
  });

  describe("idempotencia (Idempotency-Key)", () => {
    const KEY = "11111111-1111-4111-8111-111111111111";
    let token: string;
    let otherToken: string;

    beforeEach(() => {
      token = createSession(t.db, createUser(t.db, { phone: "+34611222501", roles: ["passenger"] }).id).token;
      otherToken = createSession(t.db, createUser(t.db, { phone: "+34611222502", roles: ["passenger"] }).id).token;
    });

    it("misma clave y cuerpo repite la respuesta; cuerpo distinto es 422; caduca a las 24 h", async () => {
      const headers = { "idempotency-key": KEY };
      const first = await t.api("POST", "/idem", { token, headers, body: { a: 1 } });
      assert.equal(first.status, 201);
      assert.deepEqual(asRecord(first.body).n, 1);
      const replay = await t.api("POST", "/idem", { token, headers, body: { a: 1 } });
      assert.equal(replay.status, 201);
      assert.equal(asRecord(replay.body).n, 1, "se repite la respuesta original, el manejador no se ejecuta otra vez");
      assert.equal(replay.headers["idempotency-replayed"], "true");
      assert.equal(first.headers["idempotency-replayed"], undefined);
      const conflict = await t.api("POST", "/idem", { token, headers, body: { a: 2 } });
      assert.equal(conflict.status, 422);
      assert.equal(asRecord(asRecord(conflict.body).error).code, "IDEMPOTENCY_KEY_REUSED");
      t.db.clock.advance(24 * 3_600_000 + 1000);
      const afterTtl = await t.api("POST", "/idem", { token, headers, body: { a: 2 } });
      assert.equal(afterTtl.status, 201);
      assert.equal(asRecord(afterTtl.body).n, 2, "pasadas 24 h la clave se olvida");
    });

    it("sin clave de idempotencia cada petición ejecuta el manejador", async () => {
      const a = await t.api("POST", "/idem", { token, body: { a: 1 } });
      const b = await t.api("POST", "/idem", { token, body: { a: 1 } });
      assert.equal(asRecord(a.body).n, 1);
      assert.equal(asRecord(b.body).n, 2);
    });

    it("el orden de las claves del cuerpo no importa; la clave es de cada usuario", async () => {
      const headers = { "idempotency-key": KEY };
      const first = await t.api("POST", "/idem", { token, headers, body: { a: 1, b: { x: 1, y: 2 } } });
      const swapped = await t.api("POST", "/idem", { token, headers, body: { b: { y: 2, x: 1 }, a: 1 } });
      assert.equal(swapped.headers["idempotency-replayed"], "true");
      assert.equal(asRecord(swapped.body).n, asRecord(first.body).n);
      const other = await t.api("POST", "/idem", { token: otherToken, headers, body: { a: 9 } });
      assert.equal(other.status, 201, "otro usuario con la misma clave no choca");
      assert.equal(other.headers["idempotency-replayed"], undefined);
    });

    it("los errores no se guardan: el reintento con la misma clave se evalúa de nuevo", async () => {
      const headers = { "idempotency-key": KEY };
      const failed = await t.api("POST", "/idem-flaky", { token, headers, body: { a: 1 } });
      assert.equal(failed.status, 409);
      assert.equal(failed.headers["idempotency-replayed"], undefined);
      const retry = await t.api("POST", "/idem-flaky", { token, headers, body: { a: 1 } });
      assert.equal(retry.status, 201, "el segundo intento ejecuta el manejador (no repite el 409)");
      const again = await t.api("POST", "/idem-flaky", { token, headers, body: { a: 1 } });
      assert.equal(again.headers["idempotency-replayed"], "true");
      assert.equal(asRecord(again.body).n, 2);
    });

    it("modo opcional: una clave con formato inválido es 400 IDEMPOTENCY_KEY_INVALID, pero antes se comprueba la sesión", async () => {
      const bad = await t.api("POST", "/idem", { token, headers: { "idempotency-key": "corta" }, body: {} });
      assert.equal(bad.status, 400);
      assert.equal(asRecord(asRecord(bad.body).error).code, "IDEMPOTENCY_KEY_INVALID");
      const noSession = await t.api("POST", "/idem", { headers: { "idempotency-key": "corta" }, body: {} });
      assert.equal(noSession.status, 401, "sin sesión responde el manejador (AUTH_REQUIRED), no el 400 de la clave");
      assert.equal(asRecord(asRecord(noSession.body).error).code, "AUTH_REQUIRED");
    });

    it("modo «required»: falta o formato inválido es 400 IDEMPOTENCY_KEY_REQUIRED; la clave es del usuario y no de la ruta", async () => {
      const missing = await t.api("POST", "/pay", { token, body: { cents: 100 } });
      assert.equal(missing.status, 400);
      assert.equal(asRecord(asRecord(missing.body).error).code, "IDEMPOTENCY_KEY_REQUIRED");
      const bad = await t.api("POST", "/pay", { token, headers: { "idempotency-key": "con espacios y más" }, body: { cents: 100 } });
      assert.equal(asRecord(asRecord(bad.body).error).code, "IDEMPOTENCY_KEY_REQUIRED");

      const headers = { "idempotency-key": KEY };
      const first = await t.api("POST", "/pay", { token, headers, body: { cents: 100 } });
      assert.equal(first.status, 201);
      const replay = await t.api("POST", "/pay", { token, headers, body: { cents: 100 } });
      assert.equal(replay.headers["idempotency-replayed"], "true");
      assert.equal(asRecord(replay.body).n, 1);
      const otherBody = await t.api("POST", "/pay", { token, headers, body: { cents: 200 } });
      assert.equal(otherBody.status, 422);
      const otherRoute = await t.api("POST", "/pay-other", { token, headers, body: { cents: 100 } });
      assert.equal(otherRoute.status, 422, "la misma clave en otra operación es un conflicto");
      assert.equal(asRecord(asRecord(otherRoute.body).error).code, "IDEMPOTENCY_KEY_REUSED");
      const otherUser = await t.api("POST", "/pay", { token: otherToken, headers, body: { cents: 100 } });
      assert.equal(otherUser.status, 201, "las claves son por usuario");
    });
  });

  it("el manejador ve la hora VIRTUAL, no la del sistema", async () => {
    const res = await t.api("GET", "/now");
    const body = asRecord(res.body);
    assert.equal(body.ms, body.db);
    assert.equal(body.iso, new Date(Number(body.ms)).toISOString());
    assert.equal(body.iso, "2026-10-05T05:17:00.000Z", "lunes 5 de octubre de 2026, 07:17 en Madrid (UTC+2)");
  });

  it("el registro de peticiones guarda método, ruta, estado y marca simulated", async () => {
    await t.api("GET", "/ping");
    await t.api("GET", "/fail");
    const entries = t.server.log.entries();
    assert.equal(entries.length, 2);
    assert.deepEqual(
      entries.map((e) => [e.method, e.path, e.status, e.simulated]),
      [
        ["GET", "/ping", 200, true],
        ["GET", "/fail", 404, true],
      ]
    );
    assert.ok(router.size() > 10);
  });
});
