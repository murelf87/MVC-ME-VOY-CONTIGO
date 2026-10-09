/**
 * «Adónde volver» tras crear la cuenta o iniciar sesión. Lo fija `requireAccount(returnTo)` (un invitado pulsa
 * «Solicitar plaza») o un enlace profundo recibido sin sesión; lo consume la navegación en cuanto la persona
 * termina el alta y puede entrar a esa ruta. Caduca a los 30 minutos y vive solo en memoria.
 */
import type { AppParamList, AppRouteName } from "./types";

/** Una ruta con SUS parámetros: `{ name: "TripDetail", params: { tripId } }`. */
export type ReturnTarget = {
  [Name in AppRouteName]: { name: Name; params?: AppParamList[Name] };
}[AppRouteName];

export const RETURN_TARGET_TTL_MS = 30 * 60_000;

let pending: { target: ReturnTarget; at: number } | null = null;

export function setPendingReturn(target: ReturnTarget, now: number = Date.now()): void {
  pending = { target, at: now };
}

/** Consulta sin consumir. Devuelve `null` si no hay o ya caducó. */
export function peekPendingReturn(now: number = Date.now()): ReturnTarget | null {
  if (!pending) return null;
  if (now - pending.at > RETURN_TARGET_TTL_MS) {
    pending = null;
    return null;
  }
  return pending.target;
}

/** Consulta y olvida. */
export function takePendingReturn(now: number = Date.now()): ReturnTarget | null {
  const target = peekPendingReturn(now);
  pending = null;
  return target;
}

export function clearPendingReturn(): void {
  pending = null;
}
