// Pruebas de la descarga del justificante imprimible (HTML real y HTML dentro de una cadena JSON de la vista previa).
// Ejecutar:  cd mobile && node --import tsx --test "src/features/account/money/**/*.test.ts"
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { configureApi, resetApiConfig } from "@/api/client";
import { setAccessToken, setNetworkOffline } from "@/api/runtime";
import { decodeHtmlBody, fetchHtmlDocument } from "./printable";

const HTML = "<!doctype html><html><body><h1>Justificante</h1></body></html>";
const realFetch = globalThis.fetch;

function respond(body: string, init: { status?: number; contentType: string }): void {
  globalThis.fetch = (async () =>
    new Response(body, { status: init.status ?? 200, headers: { "content-type": init.contentType } })) as typeof fetch;
}

beforeEach(() => {
  configureApi({ baseUrl: "https://api.test" });
  setAccessToken("mvc_sess_test");
  setNetworkOffline(false);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  resetApiConfig();
  setAccessToken(null);
  setNetworkOffline(false);
});

describe("decodeHtmlBody", () => {
  it("acepta el HTML tal cual (backend real)", () => {
    assert.equal(decodeHtmlBody(HTML, "text/html; charset=utf-8"), HTML);
  });

  it("decodifica el HTML dentro de una cadena JSON (vista previa)", () => {
    assert.equal(decodeHtmlBody(JSON.stringify(HTML), "application/json; charset=utf-8"), HTML);
  });

  it("rechaza lo que no es un documento HTML", () => {
    assert.equal(decodeHtmlBody("", "text/html"), null);
    assert.equal(decodeHtmlBody('{"error":"x"}', "application/json"), null);
    assert.equal(decodeHtmlBody("texto suelto", "text/plain"), null);
    assert.equal(decodeHtmlBody('"sin cerrar', "application/json"), null);
    assert.equal(decodeHtmlBody("12", "application/json"), null);
  });
});

describe("fetchHtmlDocument", () => {
  it("devuelve el documento del backend real con el token de la sesión", async () => {
    let seen: { url: string; authorization: string | null } | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen = { url: String(input), authorization: new Headers(init?.headers).get("authorization") };
      return new Response(HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    }) as typeof fetch;
    assert.equal(await fetchHtmlDocument("/v1/me/receipts/abc/printable"), HTML);
    assert.deepEqual(seen, { url: "https://api.test/v1/me/receipts/abc/printable", authorization: "Bearer mvc_sess_test" });
  });

  it("entiende la respuesta de la vista previa (HTML serializado como JSON)", async () => {
    respond(JSON.stringify(HTML), { contentType: "application/json; charset=utf-8" });
    assert.equal(await fetchHtmlDocument("/v1/me/receipts/abc/printable"), HTML);
  });

  it("traduce el error del contrato a ApiError con su código", async () => {
    respond(JSON.stringify({ error: { code: "RECEIPT_NOT_FOUND", message: "x" }, requestId: "req-1" }), { status: 404, contentType: "application/json" });
    await assert.rejects(fetchHtmlDocument("/v1/me/receipts/zzz/printable"), (error: unknown) => {
      const e = error as { kind?: string; code?: string; status?: number; requestId?: string };
      return e.kind === "api" && e.code === "RECEIPT_NOT_FOUND" && e.status === 404 && e.requestId === "req-1";
    });
  });

  it("un 401 con token es sesión caducada", async () => {
    respond(JSON.stringify({ error: { code: "AUTH_INVALID_OR_EXPIRED", message: "x" } }), { status: 401, contentType: "application/json" });
    await assert.rejects(fetchHtmlDocument("/v1/me/receipts/abc/printable"), (error: unknown) => (error as { kind?: string }).kind === "auth_expired");
  });

  it("sin red falla como sin conexión, también si fetch lanza", async () => {
    setNetworkOffline(true);
    await assert.rejects(fetchHtmlDocument("/v1/me/receipts/abc/printable"), (error: unknown) => (error as { kind?: string }).kind === "offline");
    setNetworkOffline(false);
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await assert.rejects(fetchHtmlDocument("/v1/me/receipts/abc/printable"), (error: unknown) => (error as { kind?: string }).kind === "offline");
  });

  it("una respuesta 200 que no es HTML es INVALID_RESPONSE", async () => {
    respond("hola", { contentType: "text/plain" });
    await assert.rejects(fetchHtmlDocument("/v1/me/receipts/abc/printable"), (error: unknown) => (error as { code?: string }).code === "INVALID_RESPONSE");
  });

  it("la cancelación del llamador no es un fallo", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(fetchHtmlDocument("/v1/me/receipts/abc/printable", { signal: controller.signal }), (error: unknown) => (error as { name?: string }).name === "AbortError");
  });
});
