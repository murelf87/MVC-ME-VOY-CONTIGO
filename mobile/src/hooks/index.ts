/**
 * Hooks de datos y de estado de la app. Importa desde `@/hooks`.
 *
 *   useApiQuery(key, fn, opts)        lectura con caché, stale-while-revalidate, foco, reconexión y sondeo
 *   useApiMutation(fn, opts)          escritura con estado, reintento e Idempotency-Key
 *   usePaginatedQuery(key, fn, opts)  listas con cursor y «cargar más»
 *   useConnectivity / useIsOnline     estado de la red
 *   queryCache                        invalidar / escribir a mano (`queryCache.invalidate(["trips"])`)
 */
export { ConnectivityProvider, refreshConnectivity } from "./ConnectivityProvider";
export { ErrorBoundary, type ErrorBoundaryProps, type ErrorFallbackProps } from "./ErrorBoundary";
export { connectivityStore, type ConnectivityState, type ConnectivityStatus, type ConnectionKind, type OfflineReason } from "./connectivityStore";
export {
  hashKey,
  isKeyPrefix,
  queryCache,
  type QueryFn,
  type QueryFnContext,
  type QueryKey,
  type QueryState,
  type QueryStatus,
} from "./queryCache";
export { deriveQueryFlags, type QueryFlags } from "./queryFlags";
export { useAppActive } from "./useAppActive";
export {
  useApiMutation,
  type MutationContext,
  type MutationFn,
  type MutationStatus,
  type UseApiMutationOptions,
  type UseApiMutationResult,
} from "./useApiMutation";
export { useApiQuery, type UseApiQueryOptions, type UseApiQueryResult } from "./useApiQuery";
export { useConnectivity, useIsOnline, useOnReconnect, type UseConnectivityResult } from "./useConnectivity";
export { useDebouncedValue } from "./useDebouncedValue";
export { useInterval } from "./useInterval";
export { useIsScreenFocused } from "./useIsScreenFocused";
export {
  flattenPages,
  usePaginatedQuery,
  type PageFetchContext,
  type PaginatedData,
  type UsePaginatedQueryOptions,
  type UsePaginatedQueryResult,
} from "./usePaginatedQuery";
export { useRefreshOnFocus, type UseRefreshOnFocusOptions } from "./useRefreshOnFocus";
