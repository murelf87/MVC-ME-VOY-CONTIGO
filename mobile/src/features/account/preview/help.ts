/**
 * Backend en memoria de la vista previa · slice `account` · paquete «ajustes, ayuda y datos».
 * SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`). API del núcleo: `mobile/src/preview/index.ts`, ejemplos en
 * `mobile/src/preview/handlers/*.ts` y contrato de los endpoints en `docs/contracts/comms.md` (§5 ajustes, §7–§9 soporte,
 * §6 exportación y eliminación). Los documentos legales los registra `auth`: aquí solo se consumen.
 */
import type { PreviewDb, PreviewProfileId, PreviewRouter } from "@/preview";
import { registerDataPreview } from "./helpData";
import { registerSettingsPreview } from "./helpSettings";
import { HELP_SEED_VARIANTS, registerHelpRefs, seedHelpWorld } from "./helpSeeds";
import { registerSupportPreview } from "./helpSupport";

export function registerHelpPreview(r: PreviewRouter, db: PreviewDb): void {
  registerSettingsPreview(r, db);
  registerSupportPreview(r, db);
  registerDataPreview(r, db);
  registerHelpRefs();
}

export function seedHelp(db: PreviewDb, profile: PreviewProfileId, seed: string): void {
  seedHelpWorld(db, profile, seed);
}

/** Variantes de datos propias del paquete: { "nombre-unico": "qué contiene, en una frase" }. */
export const helpSeedVariants: Readonly<Record<string, string>> = HELP_SEED_VARIANTS;
