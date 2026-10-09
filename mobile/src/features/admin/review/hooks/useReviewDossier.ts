/**
 * Expediente de una persona usuaria y las decisiones sobre él.
 *
 * Tras decidir se invalidan la cola (en todas sus pestañas), el expediente y el contador del inicio del panel: el
 * servidor es la única fuente de verdad, la pantalla no cambia nada «a mano».
 */
import type { AdminDossier, AdminReviewDecisionRequest, AdminReviewDecisionResult } from "@/api/types";
import { useApiMutation, useApiQuery, type UseApiMutationResult, type UseApiQueryResult } from "@/hooks";
import { decideReview, getReviewDossier, reviewVehicle, type VehicleReviewBody } from "../api";
import { ADMIN_REVIEW_DOSSIER, ADMIN_REVIEW_QUEUE, HOME_PENDING_REVIEWS, reviewDossierKey } from "../keys";

export function useReviewDossier(userId: string, enabled = true): UseApiQueryResult<AdminDossier> {
  return useApiQuery(reviewDossierKey(userId), ({ signal }) => getReviewDossier(userId, { signal }), { enabled, staleTimeMs: 10_000 });
}

export interface DecisionVariables {
  userId: string;
  body: AdminReviewDecisionRequest;
}

export function useReviewDecision(): UseApiMutationResult<AdminReviewDecisionResult, DecisionVariables> {
  return useApiMutation<AdminReviewDecisionResult, DecisionVariables>(
    (variables, { signal }) => decideReview(variables.userId, variables.body, { signal }),
    { invalidates: [ADMIN_REVIEW_QUEUE, ADMIN_REVIEW_DOSSIER, HOME_PENDING_REVIEWS] },
  );
}

export interface VehicleDecisionVariables {
  vehicleId: string;
  body: VehicleReviewBody;
}

/** Revisión de un vehículo con el endpoint existente del núcleo (`POST /v1/admin/vehicles/{id}/review`). */
export function useVehicleReview(): UseApiMutationResult<unknown, VehicleDecisionVariables> {
  return useApiMutation<unknown, VehicleDecisionVariables>(
    (variables, { signal }) => reviewVehicle(variables.vehicleId, variables.body, { signal }),
    { invalidates: [ADMIN_REVIEW_DOSSIER, ADMIN_REVIEW_QUEUE] },
  );
}
