/** Derechos sobre los datos (RGPD): copias de datos y eliminación de cuenta. */
import type { AccountDeletionState, DataExportRequest, RequestAccountDeletionRequest } from "@/api/types";
import { queryCache, useApiMutation, useApiQuery, usePaginatedQuery, type UseApiMutationResult, type UseApiQueryResult, type UsePaginatedQueryResult } from "@/hooks";
import { cancelAccountDeletion, getAccountDeletion, listDataExports, requestAccountDeletion, requestDataExport } from "../api";
import { helpKeys } from "./keys";

/** Mientras alguna copia siga en cola o preparándose la lista se refresca sola. */
export function useDataExports(enabled: boolean, polling: boolean): UsePaginatedQueryResult<DataExportRequest> {
  return usePaginatedQuery<DataExportRequest>(helpKeys.exports, ({ cursor, signal }) => listDataExports({ limit: 20, cursor }, { signal }), {
    enabled,
    staleTimeMs: 10_000,
    ...(polling ? { refetchIntervalMs: 4_000 } : {}),
  });
}

/** «Solicitar mis datos»: con `Idempotency-Key` (reintentar tras un corte no pide dos copias). */
export function useRequestDataExport(): UseApiMutationResult<DataExportRequest, void> {
  return useApiMutation<DataExportRequest, void>((_, { idempotencyKey, signal }) => requestDataExport({ idempotencyKey, signal }), { invalidates: [helpKeys.exports] });
}

export function useAccountDeletion(enabled: boolean): UseApiQueryResult<AccountDeletionState> {
  return useApiQuery<AccountDeletionState>(helpKeys.deletion, ({ signal }) => getAccountDeletion({ signal }), { enabled, staleTimeMs: 0 });
}

export function useRequestDeletion(): UseApiMutationResult<AccountDeletionState, RequestAccountDeletionRequest> {
  return useApiMutation<AccountDeletionState, RequestAccountDeletionRequest>((body, { signal }) => requestAccountDeletion(body, { signal }), {
    onSuccess: (state) => queryCache.setData<AccountDeletionState>(helpKeys.deletion, state),
  });
}

export function useCancelDeletion(): UseApiMutationResult<AccountDeletionState, void> {
  return useApiMutation<AccountDeletionState, void>((_, { signal }) => cancelAccountDeletion({ signal }), {
    onSuccess: (state) => queryCache.setData<AccountDeletionState>(helpKeys.deletion, state),
  });
}
