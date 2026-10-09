import { NavigationContext } from "@react-navigation/native";
import { useCallback, useContext, useSyncExternalStore } from "react";

/**
 * ¿Es esta pantalla la que está a la vista? Fuera de un navegador (pruebas, componentes sueltos) devuelve `true`.
 * Se usa para pausar sondeos y refrescar al volver; NO lanza si no hay navegación.
 */
export function useIsScreenFocused(): boolean {
  const navigation = useContext(NavigationContext);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!navigation) return () => undefined;
      const offFocus = navigation.addListener("focus", onChange);
      const offBlur = navigation.addListener("blur", onChange);
      return () => {
        offFocus();
        offBlur();
      };
    },
    [navigation],
  );
  const getSnapshot = useCallback(() => (navigation ? navigation.isFocused() : true), [navigation]);
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
