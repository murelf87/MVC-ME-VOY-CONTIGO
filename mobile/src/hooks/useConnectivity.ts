import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { refreshConnectivity } from "./ConnectivityProvider";
import { connectivityStore, type ConnectivityState } from "./connectivityStore";

export interface UseConnectivityResult extends ConnectivityState {
  /** Vuelve a medir la red ahora (p. ej. botón «Reintentar» de una pantalla sin conexión). */
  refresh(): Promise<void>;
}

/** Estado de conectividad: `status` (unknown|online|offline), tipo de red, coste, motivo. */
export function useConnectivity(): UseConnectivityResult {
  const state = useSyncExternalStore(connectivityStore.subscribe, connectivityStore.getState, connectivityStore.getState);
  return useMemo(() => ({ ...state, refresh: refreshConnectivity }), [state]);
}

/** `true` salvo que se sepa que no hay conexión (durante el arranque se asume que sí). */
export function useIsOnline(): boolean {
  return useSyncExternalStore(
    connectivityStore.subscribe,
    () => connectivityStore.getState().isOnline,
    () => true,
  );
}

/** Ejecuta `callback` cada vez que la app recupera la conexión (offline → online). */
export function useOnReconnect(callback: () => void, enabled = true): void {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    if (!enabled) return undefined;
    return connectivityStore.onReconnect(() => latest.current());
  }, [enabled]);
}
