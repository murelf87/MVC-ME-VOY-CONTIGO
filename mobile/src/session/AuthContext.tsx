/**
 * Proveedor y hook de la sesión.
 *
 *   const { status, me, roles, isStaff, activeRole, setActiveRole, refreshMe, signIn, signOut } = useAuth();
 *
 * El estado vive en `sessionStore` (almacén externo) y los flujos en `sessionService`; este fichero solo los
 * conecta a React: arranque, caducidad de sesión (401) y refresco de `/me` al volver la conexión.
 */
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import { onAuthExpired } from "@/api/runtime";
import type { AnyRole, MeProfile, SessionPayload } from "@/api/types";
import { useOnReconnect } from "@/hooks/useConnectivity";
import { getFirstName, getOnboardingRequirements, hasStaffRole, type OnboardingRequirement } from "./selectors";
import { sessionService } from "./session";
import { sessionStore } from "./sessionStore";
import type { ActiveRole, SessionStatus, SignOutReason } from "./types";

export interface AuthContextValue {
  /** booting (leyendo el token) · guest (explorando sin cuenta) · signedOut · signedIn. */
  status: SessionStatus;
  token: string | null;
  /** Respuesta real de `GET /me`. `null` sin sesión (o con sesión recordada pero aún sin poder cargarla). */
  me: MeProfile | null;
  /** Roles reales de `/me`, incluidos los de personal. `[]` sin sesión. */
  roles: readonly AnyRole[];
  /** Personal administrativo: admin, verification_admin, finance_admin o support_admin. */
  isStaff: boolean;
  hasRole(role: AnyRole): boolean;
  /** Rol con el que se usa la app (pasajero/conductor). Persistido por usuario. `null` sin sesión o solo personal. */
  activeRole: ActiveRole | null;
  /** Cambia de rol. Devuelve `false` si el usuario no tiene ese rol. */
  setActiveRole(role: ActiveRole): boolean;
  /** Vuelve a pedir `/me`. Resuelve con el perfil, o `null` si no se pudo. */
  refreshMe(): Promise<MeProfile | null>;
  /** Guarda la sesión que devolvió `verifyPhoneCode` y carga `/me`. Rechaza solo si el servidor rechaza el token. */
  signIn(payload: Pick<SessionPayload, "token">): Promise<MeProfile | null>;
  /** Cierra la sesión (revoca el token en el servidor y borra el almacén local). */
  signOut(): Promise<void>;
  /** «Explorar sin registrarme»: entra a MapHome sin cuenta. */
  continueAsGuest(): void;

  isGuest: boolean;
  isSignedIn: boolean;
  /** Primer nombre para saludos; `null` si aún no hay. */
  firstName: string | null;
  /** Qué le falta para completar el alta (`role`, `photo`), derivado de `/me`. `[]` si está completa. */
  onboardingRequirements: readonly OnboardingRequirement[];
  /** Por qué no hay sesión, si la había (para explicarlo en Bienvenida). */
  signOutReason: SignOutReason | null;
  /** `me` es una copia guardada (arranque sin red); se refresca solo al volver la conexión. */
  meStale: boolean;
  /** Sube con cada entrada/salida de sesión (la navegación recoloca la pila al cambiar). */
  epoch: number;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const NO_ROLES: readonly AnyRole[] = [];
const NO_REQUIREMENTS: readonly OnboardingRequirement[] = [];

const actions = {
  setActiveRole: (role: ActiveRole) => sessionService.setActiveRole(role),
  refreshMe: () => sessionService.refreshMe(),
  signIn: (payload: Pick<SessionPayload, "token">) => sessionService.signIn(payload),
  signOut: () => sessionService.signOut("user"),
  continueAsGuest: () => sessionService.continueAsGuest(),
};

export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  const state = useSyncExternalStore(sessionStore.subscribe, sessionStore.getState, sessionStore.getState);

  useEffect(() => {
    const stopListening = onAuthExpired((event) => sessionService.handleAuthExpired(event));
    void sessionService.boot();
    return stopListening;
  }, []);

  // Si arrancó sin red con una copia de `/me`, al volver la conexión se pone al día.
  useOnReconnect(() => {
    if (sessionStore.getState().meStale) void sessionService.refreshMe();
  });

  const { status, token, me, activeRole, epoch, signOutReason, meStale } = state;
  const value = useMemo<AuthContextValue>(() => {
    const roles = me?.roles ?? NO_ROLES;
    return {
      status,
      token,
      me,
      roles,
      isStaff: hasStaffRole(roles),
      hasRole: (role) => roles.includes(role),
      activeRole,
      ...actions,
      isGuest: status === "guest",
      isSignedIn: status === "signedIn",
      firstName: getFirstName(me),
      onboardingRequirements: me ? getOnboardingRequirements(me) : NO_REQUIREMENTS,
      signOutReason,
      meStale,
      epoch,
    };
  }, [status, token, me, activeRole, epoch, signOutReason, meStale]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth debe usarse dentro de <AuthProvider>.");
  return context;
}
