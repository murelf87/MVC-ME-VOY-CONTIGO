/** Restricciones de operación y reglas de alerta en tiempo real (pantalla 40): lectura A F S · edición solo A. */
import type { AdminOperations, AdminOperationsUpdate } from "@/api/types";
import { queryCache, useApiMutation, useApiQuery, type UseApiMutationResult, type UseApiQueryResult } from "@/hooks";
import { getOperations, updateOperations } from "../api";
import { ADMIN_AUDIT, ADMIN_OPERATIONS } from "./keys";

export function useOperations(enabled: boolean): UseApiQueryResult<AdminOperations> {
  return useApiQuery<AdminOperations>(ADMIN_OPERATIONS, ({ signal }) => getOperations({ signal }), { enabled, staleTimeMs: 15_000 });
}

/** `PUT /v1/admin/operations` devuelve el documento completo: se escribe en la caché al instante y se revalida después. */
export function useUpdateOperations(): UseApiMutationResult<AdminOperations, AdminOperationsUpdate> {
  return useApiMutation<AdminOperations, AdminOperationsUpdate>((input, { signal }) => updateOperations(input, { signal }), {
    onSuccess: (document) => queryCache.setData<AdminOperations>(ADMIN_OPERATIONS, document),
    invalidates: [ADMIN_OPERATIONS, ADMIN_AUDIT],
  });
}
