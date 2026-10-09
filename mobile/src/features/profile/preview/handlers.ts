/**
 * Backend en memoria de la vista previa para el slice `profile`: Perfil, valoración, preferencias.
 *
 * SIMULACIÓN: este fichero solo se carga con `EXPO_PUBLIC_PREVIEW=1` (lo importa `src/preview/register.ts`, que a su
 * vez solo se importa desde el `require` protegido de `App.tsx`); no llega a las compilaciones de producción.
 *
 * El núcleo ya sirve `GET /me` y `PATCH /v1/me/profile`.
 *
 * Cómo añadir endpoints (API completa en `docs/PREVIEW_BACKEND.md`):
 *
 *   export function registerPreview(r: PreviewRouter, db: PreviewDb): void {
 *     r.get<{ Params: { id: string } }>("/v1/…/:id", { schema: { params: … } }, (req) => {
 *       const me = req.auth();            // 401 AUTH_REQUIRED / AUTH_INVALID_OR_EXPIRED como el backend
 *       …lee/escribe `db.collection<Fila>("tabla")` o las tablas base…
 *       return { … };                    // 200; `reply.created(…)`, `reply.noContent()` para otros códigos
 *     });
 *   }
 *
 * Datos sembrados propios del slice: `seedSlice(db, profile, seed)` (se llama tras sembrar el mundo base).
 */
import type { PreviewDb, PreviewProfileId, PreviewRouter } from "@/preview";
import { registerPlansPreview } from "./plans";
import { registerRoutinePreview } from "./routine";
import { PROFILE_SEED_VARIANTS, seedProfileSlice } from "./seed";

export function registerPreview(r: PreviewRouter, db: PreviewDb): void {
  registerRoutinePreview(r, db);
  registerPlansPreview(r, db);
}

export function seedSlice(db: PreviewDb, profile: PreviewProfileId, seed: string): void {
  seedProfileSlice(db, profile, seed);
}

/** Variantes de datos del slice (el `seed` de `design/scenarios/31.json`). */
export const seedVariants: Readonly<Record<string, string>> = PROFILE_SEED_VARIANTS;
