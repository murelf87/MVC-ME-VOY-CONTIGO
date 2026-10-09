/**
 * Backend en memoria de la vista previa · slice `driver` · paquete «operar el viaje».
 * SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`). API del núcleo: `mobile/src/preview/index.ts`, ejemplos en
 * `mobile/src/preview/handlers/*.ts` y contrato de los endpoints en `docs/contracts/<módulo>.md`.
 */
import type { PreviewDb, PreviewProfileId, PreviewRouter } from "@/preview";

export function registerOpsPreview(_r: PreviewRouter, _db: PreviewDb): void {}

export function seedOps(_db: PreviewDb, _profile: PreviewProfileId, _seed: string): void {}

/** Variantes de datos propias del paquete: { "nombre-unico": "qué contiene, en una frase" }. */
export const opsSeedVariants: Readonly<Record<string, string>> = {};
