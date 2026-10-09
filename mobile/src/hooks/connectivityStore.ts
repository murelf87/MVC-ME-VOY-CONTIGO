/**
 * Estado de conectividad de la app (sin React ni módulos nativos: se prueba en Node).
 *
 * `ConnectivityProvider` alimenta este almacén con lo que dice NetInfo (en la vista previa web, el sustituto que
 * obedece al panel «Simulaciones»). Todo lo demás lo lee a través de `useConnectivity()` / `useIsOnline()`.
 *
 * Reglas:
 *  - «Sin interfaz de red» (`isConnected === false`) ⇒ `offline` y se fuerza el modo sin red de `apiRequest`
 *    (falla al instante con `OfflineError`, sin esperar al timeout).
 *  - «Hay red pero NetInfo no alcanza el servidor» (`isInternetReachable === false`) ⇒ `offline` en la interfaz
 *    (aviso «Sin conexión»), pero NO se bloquean las peticiones: las decide el propio servidor (portal cautivo,
 *    caída momentánea del sondeo…). Así una sonda fallida nunca impide usar la app cuando sí hay servicio.
 *  - Mientras NetInfo no ha contestado, el estado es `unknown` y la app se comporta como si hubiera red.
 */
import { setNetworkOffline } from "@/api/runtime";

export type ConnectivityStatus = "unknown" | "online" | "offline";
export type ConnectionKind = "wifi" | "cellular" | "other" | "none" | "unknown";
export type OfflineReason = "no_network" | "no_internet";

export interface RawConnectivity {
  /** `NetInfoState.type` (wifi, cellular, none, unknown, ethernet, vpn…). */
  type?: string;
  /** Hay una interfaz de red activa. `null` = aún no se sabe. */
  isConnected: boolean | null;
  /** Internet alcanzable según la sonda de NetInfo. `null`/`undefined` = no se sabe. */
  isInternetReachable?: boolean | null;
  /** Datos móviles con coste (evitar descargas pesadas). */
  isConnectionExpensive?: boolean | null;
}

export interface ConnectivityState {
  status: ConnectivityStatus;
  /** `true` si NO hay conexión confirmada. Atajo de `status === "offline"`. */
  isOffline: boolean;
  /** `true` salvo que se sepa que no hay conexión (durante el arranque se asume que sí). */
  isOnline: boolean;
  type: ConnectionKind;
  isExpensive: boolean;
  offlineReason: OfflineReason | null;
  /** Instante (ms) del último cambio de `status`; `null` hasta la primera lectura. */
  since: number | null;
}

export const UNKNOWN_CONNECTIVITY: ConnectivityState = {
  status: "unknown",
  isOffline: false,
  isOnline: true,
  type: "unknown",
  isExpensive: false,
  offlineReason: null,
  since: null,
};

function connectionKind(type: string | undefined, connected: boolean | null): ConnectionKind {
  if (connected === false || type === "none") return "none";
  switch (type) {
    case "wifi":
      return "wifi";
    case "cellular":
      return "cellular";
    case undefined:
    case "unknown":
      return "unknown";
    default:
      return "other"; // ethernet, vpn, bluetooth, wimax…
  }
}

/** Convierte la lectura cruda de NetInfo en el estado que consume la app. Pura. */
export function deriveConnectivity(raw: RawConnectivity, now: number | null = null): ConnectivityState {
  let status: ConnectivityStatus;
  let offlineReason: OfflineReason | null = null;
  if (raw.isConnected === false) {
    status = "offline";
    offlineReason = "no_network";
  } else if (raw.isInternetReachable === false) {
    status = "offline";
    offlineReason = "no_internet";
  } else if (raw.isConnected === true) {
    status = "online";
  } else {
    status = "unknown";
  }
  return {
    status,
    isOffline: status === "offline",
    isOnline: status !== "offline",
    type: connectionKind(raw.type, raw.isConnected),
    isExpensive: raw.isConnectionExpensive === true,
    offlineReason,
    since: now,
  };
}

export interface ConnectivityStore {
  getState(): ConnectivityState;
  /** Aplica una lectura de NetInfo. Devuelve el estado (la misma referencia si nada relevante cambió). */
  setRaw(raw: RawConnectivity): ConnectivityState;
  subscribe(listener: () => void): () => void;
  /** Se llama al pasar de `offline` a `online` (no en el primer arranque). */
  onReconnect(listener: () => void): () => void;
  /** Solo pruebas: vuelve al estado inicial sin avisar. */
  reset(): void;
}

export interface ConnectivityStoreOptions {
  now?: () => number;
  /** Se invoca cuando cambia «sin red forzado» (para que `apiRequest` falle al instante). */
  onForcedOfflineChange?: (forced: boolean) => void;
}

export function createConnectivityStore(options: ConnectivityStoreOptions = {}): ConnectivityStore {
  const now = options.now ?? Date.now;
  let state: ConnectivityState = UNKNOWN_CONNECTIVITY;
  let forcedOffline = false;
  const listeners = new Set<() => void>();
  const reconnectListeners = new Set<() => void>();

  function emit(set: Set<() => void>): void {
    for (const listener of [...set]) {
      try {
        listener();
      } catch {
        // un oyente defectuoso no debe impedir que los demás reciban el aviso
      }
    }
  }

  return {
    getState: () => state,

    setRaw(raw) {
      const next = deriveConnectivity(raw, now());
      const previous = state;

      const forced = next.offlineReason === "no_network";
      if (forced !== forcedOffline) {
        forcedOffline = forced;
        options.onForcedOfflineChange?.(forced);
      }

      const unchanged =
        previous.status === next.status &&
        previous.type === next.type &&
        previous.isExpensive === next.isExpensive &&
        previous.offlineReason === next.offlineReason;
      if (unchanged) return previous;

      state = { ...next, since: previous.status === next.status ? previous.since : next.since };
      emit(listeners);
      if (previous.status === "offline" && next.status === "online") emit(reconnectListeners);
      return state;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    onReconnect(listener) {
      reconnectListeners.add(listener);
      return () => {
        reconnectListeners.delete(listener);
      };
    },

    reset() {
      state = UNKNOWN_CONNECTIVITY;
      forcedOffline = false;
      options.onForcedOfflineChange?.(false);
    },
  };
}

/** Almacén único de la app. */
export const connectivityStore: ConnectivityStore = createConnectivityStore({ onForcedOfflineChange: setNetworkOffline });
