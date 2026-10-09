import { useMemo } from "react";
import type { DriverReadiness } from "@/api/types/trips";
import { useApiQuery, type UseApiQueryResult } from "@/hooks";
import { getDriverReadiness } from "../api";
import { publishKeys } from "../keys";
import { buildRows, type RequirementRow } from "../logic/readiness";

/** Qué falta para publicar rutas. El servidor decide (`canPublish`). */
export function useDriverReadiness(enabled = true): UseApiQueryResult<DriverReadiness> {
  return useApiQuery<DriverReadiness>(publishKeys.readiness, ({ signal }) => getDriverReadiness({ signal }), {
    enabled,
    staleTimeMs: 15_000,
  });
}

/** Filas de requisitos listas para pintar (vacío mientras no hay datos). */
export function useRequirementRows(readiness: DriverReadiness | undefined): RequirementRow[] {
  return useMemo(() => (readiness === undefined ? [] : buildRows(readiness)), [readiness]);
}
