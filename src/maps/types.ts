export type LatLng = {
  latitude: number;
  longitude: number;
};

export type GeoJsonLineString = {
  type: "LineString";
  coordinates: [number, number][];
};

export type RouteCandidate = {
  provider: string;
  providerRef: string;
  distanceMeters: number;
  durationSeconds: number;
  geometry: GeoJsonLineString;
  labels: string[];
};

export type RouteComputationRequest = {
  origin: LatLng;
  destination: LatLng;
  intermediates?: LatLng[];
  departureTime?: string;
  alternatives: boolean;
};

export interface RouteProvider {
  readonly name: string;
  computeRoutes(request: RouteComputationRequest): Promise<RouteCandidate[]>;
}

export type GeocodeResult = {
  provider: string;
  placeId: string;
  formattedAddress: string;
  location: LatLng;
  types: string[];
};

export interface GeocodingProvider {
  readonly name: string;
  geocodeAddress(address: string): Promise<GeocodeResult[]>;
  reverseGeocode(location: LatLng): Promise<GeocodeResult[]>;
}
