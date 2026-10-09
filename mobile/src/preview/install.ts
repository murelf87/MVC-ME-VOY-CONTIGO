/**
 * Instalador del backend en memoria (SOLO vista previa: `EXPO_PUBLIC_PREVIEW=1`).
 *
 * `App.tsx` lo carga con un único `require` protegido por esa variable y llama a `installPreviewIfEnabled()` ANTES de
 * montar nada. Aquí se:
 *   1. lee el arranque que fijó el visor (`__MVC_PREVIEW_SHELL__.boot`: perfil, variante de datos, reloj);
 *   2. crea el backend (base + router + servidor + sembrado de Sevilla) y reemplaza `globalThis.fetch` por uno que atiende
 *      el API y el almacenamiento reservados (`*.invalid`) y deja el resto al `fetch` anterior (el del visor, que bloquea
 *      cualquier salida a Internet);
 *   3. deja la sesión de ejemplo del perfil lista en `localStorage` (la app la lee al arrancar) y conecta el reloj;
 *   4. publica el puente `window.__mvc` (ver `bridge.ts`).
 *
 * SIMULACIÓN: todo esto vive en memoria de la pestaña; nada sale del navegador y nada de esto existe en producción.
 */
import { loadAppModules, type AppModulesLoader } from "./appBridge";
import { createMvcBridge, type ClockControl, type MvcBridge } from "./bridge";
import { DEFAULT_PREVIEW_NOW, realNowMs, type ClockMode } from "./core/clock";
import type { FetchLike } from "./core/fetchAdapter";
import { setPreviewAssetResolver } from "./core/assets";
import { readBoot, readShell } from "./core/shell";
import { isPreviewProfileId, type PreviewProfileId } from "./core/types";
import { installVirtualDate } from "./core/virtualDate";
import { DEFAULT_API_HOSTS } from "./core/server";
import { loadPersisted, startPersisting, type PersistHandle } from "./persist";
import { isAcceptedSeed, listSeedVariants } from "./register";
import { createPreviewRuntime, type PreviewRuntime } from "./runtime";

/** Claves históricas de `src/session/storage.ts` (no cambian): token de sesión y copia de `/me`. */
export const SESSION_TOKEN_KEY = "mvc.session.token";
export const SESSION_ME_KEY = "mvc.session.me";

export interface InstallOptions {
  /** Instala aunque `EXPO_PUBLIC_PREVIEW` no sea «1» (pruebas). */
  force?: boolean;
  profile?: PreviewProfileId;
  seed?: string;
  /** ISO; `null` = hora real; sin valor = la de las láminas. */
  clock?: string | null;
  latency?: number | readonly [number, number];
  apiHosts?: readonly string[];
  /** Sustituye la carga de la navegación y la sesión de la app (pruebas). */
  appLoader?: AppModulesLoader;
  /** Guardar el mundo en `sessionStorage` (por defecto sí). */
  persist?: boolean;
  /** Sustituir `Date` global cuando el reloj corre sin visor (por defecto sí). */
  patchDate?: boolean;
  /** Escribir el token del perfil en `localStorage` (por defecto sí). */
  writeSessionToken?: boolean;
  /** Cada cuántos ms se evalúan las reglas dependientes del tiempo (`0` = nunca; por defecto 5 000). */
  jobsIntervalMs?: number;
}

export interface PreviewInstallation {
  readonly runtime: PreviewRuntime;
  readonly bridge: MvcBridge;
  readonly clockMode: ClockMode;
  /** Deshace la instalación (restaura `fetch`, `Date` y retira `window.__mvc`). Para pruebas. */
  uninstall(): void;
}

type PreviewGlobal = typeof globalThis & {
  __mvc?: MvcBridge;
  __MVC_PREVIEW_BACKEND__?: { runtime: PreviewRuntime; installation: PreviewInstallation };
};

const g = globalThis as PreviewGlobal;

