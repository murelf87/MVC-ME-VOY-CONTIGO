import { useApiQuery, type UseApiQueryResult } from "@/hooks";
import type { RoutePlanResponse } from "@/api/types";
import { planRoute, provinceFor } from "../api";
import { publishKeys } from "../keys";
import { planBody, planKey, type RouteDraft } from "../logic/routeDraft";

/**
 * Plan de la ruta del borrador (`POST /v1/me/routes/plan`, sin efectos): paradas con hora, veredicto por provincia y
 * trazado. Se vuelve a pedir solo cuando cambia algo que cambia la ruta (`planKey`). La provincia es la que contiene el origen.
 */
export function useRoutePlan(draft: RouteDraft | undefined): UseApiQueryResult<RoutePlanResponse> {
  const ready = draft !== undefined && draft.origin !== null && draft.destination !== null;
  const key = draft === undefined || !ready ? "none" : planKey(draft);
  return useApiQuery<RoutePlanResponse>(
    publishKeys.plan(key),
    async ({ signal }) => {
      if (draft === undefined || draft.origin === null) throw new Error("ROUTE_DRAFT_INCOMPLETE");
      const province = await provinceFor(draft.origin, { signal });
      const body = planBody(draft, province.id);
      if (body === null) throw new Error("ROUTE_DRAFT_INCOMPLETE");
      return planRoute(body, { signal });
    },
    { enabled: ready, staleTimeMs: 60_000, keepPreviousData: true, refetchOnFocus: false },
  );
}
