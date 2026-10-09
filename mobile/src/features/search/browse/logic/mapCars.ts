/**
 * Mapa de coches (09): filtros, marcadores y agrupación (lógica pura, sin React ni red).
 *
 * Reglas de producto que se cumplen aquí:
 *  - Las posiciones que llegan de `GET /v1/trips/map` son SIEMPRE aproximadas (cuadrícula de 0,01°): nunca se «afinan»,
 *    solo se dibujan y se agrupan.
 *  - Un coche completo se dibuja en gris («Completo»); un coche en marcha cuya última posición está caducada no se
 *    presenta como «en directo».
 *  - El mapa no agrupa por sí solo: los coches que quedan a menos de `CLUSTER_RADIUS_PX` en pantalla se agrupan en un
 *    clúster con su número (al acercar, se separan).
 */
import type { MapCar, MapCarsQuery, TripCategory } from "@/api/types";
import { mercatorX, mercatorY } from "@/maps/geo";
import type { CarMarker, ClusterMarker, MapMarkerSpec, MapPoint } from "@/maps/types";
import { formatTime } from "@/i18n";
import { browseStrings } from "../strings";

const copy = browseStrings.mapHome;

// ── Filtros ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface MapFilter {
  /** «Solo con plazas libres»: oculta los coches completos. */
  onlyWithSeats: boolean;
  /** Salen en las próximas N horas (el servidor admite 1–48). */
  withinHours: number;
  category: TripCategory | null;
}

export const DEFAULT_WITHIN_HOURS = 12;
export const WITHIN_HOURS_OPTIONS: readonly number[] = [3, 6, 12, 24, 48];
export const DEFAULT_MAP_FILTER: MapFilter = { onlyWithSeats: false, withinHours: DEFAULT_WITHIN_HOURS, category: null };
/** Máximo que admite el servidor en una petición del mapa. */
export const MAP_CAR_LIMIT = 200;

export function toMapQuery(provinceId: string, filter: MapFilter): MapCarsQuery {
  const query: MapCarsQuery = {
    provinceId,
    onlyWithSeats: filter.onlyWithSeats,
    withinHours: filter.withinHours,
    limit: MAP_CAR_LIMIT,
  };
  if (filter.category !== null) query.category = filter.category;
  return query;
}

/** Texto del botón de filtro: «Con plazas» (por defecto) o «Solo con plazas». */
export function filterLabel(filter: MapFilter): string {
  return filter.onlyWithSeats ? copy.filterSeatsOnly : copy.filterSeats;
}

/** ¿Hay algo cambiado respecto al estado por defecto (sin contar la categoría, que tiene sus propios chips)? */
export function hasFilterChanges(filter: MapFilter): boolean {
  return filter.onlyWithSeats || filter.withinHours !== DEFAULT_WITHIN_HOURS;
}

/** ¿Algún filtro limita lo que se ve (incluida la categoría)? */
export function hasAnyFilter(filter: MapFilter): boolean {
  return hasFilterChanges(filter) || filter.category !== null;
}

/** Alterna la categoría: pulsar la elegida la quita. */
export function toggleCategory(current: TripCategory | null, picked: TripCategory): TripCategory | null {
  return current === picked ? null : picked;
}

// ── Textos de un coche ──────────────────────────────────────────────────────────────────────────────────────────────

export function seatsText(car: Pick<MapCar, "seatsAvailable" | "full">): string {
  return copy.carPanel.seats(car.full ? 0 : car.seatsAvailable);
}

export function carRouteText(car: Pick<MapCar, "originLabel" | "destinationLabel">): string {
  return copy.carPanel.route(car.originLabel, car.destinationLabel);
}

/** «Sale a las 08:05» · «Salió a las 07:40» (ya en marcha o pasada la hora). */
export function departureText(car: Pick<MapCar, "departureAt" | "state">, nowMs: number): string {
  const at = Date.parse(car.departureAt);
  const time = formatTime(car.departureAt);
  if (car.state === "live" || (Number.isFinite(at) && at < nowMs)) return copy.carPanel.departedAt(time);
  return copy.carPanel.departsAt(time);
}

/** Estado de la posición: en marcha y reciente, en marcha con la señal caducada, o aún sin salir (`null`). */
export function positionNote(car: Pick<MapCar, "state" | "position">): "live" | "stale" | null {
  if (car.state !== "live") return null;
  return car.position.source === "live_gps" && !car.position.stale ? "live" : "stale";
}

// ── Marcadores ──────────────────────────────────────────────────────────────────────────────────────────────────────

const CAR_PREFIX = "car:";
const GROUP_PREFIX = "group:";

export function carMarkerId(tripId: string): string {
  return `${CAR_PREFIX}${tripId}`;
}

export function carMarker(car: MapCar): CarMarker {
  const seats = car.full ? 0 : car.seatsAvailable;
  return {
    id: carMarkerId(car.tripId),
    kind: "car",
    position: { lat: car.position.lat, lng: car.position.lng },
    seats,
    full: car.full,
    accessibilityLabel: copy.markerA11y(carRouteText(car), seatsText(car)),
  };
}

// ── Agrupación por cercanía en pantalla ─────────────────────────────────────────────────────────────────────────────

