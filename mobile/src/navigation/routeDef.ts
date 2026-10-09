/**
 * Definición de rutas. Cada slice declara sus rutas en `features/<slice>/routes.ts`:
 *
 *   export type SearchParams = { MapHome: undefined; TripDetail: { tripId: string }; … };
 *   export const searchRoutes: RouteDef[] = [
 *     defineRoute({ name: "MapHome", component: MapHomeScreen, access: "public", screen: "09" }),
 *     defineRoute({ name: "TripDetail", component: TripDetailScreen, access: "public", screen: "12" }),
 *   ];
 *
 * Este módulo solo contiene TIPOS y funciones puras (no importa React Native ni los slices), de modo que los slices
 * pueden importarlo sin ciclos y las reglas de ensamblado se prueban en Node.
 */
import type { ComponentType } from "react";
import type { AppRouteName, AppScreenProps } from "./types";

/**
 * Quién puede entrar a la ruta:
 *   public  cualquiera, también invitados («Explorar sin registrarme») y personas sin sesión.
 *   auth    solo con sesión. Un invitado que llegue (enlace, botón) pasa por `requireAccount`: CreateAccount y vuelta aquí.
 *   staff   solo personal administrativo (admin, verification_admin, finance_admin, support_admin).
 */
export type RouteAccess = "public" | "auth" | "staff";

export interface RouteOptions {
  /** Animación de entrada. Por defecto la estándar de la plataforma. */
  animation?: "default" | "fade" | "slide_from_bottom" | "slide_from_right" | "none";
  /** Permitir el gesto de volver con deslizamiento. Por defecto sí. */
  gestureEnabled?: boolean;
}

export interface RouteDef {
  /** Nombre único de la ruta (clave de `AppParamList`). */
  name: AppRouteName;
  /** Pantalla. Recibe `navigation` y `route` de React Navigation. */
  component: ComponentType<never>;
  /** Por defecto `auth`. */
  access?: RouteAccess;
  /** Número de pantalla del diseño («09», «13a»), si existe en las láminas. */
  screen?: string;
  /** Título legible (lo usa la vista previa en «Ir a pantalla»). */
  title?: string;
  /** Parámetros de ejemplo para abrir la ruta directamente en la vista previa (solo desarrollo). */
  previewParams?: Record<string, unknown> | null;
  options?: RouteOptions;
}

/** Declara una ruta comprobando que `component` recibe las props de ESA ruta (y no de otra). */
export function defineRoute<Name extends AppRouteName>(def: {
  name: Name;
  component: ComponentType<AppScreenProps<Name>>;
  access?: RouteAccess;
  screen?: string;
  title?: string;
  previewParams?: Record<string, unknown> | null;
  options?: RouteOptions;
}): RouteDef {
  // Borde tipado: la comprobación fina ya se hizo arriba; el registro almacena componentes de props heterogéneas.
  return def as unknown as RouteDef;
}

export interface RouteGroup {
  slice: string;
  routes: readonly RouteDef[];
}

export interface RegisteredRoute extends RouteDef {
  slice: string;
  access: RouteAccess;
}

/**
 * Ensambla los grupos de rutas de los slices. Falla con un mensaje claro si dos slices declaran el mismo nombre
 * (un error de integración que de otro modo se vería como una pantalla equivocada).
 */
export function assembleRoutes(groups: readonly RouteGroup[]): RegisteredRoute[] {
  const seen = new Map<string, string>();
  const registered: RegisteredRoute[] = [];
  for (const group of groups) {
    for (const route of group.routes) {
      const owner = seen.get(route.name);
      if (owner !== undefined) {
        throw new Error(`La ruta «${route.name}» está declarada dos veces: en «${owner}» y en «${group.slice}».`);
      }
      seen.set(route.name, group.slice);
      registered.push({ ...route, slice: group.slice, access: route.access ?? "auth" });
    }
  }
  return registered;
}

export interface RouteCatalogEntry {
  name: string;
  slice: string;
  screen?: string;
  title?: string;
  params?: Record<string, unknown> | null;
}

/** Catálogo de rutas para `window.__mvc.routes()` de la vista previa. */
export function toRouteCatalog(routes: readonly RegisteredRoute[]): RouteCatalogEntry[] {
  return routes.map((route) => ({
    name: route.name,
    slice: route.slice,
    ...(route.screen !== undefined ? { screen: route.screen } : {}),
    ...(route.title !== undefined ? { title: route.title } : {}),
    ...(route.previewParams !== undefined ? { params: route.previewParams } : {}),
  }));
}
