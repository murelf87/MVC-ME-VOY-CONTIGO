import type { Pool } from "pg";
import { DomainError } from "../../errors.js";
import { computeProvinceCompliantSegmentPlan } from "../../maps/province-route-service.js";
import type { GeocodingProvider, LatLng, RouteCandidate, RouteProvider } from "../../maps/types.js";
import { haversineM, iso, localDateOf, madridLocalToUtc, addDays, type Db } from "./common.js";
import { err } from "./errors.js";
import { pointInProvince } from "./pickup-service.js";
import { LIMITS } from "./settings.js";
import type {
  GeoPoint, PlanIssue, PlannedRoute, PlannedStop, RoutePlaceInput, RoutePlanBody, RoutePlanResponse, RoutePlaceSuggestion
} from "./types.js";

export type PlannerDeps = {
  routeProvider: RouteProvider | null;
  geocodingProvider: GeocodingProvider | null;
};

/** Punto de la ruta ya normalizado (el origen siempre primero, el destino siempre último). */
export type PlanPoint = {
  kind: "origin" | "stop" | "destination";
  lat: number;
  lng: number;
  label: string | null;
  optional: boolean;
};

export type LegPlan = {
  points: PlanPoint[];
  route: RouteCandidate;
  segments: RouteCandidate[];
  /** Desvío (min) por punto; solo las paradas opcionales lo llevan. */
  detours: (number | null)[];
  /** Índices de paradas opcionales cuyo desvío no se pudo calcular (el proveedor falló). */
  detourFailures: number[];
};

const toLatLng = (point: { lat: number; lng: number }): LatLng => ({ latitude: point.lat, longitude: point.lng });

function cleanLabel(label: string | undefined): string | null {
  if (label === undefined) return null;
  const clean = label.trim().replace(/\s+/g, " ");
  return clean.length === 0 ? null : clean;
}

/** Normaliza origen, paradas y destino. `422 TOO_MANY_STOPS` si hay más de 10 paradas intermedias. */
export function pointsFromBody(body: { origin: RoutePlaceInput; destination: RoutePlaceInput; stops?: RoutePlaceInput[] | undefined }): PlanPoint[] {
  const stops = body.stops ?? [];
  if (stops.length > LIMITS.maxStops) {
    throw err("TOO_MANY_STOPS", 422, `Una ruta admite como máximo ${LIMITS.maxStops} paradas intermedias.`, { max: LIMITS.maxStops });
  }
  const points: PlanPoint[] = [
    { kind: "origin", lat: body.origin.lat, lng: body.origin.lng, label: cleanLabel(body.origin.label), optional: false },
    ...stops.map<PlanPoint>(stop => ({
      kind: "stop", lat: stop.lat, lng: stop.lng, label: cleanLabel(stop.label), optional: stop.optional === true
    })),
    { kind: "destination", lat: body.destination.lat, lng: body.destination.lng, label: cleanLabel(body.destination.label), optional: false }
  ];
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (points.length === 2 && haversineM(first, last) < 100) {
    throw err("ROUTE_TOO_SHORT", 422, "El origen y el destino están demasiado cerca para crear una ruta.");
  }
  return points;
}

export async function loadProvince(db: Db, provinceId: string): Promise<{ id: string; name: string }> {
  const found = await db.query<{ id: string; name: string }>(`select id, name from provinces where id = $1`, [provinceId]);
  const row = found.rows[0];
  if (!row) throw err("PROVINCE_NOT_FOUND", 404, "La provincia no existe.");
  return row;
}

/** Cada punto se comprueba INDIVIDUALMENTE contra el polígono de la provincia (`ST_CoveredBy`). */
export async function pointsInProvince(db: Db, provinceId: string, points: readonly PlanPoint[]): Promise<boolean[]> {
  const out: boolean[] = [];
  for (const point of points) out.push(await pointInProvince(db, provinceId, point));
  return out;
}

/** Próxima salida futura (Europe/Madrid) para una hora de reloj: hoy si aún no ha pasado, si no mañana. */
export function nextDepartureFor(localTime: string, now = new Date()): Date {
  const today = localDateOf(now);
  const candidate = madridLocalToUtc(today, localTime);
  return candidate.getTime() > now.getTime() + 60_000 ? candidate : madridLocalToUtc(addDays(today, 1), localTime);
}

/**
 * Ruta de UN sentido: tramo a tramo con alternativas (cada tramo debe quedar íntegramente dentro de la provincia) y,
 * para las paradas opcionales, el desvío frente a la ruta sin esa parada. Lanza errores de dominio en español.
 */
