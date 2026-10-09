/**
 * Tarifas (pantalla 40): configuración en borrador, ejemplo de aportación sin guardar, historial de versiones y
 * activación (hoy bloqueada por `ECONOMICS_ACTIVATION`: el servidor responde 409 y deja el intento auditado).
 */
import { useMemo } from "react";
import type {
  AdminTariffDraftInput,
  AdminTariffExample,
  AdminTariffExampleRequest,
  AdminTariffOverview,
  AdminTariffPublishRequest,
  AdminTariffVersion,
} from "@/api/types";
import {
  queryCache,
  useApiMutation,
  useApiQuery,
  useDebouncedValue,
  usePaginatedQuery,
  type UseApiMutationResult,
  type UseApiQueryResult,
  type UsePaginatedQueryResult,
} from "@/hooks";
import { calculateTariffExample, getTariffOverview, listTariffVersions, publishTariffVersion, saveTariffDraft } from "../api";
import { ADMIN_AUDIT, ADMIN_TARIFFS, TARIFF_OVERVIEW_KEY, TARIFF_VERSIONS_KEY, tariffExampleKey } from "./keys";

/** Espera tras la última tecla antes de recalcular el ejemplo. */
export const EXAMPLE_DEBOUNCE_MS = 450;

export function useTariffOverview(enabled: boolean): UseApiQueryResult<AdminTariffOverview> {
  return useApiQuery<AdminTariffOverview>(TARIFF_OVERVIEW_KEY, ({ signal }) => getTariffOverview({ signal }), { enabled, staleTimeMs: 15_000 });
}

export function useSaveTariffDraft(): UseApiMutationResult<AdminTariffVersion, AdminTariffDraftInput> {
  return useApiMutation<AdminTariffVersion, AdminTariffDraftInput>((input, { signal }) => saveTariffDraft(input, { signal }), {
    onSuccess: (draft) => {
      const current = queryCache.getData<AdminTariffOverview>(TARIFF_OVERVIEW_KEY);
      if (current !== undefined) queryCache.setData<AdminTariffOverview>(TARIFF_OVERVIEW_KEY, { ...current, draft });
    },
    invalidates: [ADMIN_TARIFFS, ADMIN_AUDIT],
  });
}

/**
 * Ejemplo calculado por el servidor con los valores escritos (`POST /v1/admin/tariffs/example`, no guarda nada).
 * Se pide con espera tras la última tecla y se conserva el resultado anterior mientras llega el nuevo.
 */
export function useTariffExample(request: AdminTariffExampleRequest | null, enabled: boolean): UseApiQueryResult<AdminTariffExample> {
  const serialized = request === null ? null : JSON.stringify(request);
  const settled = useDebouncedValue(serialized, EXAMPLE_DEBOUNCE_MS);
  const parsed = useMemo<AdminTariffExampleRequest | null>(() => (settled === null ? null : JSON.parse(settled)), [settled]);
  return useApiQuery<AdminTariffExample>(
    tariffExampleKey(parsed ?? {}),
    ({ signal }) => {
      if (parsed === null) return Promise.reject(new Error("Sin petición de ejemplo"));
      return calculateTariffExample(parsed, { signal });
    },
    { enabled: enabled && parsed !== null, keepPreviousData: true, staleTimeMs: 5 * 60_000, refetchOnFocus: false, refetchOnReconnect: false },
  );
}

export function useTariffVersions(enabled: boolean): UsePaginatedQueryResult<AdminTariffVersion> {
  return usePaginatedQuery<AdminTariffVersion>(
    TARIFF_VERSIONS_KEY,
    ({ cursor, signal }) => listTariffVersions({ cursor, limit: 20 }, { signal }),
    { enabled, staleTimeMs: 15_000 },
  );
}

export interface PublishTariffInput {
  versionId: string;
  request: AdminTariffPublishRequest;
}

export function usePublishTariff(): UseApiMutationResult<AdminTariffVersion, PublishTariffInput> {
  return useApiMutation<AdminTariffVersion, PublishTariffInput>((input, { signal }) => publishTariffVersion(input.versionId, input.request, { signal }), {
    invalidates: [ADMIN_TARIFFS, ADMIN_AUDIT],
  });
}
