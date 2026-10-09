/**
 * Backend en memoria de la vista previa para el slice `search`. Este fichero SOLO reparte el trabajo entre los dos
 * paquetes del slice (cada equipo escribe el suyo y no toca el del otro): `./browse.ts` y `./request.ts`.
 * SIMULACIÓN: solo se carga con `EXPO_PUBLIC_PREVIEW=1`; no llega a las compilaciones de producción.
 */
import type { PreviewDb, PreviewProfileId, PreviewRouter } from "@/preview";
import { registerBrowsePreview, seedBrowse, browseSeedVariants } from "./browse";
import { registerRequestPreview, seedRequest, requestSeedVariants } from "./request";

export function registerPreview(r: PreviewRouter, db: PreviewDb): void {
  registerBrowsePreview(r, db);
  registerRequestPreview(r, db);
}

export function seedSlice(db: PreviewDb, profile: PreviewProfileId, seed: string): void {
  seedBrowse(db, profile, seed);
  seedRequest(db, profile, seed);
}

/** Variantes de datos del slice: la unión de las de los dos paquetes (los nombres no pueden repetirse). */
export const seedVariants: Readonly<Record<string, string>> = { ...browseSeedVariants, ...requestSeedVariants };
