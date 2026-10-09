import { useCallback } from "react";
import { StackActions } from "@react-navigation/native";
import { useAppNavigation } from "@/navigation";

/**
 * «Volver a la consola» de ese viaje. Si la consola ya está en la pila (caso normal) se vuelve a ella sin apilar otra
 * copia; si no (se llegó por un aviso o un enlace) esta pantalla se sustituye por la consola.
 * (React Navigation 7: `navigate` a una pantalla que ya está en la pila apilaría otra; `popTo` hace lo correcto.)
 */
export function useBackToConsole(tripId: string): () => void {
  const navigation = useAppNavigation();
  return useCallback(() => {
    navigation.dispatch(StackActions.popTo("DriverConsole", { tripId }, { merge: true }));
  }, [navigation, tripId]);
}
