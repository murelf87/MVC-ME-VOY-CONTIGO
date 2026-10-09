/**
 * Backend en memoria de la vista previa para el slice `auth`: Alta e inicio de sesión (teléfono + código SMS), recuperación de cuenta.
 *
 * SIMULACIÓN: este fichero solo se carga con `EXPO_PUBLIC_PREVIEW=1` (lo importa `src/preview/register.ts`, que a su
 * vez solo se importa desde el `require` protegido de `App.tsx`); no llega a las compilaciones de producción.
 *
 * Los endpoints de autenticación del núcleo (`/v1/auth/phone/*`, `/v1/auth/session`) ya los sirve `src/preview/handlers/auth.ts`.
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

export function registerPreview(_r: PreviewRouter, _db: PreviewDb): void {}

export function seedSlice(_db: PreviewDb, _profile: PreviewProfileId, _seed: string): void {}
