/**
 * Provincias disponibles (`GET /v1/provinces`) y la provincia activa de la persona (se recuerda entre sesiones).
 * El mapa, la búsqueda y el detalle trabajan siempre dentro de una sola provincia: la activa.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { listProvinces } from "@/api";
import type { Province } from "@/api/types";
import { useApiQuery } from "@/hooks";
import { getJson, preferences, setJson } from "@/platform";
import { pickActiveProvince } from "../logic/province";

const STORAGE_KEY = "search.provinceId.v1";

// Mini-almacén compartido por las pantallas de exploración (mapa, recorrido, resultados).
let selectedId: string | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function getSnapshot(): string | null {
  return selectedId;
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  void getJson<unknown>(preferences, STORAGE_KEY).then((value) => {
    if (typeof value === "string" && selectedId === null) {
      selectedId = value;
      emit();
    }
  });
}

export interface UseProvincesResult {
  provinces: readonly Province[];
  /** Provincia activa (la elegida si sigue disponible; si no, la primera). `null` mientras no hay lista. */
  province: Province | null;
  select(provinceId: string): void;
  isLoading: boolean;
  isError: boolean;
  isOffline: boolean;
  error: Error | null;
  refetch(): void;
}

export function useProvinces(): UseProvincesResult {
  useEffect(hydrate, []);
  const query = useApiQuery<Province[]>(["provinces"], ({ signal }) => listProvinces({ signal }), { staleTimeMs: 10 * 60_000 });
  const chosen = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const provinces = useMemo<readonly Province[]>(() => query.data ?? [], [query.data]);
  const province = useMemo(() => pickActiveProvince(provinces, chosen), [provinces, chosen]);

  const select = useCallback((provinceId: string) => {
    selectedId = provinceId;
    emit();
    void setJson(preferences, STORAGE_KEY, provinceId);
  }, []);

  return {
    provinces,
    province,
    select,
    isLoading: query.isLoading,
    isError: query.isError,
    isOffline: query.isOffline,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
