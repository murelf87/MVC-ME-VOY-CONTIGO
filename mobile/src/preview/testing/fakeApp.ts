/**
 * Doble de la app (navegación + sesión) para probar el puente `window.__mvc` en Node. Imita lo que hacen
 * `sessionService` y la navegación reales en lo que al puente le importa:
 *
 *   signIn(token)  llama a `GET /me` con el token; un 401/403 lanza «AuthExpiredError» y NO deja la sesión abierta.
 *   signOut()      cierra la sesión local y, como el servicio real, envía `POST /v1/auth/logout` con el token ACTUAL.
 *   applyGate()    primera pantalla de esa sesión (Home con sesión, Welcome sin ella).
 */
import type { AppActiveRole, AppModules, AppRoute, AppRouteInfo, AppSessionStatus } from "../appBridge";
import type { PreviewRuntime } from "../runtime";
import { createApi } from "./harness";

export interface FakeApp extends AppModules {
  state: {
    status: AppSessionStatus;
    token: string | null;
    activeRole: AppActiveRole | null;
    navReady: boolean;
    history: AppRoute[];
  };
  /** Anotaciones de lo ocurrido, en orden (`signOut`, `signIn:<token>`, `logout:<estado>`…). */
  calls: string[];
  /** Termina el arranque de la sesión como lo hace `sessionService.boot()`. */
  boot(token?: string | null): Promise<void>;
}

export const FAKE_ROUTES = ["Welcome", "Home", "SearchResults", "TripDetail", "DriverHome", "AdminHome", "UiGallery"] as const;

export function createFakeApp(runtime: PreviewRuntime, routeNames: readonly string[] = FAKE_ROUTES): FakeApp {
  const api = createApi(runtime);
  const catalog: AppRouteInfo[] = routeNames.map((name) => ({ name, slice: "test" }));
  const app: FakeApp = {
    state: { status: "booting", token: null, activeRole: null, navReady: true, history: [] },
    calls: [],

    async boot(token = null) {
      if (token) {
        const me = await api("GET", "/me", { token });
        if (me.status === 200) {
          app.state.status = "signedIn";
          app.state.token = token;
          return;
        }
      }
      app.state.status = "signedOut";
      app.state.token = null;
    },

    isNavigationReady: () => app.state.navReady,
    currentRoute: () => app.state.history.at(-1) ?? null,
    routeCatalog: () => catalog,
    resetToRoute(target) {
      if (!app.state.navReady || !catalog.some((entry) => entry.name === target.name)) return false;
      app.state.history = [{ name: target.name, params: target.params }];
      return true;
    },
    applyGate() {
      app.state.history = [{ name: app.state.status === "signedIn" ? "Home" : "Welcome", params: undefined }];
    },
    goBack() {
      if (app.state.history.length > 1) app.state.history.pop();
    },

    session: {
      view: () => ({ status: app.state.status, token: app.state.token, activeRole: app.state.activeRole }),

      async signIn(token) {
        app.calls.push(`signIn:${token.slice(0, 18)}`);
        const me = await api("GET", "/me", { token });
        if (me.status === 401 || me.status === 403) {
          throw new Error("AuthExpiredError: La sesión ha caducado o ya no es válida");
        }
        app.state.status = "signedIn";
        app.state.token = token;
        app.state.activeRole = null;
      },

      async signOut() {
        if (app.state.status === "signedOut") return;
        const old = app.state.token;
        app.calls.push("signOut");
        app.state.status = "signedOut";
        app.state.token = null;
        app.state.activeRole = null;
        if (old) {
          const res = await api("POST", "/v1/auth/logout", { token: old }).catch(() => null);
          app.calls.push(`logout:${res ? res.status : "red"}`);
        }
      },

      setActiveRole(role) {
        if (app.state.status !== "signedIn") return false;
        app.state.activeRole = role;
        return true;
      },
    },
  };
  return app;
}
