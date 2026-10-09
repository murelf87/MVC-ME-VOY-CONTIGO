/**
 * Datos de la pantalla 37: indicadores del periodo (con comparación con el periodo anterior de la misma duración) y
 * actividad de vehículos (aproximada). Son dos consultas independientes: si falla el mapa, las baldosas se siguen viendo.
 */
import type { AdminPeriod, AdminSummary, AdminVehicleActivity } from "@/api/types";
import { useApiQuery, type UseApiQueryResult } from "@/hooks";
import { getAdminSummary, getVehicleActivity } from "../api";
import { summaryKey, vehicleActivityKey } from "../keys";

export function useAdminSummary(provinceId: string | null, period: AdminPeriod, enabled: boolean): UseApiQueryResult<AdminSummary> {
  return useApiQuery(summaryKey(provinceId, period), ({ signal }) => getAdminSummary({ provinceId, period }, { signal }), {
    enabled,
    staleTimeMs: 30_000,
    keepPreviousData: true,
  });
}

/** La actividad se refresca sola cada medio minuto mientras la pantalla está a la vista: son posiciones recientes. */
export function useVehicleActivity(provinceId: string | null, enabled: boolean): UseApiQueryResult<AdminVehicleActivity> {
  return useApiQuery(vehicleActivityKey(provinceId), ({ signal }) => getVehicleActivity({ provinceId }, { signal }), {
    enabled,
    staleTimeMs: 20_000,
    refetchIntervalMs: 30_000,
    keepPreviousData: true,
  });
}
