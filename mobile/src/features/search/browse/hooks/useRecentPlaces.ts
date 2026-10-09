/**
 * Lugares que la persona eligió últimamente en el buscador (solo en este dispositivo, en `preferences`).
 * Se muestran cuando el campo está vacío. «Borrar» los elimina del almacén.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getJson, preferences, setJson } from "@/platform";
import type { PlaceParam } from "../../routes";
import { parseRecentPlaces, rememberPlace } from "../logic/places";

const STORAGE_KEY = "search.recentPlaces.v1";

export interface UseRecentPlacesResult {
  places: readonly PlaceParam[];
  /** `true` cuando ya se leyó el almacén (evita parpadeos del bloque «Recientes»). */
  loaded: boolean;
  remember(place: PlaceParam): void;
  clear(): void;
}

export function useRecentPlaces(): UseRecentPlacesResult {
  const [places, setPlaces] = useState<PlaceParam[]>([]);
  const [loaded, setLoaded] = useState(false);
  const current = useRef<PlaceParam[]>([]);

  useEffect(() => {
    let cancelled = false;
    void getJson<unknown>(preferences, STORAGE_KEY).then((raw) => {
      if (cancelled) return;
      const parsed = parseRecentPlaces(raw);
      current.current = parsed;
      setPlaces(parsed);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const remember = useCallback((place: PlaceParam) => {
    const next = rememberPlace(current.current, place);
    current.current = next;
    setPlaces(next);
    void setJson(preferences, STORAGE_KEY, next);
  }, []);

  const clear = useCallback(() => {
    current.current = [];
    setPlaces([]);
    void preferences.remove(STORAGE_KEY);
  }, []);

  return { places, loaded, remember, clear };
}
