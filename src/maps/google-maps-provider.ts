import { createHash } from "node:crypto";
import { DomainError } from "../errors.js";
import type {
  GeocodingProvider,
  GeocodeResult,
  GeoJsonLineString,
  LatLng,
  RouteCandidate,
  RouteComputationRequest,
  RouteProvider
} from "./types.js";

type FetchLike = typeof fetch;

type GoogleRoute = {
  distanceMeters?: number;
  duration?: string;
  polyline?: { geoJsonLinestring?: unknown };
  routeLabels?: string[];
};

type GoogleRoutesResponse = {
  routes?: GoogleRoute[];
  error?: { message?: string; status?: string };
};

type GoogleGeocodeItem = {
  placeId?: string;
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
};

type GoogleGeocodeResponse = {
  results?: GoogleGeocodeItem[];
  error?: { message?: string; status?: string };
};

function assertLatLng(value: LatLng): void {
  if (!Number.isFinite(value.latitude) || value.latitude < -90 || value.latitude > 90) {
    throw new DomainError("INVALID_LATITUDE", "Latitude must be between -90 and 90");
  }
  if (!Number.isFinite(value.longitude) || value.longitude < -180 || value.longitude > 180) {
    throw new DomainError("INVALID_LONGITUDE", "Longitude must be between -180 and 180");
  }
}

function parseDurationSeconds(value: string | undefined): number {
  if (!value || !/^\d+(?:\.\d+)?s$/.test(value)) {
    throw new DomainError("ROUTING_PROVIDER_BAD_RESPONSE", "Routing provider returned an invalid duration", 502);
  }
  const seconds = Number(value.slice(0, -1));
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new DomainError("ROUTING_PROVIDER_BAD_RESPONSE", "Routing provider returned an invalid duration", 502);
  }
  return Math.ceil(seconds);
}

function parseLineString(value: unknown): GeoJsonLineString {
  if (!value || typeof value !== "object") {
    throw new DomainError("ROUTING_PROVIDER_BAD_RESPONSE", "Routing provider returned no route geometry", 502);
  }
  const candidate = value as { type?: unknown; coordinates?: unknown };
  if (candidate.type !== "LineString" || !Array.isArray(candidate.coordinates) || candidate.coordinates.length < 2) {
    throw new DomainError("ROUTING_PROVIDER_BAD_RESPONSE", "Routing provider returned an invalid GeoJSON LineString", 502);
  }

  const coordinates: [number, number][] = candidate.coordinates.map((coordinate, index) => {
    if (!Array.isArray(coordinate) || coordinate.length < 2) {
      throw new DomainError("ROUTING_PROVIDER_BAD_RESPONSE", `Invalid route coordinate at index ${index}`, 502);
    }
    const longitude = coordinate[0];
    const latitude = coordinate[1];
    if (typeof longitude !== "number" || typeof latitude !== "number") {
      throw new DomainError("ROUTING_PROVIDER_BAD_RESPONSE", `Invalid route coordinate at index ${index}`, 502);
    }
    assertLatLng({ latitude, longitude });
    return [longitude, latitude];
  });

  return { type: "LineString", coordinates };
}

function providerRefForRoute(route: {
  distanceMeters: number;
  durationSeconds: number;
  geometry: GeoJsonLineString;
}): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(route))
    .digest("hex");
  return `google-routes-sha256:${hash}`;
}

function latLngBody(point: LatLng) {
  assertLatLng(point);
  return {
    location: {
      latLng: {
        latitude: point.latitude,
        longitude: point.longitude
      }
    }
  };
}

function parseGeocodeResult(item: GoogleGeocodeItem): GeocodeResult {
  const latitude = item.location?.latitude;
  const longitude = item.location?.longitude;
  if (
    typeof item.placeId !== "string" ||
    !item.placeId ||
    typeof item.formattedAddress !== "string" ||
    !item.formattedAddress ||
    typeof latitude !== "number" ||
    typeof longitude !== "number"
  ) {
    throw new DomainError("GEOCODING_PROVIDER_BAD_RESPONSE", "Geocoding provider returned an incomplete result", 502);
  }
  assertLatLng({ latitude, longitude });
  return {
    provider: "google",
    placeId: item.placeId,
    formattedAddress: item.formattedAddress,
    location: { latitude, longitude },
    types: Array.isArray(item.types) ? item.types.filter((value): value is string => typeof value === "string") : []
  };
}