function urlParam(name: string): string | null {
  try {
    const search = (globalThis as { location?: { search?: string } }).location?.search;
    if (!search) return null;
    return new URLSearchParams(search).get(name);
  } catch {
    return null;
  }
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function writeSession(token: string | null): void {
  try {
    const store = (globalThis as { localStorage?: Storage }).localStorage;
    if (!store) return;
    if (token) store.setItem(SESSION_TOKEN_KEY, token);
    else store.removeItem(SESSION_TOKEN_KEY);
    store.removeItem(SESSION_ME_KEY);
  } catch {
    // almacenamiento bloqueado (iframe aislado): la app queda sin sesión recordada y `__mvc.open` la abre al navegar
  }
}

/** `process.env.EXPO_PUBLIC_API_URL` con la expresión literal que Metro sustituye. */
function configuredApiUrl(): string | undefined {
  return process.env.EXPO_PUBLIC_API_URL;
}

/** Punto de entrada para `App.tsx`: no hace nada fuera de la vista previa y nunca rompe el arranque. */
export function installPreviewIfEnabled(): void {
  if (process.env.EXPO_PUBLIC_PREVIEW !== "1") return;
  try {
    installPreview();
  } catch (error) {
    if (typeof console !== "undefined") {
      console.error("[mvc-preview] no se pudo instalar el backend en memoria; la app usará la red real (que el visor bloquea).", error);
    }
  }
}

export function installPreview(options: InstallOptions = {}): PreviewInstallation | null {
  if (!options.force && process.env.EXPO_PUBLIC_PREVIEW !== "1") return null;
  const existing = g.__MVC_PREVIEW_BACKEND__?.installation;
  if (existing) return existing;

  const shell = readShell();
  const boot = readBoot();

  // ---- perfil, variante de datos y reloj pedidos ----
  const urlProfile = urlParam("mvcProfile");
  const profile: PreviewProfileId =
    options.profile ?? (isPreviewProfileId(boot.profile) ? boot.profile : isPreviewProfileId(urlProfile) ? urlProfile : "new");
  const requestedSeed = options.seed ?? boot.seed ?? urlParam("mvcSeed") ?? "default";
  const seed = isAcceptedSeed(requestedSeed) ? requestedSeed : "default";
  if (seed !== requestedSeed && typeof console !== "undefined") {
    console.warn(
      `[mvc-preview] la variante de datos «${requestedSeed}» no existe; se usa «default». Disponibles: ${listSeedVariants().map((variant) => variant.name).join(", ")}.`
    );
  }
  const requestedClock: string | null | undefined =
    options.clock !== undefined ? options.clock : boot.clock !== undefined ? boot.clock : (urlParam("mvcClock") ?? undefined);

  // ---- reloj ----
  const canShiftHostClock = typeof shell.setClock === "function";
  const clockMode: ClockMode = shell.clockMode ?? (canShiftHostClock ? "host" : "running");
  const targetClock = requestedClock === undefined ? DEFAULT_PREVIEW_NOW : requestedClock;
  if (clockMode === "host") {
    try {
      shell.setClock?.(targetClock);
    } catch {
      // un visor defectuoso no debe impedir que la vista previa arranque
    }
  }

  const apiHosts = [...DEFAULT_API_HOSTS, ...(options.apiHosts ?? [])];
  const fromEnv = hostOf(configuredApiUrl());
  if (fromEnv) apiHosts.push(fromEnv);

  const persistedMeta = { profile, seed, clock: typeof requestedClock === "string" ? requestedClock : null };
  const snapshot = options.persist === false ? null : loadPersisted(persistedMeta);

  const runtime = createPreviewRuntime({
    profile,
    seed,
    clock: targetClock === null ? realNowMs() : targetClock,
    clockMode,
    latency: options.latency ?? shell.latency ?? [80, 250],
    apiHosts,
    skipSeed: snapshot !== null,
  });
  if (snapshot) {
    runtime.db.restore(snapshot);
    runtime.db.clock.setMode(clockMode);
  }

  // ---- imágenes ilustrativas (retratos de las láminas) ----
  setPreviewAssetResolver(resolveBundledAsset);

  // ---- red ----
  const originalFetch = typeof g.fetch === "function" ? (g.fetch.bind(g) as FetchLike) : undefined;
  const previewFetch = runtime.createFetch(originalFetch);
  const fetchBefore = g.fetch;
  g.fetch = previewFetch as typeof fetch;

  // ---- fecha global ----
  let restoreDate: (() => void) | null = null;
  const wantsDatePatch = clockMode === "running" && options.patchDate !== false && shell.patchDate !== false;
  if (wantsDatePatch) restoreDate = installVirtualDate(runtime.db.clock);

  // ---- sesión de ejemplo del perfil (la app la lee al arrancar) ----
  if (!snapshot && options.writeSessionToken !== false) writeSession(runtime.sessionToken(profile));

  // ---- reglas dependientes del tiempo fuera de las peticiones ----
  const jobsIntervalMs = options.jobsIntervalMs ?? 5_000;
  const jobsTimer =
    jobsIntervalMs > 0
      ? setInterval(() => {
          try {
            runtime.db.jobs.run(runtime.db);
          } catch (error) {
            if (typeof console !== "undefined") console.error("[mvc-preview] fallo en una tarea programada", error);
          }
        }, jobsIntervalMs)
      : null;

  // ---- persistencia ----
  const persist: PersistHandle | null = options.persist === false ? null : startPersisting(runtime.db, persistedMeta);

  // ---- puente window.__mvc ----
  const clock: ClockControl = {
    mode: clockMode,
    apply(iso) {
      const target = iso ?? DEFAULT_PREVIEW_NOW;
      if (clockMode === "host" && canShiftHostClock) {
        try {
          shell.setClock?.(target);
        } catch {
          // idem
        }
      } else {
        runtime.db.clock.set(target);
      }
    },
  };
  const bridge = createMvcBridge({ runtime, loader: options.appLoader ?? loadAppModules, clock, persist });
  g.__mvc = bridge;

  const installation: PreviewInstallation = {
    runtime,
    bridge,
    clockMode,
    uninstall() {
      if (jobsTimer) clearInterval(jobsTimer);
      persist?.stop();
      restoreDate?.();
      if (g.fetch === (previewFetch as typeof fetch)) g.fetch = fetchBefore;
      if (g.__mvc === bridge) delete g.__mvc;
      delete g.__MVC_PREVIEW_BACKEND__;
      setPreviewAssetResolver(null);
    },
  };
  g.__MVC_PREVIEW_BACKEND__ = { runtime, installation };
  return installation;
}

/**
 * Resuelve `preview-asset://avatar/<slug>` con los recursos de `@/assets` (recortes de las láminas). `require` con
 * literales dentro de la función: Metro los empaqueta y las pruebas de Node, que no llaman a esto, no los cargan.
 */
function resolveBundledAsset(key: string): string | null {
  const match = /^preview-asset:\/\/avatar\/(\w+)$/.exec(key);
  if (!match) return null;
  try {
    const assets = require("@/assets") as typeof import("@/assets");
    const { Asset } = require("expo-asset") as typeof import("expo-asset");
    const slug = match[1] as keyof typeof assets.images.avatars;
    const asset = assets.images.avatars[slug];
    if (!asset) return null;
    // `Image.resolveAssetSource` no existe en react-native-web: expo-asset resuelve el recurso en web y en móvil.
    const uri = Asset.fromModule(asset.source as number).uri;
    return typeof uri === "string" && uri !== "" ? uri : null;
  } catch {
    return null;
  }
}
