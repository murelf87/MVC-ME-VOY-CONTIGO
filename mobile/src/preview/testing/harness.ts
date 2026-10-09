/**
 * Utilidades de prueba del backend en memoria (solo las usan `*.test.ts` y `mobile/scripts/preview-contract-check.ts`;
 * no forman parte del barrel `@/preview` ni llegan al paquete de la app).
 *
 *   const rt = testRuntime({ profile: "passenger" });
 *   const api = createApi(rt);
 *   const me = await api("GET", "/me", { token: rt.sessionToken() });
 */
import type { PreviewShell } from "@/platform/previewBridge";
import { createSession } from "../core/auth";
import { createPreviewDb, type PreviewDb, type PreviewDbOptions } from "../core/db";
import { createInterceptingFetch } from "../core/fetchAdapter";
import { createRouter, type PreviewRouter } from "../core/router";
import { PreviewServer } from "../core/server";
import { createPreviewRuntime, type PreviewRuntime, type PreviewRuntimeOptions } from "../runtime";
import { SEED_USER_IDS, type SeedUserKey } from "../seeds/ids";

export const API_ORIGIN = "https://api.mvc-preview.invalid";

export interface ApiResult<T = unknown> {
  status: number;
  headers: Record<string, string>;
  /** Cuerpo ya interpretado (`null` si estaba vacío; el texto crudo si no era JSON). */
  body: T;
  text: string;
}

export interface ApiOptions {
  token?: string | null | undefined;
  /** Se serializa como JSON (salvo que `rawBody` esté presente). */
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export type Api = <T = unknown>(method: string, path: string, options?: ApiOptions) => Promise<ApiResult<T>>;

/** Runtime para pruebas: sin latencia y con el azar determinista por defecto. */
export function testRuntime(options: PreviewRuntimeOptions = {}): PreviewRuntime {
  return createPreviewRuntime({ latency: 0, ...options });
}

/** Abre una sesión nueva como una persona del reparto (`ana`, `miguel`, `laura`…) y devuelve su token. */
export function tokenFor(runtime: Pick<PreviewRuntime, "db">, key: SeedUserKey): string {
  return createSession(runtime.db, SEED_USER_IDS[key]).token;
}

/** `fetch` de la app contra el runtime, devuelto como una función `api(method, path, options)`. */
export function createApi(runtime: Pick<PreviewRuntime, "createFetch">, origin: string = API_ORIGIN): Api {
  const previewFetch = runtime.createFetch();
  return async function api<T = unknown>(method: string, path: string, options: ApiOptions = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    let body: string | undefined;
    if (options.rawBody !== undefined) body = options.rawBody;
    else if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers["content-type"] ??= "application/json";
    }
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = body;
    if (options.signal) init.signal = options.signal;
    const response = await previewFetch(`${origin}${path}`, init);
    const text = await response.text();
    let parsed: unknown = text;
    if (text === "") parsed = null;
    else {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });
    return { status: response.status, headers: responseHeaders, body: parsed as T, text };
  };
}

type ShellHolder = { __MVC_PREVIEW_SHELL__?: unknown };

/** Instala un visor falso (`__MVC_PREVIEW_SHELL__`) durante `fn` y lo retira después. */
export async function withShell<T>(shell: Partial<PreviewShell> & Record<string, unknown>, fn: () => Promise<T> | T): Promise<T> {
  const holder = globalThis as unknown as ShellHolder;
  const previous = holder.__MVC_PREVIEW_SHELL__;
  holder.__MVC_PREVIEW_SHELL__ = shell;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete holder.__MVC_PREVIEW_SHELL__;
    else holder.__MVC_PREVIEW_SHELL__ = previous;
  }
}

/** Asegura que no queda ningún visor global (aislamiento entre pruebas). */
export function clearShell(): void {
  delete (globalThis as unknown as ShellHolder).__MVC_PREVIEW_SHELL__;
}

/** Cuerpo JSON como objeto (falla la prueba con un mensaje legible si no lo es). */
export function asRecord(value: unknown, what = "cuerpo"): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Se esperaba un objeto en ${what}, pero llegó ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

export function asArray(value: unknown, what = "cuerpo"): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Se esperaba una lista en ${what}, pero llegó ${JSON.stringify(value)}`);
  return value;
}

export function str(value: unknown, what = "valor"): string {
  if (typeof value !== "string") throw new Error(`Se esperaba texto en ${what}, pero llegó ${JSON.stringify(value)}`);
  return value;
}

export function num(value: unknown, what = "valor"): number {
  if (typeof value !== "number") throw new Error(`Se esperaba un número en ${what}, pero llegó ${JSON.stringify(value)}`);
  return value;
}

export interface BareServer {
  db: PreviewDb;
  router: PreviewRouter;
  server: PreviewServer;
  api: Api;
}

/** Servidor SIN mundo sembrado ni rutas del núcleo: solo lo que registre `register` (pruebas del router y del servidor). */
export function bareServer(register: (router: PreviewRouter, db: PreviewDb) => void, dbOptions: PreviewDbOptions = {}): BareServer {
  const db = createPreviewDb(dbOptions);
  const router = createRouter();
  register(router, db);
  const server = new PreviewServer({ db, router, latency: 0 });
  const api = createApi({ createFetch: () => createInterceptingFetch(server, undefined) });
  return { db, router, server, api };
}

/** `Storage` en memoria (en Node no existen `localStorage` ni `sessionStorage`). */
export class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

type StorageHolder = { localStorage?: Storage; sessionStorage?: Storage };

/** Instala `localStorage`/`sessionStorage` falsos y devuelve la función que restaura los anteriores. */
export function installBrowserStorage(): { local: MemoryStorage; session: MemoryStorage; restore(): void } {
  const holder = globalThis as unknown as StorageHolder;
  const savedLocal = holder.localStorage;
  const savedSession = holder.sessionStorage;
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  holder.localStorage = local;
  holder.sessionStorage = session;
  return {
    local,
    session,
    restore() {
      if (savedLocal) holder.localStorage = savedLocal;
      else delete holder.localStorage;
      if (savedSession) holder.sessionStorage = savedSession;
      else delete holder.sessionStorage;
    },
  };
}
