/**
 * Borrador de una ruta (pantallas 18 y 19): lo que la persona escribe antes de publicar. Funciones PURAS: validar el
 * formulario, construir los cuerpos de `POST /v1/me/routes/plan` y `POST /v1/me/routes`, y editar las paradas (añadir,
 * quitar, mover, cambiar). El servidor vuelve a validarlo todo al guardar: aquí solo se evita pedirle lo que seguro falla.
 */
import type { IsoDate, LocalTime, PublishFrequency, PublishRouteBody, RoutePlaceInput, RoutePlanBody, TripCategory } from "@/api/types";
import { publishStrings } from "../strings";

const copy = publishStrings.routeForm.errors;

export const MAX_INTERMEDIATE_STOPS = 10;
export const DETOUR_OPTIONS: readonly number[] = [2, 5, 10, 15];
export const DEFAULT_DETOUR_MINUTES = 5;

export interface DraftPlace {
  label: string;
  lat: number;
  lng: number;
  /** Solo paradas intermedias: «opcional» (solo se usa si alguien la pide). */
  optional?: boolean;
}

export interface RouteDraft {
  id: string;
  origin: DraftPlace | null;
  destination: DraftPlace | null;
  stops: DraftPlace[];
  category: TripCategory;
  frequency: PublishFrequency;
  /** Solo `one_off`. */
  date: IsoDate | null;
  outboundLocal: LocalTime | null;
  returnLocal: LocalTime | null;
  seats: number;
  maxDetourMinutes: number;
  pickupOnRoute: boolean;
}

export function emptyDraft(id: string, seats: number): RouteDraft {
  return {
    id,
    origin: null,
    destination: null,
    stops: [],
    category: "work",
    frequency: "daily_workdays",
    date: null,
    outboundLocal: null,
    returnLocal: null,
    seats: Math.max(1, seats),
    maxDetourMinutes: DEFAULT_DETOUR_MINUTES,
    pickupOnRoute: true,
  };
}

/** «Sevilla (Trabajo)» → «Sevilla»; «Av. de la Palmera, Sevilla» → «Av. de la Palmera». */
export function shortPlaceName(label: string | null | undefined): string {
  if (!label) return "";
  return label.replace(/\s*\(.*?\)\s*/g, " ").split(",")[0]?.trim() ?? "";
}

const cleanLabel = (label: string): string => label.replace(/\s+/g, " ").trim();

export const toInput = (place: DraftPlace): RoutePlaceInput => ({
  lat: place.lat,
  lng: place.lng,
  label: cleanLabel(place.label),
  ...(place.optional === true ? { optional: true } : {}),
});

export type RouteFormErrors = Partial<Record<"origin" | "destination" | "outbound" | "date" | "seats" | "return", string>>;

const minutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

const sameSpot = (a: DraftPlace, b: DraftPlace): boolean => Math.abs(a.lat - b.lat) < 0.0004 && Math.abs(a.lng - b.lng) < 0.0004;

export function validateRouteForm(draft: RouteDraft, vehicleSeats: number | null): RouteFormErrors {
  const errors: RouteFormErrors = {};
  if (draft.origin === null) errors.origin = copy.origin;
  if (draft.destination === null) errors.destination = copy.destination;
  if (draft.origin !== null && draft.destination !== null && draft.stops.length === 0 && sameSpot(draft.origin, draft.destination)) {
    errors.destination = copy.same;
  }
  if (draft.outboundLocal === null) errors.outbound = copy.outbound;
  if (draft.frequency === "one_off" && draft.date === null) errors.date = copy.date;
  if (!Number.isInteger(draft.seats) || draft.seats < 1 || (vehicleSeats !== null && draft.seats > vehicleSeats)) errors.seats = copy.seats;
  if (draft.outboundLocal !== null && draft.returnLocal !== null && minutes(draft.returnLocal) <= minutes(draft.outboundLocal)) {
    errors.return = copy.returnBeforeOutbound;
  }
  return errors;
}

export const hasErrors = (errors: RouteFormErrors): boolean => Object.keys(errors).length > 0;

