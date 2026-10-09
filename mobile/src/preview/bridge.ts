/**
 * `window.__mvc`: el puente que usan el visor y las herramientas (`tools/design/compare.mjs`, `tools/preview/smoke.mjs`)
 * para saber dónde está la app y llevarla a un escenario. Contrato: `tools/preview/shell/API.md` §4.
 *
 *   ready()    ¿navegación montada Y backend en memoria instalado?
 *   route()    nombre de la ruta hoja actual · params() sus parámetros · routes() el catálogo de rutas de la app
 *   open(route, params, { profile, seed, clock })
 *              re-siembra el backend, inicia sesión como ese perfil, fija el reloj y abre la ruta con una pila coherente.
 *              En `params`, `{ "$ref": "request.miguel" }` se sustituye por el id real sembrado (`seeds/refs.ts`).
 *              Un `seed` o un `profile` desconocidos son un error (la lista sale de `seeds()`), no un «default» silencioso.
 *   goBack()   · idle(ms)  espera a que no haya peticiones del backend en vuelo · reset(profile)  borra los datos y vuelve al inicio
 *
 * SIMULACIÓN: nada de esto existe fuera de la vista previa.
 */
import {
  activeRoleForProfile,
  signInProfile,
  signOutApp,
  waitUntil,
  type AppModules,
  type AppModulesLoader,
  type AppRoute,
  type AppRouteInfo,
} from "./appBridge";
import { realNowMs } from "./core/clock";
import type { RequestLogEntry } from "./core/log";
import { isPreviewProfileId, type PreviewProfileId } from "./core/types";
import type { PersistHandle } from "./persist";
import { clearPersisted } from "./persist";
import { getLastSms, type SentSms } from "./providers/sms";
import { isAcceptedSeed, listSeedVariants } from "./register";
import type { PreviewRuntime } from "./runtime";
import { resolveAllSeedRefs, resolveRefsIn } from "./seeds";

export interface ClockControl {
  mode: "frozen" | "running" | "host";
  /** Fija el reloj en ese instante; `null` lo devuelve al de las láminas. */
  apply(iso: string | null): void;
}

export interface OpenOptions {
  profile?: PreviewProfileId;
  seed?: string;
  clock?: string | null;
}

export interface MvcBridge {
  ready(): boolean;
  route(): string | null;
  params(): Record<string, unknown> | undefined;
  routes(): AppRouteInfo[];
  open(route: string, params?: Record<string, unknown>, opts?: OpenOptions): Promise<void>;
  goBack(): void;
  idle(timeoutMs?: number): Promise<void>;
  reset(profile?: PreviewProfileId): Promise<void>;
  // ---- extras de la vista previa (no los exige el visor) ----
  /** Esta página usa el backend simulado en memoria. */
  readonly simulation: true;
  profile(): PreviewProfileId;
  seed(): string;
  seeds(): string[];
  /** Hora virtual actual (ISO). */
  now(): string;
  /** Últimas peticiones atendidas por el backend simulado (más reciente al final). */
  requests(limit?: number): RequestLogEntry[];
  /** Último SMS «enviado» por el proveedor simulado (contiene el código). */
  lastSms(): SentSms | null;
  /** Referencias simbólicas (`request.miguel`…) resueltas en el mundo actual; `null` = no existe en esta variante. */
  refs(): Record<string, string | null>;
}

export interface BridgeDeps {
  runtime: PreviewRuntime;
  loader: AppModulesLoader;
  clock: ClockControl;
  persist?: PersistHandle | null;
  /** Cuánto se espera a que la app esté lista antes de rendirse. */
  readyTimeoutMs?: number;
  /** Espera entre pasos (inyectable en pruebas). */
  settleMs?: number;
}

