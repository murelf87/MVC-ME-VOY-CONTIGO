/**
 * Servidor HTTP simulado: recibe una petición `fetch`, la enruta y responde con el MISMO contrato que el backend.
 *
 *   fetch(app) → interceptor → [offline?] → [latencia 80–250 ms] → [fallos inyectados] → ruta → validación →
 *   manejador → respuesta JSON (o error `{ error:{code,message,details?}, requestId }`)
 *
 * SIMULACIÓN: cada respuesta lleva la cabecera `x-mvc-simulation` y cada entrada del registro `simulated: true`.
 */
import { requireAnyRole, readBearerToken, resolveSession } from "./auth";
import type { PreviewDb } from "./db";
import { ApiFailure, abortError, errorBody, networkFailure, notFoundBody } from "./errors";
import { IDEMPOTENCY_TTL_MS, fingerprint, readIdempotencyKey, type IdempotencyMode } from "./idempotency";
import { RequestLog, clip, type RequestLogEntry } from "./log";
import {
  isPreviewReply,
  type PreviewReply,
  type PreviewRequest,
  type PreviewRouter,
  type RawBody,
  type RouteSchema,
} from "./router";
import { validateSchema, type JsonSchema, type ValidationIssue } from "./schema";
import { sha256Hex } from "./sha256";
import { isShellOffline, pickLatencyMs, readShell } from "./shell";
import { STORAGE_HOST } from "./storage";
import { handleStorageRequest } from "./storageHandler";
import type { HttpMethod, Principal, UserRole } from "./types";

export const SIMULATION_HEADER = "x-mvc-simulation";
export const SIMULATION_NOTICE = "preview-backend (simulacion en memoria; no es un servidor de produccion)";

/**
 * Orígenes reservados que la app puede usar como `API_URL` en la vista previa: el de la asignación, el de reserva
 * del cliente (`PREVIEW_FALLBACK_API_URL`) y el que fija `npm run preview:artifact` (`EXPO_PUBLIC_API_URL`).
 * `install.ts` añade además el host de `process.env.EXPO_PUBLIC_API_URL` si es otro.
 */
export const DEFAULT_API_HOSTS: readonly string[] = ["api.mvc-preview.invalid", "api.preview.mvc.invalid", "preview.mvc.local"];

export interface RawRequest {
  method: string;
  /** URL absoluta (`https://api.mvc-preview.invalid/v1/…?x=1`). */
  url: string;
  /** Cabeceras en minúsculas. */
  headers: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal | null;
}

export interface RawResponse {
  status: number;
  headers: Record<string, string>;
  /** Texto (JSON) o bytes; `null` si no hay cuerpo. */
  body: string | Uint8Array | null;
}

export interface FaultRule {
  /** Método (`*` = cualquiera). */
  method?: HttpMethod | "*";
  /** Ruta exacta o expresión regular sobre la ruta (sin query). */
  path: string | RegExp;
  /** Código HTTP a devolver. */
  status?: number;
  code?: string;
  message?: string;
  details?: unknown;
  /** Simula un corte de red (la promesa rechaza con TypeError) en vez de una respuesta. */
  networkError?: boolean;
  /** Cuántas veces se aplica (por defecto, todas hasta `clear`). */
  times?: number;
  /** Espera extra antes de responder (timeouts). */
  delayMs?: number;
}

interface ActiveFault extends FaultRule {
  remaining: number;
}

export interface PreviewServerOptions {
  db: PreviewDb;
  router: PreviewRouter;
  /** Nombres de host del API a interceptar. */
  apiHosts?: readonly string[];
  /** Latencia por defecto en ms [mín, máx]; `0` la desactiva (pruebas). */
  latency?: number | readonly [number, number];
}

export class PreviewServer {
  readonly db: PreviewDb;
  readonly router: PreviewRouter;
  readonly log = new RequestLog();
  private readonly apiHosts: Set<string>;
  private readonly defaultLatency: number | readonly [number, number];
  private faults: ActiveFault[] = [];
  private pending = 0;
  /** Aleatorio SOLO para la latencia (no toca el azar determinista del mundo). */
  private latencyRandom: () => number = Math.random;

