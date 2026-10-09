/**
 * «Centrar en mi ubicación» del mapa de inicio.
 *
 * Pide el permiso (la propia pulsación del botón es la petición explícita), lee el GPS y comprueba en qué provincia está la
 * persona:
 *  - dentro de una provincia disponible: el mapa se centra en ella y, si no es la activa, pasa a ser la activa;
 *  - fuera de todas: NO se mueve el mapa (no hay coches allí) y se explica con un aviso que se puede cerrar;
 *  - si no se pudo comprobar (sin red): se centra igualmente, la ubicación es válida.
 *
 * Nunca lanza. El punto azul solo existe tras una lectura pedida por la persona; no se lee el GPS al abrir la pantalla.
 */
import { useCallback, useState } from "react";
import type { MapPoint } from "@/maps/types";
import type { DevicePosition } from "@/platform";
import { checkPlaceProvince } from "../api";
import type { LocateStatus } from "../logic/locate";
import { useDeviceLocation } from "./useDeviceLocation";
import { useProvinces } from "./useProvinces";

export interface UseMapLocationResult {
  position: DevicePosition | null;
  status: LocateStatus;
  isLocating: boolean;
  /** `true` si la última ubicación leída está fuera de todas las provincias disponibles. */
  outsideProvince: boolean;
  /** Lee la ubicación. Devuelve el punto al que centrar el mapa, o `null` si no hay que moverlo (el motivo queda en el estado). */
  locate(): Promise<{ point: MapPoint; provinceChanged: boolean } | null>;
  openSettings(): void;
  dismissProblem(): void;
  dismissOutside(): void;
}

export function useMapLocation(): UseMapLocationResult {
  const device = useDeviceLocation();
  const { province, select } = useProvinces();
  const [outsideProvince, setOutsideProvince] = useState(false);
  const { request, dismiss } = device;
  const activeId = province?.id ?? null;

  const locate = useCallback(async () => {
    setOutsideProvince(false);
    const position = await request();
    if (position === null) return null;
    const point: MapPoint = { lat: position.latitude, lng: position.longitude };
    const verdict = await checkPlaceProvince({ latitude: position.latitude, longitude: position.longitude });
    if (verdict.ok) {
      const provinceChanged = verdict.province.id !== activeId;
      if (provinceChanged) select(verdict.province.id);
      return { point, provinceChanged };
    }
    if (verdict.reason === "outside") {
      setOutsideProvince(true);
      return null;
    }
    return { point, provinceChanged: false };
  }, [request, activeId, select]);

  const dismissOutside = useCallback(() => setOutsideProvince(false), []);

  return {
    position: device.position,
    status: device.status,
    isLocating: device.isLocating,
    outsideProvince,
    locate,
    openSettings: device.openSettings,
    dismissProblem: dismiss,
    dismissOutside,
  };
}
