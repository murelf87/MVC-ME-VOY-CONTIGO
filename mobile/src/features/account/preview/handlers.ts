/**
 * Backend en memoria de la vista previa para el slice `account`. Este fichero SOLO reparte el trabajo entre los dos
 * paquetes del slice (cada equipo escribe el suyo y no toca el del otro): `./money.ts` y `./help.ts`.
 * SIMULACIÓN: solo se carga con `EXPO_PUBLIC_PREVIEW=1`; no llega a las compilaciones de producción.
 */
import type { PreviewDb, PreviewProfileId, PreviewRouter } from "@/preview";
import { registerMoneyPreview, seedMoney, moneySeedVariants } from "./money";
import { registerHelpPreview, seedHelp, helpSeedVariants } from "./help";

export function registerPreview(r: PreviewRouter, db: PreviewDb): void {
  registerMoneyPreview(r, db);
  registerHelpPreview(r, db);
}

export function seedSlice(db: PreviewDb, profile: PreviewProfileId, seed: string): void {
  seedMoney(db, profile, seed);
  seedHelp(db, profile, seed);
}

/** Variantes de datos del slice: la unión de las de los dos paquetes (los nombres no pueden repetirse). */
export const seedVariants: Readonly<Record<string, string>> = { ...moneySeedVariants, ...helpSeedVariants };