  constructor(options: PreviewServerOptions) {
    this.db = options.db;
    this.router = options.router;
    this.apiHosts = new Set((options.apiHosts ?? DEFAULT_API_HOSTS).map((h) => h.toLowerCase()));
    this.defaultLatency = options.latency ?? [80, 250];
  }

  // ---- configuración ----

  addApiHost(host: string): void {
    this.apiHosts.add(host.toLowerCase());
  }

  setLatencyRandom(random: () => number): void {
    this.latencyRandom = random;
  }

  /** Inyecta un fallo (p. ej. 503 en `/v1/trips/search` una vez). Devuelve la función que lo retira. */
  addFault(rule: FaultRule): () => void {
    const fault: ActiveFault = { ...rule, remaining: rule.times ?? Number.POSITIVE_INFINITY };
    this.faults.push(fault);
    return () => {
      this.faults = this.faults.filter((f) => f !== fault);
    };
  }

  clearFaults(): void {
    this.faults = [];
  }

  // ---- clasificación de URL ----

  /** ¿Esta URL la sirve la vista previa? `null` = no (pasa al `fetch` original). */
  classify(url: string): "api" | "storage" | null {
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return null;
    }
    if (host === STORAGE_HOST || (host.startsWith("storage.") && host.endsWith(".invalid"))) return "storage";
    if (this.apiHosts.has(host) || (host.startsWith("api.") && host.endsWith(".invalid"))) return "api";
    return null;
  }

  // ---- pipeline ----

  /** Peticiones en curso (para «esperar a que la red esté inactiva»). */
  get inFlight(): number {
    return this.pending;
  }

  /**
   * Cuenta una petición como «en curso» desde el mismo instante en que `fetch` se llama (antes de leer el cuerpo, que es
   * asíncrono). Devuelve la función que la cierra; es idempotente.
   */
  hold(): () => void {
    this.pending += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.pending -= 1;
    };
  }

  async dispatch(raw: RawRequest): Promise<RawResponse> {
    this.pending += 1;
    try {
      return await this.run(raw);
    } finally {
      this.pending -= 1;
    }
  }

  private async run(raw: RawRequest): Promise<RawResponse> {
    const origin = this.classify(raw.url) ?? "api";
    const started = realNow();
    const requestId = this.db.ids.requestId();
    const seq = this.log.nextSeq();
    const method = raw.method.toUpperCase();
    const url = new URL(raw.url);
    const entryBase = {
      seq,
      requestId,
      method,
      url: raw.url,
      path: url.pathname,
      origin,
      simulated: true as const,
    };

    let latencyMs = 0;
    let requestBody: unknown;
    const finish = (response: RawResponse | null, error?: string): void => {
      const entry: RequestLogEntry = {
        ...entryBase,
        status: response ? response.status : null,
        durationMs: realNow() - started,
        virtualTime: this.db.clock.iso(),
        hostTime: started,
        latencyMs,
        ...(requestBody !== undefined ? { requestBody: clip(requestBody) } : {}),
        ...(response && typeof response.body === "string" && response.body
          ? { responseBody: clip(parseJsonSafe(response.body)) }
          : {}),
        ...(error ? { error } : {}),
      };
      this.log.push(entry);
      try {
        readShell().onRequest?.(entry);
      } catch {
        // un oyente del visor defectuoso no debe romper la petición
      }
    };

    try {
      if (isShellOffline()) throw networkFailure();
      if (raw.signal?.aborted) throw abortError();

      latencyMs = this.currentLatency();
      if (latencyMs > 0) await sleep(latencyMs, raw.signal ?? null);
      if (raw.signal?.aborted) throw abortError();
      if (isShellOffline()) throw networkFailure();

      const fault = this.takeFault(method, url.pathname);
      if (fault) {
        if (fault.delayMs) await sleep(fault.delayMs, raw.signal ?? null);
        if (fault.networkError) throw networkFailure();
        const status = fault.status ?? 503;
        const response = jsonResponse(
          status,
          errorBody(
            fault.code ?? (status >= 500 ? "SERVICE_UNAVAILABLE" : "INJECTED_FAULT"),
            fault.message ?? "Fallo inyectado por la vista previa (simulación).",
            requestId,
            fault.details
          )
        );
        finish(response);
        return response;
      }

      const response =
        origin === "storage"
          ? await handleStorageRequest(this.db, { method, url, headers: raw.headers, body: raw.body }, requestId)
          : await this.handleApi(method, url, raw, requestId, (body) => {
              requestBody = body;
            });
      response.headers[SIMULATION_HEADER] = SIMULATION_NOTICE;
      finish(response);
      return response;
    } catch (error) {
      finish(null, error instanceof Error ? `${error.name}: ${error.message}` : String(error));
      throw error;
    }
  }

  private currentLatency(): number {
    if (this.defaultLatency === 0) return 0;
    return pickLatencyMs(this.latencyRandom, typeof this.defaultLatency === "number" ? [this.defaultLatency, this.defaultLatency] : this.defaultLatency);
  }

  private takeFault(method: string, path: string): ActiveFault | null {
    for (const fault of this.faults) {
      if (fault.remaining <= 0) continue;
      if (fault.method && fault.method !== "*" && fault.method !== method) continue;
      const matches = typeof fault.path === "string" ? fault.path === path : fault.path.test(path);
      if (!matches) continue;
      fault.remaining -= 1;
      return fault;
    }
    return null;
  }

  /**
   * Prelude de las rutas con `Idempotency-Key` (`core/idempotency.ts`). Solo con sesión válida: el backend autentica antes de
   * leer la clave y la guarda por usuario; sin sesión responde el manejador (401). Devuelve `null` si no hay clave que aplicar.
   */
  private beginIdempotency(request: PreviewRequest, mode: IdempotencyMode): IdempotencyState | null {
    if (!request.headers.authorization) return null;
    let userId: string;
    try {
      userId = request.auth().userId;
    } catch {
      return null;
    }
    const key = readIdempotencyKey(request.header("idempotency-key"), mode);
    if (key === null) return null;
    const operation = `${request.method} ${request.path}`;
    // «optional» (trips): la clave es de la operación y el recurso; «required» (money): la clave es del usuario y otra ruta u otro
    // cuerpo con la misma clave es un conflicto.
    const id = sha256Hex(mode === "required" ? `${userId}|${key}` : `${userId}|${operation}|${key}`);
    const hash = fingerprint(mode === "required" ? { operation, body: request.body } : request.body);
    const found = this.db.collection<IdempotencyRow>("idempotency_keys").get(id);
    if (!found || found.expires_at <= this.db.nowMs()) return { id, key, hash, replay: null };
    if (found.body_hash !== hash) {
      throw new ApiFailure(
        "IDEMPOTENCY_KEY_REUSED",
        mode === "required"
          ? "Esta Idempotency-Key ya se usó con otra operación o con otro cuerpo."
          : "Esa clave de idempotencia ya se usó con una petición distinta.",
        422
      );
    }
    return {
      id,
      key,
      hash,
      replay: {
        status: found.status,
        headers: {
          ...(found.body ? { "content-type": "application/json; charset=utf-8" } : {}),
          "idempotency-replayed": "true",
        },
        body: found.body,
      },
    };
  }

  /** Solo se guardan las respuestas correctas (2xx): un error se evalúa de nuevo en el reintento, como en el backend. */
  private storeIdempotency(state: IdempotencyState, response: RawResponse): void {
    if (response.status < 200 || response.status >= 300) return;
    const store = this.db.collection<IdempotencyRow>("idempotency_keys");
    const now = this.db.nowMs();
    if (store.has(state.id)) store.delete(state.id);
    store.insert({
      id: state.id,
      key: state.key,
      body_hash: state.hash,
      status: response.status,
      body: typeof response.body === "string" ? response.body : null,
      created_at: now,
      expires_at: now + IDEMPOTENCY_TTL_MS,
    });
  }

  private async handleApi(
    method: string,
    url: URL,
    raw: RawRequest,
    requestId: string,
    onBody: (body: unknown) => void
  ): Promise<RawResponse> {
    // Reglas que dependen del tiempo (holds caducados…) antes de leer o escribir nada.
    this.db.jobs.run(this.db);

    const matched = this.router.match(method, url.pathname);
    if (!matched) return jsonResponse(404, notFoundBody(method, url.pathname));

    const { route } = matched;
    const schema: RouteSchema = route.schema;
    const headers = raw.headers;

    // ---- cuerpo ----
    let body: unknown;
    let rawBody: RawBody | null = null;
    const contentType = headers["content-type"] ?? "";
    if (raw.body !== undefined && raw.body !== null) {
      if (typeof raw.body === "string") {
        if (raw.body.length > 0) {
          if (contentType.includes("json") || /^\s*[{[]/.test(raw.body)) {
            try {
              body = JSON.parse(raw.body);
            } catch {
              return jsonResponse(
                400,
                errorBody("VALIDATION_ERROR", "La petición no se pudo interpretar.", requestId)
              );
            }
          } else {
            rawBody = { bytes: new TextEncoder().encode(raw.body), contentType };
          }
        }
      } else {
        const bytes = await toBytes(raw.body);
        if (bytes) rawBody = { bytes, contentType };
      }
    }
    onBody(body);

    // ---- validación (params, body, query, headers) ----
    const params = validatePart(schema.params, matched.params);
    if (params.failure) return validationResponse(params.failure, requestId);
    const bodyResult = validatePart(schema.body, body);
    if (bodyResult.failure) return validationResponse(bodyResult.failure, requestId);
    const query = validatePart(schema.querystring, queryObject(url.searchParams));
    if (query.failure) return validationResponse(query.failure, requestId);
    const headerResult = validatePart(schema.headers, headers);
    if (headerResult.failure) return validationResponse(headerResult.failure, requestId);

    const db = this.db;
    let cachedPrincipal: Principal | undefined;
    const authorization = headers.authorization;
    const request: PreviewRequest = {
      method: method as HttpMethod,
      path: url.pathname,
      url,
      params: params.value as Record<string, string>,
      query: query.value as Record<string, unknown>,
      body: bodyResult.value,
      rawBody,
      headers,
      requestId,
      signal: raw.signal ?? null,
      db,
      now: () => db.clock.now(),
      nowMs: () => db.clock.nowMs(),
      header: (name) => headers[name.toLowerCase()],
      auth: () => {
        cachedPrincipal ??= resolveSession(db, readBearerToken(authorization));
        return cachedPrincipal;
      },
      authOptional: () => {
        if (!authorization) return null;
        cachedPrincipal ??= resolveSession(db, readBearerToken(authorization));
        return cachedPrincipal;
      },
      requireRole: (principal: Principal, allowed: readonly UserRole[]) => requireAnyRole(principal, allowed),
    };

    try {
      const idempotency = route.idempotent ? this.beginIdempotency(request, route.idempotent) : null;
      if (idempotency?.replay) return idempotency.replay;
      const outcome = await route.handler(request);
      const response = finalize(outcome, schema);
      if (idempotency) this.storeIdempotency(idempotency, response);
      return response;
    } catch (error) {
      if (error instanceof ApiFailure) {
        return jsonResponse(error.statusCode, errorBody(error.code, error.message, requestId, error.details), error.headers);
      }
      // Igual que el manejador global del backend: cualquier otro fallo es un 500 genérico. Se anota en la consola
      // del navegador (solo existe en la vista previa) para que un defecto de un manejador no pase desapercibido.
      reportUnexpected(error, method, url.pathname);
      return jsonResponse(500, errorBody("INTERNAL_ERROR", "Internal server error", requestId));
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------------------------

interface IdempotencyRow {
  id: string;
  key: string;
  body_hash: string;
  status: number;
  body: string | null;
  created_at: number;
  expires_at: number;
}

interface IdempotencyState {
  id: string;
  key: string;
  hash: string;
  /** Respuesta original guardada, si la clave ya se usó con el mismo cuerpo. */
  replay: RawResponse | null;
}

function realNow(): number {
  return Date.now();
}

function sleep(ms: number, signal: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Anota un fallo inesperado de un manejador. Las pruebas pueden silenciarlo con `setUnexpectedErrorReporter`. */
let unexpectedReporter: (error: unknown, method: string, path: string) => void = (error, method, path) => {
  if (typeof console !== "undefined") console.error(`[mvc-preview] error inesperado en ${method} ${path}`, error);
};

export function setUnexpectedErrorReporter(reporter: (error: unknown, method: string, path: string) => void): void {
  unexpectedReporter = reporter;
}

function reportUnexpected(error: unknown, method: string, path: string): void {
  try {
    unexpectedReporter(error, method, path);
  } catch {
    // el aviso nunca debe romper la respuesta
  }
}

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function queryObject(search: URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(search.keys())) {
    const all = search.getAll(key);
    out[key] = all.length > 1 ? all : all[0];
  }
  return out;
}

async function toBytes(body: unknown): Promise<Uint8Array | null> {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof Blob !== "undefined" && body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  return null;
}

interface PartResult {
  value: unknown;
  failure?: ValidationIssue;
}

function validatePart(schema: JsonSchema | undefined, value: unknown): PartResult {
  if (!schema) return { value };
  const result = validateSchema(schema, value);
  if (result.ok) return { value: result.value };
  return { value, failure: result.issues[0] as ValidationIssue };
}

function validationResponse(issue: ValidationIssue, requestId: string): RawResponse {
  // Los módulos nuevos del backend (trips, live, money, comms, trust) responden 400 VALIDATION_ERROR con
  // `details: [{ path: <instancePath de Ajv>, message: <mensaje de Ajv>, keyword }]`; el manejador global del backend
  // 0.14 (auth, perfil, vehículos, subidas…) devuelve 500 INTERNAL_ERROR para el mismo fallo. Se sigue a los módulos.
  return jsonResponse(
    400,
    errorBody("VALIDATION_ERROR", "La petición no es válida.", requestId, [
      { path: issue.instancePath, message: issue.message, keyword: issue.keyword },
    ])
  );
}

export function jsonResponse(status: number, body: unknown, extra: Readonly<Record<string, string>> = {}): RawResponse {
  const headers: Record<string, string> = { ...extra };
  if (status === 204 || status === 205 || status === 304 || body === undefined) {
    return { status, headers, body: null };
  }
  headers["content-type"] = "application/json; charset=utf-8";
  return { status, headers, body: JSON.stringify(body) };
}

function finalize(outcome: unknown, schema: RouteSchema): RawResponse {
  const response: PreviewReply = isPreviewReply(outcome) ? outcome : ({ status: 200, body: outcome, headers: {} } as PreviewReply);
  const responseSchema = schema.response?.[response.status];
  const body = responseSchema ? serializeResponse(responseSchema, response.body) : response.body;
  return jsonResponse(response.status, body, response.headers);
}

/** Filtra el cuerpo como fast-json-stringify de Fastify: solo salen las propiedades que declara el schema. */
export function serializeResponse(schema: JsonSchema, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return schema.items ? value.map((item) => serializeResponse(schema.items as JsonSchema, item)) : value;
  }
  if (typeof value === "object" && schema.properties) {
    const out: Record<string, unknown> = {};
    for (const [key, sub] of Object.entries(schema.properties)) {
      const candidate = (value as Record<string, unknown>)[key];
      if (candidate !== undefined) out[key] = serializeResponse(sub, candidate);
    }
    if (schema.additionalProperties === true || (typeof schema.additionalProperties === "object" && schema.additionalProperties)) {
      for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
        if (!(key in schema.properties) && candidate !== undefined) out[key] = candidate;
      }
    }
    return out;
  }
  return value;
}
