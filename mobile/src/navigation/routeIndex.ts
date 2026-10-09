/**
 * Índice ligero de rutas (nombre → acceso, slice), rellenado por `registry.ts` al arrancar.
 * Existe aparte para que `actions.ts` y los slices puedan consultarlo SIN importar el registro (que importa a los
 * slices): evita ciclos de importación.
 */
import type { RouteAccess } from "./routeDef";

interface IndexedRoute {
  access: RouteAccess;
  slice: string;
}

let index = new Map<string, IndexedRoute>();

export function registerRouteIndex(entries: readonly { name: string; access: RouteAccess; slice: string }[]): void {
  index = new Map(entries.map((entry) => [entry.name, { access: entry.access, slice: entry.slice }]));
}

/** Nombres de todas las rutas registradas (vacío hasta que `registry.ts` se haya cargado). */
export function getRouteNames(): string[] {
  return [...index.keys()];
}

export function hasRoute(name: string): boolean {
  return index.has(name);
}

export function getRouteAccess(name: string): RouteAccess | undefined {
  return index.get(name)?.access;
}

export function getRouteSlice(name: string): string | undefined {
  return index.get(name)?.slice;
}