export async function computeLegPlan(
  pool: Pool,
  deps: PlannerDeps,
  provinceId: string,
  points: readonly PlanPoint[],
  departureAt: Date | null
): Promise<LegPlan> {
  const provider = deps.routeProvider;
  if (!provider) {
    throw err("MAPS_PROVIDER_UNAVAILABLE", 503, "El servicio de rutas no está disponible ahora mismo. Inténtalo más tarde.");
  }
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const middle = points.slice(1, -1);
  let planned: { route: RouteCandidate; segments: RouteCandidate[] };
  try {
    planned = await computeProvinceCompliantSegmentPlan(pool, provider, {
      provinceId,
      origin: toLatLng(first),
      destination: toLatLng(last),
      ...(middle.length > 0 ? { intermediates: middle.map(toLatLng) } : {}),
      ...(departureAt ? { departureTime: departureAt.toISOString() } : {})
    });
  } catch (error) {
    if (error instanceof DomainError) {
      if (error.code === "ROUTE_POINT_OUTSIDE_PROVINCE") {
        throw err("ROUTE_POINT_OUTSIDE_PROVINCE", 422, "Alguno de los puntos está fuera de la provincia.", error.details);
      }
      if (error.code === "NO_ROUTE_WITHIN_PROVINCE") {
        throw err("NO_ROUTE_WITHIN_PROVINCE", 422, "Ninguna ruta por carretera entre esos puntos se mantiene dentro de la provincia.", error.details);
      }
      if (error.code === "ROUTE_NOT_FOUND") {
        throw err("NO_ROUTE_WITHIN_PROVINCE", 422, "No se ha encontrado ruta por carretera entre esos puntos.", { reason: "ROUTE_NOT_FOUND" });
      }
    }
    throw error;
  }

  const detours: (number | null)[] = points.map(() => null);
  const detourFailures: number[] = [];
  const baseSeconds = planned.route.durationSeconds;
  for (let index = 1; index < points.length - 1; index += 1) {
    if (!points[index]!.optional) continue;
    const others = points.slice(1, -1).filter((_, i) => i + 1 !== index);
    try {
      const without = await provider.computeRoutes({
        origin: toLatLng(first),
        destination: toLatLng(last),
        ...(others.length > 0 ? { intermediates: others.map(toLatLng) } : {}),
        alternatives: false
      });
      const seconds = without[0]?.durationSeconds;
      if (seconds === undefined) throw new Error("no route");
      detours[index] = Math.max(0, Math.round((baseSeconds - seconds) / 60));
    } catch {
      detourFailures.push(index);
    }
  }
  return { points: [...points], route: planned.route, segments: planned.segments, detours, detourFailures };
}

/** Geometría para dibujar (≈9 m de tolerancia, 5 decimales). Nunca se usa para facturar ni para capacidad. */
export async function simplifyGeometry(db: Db, route: RouteCandidate): Promise<PlannedRoute["geometry"]> {
  try {
    const result = await db.query<{ geojson: string | null }>(
      `select ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), 0.00008), 5) as geojson`,
      [JSON.stringify(route.geometry)]
    );
    const raw = result.rows[0]?.geojson;
    if (raw) {
      const parsed = JSON.parse(raw) as { type: string; coordinates?: [number, number][] };
      if (parsed.type === "LineString" && parsed.coordinates && parsed.coordinates.length >= 2) {
        return { type: "LineString", coordinates: parsed.coordinates.map(c => [c[0], c[1]] as [number, number]) };
      }
    }
  } catch {
    // se devuelve la geometría original
  }
  return { type: "LineString", coordinates: route.geometry.coordinates };
}

export async function plannedRouteOf(db: Db, plan: LegPlan): Promise<PlannedRoute> {
  return {
    distanceM: Math.max(1, Math.round(plan.route.distanceMeters)),
    durationMinutes: Math.max(1, Math.round(plan.route.durationSeconds / 60)),
    geometry: await simplifyGeometry(db, plan.route),
    provider: plan.route.provider,
    providerRef: plan.route.providerRef
  };
}

