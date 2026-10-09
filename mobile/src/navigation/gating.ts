/**
 * Decisión de entrada de la app (pura, sin React): según la sesión y lo que falte del alta, ¿qué pila se muestra?
 *
 *   booting                          → nada todavía (la app enseña la pantalla de carga)
 *   sin sesión                       → Bienvenida
 *   invitado                         → MapHome
 *   con sesión, alta incompleta      → el paso que falta (derivado del `/me` real): ChooseRole o ProfilePhoto
 *   con sesión, alta completa        → MapHome
 *
 * Si hay un «adónde volver» pendiente (enlace profundo, solicitud de un invitado) y esta sesión puede entrar a esa
 * ruta, se apila encima de MapHome y se consume. Si no puede (p. ej. ruta de personal), se descarta.
 */
import type { MeProfile } from "@/api/types";
import { getOnboardingRequirements } from "@/session/selectors";
import type { SessionStatus } from "@/session/types";
import { isRouteAllowed } from "./access";
import type { ReturnTarget } from "./returnTo";
import type { RouteAccess } from "./routeDef";

export type GateReason = "signed_out" | "guest" | "onboarding_role" | "onboarding_photo" | "home";

export interface GateInput {
  session: { status: SessionStatus; me: MeProfile | null };
  pending: ReturnTarget | null;
  /** Acceso declarado de una ruta; `undefined` si la ruta no existe. */
  accessOf(name: string): RouteAccess | undefined;
}

export interface GateDecision {
  /** Pila a mostrar, de abajo arriba. Nunca vacía. */
  stack: ReturnTarget[];
  reason: GateReason;
  /** `true` si el «adónde volver» pendiente se usó o se descartó (hay que olvidarlo). */
  pendingHandled: boolean;
}

const WELCOME: ReturnTarget = { name: "Welcome" };
const CHOOSE_ROLE: ReturnTarget = { name: "ChooseRole" };
const PROFILE_PHOTO: ReturnTarget = { name: "ProfilePhoto" };
const MAP_HOME: ReturnTarget = { name: "MapHome" };

/** `null` mientras la sesión está arrancando. */
export function decideGate(input: GateInput): GateDecision | null {
  const { session, pending, accessOf } = input;

  if (session.status === "booting") return null;
  if (session.status === "signedOut") return { stack: [WELCOME], reason: "signed_out", pendingHandled: false };

  if (session.status === "signedIn" && session.me) {
    const missing = getOnboardingRequirements(session.me);
    if (missing.includes("role")) return { stack: [CHOOSE_ROLE], reason: "onboarding_role", pendingHandled: false };
    if (missing.includes("photo")) return { stack: [PROFILE_PHOTO], reason: "onboarding_photo", pendingHandled: false };
  }

  // Invitado, o con sesión y alta completa (o con sesión sin poder cargar `/me` todavía: se entra al mapa).
  const reason: GateReason = session.status === "guest" ? "guest" : "home";
  if (!pending) return { stack: [MAP_HOME], reason, pendingHandled: false };

  const access = accessOf(pending.name);
  if (access !== undefined && isRouteAllowed(access, session) && pending.name !== "MapHome") {
    return { stack: [MAP_HOME, pending], reason, pendingHandled: true };
  }
  // Un invitado con una ruta que exige cuenta conserva el pendiente (aún puede crear la cuenta).
  const stillUseful = session.status === "guest" && access === "auth";
  return { stack: [MAP_HOME], reason, pendingHandled: !stillUseful };
}

/**
 * Pila coherente para abrir directamente `target` (vista previa, escenarios): la pila de entrada de la sesión y
 * encima la ruta. Si la sesión no puede entrar a esa ruta, solo la pila de entrada.
 */
export function stackForTarget(input: GateInput, target: ReturnTarget): ReturnTarget[] {
  const base = decideGate({ ...input, pending: null });
  if (!base) return [target];
  const access = input.accessOf(target.name);
  if (access === undefined || !isRouteAllowed(access, input.session)) return base.stack;
  const bottom = base.stack[0];
  return bottom !== undefined && bottom.name === target.name ? base.stack : [...base.stack, target];
}
