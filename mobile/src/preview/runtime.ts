/**
 * Ensamblaje del backend en memoria: base de datos + router + servidor + sembrado. Lo usan `install.ts` (navegador) y las
 * pruebas (Node); no toca `window`, `fetch` global ni el visor, así que se puede crear tantas veces como haga falta.
 *
 *   const rt = createPreviewRuntime({ profile: "passenger", latency: 0 });
 *   const res = await rt.fetch("https://api.mvc-preview.invalid/me", { headers: { authorization: `Bearer ${rt.sessionToken()}` } });
 */
import type { ClockInput, ClockMode } from "./core/clock";
import { PreviewDb, createPreviewDb } from "./core/db";
import { createInterceptingFetch, type FetchLike } from "./core/fetchAdapter";
import { PreviewRouter, createRouter } from "./core/router";
import { PreviewServer } from "./core/server";
import type { PreviewProfileId } from "./core/types";
import { registerPreviewHandlers, resetWorld, seedWorld, type ResetWorldOptions } from "./register";
import { profileSessionToken } from "./seeds";

export interface PreviewRuntimeOptions {
  profile?: PreviewProfileId;
  /** Variante de datos (`default`, `request-pending`…). */
  seed?: string;
  /** Instante inicial del reloj (por defecto, el de las láminas). */
  clock?: ClockInput | null;
  clockMode?: ClockMode;
  /** ms fijos, `[mín, máx]` o `0` (sin latencia: pruebas). */
  latency?: number | readonly [number, number];
  /** Hosts del API a interceptar además de los reservados. */
  apiHosts?: readonly string[];
  /** Semilla del azar determinista de ids y códigos. */
  rngSeed?: string;
  /** No siembra nada (la base se restaurará desde una instantánea). */
  skipSeed?: boolean;
  /**
   * `false` = solo los endpoints del NÚCLEO (la forma heredada del backend 0.14). Lo usan las pruebas de conformidad con
   * las grabaciones del backend real, que no conocen las formas ampliadas de los slices (decisión de solicitudes…).
   */
  slices?: boolean;
}

export interface PreviewRuntime {
  readonly db: PreviewDb;
  readonly router: PreviewRouter;
  readonly server: PreviewServer;
  /** `fetch` que atiende el API/almacenamiento simulados; lo demás va a `original`. */
  createFetch(original?: FetchLike): FetchLike;
  /** Vacía la base, fija el reloj y vuelve a sembrar. */
  reset(options: ResetWorldOptions): void;
  /** Token de sesión del perfil actual (`null` en «Persona nueva»). */
  sessionToken(profile?: PreviewProfileId): string | null;
}

export function createPreviewRuntime(options: PreviewRuntimeOptions = {}): PreviewRuntime {
  const db = createPreviewDb({
    ...(options.rngSeed !== undefined ? { seed: options.rngSeed } : {}),
    ...(options.clock ? { now: options.clock } : {}),
    clockMode: options.clockMode ?? "frozen",
  });
  const router = createRouter();
  registerPreviewHandlers(router, db, { slices: options.slices ?? true });
  const server = new PreviewServer({
    db,
    router,
    ...(options.apiHosts ? { apiHosts: [...options.apiHosts] } : {}),
    latency: options.latency ?? [80, 250],
  });
  if (!options.skipSeed) seedWorld(db, options.profile ?? "new", options.seed ?? "default");
  else {
    db.profile = options.profile ?? "new";
    db.seedName = options.seed ?? "default";
  }
  return {
    db,
    router,
    server,
    createFetch: (original) => createInterceptingFetch(server, original),
    reset: (resetOptions) => resetWorld(db, resetOptions),
    sessionToken: (profile) => profileSessionToken(profile ?? db.profile),
  };
}
