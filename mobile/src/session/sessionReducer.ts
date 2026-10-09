/**
 * Reducer puro del estado de sesión (sin React). Todas las transiciones válidas viven aquí.
 *
 *   booting ──BOOTED──▶ signedOut | signedIn
 *   signedOut ──GUEST_STARTED──▶ guest
 *   (cualquiera) ──SIGNED_IN──▶ signedIn
 *   (cualquiera salvo signedOut) ──SIGNED_OUT──▶ signedOut
 *
 * `epoch` sube en BOOTED, GUEST_STARTED, SIGNED_IN y SIGNED_OUT (no en ME_LOADED / ACTIVE_ROLE_SET).
 */
import { resolveActiveRole } from "./selectors";
import type { SessionAction, SessionState } from "./types";

export const initialSessionState: SessionState = {
  status: "booting",
  token: null,
  me: null,
  activeRole: null,
  epoch: 0,
  signOutReason: null,
  meStale: false,
};

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "BOOTED": {
      if (state.status !== "booting") return state;
      if (!action.token) {
        return {
          ...initialSessionState,
          status: "signedOut",
          epoch: state.epoch + 1,
          signOutReason: action.reason ?? null,
        };
      }
      return {
        status: "signedIn",
        token: action.token,
        me: action.me,
        activeRole: action.me ? resolveActiveRole(action.me.roles, action.storedRole) : action.storedRole,
        epoch: state.epoch + 1,
        signOutReason: null,
        meStale: action.meStale ?? action.me === null,
      };
    }
    case "GUEST_STARTED": {
      if (state.status !== "signedOut") return state;
      return { ...initialSessionState, status: "guest", epoch: state.epoch + 1 };
    }
    case "SIGNED_IN": {
      // Válido desde cualquier estado: un inicio de sesión explícito prevalece sobre el arranque en curso
      // (y sustituye a la sesión anterior si el usuario cambia de cuenta).
      return {
        status: "signedIn",
        token: action.token,
        me: action.me,
        activeRole: action.me ? resolveActiveRole(action.me.roles, action.storedRole) : action.storedRole,
        epoch: state.epoch + 1,
        signOutReason: null,
        meStale: action.me === null,
      };
    }
    case "ME_LOADED": {
      // Una respuesta tardía de una sesión anterior no debe pisar la actual.
      if (state.status !== "signedIn" || state.token !== action.token) return state;
      return {
        ...state,
        me: action.me,
        activeRole: resolveActiveRole(action.me.roles, state.activeRole),
        meStale: false,
      };
    }
    case "ME_FAILED": {
      if (state.status !== "signedIn" || state.token !== action.token) return state;
      return { ...state, meStale: true };
    }
    case "ACTIVE_ROLE_SET": {
      if (state.status !== "signedIn" || !state.me) return state;
      if (resolveActiveRole(state.me.roles, action.role) !== action.role) return state;
      if (state.activeRole === action.role) return state;
      return { ...state, activeRole: action.role };
    }
    case "SIGNED_OUT": {
      if (state.status === "signedOut") return state;
      return {
        ...initialSessionState,
        status: "signedOut",
        epoch: state.epoch + 1,
        signOutReason: action.reason,
      };
    }
    default:
      return state;
  }
}
