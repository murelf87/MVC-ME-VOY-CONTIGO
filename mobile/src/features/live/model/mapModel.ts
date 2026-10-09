/**
 * Qué se dibuja en los mapas de «Esperando el coche» (21), «Cambio de ruta» (22) y «Viaje terminado» (24). Puro: devuelve
 * marcadores, trazos y puntos de encuadre para `MvcMap`; el componente solo los pasa.
 *
 * Reglas de privacidad del mapa (docs/MAPS.md y contrato live §0):
 *  - El coche NUNCA se dibuja con más precisión que la que da el servidor. Con `precision:"approximate"` se dibuja una ZONA
 *    (anillo de radio `accuracyM`) y una etiqueta, sin coche, sin rumbo y sin trayectoria.
 *  - Con señal vieja el coche se dibuja atenuado y con su antigüedad: nunca como «en directo».
 *  - No existe geometría de carretera entre el coche y la recogida: el tramo que los une es una línea discontinua de
 *    «aproximación», no una ruta calculada.
 */
import type { GeoPoint, LivePosition } from "@/api/types";
import type { MapChipSpec, MapMarkerSpec, MapPoint, MapRouteSpec } from "@/maps";
import { liveStrings } from "../strings";
import { formatAge } from "./time";
import type { SignalKind } from "./signal";

const copy = liveStrings.waiting;

export function toMapPoint(point: GeoPoint): MapPoint {
  return { lat: point.lat, lng: point.lng };
}

const METERS_PER_DEGREE_LAT = 111_320;

/** Anillo cerrado (primer punto = último) de `radiusM` metros alrededor de `center`. */
export function ringPoints(center: MapPoint, radiusM: number, segments = 48): MapPoint[] {
  const n = Math.max(8, Math.floor(segments));
  const radius = Math.max(0, radiusM);
  const dLat = radius / METERS_PER_DEGREE_LAT;
  const cos = Math.max(0.01, Math.cos((center.lat * Math.PI) / 180));
  const dLng = radius / (METERS_PER_DEGREE_LAT * cos);
  const points: MapPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const angle = (2 * Math.PI * i) / n;
    points.push({ lat: center.lat + dLat * Math.sin(angle), lng: center.lng + dLng * Math.cos(angle) });
  }
  const first = points[0];
  if (first !== undefined) points.push({ lat: first.lat, lng: first.lng });
  return points;
}

/** Los cuatro extremos de un círculo (para encuadrar la zona entera). */
export function ringExtremes(center: MapPoint, radiusM: number): MapPoint[] {
  const dLat = radiusM / METERS_PER_DEGREE_LAT;
  const dLng = radiusM / (METERS_PER_DEGREE_LAT * Math.max(0.01, Math.cos((center.lat * Math.PI) / 180)));
  return [
    { lat: center.lat + dLat, lng: center.lng },
    { lat: center.lat - dLat, lng: center.lng },
    { lat: center.lat, lng: center.lng + dLng },
    { lat: center.lat, lng: center.lng - dLng },
  ];
}

export type CarDrawMode = "precise" | "stale" | "zone" | "none";

export interface LiveMapInput {
  driverName: string;
  pickup: { label: string | null; location: GeoPoint };
  position: LivePosition | null;
  signalKind: SignalKind;
  /** Minutos hasta la recogida (para «llega en 8 min»). */
  etaMinutes: number | null;
  /** Antigüedad corregida de la última posición. */
  ageSeconds: number | null;
}

export interface LiveMapModel {
  markers: MapMarkerSpec[];
  routes: MapRouteSpec[];
  fit: MapPoint[];
  car: CarDrawMode;
}

export function carDrawMode(position: LivePosition | null, signalKind: SignalKind): CarDrawMode {
  if (position === null || signalKind === "none") return "none";
  if (position.precision === "approximate") return "zone";
  return signalKind === "stale" ? "stale" : "precise";
}

function pickupChip(label: string | null): MapChipSpec {
  return label === null || label === "" ? { title: copy.pickupChipTitle, side: "right" } : { title: copy.pickupChipTitle, subtitle: label, side: "right" };
}

export function liveMapModel(input: LiveMapInput): LiveMapModel {
  const pickup = toMapPoint(input.pickup.location);
  const markers: MapMarkerSpec[] = [];
  const routes: MapRouteSpec[] = [];
  const fit: MapPoint[] = [pickup];
  const mode = carDrawMode(input.position, input.signalKind);

  markers.push({ id: "pickup", kind: "destination", position: pickup, chip: pickupChip(input.pickup.label), zIndex: 20 });

  const position = input.position;
  if (position !== null && (mode === "precise" || mode === "stale")) {
    const car = toMapPoint(position.location);
    const chip: MapChipSpec =
      mode === "stale"
        ? { title: copy.carChipTitle(input.driverName), subtitle: formatAge(input.ageSeconds ?? position.ageSeconds), tone: "warning", subtitleTone: "warning", align: "center", side: "right" }
        : input.etaMinutes === null
          ? { title: copy.carChipTitle(input.driverName), align: "center", side: "right" }
          : { title: copy.carChipTitle(input.driverName), subtitle: copy.carChipArrives(input.etaMinutes), align: "center", side: "right" };
    markers.push({ id: "car", kind: "car", variant: "live", position: car, chip, zIndex: 30 });
    routes.push({ id: "approach", kind: "approach", points: [car, pickup] });
    fit.push(car);
  } else if (position !== null && mode === "zone") {
    const center = toMapPoint(position.location);
    const radius = position.accuracyM ?? 1000;
    routes.push({ id: "zone", kind: "alt", points: ringPoints(center, radius), width: 3 });
    markers.push({ id: "zone", kind: "label", position: center, chip: { title: copy.zoneLabel, tone: "muted", size: "sm", align: "center" }, zIndex: 25 });
    fit.push(...ringExtremes(center, radius));
  }

  return { markers, routes, fit, car: mode };
}

/**
 * Mapa de la vista pública de «Compartir viaje»: SOLO una zona aproximada (~1 km). Nunca coche, rumbo ni trayectoria, ni
 * recogida: el enlace no revela más de lo que el servidor ya redondeó.
 */
export function sharedMapModel(position: { location: GeoPoint } | null): LiveMapModel {
  if (position === null) return { markers: [], routes: [], fit: [], car: "none" };
  const center = toMapPoint(position.location);
  const radius = 1000;
  return {
    markers: [{ id: "zone", kind: "label", position: center, chip: { title: copy.zoneLabel, tone: "muted", size: "sm", align: "center" }, zIndex: 25 }],
    routes: [{ id: "zone", kind: "alt", points: ringPoints(center, radius), width: 3 }],
    fit: ringExtremes(center, radius),
    car: "zone",
  };
}
