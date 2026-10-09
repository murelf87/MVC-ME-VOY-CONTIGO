/**
 * Pila única de la app (`@react-navigation/native-stack`, sin cabecera nativa: cada pantalla pinta la suya).
 * Las rutas salen del registro (`registry.ts`); cada pantalla se envuelve con:
 *   - control de acceso (`public | auth | staff`): un invitado que llega a una ruta con cuenta pasa por CreateAccount
 *     y vuelve; alguien sin permisos de personal no ve el panel;
 *   - una barrera de errores: si una pantalla falla al pintar, el resto de la app sigue viva.
 */
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useEffect, type ComponentProps, type ComponentType } from "react";
import { ActivityIndicator, View } from "react-native";
import { ErrorBoundary } from "@/hooks/ErrorBoundary";
import { sessionStore } from "@/session/sessionStore";
import { useAuth } from "@/session/AuthContext";
import { colors } from "@/theme/colors";
import { isRouteAllowed } from "./access";
import { applyGate } from "./actions";
import { APP_ROUTES } from "./registry";
import { setPendingReturn } from "./returnTo";
import type { RegisteredRoute } from "./routeDef";
import type { AppNavigation, AppParamList } from "./types";

const Stack = createNativeStackNavigator<AppParamList>();

/** Tipo de `component` que acepta `Stack.Screen` para cualquier ruta de la app. */
type StackScreenComponent = NonNullable<ComponentProps<typeof Stack.Screen>["component"]>;

interface GuardedProps {
  navigation: AppNavigation;
  route: { key: string; name: string; params?: object };
}

function BlankWhileRedirecting() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg.screen }}>
      <ActivityIndicator color={colors.primary} accessibilityLabel="Cargando" />
    </View>
  );
}

const guardedScreens = new Map<string, ComponentType<GuardedProps>>();

/** Componente estable por ruta (si se creara en cada render, React desmontaría la pantalla en cada cambio). */
function guardedScreen(route: RegisteredRoute): ComponentType<GuardedProps> {
  const existing = guardedScreens.get(route.name);
  if (existing) return existing;

  const Screen = route.component as unknown as ComponentType<GuardedProps>;

  function GuardedScreen(props: GuardedProps) {
    const { status, me } = useAuth();
    const allowed = isRouteAllowed(route.access, { status, me });
    const { navigation } = props;
    const routeKey = props.route.key;

    useEffect(() => {
      if (allowed) return;
      if (route.access === "staff") {
        if (navigation.canGoBack()) navigation.goBack();
        else applyGate();
        return;
      }
      // Ruta con cuenta sin cuenta: se recuerda adónde iba y se manda a crear la cuenta (o a Bienvenida).
      const { params } = props.route;
      setPendingReturn({ name: route.name, params } as never);
      if (sessionStore.getState().status === "signedOut") {
        applyGate();
      } else {
        navigation.replace("CreateAccount");
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allowed, routeKey]);

    if (!allowed) return <BlankWhileRedirecting />;
    return (
      <ErrorBoundary
        resetKeys={[routeKey]}
        {...(navigation.canGoBack() ? { onBack: navigation.goBack } : {})}
        testID={`${route.name}.error`}
      >
        <Screen {...props} />
      </ErrorBoundary>
    );
  }
  GuardedScreen.displayName = `Screen(${route.name})`;
  guardedScreens.set(route.name, GuardedScreen);
  return GuardedScreen;
}

export function RootNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg.screen },
      }}
    >
      {APP_ROUTES.map((route) => (
        <Stack.Screen
          key={route.name}
          name={route.name}
          // Borde tipado: el registro guarda componentes de props heterogéneas ya comprobadas por `defineRoute`.
          component={guardedScreen(route) as unknown as StackScreenComponent}
          options={{
            ...(route.options?.animation ? { animation: route.options.animation } : {}),
            ...(route.options?.gestureEnabled !== undefined ? { gestureEnabled: route.options.gestureEnabled } : {}),
          }}
        />
      ))}
    </Stack.Navigator>
  );
}
