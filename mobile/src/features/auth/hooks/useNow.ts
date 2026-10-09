import { useEffect, useState } from "react";
import { useAppActive, useInterval, useIsScreenFocused } from "@/hooks";

/**
 * Hora actual (ms) que se refresca cada `intervalMs` solo mientras la pantalla está a la vista y la app en primer plano
 * (las cuentas atrás no gastan batería con la pantalla fuera). Con `false` no se refresca nunca.
 */
export function useNow(intervalMs: number | false = 1_000): number {
  const [now, setNow] = useState<number>(() => Date.now());
  const focused = useIsScreenFocused();
  const active = useAppActive();
  const running = focused && active;
  // Al volver a la pantalla o a primer plano se actualiza enseguida, sin esperar al siguiente tic.
  useEffect(() => {
    if (running) setNow(Date.now());
  }, [running]);
  useInterval(() => setNow(Date.now()), running ? intervalMs : false);
  return now;
}
