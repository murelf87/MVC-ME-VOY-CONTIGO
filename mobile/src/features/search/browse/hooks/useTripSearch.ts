/**
 * Búsqueda de coches (`GET /v1/search/trips`, sesión opcional). Cambiar los criterios aplicados por una sugerencia no
 * borra los resultados anteriores hasta que llegan los nuevos. Paginación por cursor con «Ver más coches».
 */
import { useCallback, useMemo, useState } from "react";
import type { TripSearchItem, TripSearchPage } from "@/api/types";
import { useApiQuery } from "@/hooks";
import type { SearchCriteriaParam } from "../../routes";
import { searchTrips } from "../api";
import { overridesKey, toSearchQuery, type SearchOverrides } from "../logic/tripResults";

export interface UseTripSearchResult {
  page: TripSearchPage | undefined;
  items: readonly TripSearchItem[];
  isLoading: boolean;
  isError: boolean;
  isOffline: boolean;
  failedToRefresh: boolean;
  error: Error | null;
  overrides: SearchOverrides;
  applyOverrides(next: SearchOverrides): void;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  loadMore(): void;
  refetch(): void;
}

export function useTripSearch(criteria: SearchCriteriaParam, provinceId: string | null): UseTripSearchResult {
  const [overrides, setOverrides] = useState<SearchOverrides>({});
  const [extra, setExtra] = useState<{ key: string; items: TripSearchItem[]; cursor: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const base = JSON.stringify(criteria);
  const key = `${base}|${provinceId ?? ""}|${overridesKey(overrides)}`;

  const query = useApiQuery<TripSearchPage>(
    ["trips", "search", key],
    ({ signal }) => searchTrips(toSearchQuery(criteria, provinceId ?? "", overrides), { signal }),
    { enabled: provinceId !== null, staleTimeMs: 20_000, keepPreviousData: true },
  );
  const data = query.isPreviousData && query.error !== null ? undefined : query.data;
  const more = extra !== null && extra.key === key ? extra : null;
  const items = useMemo<readonly TripSearchItem[]>(() => [...(data?.items ?? []), ...(more?.items ?? [])], [data, more]);
  const nextCursor = more !== null ? more.cursor : (data?.nextCursor ?? null);

  const loadMore = useCallback(() => {
    if (nextCursor === null || loadingMore || provinceId === null) return;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    searchTrips(toSearchQuery(criteria, provinceId, overrides, nextCursor))
      .then((next) => setExtra({ key, items: [...(more?.items ?? []), ...next.items], cursor: next.nextCursor }))
      .catch(() => setLoadMoreFailed(true))
      .finally(() => setLoadingMore(false));
  }, [criteria, key, loadingMore, more, nextCursor, overrides, provinceId]);

  return {
    page: data,
    items,
    isLoading: query.isLoading,
    isError: query.isError,
    isOffline: query.isOffline,
    failedToRefresh: query.failedToRefresh,
    error: query.error,
    overrides,
    applyOverrides: (next) => {
      setExtra(null);
      setOverrides((current) => ({ ...current, ...next }));
    },
    hasMore: nextCursor !== null,
    loadingMore,
    loadMoreFailed,
    loadMore,
    refetch: () => {
      setExtra(null);
      void query.refetch();
    },
  };
}