/** Cuerpo del plan (sin efectos). Solo existe cuando hay origen y destino. */
export function planBody(draft: RouteDraft, provinceId: string): RoutePlanBody | null {
  if (draft.origin === null || draft.destination === null) return null;
  return {
    provinceId,
    origin: toInput(draft.origin),
    destination: toInput(draft.destination),
    ...(draft.stops.length > 0 ? { stops: draft.stops.map(toInput) } : {}),
    ...(draft.outboundLocal !== null ? { departureLocal: draft.outboundLocal } : {}),
  };
}

export function publishBody(draft: RouteDraft, vehicleId: string, provinceId: string): PublishRouteBody | null {
  if (draft.origin === null || draft.destination === null || draft.outboundLocal === null) return null;
  return {
    vehicleId,
    provinceId,
    category: draft.category,
    origin: toInput(draft.origin),
    destination: toInput(draft.destination),
    ...(draft.stops.length > 0 ? { stops: draft.stops.map(toInput) } : {}),
    frequency: draft.frequency,
    outboundLocal: draft.outboundLocal,
    ...(draft.returnLocal !== null ? { returnLocal: draft.returnLocal } : {}),
    ...(draft.frequency === "one_off" && draft.date !== null ? { startDate: draft.date } : {}),
    seats: draft.seats,
    maxDetourMinutes: draft.maxDetourMinutes,
    pickupOnRoute: draft.pickupOnRoute,
  };
}

// ── Edición de paradas (pantalla 19) ────────────────────────────────────────────────────────────────────────────────

export function canAddStop(draft: RouteDraft): boolean {
  return draft.stops.length < MAX_INTERMEDIATE_STOPS;
}

/** Nueva parada justo antes del destino. */
export function addStop(draft: RouteDraft, place: DraftPlace): RouteDraft {
  if (!canAddStop(draft)) return draft;
  return { ...draft, stops: [...draft.stops, { label: place.label, lat: place.lat, lng: place.lng }] };
}

export function removeStop(draft: RouteDraft, stopIndex: number): RouteDraft {
  return { ...draft, stops: draft.stops.filter((_, i) => i !== stopIndex) };
}

/** Mueve una parada intermedia `delta` posiciones (−1 sube, +1 baja). Los extremos (origen/destino) no se mueven. */
export function moveStop(draft: RouteDraft, stopIndex: number, delta: -1 | 1): RouteDraft {
  const target = stopIndex + delta;
  if (stopIndex < 0 || stopIndex >= draft.stops.length || target < 0 || target >= draft.stops.length) return draft;
  const stops = [...draft.stops];
  const [moved] = stops.splice(stopIndex, 1);
  if (moved === undefined) return draft;
  stops.splice(target, 0, moved);
  return { ...draft, stops };
}

/** Cambia el sitio de un punto: `pointIndex` 0 = origen, último = destino, el resto = paradas (conserva «opcional»). */
export function replacePoint(draft: RouteDraft, pointIndex: number, place: DraftPlace): RouteDraft {
  const last = draft.stops.length + 1;
  if (pointIndex === 0) return { ...draft, origin: { label: place.label, lat: place.lat, lng: place.lng } };
  if (pointIndex === last) return { ...draft, destination: { label: place.label, lat: place.lat, lng: place.lng } };
  const stops = draft.stops.map((stop, i) => (i === pointIndex - 1 ? { label: place.label, lat: place.lat, lng: place.lng, ...(stop.optional === true ? { optional: true } : {}) } : stop));
  return { ...draft, stops };
}

export function toggleOptional(draft: RouteDraft, stopIndex: number): RouteDraft {
  return { ...draft, stops: draft.stops.map((stop, i) => (i === stopIndex ? { ...stop, optional: stop.optional === true ? false : true } : stop)) };
}

/** Los puntos en orden: origen, paradas, destino (los que existan). */
export function pointsOf(draft: RouteDraft): DraftPlace[] {
  return [...(draft.origin ? [draft.origin] : []), ...draft.stops, ...(draft.destination ? [draft.destination] : [])];
}

/** Clave estable del plan: cambia solo si cambia algo que cambia la ruta (no el nombre de las paradas). */
export function planKey(draft: RouteDraft): string {
  const dot = (p: DraftPlace): string => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}${p.optional === true ? "!" : ""}`;
  return `${pointsOf(draft).map(dot).join("|")}@${draft.outboundLocal ?? ""}`;
}
