/**
 * Provincia de la persona (la línea «Sevilla, Sevilla» de Mi perfil): el municipio sale de su dirección de casa y el nombre
 * de la provincia, de la lista oficial de provincias de MVC.
 */
import { useMemo } from "react";
import type { Province } from "@/api/types";
import { useApiQuery, type UseApiQueryResult } from "@/hooks";
import { fetchProvinces } from "../api";
import { locationLine, provinceIdOfFavorites } from "../model/profileHeader";
import { PROVINCES } from "./keys";
import { useFavorites } from "./useFavorites";

/** La lista de provincias casi no cambia: se reutiliza durante diez minutos. */
export function useProvinces(): UseApiQueryResult<Province[]> {
  return useApiQuery<Province[]>(PROVINCES, ({ signal }) => fetchProvinces({ signal }), { staleTimeMs: 600_000 });
}

/**
 * Municipio y provincia («Sevilla, Sevilla»), o solo lo que se sepa. `null` si no hay nada que mostrar (ni destinos guardados
 * ni provincias cargadas): la pantalla oculta la línea en vez de inventarla.
 */
export function useProfileLocation(): string | null {
  const favorites = useFavorites();
  const provinces = useProvinces();
  return useMemo(() => {
    const items = favorites.data?.items ?? [];
    const list = provinces.data ?? [];
    const provinceId = provinceIdOfFavorites(items);
    const byId = provinceId !== null ? list.find((province) => province.id === provinceId) : undefined;
    // MVC funciona dentro de una sola provincia: sin destinos guardados, si solo hay una disponible, es la suya.
    const only = list.length === 1 ? list[0] : undefined;
    const name = (byId ?? only)?.name ?? null;
    return locationLine(items, name);
  }, [favorites.data, provinces.data]);
}
