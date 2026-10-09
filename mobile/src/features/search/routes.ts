/**
 * Rutas del slice `search` (láminas 03 y 04: mapa, buscar, resultados, detalle y solicitud de plaza).
 *
 * ANDAMIAJE: cada ruta apunta a `PendingScreen` hasta que el agente del slice escribe la pantalla real. Este fichero
 * es suyo desde ese momento: cambia `component`, ajusta los tipos de `SearchParams` y añade las rutas nuevas
 * (legal, permisos, recibos…) que necesite. Reglas:
 *  - `SearchParams` es un `type` (no `interface`) y SOLO lleva datos serializables (ids, textos, números).
 *  - Los nombres de ruta son únicos en TODA la app (el registro falla al arrancar si se repiten).
 *  - `access`: "public" (también invitados) · "auth" (por defecto) · "staff".
 *  - Pantalla = componente que recibe `AppScreenProps<"Nombre">`; navega con `useAppNavigation()` y lee los
 *    parámetros con `useAppRoute("Nombre")`.
 */
import { PendingScreen } from "@/navigation/PendingScreen";
import { defineRoute, type RouteDef } from "@/navigation/routeDef";
import type { IsoDate, LocalTime, SearchMode, TripCategory, TripLeg, Weekday } from "@/api/types";
import { MapHomeScreen } from "./browse/screens/MapHomeScreen";
import { PlaceSearchScreen } from "./browse/screens/PlaceSearchScreen";
import type { PickupSummary } from "./request/types";

/** Lugar elegido en el buscador (coordenadas WGS84). */
export type PlaceParam = { label: string; latitude: number; longitude: number };

/** Lo que la persona pidió en «Define tu recorrido». Viaja entre las pantallas de búsqueda y solicitud. */
export type SearchCriteriaParam = {
  origin: PlaceParam;
  destination: PlaceParam;
  mode: SearchMode;
  /** «Llegada al destino» (HH:mm, hora de Madrid). */
  arriveBy: LocalTime;
  returnAt?: LocalTime;
  /** Obligatoria si `mode` es `one_off`. */
  date?: IsoDate;
  weekdays?: Weekday[];
  category?: TripCategory;
};

export type SearchParams = {
  MapHome: undefined;
  DefineRoute: { origin?: PlaceParam; destination?: PlaceParam; category?: TripCategory } | undefined;
  TripResults: { criteria: SearchCriteriaParam };
  TripDetail: { tripId: string; criteria?: SearchCriteriaParam; dropoffStopSeq?: number };
  /** `origin` (opcional): desde dónde sale la persona; si falta se usa el de `criteria` o se pregunta en la pantalla. */
  PickupPoint: { tripId: string; criteria?: SearchCriteriaParam; dropoffStopSeq?: number; origin?: PlaceParam };
  WeeklySeat: {
    tripId: string;
    pickupPointId: string;
    dropoffStopSeq?: number;
    criteria?: SearchCriteriaParam;
    /** Resumen del punto elegido en la pantalla 13 (nombre, dirección, minutos a pie). */
    pickup?: PickupSummary;
  };
  ReviewRequest: {
    tripId: string;
    pickupPointId: string;
    dropoffStopSeq?: number;
    criteria?: SearchCriteriaParam;
    pickup?: PickupSummary;
    /** Presente si es una reserva semanal. */
    weekly?: {
      weekdays: Weekday[];
      startDate: IsoDate;
      weeks: number;
      legs: TripLeg[];
      /** Días que NO necesita (vacaciones, festivos…). */
      exceptionDates?: IsoDate[];
      /** La persona acepta reservar solo los días con plaza. */
      allowPartial?: boolean;
    };
  };
  /** `reservationId`: si la solicitud pertenece a una reserva semanal, la pantalla enseña el conjunto de días. */
  RequestStatusPayment: { requestId: string; reservationId?: string };
  // ── Páginas adicionales de producción (catálogo de docs/BUILD_BRIEF.md §10.3). Contrato entre equipos: añade parámetros opcionales, no renombres ni quites.
  /**
   * Buscador de lugares (lo escribe `search-browse`; lo usan también `profile` —favoritos— y `driver` —paradas—).
   * `field` "origin"/"destination": vuelve a `DefineRoute` con ese campo. `field` "place": lugar genérico; EXIGE `returnTo`.
   * Con `returnTo` el lugar elegido vuelve a esa pantalla con `StackActions.popTo(returnTo.route, { [returnTo.param]: place }, { merge: true })`
   * (en React Navigation 7 `navigate({ merge: true })` NO vuelve a una pantalla que ya está en la pila: apilaría otra).
   * Quien lo recibe usa `usePlaceResult(param, onPlace)` de `features/search/browse/hooks/usePlaceResult`.
   * (`route` es texto para no crear una dependencia circular de tipos con `AppParamList`).
   */
  PlaceSearch: {
    field: "origin" | "destination" | "place";
    current?: PlaceParam;
    returnTo?: { route: string; param: string };
    /** Título de la pantalla cuando `field` es "place" (p. ej. «Dirección del destino»). */
    title?: string;
  };
  /** `paymentIds`: en una reserva semanal se paga una solicitud por día; se sondean todos y se resume el conjunto. */
  PaymentProcessing: { requestId: string; paymentId: string; reservationId?: string; paymentIds?: string[] };
  /** `result`: salida local cuando no hay estado final del servidor ("cancelled" = cerró la hoja de pago; "timeout" = no llegó la confirmación). */
  PaymentResult: {
    requestId: string;
    paymentId: string;
    reservationId?: string;
    paymentIds?: string[];
    result?: "cancelled" | "timeout";
  };
};

export const searchRoutes: RouteDef[] = [
  defineRoute({ name: "MapHome", component: MapHomeScreen, access: "public", screen: "09", title: "Mapa" }),
  defineRoute({ name: "DefineRoute", component: PendingScreen, access: "public", screen: "10", title: "Define tu recorrido" }),
  defineRoute({ name: "TripResults", component: PendingScreen, access: "public", screen: "11", title: "Resultados" }),
  defineRoute({ name: "TripDetail", component: PendingScreen, access: "public", screen: "12", title: "Detalle del viaje" }),
  defineRoute({ name: "PickupPoint", component: PendingScreen, access: "public", screen: "13", title: "Punto de recogida" }),
  defineRoute({ name: "WeeklySeat", component: PendingScreen, access: "public", screen: "14", title: "Tu plaza semanal" }),
  defineRoute({ name: "ReviewRequest", component: PendingScreen, access: "auth", screen: "15", title: "Revisa tu solicitud" }),
  defineRoute({ name: "RequestStatusPayment", component: PendingScreen, access: "auth", screen: "16", title: "Estado y pago" }),
  // ── Páginas adicionales de producción (sin lámina: se diseñan en el mismo lenguaje visual)
  defineRoute({
    name: "PlaceSearch",
    component: PlaceSearchScreen,
    access: "public",
    title: "Buscar lugar",
    previewParams: { field: "destination" },
  }),
  defineRoute({ name: "PaymentProcessing", component: PendingScreen, access: "auth", title: "Procesando el pago" }),
  defineRoute({ name: "PaymentResult", component: PendingScreen, access: "auth", title: "Resultado del pago" }),
];
