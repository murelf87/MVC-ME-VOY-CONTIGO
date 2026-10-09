/**
 * Backend en memoria de la vista previa · slice `search` · paquete «solicitar plaza y pagar».
 * SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`). API del núcleo: `mobile/src/preview/index.ts`, ejemplos en
 * `mobile/src/preview/handlers/*.ts` y contrato de los endpoints en `docs/contracts/<módulo>.md`.
 */
import type { PreviewDb, PreviewProfileId, PreviewRouter } from "@/preview";

export function registerRequestPreview(_r: PreviewRouter, _db: PreviewDb): void {}

export function seedRequest(_db: PreviewDb, _profile: PreviewProfileId, _seed: string): void {}

/** Variantes de datos propias del paquete: { "nombre-unico": "qué contiene, en una frase" }. */
export const requestSeedVariants: Readonly<Record<string, string>> = {};
