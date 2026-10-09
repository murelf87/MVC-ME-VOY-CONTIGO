import { useCallback, useEffect, useRef, useState } from "react";
import { getDeviceId } from "@/platform";
import { useAuth } from "@/session";
import { deletePushToken, listPushTokens } from "../api";

const QUICK = { timeoutMs: 5000, retries: 0 } as const;
const MAX_PAGES = 5;

/**
 * Da de baja los tokens push de ESTE móvil (los de otros dispositivos de la persona no se tocan). Es de mejor
 * esfuerzo: sin Internet o con el servidor caído no impide cerrar sesión (el token deja de servir al revocar la sesión).
 * Devuelve cuántos tokens se dieron de baja.
 */
export async function deregisterThisDevicePushTokens(): Promise<number> {
  try {
    const deviceId = await getDeviceId();
    let cursor: string | null = null;
    let removed = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await listPushTokens({ limit: 50, cursor }, QUICK);
      const mine = result.items.filter((token) => token.deviceId === deviceId);
      const outcomes = await Promise.allSettled(mine.map((token) => deletePushToken(token.id, QUICK)));
      removed += outcomes.filter((outcome) => outcome.status === "fulfilled").length;
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    return removed;
  } catch {
    return 0;
  }
}

export interface UseSignOutResult {
  /** Cerrando sesión (baja del token push + cierre en el servidor + borrado del token local). */
  working: boolean;
  signOut(): Promise<void>;
}

/**
 * Cierre de sesión de «Ajustes»: baja el token push de este móvil mientras la sesión sigue siendo válida y después
 * `useAuth().signOut()`, que revoca la sesión en el servidor (`POST /v1/auth/logout`), borra el token guardado y
 * vacía las cachés. Al terminar, la navegación vuelve a Bienvenida sola.
 */
export function useSignOut(): UseSignOutResult {
  const { signOut: endSession, status } = useAuth();
  const [working, setWorking] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    setWorking(true);
    try {
      if (status === "signedIn") await deregisterThisDevicePushTokens();
      await endSession();
    } finally {
      if (mounted.current) setWorking(false);
    }
  }, [endSession, status]);

  return { working, signOut };
}
