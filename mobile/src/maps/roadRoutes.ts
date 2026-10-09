/**
 * Rutas ILUSTRATIVAS de la provincia de Sevilla (`SEVILLA_ROAD_ROUTES`): polilíneas que siguen los corredores reales
 * (A-4, A-49, A-376, SE-30, Av. de la Palmera…) tal y como están dibujados en el mapa ilustrativo de la vista previa. Sirven de
 * semilla para viajes de ejemplo, pruebas y capturas: la ruta pintada coincide con las carreteras del mapa base.
 *
 * ⚠ NO son datos de navegación: la geometría es un dibujo aproximado (±300 m en el centro, ±1 km en la periferia), y la
 * distancia/duración son estimaciones (autovía 80 km/h, avenida 45 km/h, calle 30 km/h). En producción las rutas las calcula el
 * backend (proveedor de rutas); esta tabla no debe presentarse como resultado de un servicio de rutas.
 *
 * Los datos están en `roadRoutesData.ts` (generado por `tools/preview/map/gen-road-routes.mjs`).
 */
import type { SevillaPlaceId } from './places';
import { SEVILLA_ROAD_ROUTES_DATA, type RoadRouteRecord, type SevillaRoadRouteId } from './roadRoutesData';
import type { MapPoint, MapRouteKind, MapRouteSpec } from './types';

export type { SevillaRoadRouteId } from './roadRoutesData';

export interface SevillaRoadRoute {
  readonly id: string;
  readonly name: string;
  readonly from: SevillaPlaceId;
  readonly to: SevillaPlaceId;
  /** Lugares intermedios por los que pasa (p. ej. Palomares del Río → Mairena del Aljarafe → centro). */
  readonly via: readonly SevillaPlaceId[];
  /** Vías principales del recorrido, en orden. */
  readonly roads: readonly string[];
  /** Distancia estimada en metros. */
  readonly distanceM: number;
  /** Duración estimada en segundos (sin tráfico). */
  readonly durationS: number;
  /** Polilínea codificada (Google polyline, 1e5) tal y como la guarda la tabla. */
  readonly polyline: string;
  /** Puntos de la polilínea, de `from` a `to`. */
  readonly points: readonly MapPoint[];
}

// ───────────────────────────── Polyline (Google, precisión 1e5) ─────────────────────────────

/** Decodifica una polilínea Google (precisión 1e5). Devuelve `[]` si la cadena está truncada o vacía. */
export function decodePolyline(encoded: string): MapPoint[] {
  const out: MapPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const read = (): number | null => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) return null;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    const dLat = read();
    const dLng = read();
    if (dLat === null || dLng === null) return [];
    lat += dLat;
    lng += dLng;
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}

const encodeNumber = (value: number): string => {
  let n = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (n >= 0x20) {
    out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
    n >>= 5;
  }
  return out + String.fromCharCode(n + 63);
};

/** Codifica puntos como polilínea Google (precisión 1e5). */
export function encodePolyline(points: readonly MapPoint[]): string {
  let prevLat = 0;
  let prevLng = 0;
  let out = '';
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    out += encodeNumber(lat - prevLat) + encodeNumber(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}

// ───────────────────────────── Registro ─────────────────────────────

function build(record: RoadRouteRecord): SevillaRoadRoute {
  return { ...record, points: decodePolyline(record.polyline) };
}

/** Rutas ilustrativas entre lugares de `SEVILLA_PLACES`. Cada una se puede usar también en sentido contrario (`roadRouteBetween`). */
export const SEVILLA_ROAD_ROUTES: readonly SevillaRoadRoute[] = SEVILLA_ROAD_ROUTES_DATA.map(build);

const BY_ID = new Map<string, SevillaRoadRoute>(SEVILLA_ROAD_ROUTES.map((r) => [r.id, r]));

/** Ruta por id (lanza si no existe: los ids son un tipo cerrado, `SevillaRoadRouteId`). */
export function sevillaRoadRoute(id: SevillaRoadRouteId): SevillaRoadRoute {
  const route = BY_ID.get(id);
  if (!route) throw new Error(`Ruta ilustrativa desconocida: ${id}`);
  return route;
}

/** Copia de la ruta en sentido contrario (`id` termina en «:inversa»). */
export function reverseRoadRoute(route: SevillaRoadRoute): SevillaRoadRoute {
  const reversedPoints = [...route.points].reverse();
  return {
    ...route,
    id: route.id.endsWith(':inversa') ? route.id.slice(0, -':inversa'.length) : `${route.id}:inversa`,
    name: route.name.split(' → ').reverse().join(' → '),
    from: route.to,
    to: route.from,
    via: [...route.via].reverse(),
    roads: [...route.roads].reverse(),
    polyline: encodePolyline(reversedPoints),
    points: reversedPoints,
  };
}

/**
 * Ruta entre dos lugares (en cualquier sentido), o `undefined` si no hay ninguna precalculada. Si solo existe la inversa se
 * devuelve invertida. Para pares sin ruta, el backend (o el proveedor de rutas de la vista previa) calcula una.
 */
export function roadRouteBetween(from: SevillaPlaceId, to: SevillaPlaceId): SevillaRoadRoute | undefined {
  const forward = SEVILLA_ROAD_ROUTES.find((r) => r.from === from && r.to === to);
  if (forward) return forward;
  const backward = SEVILLA_ROAD_ROUTES.find((r) => r.from === to && r.to === from);
  return backward ? reverseRoadRoute(backward) : undefined;
}

/** Rutas que salen o llegan a un lugar. */
export function roadRoutesAt(place: SevillaPlaceId): SevillaRoadRoute[] {
  return SEVILLA_ROAD_ROUTES.filter((r) => r.from === place || r.to === place || r.via.includes(place));
}

/** Coordenadas GeoJSON `[lng, lat]` (el formato de `geometry.coordinates` del backend). */
export function roadRouteLngLat(route: SevillaRoadRoute): [number, number][] {
  return route.points.map((p) => [p.lng, p.lat]);
}

/** Trazo listo para `MvcMap` (`routes`). */
export function roadRouteSpec(route: SevillaRoadRoute, kind: MapRouteKind = 'route', id: string = route.id): MapRouteSpec {
  return { id, kind, points: route.points };
}
