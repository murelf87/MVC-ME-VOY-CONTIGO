/**
 * Lógica pura del buscador de lugares (sin React ni red): etiquetas legibles a partir de la dirección que devuelve el
 * geocodificador, validación de lo que viaja entre pantallas, lugares recientes y textos de «fuera de provincia».
 */
import type { GeocodeResult } from "@/api/types";
import type { IconName } from "@/icons";
import type { PlaceParam } from "../../routes";
import { browseStrings } from "../strings";

/** Mínimo de caracteres que acepta `GET /v1/maps/geocode`. */
export const MIN_QUERY_LENGTH = 3;
/** Máximo de lugares recientes que se recuerdan. */
export const MAX_RECENT_PLACES = 6;

/** Quita espacios sobrantes y compacta los intermedios. */
export function normalizeQuery(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function canSearch(text: string): boolean {
  return normalizeQuery(text).length >= MIN_QUERY_LENGTH;
}

export interface PlaceDisplay {
  /** Nombre corto: «Universidad de Sevilla», «Calle Real, 12». */
  title: string;
  /** Resto de la dirección sin el país: «Av. Ramón y Cajal, Sevilla». */
  subtitle: string | null;
}

const COUNTRY_SEGMENTS = new Set(["españa", "spain"]);
/** «12», «12B», «12-14», «s/n», «nº 4». */
const STREET_NUMBER = /^(?:n\.?º\s*)?\d+[a-z]?(?:\s*-\s*\d+)?$|^s\/n$/i;

/**
 * Parte una dirección con el formato de Google («Universidad de Sevilla, C. San Fernando, 4, 41004 Sevilla, España»)
 * en un título corto y el resto. El número de portal se queda con la calle («Calle Real, 12»). Nunca devuelve un
 * título vacío: si no hay nada que mostrar usa el texto completo.
 */
export function describeAddress(formattedAddress: string): PlaceDisplay {
  const segments = formattedAddress
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && !COUNTRY_SEGMENTS.has(segment.toLowerCase()));
  const first = segments[0];
  if (first === undefined) return { title: normalizeQuery(formattedAddress), subtitle: null };
  let title = first;
  let rest = segments.slice(1);
  const second = rest[0];
  if (second !== undefined && STREET_NUMBER.test(second)) {
    title = `${first}, ${second}`;
    rest = rest.slice(1);
  }
  return { title, subtitle: rest.length > 0 ? rest.join(", ") : null };
}

/** Lugar listo para viajar entre pantallas (parámetros de navegación serializables). */
export function placeFromGeocode(result: GeocodeResult): PlaceParam {
  return {
    label: describeAddress(result.formattedAddress).title,
    latitude: result.location.latitude,
    longitude: result.location.longitude,
  };
}

/** Icono de la fila según los tipos de lugar del geocodificador. */
export function iconForPlaceTypes(types: readonly string[]): IconName {
  if (types.some((type) => type === "university" || type === "school" || type === "secondary_school")) return "school";
  if (types.some((type) => type === "hospital" || type === "doctor" || type === "health")) return "hospital";
  return "pin";
}

/** ¿Es un `PlaceParam` válido? (los parámetros de navegación llegan como `unknown`.) */
export function isPlaceParam(value: unknown): value is PlaceParam {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const { label, latitude, longitude } = candidate;
  return (
    typeof label === "string" &&
    label.trim().length > 0 &&
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

const EARTH_RADIUS_M = 6371008.8;

/** Distancia en metros entre dos lugares (haversine). */
export function placeDistanceMeters(a: Pick<PlaceParam, "latitude" | "longitude">, b: Pick<PlaceParam, "latitude" | "longitude">): number {
  const toRad = (degrees: number): number => (degrees * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Dos lugares son «el mismo» si están a menos de 60 m (origen = destino se valida con esta regla). */
export const SAME_PLACE_METERS = 60;

export function isSamePlace(a: PlaceParam, b: PlaceParam): boolean {
  return placeDistanceMeters(a, b) < SAME_PLACE_METERS;
}

/** Añade `place` al principio de los recientes sin repetirlo y sin pasar del máximo. */
export function rememberPlace(recent: readonly PlaceParam[], place: PlaceParam, max: number = MAX_RECENT_PLACES): PlaceParam[] {
  const others = recent.filter((entry) => !isSamePlace(entry, place));
  return [place, ...others].slice(0, max);
}

/** Lee lo guardado en el almacén (puede estar corrupto o venir de otra versión): descarta lo que no sea válido. */
export function parseRecentPlaces(raw: unknown): PlaceParam[] {
  if (!Array.isArray(raw)) return [];
  const places: PlaceParam[] = [];
  for (const entry of raw) {
    if (isPlaceParam(entry)) {
      places.push({ label: entry.label, latitude: entry.latitude, longitude: entry.longitude });
    }
    if (places.length >= MAX_RECENT_PLACES) break;
  }
  return places;
}

export type PlaceField = "origin" | "destination" | "place";

export interface OutsideProvinceCopy {
  title: string;
  message: string;
}

/** Texto de «fuera de provincia» según el campo (literales de la lámina 36a: «Destino fuera de provincia»). */
export function outsideProvinceCopy(field: PlaceField, provinceName: string | null): OutsideProvinceCopy {
  const copy = browseStrings.place;
  const title = field === "origin" ? copy.outsideOriginTitle : field === "destination" ? copy.outsideDestinationTitle : copy.outsideGenericTitle;
  const message = provinceName !== null && provinceName.trim().length > 0 ? copy.outsideMessage(provinceName) : copy.outsideMessageGeneric;
  return { title, message };
}

/** Título de la pantalla del buscador según el campo (o el que pasó quien la abre). */
export function placeSearchTitle(field: PlaceField, custom?: string): string {
  const copy = browseStrings.place;
  if (custom !== undefined && custom.trim().length > 0) return custom;
  if (field === "origin") return copy.titleOrigin;
  if (field === "destination") return copy.titleDestination;
  return copy.titleGeneric;
}

export function placeSearchPlaceholder(field: PlaceField): string {
  const copy = browseStrings.place;
  if (field === "origin") return copy.placeholderOrigin;
  if (field === "destination") return copy.placeholderDestination;
  return copy.placeholderGeneric;
}

/**
 * Destino al que vuelve el lugar elegido. Con `returnTo` es esa pantalla y ese parámetro; sin él, origen y destino
 * vuelven a `DefineRoute` con su propio nombre. El lugar genérico exige `returnTo`: sin él no hay a quién devolverlo.
 */
export function resolveReturnTarget(
  field: PlaceField,
  returnTo: { route: string; param: string } | undefined,
): { route: string; param: string } | null {
  if (returnTo !== undefined) return returnTo;
  if (field === "origin" || field === "destination") return { route: "DefineRoute", param: field };
  return null;
}
