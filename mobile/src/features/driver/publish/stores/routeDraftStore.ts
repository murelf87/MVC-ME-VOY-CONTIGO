/**
 * Borradores de ruta en curso (pantallas 18 → 19). Almacén externo mínimo por `draftId`: así «Publica tu ruta» y
 * «Paradas y recorrido» comparten lo escrito sin pasar objetos grandes por los parámetros de navegación (que solo
 * llevan datos serializables pequeños). Vive en memoria: un borrador no sobrevive al cierre de la app (nada se ha
 * publicado todavía; el servidor no guarda nada hasta «Guardar ruta»).
 */
import { useSyncExternalStore } from "react";
import { IS_PREVIEW_BUILD } from "@/platform";
import { emptyDraft, type DraftPlace, type RouteDraft } from "../logic/routeDraft";

/**
 * SOLO VISTA PREVIA: borradores con los datos de las láminas 18 y 19 para abrirlas directamente (`draftId` «preview-…»).
 * En producción esta tabla no se usa (`IS_PREVIEW_BUILD` es false y el empaquetador la elimina).
 */
const PALOMARES: DraftPlace = { label: "Palomares del Río", lat: 37.3103, lng: -6.0486 };
const MAIRENA: DraftPlace = { label: "Mairena del Aljarafe", lat: 37.3445, lng: -6.0603 };
const SEVILLA: DraftPlace = { label: "Sevilla (Trabajo)", lat: 37.3886, lng: -5.9823 };
const HUELVA: DraftPlace = { label: "Huelva", lat: 37.2614, lng: -6.9447 };
const previewDrafts = (): Record<string, Omit<RouteDraft, "id">> => ({
  "preview-18": { ...emptyDraft("", 3), origin: PALOMARES, destination: SEVILLA, outboundLocal: "07:00", returnLocal: "15:00" },
  "preview-19": { ...emptyDraft("", 3), origin: PALOMARES, destination: SEVILLA, stops: [MAIRENA], outboundLocal: "07:00", returnLocal: "15:00" },
  "preview-19-outside": { ...emptyDraft("", 3), origin: PALOMARES, destination: SEVILLA, stops: [MAIRENA, HUELVA], outboundLocal: "07:00", returnLocal: "15:00" },
});

const drafts = new Map<string, RouteDraft>();
const listeners = new Set<() => void>();
let version = 0;

function emit(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

let counter = 0;
export function newDraftId(): string {
  counter += 1;
  return `draft-${Date.now().toString(36)}-${counter}`;
}

export const routeDraftStore = {
  get: (id: string): RouteDraft | undefined => drafts.get(id),
  /** Crea el borrador si no existe (no pisa uno ya empezado). */
  ensure(id: string, seats: number): RouteDraft {
    const existing = drafts.get(id);
    if (existing !== undefined) return existing;
    const preset = IS_PREVIEW_BUILD ? previewDrafts()[id] : undefined;
    const fresh: RouteDraft = preset !== undefined ? { ...preset, id } : emptyDraft(id, seats);
    drafts.set(id, fresh);
    emit();
    return fresh;
  },
  set(draft: RouteDraft): void {
    drafts.set(draft.id, draft);
    emit();
  },
  update(id: string, change: (draft: RouteDraft) => RouteDraft): void {
    const current = drafts.get(id);
    if (current === undefined) return;
    drafts.set(id, change(current));
    emit();
  },
  discard(id: string): void {
    if (drafts.delete(id)) emit();
  },
  clear(): void {
    drafts.clear();
    emit();
  },
};

/** El borrador `id` (o `undefined` si no existe); se vuelve a pintar cuando cambia. */
export function useRouteDraft(id: string | undefined): RouteDraft | undefined {
  useSyncExternalStore(subscribe, () => version, () => version);
  return id === undefined ? undefined : drafts.get(id);
}