function addMinutesToHhmm(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Alternativas dentro de la provincia para un punto que cae fuera (vacío si no hay geocodificador o no encuentra). */
async function alternativesFor(
  db: Db,
  geocoder: GeocodingProvider | null,
  provinceId: string,
  provinceName: string,
  point: PlanPoint
): Promise<RoutePlaceSuggestion[]> {
  if (!geocoder) return [];
  const base = (point.label ?? "").replace(/\(.*?\)/g, "").trim();
  const query = base.length >= 2 ? `${base}, ${provinceName}, España` : `${provinceName}, España`;
  try {
    const found = await geocoder.geocodeAddress(query);
    const out: RoutePlaceSuggestion[] = [];
    for (const result of found) {
      const location: GeoPoint = { lat: result.location.latitude, lng: result.location.longitude };
      if (out.some(item => haversineM(item.location, location) < 200)) continue;
      if (!(await pointInProvince(db, provinceId, location))) continue;
      const label = result.formattedAddress.split(",")[0]?.trim() || result.formattedAddress;
      out.push({ label, location });
      if (out.length >= 3) break;
    }
    return out;
  } catch {
    return [];
  }
}

const KIND_NOUN: Record<PlanPoint["kind"], string> = { origin: "El origen", stop: "Esta parada", destination: "El destino" };

/**
 * `POST /v1/me/routes/plan` — «Calcular ruta» y cada edición/reordenación de paradas (pantalla 19). Sin efectos.
 */
export async function planRoute(pool: Pool, deps: PlannerDeps, body: RoutePlanBody, now = new Date()): Promise<RoutePlanResponse> {
  const province = await loadProvince(pool, body.provinceId);
  const points = pointsFromBody(body);
  const inside = await pointsInProvince(pool, province.id, points);
  const issues: PlanIssue[] = [];
  const stops: PlannedStop[] = [];

  const base = (point: PlanPoint, index: number): PlannedStop => ({
    index,
    kind: point.kind,
    label: point.label,
    location: { lat: point.lat, lng: point.lng },
    optional: point.optional,
    inProvince: inside[index] === true,
    verdict: inside[index] === true ? "ok" : "outside_province",
    message: inside[index] === true ? null : `${KIND_NOUN[point.kind]} no está en la provincia de ${province.name}.`,
    etaLocal: null,
    offsetMinutes: null,
    detourMinutes: null,
    alternatives: []
  });

  if (inside.some(value => !value)) {
    for (const [index, point] of points.entries()) {
      const stop = base(point, index);
      if (!stop.inProvince) {
        stop.alternatives = await alternativesFor(pool, deps.geocodingProvider, province.id, province.name, point);
        issues.push({
          code: "STOP_OUTSIDE_PROVINCE",
          severity: "error",
          stopIndex: index,
          message: `${point.label ?? "Este punto"} está fuera de la provincia de ${province.name}.`
        });
      }
      stops.push(stop);
    }
    return {
      provinceId: province.id,
      provinceName: province.name,
      canSave: false,
      headline: null,
      blockingMessage: "Corrige los puntos fuera de la provincia para guardar.",
      issues,
      stops,
      route: null,
      computedAt: iso(now)
    };
  }

  const departure = body.departureLocal ? nextDepartureFor(body.departureLocal, now) : null;
  let leg: LegPlan;
  try {
    leg = await computeLegPlan(pool, deps, province.id, points, departure);
  } catch (error) {
    if (error instanceof DomainError && error.code === "NO_ROUTE_WITHIN_PROVINCE") {
      const notFound = (error.details as { reason?: string } | undefined)?.reason === "ROUTE_NOT_FOUND";
      issues.push(notFound
        ? { code: "ROUTE_PROVIDER_ERROR", severity: "error", stopIndex: null, message: "No hemos encontrado ruta por carretera entre esos puntos." }
        : {
            code: "ROUTE_LEAVES_PROVINCE", severity: "error", stopIndex: null,
            message: `La ruta por carretera sale de la provincia de ${province.name}. Cambia las paradas para que el recorrido se mantenga dentro.`
          });
      return {
        provinceId: province.id,
        provinceName: province.name,
        canSave: false,
        headline: null,
        blockingMessage: notFound
          ? "No hemos encontrado ruta por carretera entre esos puntos."
          : "La ruta sale de la provincia. Cambia las paradas para poder guardarla.",
        issues,
        stops: points.map((point, index) => base(point, index)),
        route: null,
        computedAt: iso(now)
      };
    }
    throw error;
  }

  let offsetS = 0;
  for (const [index, point] of points.entries()) {
    const stop = base(point, index);
    const offsetMinutes = Math.round(offsetS / 60);
    stop.offsetMinutes = offsetMinutes;
    stop.etaLocal = body.departureLocal ? addMinutesToHhmm(body.departureLocal, offsetMinutes) : null;
    stop.detourMinutes = leg.detours[index] ?? null;
    stops.push(stop);
    offsetS += leg.segments[index]?.durationSeconds ?? 0;
  }
  for (const index of leg.detourFailures) {
    issues.push({
      code: "ROUTE_PROVIDER_ERROR", severity: "warning", stopIndex: index,
      message: "No se ha podido calcular el desvío de esta parada opcional."
    });
  }
  return {
    provinceId: province.id,
    provinceName: province.name,
    canSave: true,
    headline: `Toda la ruta está dentro de la provincia de ${province.name}.`,
    blockingMessage: null,
    issues,
    stops,
    route: await plannedRouteOf(pool, leg),
    computedAt: iso(now)
  };
}
