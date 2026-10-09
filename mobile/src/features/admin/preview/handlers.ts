/**
 * Backend en memoria de la vista previa para el slice `admin`. Este fichero SOLO reparte el trabajo entre los dos
 * paquetes del slice (cada equipo escribe el suyo y no toca el del otro): `./review.ts` y `./ops.ts`.
 * SIMULACIÓN: solo se carga con `EXPO_PUBLIC_PREVIEW=1`; no llega a las compilaciones de producción.
 */
import type { PreviewDb, PreviewProfileId, PreviewRouter } from "@/preview";
import { registerReviewPreview, seedReview, reviewSeedVariants } from "./review";
import { registerOpsPreview, seedOps, opsSeedVariants } from "./ops";

export function registerPreview(r: PreviewRouter, db: PreviewDb): void {
  registerReviewPreview(r, db);
  registerOpsPreview(r, db);
}

export function seedSlice(db: PreviewDb, profile: PreviewProfileId, seed: string): void {
  seedReview(db, profile, seed);
  seedOps(db, profile, seed);
}

/** Variantes de datos del slice: la unión de las de los dos paquetes (los nombres no pueden repetirse). */
export const seedVariants: Readonly<Record<string, string>> = { ...reviewSeedVariants, ...opsSeedVariants };
