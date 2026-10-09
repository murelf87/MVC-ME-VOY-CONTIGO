/**
 * Altura del teclado en iOS, para subir el contenido de una hoja con un campo de texto: `BottomSheet` va anclada abajo
 * dentro de un `Modal` y el teclado la taparía. En Android la ventana se redimensiona sola y en web no hay teclado
 * virtual: devuelve 0.
 */
import { useEffect, useState } from "react";
import { Dimensions, Keyboard, Platform, type KeyboardEvent } from "react-native";

export function useKeyboardInset(active: boolean): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "ios" || !active) {
      setHeight(0);
      return undefined;
    }
    const change = Keyboard.addListener("keyboardWillChangeFrame", (event: KeyboardEvent) => {
      // Parte del teclado que realmente tapa la pantalla (0 cuando se está retirando).
      setHeight(Math.max(0, Dimensions.get("window").height - event.endCoordinates.screenY));
    });
    const hide = Keyboard.addListener("keyboardWillHide", () => setHeight(0));
    return () => {
      change.remove();
      hide.remove();
      setHeight(0);
    };
  }, [active]);
  return height;
}
