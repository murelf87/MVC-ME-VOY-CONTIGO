/**
 * Geocodificador SIMULADO (equivale a `GoogleMapsProvider#geocodeAddress / reverseGeocode`). Busca en el
 * gazetteer de `data/places.ts`; no consulta ningún servicio externo.
 */
import { fold, PLACES, type Place } from "../data/places";
import { haversineM } from "../core/geo";
import type { GeoLatLng } from "../core/types";

export const GEOCODER_PROVIDER = "preview-sim";

export interface GeocodeResultDto {
  provider: string;
  placeId: string;
  formattedAddress: string;
  location: GeoLatLng;
  types: string[];
}

function typesFor(place: Place): string[] {
  switch (place.kind) {
    case "ciudad":
    case "municipio":
      return ["locality", "political"];
    case "barrio":
      return ["sublocality", "sublocality_level_1", "political"];
    case "poi":
      return ["establishment", "point_of_interest"];
    case "calle":
      return ["route"];
  }
}

export function formattedAddress(place: Place): string {
  switch (place.kind) {
    case "ciudad":
      return `${place.name}, España`;
    case "municipio":
      return `${place.name}, Sevilla, España`;
    case "barrio":
      return place.municipality === place.name
        ? `${place.name}, Sevilla, España`
        : `${place.name}, ${place.municipality}, Sevilla, España`;
    case "poi":
      return `${place.name}${place.address ? `, ${place.address}` : ""}, ${place.municipality}, España`;
    case "calle":
      return `${place.name}, ${place.municipality}, España`;
  }
}

function toResult(place: Place): GeocodeResultDto {
  return {
    provider: GEOCODER_PROVIDER,
    placeId: `preview-place:${place.id}`,
    formattedAddress: formattedAddress(place),
    location: { latitude: place.lat, longitude: place.lng },
    types: typesFor(place),
  };
}

function score(place: Place, query: string, tokens: readonly string[]): number {
  const names = [place.name, ...(place.aliases ?? [])].map(fold);
  let best = 0;
  for (const name of names) {
    if (name === query) best = Math.max(best, 100);
    else if (name.startsWith(query)) best = Math.max(best, 85);
    else if (name.includes(query)) best = Math.max(best, 65);
    else if (query.includes(name) && name.length >= 4) best = Math.max(best, 60);
  }
  if (best === 0 && tokens.length > 0) {
    const haystack = fold(`${place.name} ${place.municipality} ${(place.aliases ?? []).join(" ")} ${place.address ?? ""}`);
    const hits = tokens.filter((token) => token.length >= 3 && haystack.includes(token)).length;
    if (hits > 0) best = 30 + (40 * hits) / tokens.length;
  }
  if (best > 0 && query.includes(fold(place.municipality))) best += 5;
  return best;
}

const KIND_PRIORITY: Record<Place["kind"], number> = { ciudad: 0, municipio: 1, poi: 2, barrio: 3, calle: 4 };

export function geocodeAddress(address: string, limit = 5): GeocodeResultDto[] {
  const query = fold(address);
  if (!query) return [];
  const tokens = query.split(" ");
  return PLACES.map((place) => ({ place, score: score(place, query, tokens) }))
    .filter((entry) => entry.score >= 40)
    .sort((a, b) => b.score - a.score || KIND_PRIORITY[a.place.kind] - KIND_PRIORITY[b.place.kind])
    .slice(0, limit)
    .map((entry) => toResult(entry.place));
}

/** Lugar más cercano del gazetteer a un punto (dentro de `maxM` metros). */
export function nearestPlace(point: GeoLatLng, maxM = 1500, kinds?: readonly Place["kind"][]): Place | null {
  let best: { place: Place; d: number } | null = null;
  for (const place of PLACES) {
    if (kinds && !kinds.includes(place.kind)) continue;
    const d = haversineM(point, { latitude: place.lat, longitude: place.lng });
    if (d <= maxM && (!best || d < best.d)) best = { place, d };
  }
  return best?.place ?? null;
}

/** Nombre corto para etiquetar una parada: el lugar más cercano (barrio / municipio / POI) o «Punto en el mapa». */
export function labelForPoint(point: GeoLatLng): string {
  const near = nearestPlace(point, 900, ["poi", "barrio", "municipio", "ciudad"]);
  if (near) return near.name;
  const town = nearestPlace(point, 6000, ["municipio", "ciudad"]);
  return town ? town.name : "Punto en el mapa";
}

export function reverseGeocode(point: GeoLatLng): GeocodeResultDto[] {
  const street = nearestPlace(point, 700, ["calle", "poi"]);
  const area = street ?? nearestPlace(point, 6000, ["barrio", "municipio", "ciudad"]);
  const location = { latitude: Number(point.latitude.toFixed(5)), longitude: Number(point.longitude.toFixed(5)) };
  if (!area) return [];
  const label =
    area.kind === "calle" || area.kind === "poi"
      ? `${area.name}, ${area.municipality}, España`
      : formattedAddress(area);
  return [
    {
      provider: GEOCODER_PROVIDER,
      placeId: `preview-place:${area.id}`,
      formattedAddress: label,
      location,
      types: area.kind === "calle" || area.kind === "poi" ? ["street_address"] : typesFor(area),
    },
  ];
}
