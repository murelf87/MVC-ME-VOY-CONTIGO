/**
 * Router HTTP de la vista previa (API pública para los slices).
 *
 *   registerPreview(r: PreviewRouter, db: PreviewDb)  →  r.get / r.post / r.put / r.patch / r.delete
 *
 * Semántica (igual que Fastify, que es lo que sirve el backend real):
 *  - Orden del ciclo de vida: coincidencia de ruta → validación (params, body, query, headers) → manejador.
 *    La autenticación la hace el manejador (`req.auth()`), así que un cuerpo inválido se rechaza ANTES de comprobar
 *    la sesión, como en el backend.
 *  - Ruta o método inexistentes → 404 con el cuerpo por defecto de Fastify.
 *  - El valor que devuelve el manejador es la respuesta 200; usa `reply.created / accepted / noContent / status`
 *    para otro código. Lanzar `ApiFailure` (o `fail(...)`) produce el error JSON del contrato.
 *  - Una ruta duplicada es un ERROR (dos slices no pueden pisarse por accidente). Para sustituir a propósito un
 *    manejador ya registrado, usa `r.override(...)` (p. ej. los endpoints «ampliados» del contrato).
 */
import type { PreviewDb } from "./db";
import type { IdempotencyMode } from "./idempotency";
import type { JsonSchema } from "./schema";
import type { HttpMethod, Principal, UserRole } from "./types";
import { HTTP_METHODS } from "./types";

// ---------------------------------------------------------------------------------------------------------------
// Respuestas
// ---------------------------------------------------------------------------------------------------------------

const REPLY_BRAND = Symbol.for("mvc.preview.reply");

