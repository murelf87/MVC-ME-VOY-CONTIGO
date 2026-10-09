/**
 * Registro de lugares de la provincia de Sevilla para semillas, vista previa y pruebas (municipios, barrios, hitos,
 * campus, hospitales). Coordenadas APROXIMADAS (±300 m): no sustituyen a un geocodificador ni a un servicio de rutas.
 * Los datos viven en `placesData.ts` (generado desde tools/preview/map/data/places.json).
 */
import { distanceMeters } from './geo';
import { SEVILLA_PLACES_DATA } from './placesData';
import type { MapPoint } from './types';

export type SevillaPlaceKind = 'municipio' | 'barrio' | 'landmark' | 'campus' | 'hospital' | 'estacion' | 'calle' | 'parque';

export type SevillaPlaceId = (typeof SEVILLA_PLACES_DATA)[number]['id'];

export interface SevillaPlace {
  id: SevillaPlaceId;
  name: string;
  kind: SevillaPlaceKind;
  /** Municipio al que pertenece (p. ej. «Dos Hermanas» para Montequinto). */
  municipio: string;
  lat: number;
  lng: number;
}

export const SEVILLA_PLACES: readonly SevillaPlace[] = SEVILLA_PLACES_DATA;

export const SEVILLA_PLACE_BY_ID = Object.fromEntries(SEVILLA_PLACES_DATA.map((p) => [p.id, p])) as Readonly<Record<SevillaPlaceId, SevillaPlace>>;

/** Lugar por identificador (el tipo garantiza que existe). */
export function sevillaPlace(id: SevillaPlaceId): SevillaPlace {
  return SEVILLA_PLACE_BY_ID[id];
}

/** Coordenada de un lugar como `MapPoint`. */
export function sevillaPoint(id: SevillaPlaceId): MapPoint {
  const p = SEVILLA_PLACE_BY_ID[id];
  return { lat: p.lat, lng: p.lng };
}

const normalize = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Busca por nombre sin distinguir mayúsculas ni tildes («nervion» → Nervión). Coincidencia exacta primero, después por prefijo. */
export function findSevillaPlace(name: string): SevillaPlace | undefined {
  const needle = normalize(name);
  if (!needle) return undefined;
  const exact = SEVILLA_PLACES.find((p) => normalize(p.name) === needle);
  if (exact) return exact;
  return SEVILLA_PLACES.find((p) => normalize(p.name).startsWith(needle));
}

/** Lugar más cercano a un punto (opcionalmente de ciertos tipos y a menos de `maxKm`). */
export function nearestSevillaPlace(point: MapPoint, options: { kinds?: readonly SevillaPlaceKind[]; maxKm?: number } = {}): SevillaPlace | undefined {
  const { kinds, maxKm = Infinity } = options;
  let best: SevillaPlace | undefined;
  let bestM = maxKm * 1000;
  for (const p of SEVILLA_PLACES) {
    if (kinds && !kinds.includes(p.kind)) continue;
    const d = distanceMeters(point, p);
    if (d <= bestM) {
      best = p;
      bestM = d;
    }
  }
  return best;
}
