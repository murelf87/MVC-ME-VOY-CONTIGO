/**
 * Puerta de acceso común de las pantallas del panel (RBAC en pantalla): combina `GET /v1/admin/me` con el recurso que
 * necesita la pantalla y dice qué pintar:
 *
 *   checking → aún no se sabe quién eres                 (esqueleto)
 *   error    → no se pudo leer tu acceso                 (error con «Reintentar»)
 *   denied   → tu rol no incluye el recurso              («Sin permiso»)
 *   ready    → puedes ver la pantalla
 *
 * El servidor vuelve a comprobarlo en cada llamada: un 403 posterior se pinta como «Sin permiso» desde la propia lista.
 */
import { useCallback, useState } from "react";
import { useAppNavigation } from "@/navigation";
import { adminError, type AdminErrorView } from "../logic/errors";
import { useAdminMe, type AdminAccess } from "./useAdminMe";

export type GateState = "checking" | "error" | "denied" | "ready";

export interface AdminGate {
  access: AdminAccess;
  state: GateState;
  /** Solo si `state === "error"`. */
  error: AdminErrorView | null;
  retry: () => void;
  /** Hoja «Mi acceso al panel» (la abre el avatar de la cabecera). */
  sheetOpen: boolean;
  openSheet: () => void;
  closeSheet: () => void;
  goHome: () => void;
}

/** `canEnter` decide con los permisos si la pantalla es para este rol (p. ej. la 39 sirve a Finanzas y a Atención al cliente). */
export function useAdminGate(canEnter: (access: AdminAccess) => boolean): AdminGate {
  const access = useAdminMe();
  const navigation = useAppNavigation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const { query, me } = access;

  let state: GateState;
  let error: AdminErrorView | null = null;
  if (me === null) {
    if (query.isError || query.isOffline) {
      state = "error";
      error = adminError(query.error);
      // Un 403 de /me significa «no eres personal»: es «Sin permiso», no un fallo reintentable.
      if (error.kind === "forbidden") state = "denied";
    } else {
      state = "checking";
    }
  } else {
    state = canEnter(access) ? "ready" : "denied";
  }

  const retry = useCallback(() => {
    void query.refetch();
  }, [query]);
  const goHome = useCallback(() => {
    setSheetOpen(false);
    navigation.navigate("AdminHome");
  }, [navigation]);

  return {
    access,
    state,
    error,
    retry,
    sheetOpen,
    openSheet: () => setSheetOpen(true),
    closeSheet: () => setSheetOpen(false),
    goHome,
  };
}
