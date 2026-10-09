import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  ApiError,
  AuthExpiredError,
  OfflineError,
  TimeoutError,
  apiRequest,
  apiRequestDetailed,
  buildQueryString,
  buildUrl,
  checkApiHealth,
  computeBackoffMs,
  configureApi,
  parseErrorPayload,
  parseRetryAfter,
  resetApiConfig,
  resolveApiUrl,
  shouldRetry,
} from "./client";
import { isAbortError } from "./errors";
import { onAuthExpired, setAccessToken, setNetworkOffline, type AuthExpiredEvent } from "./runtime";

type FetchCall = { url: string; init: RequestInit };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function installFetch(handler: (call: FetchCall, index: number) => Promise<Response> | Response): FetchCall[] {
  const calls: FetchCall[] = [];
  configureApi({
    baseUrl: "https://api.test",
    retryBaseDelayMs: 1,
    random: () => 0.5,
    fetchImpl: ((url: string, init: RequestInit) => {
      const call = { url, init };
      calls.push(call);
      try {
        return Promise.resolve(handler(call, calls.length - 1));
      } catch (error) {
        return Promise.reject(error);
      }
    }) as typeof fetch,
  });
  return calls;
}

/** fetch que nunca responde: solo termina rechazando con AbortError cuando se aborta su signal. */
function installHangingFetch(): FetchCall[] {
  return installFetch(
    (call) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = call.init.signal as AbortSignal;
        signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })
  );
}

function headersOf(call: FetchCall): Record<string, string> {
  return call.init.headers as Record<string, string>;
}

beforeEach(() => {
  setAccessToken(null);
  setNetworkOffline(false);
});

afterEach(() => {
  resetApiConfig();
  setAccessToken(null);
  setNetworkOffline(false);
});

describe("resolveApiUrl", () => {
  it("usa EXPO_PUBLIC_API_URL sin barras finales", () => {
    assert.equal(resolveApiUrl("https://api.mvc.es///", undefined), "https://api.mvc.es");
  });
  it("sin URL y sin vista previa → vacío (la app avisa de que no está configurada)", () => {
    assert.equal(resolveApiUrl(undefined, undefined), "");
    assert.equal(resolveApiUrl("  ", "0"), "");
  });
  it("en vista previa cae a un origen reservado que no resuelve", () => {
    assert.equal(resolveApiUrl(undefined, "1"), "https://api.preview.mvc.invalid");
    assert.equal(resolveApiUrl("http://192.168.1.5:3000", "1"), "http://192.168.1.5:3000");
  });
});

describe("buildQueryString / buildUrl", () => {
  it("omite null/undefined, codifica y repite arrays", () => {
    assert.equal(
      buildQueryString({ a: 1, b: "x y", c: undefined, d: null, e: ["p", "q"], f: false }),
      "?a=1&b=x%20y&e=p&e=q&f=false"
    );
    assert.equal(buildQueryString({}), "");
    assert.equal(buildQueryString(undefined), "");
  });
  it("une query a una ruta que ya tiene ?", () => {
    assert.equal(buildUrl("https://x", "/v1/a", { n: 1 }), "https://x/v1/a?n=1");
    assert.equal(buildUrl("https://x", "/v1/a?z=0", { n: 1 }), "https://x/v1/a?z=0&n=1");
    assert.equal(buildUrl("https://x", "v1/a"), "https://x/v1/a");
  });
});

describe("parseErrorPayload", () => {
  it("formato del contrato", () => {
    const parsed = parseErrorPayload(409, {
      error: { code: "NO_CAPACITY_ON_SEGMENT", message: "No capacity", details: { seq: 3 } },
      requestId: "req-1",
    });
    assert.deepEqual(parsed, {
      code: "NO_CAPACITY_ON_SEGMENT",
      message: "No capacity",
      details: { seq: 3 },
      requestId: "req-1",
    });
  });
  it("formato Fastify: validación, rate-limit y 404", () => {
    assert.equal(
      parseErrorPayload(400, { statusCode: 400, code: "FST_ERR_VALIDATION", error: "Bad Request", message: "body/phone short" }).code,
      "VALIDATION_ERROR"
    );
    assert.equal(
      parseErrorPayload(429, { statusCode: 429, error: "Too Many Requests", message: "Rate limit exceeded" }).code,
      "RATE_LIMITED"
    );
    assert.equal(parseErrorPayload(404, { message: "Route GET:/x not found", error: "Not Found", statusCode: 404 }).code, "NOT_FOUND");
  });
  it("texto plano o cuerpo ausente", () => {
    assert.deepEqual(parseErrorPayload(502, "Bad Gateway"), { code: "INTERNAL_ERROR", message: "Bad Gateway" });
    assert.deepEqual(parseErrorPayload(503, undefined), { code: "INTERNAL_ERROR", message: "HTTP 503" });
  });
  it("código ausente en el objeto de error → código por estado", () => {
    assert.equal(parseErrorPayload(403, { error: { message: "no" } }).code, "AUTH_FORBIDDEN");
  });
});

