/**
 * Caché de consultas en memoria (sin React): base de `useApiQuery` / `usePaginatedQuery`.
 *
 *  - Clave estable (`['trips', { id }]` ≡ mismo objeto con claves en otro orden).
 *  - Deduplicación: dos pantallas que piden lo mismo comparten UNA petición.
 *  - Stale-while-revalidate: los datos antiguos se siguen sirviendo mientras se revalida.
 *  - Cancelación: si el último observador se va (desmontaje) la petición en curso se aborta.
 *  - GC: una entrada sin observadores se descarta tras `gcTimeMs` (por defecto 5 min).
 *  - Se vacía entera al terminar la sesión (evento `sessionCleared`): jamás se sirven datos de otra cuenta.
 *
 * Una consulta nunca rechaza: el fallo queda en `state.error` (y `status`), de modo que `refetch()` es seguro
 * de disparar sin `try/catch`.
 */
import { isAbortError, isOfflineError } from "@/api/errors";
import { onSessionCleared } from "@/api/runtime";

export type QueryKey = string | readonly unknown[];
export type QueryStatus = "idle" | "loading" | "success" | "error" | "offline";

export interface QueryFnContext {
  signal: AbortSignal;
}
export type QueryFn<T> = (context: QueryFnContext) => Promise<T>;

export interface QueryState<T> {
  /**
   * idle: nunca se ha pedido · loading: primera carga sin datos · success: hay datos (aunque se estén
   * revalidando o la última revalidación fallara: ver `error`) · error: sin datos y falló · offline: sin datos y sin red.
   */
  status: QueryStatus;
  data: T | undefined;
  /** Último error; se limpia al tener éxito. Puede coexistir con `data` (revalidación fallida). */
  error: Error | null;
  /** Instante (ms) del último éxito. */
  updatedAt: number | null;
  errorUpdatedAt: number | null;
  isFetching: boolean;
  /** Marcada como obsoleta por `invalidate`: se revalida en cuanto alguien la observe. */
  isInvalidated: boolean;
}

const IDLE_STATE: QueryState<never> = {
  status: "idle",
  data: undefined,
  error: null,
  updatedAt: null,
  errorUpdatedAt: null,
  isFetching: false,
  isInvalidated: false,
};

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) => {
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const record = nested as Record<string, unknown>;
      return Object.keys(record)
        .sort()
        .reduce<Record<string, unknown>>((sorted, name) => {
          sorted[name] = record[name];
          return sorted;
        }, {});
    }
    return nested;
  });
}

export function normalizeKey(key: QueryKey): readonly unknown[] {
  return typeof key === "string" ? [key] : key;
}

export function hashKey(key: QueryKey): string {
  return stableStringify(normalizeKey(key));
}

/** ¿`prefix` es un prefijo de `key`? (`['trips']` casa con `['trips', 1]`). */
export function isKeyPrefix(prefix: QueryKey, key: readonly unknown[]): boolean {
  const normalized = normalizeKey(prefix);
  if (normalized.length > key.length) return false;
  return normalized.every((part, index) => stableStringify(part) === stableStringify(key[index]));
}

interface Entry {
  hash: string;
  key: readonly unknown[];
  state: QueryState<unknown>;
  listeners: Set<() => void>;
  inflight: { promise: Promise<unknown>; controller: AbortController } | null;
  fetcher: QueryFn<unknown> | null;
  gcTimer: ReturnType<typeof setTimeout> | null;
}

export interface QueryCacheOptions {
  now?: () => number;
  gcTimeMs?: number;
}

export interface FetchOptions {
  /** Datos más recientes que esto (ms) se consideran frescos y no se pide de nuevo. */
  staleTimeMs?: number;
  /** Pedir siempre (ignora frescura) pero sigue deduplicando con una petición en curso. */
  force?: boolean;
}

export class QueryCache {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  private readonly gcTimeMs: number;

  constructor(options: QueryCacheOptions = {}) {
    this.now = options.now ?? Date.now;
    this.gcTimeMs = options.gcTimeMs ?? 5 * 60_000;
  }

  /** Número de entradas vivas (para pruebas y depuración). */
  get size(): number {
    return this.entries.size;
  }

  private entryFor(key: QueryKey): Entry {
    const hash = hashKey(key);
    let entry = this.entries.get(hash);
    if (!entry) {
      entry = {
        hash,
        key: normalizeKey(key),
        state: IDLE_STATE,
        listeners: new Set(),
        inflight: null,
        fetcher: null,
        gcTimer: null,
      };
      this.entries.set(hash, entry);
    }
    return entry;
  }

  private setState(entry: Entry, patch: Partial<QueryState<unknown>>): void {
    entry.state = { ...entry.state, ...patch };
    for (const listener of [...entry.listeners]) listener();
  }

  /** Estado actual (referencia estable mientras no cambie: apto para `useSyncExternalStore`). */
  getState<T>(key: QueryKey): QueryState<T> {
    return (this.entries.get(hashKey(key))?.state ?? IDLE_STATE) as QueryState<T>;
  }

  getData<T>(key: QueryKey): T | undefined {
    return this.getState<T>(key).data;
  }

  /**
   * Escribe datos a mano (actualización optimista, resultado de una mutación, página añadida a una lista).
   * Con `keepFreshness` no cambia `updatedAt` ni `isInvalidated` (los datos siguen tan «viejos» como estaban).
   */
  setData<T>(key: QueryKey, updater: T | ((old: T | undefined) => T), options: { keepFreshness?: boolean } = {}): void {
    const entry = this.entryFor(key);
    const next = typeof updater === "function" ? (updater as (old: T | undefined) => T)(entry.state.data as T | undefined) : updater;
    this.setState(
      entry,
      options.keepFreshness
        ? { status: "success", data: next }
        : { status: "success", data: next, error: null, updatedAt: this.now(), isInvalidated: false },
    );
    this.scheduleGc(entry);
  }