/** Distancia en pantalla (pt) bajo la cual dos coches se agrupan: pin (40) + parte de la etiqueta de plazas. */
export const CLUSTER_RADIUS_PX = 60;
/** A partir de este zoom ya no se agrupa por cercanía (solo los coches en la MISMA posición siguen juntos). */
export const CLUSTER_MAX_ZOOM = 14;
const TILE = 256;

export interface CarGroup {
  /** `car:<tripId>` si es un solo coche; `group:<tripId del primero>` si son varios. */
  id: string;
  cars: MapCar[];
  /** Centro del grupo (media de las posiciones aproximadas de sus coches). */
  center: MapPoint;
  /** `true` si todos los coches comparten exactamente la misma posición: acercar el mapa no los separa. */
  samePosition: boolean;
}

function project(point: MapPoint, zoom: number): { x: number; y: number } {
  const world = TILE * 2 ** zoom;
  return { x: mercatorX(point.lng) * world, y: mercatorY(point.lat) * world };
}

function byDepartureThenId(a: MapCar, b: MapCar): number {
  return a.departureAt.localeCompare(b.departureAt) || a.tripId.localeCompare(b.tripId);
}

/**
 * Agrupa los coches que quedan a menos de `radiusPx` en pantalla al zoom dado. Determinista: el resultado depende solo de
 * los coches y del zoom, no del orden en que lleguen. Por encima de `CLUSTER_MAX_ZOOM` solo se juntan los de la misma posición.
 */
export function groupCars(cars: readonly MapCar[], zoom: number, radiusPx: number = CLUSTER_RADIUS_PX): CarGroup[] {
  const effectiveRadius = zoom >= CLUSTER_MAX_ZOOM ? 0.5 : radiusPx;
  const sorted = [...cars].sort(byDepartureThenId);
  interface Bucket {
    cars: MapCar[];
    sumX: number;
    sumY: number;
  }
  const buckets: Bucket[] = [];
  for (const car of sorted) {
    const p = project(car.position, zoom);
    let target: Bucket | null = null;
    let best = Infinity;
    for (const bucket of buckets) {
      const dx = bucket.sumX / bucket.cars.length - p.x;
      const dy = bucket.sumY / bucket.cars.length - p.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= effectiveRadius && distance < best) {
        best = distance;
        target = bucket;
      }
    }
    if (target === null) buckets.push({ cars: [car], sumX: p.x, sumY: p.y });
    else {
      target.cars.push(car);
      target.sumX += p.x;
      target.sumY += p.y;
    }
  }
  return buckets.map((bucket) => {
    const first = bucket.cars[0] as MapCar;
    const lat = bucket.cars.reduce((sum, car) => sum + car.position.lat, 0) / bucket.cars.length;
    const lng = bucket.cars.reduce((sum, car) => sum + car.position.lng, 0) / bucket.cars.length;
    const samePosition = bucket.cars.every((car) => car.position.lat === first.position.lat && car.position.lng === first.position.lng);
    return {
      id: bucket.cars.length === 1 ? carMarkerId(first.tripId) : `${GROUP_PREFIX}${first.tripId}`,
      cars: bucket.cars,
      center: { lat, lng },
      samePosition,
    };
  });
}

function clusterMarker(group: CarGroup): ClusterMarker {
  return {
    id: group.id,
    kind: "cluster",
    position: group.center,
    count: group.cars.length,
    accessibilityLabel: copy.clusterA11y(group.cars.length),
  };
}

/** Marcadores de los grupos: coche suelto o clúster con su número. */
export function groupMarkers(groups: readonly CarGroup[]): MapMarkerSpec[] {
  return groups.map((group) => (group.cars.length === 1 ? carMarker(group.cars[0] as MapCar) : clusterMarker(group)));
}

export function findGroup(groups: readonly CarGroup[], markerId: string | null): CarGroup | null {
  if (markerId === null) return null;
  return groups.find((group) => group.id === markerId) ?? null;
}

/**
 * ¿Qué hacer al tocar un grupo? Un coche suelto, o un clúster que no se puede separar acercando el mapa, abre el panel con
 * la lista; si no, se acerca el mapa para que se separen.
 */
export function groupTapAction(group: CarGroup, zoom: number): "open" | "zoom" {
  if (group.cars.length === 1) return "open";
  if (group.samePosition || zoom >= CLUSTER_MAX_ZOOM) return "open";
  return "zoom";
}

/** Zoom al que acercar el mapa al tocar un clúster: dos niveles más, sin pasar del máximo de agrupación. */
export function zoomTargetForCluster(zoom: number): number {
  return Math.min(CLUSTER_MAX_ZOOM, zoom + 2);
}

/** Coches del grupo ordenados para la lista: primero los que tienen plazas, después por hora de salida. */
export function sortedForPanel(cars: readonly MapCar[]): MapCar[] {
  return [...cars].sort((a, b) => Number(a.full) - Number(b.full) || byDepartureThenId(a, b));
}

/** Resumen de plazas libres de toda la lista (para describir el mapa a lectores de pantalla). */
export function carsSummary(cars: readonly MapCar[]): { cars: number; withSeats: number; seats: number } {
  let withSeats = 0;
  let seats = 0;
  for (const car of cars) {
    if (!car.full && car.seatsAvailable > 0) {
      withSeats += 1;
      seats += car.seatsAvailable;
    }
  }
  return { cars: cars.length, withSeats, seats };
}
