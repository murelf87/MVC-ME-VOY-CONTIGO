/**
 * Lógica pura de «Punto de recogida» (13): propuestas del servidor → tarjetas y mapa. No decide nada de negocio: el
 * servidor ordena, recomienda y calcula minutos a pie y desvío; aquí solo se da forma y se compone el mapa
 * (ruta del conductor hasta el punto elegido, trayecto a pie y las etiquetas «A 6 km de tu destino» / «4 min»).
 */
import type { PickupProposal } from "@/api/types";
import { distanceMeters, pointAlong, polylineLengthMeters } from "@/maps/geo";
import type { MapMarkerSpec, MapPoint, MapRouteSpec } from "@/maps/types";
import { requestStrings } from "../strings";
import type { OriginStatus, PickupSummary } from "../types";

const copy = requestStrings.pickup;

/** El diseño enseña dos propuestas (A y B). Se piden dos al servidor; si llegaran más se ignoran. */
export const MAX_PROPOSALS = 2;
/** Por debajo de esta distancia el trayecto a pie no se dibuja (el punto está donde estás). */
export const MIN_WALK_PATH_M = 40;

export interface ProposalView {
  id: string;
  code: string;
  title: string;
  subtitle: string | null;
  walkMinutes: number;
  detourMinutes: number;
  /** «4 min a pie · Desvío +2 min» (lectores de pantalla y pruebas). */
  detailLine: string;
  recommended: boolean;
  boardsAtLocal: string;
  location: MapPoint;
  distanceToDropoffM: number;
}

export function toProposalViews(proposals: readonly PickupProposal[]): ProposalView[] {
  return proposals.slice(0, MAX_PROPOSALS).map((p) => {
    const name = p.name !== null && p.name.trim() !== "" ? p.name.trim() : null;
    const address = p.address !== null && p.address.trim() !== "" ? p.address.trim() : null;
    const title = name ?? address ?? copy.unnamed;
    const subtitle = name !== null && address !== null && address !== name ? address : null;
    return {
      id: p.id,
      code: p.code,
      title,
      subtitle,
      walkMinutes: p.walk.minutes,
      detourMinutes: p.detour.minutes,
      detailLine: copy.detailLine(p.walk.minutes, p.detour.minutes),
      recommended: p.recommended,
      boardsAtLocal: p.boardsAtLocal,
      location: { lat: p.location.lat, lng: p.location.lng },
      distanceToDropoffM: p.distanceToDropoffM,
    };
  });
}

/** Selección inicial: el punto ya elegido antes si sigue propuesto; si no, el recomendado; si no, el primero. */
export function initialSelection(views: readonly ProposalView[], preferredId: string | null | undefined): string | null {
  if (preferredId !== null && preferredId !== undefined && views.some((v) => v.id === preferredId)) return preferredId;
  return views.find((v) => v.recommended)?.id ?? views[0]?.id ?? null;
}

export function summaryOf(view: ProposalView): PickupSummary {
  return { code: view.code, name: view.title, address: view.subtitle, walkMinutes: view.walkMinutes, detourMinutes: view.detourMinutes };
}

export function proposalA11y(view: ProposalView, selected: boolean): string {
  const parts = [copy.proposalLabel(view.code), view.title];
  if (view.subtitle !== null) parts.push(view.subtitle);
  parts.push(view.detailLine);
  if (view.recommended) parts.push(copy.recommended);
  if (selected) parts.push(copy.selectedHint);
  return parts.join(". ");
}

// ── Mapa ────────────────────────────────────────────────────────────────────────────────────────────────────────

type LngLat = readonly [number, number];

const toPoint = (c: LngLat): MapPoint => ({ lat: c[1], lng: c[0] });

/**
 * Tramo de la ruta del conductor desde su salida hasta `target`: los vértices anteriores, el punto de la ruta más
 * cercano a `target` y `target` exacto como último vértice (así la línea acaba justo en el pin).
 */
export function routeUntil(geometry: readonly LngLat[], target: MapPoint): MapPoint[] {
  if (geometry.length < 2) return geometry.length === 1 ? [toPoint(geometry[0] as LngLat), target] : [target];
  const mY = 111_195;
  const mX = 111_195 * Math.cos((target.lat * Math.PI) / 180);
  let best = { index: 1, t: 0, dist: Number.POSITIVE_INFINITY, point: toPoint(geometry[0] as LngLat) };
  for (let i = 1; i < geometry.length; i += 1) {
    const a = geometry[i - 1] as LngLat;
    const b = geometry[i] as LngLat;
    const ax = (a[0] - target.lng) * mX;
    const ay = (a[1] - target.lat) * mY;
    const bx = (b[0] - target.lng) * mX;
    const by = (b[1] - target.lat) * mY;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const dist = Math.hypot(px, py);
    if (dist < best.dist) best = { index: i, t, dist, point: { lat: target.lat + py / mY, lng: target.lng + px / mX } };
  }
  const points = geometry.slice(0, best.index).map(toPoint);
  points.push(best.point);
  if (distanceMeters(best.point, target) > 2) points.push(target);
  else points[points.length - 1] = target;
  return points;
}

