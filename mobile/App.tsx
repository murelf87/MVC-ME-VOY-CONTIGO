/**
 * Raíz de MVC · Me voy contigo.
 *
 * Orden de arranque:
 *  1. (solo vista previa) instalar el backend en memoria y el puente con el visor, ANTES de que nada llame a la red;
 *  2. mantener visible la pantalla de arranque nativa;
 *  3. cargar fuentes, leer la sesión guardada (`AuthProvider`) y el enlace/aviso que abrió la app;
 *  4. montar la navegación con la pila inicial correcta (Bienvenida, paso de alta pendiente o Mapa) y ocultar la
 *     pantalla de arranque en cuanto la primera pantalla está dibujada.
 *
 * Proveedores (de fuera adentro): ErrorBoundary → SafeAreaProvider → ConnectivityProvider → AuthProvider.
 */
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, type ReactElement } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MvcLogo } from "@/brand";
import { ConnectivityProvider, ErrorBoundary } from "@/hooks";
import { AppNavigation } from "@/navigation/AppNavigation";
import { useBootDeepLink } from "@/navigation/deepLinkRuntime";
import { configureForegroundNotifications } from "@/platform/notifications";
import { getPreviewSafeAreaMetrics } from "@/platform/previewBridge";
import { AuthProvider, useAuth } from "@/session";
import { colors, useAppFonts } from "@/theme";
import { ToastHost } from "@/ui";

// Vista previa en navegador (EXPO_PUBLIC_PREVIEW=1). La condición lleva la expresión literal para que Metro la sustituya
// y elimine el `require` (y con él todo `src/preview`) de las compilaciones de producción. Ver README.md.
if (process.env.EXPO_PUBLIC_PREVIEW === "1") {
  (require("@/preview/install") as { installPreviewIfEnabled: () => void }).installPreviewIfEnabled();
}

/** Si el arranque se alarga (red lenta, servidor caído), se retira la pantalla nativa y se muestra «Cargando». */
const SPLASH_MAX_MS = 10_000;

function keepSplashVisible(): void {
  try {
    void SplashScreen.preventAutoHideAsync().catch(() => undefined);
  } catch {
    // sin pantalla de arranque nativa (web, Expo Go durante una recarga): no hay nada que mantener
  }
}

function hideSplash(): void {
  try {
    void SplashScreen.hideAsync().catch(() => undefined);
  } catch {
    // idem
  }
}

keepSplashVisible();

function BootView(): ReactElement {
  return (
    <View style={styles.boot} accessibilityRole="progressbar" accessibilityLabel="Cargando MVC">
      <MvcLogo variant="stacked" width={200} accessibilityLabel="MVC, Me voy contigo" />
      <ActivityIndicator color={colors.primary} size="large" style={styles.spinner} />
    </View>
  );
}

function Shell(): ReactElement {
  const { status } = useAuth();
  const fonts = useAppFonts();
  const linkRead = useBootDeepLink();
  // Si las fuentes fallan se sigue con la del sistema (`typography.ts` declara la reserva): nunca se bloquea el arranque.
  const fontsReady = fonts.loaded || fonts.error !== null;
  const ready = fontsReady && linkRead && status !== "booting";

  useEffect(() => {
    const timer = setTimeout(hideSplash, SPLASH_MAX_MS);
    return () => clearTimeout(timer);
  }, []);

  const onNavigationReady = useCallback(() => hideSplash(), []);

  if (!ready) return <BootView />;
  return <AppNavigation onReady={onNavigationReady} />;
}

export default function App(): ReactElement {
  useEffect(() => {
    configureForegroundNotifications();
  }, []);

  return (
    <ErrorBoundary>
      <SafeAreaProvider initialMetrics={getPreviewSafeAreaMetrics()}>
        <ConnectivityProvider>
          <AuthProvider>
            <StatusBar style="dark" />
            <Shell />
            <ToastHost />
          </AuthProvider>
        </ConnectivityProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg.screen,
  },
  spinner: { marginTop: 32 },
});
