/**
 * «Usar mi ubicación» como punto de partida (pantalla 13 sin origen): pide el permiso (la pantalla ya explicó para qué),
 * lee el GPS y devuelve un lugar. Nunca lanza: los problemas quedan en `status` y la pantalla ofrece siempre una salida
 * (permitir, ajustes, reintentar o buscar el lugar a mano). La posición no se envía a ningún sitio desde aquí.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  canRequest,
  getCurrentPosition,
  getLocationPermission,
  isGranted,
  openAppSettings,
  requestLocationPermission,
  type LocationFailure,
  type PermissionStatus,
} from "@/platform";
import type { PlaceParam } from "../../routes";
import { requestStrings } from "../strings";
import type { OriginStatus } from "../types";

export type { OriginStatus };

function statusForFailure(reason: LocationFailure): OriginStatus {
  switch (reason) {
    case "permission_denied":
      return "denied";
    case "permission_blocked":
      return "blocked";
    case "services_disabled":
      return "off";
    default:
      return "unavailable";
  }
}

function statusForPermission(status: PermissionStatus): OriginStatus {
  if (status === "blocked") return "blocked";
  return status === "unavailable" ? "unavailable" : "denied";
}

export interface UseOriginPlaceResult {
  status: OriginStatus;
  isLocating: boolean;
  /** Devuelve el lugar o `null` si no se pudo (el motivo queda en `status`). */
  locate(): Promise<PlaceParam | null>;
  openSettings(): void;
  dismiss(): void;
}

export function useOriginPlace(): UseOriginPlaceResult {
  const [status, setStatus] = useState<OriginStatus>("idle");
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const locate = useCallback(async (): Promise<PlaceParam | null> => {
    if (busy.current) return null;
    busy.current = true;
    if (alive.current) setStatus("locating");
    try {
      let permission = await getLocationPermission();
      if (!isGranted(permission) && canRequest(permission)) permission = await requestLocationPermission();
      if (!isGranted(permission)) {
        if (alive.current) setStatus(statusForPermission(permission.status));
        return null;
      }
      const reading = await getCurrentPosition();
      if (!reading.ok) {
        if (alive.current) setStatus(statusForFailure(reading.reason));
        return null;
      }
      if (alive.current) setStatus("idle");
      return { label: requestStrings.pickup.myLocation, latitude: reading.position.latitude, longitude: reading.position.longitude };
    } finally {
      busy.current = false;
    }
  }, []);

  const openSettings = useCallback(() => {
    void openAppSettings();
  }, []);
  const dismiss = useCallback(() => setStatus("idle"), []);

  return { status, isLocating: status === "locating", locate, openSettings, dismiss };
}
