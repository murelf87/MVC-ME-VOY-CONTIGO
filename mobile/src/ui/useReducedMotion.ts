import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** `true` si el usuario ha pedido reducir el movimiento en los ajustes de accesibilidad del sistema. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active) setReduced(value);
      })
      .catch(() => {
        // Si el sistema no responde se mantiene el valor por defecto (animaciones activas).
      });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}