export class PreviewReply {
  readonly [REPLY_BRAND] = true;
  readonly status: number;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
  constructor(status: number, body?: unknown, headers: Record<string, string> = {}) {
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

export function isPreviewReply(value: unknown): value is PreviewReply {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[REPLY_BRAND] === true;
}

export const reply = {
  ok: (body: unknown, headers?: Record<string, string>) => new PreviewReply(200, body, headers),
  created: (body: unknown, headers?: Record<string, string>) => new PreviewReply(201, body, headers),
  accepted: (body: unknown, headers?: Record<string, string>) => new PreviewReply(202, body, headers),
  noContent: (headers?: Record<string, string>) => new PreviewReply(204, undefined, headers),
  status: (code: number, body?: unknown, headers?: Record<string, string>) => new PreviewReply(code, body, headers),
} as const;

// ---------------------------------------------------------------------------------------------------------------
// Petición
// ---------------------------------------------------------------------------------------------------------------

export interface RouteTypes {
  Params?: object;
  Query?: object;
  Body?: unknown;
}
type ParamsOf<T extends RouteTypes> = T extends { Params: infer P } ? P : Record<string, string>;
type QueryOf<T extends RouteTypes> = T extends { Query: infer Q } ? Q : Record<string, unknown>;
type BodyOf<T extends RouteTypes> = T extends { Body: infer B } ? B : unknown;

/** Cuerpo binario de una petición (subidas al almacenamiento privado simulado). */
export interface RawBody {
  bytes: Uint8Array;
  contentType: string;
}

export interface PreviewRequest<T extends RouteTypes = RouteTypes> {
  readonly method: HttpMethod;
  /** Ruta sin query: `/v1/trips/…/requests`. */
  readonly path: string;
  readonly url: URL;
  /** Parámetros de ruta ya validados y coercionados. */
  readonly params: ParamsOf<T>;
  /** Query ya validada y coercionada. */
  readonly query: QueryOf<T>;
  /** Cuerpo JSON ya validado (sin las propiedades no declaradas si el schema dice `additionalProperties: false`). */
  readonly body: BodyOf<T>;
  readonly rawBody: RawBody | null;
  /** Cabeceras en minúsculas. */
  readonly headers: Readonly<Record<string, string>>;
  readonly requestId: string;
  readonly signal: AbortSignal | null;
  readonly db: PreviewDb;
  now(): Date;
  nowMs(): number;
  header(name: string): string | undefined;
  /**
   * `readBearerToken` + `resolveSession` del backend: 401 `AUTH_REQUIRED` (sin cabecera), `AUTH_INVALID`
   * (token con forma inválida), `AUTH_INVALID_OR_EXPIRED` (desconocido / caducado / revocado); 403 `ACCOUNT_NOT_ACTIVE`.
   */
  auth(): Principal;
  /** Sin cabecera `Authorization` → `null` (modo invitado). Con cabecera inválida lanza igual que `auth()`. */
  authOptional(): Principal | null;
  /** `requireAnyRole`: 403 `AUTH_FORBIDDEN` «Insufficient permissions» si el usuario no tiene ninguno. */
  requireRole(principal: Principal, allowed: readonly UserRole[]): void;
}

export type RouteHandler<T extends RouteTypes = RouteTypes> = (
  request: PreviewRequest<T>
) => unknown | PreviewReply | Promise<unknown | PreviewReply>;

// ---------------------------------------------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------------------------------------------

export interface RouteSchema {
  params?: JsonSchema;
  querystring?: JsonSchema;
  body?: JsonSchema;
  headers?: JsonSchema;
  /** Por código de estado. Si existe el del código devuelto, la respuesta se filtra como hace Fastify (fast-json-stringify). */
  response?: Readonly<Record<number, JsonSchema>>;
}

export interface RouteOptions {
  schema?: RouteSchema;
  /** Resumen en español (documentación y `router.routes()`). */
  summary?: string;
  tags?: readonly string[];
  /**
   * Ruta de creación con `Idempotency-Key` (detalle en `core/idempotency.ts`). Misma clave + mismo cuerpo repite la respuesta
   * ORIGINAL con la cabecera `Idempotency-Replayed: true`; misma clave + cuerpo distinto → 422 `IDEMPOTENCY_KEY_REUSED`; los
   * errores no se guardan; las claves caducan a las 24 h (del reloj virtual) y valen por usuario.
   *
   *   `true`        estilo del módulo `trips`: cabecera opcional (sin ella no hay deduplicación).
   *   `"required"`  estilo del módulo `money`: obligatoria (falta o formato inválido → 400 `IDEMPOTENCY_KEY_REQUIRED`).
   */
  idempotent?: boolean | "required";
}

export interface RouteInfo {
  method: HttpMethod;
  pattern: string;
  summary: string | null;
  tags: readonly string[];
  owner: string;
}

export interface CompiledRoute extends RouteInfo {
  segments: ReadonlyArray<{ literal: string } | { param: string }>;
  schema: RouteSchema;
  idempotent: IdempotencyMode | null;
  handler: RouteHandler<RouteTypes>;
}

export interface RouteMatch {
  route: CompiledRoute;
  params: Record<string, string>;
}

class Registry {
  readonly byMethod = new Map<HttpMethod, CompiledRoute[]>();
  readonly all: CompiledRoute[] = [];
  constructor() {
    for (const method of HTTP_METHODS) this.byMethod.set(method, []);
  }
}

function compile(pattern: string): CompiledRoute["segments"] {
  if (!pattern.startsWith("/")) throw new Error(`La ruta debe empezar por «/»: ${pattern}`);
  if (pattern === "/") return [];
  return pattern
    .slice(1)
    .split("/")
    .map((part) => {
      if (part.startsWith(":")) {
        const name = part.slice(1);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Parámetro de ruta no válido en ${pattern}`);
        return { param: name };
      }
      return { literal: part };
    });
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function splitPath(path: string): string[] {
  if (path === "/") return [];
  return path.slice(1).split("/");
}

export class PreviewRouter {
  private readonly registry: Registry;
  private readonly owner: string;

  constructor(owner = "core", registry: Registry = new Registry()) {
    this.owner = owner;
    this.registry = registry;
  }

  /** Vista del mismo router cuyas rutas quedan etiquetadas con `owner` (diagnóstico de duplicados). */
  scoped(owner: string): PreviewRouter {
    return new PreviewRouter(owner, this.registry);
  }

  on<T extends RouteTypes = RouteTypes>(
    method: HttpMethod,
    pattern: string,
    optionsOrHandler: RouteOptions | RouteHandler<T>,
    maybeHandler?: RouteHandler<T>
  ): this {
    return this.add(method, pattern, optionsOrHandler, maybeHandler, false);
  }

  /** Sustituye un manejador ya registrado (falla si la ruta no existía: así un override nunca es un typo). */
  override<T extends RouteTypes = RouteTypes>(
    method: HttpMethod,
    pattern: string,
    optionsOrHandler: RouteOptions | RouteHandler<T>,
    maybeHandler?: RouteHandler<T>
  ): this {
    return this.add(method, pattern, optionsOrHandler, maybeHandler, true);
  }

  get<T extends RouteTypes = RouteTypes>(p: string, a: RouteOptions | RouteHandler<T>, b?: RouteHandler<T>): this {
    return this.on("GET", p, a, b);
  }
  post<T extends RouteTypes = RouteTypes>(p: string, a: RouteOptions | RouteHandler<T>, b?: RouteHandler<T>): this {
    return this.on("POST", p, a, b);
  }
  put<T extends RouteTypes = RouteTypes>(p: string, a: RouteOptions | RouteHandler<T>, b?: RouteHandler<T>): this {
    return this.on("PUT", p, a, b);
  }
  patch<T extends RouteTypes = RouteTypes>(p: string, a: RouteOptions | RouteHandler<T>, b?: RouteHandler<T>): this {
    return this.on("PATCH", p, a, b);
  }
  delete<T extends RouteTypes = RouteTypes>(p: string, a: RouteOptions | RouteHandler<T>, b?: RouteHandler<T>): this {
    return this.on("DELETE", p, a, b);
  }

  private add<T extends RouteTypes>(
    method: HttpMethod,
    pattern: string,
    optionsOrHandler: RouteOptions | RouteHandler<T>,
    maybeHandler: RouteHandler<T> | undefined,
    replace: boolean
  ): this {
    const handler = typeof optionsOrHandler === "function" ? optionsOrHandler : maybeHandler;
    const options: RouteOptions = typeof optionsOrHandler === "function" ? {} : optionsOrHandler;
    if (!handler) throw new Error(`Falta el manejador de ${method} ${pattern}`);

    const bucket = this.registry.byMethod.get(method);
    if (!bucket) throw new Error(`Método HTTP no soportado: ${method}`);
    const segments = compile(pattern);
    const signature = segments.map((s) => ("literal" in s ? s.literal : ":")).join("/");
    const existingIndex = bucket.findIndex(
      (r) => r.segments.map((s) => ("literal" in s ? s.literal : ":")).join("/") === signature
    );

    if (existingIndex >= 0 && !replace) {
      const existing = bucket[existingIndex] as CompiledRoute;
      throw new Error(
        `Ruta duplicada ${method} ${pattern}: ya la registró «${existing.owner}». Usa r.override(...) si quieres sustituirla.`
      );
    }
    if (existingIndex < 0 && replace) {
      throw new Error(`override(${method} ${pattern}): no hay ninguna ruta registrada que sustituir.`);
    }

    const route: CompiledRoute = {
      method,
      pattern,
      summary: options.summary ?? null,
      tags: options.tags ?? [],
      owner: this.owner,
      segments,
      schema: options.schema ?? {},
      idempotent: options.idempotent === "required" ? "required" : options.idempotent === true ? "optional" : null,
      handler: handler as unknown as RouteHandler<RouteTypes>,
    };
    if (existingIndex >= 0) {
      const old = bucket[existingIndex] as CompiledRoute;
      bucket[existingIndex] = route;
      this.registry.all[this.registry.all.indexOf(old)] = route;
    } else {
      bucket.push(route);
      this.registry.all.push(route);
    }
    return this;
  }

  /** Busca la ruta de un método y una ruta (sin query). Gana la más específica (literal antes que parámetro). */
  match(method: string, path: string): RouteMatch | null {
    const bucket = this.registry.byMethod.get(method as HttpMethod);
    if (!bucket) return null;
    const parts = splitPath(path);
    let best: { route: CompiledRoute; score: number[] } | null = null;
    for (const route of bucket) {
      if (route.segments.length !== parts.length) continue;
      const score: number[] = [];
      let ok = true;
      for (let i = 0; i < parts.length; i += 1) {
        const segment = route.segments[i] as CompiledRoute["segments"][number];
        const part = parts[i] as string;
        if ("literal" in segment) {
          if (segment.literal !== part && segment.literal !== safeDecode(part)) {
            ok = false;
            break;
          }
          score.push(1);
        } else {
          // Como find-my-way (Fastify 5): un segmento vacío casa con un parámetro (`/v1/me/vehicles/` → vehicleId = «»);
          // luego decide la validación del esquema de `params` (uuid, minLength…).
          score.push(0);
        }
      }
      if (!ok) continue;
      if (!best || compareScore(score, best.score) > 0) best = { route, score };
    }
    if (!best) return null;
    const params: Record<string, string> = {};
    best.route.segments.forEach((segment, i) => {
      if ("param" in segment) params[segment.param] = safeDecode(parts[i] as string);
    });
    return { route: best.route, params };
  }

  /** ¿La ruta existe con otro método? (Fastify igualmente responde 404, no 405.) */
  has(method: HttpMethod, pattern: string): boolean {
    const signature = compile(pattern)
      .map((s) => ("literal" in s ? s.literal : ":"))
      .join("/");
    return (this.registry.byMethod.get(method) ?? []).some(
      (r) => r.segments.map((s) => ("literal" in s ? s.literal : ":")).join("/") === signature
    );
  }

  routes(): RouteInfo[] {
    return this.registry.all.map(({ method, pattern, summary, tags, owner }) => ({ method, pattern, summary, tags, owner }));
  }

  size(): number {
    return this.registry.all.length;
  }
}

function compareScore(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function createRouter(): PreviewRouter {
  return new PreviewRouter("core");
}
