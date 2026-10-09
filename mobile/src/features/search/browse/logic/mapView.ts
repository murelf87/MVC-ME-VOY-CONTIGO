/**
 * Qué cuenta el mapa de inicio (09) encima y debajo de los coches, según provincias, consulta y filtros (lógica pura).
 *
 * Dos capas independientes:
 *  - `overlay`: UN estado que sustituye a los coches (cargando, sin provincias, error, sin conexión sin datos, vacío);
 *  - `notice`: un aviso sobre los coches que SÍ se ven (sin conexión con datos de antes, no se pudo actualizar,
 *    lista recortada).
 */
import type { MapCarsResponse } from "@/api/types";
import { hasAnyFilter, type MapFilter } from "./mapCars";

export interface MapViewInput {
  provinces: { isLoading: boolean; isError: boolean; isOffline: boolean; count: number };
  /** Hay provincia activa (si no, no se puede pedir nada). */
  hasProvince: boolean;
  cars: {
    data: MapCarsResponse | undefined;
    isLoading: boolean;
    isError: boolean;
    isOffline: boolean;
    failedToRefresh: boolean;
    error: unknown;
  };
  filter: MapFilter;
}

export type MapOverlay =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "provincesError"; offline: boolean }
  | { kind: "noProvinces" }
  | { kind: "carsError"; error: unknown }
  | { kind: "carsOffline" }
  | { kind: "empty"; filtered: boolean };

export type MapNotice = { kind: "none" } | { kind: "offlineCached" } | { kind: "staleRefresh" } | { kind: "truncated" };

export interface MapViewState {
  overlay: MapOverlay;
  notice: MapNotice;
}

export function deriveMapView(input: MapViewInput): MapViewState {
  const { provinces, cars, filter } = input;
  const none: MapNotice = { kind: "none" };

  if (!input.hasProvince) {
    if (provinces.isLoading) return { overlay: { kind: "loading" }, notice: none };
    if (provinces.isError || provinces.isOffline) {
      return { overlay: { kind: "provincesError", offline: provinces.isOffline }, notice: none };
    }
    return { overlay: { kind: "noProvinces" }, notice: none };
  }

  const data = cars.data;
  if (data === undefined) {
    if (cars.isLoading) return { overlay: { kind: "loading" }, notice: none };
    if (cars.isOffline) return { overlay: { kind: "carsOffline" }, notice: none };
    if (cars.isError) return { overlay: { kind: "carsError", error: cars.error }, notice: none };
    return { overlay: { kind: "loading" }, notice: none };
  }

  const notice: MapNotice = cars.isOffline
    ? { kind: "offlineCached" }
    : cars.failedToRefresh
      ? { kind: "staleRefresh" }
      : data.truncated
        ? { kind: "truncated" }
        : none;
  if (data.cars.length === 0) {
    return { overlay: { kind: "empty", filtered: hasAnyFilter(filter) }, notice };
  }
  return { overlay: { kind: "none" }, notice };
}
