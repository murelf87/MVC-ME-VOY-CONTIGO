/**
 * Categoría de trayecto elegida al explorar (chips «Trabajo · Universidad · FP · Hospital · Deporte · Otros» del mapa).
 *
 * Es UNA sola para el mapa de inicio y para «Define tu recorrido»: quien filtra el mapa por «Universidad» y después pulsa
 * «¿A dónde vas?» llega al recorrido con «Universidad» ya puesta. Vive solo en memoria mientras la app está abierta (no se
 * guarda en el móvil ni se envía a ningún sitio) y se olvida al cerrar la sesión de exploración.
 */
import { useCallback, useSyncExternalStore } from "react";
import type { TripCategory } from "@/api/types";

let current: TripCategory | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): TripCategory | null {
  return current;
}

/** Cambia la categoría compartida (también la usan las pruebas y quien necesite leerla sin hook). */
export function setExploreCategory(category: TripCategory | null): void {
  if (current === category) return;
  current = category;
  for (const listener of listeners) listener();
}

export function getExploreCategory(): TripCategory | null {
  return current;
}

export function useExploreCategory(): readonly [TripCategory | null, (category: TripCategory | null) => void] {
  const category = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const set = useCallback((next: TripCategory | null) => setExploreCategory(next), []);
  return [category, set] as const;
}
