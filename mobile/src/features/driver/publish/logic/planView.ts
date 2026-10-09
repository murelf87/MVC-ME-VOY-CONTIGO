/**
 * Del plan que devuelve el servidor a lo que pinta la pantalla 19: marcadores y trazado del mapa, y las paradas que
 * están fuera de la provincia. Funciones PURAS.
 */
import type { PlannedStop, RoutePlanResponse } from "@/api/types";
import { fitBounds, type MapMarkerSpec, type MapRegion, type MapRouteSpec } from "@/maps";

export const formatKm = (distanceM: number): string => `${(distanceM / 1000).toFixed(1).replace(".", ",")} km`;

const title = (stop: PlannedStop, number: number): string => `${number}. ${stop.label ?? "Parada"}`;

/**
 * Cámara que encuadra TODAS las paradas dentro del mapa (sin contar el ancho de las etiquetas: las etiquetas de la mitad
 * este se colocan a la izquierda de su punto y las de la oeste a la derecha, así caben sin alejar el mapa).
 */
export function regionOf(plan: RoutePlanResponse, viewport: { width: number; height: number }): MapRegion {
  return fitBounds(
    plan.stops.map((stop) => stop.location),
    { padding: { top: 78, bottom: 56, left: 44, right: 44 }, viewport, maxZoom: 14.5 },
  );
}

/** Marcadores numerados. El origen es el pin; las paradas, anillos; el destino, anillo final. Cada uno lleva su hora. */
export function markersOf(plan: RoutePlanResponse, tags: { origin: string; destination: string }): MapMarkerSpec[] {
  const lngs = plan.stops.map((stop) => stop.location.lng);
  const middle = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const span = Math.max(...lngs) - Math.min(...lngs);
  return plan.stops.map((stop, i): MapMarkerSpec => {
    const number = i + 1;
    const id = `stop-${stop.index}`;
    const outside = stop.verdict === "outside_province";
    const chip = {
      title: title(stop, number),
      ...(stop.kind === "origin" ? { subtitle: tags.origin } : stop.kind === "destination" ? { subtitle: tags.destination } : {}),
      ...(stop.etaLocal !== null ? { trailing: stop.etaLocal } : {}),
      handle: true,
      tone: outside ? ("danger" as const) : ("brand" as const),
      side: span > 0.012 && stop.location.lng > middle ? ("left" as const) : ("right" as const),
    };
    if (stop.kind === "origin") return { id, kind: "destination", position: stop.location, chip, tone: outside ? "warning" : "brand" };
    return { id, kind: "stop", position: stop.location, index: number, chip, ...(stop.kind === "destination" ? { end: true } : {}), ...(outside ? { tone: "warning" as const } : {}) };
  });
}

export function routesOf(plan: RoutePlanResponse): MapRouteSpec[] {
  if (plan.route === null) return [];
  return [{ id: "route", kind: "route", points: plan.route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })) }];
}

/** Paradas que el servidor marca como fuera de la provincia. */
export const outsideStops = (plan: RoutePlanResponse): PlannedStop[] => plan.stops.filter((stop) => stop.verdict === "outside_province");

/** Índice del punto (0 = origen) al que corresponde un marcador `stop-N`. */
export const indexOfMarker = (markerId: string): number | null => {
  const match = /^stop-(\d+)$/.exec(markerId);
  return match === null ? null : Number(match[1]);
};
