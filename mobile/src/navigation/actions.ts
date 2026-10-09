/**
 * Acciones de navegación que dependen de la sesión. Funciones normales (no hooks): se pueden llamar desde un
 * manejador de botón, un enlace profundo, un aviso o el interceptor de sesión caducada.
 *
 *   requireAccount(returnTo)   ¿hay cuenta? Si no, guarda «adónde volver» y lleva a CreateAccount.
 *   openTarget(target)         abre una ruta respetando sesión, alta y permisos (enlaces profundos, avisos).
 *   completeOnboarding()       tras subir la foto: relee `/me` y entra a MapHome (o a donde se quería ir).
 *   applyGate()                recoloca la pila según la sesión (lo hace sola la app en cada entrada/salida).
 *   resetToRoute(target)       abre `target` con una pila coherente (vista previa y escenarios).
 */
import { CommonActions } from "@react-navigation/native";
import { getOnboardingRequirements } from "@/session/selectors";
import { sessionService } from "@/session/session";
import { getSessionSnapshot } from "@/session/sessionStore";
import { isRouteAllowed } from "./access";
import { decideGate, stackForTarget, type GateDecision } from "./gating";
import { navigationRef } from "./navigationRef";
import { clearPendingReturn, peekPendingReturn, setPendingReturn, type ReturnTarget } from "./returnTo";
import { getRouteAccess, hasRoute } from "./routeIndex";

function toRoutes(stack: readonly ReturnTarget[]): { name: string; params?: object }[] {
  return stack.map((entry) => (entry.params === undefined ? { name: entry.name } : { name: entry.name, params: entry.params as object }));
}

function resetStack(stack: readonly ReturnTarget[]): void {
  navigationRef.resetRoot({ index: stack.length - 1, routes: toRoutes(stack) });
}

export interface ApplyGateOptions {
  /**
   * Solo recoloca la pila si la decisión es un paso del alta (ChooseRole / ProfilePhoto). Lo usa la app cuando `/me`
   * aparece sin que haya habido entrada ni salida de sesión (p. ej. arranque sin red y sin copia): si el alta está
   * completa NO se mueve a la persona de la pantalla en la que ya está.
   */
  onlyIfOnboarding?: boolean;
}

/**
 * Recoloca la pila según la sesión actual. Devuelve la decisión (o `null` si la sesión aún arranca). Si el navegador
 * no está montado todavía solo decide: el estado inicial del contenedor ya incorpora esa decisión.
 */
export function applyGate(options: ApplyGateOptions = {}): GateDecision | null {
  const session = getSessionSnapshot();
  const decision = decideGate({ session, pending: peekPendingReturn(), accessOf: getRouteAccess });
  if (!decision || !navigationRef.isReady()) return decision;
  if (options.onlyIfOnboarding && decision.reason !== "onboarding_role" && decision.reason !== "onboarding_photo") return decision;
  if (decision.pendingHandled) clearPendingReturn();
  resetStack(decision.stack);
  return decision;
}

/**
 * Exige cuenta. Con sesión devuelve `true`. Sin ella (invitado o sin sesión) guarda `returnTo`, lleva a CreateAccount
 * y devuelve `false`: la persona crea la cuenta y la app la devuelve a `returnTo`.
 *
 *   onPress={() => { if (!requireAccount({ name: "ReviewRequest", params })) return; … }}
 */
export function requireAccount(returnTo?: ReturnTarget): boolean {
  const { status } = getSessionSnapshot();
  if (status === "signedIn") return true;
  if (returnTo) setPendingReturn(returnTo);
  if (!navigationRef.isReady()) return false;
  if (status === "signedOut") {
    applyGate();
  } else {
    navigationRef.dispatch(CommonActions.navigate("CreateAccount"));
  }
  return false;
}

/** Abre una ruta venida de un enlace o un aviso, respetando sesión, alta y permisos. Rutas desconocidas se ignoran. */
export function openTarget(target: ReturnTarget): void {
  const access = getRouteAccess(target.name);
  if (access === undefined) return;
  const session = getSessionSnapshot();

  if (session.status === "booting") {
    setPendingReturn(target);
    return;
  }
  if (!isRouteAllowed(access, session)) {
    if (access === "staff") return; // sin permisos: no se revela ni se redirige
    setPendingReturn(target);
    if (session.status === "signedOut") applyGate();
    else requireAccount();
    return;
  }
  const onboardingPending = session.status === "signedIn" && session.me !== null && getOnboardingRequirements(session.me).length > 0;
  if (onboardingPending || !navigationRef.isReady()) {
    setPendingReturn(target);
    if (onboardingPending) applyGate();
    return;
  }
  navigationRef.dispatch(CommonActions.navigate(target.name, target.params as object | undefined));
}

export type OnboardingOutcome = "done" | "incomplete" | "offline";

/**
 * Al terminar el alta (foto subida): relee `/me`. Si ya está completa, entra a MapHome (o a la ruta pendiente) y
 * devuelve `done`; si algo sigue faltando devuelve `incomplete` SIN mover la pila; si no pudo preguntar al servidor,
 * `offline`.
 */
export async function completeOnboarding(): Promise<OnboardingOutcome> {
  const me = await sessionService.refreshMe();
  if (!me) return "offline";
  const decision = decideGate({ session: getSessionSnapshot(), pending: peekPendingReturn(), accessOf: getRouteAccess });
  if (!decision || decision.reason === "onboarding_role" || decision.reason === "onboarding_photo") return "incomplete";
  applyGate();
  return "done";
}

/**
 * Abre `target` dejando una pila coherente (la de entrada de la sesión + la ruta). Pensado para la vista previa
 * y los escenarios de diseño; devuelve `false` si el navegador no está listo o la ruta no existe.
 */
export function resetToRoute(target: ReturnTarget): boolean {
  if (!navigationRef.isReady() || !hasRoute(target.name)) return false;
  resetStack(stackForTarget({ session: getSessionSnapshot(), pending: null, accessOf: getRouteAccess }, target));
  return true;
}
