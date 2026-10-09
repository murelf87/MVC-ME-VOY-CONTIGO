/**
 * Encuadre inicial del mapa de inicio para cada provincia disponible (lógica pura).
 *
 * El contrato de `GET /v1/provinces` no trae centro ni límites de la provincia, así que la app conoce el encuadre de las
 * provincias que ya están en servicio (hoy solo Sevilla, código INE «41»). Para una provincia sin encuadre propio el mapa se
 * ajusta a los coches que haya (`null` aquí) en vez de enseñar otra provincia.
 */
import type { Province } from "@/api/types";
import { regionForZoom } from "@/maps/geo";
import type { MapRegion } from "@/maps/types";

/** Tamaño de mapa con el que se calcula el encuadre (el de la lámina 09: 393 × 419 pt). */
const REFERENCE_VIEWPORT = { width: 393, height: 419 } as const;

/** Sevilla y su área metropolitana (Aljarafe, Dos Hermanas, Camas): lo que enseña la lámina 09. */
const SEVILLA_VIEW: MapRegion = regionForZoom({ lat: 37.3775, lng: -6.0145 }, 11.34, REFERENCE_VIEWPORT);

const PROVINCE_VIEWS: Readonly<Record<string, MapRegion>> = {
  "41": SEVILLA_VIEW,
};

/** Encuadre mientras aún no se conoce la provincia: el de Sevilla, la primera en servicio. */
export const DEFAULT_PROVINCE_REGION: MapRegion = SEVILLA_VIEW;

/** Encuadre de la provincia, o `null` si la app aún no lo conoce (entonces se encuadran los coches). */
export function provinceRegion(province: Pick<Province, "code"> | null): MapRegion | null {
  if (province === null) return null;
  return PROVINCE_VIEWS[province.code] ?? null;
}
