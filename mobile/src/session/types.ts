import type { MeProfile } from "@/api/types";

/** Rol con el que se está usando la app ahora mismo («Busco coche» = passenger, «Ofrezco plazas» = driver). */
export type ActiveRole = "passenger" | "driver";

/**
 * - booting:   leyendo el token guardado y validándolo (la app aún no pinta navegación).
 * - signedOut: sin sesión → Bienvenida.
 * - guest:     «Explorar sin registrarme»: sin token; solo en memoria (al reabrir la app se vuelve a Bienvenida).
 * - signedIn:  con token válido (o recordado y no comprobable por falta de red).
 */
export type SessionStatus = "booting" | "guest" | "signedOut" | "signedIn";

/** Por qué no hay sesión (para explicarlo en Bienvenida). */
export type SignOutReason = "user" | "expired" | "inactive";

export interface SessionState {
  status: SessionStatus;
  token: string | null;
  /** Respuesta real de `GET /me` (snake_case). Puede ser una copia en caché si arrancó sin red. */
  me: MeProfile | null;
  activeRole: ActiveRole | null;
  /**
   * Contador que sube con cada «evento de entrada/salida» (arranque, inicio de sesión, cierre, sesión caducada,
   * modo invitado). La navegación lo observa para recolocar la pila; NO sube con simples refrescos de `me`.
   */
  epoch: number;
  signOutReason: SignOutReason | null;
  /** `true` si `me` no se pudo comprobar con el servidor (arranque sin red); se reintenta al volver la conexión. */
  meStale: boolean;
}

export type SessionAction =
  | { type: "BOOTED"; token: string | null; me: MeProfile | null; storedRole: ActiveRole | null; meStale?: boolean; reason?: SignOutReason | null }
  | { type: "GUEST_STARTED" }
  | { type: "SIGNED_IN"; token: string; me: MeProfile | null; storedRole: ActiveRole | null }
  | { type: "ME_LOADED"; token: string; me: MeProfile }
  | { type: "ME_FAILED"; token: string }
  | { type: "ACTIVE_ROLE_SET"; role: ActiveRole }
  | { type: "SIGNED_OUT"; reason: SignOutReason };

/** Lo mínimo que las funciones de navegación (no React) necesitan saber de la sesión. */
export interface SessionSnapshot {
  status: SessionStatus;
  me: MeProfile | null;
  activeRole: ActiveRole | null;
  epoch: number;
}