export class GoogleMapsProvider implements RouteProvider, GeocodingProvider {
  readonly name = "google";

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch
  ) {
    if (!apiKey.trim()) throw new Error("Google Maps API key is required");
  }

  async computeRoutes(request: RouteComputationRequest): Promise<RouteCandidate[]> {
    assertLatLng(request.origin);
    assertLatLng(request.destination);
    const intermediates = request.intermediates ?? [];
    intermediates.forEach(assertLatLng);

    // Google alternative routes are only available when there are no intermediate waypoints.
    const computeAlternativeRoutes = request.alternatives && intermediates.length === 0;

    const body: Record<string, unknown> = {
      origin: latLngBody(request.origin),
      destination: latLngBody(request.destination),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      computeAlternativeRoutes,
      polylineEncoding: "GEO_JSON_LINESTRING",
      polylineQuality: "HIGH_QUALITY",
      languageCode: "es-ES",
      units: "METRIC"
    };
    if (intermediates.length) body.intermediates = intermediates.map(latLngBody);
    if (request.departureTime) body.departureTime = request.departureTime;

    const response = await this.fetchImpl(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.geoJsonLinestring,routes.routeLabels"
        },
        body: JSON.stringify(body)
      }
    );

    let data: GoogleRoutesResponse;
    try {
      data = await response.json() as GoogleRoutesResponse;
    } catch {
      throw new DomainError("ROUTING_PROVIDER_BAD_RESPONSE", "Routing provider returned invalid JSON", 502);
    }

    if (!response.ok) {
      if (response.status === 429) {
        throw new DomainError("ROUTING_PROVIDER_RATE_LIMITED", "Routing provider is temporarily rate limited", 429);
      }
      throw new DomainError(
        "ROUTING_PROVIDER_ERROR",
        "Routing provider returned an error",
        502,
        { provider: this.name, httpStatus: response.status, providerStatus: data.error?.status }
      );
    }

    const routes = data.routes ?? [];
    if (!routes.length) {
      throw new DomainError("ROUTE_NOT_FOUND", "No driving route was found", 404);
    }

    return routes.map(route => {
      if (!Number.isSafeInteger(route.distanceMeters) || (route.distanceMeters ?? 0) <= 0) {
        throw new DomainError("ROUTING_PROVIDER_BAD_RESPONSE", "Routing provider returned an invalid distance", 502);
      }
      const durationSeconds = parseDurationSeconds(route.duration);
      const geometry = parseLineString(route.polyline?.geoJsonLinestring);
      const normalized = {
        distanceMeters: route.distanceMeters!,
        durationSeconds,
        geometry
      };
      return {
        provider: this.name,
        providerRef: providerRefForRoute(normalized),
        ...normalized,
        labels: Array.isArray(route.routeLabels)
          ? route.routeLabels.filter((label): label is string => typeof label === "string")
          : []
      };
    });
  }

  async geocodeAddress(address: string): Promise<GeocodeResult[]> {
    const query = address.trim();
    if (query.length < 3 || query.length > 500) {
      throw new DomainError("INVALID_GEOCODE_QUERY", "Address must contain between 3 and 500 characters");
    }

    const url = new URL(`https://geocode.googleapis.com/v4/geocode/address/${encodeURIComponent(query)}`);
    url.searchParams.set("languageCode", "es");
    url.searchParams.set("regionCode", "es");

    return this.geocodeRequest(url);
  }

  async reverseGeocode(location: LatLng): Promise<GeocodeResult[]> {
    assertLatLng(location);
    const locationQuery = `${location.latitude},${location.longitude}`;
    const url = new URL(`https://geocode.googleapis.com/v4/geocode/location/${encodeURIComponent(locationQuery)}`);
    url.searchParams.set("languageCode", "es");
    url.searchParams.set("regionCode", "es");
    return this.geocodeRequest(url);
  }

  private async geocodeRequest(url: URL): Promise<GeocodeResult[]> {
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": this.apiKey,
        accept: "application/json"
      }
    });

    let data: GoogleGeocodeResponse;
    try {
      data = await response.json() as GoogleGeocodeResponse;
    } catch {
      throw new DomainError("GEOCODING_PROVIDER_BAD_RESPONSE", "Geocoding provider returned invalid JSON", 502);
    }

    if (!response.ok) {
      if (response.status === 429) {
        throw new DomainError("GEOCODING_PROVIDER_RATE_LIMITED", "Geocoding provider is temporarily rate limited", 429);
      }
      throw new DomainError(
        "GEOCODING_PROVIDER_ERROR",
        "Geocoding provider returned an error",
        502,
        { provider: this.name, httpStatus: response.status, providerStatus: data.error?.status }
      );
    }

    return (data.results ?? []).map(parseGeocodeResult);
  }
}
