import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ApiError, OfflineError, TimeoutError } from "./errors";
import { setNetworkOffline } from "./runtime";
import { putToSignedUrl } from "./signedUpload";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  setNetworkOffline(false);
});

interface Call {
  url: string;
  init?: RequestInit;
}

function stubFetch(handler: (call: Call) => Promise<Response> | Response): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    try {
      return Promise.resolve(handler(call));
    } catch (error) {
      return Promise.reject(error);
    }
  }) as typeof fetch;
  return calls;
}

describe("putToSignedUrl", () => {
  it("lee el archivo local y lo sube con PUT, content-type y cabeceras firmadas, SIN Authorization", async () => {
    const calls = stubFetch((call) =>
      call.url === "file:///tmp/foto.jpg" ? new Response("JPEGDATA", { status: 200 }) : new Response(null, { status: 200 })
    );
    await putToSignedUrl(
      { uploadUrl: "https://bucket.test/obj?sig=1", headers: { "x-amz-meta-a": "b" } },
      { uri: "file:///tmp/foto.jpg", contentType: "image/jpeg" }
    );
    assert.equal(calls.length, 2);
    const put = calls[1] as Call;
    assert.equal(put.url, "https://bucket.test/obj?sig=1");
    assert.equal(put.init?.method, "PUT");
    const headers = put.init?.headers as Record<string, string>;
    assert.equal(headers["content-type"], "image/jpeg");
    assert.equal(headers["x-amz-meta-a"], "b");
    assert.equal(headers.authorization, undefined);
  });

  it("las cabeceras firmadas del intent mandan sobre content-type", async () => {
    const calls = stubFetch(() => new Response("x", { status: 200 }));
    await putToSignedUrl(
      { uploadUrl: "https://b.test/o", headers: { "content-type": "image/png" } },
      { uri: "blob:abc", contentType: "image/jpeg" }
    );
    assert.equal((calls[1]?.init?.headers as Record<string, string>)["content-type"], "image/png");
  });

  it("respuesta no 2xx → PRIVATE_UPLOAD_FAILED con el estado HTTP", async () => {
    stubFetch((call) => (call.url.startsWith("file:") ? new Response("x") : new Response("denied", { status: 403 })));
    await assert.rejects(
      putToSignedUrl({ uploadUrl: "https://b.test/o" }, { uri: "file:///x.jpg", contentType: "image/jpeg" }),
      (error: unknown) => error instanceof ApiError && error.code === "PRIVATE_UPLOAD_FAILED" && error.status === 403
    );
  });

  it("fallo de red en el PUT → OfflineError; archivo ilegible → LOCAL_FILE_UNREADABLE", async () => {
    stubFetch((call) => {
      if (call.url.startsWith("file:")) return new Response("x");
      throw new TypeError("Network request failed");
    });
    await assert.rejects(
      putToSignedUrl({ uploadUrl: "https://b.test/o" }, { uri: "file:///x.jpg", contentType: "image/jpeg" }),
      (error: unknown) => error instanceof OfflineError
    );
    stubFetch(() => {
      throw new TypeError("nope");
    });
    await assert.rejects(
      putToSignedUrl({ uploadUrl: "https://b.test/o" }, { uri: "file:///x.jpg", contentType: "image/jpeg" }),
      (error: unknown) => error instanceof ApiError && error.code === "LOCAL_FILE_UNREADABLE"
    );
  });

  it("timeout → TimeoutError", async () => {
    stubFetch(
      (call) =>
        new Promise<Response>((resolve, reject) => {
          if (call.url.startsWith("file:")) {
            resolve(new Response("x"));
            return;
          }
          (call.init?.signal as AbortSignal).addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        })
    );
    await assert.rejects(
      putToSignedUrl({ uploadUrl: "https://b.test/o" }, { uri: "file:///x.jpg", contentType: "image/jpeg" }, { timeoutMs: 20 }),
      (error: unknown) => error instanceof TimeoutError
    );
  });

  it("sin red forzada → OfflineError sin tocar fetch", async () => {
    const calls = stubFetch(() => new Response("x"));
    setNetworkOffline(true);
    await assert.rejects(
      putToSignedUrl({ uploadUrl: "https://b.test/o" }, { uri: "file:///x.jpg", contentType: "image/jpeg" }),
      (error: unknown) => error instanceof OfflineError
    );
    assert.equal(calls.length, 0);
  });
});
