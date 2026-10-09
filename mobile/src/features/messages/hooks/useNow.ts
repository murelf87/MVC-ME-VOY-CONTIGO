/**
 * «Ahora» que se refresca solo (por defecto cada 30 s) para que las horas relativas de las listas («Ayer», «hace 5 min») y
 * las ventanas de tiempo (llamada del viaje) se mantengan al día sin que cada pantalla tenga su propio temporizador.
 */
import { useState } from "react";
import { useInterval } from "@/hooks";

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useInterval(() => setNow(Date.now()), intervalMs);
  return now;
}
