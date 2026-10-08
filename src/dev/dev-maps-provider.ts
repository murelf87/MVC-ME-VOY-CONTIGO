import type {
  GeocodeResult,
  GeocodingProvider,
  LatLng,
  RouteCandidate,
  RouteComputationRequest,
  RouteProvider
} from "../maps/types.js";

/**
 * Development-only maps provider for running the app without a Google Maps key.
 * Geocoding uses a small fixed gazetteer with real coordinates; routing builds a
 * densified polyline between the requested points and estimates road distance
 * with a fixed detour factor. Results are labelled "dev_local_estimate" and the
 * provider is refused outside NODE_ENV=development, so it can never price or
 * validate a real trip.
 */
const PLACES: { name: string; province: string; location: LatLng }[] = [
  { name: "Sevilla, Plaza Nueva", province: "Sevilla", location: { latitude: 37.38863, longitude: -5.99534 } },
  { name: "Sevilla, Estación de Santa Justa", province: "Sevilla", location: { latitude: 37.39176, longitude: -5.97556 } },
  { name: "Sevilla, Hospital Virgen del Rocío", province: "Sevilla", location: { latitude: 37.36130, longitude: -5.98014 } },
  { name: "Sevilla, Universidad Pablo de Olavide", province: "Sevilla", location: { latitude: 37.35532, longitude: -5.93836 } },
  { name: "Palomares del Río", province: "Sevilla", location: { latitude: 37.32176, longitude: -6.05589 } },
  { name: "Dos Hermanas", province: "Sevilla", location: { latitude: 37.28287, longitude: -5.92088 } },
  { name: "Alcalá de Guadaíra", province: "Sevilla", location: { latitude: 37.33791, longitude: -5.83951 } },
  { name: "Mairena del Aljarafe", province: "Sevilla", location: { latitude: 37.34461, longitude: -6.06313 } },
  { name: "Coria del Río", province: "Sevilla", location: { latitude: 37.28788, longitude: -6.05407 } },
  { name: "Utrera", province: "Sevilla", location: { latitude: 37.18516, longitude: -5.78093 } },
  { name: "Carmona", province: "Sevilla", location: { latitude: 37.47125, longitude: -5.64618 } },
  { name: "Écija", province: "Sevilla", location: { latitude: 37.54193, longitude: -5.08262 } },
  { name: "Osuna", province: "Sevilla", location: { latitude: 37.23768, longitude: -5.10368 } },
  { name: "Lebrija", province: "Sevilla", location: { latitude: 36.92070, longitude: -6.07513 } }
];

const ROAD_FACTOR = 1.3;
const AVERAGE_SPEED_MPS = 70_000 / 3600;

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function haversineMeters(a: LatLng, b: LatLng): number {
  const r = 6_371_000;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

function toResult(place: (typeof PLACES)[number]): GeocodeResult {
  return {
    provider: "dev_local",
    placeId: `dev_local:${normalize(place.name).replace(/[^a-z0-9]+/g, "-")}`,
    formattedAddress: `${place.name} (${place.province})`,
    location: place.location,
    types: ["locality"]
  };
}

export class DevLocalMapsProvider implements RouteProvider, GeocodingProvider {
  readonly name = "dev_local";

  async geocodeAddress(address: string): Promise<GeocodeResult[]> {
    const query = normalize(address);
    return PLACES.filter(place => normalize(place.name).includes(query)).map(toResult);
  }

  async reverseGeocode(location: LatLng): Promise<GeocodeResult[]> {
    const nearest = [...PLACES].sort((a, b) =>
      haversineMeters(location, a.location) - haversineMeters(location, b.location))[0];
    return nearest ? [toResult(nearest)] : [];
  }

  async computeRoutes(request: RouteComputationRequest): Promise<RouteCandidate[]> {
    const points = [request.origin, ...(request.intermediates ?? []), request.destination];
    const coordinates: [number, number][] = [];
    let straight = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      straight += haversineMeters(a, b);
      const steps = 10;
      for (let s = i === 0 ? 0 : 1; s <= steps; s++) {
        const t = s / steps;
        coordinates.push([
          a.longitude + (b.longitude - a.longitude) * t,
          a.latitude + (b.latitude - a.latitude) * t
        ]);
      }
    }
    const distanceMeters = Math.round(straight * ROAD_FACTOR);
    return [{
      provider: "dev_local",
      providerRef: `dev_local:${coordinates.length}:${distanceMeters}`,
      distanceMeters,
      durationSeconds: Math.round(distanceMeters / AVERAGE_SPEED_MPS),
      geometry: { type: "LineString", coordinates },
      labels: ["dev_local_estimate"]
    }];
  }
}