/** Desplaza un punto hacia el este (para colocar una etiqueta junto a una línea). */
export function shiftEast(point: MapPoint, meters: number): MapPoint {
  return { lat: point.lat, lng: point.lng + meters / (111_195 * Math.cos((point.lat * Math.PI) / 180)) };
}

export interface PickupMapInput {
  /** Geometría del viaje [lng, lat] (primer punto = salida del coche). */
  geometry: readonly LngLat[];
  views: readonly ProposalView[];
  selectedId: string | null;
  /** Punto de partida de la persona (para el trayecto a pie). */
  origin: MapPoint | null;
  /** Separación (m) hacia el este de las etiquetas respecto a sus líneas. */
  routeChipOffsetM?: number;
  walkChipOffsetM?: number;
}

export interface PickupMapModel {
  markers: MapMarkerSpec[];
  routes: MapRouteSpec[];
  /** Puntos que el mapa debe encuadrar. */
  focus: MapPoint[];
}

export function buildPickupMap(input: PickupMapInput): PickupMapModel {
  const { geometry, views, selectedId, origin } = input;
  const markers: MapMarkerSpec[] = [];
  const routes: MapRouteSpec[] = [];
  const focus: MapPoint[] = [];
  const selected = views.find((v) => v.id === selectedId) ?? null;

  const start = geometry[0] !== undefined ? toPoint(geometry[0]) : null;
  if (start !== null) {
    markers.push({ id: "car", kind: "car", variant: "live", position: start, accessibilityLabel: "Salida del coche del conductor" });
    focus.push(start);
  }

  views.forEach((view, index) => {
    const isSelected = view.id === selectedId;
    markers.push({
      id: `pickup-${view.code}`,
      kind: index === 0 ? "pickupA" : "pickupB",
      position: view.location,
      selected: isSelected,
      accessibilityLabel: `${copy.proposalLabel(view.code)}: ${view.title}`,
    });
    focus.push(view.location);
  });

  if (selected !== null && geometry.length > 0) {
    const points = routeUntil(geometry, selected.location);
    if (points.length >= 2) {
      routes.push({ id: "route", kind: "route", points });
      const middle = pointAlong(points, polylineLengthMeters(points) / 2);
      if (middle !== null) {
        markers.push({
          id: "eta",
          kind: "label",
          position: shiftEast(middle, input.routeChipOffsetM ?? 700),
          chip: { title: copy.pinChipTitle(selected.distanceToDropoffM), size: "lg" },
          accessibilityLabel: copy.pinChip(selected.distanceToDropoffM),
        });
      }
    }
  }

  if (selected !== null && origin !== null && distanceMeters(origin, selected.location) >= MIN_WALK_PATH_M) {
    routes.push({ id: "walk", kind: "walk", points: [origin, selected.location] });
    const middle = pointAlong([origin, selected.location], distanceMeters(origin, selected.location) / 2);
    if (middle !== null) {
      markers.push({
        id: "walk",
        kind: "label",
        position: shiftEast(middle, input.walkChipOffsetM ?? 420),
        chip: { icon: "walk", title: copy.walkChip(selected.walkMinutes) },
        accessibilityLabel: copy.walk(selected.walkMinutes),
      });
    }
    focus.push(origin);
  }

  return { markers, routes, focus };
}

// ── Mapa sin propuestas (invitado o sin punto de partida) ───────────────────────────────────────────────────────────

/** Solo la ruta del conductor: la salida del coche, el recorrido y el destino. Para quien aún no puede ver puntos de recogida. */
export function buildRouteOnlyMap(geometry: readonly LngLat[]): PickupMapModel {
  const points = geometry.map(toPoint);
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return { markers: [], routes: [], focus: [] };
  const markers: MapMarkerSpec[] = [
    { id: "car", kind: "car", variant: "live", position: first, accessibilityLabel: "Salida del coche del conductor" },
  ];
  if (points.length > 1) markers.push({ id: "end", kind: "destination", position: last, accessibilityLabel: "Destino del viaje" });
  const routes: MapRouteSpec[] = points.length > 1 ? [{ id: "route", kind: "route", points }] : [];
  return { markers, routes, focus: points.length > 1 ? [first, last] : [first] };
}

// ── Problemas de ubicación ──────────────────────────────────────────────────────────────────────────────────────────

export interface LocationProblem {
  title: string;
  message: string;
  /** El arreglo está en los ajustes del móvil (no basta con volver a pulsar). */
  settings: boolean;
}

/** Texto para quien no se ha podido localizar. Nunca culpa: siempre queda la salida de buscar el lugar a mano. */
export function locationProblem(status: OriginStatus): LocationProblem | null {
  switch (status) {
    case "denied":
      return { title: copy.locationDeniedTitle, message: copy.locationDeniedMessage, settings: false };
    case "blocked":
      return { title: copy.locationDeniedTitle, message: copy.locationBlockedMessage, settings: true };
    case "off":
      return { title: copy.locationDeniedTitle, message: copy.locationOffMessage, settings: true };
    case "unavailable":
      return { title: copy.locationDeniedTitle, message: copy.locationUnavailableMessage, settings: false };
    default:
      return null;
  }
}
