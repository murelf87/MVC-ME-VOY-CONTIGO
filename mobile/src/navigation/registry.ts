/**
 * Registro de rutas: ensambla las rutas de los 8 slices (+ las de desarrollo) y rellena el índice ligero.
 * Lo importa `RootNavigator`; los slices NO deben importarlo (usan `@/navigation`).
 */
import { routes as accountRoutes } from "@/features/account";
import { routes as adminRoutes } from "@/features/admin";
import { routes as authRoutes } from "@/features/auth";
import { routes as driverRoutes } from "@/features/driver";
import { routes as liveRoutes } from "@/features/live";
import { routes as messagesRoutes } from "@/features/messages";
import { routes as profileRoutes } from "@/features/profile";
import { routes as searchRoutes } from "@/features/search";
import { devRoutes } from "./devRoutes";
import { assembleRoutes, toRouteCatalog, type RegisteredRoute, type RouteCatalogEntry } from "./routeDef";
import { registerRouteIndex } from "./routeIndex";

export const APP_ROUTES: readonly RegisteredRoute[] = assembleRoutes([
  { slice: "auth", routes: authRoutes },
  { slice: "search", routes: searchRoutes },
  { slice: "driver", routes: driverRoutes },
  { slice: "live", routes: liveRoutes },
  { slice: "messages", routes: messagesRoutes },
  { slice: "profile", routes: profileRoutes },
  { slice: "account", routes: accountRoutes },
  { slice: "admin", routes: adminRoutes },
  { slice: "dev", routes: devRoutes },
]);

registerRouteIndex(APP_ROUTES);

/** Catálogo para la vista previa (`window.__mvc.routes()`): nombre, slice, nº de lámina, título, parámetros de ejemplo. */
export function getRouteCatalog(): RouteCatalogEntry[] {
  return toRouteCatalog(APP_ROUTES);
}
