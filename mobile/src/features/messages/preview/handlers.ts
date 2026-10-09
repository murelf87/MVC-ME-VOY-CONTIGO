/**
 * Backend en memoria de la vista previa para el slice `messages` (SIMULACIÓN: solo se carga con `EXPO_PUBLIC_PREVIEW=1`;
 * no llega a las compilaciones de producción). Este fichero solo reparte el trabajo entre los módulos de `./`:
 *
 *   rows.ts            filas y tablas `comms_*` (+ `money_refunds`)
 *   access.ts          conversaciones derivadas de viajes y reservas, permisos, punteros de lectura y acuses
 *   conversations.ts   `/v1/conversations…`
 *   world.ts           mundo sembrado de las láminas 25–28, variantes `messages-*` y referencias `conversation.*`
 */
import type { PreviewDb, PreviewProfileId, PreviewRouter } from "@/preview";
import { registerConversations } from "./conversations";
import { declareTables } from "./rows";
import { messagesSeedVariants, registerMessagesRefs, seedConversationVariant } from "./world";

export function registerPreview(r: PreviewRouter, db: PreviewDb): void {
  declareTables(db);
  registerMessagesRefs();
  registerConversations(r, db);
}

export function seedSlice(db: PreviewDb, profile: PreviewProfileId, seed: string): void {
  seedConversationVariant(db, profile, seed);
}

/** Variantes de datos del slice (el `seed` de los escenarios `design/scenarios/25..28.json`). */
export const seedVariants: Readonly<Record<string, string>> = messagesSeedVariants;