describe("parseRetryAfter / computeBackoffMs / shouldRetry", () => {
  it("Retry-After en segundos y en fecha HTTP", () => {
    assert.equal(parseRetryAfter("3"), 3);
    assert.equal(parseRetryAfter(null), undefined);
    assert.equal(parseRetryAfter("basura"), undefined);
    const inTenSeconds = new Date(Date.now() + 10_000).toUTCString();
    const parsed = parseRetryAfter(inTenSeconds);
    assert.ok(parsed !== undefined && parsed >= 8 && parsed <= 10);
  });
  it("backoff exponencial acotado, con jitter ±25 %", () => {
    assert.equal(computeBackoffMs({ attempt: 0, random: () => 0.5 }), 400);
    assert.equal(computeBackoffMs({ attempt: 1, random: () => 0.5 }), 800);
    assert.equal(computeBackoffMs({ attempt: 10, random: () => 0.5 }), 4000);
    assert.equal(computeBackoffMs({ attempt: 0, random: () => 0 }), 300);
    assert.equal(computeBackoffMs({ attempt: 0, random: () => 1 }), 500);
  });
  it("respeta Retry-After si es mayor que el backoff", () => {
    assert.equal(computeBackoffMs({ attempt: 0, random: () => 0.5, retryAfterS: 2 }), 2000);
  });
  it("solo GET se reintenta; nunca POST/PUT/PATCH/DELETE", () => {
    const offline = new OfflineError();
    assert.equal(shouldRetry("GET", offline, 0, 2), true);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      assert.equal(shouldRetry(method, offline, 0, 2), false, method);
    }
  });
  it("solo fallos transitorios; se agota con el máximo", () => {
    assert.equal(shouldRetry("GET", new TimeoutError(10), 0, 2), true);
    assert.equal(shouldRetry("GET", new ApiError("x", "X", 503), 1, 2), true);
    assert.equal(shouldRetry("GET", new ApiError("x", "X", 502), 0, 2), true);
    assert.equal(shouldRetry("GET", new ApiError("x", "X", 400), 0, 2), false);
    assert.equal(shouldRetry("GET", new ApiError("x", "X", 404), 0, 2), false);
    assert.equal(shouldRetry("GET", new ApiError("x", "X", 500), 0, 2), false);
    assert.equal(shouldRetry("GET", new AuthExpiredError(), 0, 2), false);
    assert.equal(shouldRetry("GET", new OfflineError(), 2, 2), false);
    assert.equal(shouldRetry("GET", new ApiError("x", "X", 429, undefined, undefined, 60), 0, 2), false);
    assert.equal(shouldRetry("GET", new ApiError("x", "X", 429, undefined, undefined, 2), 0, 2), true);
  });
});

