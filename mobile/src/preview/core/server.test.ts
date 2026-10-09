/**
 * Servidor simulado: fallos inyectados (503, 429, corte de red, timeouts, cancelación) y almacenamiento privado
 * `storage.mvc-preview.invalid` (subida firmada, descarga, caducidad de la URL, tipos y tamaños que no cuadran).
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { SEED_USER_IDS, SEED_VEHICLE_IDS } from "../seeds";
import { asArray, asRecord, clearShell, createApi, str, testRuntime } from "../testing/harness";
import { SIMULATION_HEADER } from "./server";

afterEach(() => clearShell());

function driver() {
  const rt = testRuntime({ profile: "driver" });
  return { rt, api: createApi(rt), token: rt.sessionToken() ?? "", fetch: rt.createFetch() };
}

describe("fallos inyectados (addFault)", () => {
  it("por defecto es un 503 SERVICE_UNAVAILABLE con requestId y marca de simulación", async () => {
    const { rt, api } = driver();
    rt.server.addFault({ path: "/v1/trips/search" });
    const res = await api("GET", "/v1/trips/search");
    assert.equal(res.status, 503);
    const body = asRecord(res.body);
    assert.equal(asRecord(body.error).code, "SERVICE_UNAVAILABLE");
    assert.match(str(body.requestId), /^req-[0-9a-z]+$/);
    assert.ok(res.headers[SIMULATION_HEADER] === undefined, "el fallo inyectado no pasa por la tubería normal");
    assert.equal(rt.server.log.last()?.status, 503);
  });

  it("status, código, mensaje y detalles a medida; times limita cuántas veces; el resto de rutas no se ven afectadas", async () => {
    const { rt, api } = driver();
    rt.server.addFault({ method: "POST", path: "/v1/auth/phone/start", status: 429, code: "RATE_LIMITED", message: "Demasiados intentos", details: { retryAfterS: 30 }, times: 1 });
    const limited = await api("POST", "/v1/auth/phone/start", { body: { phone: "+34622000111" } });
    assert.equal(limited.status, 429);
    assert.deepEqual(asRecord(limited.body).error, { code: "RATE_LIMITED", message: "Demasiados intentos", details: { retryAfterS: 30 } });
    assert.equal((await api("GET", "/health/live")).status, 200, "otra ruta responde con normalidad");
    const next = await api("POST", "/v1/auth/phone/start", { body: { phone: "+34622000111" } });
    assert.equal(next.status, 202, "tras agotarse times, la petición llega al manejador");
  });

  it("el método y la ruta (texto exacto o expresión regular) deciden a qué peticiones afecta", async () => {
    const { rt, api, token } = driver();
    rt.server.addFault({ method: "GET", path: /^\/v1\/me\//, status: 502, code: "BAD_GATEWAY" });
    assert.equal((await api("GET", "/v1/me/vehicles", { token })).status, 502);
    assert.equal((await api("GET", "/v1/me/trips", { token })).status, 502);
    assert.equal((await api("GET", "/me", { token })).status, 200, "/me no empieza por /v1/me/");
    assert.equal((await api("PATCH", "/v1/me/profile", { token, body: { displayName: "Ana García López" } })).status, 200, "otro método");
  });

  it("networkError rechaza con TypeError «Failed to fetch» (como un corte de red) y queda anotado sin estado", async () => {
    const { rt, fetch } = driver();
    rt.server.addFault({ path: "/health/ready", networkError: true, times: 1 });
    await assert.rejects(
      () => fetch("https://api.mvc-preview.invalid/health/ready"),
      (error: unknown) => error instanceof TypeError && /Failed to fetch/.test(error.message)
    );
    const entry = rt.server.log.last();
    assert.equal(entry?.status, null);
    assert.match(entry?.error ?? "", /TypeError/);
    assert.equal((await fetch("https://api.mvc-preview.invalid/health/ready")).status, 200);
  });

  it("delayMs simula un servidor lento y la cancelación de la app lo interrumpe con AbortError", async () => {
    const { rt, fetch } = driver();
    rt.server.addFault({ path: "/health/live", delayMs: 5_000, status: 504 });
    const controller = new AbortController();
    const started = Date.now();
    const pending = fetch("https://api.mvc-preview.invalid/health/live", { signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    await assert.rejects(pending, (error: unknown) => error instanceof Error && error.name === "AbortError");
    assert.ok(Date.now() - started < 1_000, "no esperó los 5 s");
    assert.equal(rt.server.inFlight, 0);
  });

  it("la función devuelta retira el fallo y clearFaults retira todos", async () => {
    const { rt, api } = driver();
    const remove = rt.server.addFault({ path: "/health/live", status: 500 });
    rt.server.addFault({ path: "/health/ready", status: 500 });
    assert.equal((await api("GET", "/health/live")).status, 500);
    remove();
    assert.equal((await api("GET", "/health/live")).status, 200);
    assert.equal((await api("GET", "/health/ready")).status, 500);
    rt.server.clearFaults();
    assert.equal((await api("GET", "/health/ready")).status, 200);
  });

  it("las reglas se aplican en orden y cada una cuenta sus propios usos", async () => {
    const { rt, api } = driver();
    rt.server.addFault({ path: "/health/live", status: 500, code: "PRIMERO", times: 1 });
    rt.server.addFault({ path: "/health/live", status: 503, code: "SEGUNDO", times: 1 });
    const codes: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await api("GET", "/health/live");
      codes.push(res.status === 200 ? "ok" : str(asRecord(asRecord(res.body).error).code));
    }
    assert.deepEqual(codes, ["PRIMERO", "SEGUNDO", "ok"]);
  });
});

describe("almacenamiento privado simulado", () => {
  async function intent(ctx: ReturnType<typeof driver>, sizeBytes: number, kind = "vehicle_photo", contentType = "image/jpeg") {
    const res = await ctx.api("POST", "/v1/me/uploads/intents", {
      token: ctx.token,
      body: { kind, vehicleId: SEED_VEHICLE_IDS.anaArona, contentType, sizeBytes },
    });
    assert.equal(res.status, 201);
    const body = asRecord(res.body);
    return { id: str(body.intentId), url: str(body.uploadUrl), headers: body.headers as Record<string, string> };
  }

  it("subir con la URL firmada, completar y descargar devuelve exactamente los mismos bytes", async () => {
    const ctx = driver();
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const up = await intent(ctx, bytes.byteLength);
    assert.match(up.url, /^https:\/\/storage\.mvc-preview\.invalid\/users\/[^?]+\.jpg\?op=upload&sig=[^&]+&exp=\d+$/);
    assert.deepEqual(up.headers, { "content-type": "image/jpeg" });

    const put = await ctx.fetch(up.url, { method: "PUT", headers: up.headers, body: bytes });
    assert.equal(put.status, 200);
    assert.match(put.headers.get("etag") ?? "", /^"[0-9a-f]{32}"$/);
    assert.ok(put.headers.get(SIMULATION_HEADER), "también el almacén se declara simulación");

    const complete = await ctx.api("POST", `/v1/me/uploads/${up.id}/complete`, { token: ctx.token });
    assert.equal(complete.status, 200);
    const doc = asRecord(asRecord(complete.body).document);
    assert.equal(doc.kind, "vehicle_photo");
    assert.equal(doc.size_bytes, String(bytes.byteLength), "bigint como texto en el cable");
    assert.equal(doc.review_status, "pending");
    assert.match(str(doc.sha256), /^[0-9a-f]{64}$/);

    const download = await ctx.api("GET", `/v1/me/documents/${str(doc.id)}/download`, { token: ctx.token });
    const url = str(asRecord(download.body).url);
    assert.match(url, /\?op=download&/);
    const got = await ctx.fetch(url);
    assert.equal(got.status, 200);
    assert.equal(got.headers.get("content-type"), "image/jpeg");
    assert.deepEqual([...new Uint8Array(await got.arrayBuffer())], [...bytes]);
  });

  it("un tipo de contenido distinto del firmado se rechaza (403 SignatureDoesNotMatch en XML) y no guarda nada", async () => {
    const ctx = driver();
    const up = await intent(ctx, 4);
    const res = await ctx.fetch(up.url, { method: "PUT", headers: { "content-type": "image/png" }, body: new Uint8Array(4) });
    assert.equal(res.status, 403);
    assert.match(res.headers.get("content-type") ?? "", /xml/);
    assert.match(await res.text(), /<Code>SignatureDoesNotMatch<\/Code>/);
    assert.equal(ctx.rt.db.blobs.has(up.url.split("?")[0]?.replace("https://storage.mvc-preview.invalid/", "") ?? ""), false);
  });

  it("sin firma, firma caducada o clave sin subida autorizada: 403 AccessDenied", async () => {
    const ctx = driver();
    const up = await intent(ctx, 4);
    const bare = up.url.split("?")[0] ?? "";
    const noSig = await ctx.fetch(bare, { method: "PUT", headers: up.headers, body: new Uint8Array(4) });
    assert.equal(noSig.status, 403);
    assert.match(await noSig.text(), /<Code>AccessDenied<\/Code>/);

    const unknown = await ctx.fetch("https://storage.mvc-preview.invalid/users/nadie/otra.jpg?op=upload&sig=x&exp=9999999999", {
      method: "PUT",
      headers: up.headers,
      body: new Uint8Array(4),
    });
    assert.equal(unknown.status, 403, "sin intención de subida para esa clave");

    ctx.rt.db.clock.advance(11 * 60_000);
    const late = await ctx.fetch(up.url, { method: "PUT", headers: up.headers, body: new Uint8Array(4) });
    assert.equal(late.status, 403);
    assert.match(await late.text(), /Request has expired/);
  });

  it("una URL de descarga no sirve para subir ni al revés; métodos no permitidos son 405; una clave desconocida, 404", async () => {
    const ctx = driver();
    const up = await intent(ctx, 4);
    const asDownload = up.url.replace("op=upload", "op=download");
    assert.equal((await ctx.fetch(asDownload, { method: "PUT", headers: up.headers, body: new Uint8Array(4) })).status, 403);
    assert.equal((await ctx.fetch(up.url, { method: "GET" })).status, 403, "descargar con la URL de subida");
    assert.equal((await ctx.fetch(up.url, { method: "DELETE" })).status, 405);
    const missing = await ctx.fetch("https://storage.mvc-preview.invalid/users/x/y.jpg?op=download&sig=x&exp=9999999999");
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /<Code>NoSuchKey<\/Code>/);
  });

  it("completar sin haber subido nada es el 500 del backend real; con otro tamaño, 422 UPLOADED_FILE_SIZE_MISMATCH", async () => {
    const ctx = driver();
    const empty = await intent(ctx, 8);
    const none = await ctx.api("POST", `/v1/me/uploads/${empty.id}/complete`, { token: ctx.token });
    assert.equal(none.status, 500);
    assert.equal(asRecord(asRecord(none.body).error).code, "INTERNAL_ERROR");

    const sized = await intent(ctx, 8);
    await ctx.fetch(sized.url, { method: "PUT", headers: sized.headers, body: new Uint8Array(5) });
    const mismatch = await ctx.api("POST", `/v1/me/uploads/${sized.id}/complete`, { token: ctx.token });
    assert.equal(mismatch.status, 422);
    assert.equal(asRecord(asRecord(mismatch.body).error).code, "UPLOADED_FILE_SIZE_MISMATCH");
    assert.deepEqual(asRecord(asRecord(mismatch.body).error).details, { expected: 8, actual: 5 });
  });

  it("completar dos veces la misma subida es idempotente (alreadyCompleted)", async () => {
    const ctx = driver();
    const up = await intent(ctx, 3);
    await ctx.fetch(up.url, { method: "PUT", headers: up.headers, body: new Uint8Array(3) });
    const first = asRecord((await ctx.api("POST", `/v1/me/uploads/${up.id}/complete`, { token: ctx.token })).body);
    const second = asRecord((await ctx.api("POST", `/v1/me/uploads/${up.id}/complete`, { token: ctx.token })).body);
    assert.equal(first.alreadyCompleted, false);
    assert.equal(second.alreadyCompleted, true);
    assert.equal(asRecord(second.document).id, asRecord(first.document).id);
  });

  it("el seguro subido no se analiza (OCR desactivado, como el backend sin proveedor)", async () => {
    const ctx = driver();
    const up = await intent(ctx, 12, "vehicle_insurance", "application/pdf");
    await ctx.fetch(up.url, { method: "PUT", headers: up.headers, body: new Uint8Array(12) });
    const done = asRecord((await ctx.api("POST", `/v1/me/uploads/${up.id}/complete`, { token: ctx.token })).body);
    assert.deepEqual(done.analysis, { status: "pending", provider: "disabled" });
    assert.equal(asRecord(done.document).detected_expires_on, null);
  });

  it("un documento sembrado se descarga como un marcador SVG que dice que es de ejemplo (nunca un documento real)", async () => {
    const ctx = driver();
    const seeded = ctx.rt.db.documents.find((d) => d.owner_user_id === SEED_USER_IDS.ana && d.kind === "vehicle_registration");
    assert.ok(seeded);
    const download = await ctx.api("GET", `/v1/me/documents/${seeded.id}/download`, { token: ctx.token });
    const res = await ctx.fetch(str(asRecord(download.body).url));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/svg+xml");
    const text = await res.text();
    assert.match(text, /Documento de ejemplo/);
    assert.match(text, /Simulación de la vista previa/);
  });

  it("los documentos de otra persona no se pueden descargar (404) y se ven los propios, el más reciente primero", async () => {
    const ctx = driver();
    const miguelDoc = ctx.rt.db.documents.find((d) => d.owner_user_id !== SEED_USER_IDS.ana);
    assert.ok(miguelDoc);
    const other = await ctx.api("GET", `/v1/me/documents/${miguelDoc.id}/download`, { token: ctx.token });
    assert.equal(other.status, 404);
    assert.equal(asRecord(asRecord(other.body).error).code, "DOCUMENT_NOT_FOUND");

    const up = await intent(ctx, 2);
    await ctx.fetch(up.url, { method: "PUT", headers: up.headers, body: new Uint8Array(2) });
    await ctx.api("POST", `/v1/me/uploads/${up.id}/complete`, { token: ctx.token });
    const list = asArray(asRecord((await ctx.api("GET", "/v1/me/documents", { token: ctx.token })).body).documents, "documents").map((d) => asRecord(d));
    assert.equal(list[0]?.size_bytes, "2", "el recién subido va primero");
    assert.ok(list.length > 1);
  });
});