export function createMvcBridge(deps: BridgeDeps): MvcBridge {
  const { runtime, loader, clock } = deps;
  const readyTimeoutMs = deps.readyTimeoutMs ?? 20_000;
  const settleMs = deps.settleMs ?? 40;
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  const app = (): AppModules | null => loader();

  const requireReadyApp = async (): Promise<AppModules> => {
    let found: AppModules | null = null;
    await waitUntil(
      () => {
        found = app();
        return found !== null && found.isNavigationReady();
      },
      "La app no está lista (navegación sin montar).",
      { timeoutMs: readyTimeoutMs }
    );
    if (!found) throw new Error("La app no está lista.");
    return found;
  };

  const idle = async (timeoutMs = 5_000): Promise<void> => {
    const deadline = realNowMs() + timeoutMs;
    let quiet = 0;
    while (realNowMs() < deadline) {
      if (runtime.server.inFlight === 0) {
        quiet += 1;
        if (quiet >= 3) return;
      } else {
        quiet = 0;
      }
      await sleep(40);
    }
  };

  const desiredSession = (profile: PreviewProfileId) => ({ token: runtime.sessionToken(profile), activeRole: activeRoleForProfile(profile) });

  const persistContext = (profile: PreviewProfileId, seed: string, clockIso: string | null): void => {
    deps.persist?.setMeta({ profile, seed, clock: clockIso });
  };

  return {
    simulation: true,

    ready() {
      const modules = app();
      return modules !== null && modules.isNavigationReady();
    },
    route() {
      return app()?.currentRoute()?.name ?? null;
    },
    params() {
      const current: AppRoute | null = app()?.currentRoute() ?? null;
      return current?.params;
    },
    routes() {
      return app()?.routeCatalog() ?? [];
    },

    async open(route, params, opts = {}) {
      const profile = opts.profile ?? runtime.db.profile;
      if (!isPreviewProfileId(profile)) throw new Error(`Perfil de prueba desconocido: ${String(profile)}`);
      const modules = await requireReadyApp();
      if (route && !modules.routeCatalog().some((entry) => entry.name === route)) {
        throw new Error(`La ruta «${route}» no existe en la app (window.__mvc.routes() las lista).`);
      }
      if (opts.seed !== undefined && !isAcceptedSeed(opts.seed)) {
        throw new Error(`La variante de datos «${opts.seed}» no existe. Disponibles: ${listSeedVariants().map((variant) => variant.name).join(", ")}.`);
      }
      // 1) la app cierra sesión contra el mundo ANTERIOR; 2) se re-siembra; 3) la app abre la sesión del perfil.
      await signOutApp(modules);
      if (opts.clock !== undefined) clock.apply(opts.clock);
      const seed = opts.seed ?? "default";
      runtime.reset({ profile, seed });
      persistContext(profile, seed, opts.clock ?? null);
      await signInProfile(modules, desiredSession(profile));
      await sleep(settleMs);
      let resolved: Record<string, unknown> | undefined;
      try {
        resolved = params ? resolveRefsIn(runtime.db, params) : undefined;
      } catch (error) {
        modules.applyGate(); // el mundo ya está sembrado y la sesión abierta: que la app quede en su primera pantalla
        throw error;
      }
      if (!route) {
        modules.applyGate();
      } else if (!modules.resetToRoute({ name: route, ...(resolved ? { params: resolved } : {}) })) {
        throw new Error(`No se pudo abrir la ruta «${route}» con la sesión del perfil «${profile}».`);
      }
      await sleep(settleMs);
      await idle();
    },

    goBack() {
      app()?.goBack();
    },

    idle,

    async reset(profile) {
      const target = profile ?? runtime.db.profile;
      if (!isPreviewProfileId(target)) throw new Error(`Perfil de prueba desconocido: ${String(target)}`);
      const modules = await requireReadyApp();
      await signOutApp(modules);
      clearBrowserData();
      clearPersisted();
      clock.apply(null);
      runtime.reset({ profile: target, seed: "default" });
      persistContext(target, "default", null);
      await signInProfile(modules, desiredSession(target));
      await sleep(settleMs);
      modules.applyGate();
      await sleep(settleMs);
      await idle();
    },

    profile: () => runtime.db.profile,
    seed: () => runtime.db.seedName,
    seeds: () => listSeedVariants().map((variant) => variant.name),
    now: () => runtime.db.clock.iso(),
    requests: (limit = 50) => runtime.server.log.entries().slice(-Math.max(0, limit)),
    lastSms: () => getLastSms(),
    refs: () => resolveAllSeedRefs(runtime.db),
  };
}

/** Borra lo que la app guardó en el navegador (`mvc.*`): sesión, rol activo, preferencias. */
export function clearBrowserData(): void {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try {
      const store = (globalThis as unknown as Record<string, Storage | undefined>)[name];
      if (!store) continue;
      const doomed: string[] = [];
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (key && key.startsWith("mvc.") && key !== "mvc.preview.db.v1") doomed.push(key);
      }
      for (const key of doomed) store.removeItem(key);
    } catch {
      // almacenamiento bloqueado: no hay nada que borrar
    }
  }
}
