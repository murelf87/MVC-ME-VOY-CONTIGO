/**
 * «Ahora» que se refresca solo (por defecto cada 30 s): mantiene al día «Hoy», «Mañana» y las cuentas atrás sin que cada
 * pantalla tenga su propio temporizador.
 */
import { useState } from "react";
import { useInterval } from "@/hooks";

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useInterval(() => setNow(Date.now()), intervalMs);
  return now;
}
