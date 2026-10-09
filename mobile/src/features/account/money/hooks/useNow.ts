/**
 * Reloj de la pantalla con resolución de un minuto: `Date.now()` que se refresca solo. Sirve para «Hoy» / «Mañana» y para
 * el mes actual sin recalcular a cada fotograma. En la vista previa `Date.now()` ya es el reloj virtual del escenario.
 */
import { useState } from "react";
import { useInterval } from "@/hooks";

const MINUTE_MS = 60_000;

export function useNow(intervalMs: number = MINUTE_MS): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useInterval(() => setNow(Date.now()), intervalMs);
  return now;
}
