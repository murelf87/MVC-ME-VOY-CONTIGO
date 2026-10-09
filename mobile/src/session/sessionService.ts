/**
 * Flujos asíncronos de la sesión (arranque, inicio y cierre de sesión, refresco de `/me`, rol activo) con TODAS
 * las dependencias inyectadas: se prueban en Node sin red, sin almacén seguro y sin React.
 */
import { isApiError, isAuthExpiredError } from "@/api/errors";
import type { AuthExpiredEvent } from "@/api/runtime";
import type { MeProfile, SessionPayload } from "@/api/types";
import type { SessionStore } from "./sessionStore";
import type { ActiveRole, SignOutReason } from "./types";

export interface SessionStorage {
  readToken(): Promise<string | null>;
  /** `false` si no se pudo guardar (la sesión vive en memoria hasta cerrar la app). */
  writeToken(token: string): Promise<boolean>;
  clearToken(): Promise<void>;
  readMeCache(): Promise<MeProfile | null>;
  writeMeCache(me: MeProfile): Promise<void>;
  clearMeCache(): Promise<void>;
  readActiveRole(userId: string): Promise<ActiveRole | null>;
  writeActiveRole(userId: string, role: ActiveRole): Promise<void>;
}

export interface SessionApi {
  /** Con `token` explícito NO debe emitir el evento de sesión caducada (arranque / validación). */
  getMe(options: { token?: string; timeoutMs?: number; retries?: number }): Promise<MeProfile>;
  logout(token: string): Promise<void>;
}

export interface SessionDeps {
  store: SessionStore;
  storage: SessionStorage;
  api: SessionApi;
  /** Mantiene el token que `apiRequest` añade a las peticiones. */
  setAccessToken(token: string | null): void;
  /** Se llama al terminar una sesión: vacía cachés de datos para no filtrar datos entre cuentas. */
  onSessionCleared(): void;
}

const BOOT_TIMEOUT_MS = 6_000;

/** ¿El servidor dice que este token/cuenta ya no vale? (≠ no hemos podido preguntar). */
export function isSessionRejected(error: unknown): boolean {
  if (isAuthExpiredError(error)) return true;
  if (isApiError(error)) {
    return error.status === 401 || error.status === 403 || (error.status === 404 && error.code === "USER_NOT_FOUND");
  }
  return false;
}

function rejectionReason(error: unknown): SignOutReason {
  return isApiError(error) && error.code === "ACCOUNT_NOT_ACTIVE" ? "inactive" : "expired";
}

export interface SessionService {
  /** Idempotente: llamadas repetidas (StrictMode) comparten la misma ejecución. */
  boot(): Promise<void>;
  /** Guarda el token, carga `/me` y entra. Rechaza solo si el servidor rechaza el token recién creado. */
  signIn(payload: Pick<SessionPayload, "token">): Promise<MeProfile | null>;
  signOut(reason?: SignOutReason): Promise<void>;
  refreshMe(): Promise<MeProfile | null>;
  setActiveRole(role: ActiveRole): boolean;
  continueAsGuest(): void;
  handleAuthExpired(event: AuthExpiredEvent): void;
}

export function createSessionService(deps: SessionDeps): SessionService {
  const { store, storage, api } = deps;
  let refreshInFlight: Promise<MeProfile | null> | null = null;
  let bootPromise: Promise<void> | null = null;

  async function rememberMe(me: MeProfile): Promise<void> {
    await storage.writeMeCache(me).catch(() => undefined);
  }

  async function forgetStoredSession(): Promise<void> {
    await Promise.all([storage.clearToken(), storage.clearMeCache()]).catch(() => undefined);
  }

  async function endSession(reason: SignOutReason, revokeToken: string | null): Promise<void> {
    deps.setAccessToken(null);
    store.dispatch({ type: "SIGNED_OUT", reason });
    deps.onSessionCleared();
    await forgetStoredSession();
    if (revokeToken) await api.logout(revokeToken).catch(() => undefined);
  }

  async function runBoot(): Promise<void> {
    const token = await storage.readToken().catch(() => null);
    if (!token) {
      store.dispatch({ type: "BOOTED", token: null, me: null, storedRole: null });
      return;
    }

    deps.setAccessToken(token);
    try {
      const me = await api.getMe({ token, timeoutMs: BOOT_TIMEOUT_MS, retries: 1 });
      const storedRole = await storage.readActiveRole(me.id).catch(() => null);
      void rememberMe(me);
      store.dispatch({ type: "BOOTED", token, me, storedRole, meStale: false });
    } catch (error) {
      if (isSessionRejected(error)) {
        deps.setAccessToken(null);
        await forgetStoredSession();
        store.dispatch({ type: "BOOTED", token: null, me: null, storedRole: null, reason: rejectionReason(error) });
        return;
      }
      // Sin red / servidor caído: NO se cierra la sesión. Se usa la última copia conocida de `/me`.
      const cached = await storage.readMeCache().catch(() => null);
      const storedRole = cached ? await storage.readActiveRole(cached.id).catch(() => null) : null;
      store.dispatch({ type: "BOOTED", token, me: cached, storedRole, meStale: true });
    }
  }

  return {
    boot() {
      bootPromise ??= runBoot();
      return bootPromise;
    },

    async signIn(payload) {
      const token = payload.token;
      deps.setAccessToken(token);
      await storage.writeToken(token).catch(() => false);
      let me: MeProfile | null = null;
      try {
        me = await api.getMe({ token, timeoutMs: BOOT_TIMEOUT_MS, retries: 1 });
        void rememberMe(me);
      } catch (error) {
        if (isSessionRejected(error)) {
          deps.setAccessToken(null);
          await storage.clearToken().catch(() => undefined);
          throw error;
        }
        // Sin red justo tras verificar el código: la sesión es válida; `me` se cargará al volver la conexión.
      }
      const storedRole = me ? await storage.readActiveRole(me.id).catch(() => null) : null;
      store.dispatch({ type: "SIGNED_IN", token, me, storedRole });
      return me;
    },

    async signOut(reason = "user") {
      const { token, status } = store.getState();
      if (status === "signedOut") return;
      await endSession(reason, reason === "user" ? token : null);
    },

    refreshMe() {
      const { token, status } = store.getState();
      if (!token || status !== "signedIn") return Promise.resolve(null);
      if (refreshInFlight) return refreshInFlight;
      refreshInFlight = (async () => {
        try {
          const me = await api.getMe({ timeoutMs: BOOT_TIMEOUT_MS });
          store.dispatch({ type: "ME_LOADED", token, me });
          void rememberMe(me);
          return me;
        } catch (error) {
          // Un 401 llega además como evento `authExpired` (→ handleAuthExpired); aquí solo se anota el fallo.
          store.dispatch({ type: "ME_FAILED", token });
          if (isSessionRejected(error) && !isAuthExpiredError(error)) {
            await endSession(rejectionReason(error), null);
          }
          return null;
        } finally {
          refreshInFlight = null;
        }
      })();
      return refreshInFlight;
    },

    setActiveRole(role) {
      const before = store.getState();
      const after = store.dispatch({ type: "ACTIVE_ROLE_SET", role });
      const applied = after.activeRole === role;
      if (applied && before.me && before.activeRole !== role) {
        void storage.writeActiveRole(before.me.id, role).catch(() => undefined);
      }
      return applied;
    },

    continueAsGuest() {
      store.dispatch({ type: "GUEST_STARTED" });
    },

    handleAuthExpired(event) {
      const { token, status } = store.getState();
      if (status !== "signedIn" || token !== event.token) return;
      void endSession("expired", null);
    },
  };
}
