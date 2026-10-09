import { useCallback, useSyncExternalStore } from "react";
import { AppState } from "react-native";

function isActive(state: string): boolean {
  // `unknown` es el valor inicial antes de la primera notificación: se trata como activa.
  return state === "active" || state === "unknown";
}

/** `true` mientras la app está en primer plano (no en segundo plano ni en un diálogo del sistema). */
export function useAppActive(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const subscription = AppState.addEventListener("change", onChange);
    return () => subscription.remove();
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => isActive(AppState.currentState),
    () => true,
  );
}
