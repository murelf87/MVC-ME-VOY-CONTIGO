/**
 * Qué muestra el buscador de lugares bajo el campo, según lo escrito y el estado de la consulta (lógica pura).
 * El resultado es una unión explícita para que la pantalla pinte UN estado: pista, invitado, cargando, resultados,
 * sin resultados, sin conexión o error.
 */
import type { GeocodeResult } from "@/api/types";
import type { IconName } from "@/icons";
import type { PlaceParam } from "../../routes";
import { canSearch, describeAddress, iconForPlaceTypes, normalizeQuery, placeFromGeocode } from "./places";

export interface PlaceItem {
  id: string;
  title: string;
  subtitle: string | null;
  icon: IconName;
  place: PlaceParam;
}

/** Máximo de filas que se pintan (el servidor devuelve pocas; esto protege la pantalla). */
export const MAX_PLACE_ITEMS = 8;

/** Resultados del geocodificador → filas, sin repetir el mismo `placeId`. */
export function toPlaceItems(results: readonly GeocodeResult[], limit: number = MAX_PLACE_ITEMS): PlaceItem[] {
  const seen = new Set<string>();
  const items: PlaceItem[] = [];
  for (const result of results) {
    if (seen.has(result.placeId)) continue;
    seen.add(result.placeId);
    const display = describeAddress(result.formattedAddress);
    items.push({
      id: result.placeId,
      title: display.title,
      subtitle: display.subtitle,
      icon: iconForPlaceTypes(result.types),
      place: placeFromGeocode(result),
    });
    if (items.length >= limit) break;
  }
  return items;
}

export type PlaceListView =
  | { kind: "hint" }
  | { kind: "guest" }
  | { kind: "loading" }
  | { kind: "results"; items: PlaceItem[] }
  | { kind: "empty" }
  | { kind: "offline" }
  | { kind: "error"; error: unknown };

export interface PlaceListInput {
  /** Lo que hay escrito ahora mismo. */
  text: string;
  /** Lo escrito tras la espera anti-rebote (la consulta va con este valor). */
  debouncedText: string;
  query: {
    data: readonly GeocodeResult[] | undefined;
    isLoading: boolean;
    isIdle: boolean;
    isError: boolean;
    isOffline: boolean;
    error: unknown;
  };
  /**
   * La consulta falló con 401 (sesión caducada o rechazada). Un invitado NO llega aquí: el geocodificador acepta sesión
   * opcional y solo contesta 401 si se envía una cabecera inválida.
   */
  authRequired: boolean;
}

export function derivePlaceListView(input: PlaceListInput): PlaceListView {
  const text = normalizeQuery(input.text);
  if (!canSearch(text)) return { kind: "hint" };

  const settled = text === normalizeQuery(input.debouncedText);
  const { data } = input.query;
  if (settled && data !== undefined) {
    return data.length === 0 ? { kind: "empty" } : { kind: "results", items: toPlaceItems(data) };
  }
  if (!settled || input.query.isLoading || input.query.isIdle) return { kind: "loading" };
  if (input.query.isOffline) return { kind: "offline" };
  if (input.authRequired) return { kind: "guest" };
  if (input.query.isError) return { kind: "error", error: input.query.error };
  return { kind: "loading" };
}
