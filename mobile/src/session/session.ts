/**
 * Instancia única del servicio de sesión, con sus dependencias reales (red, almacén seguro, token compartido).
 * Los componentes usan `useAuth()`; el código que no es un componente (navegación, deep links, notificaciones)
 * puede usar `sessionService` y `getSessionSnapshot()` directamente.
 */
import { emitSessionCleared, setAccessToken } from "@/api/runtime";
import { getMe } from "@/api/endpoints/me";
import { logoutSession } from "@/api/endpoints/auth";
import { createSessionService } from "./sessionService";
import { sessionStore } from "./sessionStore";
import { sessionStorage } from "./storage";

export const sessionService = createSessionService({
  store: sessionStore,
  storage: sessionStorage,
  api: {
    getMe: (options) => getMe(options),
    logout: (token) => logoutSession(token),
  },
  setAccessToken,
  onSessionCleared: emitSessionCleared,
});
