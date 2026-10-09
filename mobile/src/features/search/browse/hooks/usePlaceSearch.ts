/**
 * Búsqueda de lugares por texto con el geocodificador del núcleo (`GET /v1/maps/geocode`).
 *
 *  - Espera 350 ms tras la última tecla y no pide nada con menos de 3 letras.
 *  - La sesión es OPCIONAL: un invitado busca igual que quien tiene cuenta (el servidor le aplica un límite de frecuencia
 *    más estricto; un 429 sale como error con «Reintentar»). Solo si el servidor contesta 401 (sesión caducada o
 *    rechazada) la pantalla enseña el aviso de cuenta.
 *  - Los resultados quedan en caché 5 minutos por texto; al escribir se cancela la petición anterior.
 */
import { useMemo } from "react";
import { isAuthRequiredError } from "@/api";
import { useApiQuery, useDebouncedValue } from "@/hooks";
import { geocodePlaces } from "../api";
import { canSearch, normalizeQuery } from "../logic/places";
import { derivePlaceListView, type PlaceListView } from "../logic/placeListView";

const DEBOUNCE_MS = 350;
const STALE_MS = 5 * 60_000;

export interface UsePlaceSearchResult {
  view: PlaceListView;
  /** Pide de nuevo los resultados (botón «Reintentar»). */
  retry(): void;
}

export function usePlaceSearch(text: string): UsePlaceSearchResult {
  const normalized = normalizeQuery(text);
  const debounced = useDebouncedValue(normalized, DEBOUNCE_MS);
  const enabled = canSearch(debounced);

  const query = useApiQuery(
    ["places", "geocode", debounced],
    ({ signal }) => geocodePlaces(debounced, { signal }),
    { enabled, staleTimeMs: STALE_MS, refetchOnFocus: false },
  );

  const view = useMemo(
    () =>
      derivePlaceListView({
        text: normalized,
        debouncedText: debounced,
        query: {
          data: query.data,
          isLoading: query.isLoading,
          isIdle: query.isIdle,
          isError: query.isError,
          isOffline: query.isOffline,
          error: query.error,
        },
        authRequired: isAuthRequiredError(query.error),
      }),
    [normalized, debounced, query.data, query.isLoading, query.isIdle, query.isError, query.isOffline, query.error],
  );

  return { view, retry: () => void query.refetch() };
}
