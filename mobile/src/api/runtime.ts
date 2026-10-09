/**
 * Estado de ejecución compartido de la capa de red (sin dependencias de React ni de React Native).
 *
 *  - token de acceso vigente: lo fija `AuthProvider`; `apiRequest` lo añade como `Authorization: Bearer …`
 *    salvo que se pase `token` explícito (o `token: null` para no enviar ninguno).
 *  - «red caída forzada»: lo fija `ConnectivityProvider` (sin interfaz de red, o interruptor «sin conexión» de
 *    la vista previa). Con él activo, `apiRequest` falla al instante con `OfflineError`, sin esperar al timeout.
 *  - evento `authExpired`: el servidor devolvió 401 a una petición con token.
 *  - evento `sessionCleared`: la sesión terminó (cierre, caducidad…): las cachés de datos deben vaciarse.
 */

let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

let networkOffline = false;

export function setNetworkOffline(offline: boolean): void {
  networkOffline = offline;
}

export function isNetworkOffline(): boolean {
  return networkOffline;
}

export interface AuthExpiredEvent {
  /** Token con el que se hizo la petición rechazada (para no cerrar una sesión nueva por una respuesta vieja). */
  token: string;
  /** Código del servidor (AUTH_INVALID_OR_EXPIRED, AUTH_REQUIRED…). */
  code: string;
  requestId?: string;
}

type AuthExpiredListener = (event: AuthExpiredEvent) => void;
const authExpiredListeners = new Set<AuthExpiredListener>();

/** Suscripción al evento «sesión caducada». Devuelve la función para darse de baja. */
export function onAuthExpired(listener: AuthExpiredListener): () => void {
  authExpiredListeners.add(listener);
  return () => {
    authExpiredListeners.delete(listener);
  };
}

export function emitAuthExpired(event: AuthExpiredEvent): void {
  for (const listener of [...authExpiredListeners]) {
    try {
      listener(event);
    } catch {
      // Un oyente defectuoso no debe impedir que los demás reciban el evento.
    }
  }
}

const sessionClearedListeners = new Set<() => void>();

/** Suscripción al fin de sesión (la usa la caché de consultas para no filtrar datos entre cuentas). */
export function onSessionCleared(listener: () => void): () => void {
  sessionClearedListeners.add(listener);
  return () => {
    sessionClearedListeners.delete(listener);
  };
}

export function emitSessionCleared(): void {
  for (const listener of [...sessionClearedListeners]) {
    try {
      listener();
    } catch {
      // un oyente defectuoso no debe impedir que los demás se enteren
    }
  }
}
