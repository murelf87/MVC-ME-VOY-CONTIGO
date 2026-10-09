/**
 * Almacén externo del estado de sesión: lo lee React con `useSyncExternalStore` y también cualquier código que
 * no sea un componente (helpers de navegación, deep links, notificaciones) mediante `getSessionSnapshot()`.
 */
import { initialSessionState, sessionReducer } from "./sessionReducer";
import type { SessionAction, SessionSnapshot, SessionState } from "./types";

export interface SessionStore {
  getState(): SessionState;
  dispatch(action: SessionAction): SessionState;
  subscribe(listener: () => void): () => void;
}

export function createSessionStore(initial: SessionState = initialSessionState): SessionStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch(action) {
      const next = sessionReducer(state, action);
      if (next !== state) {
        state = next;
        for (const listener of [...listeners]) listener();
      }
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Almacén único de la app. */
export const sessionStore: SessionStore = createSessionStore();

export function toSnapshot(state: SessionState): SessionSnapshot {
  return { status: state.status, me: state.me, activeRole: state.activeRole, epoch: state.epoch };
}

/** Instantánea de la sesión para código fuera de React (siempre la más reciente). */
export function getSessionSnapshot(): SessionSnapshot {
  return toSnapshot(sessionStore.getState());
}