  isStale(key: QueryKey, staleTimeMs = 0): boolean {
    const state = this.getState<unknown>(key);
    if (state.updatedAt === null || state.isInvalidated) return true;
    return this.now() - state.updatedAt >= staleTimeMs;
  }

  subscribe(key: QueryKey, listener: () => void): () => void {
    const entry = this.entryFor(key);
    entry.listeners.add(listener);
    if (entry.gcTimer) {
      clearTimeout(entry.gcTimer);
      entry.gcTimer = null;
    }
    return () => {
      entry.listeners.delete(listener);
      if (entry.listeners.size > 0) return;
      // Pequeña gracia: StrictMode / re-renders pueden desuscribir y volver a suscribir en el mismo ciclo.
      setTimeout(() => {
        if (entry.listeners.size > 0 || !entry.inflight) return;
        entry.inflight.controller.abort();
      }, 0);
      this.scheduleGc(entry);
    };
  }

  private scheduleGc(entry: Entry): void {
    if (entry.listeners.size > 0) return;
    if (entry.gcTimer) clearTimeout(entry.gcTimer);
    entry.gcTimer = setTimeout(() => {
      if (entry.listeners.size === 0 && this.entries.get(entry.hash) === entry) {
        entry.inflight?.controller.abort();
        this.entries.delete(entry.hash);
      }
    }, this.gcTimeMs);
    // En Node (pruebas) el temporizador no debe impedir que el proceso termine; en React Native devuelve un número.
    (entry.gcTimer as unknown as { unref?: () => void }).unref?.();
  }

  /**
   * Pide los datos (o reutiliza los frescos / la petición en curso). Siempre resuelve: con los datos, o con
   * `undefined` si falló o se canceló (el error queda en el estado).
   */
  fetch<T>(key: QueryKey, fetcher: QueryFn<T>, options: FetchOptions = {}): Promise<T | undefined> {
    const entry = this.entryFor(key);
    entry.fetcher = fetcher as QueryFn<unknown>;
    if (entry.inflight) return entry.inflight.promise as Promise<T | undefined>;

    const fresh =
      !options.force &&
      !entry.state.isInvalidated &&
      entry.state.updatedAt !== null &&
      this.now() - entry.state.updatedAt < (options.staleTimeMs ?? 0);
    if (fresh) return Promise.resolve(entry.state.data as T | undefined);

    const controller = new AbortController();
    this.setState(entry, {
      isFetching: true,
      status: entry.state.data === undefined ? "loading" : entry.state.status,
    });

    const promise = (async (): Promise<T | undefined> => {
      try {
        const data = await fetcher({ signal: controller.signal });
        if (entry.inflight?.controller !== controller) return undefined; // sustituida o descartada
        this.setState(entry, {
          status: "success",
          data,
          error: null,
          updatedAt: this.now(),
          isFetching: false,
          isInvalidated: false,
        });
        return data;
      } catch (error) {
        if (entry.inflight?.controller !== controller) return undefined;
        if (isAbortError(error)) {
          this.setState(entry, { isFetching: false });
          return undefined;
        }
        const failure = error instanceof Error ? error : new Error(String(error));
        this.setState(entry, {
          error: failure,
          errorUpdatedAt: this.now(),
          isFetching: false,
          status: entry.state.data !== undefined ? "success" : isOfflineError(failure) ? "offline" : "error",
        });
        return undefined;
      } finally {
        if (entry.inflight?.controller === controller) entry.inflight = null;
      }
    })();

    entry.inflight = { promise, controller };
    return promise;
  }

  /**
   * Marca como obsoletas las consultas cuya clave empiece por `filter` (todas si se omite) y revalida las que
   * se están observando ahora mismo. Cancela y repite las que estén en vuelo (pueden traer datos anteriores al cambio).
   */
  async invalidate(filter?: QueryKey | ((key: readonly unknown[]) => boolean)): Promise<void> {
    const matches = (key: readonly unknown[]): boolean => {
      if (filter === undefined) return true;
      if (typeof filter === "function") return filter(key);
      return isKeyPrefix(filter, key);
    };
    const refetches: Promise<unknown>[] = [];
    for (const entry of [...this.entries.values()]) {
      if (!matches(entry.key)) continue;
      this.setState(entry, { isInvalidated: true });
      if (entry.listeners.size > 0 && entry.fetcher) {
        if (entry.inflight) {
          const previous = entry.inflight;
          entry.inflight = null;
          previous.controller.abort();
        }
        refetches.push(this.fetch(entry.key, entry.fetcher, { force: true }));
      }
    }
    await Promise.all(refetches);
  }

  remove(key: QueryKey): void {
    const hash = hashKey(key);
    const entry = this.entries.get(hash);
    if (!entry) return;
    entry.inflight?.controller.abort();
    if (entry.gcTimer) clearTimeout(entry.gcTimer);
    this.entries.delete(hash);
    this.setState(entry, { ...IDLE_STATE });
  }

  /** Vacía todo (cierre de sesión). Los observadores vuelven a `idle` y se cancelan las peticiones. */
  clear(): void {
    for (const entry of [...this.entries.values()]) {
      entry.inflight?.controller.abort();
      entry.inflight = null;
      if (entry.gcTimer) clearTimeout(entry.gcTimer);
      this.setState(entry, { ...IDLE_STATE });
    }
    this.entries.clear();
  }
}

/** Caché única de la app. */
export const queryCache = new QueryCache();

// Cerrar sesión (o caducar) vacía las consultas: nunca se muestran datos de otra cuenta.
onSessionCleared(() => queryCache.clear());
