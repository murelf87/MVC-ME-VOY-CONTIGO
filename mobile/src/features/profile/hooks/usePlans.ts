/**
 * Planes MVC: el catálogo (`GET /v1/plans`) y el plan de la persona (`GET /v1/me/plan`). Solo lectura: no existe compra.
 */
import type { MyPlanResponse, PlansResponse } from "@/api/types";
import { useApiQuery, type UseApiQueryResult } from "@/hooks";
import { getMyPlan, listPlans } from "../api";
import { MY_PLAN, PLANS } from "./keys";

export function usePlans(): UseApiQueryResult<PlansResponse> {
  return useApiQuery<PlansResponse>(PLANS, ({ signal }) => listPlans({ signal }), { staleTimeMs: 60_000 });
}

/** El plan actual no impide ver el catálogo: si falla, las tarjetas se pintan sin marcar ninguno como «tu plan». */
export function useMyPlan(): UseApiQueryResult<MyPlanResponse> {
  return useApiQuery<MyPlanResponse>(MY_PLAN, ({ signal }) => getMyPlan({ signal }), { staleTimeMs: 60_000 });
}
