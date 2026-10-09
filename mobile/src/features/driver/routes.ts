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
import { DriverConsoleScreen } from "./ops/screens/DriverConsoleScreen";
import { PickupVerifyScreen } from "./ops/screens/PickupVerifyScreen";
import { DriverCancelTripScreen } from "./ops/screens/DriverCancelTripScreen";
import { DriverTripFinishedScreen } from "./ops/screens/DriverTripFinishedScreen";
import { DriverTripManageScreen } from "./ops/screens/DriverTripManageScreen";
import { ProposeRouteChangeScreen } from "./ops/screens/ProposeRouteChangeScreen";
import { PublishRouteScreen } from "./publish/screens/PublishRouteScreen";
import { StopsRouteScreen } from "./publish/screens/StopsRouteScreen";
import { RoutePublishedScreen } from "./publish/screens/RoutePublishedScreen";
import type { PlaceParam } from "@/features/search/routes";
import type { PublishFrequency } from "@/api/types";
import { VehicleFormScreen } from "./publish/screens/VehicleFormScreen";
import { VehicleDocumentsScreen } from "./publish/screens/VehicleDocumentsScreen";
import { DriverRequestDetailScreen } from "./publish/screens/DriverRequestDetailScreen";
import { MyVehicleScreen } from "./publish/screens/MyVehicleScreen";
import { DriverRequestsScreen } from "./publish/screens/DriverRequestsScreen";

/** Lo que se publicó (lo devuelve el servidor); la pantalla «Ruta publicada» lo resume. */
export interface PublishedSummary {
  origin: string;
  destination: string;
  outbound: string;
  returnAt?: string;
  seats: number;
  frequency: PublishFrequency;
  count: number;
  firstDeparture?: string;
  km?: string;
}

export type DriverParams = {
  MyVehicle: { vehicleId?: string } | undefined;
  /** `origin`/`destination` los devuelve el buscador de lugares (`PlaceSearch`). */
  PublishRoute: { draftId?: string; origin?: PlaceParam; destination?: PlaceParam } | undefined;
  StopsRoute: { draftId: string; addStop?: PlaceParam; replaceStop?: PlaceParam };
  DriverRequests: { tripId?: string } | undefined;
  // ── Páginas adicionales de producción (catálogo de docs/BUILD_BRIEF.md §10.3). Contrato entre equipos: añade parámetros opcionales, no renombres ni quites.
  VehicleForm: { vehicleId?: string } | undefined;
  VehicleDocuments: { vehicleId: string };
  RoutePublished: { tripId?: string; seriesId?: string; summary?: PublishedSummary };
  DriverRequestDetail: { requestId?: string; weeklyReservationId?: string };
  DriverTripManage: { tripId: string };
  DriverCancelTrip: { tripId: string; bookingId?: string };
  DriverConsole: { tripId: string };
  PickupVerify: { tripId: string; bookingId?: string };
  ProposeRouteChange: { tripId: string; stop?: PlaceParam };
  DriverTripFinished: { tripId: string };
};

export const driverRoutes: RouteDef[] = [
  defineRoute({ name: "MyVehicle", component: MyVehicleScreen, access: "auth", screen: "17", title: "Tu vehículo" }),
  defineRoute({ name: "PublishRoute", component: PublishRouteScreen, access: "auth", screen: "18", title: "Publica tu ruta" }),
  defineRoute({ name: "StopsRoute", component: StopsRouteScreen, access: "auth", screen: "19", title: "Paradas y recorrido" }),
  defineRoute({ name: "DriverRequests", component: DriverRequestsScreen, access: "auth", screen: "20", title: "Solicitudes" }),
  // ── Páginas adicionales de producción (sin lámina: se diseñan en el mismo lenguaje visual)
  defineRoute({ name: "VehicleForm", component: VehicleFormScreen, access: "auth", title: "Datos del vehículo" }),
  defineRoute({ name: "VehicleDocuments", component: VehicleDocumentsScreen, access: "auth", title: "Documentación del vehículo" }),
  defineRoute({ name: "RoutePublished", component: RoutePublishedScreen, access: "auth", title: "Ruta publicada" }),
  defineRoute({ name: "DriverRequestDetail", component: DriverRequestDetailScreen, access: "auth", title: "Detalle de la solicitud" }),
  defineRoute({ name: "DriverTripManage", component: DriverTripManageScreen, access: "auth", title: "Tu viaje publicado" }),
  defineRoute({ name: "DriverCancelTrip", component: DriverCancelTripScreen, access: "auth", title: "Cancelar el viaje" }),
  defineRoute({ name: "DriverConsole", component: DriverConsoleScreen, access: "auth", title: "Consola del conductor" }),
  defineRoute({ name: "PickupVerify", component: PickupVerifyScreen, access: "auth", title: "Código de recogida" }),
  defineRoute({ name: "ProposeRouteChange", component: ProposeRouteChangeScreen, access: "auth", title: "Proponer cambio de ruta" }),
  defineRoute({ name: "DriverTripFinished", component: DriverTripFinishedScreen, access: "auth", title: "Viaje terminado (conductor)" }),
];
