/**
 * Backend en memoria de la vista previa · slice `admin` · paquete «resumen, usuarios y reembolsos».
 * SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`). API del núcleo: `mobile/src/preview/index.ts`, ejemplos en
 * `mobile/src/preview/handlers/*.ts` y contrato de los endpoints en `docs/contracts/<módulo>.md`.
 */
import type { PreviewDb, PreviewProfileId, PreviewRouter } from "@/preview";

export function registerReviewPreview(_r: PreviewRouter, _db: PreviewDb): void {}

export function seedReview(_db: PreviewDb, _profile: PreviewProfileId, _seed: string): void {}

/** Variantes de datos propias del paquete: { "nombre-unico": "qué contiene, en una frase" }. */
export const reviewSeedVariants: Readonly<Record<string, string>> = {};
