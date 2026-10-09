/**
 * «Usar mi ubicación»: pide el permiso (con la explicación previa en la propia pantalla), lee el GPS y devuelve un
 * lugar listo para el buscador. Intenta ponerle el nombre del municipio con la geocodificación inversa (sesión opcional:
 * también un invitado); sin conexión, con el servicio de mapas caído o con el límite de frecuencia del invitado agotado,
 * el lugar se llama «Mi ubicación» (las coordenadas son siempre las del GPS).
 *
 * Nunca lanza ni bloquea: los problemas quedan en `status` (denegado, bloqueado, GPS apagado, sin señal) y la
 * pantalla ofrece siempre una salida (permitir, ajustes, reintentar o escribir el municipio).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DevicePosition } from "@/platform";
import type { PlaceParam } from "../../routes";
import { reversePlace } from "../api";
import { describeAddress } from "../logic/places";
import { pickMunicipalityResult, type LocateStatus } from "../logic/locate";
import { browseStrings } from "../strings";
import { useDeviceLocation } from "./useDeviceLocation";

export interface UseMyLocationPlaceResult {
  status: LocateStatus;
  /** `true` mientras se pide el permiso, se lee el GPS o se busca el municipio. */
  isLocating: boolean;
  /** Devuelve el lugar o `null` si no se pudo (el motivo queda en `status`). */
  locate(): Promise<PlaceParam | null>;
  /** Abre los ajustes del móvil (permiso bloqueado). */
  openSettings(): void;
  /** Olvida el problema mostrado. */
  dismiss(): void;
}

async function labelFor(position: DevicePosition): Promise<string> {
  try {
    const results = await reversePlace({ latitude: position.latitude, longitude: position.longitude });
    const picked = pickMunicipalityResult(results);
    if (picked !== null) {
      const title = describeAddress(picked.formattedAddress).title;
      if (title.length > 0) return title;
    }
  } catch {
    // sin red o sin servicio de mapas: la ubicación sigue siendo válida
  }
  return browseStrings.place.myLocationLabel;
}

export function useMyLocationPlace(): UseMyLocationPlaceResult {
  const device = useDeviceLocation();
  const { request } = device;
  /** Entre la lectura del GPS y el nombre del municipio la pantalla sigue «buscando». */
  const [naming, setNaming] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const locate = useCallback(async (): Promise<PlaceParam | null> => {
    const position = await request();
    if (position === null) return null;
    if (alive.current) setNaming(true);
    try {
      const label = await labelFor(position);
      return { label, latitude: position.latitude, longitude: position.longitude };
    } finally {
      if (alive.current) setNaming(false);
    }
  }, [request]);

  return {
    status: device.status,
    isLocating: device.isLocating || naming,
    locate,
    openSettings: device.openSettings,
    dismiss: device.dismiss,
  };
}
