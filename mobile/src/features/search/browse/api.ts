/**
 * Cliente de red de las pantallas de exploración (`search-browse`): categorías, mapa de coches, búsqueda, detalle del
 * viaje, presupuesto y geocodificación del núcleo. Contrato: docs/contracts/trips.md §1–§5 y §7.1, y
 * `GET /v1/maps/geocode|reverse` del módulo de mapas.
 *
 *   GET  /v1/trip-categories          → { items: [{ id, label }] }                 (pública)
 *   GET  /v1/trips/map                → MapCarsResponse                            (sesión opcional)
 *   GET  /v1/search/trips             → TripSearchPage                             (sesión opcional)
 *   GET  /v1/trips/:tripId            → TripDetail                                 (sesión opcional)
 *   POST /v1/trips/:tripId/quote      → TripQuoteResponse (sin efectos)            (sesión opcional)
 *   GET  /v1/maps/geocode?query=…     → { results: GeocodeResult[] }               (sesión opcional)
 *   GET  /v1/maps/reverse?lat&lng     → { results: GeocodeResult[] }               (sesión opcional)
 *
 * «Sesión opcional»: un invitado puede explorar (buscar lugares, ver el mapa, buscar y abrir viajes); solo solicitar plaza
 * exige cuenta. Si se envía la cabecera `Authorization` tiene que ser válida (401 si no). El geocodificador se paga por
 * consulta, así que al invitado le corresponde un límite de frecuencia más estricto: un 429 (`RATE_LIMITED`) es un error
 * recuperable que las pantallas enseñan con «Reintentar».
 *
 * Ninguna de estas llamadas crea nada, así que no llevan `Idempotency-Key`. Las pantallas NO importan este fichero:
 * pasan por los hooks de `./hooks`.
 */
import { apiRequest, registerErrorMessages, resolveProvince, type CallOptions } from "@/api";
import type {
  GeocodeResult,
  MapCarsQuery,
  MapCarsResponse,
  Province,
  TripCategoriesResponse,
  TripDetail,
  TripDetailQuery,
  TripQuoteRequest,
  TripQuoteResponse,
  TripSearchPage,
  TripSearchQuery,
} from "@/api/types";

registerErrorMessages({
  ORIGIN_OUTSIDE_PROVINCE: {
    title: "Origen fuera de provincia",
    message: "El origen que has elegido está fuera de la provincia. Elige un lugar dentro de ella.",
  },
  DESTINATION_OUTSIDE_PROVINCE: {
    title: "Destino fuera de provincia",
    message: "El destino seleccionado está fuera de la provincia.",
  },
  SEARCH_DATE_REQUIRED: {
    title: "Falta la fecha",
    message: "Elige el día del viaje puntual para poder buscar.",
  },
  INVALID_SEARCH_WEEKDAYS: {
    title: "Faltan los días",
    message: "Elige al menos un día de la semana para buscar.",
  },
  INVALID_CURSOR: {
    title: "La lista ha cambiado",
    message: "Los resultados han cambiado mientras mirabas. Vuelve a buscar.",
  },
  TRIP_NOT_FOUND: {
    title: "Viaje no disponible",
    message: "Este viaje ya no está disponible. Puede que el conductor lo haya cancelado.",
  },
  TRIP_NOT_BOOKABLE: {
    title: "No admite solicitudes",
    message: "Este viaje ya no admite solicitudes de plaza.",
  },
  MAPS_PROVIDER_NOT_CONFIGURED: {
    title: "Buscador no disponible",
    message: "El buscador de lugares no está disponible ahora mismo. Inténtalo de nuevo más tarde.",
  },
  MAPS_PROVIDER_UNAVAILABLE: {
    title: "Buscador no disponible",
    message: "El buscador de lugares no está disponible ahora mismo. Inténtalo de nuevo más tarde.",
  },
});

export async function listTripCategories(options: CallOptions = {}): Promise<TripCategoriesResponse> {
  return apiRequest<TripCategoriesResponse>("/v1/trip-categories", options);
}

export async function getMapCars(query: MapCarsQuery, options: CallOptions = {}): Promise<MapCarsResponse> {
  return apiRequest<MapCarsResponse>("/v1/trips/map", { query: { ...query }, ...options });
}

export async function searchTrips(query: TripSearchQuery, options: CallOptions = {}): Promise<TripSearchPage> {
  return apiRequest<TripSearchPage>("/v1/search/trips", { query: { ...query }, ...options });
}

export async function getTripDetail(tripId: string, query: TripDetailQuery = {}, options: CallOptions = {}): Promise<TripDetail> {
  return apiRequest<TripDetail>(`/v1/trips/${encodeURIComponent(tripId)}`, { query: { ...query }, ...options });
}

/** «Ver desglose»: calcula la aportación del tramo. No crea ni reserva nada. */
export async function quoteTrip(tripId: string, body: TripQuoteRequest = {}, options: CallOptions = {}): Promise<TripQuoteResponse> {
  return apiRequest<TripQuoteResponse>(`/v1/trips/${encodeURIComponent(tripId)}/quote`, {
    method: "POST",
    body,
    ...options,
  });
}

/** Texto → lugares con coordenadas (geocodificación del núcleo). */
export async function geocodePlaces(query: string, options: CallOptions = {}): Promise<GeocodeResult[]> {
  const response = await apiRequest<{ results: GeocodeResult[] }>("/v1/maps/geocode", { query: { query }, ...options });
  return response.results;
}

/** Resultado de comprobar si un punto cae dentro de una provincia disponible. */
export type ProvinceCheck =
  | { ok: true; province: Province }
  | { ok: false; reason: "outside" }
  | { ok: false; reason: "error"; error: unknown };

/** `GET /v1/provinces/resolve`: ¿está este punto en una provincia disponible? (pública, no falla por falta de cuenta). */
export async function checkPlaceProvince(
  point: { latitude: number; longitude: number },
  options: CallOptions = {},
): Promise<ProvinceCheck> {
  try {
    const province = await resolveProvince(point, options);
    return province === null ? { ok: false, reason: "outside" } : { ok: true, province };
  } catch (error) {
    return { ok: false, reason: "error", error };
  }
}

/** Coordenadas → dirección más cercana. */
export async function reversePlace(point: { latitude: number; longitude: number }, options: CallOptions = {}): Promise<GeocodeResult[]> {
  const response = await apiRequest<{ results: GeocodeResult[] }>("/v1/maps/reverse", {
    query: { latitude: point.latitude, longitude: point.longitude },
    ...options,
  });
  return response.results;
}
