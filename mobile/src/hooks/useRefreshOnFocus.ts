import { useEffect, useRef } from "react";
import { useIsScreenFocused } from "./useIsScreenFocused";

export interface UseRefreshOnFocusOptions {
  enabled?: boolean;
}

/**
 * Llama a `refetch` cada vez que la pantalla VUELVE a estar a la vista (no en el primer montaje).
 * `useApiQuery` ya lo hace por sí solo según su `staleTimeMs`; esto es para cargas manuales.
 */
export function useRefreshOnFocus(refetch: () => unknown, options: UseRefreshOnFocusOptions = {}): void {
  const { enabled = true } = options;
  const focused = useIsScreenFocused();
  const latest = useRef(refetch);
  const wasFocused = useRef(focused);
  useEffect(() => {
    latest.current = refetch;
  });
  useEffect(() => {
    if (enabled && focused && !wasFocused.current) void latest.current();
    wasFocused.current = focused;
  }, [focused, enabled]);
}
