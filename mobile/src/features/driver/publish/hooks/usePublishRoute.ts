import type { PublishRouteResponse } from "@/api/types";
import { useApiMutation, type UseApiMutationResult } from "@/hooks";
import { TRIPS_OVERVIEW } from "@/features/profile/hooks/keys";
import { provinceFor, publishRoute } from "../api";
import { publishKeys } from "../keys";
import { publishBody, type RouteDraft } from "../logic/routeDraft";

export interface PublishVars {
  draft: RouteDraft;
  vehicleId: string;
}

/** «Guardar ruta»: provincia del origen + `POST /v1/me/routes` con `Idempotency-Key` (reintentar no duplica los viajes). */
export function usePublishRoute(): UseApiMutationResult<PublishRouteResponse, PublishVars> {
  return useApiMutation<PublishRouteResponse, PublishVars>(
    async ({ draft, vehicleId }, { idempotencyKey, signal }) => {
      if (draft.origin === null) throw new Error("ROUTE_DRAFT_INCOMPLETE");
      const province = await provinceFor(draft.origin, { signal });
      const body = publishBody(draft, vehicleId, province.id);
      if (body === null) throw new Error("ROUTE_DRAFT_INCOMPLETE");
      return publishRoute(body, { idempotencyKey, signal });
    },
    { invalidates: [publishKeys.requests(), publishKeys.readiness, TRIPS_OVERVIEW] },
  );
}