describe("apiRequest: éxito", () => {
  it("GET con token de sesión, query y cabeceras", async () => {
    setAccessToken("mvc_sess_abc");
    const calls = installFetch(() => jsonResponse({ ok: true }));
    const result = await apiRequest<{ ok: boolean }>("/v1/trips/search", { query: { limit: 5, q: "x y" } });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "https://api.test/v1/trips/search?limit=5&q=x%20y");
    const headers = headersOf(calls[0] as FetchCall);
    assert.equal(headers.authorization, "Bearer mvc_sess_abc");
    assert.equal(headers.accept, "application/json");
    assert.equal(headers["content-type"], undefined);
    assert.equal(calls[0]?.init.method, "GET");
  });

  it("token: null no envía Authorization aunque haya sesión; token explícito manda sobre la sesión", async () => {
    setAccessToken("mvc_sess_session");
    const calls = installFetch(() => jsonResponse({}));
    await apiRequest("/a", { token: null });
    await apiRequest("/b", { token: "mvc_sess_explicit" });
    assert.equal(headersOf(calls[0] as FetchCall).authorization, undefined);
    assert.equal(headersOf(calls[1] as FetchCall).authorization, "Bearer mvc_sess_explicit");
  });

  it("POST serializa JSON y envía Idempotency-Key", async () => {
    const calls = installFetch(() => jsonResponse({ id: "1" }, 201));
    const result = await apiRequest<{ id: string }>("/v1/trips/1/requests", {
      method: "POST",
      body: { fromSegmentSeq: 0, toSegmentSeq: 2 },
      idempotencyKey: "key-123",
    });
    assert.deepEqual(result, { id: "1" });
    const headers = headersOf(calls[0] as FetchCall);
    assert.equal(headers["content-type"], "application/json");
    assert.equal(headers["idempotency-key"], "key-123");
    assert.equal(calls[0]?.init.body, JSON.stringify({ fromSegmentSeq: 0, toSegmentSeq: 2 }));
  });

  it("204 y cuerpo vacío → undefined", async () => {
    installFetch(() => new Response(null, { status: 204 }));
    assert.equal(await apiRequest<void>("/v1/auth/logout", { method: "POST" }), undefined);
  });

  it("apiRequestDetailed devuelve estado y x-request-id", async () => {
    installFetch(() => jsonResponse({ a: 1 }, 200, { "x-request-id": "rid-9" }));
    const response = await apiRequestDetailed<{ a: number }>("/x");
    assert.equal(response.status, 200);
    assert.equal(response.requestId, "rid-9");
    assert.deepEqual(response.data, { a: 1 });
    assert.ok(response.durationMs >= 0);
  });

  it("200 que no es JSON → ApiError INVALID_RESPONSE", async () => {
    installFetch(() => new Response("<html>", { status: 200 }));
    await assert.rejects(apiRequest("/x"), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "INVALID_RESPONSE");
      return true;
    });
  });

  it("sin URL base configurada → API_NOT_CONFIGURED", async () => {
    configureApi({ baseUrl: "" });
    await assert.rejects(apiRequest("/x"), (error: unknown) => error instanceof ApiError && error.code === "API_NOT_CONFIGURED");
  });
});

