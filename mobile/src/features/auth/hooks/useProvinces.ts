import { useMemo } from "react";
import { listProvinces } from "@/api";
import type { Province } from "@/api/types";
import { useApiQuery } from "@/hooks";

export interface UseProvincesResult {
  provinces: readonly Province[];
  isLoading: boolean;
  isError: boolean;
  isOffline: boolean;
  error: Error | null;
  refetch(): void;
}

/** Provincias disponibles (`GET /v1/provinces`, público). La V1 solo tiene Sevilla; la lista se pide igual para no fijarla. */
export function useProvinces(): UseProvincesResult {
  const query = useApiQuery<Province[]>(["provinces"], ({ signal }) => listProvinces({ signal }), { staleTimeMs: 10 * 60_000 });
  const provinces = useMemo<readonly Province[]>(() => query.data ?? [], [query.data]);
  return {
    provinces,
    isLoading: query.isLoading,
    isError: query.isError,
    isOffline: query.isOffline,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
