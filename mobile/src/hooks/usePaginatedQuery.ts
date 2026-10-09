/**
 * `usePaginatedQuery(key, fetchPage, options)`: listas con cursor (`Page<T>`) y «cargar más».
 *
 * Se apoya en `useApiQuery`: la PRIMERA página vive en la caché (stale-while-revalidate, foco, reconexión, sondeo);
 * `fetchMore()` añade páginas a esa misma entrada sin tocar su frescura. Refrescar (`refetch`/`refresh`) vuelve a
 * pedir la primera página y reinicia la lista.
 *
 * Ejemplo:
 *   const list = usePaginatedQuery(["conversations", filter], ({ cursor, signal }) =>
 *     listConversations({ filter, cursor, limit: 20 }, { signal }));
 *   <FlatList data={list.items} onEndReached={list.fetchMore} refreshing={list.isRefreshing} onRefresh={list.refresh}
 *     ListFooterComponent={list.isFetchingMore ? <Spinner/> : null} />
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Page } from "@/api/types/common";
import { isAbortError } from "@/api/errors";
import { hashKey, queryCache, type QueryKey } from "./queryCache";
import { flattenPages } from "./pagination";
import { useApiQuery, type UseApiQueryOptions, type UseApiQueryResult } from "./useApiQuery";

export { flattenPages } from "./pagination";

export interface PageFetchContext {
  /** `null` en la primera página. */
  cursor: string | null;
  signal: AbortSignal;
}

export interface PaginatedData<T> {
  pages: Page<T>[];
}

export interface UsePaginatedQueryOptions<T> extends Omit<UseApiQueryOptions<PaginatedData<T>>, "placeholderData" | "keepPreviousData"> {
  /** Identificador de un elemento para no repetirlo si cambia la lista entre páginas. Por defecto, su `id`. */
  getItemId?: (item: T) => string | number | undefined;
}

export interface UsePaginatedQueryResult<T> extends Omit<UseApiQueryResult<PaginatedData<T>>, "data" | "isPlaceholderData" | "isPreviousData"> {
  /** Todos los elementos cargados, en orden y sin repetidos. */
  items: T[];
  /** Páginas tal cual las devolvió el servidor (para campos extra como `unreadCount`). */
  pages: Page<T>[];
  hasMore: boolean;
  /** Hay datos y la lista está vacía (estado vacío). */
  isEmpty: boolean;
  isFetchingMore: boolean;
  /** Error de la última carga de más (la lista cargada se conserva). */
  fetchMoreError: Error | null;
  /** Carga la siguiente página si existe y no hay otra petición en curso. Nunca rechaza. */
  fetchMore(): Promise<void>;
  /** Reinicia la lista pidiendo la primera página. */
  refresh(): Promise<void>;
}

export function usePaginatedQuery<T>(
  key: QueryKey,
  fetchPage: (context: PageFetchContext) => Promise<Page<T>>,
  options: UsePaginatedQueryOptions<T> = {},
): UsePaginatedQueryResult<T> {
  const { getItemId, ...queryOptions } = options;
  const fetchPageRef = useRef(fetchPage);
  const keyRef = useRef(key);
  useEffect(() => {
    fetchPageRef.current = fetchPage;
    keyRef.current = key;
  });
  const keyHash = hashKey(key);

  const query = useApiQuery<PaginatedData<T>>(
    key,
    async ({ signal }) => ({ pages: [await fetchPageRef.current({ cursor: null, signal })] }),
    queryOptions,
  );

  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [fetchMoreError, setFetchMoreError] = useState<Error | null>(null);
  const moreController = useRef<AbortController | null>(null);

  // Cambiar de lista (otra clave) descarta lo que quedara a medias de la anterior.
  useEffect(() => {
    setIsFetchingMore(false);
    setFetchMoreError(null);
    return () => {
      moreController.current?.abort();
      moreController.current = null;
    };
  }, [keyHash]);

  const pages = query.data?.pages;
  const lastPage = pages?.[pages.length - 1];
  const hasMore = lastPage !== undefined && lastPage.nextCursor !== null;

  const fetchMore = useCallback(async (): Promise<void> => {
    const current = queryCache.getState<PaginatedData<T>>(keyRef.current);
    const last = current.data?.pages[current.data.pages.length - 1];
    if (!last || last.nextCursor === null || moreController.current || current.isFetching) return;

    const controller = new AbortController();
    moreController.current = controller;
    setIsFetchingMore(true);
    setFetchMoreError(null);
    try {
      const next = await fetchPageRef.current({ cursor: last.nextCursor, signal: controller.signal });
      queryCache.setData<PaginatedData<T>>(
        keyRef.current,
        (old) => (old && old.pages[old.pages.length - 1] === last ? { pages: [...old.pages, next] } : (old as PaginatedData<T>)),
        { keepFreshness: true },
      );
    } catch (error) {
      if (!isAbortError(error)) setFetchMoreError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      if (moreController.current === controller) {
        moreController.current = null;
        setIsFetchingMore(false);
      }
    }
  }, []);

  const { refetch } = query;
  const refresh = useCallback(async () => {
    moreController.current?.abort();
    await refetch();
  }, [refetch]);

  const items = useMemo(() => flattenPages(pages ?? [], getItemId), [pages, getItemId]);

  return useMemo(
    () => ({
      status: query.status,
      error: query.error,
      isIdle: query.isIdle,
      isLoading: query.isLoading,
      isFetching: query.isFetching,
      isRefreshing: query.isRefreshing,
      isError: query.isError,
      isOffline: query.isOffline,
      failedToRefresh: query.failedToRefresh,
      updatedAt: query.updatedAt,
      refetch: query.refetch,
      items,
      pages: pages ?? [],
      hasMore,
      isEmpty: pages !== undefined && items.length === 0,
      isFetchingMore,
      fetchMoreError,
      fetchMore,
      refresh,
    }),
    [query, items, pages, hasMore, isFetchingMore, fetchMoreError, fetchMore, refresh],
  );
}
