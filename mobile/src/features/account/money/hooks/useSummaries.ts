/**
 * Resúmenes mensuales de la pantalla 33: pasajero (`passenger-summary`) y conductor (`driver-summary`).
 * Al cambiar de mes se siguen mostrando los datos del mes anterior hasta que llegan los nuevos (sin parpadeo).
 */
import type { DriverPaymentsSummary, PassengerPaymentsSummary } from "@/api/types/money";
import { useApiQuery, type UseApiQueryResult } from "@/hooks";
import { getDriverSummary, getPassengerSummary } from "../api";
import { moneyKeys } from "./keys";

/** Los importes pueden cambiar con los eventos del proveedor: se revalidan con frecuencia moderada. */
const SUMMARY_STALE_MS = 15_000;

export function usePassengerSummary(month: string, enabled = true): UseApiQueryResult<PassengerPaymentsSummary> {
  return useApiQuery(moneyKeys.passengerSummary(month), ({ signal }) => getPassengerSummary(month, { signal }), {
    enabled,
    staleTimeMs: SUMMARY_STALE_MS,
    keepPreviousData: true,
  });
}

export function useDriverSummary(month: string, enabled = true): UseApiQueryResult<DriverPaymentsSummary> {
  return useApiQuery(moneyKeys.driverSummary(month), ({ signal }) => getDriverSummary(month, { signal }), {
    enabled,
    staleTimeMs: SUMMARY_STALE_MS,
    keepPreviousData: true,
  });
}