describe("apiRequest: errores", () => {
  it("4xx con cuerpo del contrato → ApiError con código, detalles y requestId", async () => {
    installFetch(() =>
      jsonResponse({ error: { code: "TRIP_NOT_BOOKABLE", message: "Trip is not bookable", details: { why: 1 } }, requestId: "r-1" }, 409)
    );
    await assert.rejects(apiRequest("/x", { method: "POST", body: {} }), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "TRIP_NOT_BOOKABLE");
      assert.deepEqual(error.details, { why: 1 });
      assert.equal(error.requestId, "r-1");
      return true;
    });
  });

  it("requestId de la cabecera si el cuerpo no lo trae", async () => {
    installFetch(() => jsonResponse({ error: { code: "X", message: "m" } }, 400, { "x-request-id": "hdr-1" }));
    await assert.rejects(apiRequest("/x"), (error: unknown) => error instanceof ApiError && error.requestId === "hdr-1");
  });

  it("401 CON token → AuthExpiredError y evento authExpired (una sola vez)", async () => {
    const events: AuthExpiredEvent[] = [];
    const off = onAuthExpired((event) => events.push(event));
    setAccessToken("mvc_sess_old");
    installFetch(() => jsonResponse({ error: { code: "AUTH_INVALID_OR_EXPIRED", message: "x" }, requestId: "r" }, 401));
    await assert.rejects(apiRequest("/me"), (error: unknown) => {
      assert.ok(error instanceof AuthExpiredError);
      assert.equal(error.serverCode, "AUTH_INVALID_OR_EXPIRED");
      return true;
    });
    off();
    assert.deepEqual(events, [{ token: "mvc_sess_old", code: "AUTH_INVALID_OR_EXPIRED", requestId: "r" }]);
  });

  it("401 SIN token (código SMS incorrecto, invitado) → ApiError normal, sin evento", async () => {
    const events: AuthExpiredEvent[] = [];
    const off = onAuthExpired((event) => events.push(event));
    installFetch(() => jsonResponse({ error: { code: "AUTH_CODE_INVALID_OR_EXPIRED", message: "bad" } }, 401));
    await assert.rejects(
      apiRequest("/v1/auth/phone/verify", { method: "POST", token: null, body: {} }),
      (error: unknown) => error instanceof ApiError && !(error instanceof AuthExpiredError) && error.code === "AUTH_CODE_INVALID_OR_EXPIRED"
    );
    off();
    assert.equal(events.length, 0);
  });

  it("authExpiry: 'ignore' lanza AuthExpiredError pero no emite el evento", async () => {
    const events: AuthExpiredEvent[] = [];
    const off = onAuthExpired((event) => events.push(event));
    installFetch(() => jsonResponse({ error: { code: "AUTH_INVALID", message: "x" } }, 401));
    await assert.rejects(apiRequest("/me", { token: "mvc_sess_t", authExpiry: "ignore" }), (e: unknown) => e instanceof AuthExpiredError);
    off();
    assert.equal(events.length, 0);
  });

  it("fallo de red → OfflineError; GET se reintenta 2 veces (3 intentos)", async () => {
    const calls = installFetch(() => {
      throw new TypeError("Network request failed");
    });
    await assert.rejects(apiRequest("/x"), (error: unknown) => error instanceof OfflineError);
    assert.equal(calls.length, 3);
  });

  it("POST con fallo de red NO se reintenta (1 intento)", async () => {
    const calls = installFetch(() => {
      throw new TypeError("Network request failed");
    });
    await assert.rejects(apiRequest("/x", { method: "POST", body: {}, retries: 5 }), (error: unknown) => error instanceof OfflineError);
    assert.equal(calls.length, 1);
  });

  it("GET: 503 y luego 200 → éxito en el 2.º intento", async () => {
    const calls = installFetch((_call, index) => (index === 0 ? jsonResponse({ error: { code: "X", message: "m" } }, 503) : jsonResponse({ ok: 1 })));
    assert.deepEqual(await apiRequest("/x"), { ok: 1 });
    assert.equal(calls.length, 2);
  });

  it("GET: 400 no se reintenta", async () => {
    const calls = installFetch(() => jsonResponse({ error: { code: "INVALID_X", message: "m" } }, 400));
    await assert.rejects(apiRequest("/x"), (error: unknown) => error instanceof ApiError && error.code === "INVALID_X");
    assert.equal(calls.length, 1);
  });

  it("retries: 0 desactiva el reintento de GET", async () => {
    const calls = installFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    await assert.rejects(apiRequest("/x", { retries: 0 }), (error: unknown) => error instanceof OfflineError);
    assert.equal(calls.length, 1);
  });

  it("timeout → TimeoutError (no AbortError)", async () => {
    installHangingFetch();
    await assert.rejects(apiRequest("/x", { timeoutMs: 20, retries: 0 }), (error: unknown) => {
      assert.ok(error instanceof TimeoutError);
      assert.equal(error.timeoutMs, 20);
      return true;
    });
  });

  it("GET con timeout se reintenta", async () => {
    const calls = installHangingFetch();
    await assert.rejects(apiRequest("/x", { timeoutMs: 15, retries: 1 }), (error: unknown) => error instanceof TimeoutError);
    assert.equal(calls.length, 2);
  });

  it("cancelación del llamador → AbortError (no Timeout/Offline) y sin reintentos", async () => {
    const calls = installHangingFetch();
    const controller = new AbortController();
    const pending = apiRequest("/x", { signal: controller.signal, timeoutMs: 5_000 });
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(pending, (error: unknown) => isAbortError(error));
    assert.equal(calls.length, 1);
  });

  it("signal ya abortada → AbortError sin llamar a fetch", async () => {
    const calls = installFetch(() => jsonResponse({}));
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(apiRequest("/x", { signal: controller.signal }), (error: unknown) => isAbortError(error));
    assert.equal(calls.length, 0);
  });

  it("red caída forzada → OfflineError inmediato, sin fetch ni reintentos", async () => {
    const calls = installFetch(() => jsonResponse({}));
    setNetworkOffline(true);
    await assert.rejects(apiRequest("/x"), (error: unknown) => error instanceof OfflineError);
    assert.equal(calls.length, 0);
  });
});

describe("checkApiHealth", () => {
  it("online / offline / unconfigured", async () => {
    installFetch(() => jsonResponse({ status: "ok" }));
    assert.equal(await checkApiHealth(), "online");
    installFetch(() => jsonResponse({}, 503));
    assert.equal(await checkApiHealth(), "offline");
    installFetch(() => {
      throw new TypeError("Network request failed");
    });
    assert.equal(await checkApiHealth(), "offline");
    configureApi({ baseUrl: "" });
    assert.equal(await checkApiHealth(), "unconfigured");
  });
});
