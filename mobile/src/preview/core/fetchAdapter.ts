/**
 * Adaptador entre `fetch` y el servidor simulado: convierte una llamada a `fetch(input, init)` en una `RawRequest`,
 * la despacha y devuelve un `Response` estándar. Lo que no es del API ni del almacenamiento reservados pasa al `fetch`
 * original (que en el visor es el que bloquea cualquier salida a Internet).
 */
import type { PreviewServer, RawRequest, RawResponse } from "./server";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];
export type FetchLike = (input: FetchInput, init?: FetchInit) => Promise<Response>;

function headersToRecord(headers: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    for (const pair of headers as Array<[string, string]>) {
      if (pair.length >= 2) out[String(pair[0]).toLowerCase()] = String(pair[1]);
    }
    return out;
  }
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (value !== undefined && value !== null) out[key.toLowerCase()] = String(value);
  }
  return out;
}

function urlOf(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (typeof URL !== "undefined" && input instanceof URL) return input.toString();
  return (input as Request).url;
}

async function toRawRequest(input: FetchInput, init: FetchInit): Promise<RawRequest> {
  const url = urlOf(input);
  let method = "GET";
  let headers: Record<string, string> = {};
  let body: unknown;
  let signal: AbortSignal | null = null;

  const isRequest = typeof input !== "string" && !(typeof URL !== "undefined" && input instanceof URL);
  if (isRequest) {
    const request = input as Request;
    method = request.method;
    headers = headersToRecord(request.headers);
    signal = request.signal ?? null;
    if (init?.body === undefined && request.body !== null && method !== "GET" && method !== "HEAD") {
      body = await request.clone().arrayBuffer();
    }
  }
  if (init) {
    if (init.method) method = init.method;
    if (init.headers) headers = { ...headers, ...headersToRecord(init.headers) };
    if (init.body !== undefined && init.body !== null) body = init.body;
    if (init.signal) signal = init.signal;
  }
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
    headers["content-type"] ??= "application/x-www-form-urlencoded;charset=UTF-8";
    body = body.toString();
  }
  return { method: method.toUpperCase(), url, headers, body, signal };
}

const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

export function toResponse(raw: RawResponse): Response {
  const nullBody = raw.body === null || NULL_BODY_STATUS.has(raw.status);
  // Borde tipado: `Uint8Array` es un `BodyInit` válido en navegadores y Node; los tipos DOM más recientes lo discuten.
  const body = nullBody ? null : (raw.body as unknown as BodyInit);
  return new Response(body, { status: raw.status, headers: raw.headers });
}

/** `fetch` que atiende el API y el almacenamiento simulados y delega todo lo demás en `original`. */
export function createInterceptingFetch(server: PreviewServer, original: FetchLike | undefined): FetchLike {
  return async function previewFetch(input, init) {
    if (server.classify(urlOf(input)) === null) {
      if (!original) throw new TypeError("Failed to fetch");
      return original(input, init);
    }
    const release = server.hold();
    try {
      const raw = await toRawRequest(input, init);
      const response = await server.dispatch(raw);
      return toResponse(response);
    } finally {
      release();
    }
  };
}
