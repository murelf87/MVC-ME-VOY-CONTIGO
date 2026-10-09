import { useState } from "react";
import { useInterval } from "@/hooks";

/**
 * Reloj de la pantalla: `Date.now()` que se refresca cada `intervalMs`. Sirve para que «hace 5 s» y «8 min» avancen
 * entre dos respuestas del servidor sin volver a pedir nada. Con `enabled=false` se detiene.
 */
export function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useInterval(() => setNow(Date.now()), enabled ? intervalMs : null);
  return now;
}
