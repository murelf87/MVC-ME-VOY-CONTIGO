/**
 * Enlaces profundos y toques en avisos: lectura del arranque en frío y suscripción mientras la app está abierta.
 * No se usa la propiedad `linking` de React Navigation: se quiere que TODO enlace pase por la misma puerta de
 * sesión/alta/permisos (`openTarget`) y que la pila resultante tenga siempre «Mapa» debajo.
 * En web (vista previa) los enlaces están desactivados.
 */
import * as Linking from "expo-linking";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { getLaunchNotificationTap, onNotificationTap } from "@/platform/notifications";
import { openTarget } from "./actions";
import { parseDeepLink, resolveNotificationTarget } from "./deepLinks";
import { setPendingReturn } from "./returnTo";

const INITIAL_LINK_TIMEOUT_MS = 1_500;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * Lee el enlace o el aviso que abrió la app y lo deja como «adónde volver». Devuelve `true` cuando ya se puede
 * calcular la pila inicial. Nunca bloquea más de 1,5 s.
 */
export function useBootDeepLink(): boolean {
  const [ready, setReady] = useState(Platform.OS === "web");
  useEffect(() => {
    if (Platform.OS === "web") return undefined;
    let cancelled = false;
    void (async () => {
      const [url, tap] = await Promise.all([
        withTimeout(Linking.getInitialURL(), INITIAL_LINK_TIMEOUT_MS),
        withTimeout(getLaunchNotificationTap(), INITIAL_LINK_TIMEOUT_MS),
      ]);
      const target = (url ? parseDeepLink(url) : null) ?? (tap ? resolveNotificationTarget(tap.data) : null);
      if (target) setPendingReturn(target);
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return ready;
}

/** Enlaces y toques en avisos recibidos con la app ya abierta. */
export function useLiveDeepLinks(): void {
  useEffect(() => {
    if (Platform.OS === "web") return undefined;
    const linkSubscription = Linking.addEventListener("url", ({ url }) => {
      const target = parseDeepLink(url);
      if (target) openTarget(target);
    });
    const stopTaps = onNotificationTap((tap) => openTarget(resolveNotificationTarget(tap.data)));
    return () => {
      linkSubscription.remove();
      stopTaps();
    };
  }, []);
}
