/**
 * Referencia global al contenedor de navegación, para código que no es un componente (enlaces profundos, avisos,
 * caducidad de sesión, vista previa).
 *
 *   navigationRef.isReady()               ¿está montado el navegador?
 *   navigationRef.navigate(name, params)  navegar (tipado con `AppParamList`)
 *   navigationRef.resetRoot(state)        sustituir toda la pila
 *   getCurrentRoute()                     { name, params } de la ruta hoja actual, o null
 *   getRouteNames()                       nombres de TODAS las rutas registradas (para «Ir a pantalla»)
 */
import { createNavigationContainerRef } from "@react-navigation/native";
import type { AppParamList } from "./types";

export const navigationRef = createNavigationContainerRef<AppParamList>();

export { getRouteNames } from "./routeIndex";

export interface CurrentRoute {
  name: string;
  params: Record<string, unknown> | undefined;
}

/** Ruta hoja actual (la que se ve), o `null` si el navegador aún no está listo. */
export function getCurrentRoute(): CurrentRoute | null {
  if (!navigationRef.isReady()) return null;
  const route = navigationRef.getCurrentRoute();
  if (!route) return null;
  const params = route.params;
  return { name: route.name, params: params && typeof params === "object" ? (params as Record<string, unknown>) : undefined };
}
