/**
 * Filtro de provincia de 37 y 39: lista del servidor + elección de la persona (por defecto, la primera provincia;
 * hoy solo existe Sevilla). No se pide ninguna lista hasta saber qué provincia es (`ready`), para no pedir «todas» y
 * luego «Sevilla».
 */
import { useCallback, useMemo, useState } from "react";
import { useAdminProvinces } from "./useAdminMe";
import { provinceOptions, resolveProvince, type FilterOption, type ProvinceView } from "../logic/filters";

export interface ProvinceFilter {
  /** Ya se sabe qué provincia mirar (elegida, cargada o imposible de cargar). */
  ready: boolean;
  selected: ProvinceView;
  options: Array<FilterOption<string>>;
  /** Valor marcado en la hoja de opciones. */
  selectedValue: string;
  choose: (value: string) => void;
}

export function useProvinceFilter(): ProvinceFilter {
  const provinces = useAdminProvinces();
  const [choice, setChoice] = useState<string | null>(null);

  const selected = useMemo(() => resolveProvince(choice, provinces.data), [choice, provinces.data]);
  const options = useMemo(() => provinceOptions(provinces.data), [provinces.data]);
  const ready = choice !== null || provinces.data !== undefined || provinces.isError || provinces.isOffline;
  const choose = useCallback((value: string) => setChoice(value), []);

  return { ready, selected, options, selectedValue: selected.id ?? options[0]?.value ?? "", choose };
}
