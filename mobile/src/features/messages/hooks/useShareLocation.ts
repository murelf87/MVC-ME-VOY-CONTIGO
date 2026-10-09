/**
 * Compartir mi ubicación en el chat (hoja «Adjuntar»). Se hace SOLO cuando la persona lo pide, una vez, con el permiso de
 * ubicación en primer plano (nunca en segundo plano):
 *   1. pide el permiso del sistema si aún no lo tiene (la hoja ya ha explicado para qué);
 *   2. toma UNA posición (`getCurrentPosition`);
 *   3. la entrega a `onLocation`, que la envía como mensaje de ubicación.
 * Si algo falla, un aviso dice por qué en lenguaje llano; si el permiso está bloqueado, el aviso lleva «Abrir ajustes».
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatLocation } from "@/api/types";
import { getCurrentPosition, isGranted, openAppSettings, requestLocationPermission } from "@/platform";
import { showToast } from "@/ui";
import { messagesStrings } from "../strings";

const copy = messagesStrings.chat;

export interface ShareLocationController {
  /** Buscando la posición. */
  locating: boolean;
  /** Pide permiso, localiza y entrega la ubicación; devuelve `true` si se envió. */
  shareMyLocation(onLocation: (location: ChatLocation) => void): Promise<boolean>;
}

export function useShareLocation(): ShareLocationController {
  const [locating, setLocating] = useState(false);
  const mounted = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const shareMyLocation = useCallback(async (onLocation: (location: ChatLocation) => void): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true;
    setLocating(true);
    try {
      const permission = await requestLocationPermission();
      if (!isGranted(permission)) {
        const blocked = permission.status === "blocked";
        showToast({
          id: "chat-location",
          kind: "warning",
          message: blocked || permission.status === "unavailable" ? copy.locationFailed.permission_blocked : copy.locationFailed.permission_denied,
          ...(blocked ? { actionLabel: messagesStrings.common.seeSettings, onAction: () => void openAppSettings() } : {}),
        });
        return false;
      }
      const result = await getCurrentPosition({ timeoutMs: 8_000 });
      if (!result.ok) {
        const blocked = result.reason === "permission_blocked";
        showToast({
          id: "chat-location",
          kind: "warning",
          message: copy.locationFailed[result.reason],
          ...(blocked ? { actionLabel: messagesStrings.common.seeSettings, onAction: () => void openAppSettings() } : {}),
        });
        return false;
      }
      onLocation({ lat: result.position.latitude, lng: result.position.longitude, label: copy.locationLabel });
      return true;
    } finally {
      busy.current = false;
      if (mounted.current) setLocating(false);
    }
  }, []);

  return { locating, shareMyLocation };
}
