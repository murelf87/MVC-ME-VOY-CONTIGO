/** Reglas de acceso a rutas según la sesión (puras). */
import type { MeProfile } from "@/api/types";
import { hasStaffRole } from "@/session/selectors";
import type { SessionStatus } from "@/session/types";
import type { RouteAccess } from "./routeDef";

export interface AccessSession {
  status: SessionStatus;
  me: MeProfile | null;
}

/** ¿Puede esta sesión entrar a una ruta con ese nivel de acceso? */
export function isRouteAllowed(access: RouteAccess, session: AccessSession): boolean {
  switch (access) {
    case "public":
      return true;
    case "auth":
      return session.status === "signedIn";
    case "staff":
      return session.status === "signedIn" && session.me !== null && hasStaffRole(session.me.roles);
  }
}
