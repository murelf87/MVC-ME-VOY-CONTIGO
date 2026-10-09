/** Mantener la pantalla encendida (viaje en curso, código de recogida visible). No lanza. */
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useEffect } from "react";

const DEFAULT_TAG = "mvc";

export async function keepScreenAwake(tag: string = DEFAULT_TAG): Promise<void> {
  try {
    await activateKeepAwakeAsync(tag);
  } catch {
    // sin soporte: la pantalla se apagará según los ajustes del sistema
  }
}

export function allowScreenSleep(tag: string = DEFAULT_TAG): void {
  try {
    void deactivateKeepAwake(tag);
  } catch {
    // nada que liberar
  }
}

/** Mientras `active` sea `true` (y la pantalla esté montada) la pantalla no se apaga. */
export function useKeepScreenAwake(active: boolean, tag: string = DEFAULT_TAG): void {
  useEffect(() => {
    if (!active) return undefined;
    void keepScreenAwake(tag);
    return () => allowScreenSleep(tag);
  }, [active, tag]);
}
