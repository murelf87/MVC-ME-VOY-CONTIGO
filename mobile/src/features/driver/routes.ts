/**
 * Rutas del slice `driver` (lámina 05: vehículo, publicar ruta, paradas y solicitudes de pasajeros).
 *
 * ANDAMIAJE: cada ruta apunta a `PendingScreen` hasta que el agente del slice escribe la pantalla real. Este fichero
 * es suyo desde ese momento: cambia `component`, ajusta los tipos de `DriverParams` y añade las rutas nuevas
 * (legal, permisos, recibos…) que necesite. Reglas:
 *  - `DriverParams` es un `type` (no `interface`) y SOLO lleva datos serializables (ids, textos, números).
 *  - Los nombres de ruta son únicos en TODA la app (el registro falla al arrancar si se repiten).
 *  - `access`: "public" (también invitados) · "auth" (por defecto) · "staff".
 *  - Pantalla = componente que recibe `AppScreenProps<"Nombre">`; navega con `useAppNavigation()` y lee los
 *    parámetros con `useAppRoute("Nombre")`.
 */
import { PendingScreen } from "@/navigation/PendingScreen";
import { defineRoute, type RouteDef } from "@/navigation/routeDef";

export type DriverParams = {
  MyVehicle: { vehicleId?: string } | undefined;
  PublishRoute: { draftId?: string } | undefined;
  StopsRoute: { draftId: string };
  DriverRequests: { tripId?: string } | undefined;
  // ── Páginas adicionales de producción (catálogo de docs/BUILD_BRIEF.md §10.3). Contrato entre equipos: añade parámetros opcionales, no renombres ni quites.
  VehicleForm: { vehicleId?: string } | undefined;
  VehicleDocuments: { vehicleId: string };
  RoutePublished: { tripId?: string; seriesId?: string };
  DriverRequestDetail: { requestId?: string; weeklyReservationId?: string };
  DriverTripManage: { tripId: string };
  DriverCancelTrip: { tripId: string; bookingId?: string };
  DriverConsole: { tripId: string };
  PickupVerify: { tripId: string; bookingId?: string };
  ProposeRouteChange: { tripId: string };
  DriverTripFinished: { tripId: string };
};

export const driverRoutes: RouteDef[] = [
  defineRoute({ name: "MyVehicle", component: PendingScreen, access: "auth", screen: "17", title: "Tu vehículo" }),
  defineRoute({ name: "PublishRoute", component: PendingScreen, access: "auth", screen: "18", title: "Publica tu ruta" }),
  defineRoute({ name: "StopsRoute", component: PendingScreen, access: "auth", screen: "19", title: "Paradas y recorrido" }),
  defineRoute({ name: "DriverRequests", component: PendingScreen, access: "auth", screen: "20", title: "Solicitudes" }),
  // ── Páginas adicionales de producción (sin lámina: se diseñan en el mismo lenguaje visual)
  defineRoute({ name: "VehicleForm", component: PendingScreen, access: "auth", title: "Datos del vehículo" }),
  defineRoute({ name: "VehicleDocuments", component: PendingScreen, access: "auth", title: "Documentación del vehículo" }),
  defineRoute({ name: "RoutePublished", component: PendingScreen, access: "auth", title: "Ruta publicada" }),
  defineRoute({ name: "DriverRequestDetail", component: PendingScreen, access: "auth", title: "Detalle de la solicitud" }),
  defineRoute({ name: "DriverTripManage", component: PendingScreen, access: "auth", title: "Tu viaje publicado" }),
  defineRoute({ name: "DriverCancelTrip", component: PendingScreen, access: "auth", title: "Cancelar el viaje" }),
  defineRoute({ name: "DriverConsole", component: PendingScreen, access: "auth", title: "Consola del conductor" }),
  defineRoute({ name: "PickupVerify", component: PendingScreen, access: "auth", title: "Código de recogida" }),
  defineRoute({ name: "ProposeRouteChange", component: PendingScreen, access: "auth", title: "Proponer cambio de ruta" }),
  defineRoute({ name: "DriverTripFinished", component: PendingScreen, access: "auth", title: "Viaje terminado (conductor)" }),
];
