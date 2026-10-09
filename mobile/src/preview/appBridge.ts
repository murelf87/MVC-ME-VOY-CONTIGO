/**
 * Puente con la app (navegación y sesión) para la vista previa. La app NO se importa aquí de forma estática: esos módulos
 * arrastran React Native y no existen en Node. `loadAppModules()` los carga con `require` la primera vez que se necesitan
 * (siempre dentro del bundle de la app, después de que App.tsx los haya evaluado); las pruebas inyectan un doble con la
 * misma forma (`AppModules`).
 */
import type { PreviewProfileId } from "./core/types";

export type AppSessionStatus = "booting" | "guest" | "signedOut" | "signedIn";
export type AppActiveRole = "passenger" | "driver";

export interface AppSessionView {
  status: AppSessionStatus;
  token: string | null;
  activeRole: AppActiveRole | null;
}

export interface AppRouteInfo {
  name: string;
  slice: string;
  screen?: string;
  title?: string;
  params?: Record<string, unknown> | null;
}

export interface AppRoute {
  name: string;
  params: Record<string, unknown> | undefined;
}

/** Lo mínimo que el puente necesita de la navegación y la sesión de la app. */
export interface AppModules {
  isNavigationReady(): boolean;
  currentRoute(): AppRoute | null;
  routeCatalog(): AppRouteInfo[];
  /** Abre `target` con una pila coherente. `false` si el navegador no está listo o la ruta no existe. */
  resetToRoute(target: { name: string; params?: Record<string, unknown> }): boolean;
  /** Recoloca la pila según la sesión (primera pantalla de esa sesión). */
  applyGate(): void;
  goBack(): void;
  session: {
    view(): AppSessionView;
    signIn(token: string): Promise<void>;
    signOut(): Promise<void>;
    setActiveRole(role: AppActiveRole): boolean;
  };
}

export type AppModulesLoader = () => AppModules | null;

let cached: AppModules | null = null;
let warned = false;

/** Carga (una vez) los módulos reales de la app. Devuelve `null` si aún no existen o si no hay app (Node). */
export function loadAppModules(): AppModules | null {
  if (cached) return cached;
  try {
    // `require` con literales: Metro los resuelve estáticamente (ya están en el bundle de la app).
    const nav = require("@/navigation/navigationRef") as typeof import("@/navigation/navigationRef");
    const registry = require("@/navigation/registry") as typeof import("@/navigation/registry");
    const actions = require("@/navigation/actions") as typeof import("@/navigation/actions");
    const session = require("@/session") as typeof import("@/session");
    cached = {
      isNavigationReady: () => nav.navigationRef.isReady(),
      currentRoute: () => nav.getCurrentRoute(),
      routeCatalog: () => registry.getRouteCatalog(),
      // Borde tipado: la ruta llega como texto desde un escenario; `resetToRoute` comprueba que exista.
      resetToRoute: (target) => actions.resetToRoute(target as Parameters<typeof actions.resetToRoute>[0]),
      applyGate: () => {
        actions.applyGate();
      },
      goBack: () => {
        if (nav.navigationRef.isReady() && nav.navigationRef.canGoBack()) nav.navigationRef.goBack();
      },
      session: {
        view: () => {
          const state = session.sessionStore.getState();
          return { status: state.status, token: state.token, activeRole: state.activeRole };
        },
        signIn: async (token) => {
          await session.sessionService.signIn({ token });
        },
        signOut: () => session.sessionService.signOut("user"),
        setActiveRole: (role) => session.sessionService.setActiveRole(role),
      },
    };
    return cached;
  } catch (error) {
    if (!warned && typeof console !== "undefined") {
      warned = true;
      console.warn("[mvc-preview] la navegación de la app aún no está disponible; el puente window.__mvc no estará listo.", error);
    }
    return null;
  }
}

/** Rol de la app con el que arranca cada perfil de prueba. */
export function activeRoleForProfile(profile: PreviewProfileId): AppActiveRole | null {
  if (profile === "passenger") return "passenger";
  if (profile === "driver") return "driver";
  return null;
}

export interface DesiredSession {
  token: string | null;
  activeRole: AppActiveRole | null;
}

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Espera a que `condition()` sea cierta. Rechaza con `message` si pasa el tiempo. */
export async function waitUntil(condition: () => boolean, message: string, options: WaitOptions = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const intervalMs = options.intervalMs ?? 40;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const deadline = now() + timeoutMs;
  while (!condition()) {
    if (now() >= deadline) throw new Error(message);
    await sleep(intervalMs);
  }
}

/**
 * Cierra la sesión de la app (si la hay). Hay que hacerlo ANTES de re-sembrar el backend en memoria: cerrar sesión envía
 * `POST /v1/auth/logout` con el token actual, y el token de un perfil de prueba es siempre el mismo (determinista), así
 * que, enviado después de re-sembrar, revocaría la sesión recién creada y `signIn` recibiría un 401.
 * El cierre vacía además los cachés de la app, para que no mezcle datos de dos sembrados.
 */
export async function signOutApp(app: AppModules, options: WaitOptions = {}): Promise<void> {
  await waitUntil(() => app.session.view().status !== "booting", "La app no terminó de arrancar la sesión.", options);
  const { status } = app.session.view();
  if (status === "signedIn" || status === "guest") await app.session.signOut();
}

/**
 * Abre la sesión del perfil en la app, DESPUÉS de re-sembrar el backend. Sin sesión deseada («Persona nueva») no hace
 * nada: la app ya está fuera (`signOutApp`).
 */
export async function signInProfile(app: AppModules, desired: DesiredSession): Promise<void> {
  if (desired.token === null) return;
  await app.session.signIn(desired.token);
  if (desired.activeRole) app.session.setActiveRole(desired.activeRole);
}
