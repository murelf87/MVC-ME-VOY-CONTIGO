import { useCallback, useEffect, useRef, useState } from "react";
import type { NavigationAction } from "@react-navigation/native";
import { useAppNavigation } from "@/navigation";

export interface UnsavedGuard {
  /** Hay que preguntar si se quiere salir sin guardar. */
  visible: boolean;
  /** Sale de la pantalla descartando los cambios. */
  leave(): void;
  /** Se queda editando. */
  stay(): void;
  /** Desactiva la pregunta (justo antes de salir tras guardar con éxito). */
  release(): void;
}

/**
 * Antes de abandonar la pantalla (botón atrás, gesto o atrás del navegador) con cambios sin guardar, frena la salida y
 * deja que la pantalla pregunte. `active` indica si hay algo que perder.
 */
export function useUnsavedGuard(active: boolean): UnsavedGuard {
  const navigation = useAppNavigation();
  const activeRef = useRef(active);
  activeRef.current = active;
  const pending = useRef<NavigationAction | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(
    () =>
      navigation.addListener("beforeRemove", (event) => {
        if (!activeRef.current) return;
        event.preventDefault();
        pending.current = event.data.action;
        setVisible(true);
      }),
    [navigation],
  );

  const leave = useCallback(() => {
    activeRef.current = false;
    setVisible(false);
    const action = pending.current;
    pending.current = null;
    if (action !== null) navigation.dispatch(action);
  }, [navigation]);

  const stay = useCallback(() => {
    pending.current = null;
    setVisible(false);
  }, []);

  const release = useCallback(() => {
    activeRef.current = false;
  }, []);

  return { visible, leave, stay, release };
}
