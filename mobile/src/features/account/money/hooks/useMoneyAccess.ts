/**
 * Qué puede ver esta persona en «Mis pagos y cobros»: los datos de conductor solo existen si la cuenta tiene el rol
 * de conductor (`/me`). Sin sesión no hay datos de dinero.
 */
import { useAuth } from "@/session";

export interface MoneyAccess {
  /** La sesión aún se está recuperando. */
  booting: boolean;
  /** Hay sesión iniciada. */
  signedIn: boolean;
  /** Se conocen los roles (`GET /me` cargado). Hasta entonces no se puede decir «no eres conductor». */
  rolesKnown: boolean;
  isDriver: boolean;
  /** Rol con el que se usa la app (pestaña con la que se abre la pantalla si no se pide otra). */
  activeRole: "passenger" | "driver" | null;
  /** Vuelve a pedir `/me` (para reintentar cuando la sesión se recuperó sin red). */
  refreshMe: () => Promise<unknown>;
}

export function useMoneyAccess(): MoneyAccess {
  const auth = useAuth();
  return {
    booting: auth.status === "booting",
    signedIn: auth.isSignedIn,
    rolesKnown: auth.me !== null,
    isDriver: auth.hasRole("driver"),
    activeRole: auth.activeRole,
    refreshMe: auth.refreshMe,
  };
}
