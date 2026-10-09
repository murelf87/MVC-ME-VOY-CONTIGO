/**
 * Contenedor de navegación de la app: estado inicial según la sesión, recolocación de la pila en cada
 * entrada/salida de sesión, enlaces profundos y aviso de pantalla a la vista previa.
 *
 * Se monta SOLO cuando la sesión ya arrancó (`status !== "booting"`), de modo que la primera pantalla es la
 * correcta (nunca se ve Bienvenida un instante antes de MapHome).
 */
import { DefaultTheme, NavigationContainer, type InitialState, type Theme } from "@react-navigation/native";
import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { reportPreviewScreen } from "@/platform/previewBridge";
import { useAuth } from "@/session/AuthContext";
import { colors } from "@/theme/colors";
import { applyGate } from "./actions";
import { useLiveDeepLinks } from "./deepLinkRuntime";
import { decideGate } from "./gating";
import { getCurrentRoute, navigationRef } from "./navigationRef";
import { RootNavigator } from "./RootNavigator";
import { clearPendingReturn, peekPendingReturn } from "./returnTo";
import { getRouteAccess } from "./routeIndex";
import { getSessionSnapshot } from "@/session/sessionStore";

const theme: Theme = {
  ...DefaultTheme,
  dark: false,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
    background: colors.bg.screen,
    card: colors.bg.screen,
    text: colors.text.body,
    border: colors.border.divider,
    notification: colors.error.solid,
  },
};

function initialStateFromGate(): InitialState | undefined {
  const decision = decideGate({ session: getSessionSnapshot(), pending: peekPendingReturn(), accessOf: getRouteAccess });
  if (!decision) return undefined;
  if (decision.pendingHandled) clearPendingReturn();
  return {
    index: decision.stack.length - 1,
    routes: decision.stack.map((entry) => (entry.params === undefined ? { name: entry.name } : { name: entry.name, params: entry.params as object })),
  };
}

/**
 * Recoloca la pila:
 *  - al cambiar la sesión (entrada, salida, caducidad, invitado): siempre;
 *  - cuando `/me` aparece por primera vez sin que haya habido entrada ni salida (se entró sin poder cargarlo): solo si
 *    falta un paso del alta; si está completa la persona sigue donde está.
 * Los refrescos posteriores de `/me` NO mueven nada: la pantalla de alta decide cuándo seguir (`completeOnboarding`).
 */
function NavigationEffects(): null {
  const { epoch, me } = useAuth();
  const known = me !== null;
  const last = useRef({ epoch, known });
  useEffect(() => {
    const previous = last.current;
    last.current = { epoch, known };
    if (previous.epoch !== epoch) applyGate();
    else if (!previous.known && known) applyGate({ onlyIfOnboarding: true });
  }, [epoch, known]);
  useLiveDeepLinks();
  return null;
}

export function AppNavigation({ onReady }: { onReady?: () => void }): ReactElement {
  const initialState = useMemo(initialStateFromGate, []);

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={theme}
      initialState={initialState}
      documentTitle={{ enabled: false }}
      onReady={() => {
        const route = getCurrentRoute();
        if (route) reportPreviewScreen(route.name, route.params);
        onReady?.();
      }}
      onStateChange={() => {
        const route = getCurrentRoute();
        if (route) reportPreviewScreen(route.name, route.params);
      }}
    >
      <RootNavigator />
      <NavigationEffects />
    </NavigationContainer>
  );
}
