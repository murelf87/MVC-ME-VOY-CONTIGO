/**
 * Alimenta el almacén de conectividad con NetInfo.
 *
 *  - Nativo: NetInfo real. La sonda de alcance apunta a NUESTRO backend (`/health/live`), no a Google.
 *    Cualquier respuesta HTTP cuenta como «Internet alcanzable»: que el servidor falle (5xx) no es estar sin Internet.
 *  - Web / vista previa: `@react-native-community/netinfo` lo sustituye Metro por un módulo que obedece al panel
 *    «Simulaciones» del visor; además se escuchan `online`/`offline` del navegador.
 *  - Al volver a primer plano se vuelve a medir.
 */
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { useEffect, type ReactElement, type ReactNode } from "react";
import { AppState, Platform } from "react-native";
import { API_URL } from "@/api/client";
import { connectivityStore, type RawConnectivity } from "./connectivityStore";

let configured = false;
function configureNetInfo(): void {
  if (configured) return;
  configured = true;
  if (!API_URL) return;
  NetInfo.configure({
    reachabilityUrl: `${API_URL}/health/live`,
    reachabilityMethod: "HEAD",
    reachabilityTest: async () => true,
    reachabilityLongTimeout: 60_000,
    reachabilityShortTimeout: 5_000,
    reachabilityRequestTimeout: 15_000,
    shouldFetchWiFiSSID: false,
    useNativeReachability: false,
  });
}

function browserOnline(): boolean {
  if (Platform.OS !== "web") return true;
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function fromNetInfo(state: NetInfoState): RawConnectivity {
  const details = state.details as { isConnectionExpensive?: boolean } | null;
  const raw: RawConnectivity = {
    type: state.type,
    isConnected: state.isConnected,
    isInternetReachable: state.isInternetReachable,
    isConnectionExpensive: details?.isConnectionExpensive ?? null,
  };
  return browserOnline() ? raw : { ...raw, type: "none", isConnected: false, isInternetReachable: false };
}

/** Vuelve a medir la red (NetInfo + navegador). Nunca rechaza. */
export async function refreshConnectivity(): Promise<void> {
  try {
    connectivityStore.setRaw(fromNetInfo(await NetInfo.refresh()));
  } catch {
    // sin lectura nueva: se conserva la anterior
  }
}

export function ConnectivityProvider({ children }: { children: ReactNode }): ReactElement {
  useEffect(() => {
    configureNetInfo();
    const unsubscribeNetInfo = NetInfo.addEventListener((state) => connectivityStore.setRaw(fromNetInfo(state)));
    void refreshConnectivity();

    const appState = AppState.addEventListener("change", (next) => {
      if (next === "active") void refreshConnectivity();
    });

    const onBrowserChange = () => void refreshConnectivity();
    const browser = Platform.OS === "web" && typeof window !== "undefined" ? window : null;
    browser?.addEventListener("online", onBrowserChange);
    browser?.addEventListener("offline", onBrowserChange);

    return () => {
      unsubscribeNetInfo();
      appState.remove();
      browser?.removeEventListener("online", onBrowserChange);
      browser?.removeEventListener("offline", onBrowserChange);
    };
  }, []);

  return <>{children}</>;
}
