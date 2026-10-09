/**
 * Agregador del backend en memoria: el núcleo (`handlers/*`) más los 8 slices de la app.
 *
 * Cada slice aporta, en `src/features/<slice>/preview/handlers.ts`:
 *   - `registerPreview(r, db)`            sus endpoints (obligatorio);
 *   - `seedSlice(db, profile, seed)`      sus datos sembrados (opcional), tras el mundo base;
 *   - `seedVariants`                      sus variantes de datos propias `{ nombre: descripción }` (opcional).
 *
 * Los slices solo importan TIPOS de `@/preview` (barrel `index.ts`); este fichero es el único que los importa a ellos,
 * y solo lo importa `install.ts`: así no hay ciclos y nada de esto llega a producción.
 */
import type { PreviewDb } from "./core/db";
import { DEFAULT_PREVIEW_NOW, type ClockInput } from "./core/clock";
import type { PreviewRouter } from "./core/router";
import type { PreviewProfileId } from "./core/types";
import { registerCoreHandlers } from "./handlers/core";
import { SEED_VARIANTS, applySeedVariant, baseOptionsFor, isKnownSeedVariant, seedBase } from "./seeds";
import * as account from "../features/account/preview/handlers";
import * as admin from "../features/admin/preview/handlers";
import * as auth from "../features/auth/preview/handlers";
import * as driver from "../features/driver/preview/handlers";
import * as live from "../features/live/preview/handlers";
import * as messages from "../features/messages/preview/handlers";
import * as profile from "../features/profile/preview/handlers";
import * as search from "../features/search/preview/handlers";

export interface PreviewSliceModule {
  registerPreview(r: PreviewRouter, db: PreviewDb): void;
  seedSlice?(db: PreviewDb, profile: PreviewProfileId, seed: string): void;
  /**
   * Variantes de datos propias del slice (el `seed` de un escenario): `{ "bandeja-con-no-leidos": "Qué contiene, en una frase" }`.
   * Hay que declararlas aquí para que `window.__mvc.open(…, { seed })` y `?mvcSeed=` las acepten (un nombre desconocido
   * es un error, no un «default» silencioso). El slice las construye en `seedSlice(db, profile, seed)` sobre el mundo
   * base de «default». El nombre no puede coincidir con el de una variante del núcleo ni con el de otro slice.
   */
  seedVariants?: Readonly<Record<string, string>>;
}

export interface PreviewSlice {
  name: string;
  module: PreviewSliceModule;
}

/** Orden de registro (importa solo para los mensajes de «ruta duplicada»). */
export const PREVIEW_SLICES: readonly PreviewSlice[] = [
  { name: "auth", module: auth },
  { name: "search", module: search },
  { name: "driver", module: driver },
  { name: "live", module: live },
  { name: "messages", module: messages },
  { name: "profile", module: profile },
  { name: "account", module: account },
  { name: "admin", module: admin },
];

export interface SeedVariantInfo {
  name: string;
  description: string;
  /** `core` o el nombre del slice que la declara. */
  owner: string;
}

/**
 * Todas las variantes de datos que acepta la vista previa: las del núcleo (`seeds/scenarios.ts`) y las que declaran
 * los slices (`seedVariants`). Lanza si dos declaran el mismo nombre.
 */
export function listSeedVariants(slices: readonly PreviewSlice[] = PREVIEW_SLICES): SeedVariantInfo[] {
  const out: SeedVariantInfo[] = Object.entries(SEED_VARIANTS).map(([name, variant]) => ({ name, description: variant.description, owner: "core" }));
  for (const slice of slices) {
    for (const [name, description] of Object.entries(slice.module.seedVariants ?? {})) {
      const clash = out.find((variant) => variant.name === name);
      if (clash) throw new Error(`La variante de datos «${name}» la declaran «${clash.owner}» y «${slice.name}»: cada nombre debe ser único.`);
      out.push({ name, description, owner: slice.name });
    }
  }
  return out;
}

/** ¿Es `name` una variante declarada (núcleo o slice)? Un nombre desconocido se rechaza en `__mvc.open` y en `?mvcSeed=`. */
export function isAcceptedSeed(name: string): boolean {
  return listSeedVariants().some((variant) => variant.name === name);
}

/**
 * Registra todos los endpoints en `router`: primero los del núcleo (backend 0.14) y después los de cada slice. Una
 * ruta repetida lanza un error al arrancar (para sustituir una del núcleo, el slice usa `r.override(...)`); también
 * una variante de datos declarada dos veces.
 */
export function registerPreviewHandlers(router: PreviewRouter, db: PreviewDb, options: { slices?: boolean } = {}): void {
  listSeedVariants();
  registerCoreHandlers(router.scoped("core"), db);
  if (options.slices === false) return;
  for (const slice of PREVIEW_SLICES) slice.module.registerPreview(router.scoped(slice.name), db);
}

/**
 * Siembra el mundo completo en una base VACÍA: base + `seedSlice` de cada slice + variante de datos.
 *
 * El flujo del azar se bifurca antes de la variante y otra vez al terminar: los ids que crea la variante (solicitud,
 * reserva, mensajes…) y los que se creen durante la sesión dependen solo de (semilla, variante), no del perfil ni de
 * cuánto azar gasten los `seedSlice`. Así un escenario se reproduce con los mismos ids.
 */
export function seedWorld(db: PreviewDb, profile: PreviewProfileId, seed = "default"): void {
  db.seedName = seed;
  // una variante que solo declara un slice (o un nombre desconocido) parte del mundo de «default», también en el azar
  const variant = isKnownSeedVariant(seed) ? seed : "default";
  seedBase(db, profile, baseOptionsFor(seed));
  for (const slice of PREVIEW_SLICES) slice.module.seedSlice?.(db, profile, seed);
  db.ids.forkRng(`variant:${variant}`);
  applySeedVariant(db, seed);
  db.ids.forkRng(`live:${variant}`);
}

export interface ResetWorldOptions {
  profile: PreviewProfileId;
  /** Nombre de la variante de datos (`default`, `request-pending`…). */
  seed?: string;
  /**
   * Instante del reloj virtual. `undefined` = conservar el actual; `null` = el de las láminas (lunes 5 de octubre de
   * 2026, 07:17); un valor = ese instante. Con el reloj «host» (visor) el instante lo manda el navegador y se ignora.
   */
  clock?: ClockInput | null;
}

/** Vacía la base, fija el reloj y siembra el mundo (lo que hacen `__mvc.open` y `__mvc.reset`). */
export function resetWorld(db: PreviewDb, options: ResetWorldOptions): void {
  const now = options.clock === undefined ? db.clock.nowMs() : (options.clock ?? DEFAULT_PREVIEW_NOW);
  db.resetEmpty({ now });
  seedWorld(db, options.profile, options.seed ?? "default");
}
