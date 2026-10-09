/**
 * `useApiQuery(key, fn, options)`: lectura de datos del servidor con caché en memoria.
 *
 *  - Misma clave ⇒ misma caché y UNA sola petición aunque la pidan varias pantallas.
 *  - Stale-while-revalidate: se muestran los datos que haya mientras se revalida; si la revalidación falla, los datos
 *    se conservan y `failedToRefresh` / `error` lo cuentan (nunca se borra lo que ya se había cargado).
 *  - Se vuelve a pedir al recuperar el foco de la pantalla, al volver la app a primer plano y al recuperar la red
 *    (solo si los datos están caducados o la última petición falló). Sondeo opcional con `refetchIntervalMs`.
 *  - Al desmontar la última pantalla que la observa, la petición en curso se cancela (AbortController).
 *  - La caché se vacía al cerrar sesión: jamás se ven datos de otra cuenta.
 *
 * Ejemplo:
 *   const trip = useApiQuery(["trip", tripId], ({ signal }) => getTrip(tripId, { signal }), { staleTimeMs: 15_000 });
 *   if (trip.isLoading) return <Skeleton/>;
 *   if (trip.isOffline && !trip.data) return <OfflineState onRetry={trip.refetch}/>;
 *   if (trip.isError) return <ErrorState error={trip.error} onRetry={trip.refetch}/>;
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { hashKey, queryCache, type QueryFn, type QueryKey, type QueryState, type QueryStatus } from "./queryCache";
import { deriveQueryFlags, type QueryFlags } from "./queryFlags";
import { useAppActive } from "./useAppActive";
import { useIsOnline, useOnReconnect } from "./useConnectivity";
import { useInterval } from "./useInterval";
import { useIsScreenFocused } from "./useIsScreenFocused";

export interface UseApiQueryOptions<T> {
  /** `false` aplaza la petición (p. ej. hasta tener un id). Por defecto `true`. */
  enabled?: boolean;
  /** Tiempo (ms) durante el que los datos se consideran frescos. Por defecto 30 s. */
  staleTimeMs?: number;
  /** Revalidar al volver a esta pantalla (si los datos están caducados). Por defecto `true`. */
  refetchOnFocus?: boolean;
  /** Revalidar al volver la app a primer plano (si están caducados). Por defecto `true`. */
  refetchOnAppActive?: boolean;
  /** Revalidar al recuperar la red (si caducaron o la última petición falló). Por defecto `true`. */
  refetchOnReconnect?: boolean;
  /** Sondeo mientras la pantalla está a la vista, la app en primer plano y hay red. */
  refetchIntervalMs?: number | false;
  /** Al cambiar de clave, seguir mostrando los datos de la anterior hasta que lleguen los nuevos. */
  keepPreviousData?: boolean;
  /** Datos provisionales que se muestran mientras no haya datos reales (no se guardan en la caché). */
  placeholderData?: T;
}

export interface UseApiQueryResult<T> extends QueryFlags {
  data: T | undefined;
  /** idle | loading | success | error | offline (ver `QueryStatus`). */
  status: QueryStatus;
  error: Error | null;
  /** Los datos mostrados son `placeholderData` (aún no hay datos reales). */
  isPlaceholderData: boolean;
  /** Los datos mostrados son de la clave anterior (`keepPreviousData`). */
  isPreviousData: boolean;
  updatedAt: number | null;
  /** Vuelve a pedir ahora (ignora la frescura). Nunca rechaza; resuelve con los datos o `undefined` si falló. */
  refetch(): Promise<T | undefined>;
}

const DEFAULT_STALE_TIME_MS = 30_000;

export function useApiQuery<T>(key: QueryKey, fn: QueryFn<T>, options: UseApiQueryOptions<T> = {}): UseApiQueryResult<T> {
  const {
    enabled = true,
    staleTimeMs = DEFAULT_STALE_TIME_MS,
    refetchOnFocus = true,
    refetchOnAppActive = true,
    refetchOnReconnect = true,
    refetchIntervalMs = false,
    keepPreviousData = false,
    placeholderData,
  } = options;

  const keyHash = hashKey(key);
  const keyRef = useRef(key);
  const fnRef = useRef(fn);
  useEffect(() => {
    keyRef.current = key;
    fnRef.current = fn;
  });
  const run = useCallback<QueryFn<T>>((context) => fnRef.current(context), []);

  const subscribe = useCallback((onChange: () => void) => queryCache.subscribe(key, onChange), [keyHash]); // eslint-disable-line react-hooks/exhaustive-deps
  const getSnapshot = useCallback(() => queryCache.getState<T>(key), [keyHash]); // eslint-disable-line react-hooks/exhaustive-deps
  const state: QueryState<T> = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const focused = useIsScreenFocused();
  const appActive = useAppActive();
  const online = useIsOnline();
  const visible = focused && appActive;

  // Primera petición / cambio de clave / habilitación.
  useEffect(() => {
    if (!enabled) return;
    void queryCache.fetch(keyRef.current, run, { staleTimeMs });
  }, [keyHash, enabled, run, staleTimeMs]);

  // Vuelta a la pantalla o a primer plano.
  const wasFocused = useRef(focused);
  const wasActive = useRef(appActive);
  useEffect(() => {
    const regainedFocus = focused && !wasFocused.current;
    const regainedActive = appActive && !wasActive.current;
    wasFocused.current = focused;
    wasActive.current = appActive;
    if (!enabled || !focused || !appActive) return;
    if ((regainedFocus && refetchOnFocus) || (regainedActive && refetchOnAppActive)) {
      void queryCache.fetch(keyRef.current, run, { staleTimeMs });
    }
  }, [focused, appActive, enabled, refetchOnFocus, refetchOnAppActive, run, staleTimeMs]);

  // Red recuperada.
  useOnReconnect(() => {
    const failed = queryCache.getState<T>(keyRef.current).error !== null;
    void queryCache.fetch(keyRef.current, run, { staleTimeMs, force: failed });
  }, enabled && refetchOnReconnect && visible);

  // Sondeo.
  useInterval(
    () => {
      void queryCache.fetch(keyRef.current, run, { force: true });
    },
    enabled && visible && online && refetchIntervalMs ? refetchIntervalMs : null,
  );

  const refetch = useCallback(() => queryCache.fetch(keyRef.current, run, { force: true }), [run]);

  // Datos de la clave anterior mientras llegan los de la nueva.
  const lastData = useRef<{ hash: string; data: T } | null>(null);
  useEffect(() => {
    if (state.data !== undefined) lastData.current = { hash: keyHash, data: state.data };
  }, [state.data, keyHash]);
  const previous = keepPreviousData && state.data === undefined && lastData.current && lastData.current.hash !== keyHash ? lastData.current.data : undefined;

  const hasRealData = state.data !== undefined;
  const shown = hasRealData ? state.data : previous !== undefined ? previous : placeholderData;
  // Primera render de una consulta habilitada: aún no ha empezado la petición, pero ya cuenta como «cargando».
  const startingUp = enabled && state.status === "idle" && !state.isFetching;

  return useMemo(() => {
    const flags = deriveQueryFlags(state);
    return {
      ...flags,
      isIdle: flags.isIdle && !startingUp,
      isLoading: flags.isLoading || startingUp,
      data: shown,
      status: startingUp ? "loading" : state.status,
      error: state.error,
      isPlaceholderData: !hasRealData && previous === undefined && placeholderData !== undefined,
      isPreviousData: !hasRealData && previous !== undefined,
      updatedAt: state.updatedAt,
      refetch,
    };
  }, [state, shown, startingUp, hasRealData, previous, placeholderData, refetch]);
}
