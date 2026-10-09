/**
 * Backend en memoria de la vista previa · slice `driver` · paquete «publicar ruta y solicitudes».
 * SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`). API del núcleo: `mobile/src/preview/index.ts`, ejemplos en
 * `mobile/src/preview/handlers/*.ts` y contrato de los endpoints en `docs/contracts/<módulo>.md`.
 */
import type { PreviewDb, PreviewProfileId, PreviewRouter } from "@/preview";
import { registerInbox } from "./publishInbox";
import { registerReadiness } from "./publishReadiness";

export function registerPublishPreview(r: PreviewRouter, db: PreviewDb): void {
  registerReadiness(r, db);
  registerInbox(r, db);
}

export function seedPublish(_db: PreviewDb, _profile: PreviewProfileId, _seed: string): void {}

/** Variantes de datos propias del paquete: { "nombre-unico": "qué contiene, en una frase" }. */
export const publishSeedVariants: Readonly<Record<string, string>> = {};
