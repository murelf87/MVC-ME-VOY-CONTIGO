import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { DomainError } from "../errors.js";
import type {
  GeoJsonLineString,
  LatLng,
  RouteCandidate,
  RouteComputationRequest,
  RouteProvider
} from "./types.js";

export type ProvinceRouteRequest = {
  provinceId: string;
  origin: LatLng;
  destination: LatLng;
  intermediates?: LatLng[];
  departureTime?: string;
};

async function pointCoveredByProvince(pool: Pool, provinceId: string, point: LatLng): Promise<boolean> {
  const result = await pool.query<{ covered: boolean }>(
    `select ST_CoveredBy(
       ST_SetSRID(ST_Point($2,$3),4326),
       p.geom
     ) as covered
       from provinces p
      where p.id=$1`,
    [provinceId, point.longitude, point.latitude]
  );
  if (!result.rowCount) throw new DomainError("PROVINCE_NOT_FOUND", "Province not found", 404);
  return result.rows[0]?.covered === true;
}

export async function routeCoveredByProvince(
  pool: Pool,
  provinceId: string,
  route: RouteCandidate
): Promise<boolean> {
  const result = await pool.query<{ covered: boolean; valid: boolean }>(
    `with route_geom as (
       select ST_SetSRID(ST_GeomFromGeoJSON($2),4326)::geometry(LineString,4326) as geom
     )
     select ST_CoveredBy(r.geom,p.geom) as covered,
            ST_IsValid(r.geom) as valid
       from provinces p cross join route_geom r
      where p.id=$1`,
    [provinceId, JSON.stringify(route.geometry)]
  );
  if (!result.rowCount) throw new DomainError("PROVINCE_NOT_FOUND", "Province not found", 404);
  return result.rows[0]?.covered === true && result.rows[0]?.valid === true;
}

async function assertAllPointsInsideProvince(
  pool: Pool,
  provinceId: string,
  points: LatLng[]
): Promise<void> {
  for (let index = 0; index < points.length; index += 1) {
    if (!await pointCoveredByProvince(pool, provinceId, points[index]!)) {
      throw new DomainError(
        "ROUTE_POINT_OUTSIDE_PROVINCE",
        "Origin, destination and every intermediate stop must be inside the selected province",
        422,
        { pointIndex: index }
      );
    }
  }
}

async function firstCompliantCandidate(
  pool: Pool,
  provinceId: string,
  candidates: RouteCandidate[]
): Promise<RouteCandidate | null> {
  for (const candidate of candidates) {
    if (await routeCoveredByProvince(pool, provinceId, candidate)) return candidate;
  }
  return null;
}

function combineSegmentRoutes(provider: string, segments: RouteCandidate[]): RouteCandidate {
  const coordinates: [number, number][] = [];
  for (const segment of segments) {
    for (const coordinate of segment.geometry.coordinates) {
      const previous = coordinates[coordinates.length - 1];
      if (!previous || previous[0] !== coordinate[0] || previous[1] !== coordinate[1]) {
        coordinates.push(coordinate);
      }
    }
  }
  if (coordinates.length < 2) {
    throw new DomainError("ROUTING_PROVIDER_BAD_RESPONSE", "Segmented route produced no usable geometry", 502);
  }

  const distanceMeters = segments.reduce((sum, segment) => sum + segment.distanceMeters, 0);
  const durationSeconds = segments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
  const geometry: GeoJsonLineString = { type: "LineString", coordinates };
  const providerRef = `${provider}-segments-sha256:${createHash("sha256")
    .update(JSON.stringify(segments.map(segment => segment.providerRef)))
    .digest("hex")}`;

  return {
    provider,
    providerRef,
    distanceMeters,
    durationSeconds,
    geometry,
    labels: ["PROVINCE_SEGMENTED_FALLBACK"]
  };
}

async function computeSegmentedFallback(
  pool: Pool,
  provider: RouteProvider,
  request: ProvinceRouteRequest
): Promise<RouteCandidate | null> {
  const points = [request.origin, ...(request.intermediates ?? []), request.destination];
  const selectedSegments: RouteCandidate[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const segmentRequest: RouteComputationRequest = {
      origin: points[index]!,
      destination: points[index + 1]!,
      alternatives: true,
      ...(request.departureTime ? { departureTime: request.departureTime } : {})
    };
    const candidates = await provider.computeRoutes(segmentRequest);
    const selected = await firstCompliantCandidate(pool, request.provinceId, candidates);
    if (!selected) return null;
    selectedSegments.push(selected);
  }

  const combined = combineSegmentRoutes(provider.name, selectedSegments);
  return await routeCoveredByProvince(pool, request.provinceId, combined) ? combined : null;
}

export async function computeProvinceCompliantRoute(
  pool: Pool,
  provider: RouteProvider,
  request: ProvinceRouteRequest
): Promise<RouteCandidate> {
  const intermediates = request.intermediates ?? [];
  await assertAllPointsInsideProvince(pool, request.provinceId, [
    request.origin,
    ...intermediates,
    request.destination
  ]);

  const directCandidates = await provider.computeRoutes({
    origin: request.origin,
    destination: request.destination,
    ...(intermediates.length ? { intermediates } : {}),
    ...(request.departureTime ? { departureTime: request.departureTime } : {}),
    alternatives: intermediates.length === 0
  });

  const direct = await firstCompliantCandidate(pool, request.provinceId, directCandidates);
  if (direct) return direct;

  // Google cannot return alternatives for a request containing intermediates.
  // Fall back to alternative candidates per leg so the whole route still obeys the province guard.
  if (intermediates.length) {
    const segmented = await computeSegmentedFallback(pool, provider, request);
    if (segmented) return segmented;
  }

  throw new DomainError(
    "NO_ROUTE_WITHIN_PROVINCE",
    "No provider route candidate remains entirely inside the selected province",
    422,
    { provider: provider.name, candidatesChecked: directCandidates.length }
  );
}
