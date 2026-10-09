/**
 * Rutas del slice `live` (lámina 06: esperando el coche, cambio de ruta, en el coche y viaje terminado).
 *
 * ANDAMIAJE: cada ruta apunta a `PendingScreen` hasta que el agente del slice escribe la pantalla real. Este fichero
 * es suyo desde ese momento: cambia `component`, ajusta los tipos de `LiveParams` y añade las rutas nuevas
 * (legal, permisos, recibos…) que necesite. Reglas:
 *  - `LiveParams` es un `type` (no `interface`) y SOLO lleva datos serializables (ids, textos, números).
 *  - Los nombres de ruta son únicos en TODA la app (el registro falla al arrancar si se repiten).
 *  - `access`: "public" (también invitados) · "auth" (por defecto) · "staff".
 *  - Pantalla = componente que recibe `AppScreenProps<"Nombre">`; navega con `useAppNavigation()` y lee los
 *    parámetros con `useAppRoute("Nombre")`.
 */
import { PendingScreen } from "@/navigation/PendingScreen";
import { defineRoute, type RouteDef } from "@/navigation/routeDef";
import { InCarScreen } from "./screens/InCarScreen";
import { LiveRouteMapScreen } from "./screens/LiveRouteMapScreen";
import { RouteChangeScreen } from "./screens/RouteChangeScreen";
import { WaitingForCarScreen } from "./screens/WaitingForCarScreen";

export type LiveParams = {
  WaitingForCar: { bookingId: string };
  RouteChange: { proposalId: string; bookingId?: string };
  InCar: { bookingId: string };
  TripFinished: { bookingId: string };
  // ── Páginas adicionales de producción (catálogo de docs/BUILD_BRIEF.md §10.3). Contrato entre equipos: añade parámetros opcionales, no renombres ni quites.
  RateTrip: { tripId: string; bookingId?: string };
  ReportIncident: { tripId?: string; bookingId?: string };
  IncidentReports: undefined;
  IncidentDetail: { reportId: string };
  ShareTrip: { bookingId: string };
  SharedTripView: { token: string };
  LivePrivacy: undefined;
  // ── live: mapa del coche a pantalla completa («Ver ruta en el mapa» de la 21)
  LiveRouteMap: { bookingId: string };
};

export const liveRoutes: RouteDef[] = [
  defineRoute({ name: "WaitingForCar", component: WaitingForCarScreen, access: "auth", screen: "21", title: "Esperando el coche", previewParams: { bookingId: { $ref: "live.booking" } } }),
  defineRoute({ name: "RouteChange", component: RouteChangeScreen, access: "auth", screen: "22", title: "Cambio de ruta" }),
  defineRoute({ name: "InCar", component: InCarScreen, access: "auth", screen: "23", title: "En el coche", previewParams: { bookingId: { $ref: "live.booking" } } }),
  defineRoute({ name: "TripFinished", component: PendingScreen, access: "auth", screen: "24", title: "Viaje terminado" }),
  // ── Páginas adicionales de producción (sin lámina: se diseñan en el mismo lenguaje visual)
  defineRoute({ name: "RateTrip", component: PendingScreen, access: "auth", title: "Valora el viaje" }),
  defineRoute({ name: "ReportIncident", component: PendingScreen, access: "auth", title: "Reportar incidencia" }),
  defineRoute({ name: "IncidentReports", component: PendingScreen, access: "auth", title: "Mis incidencias" }),
  defineRoute({ name: "IncidentDetail", component: PendingScreen, access: "auth", title: "Detalle de la incidencia" }),
  defineRoute({ name: "ShareTrip", component: PendingScreen, access: "auth", title: "Compartir viaje" }),
  defineRoute({ name: "SharedTripView", component: PendingScreen, access: "public", title: "Viaje compartido" }),
  defineRoute({ name: "LivePrivacy", component: PendingScreen, access: "auth", title: "Privacidad del viaje en vivo" }),
  defineRoute({ name: "LiveRouteMap", component: LiveRouteMapScreen, access: "auth", title: "Ruta del coche", previewParams: { bookingId: { $ref: "live.booking" } } }),
];
