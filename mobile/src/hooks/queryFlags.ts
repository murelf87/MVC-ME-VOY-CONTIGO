import { isOfflineError } from "@/api/errors";
import type { QueryState } from "./queryCache";

/** Banderas derivadas del estado de una consulta (puras: se prueban sin React). */
export interface QueryFlags {
  /** Nunca se ha pedido (consulta deshabilitada y sin datos en caché). */
  isIdle: boolean;
  /** Primera carga sin datos: pinta el esqueleto. */
  isLoading: boolean;
  /** Hay una petición en curso (primera carga o revalidación). */
  isFetching: boolean;
  /** Revalidando mientras se muestran datos (RefreshControl.refreshing). */
  isRefreshing: boolean;
  /** Sin datos y falló por un motivo distinto de la falta de red. */
  isError: boolean;
  /** La última petición falló por falta de red (con o sin datos). */
  isOffline: boolean;
  /** Hay datos, pero la última actualización falló (mostrar los datos + un aviso). */
  failedToRefresh: boolean;
}

export function deriveQueryFlags<T>(state: QueryState<T>): QueryFlags {
  const hasData = state.data !== undefined;
  return {
    isIdle: state.status === "idle" && !state.isFetching,
    isLoading: !hasData && state.isFetching,
    isFetching: state.isFetching,
    isRefreshing: state.isFetching && hasData,
    isError: !hasData && state.status === "error",
    isOffline: state.error !== null && isOfflineError(state.error),
    failedToRefresh: hasData && state.error !== null,
  };
}
