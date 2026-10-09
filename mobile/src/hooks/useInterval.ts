import { useEffect, useRef } from "react";

/**
 * Ejecuta `callback` cada `delayMs`. Con `null`/`false` (o ≤ 0) el temporizador se detiene.
 * El callback siempre es el último recibido: no hace falta memoizarlo.
 */
export function useInterval(callback: () => void, delayMs: number | null | false): void {
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });
  useEffect(() => {
    if (delayMs === null || delayMs === false || !(delayMs > 0)) return undefined;
    const timer = setInterval(() => latest.current(), delayMs);
    return () => clearInterval(timer);
  }, [delayMs]);
}
