/**
 * Ubicación del móvil para las pantallas de exploración (mapa de inicio y «Define tu recorrido»).
 *
 *  - `request()` es la ÚNICA vía que muestra el diálogo del sistema: la pantalla explica antes para qué se usa y solo
 *    entonces lo llama (al pulsar «Centrar en mi ubicación» o «Usar mi ubicación»).
 *  - Nunca lanza ni bloquea: los problemas quedan en `status` (denegado, bloqueado, GPS apagado, sin señal) y la pantalla
 *    ofrece siempre una salida (permitir, ajustes, reintentar o seguir sin ubicación).
 *  - La posición se pide en primer plano y solo se guarda en memoria mientras la pantalla está abierta; no se envía a
 *    ningún servidor desde aquí.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  canRequest,
  getCurrentPosition,
  getLocationPermission,
  isGranted,
  openAppSettings,
  requestLocationPermission,
  type DevicePosition,
} from "@/platform";
import { statusForFailure, statusForPermission, type LocateStatus } from "../logic/locate";

export interface UseDeviceLocationResult {
  status: LocateStatus;
  /** Última posición leída (`null` mientras no haya ninguna). */
  position: DevicePosition | null;
  /** `true` mientras se pide el permiso o se lee el GPS. */
  isLocating: boolean;
  /** Pide el permiso si hace falta y lee el GPS. Devuelve la posición, o `null` (el motivo queda en `status`). */
  request(): Promise<DevicePosition | null>;
  /** Abre los ajustes del móvil (permiso bloqueado). */
  openSettings(): void;
  /** Olvida el problema mostrado. */
  dismiss(): void;
}

export function useDeviceLocation(): UseDeviceLocationResult {
  const [status, setStatus] = useState<LocateStatus>("idle");
  const [position, setPosition] = useState<DevicePosition | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const request = useCallback(async (): Promise<DevicePosition | null> => {
    if (busy.current) return null;
    busy.current = true;
    if (alive.current) setStatus("locating");
    try {
      let permission = await getLocationPermission();
      if (!isGranted(permission) && canRequest(permission)) {
        permission = await requestLocationPermission();
      }
      if (!isGranted(permission)) {
        if (alive.current) setStatus(statusForPermission(permission.status));
        return null;
      }
      const reading = await getCurrentPosition();
      if (!reading.ok) {
        if (alive.current) setStatus(statusForFailure(reading.reason));
        return null;
      }
      if (alive.current) {
        setPosition(reading.position);
        setStatus("idle");
      }
      return reading.position;
    } finally {
      busy.current = false;
    }
  }, []);

  const openSettings = useCallback(() => {
    void openAppSettings();
  }, []);
  const dismiss = useCallback(() => setStatus("idle"), []);

  return { status, position, isLocating: status === "locating", request, openSettings, dismiss };
}
