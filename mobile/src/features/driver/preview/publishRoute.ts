/**
 * «Calcular ruta» y «Guardar ruta» (pantallas 18 y 19) en el servidor simulado.
 *
 *   POST /v1/me/routes/plan   plan sin efectos: provincia POR PARADA, ruta, horas de paso y desvío de las paradas opcionales
 *   POST /v1/me/routes        publica (Idempotency-Key obligatoria): recalcula todo, pasa la puerta de publicación y crea el
 *                             viaje o la serie con sus ocurrencias de los próximos 28 días
 *
 * Porta `docs/contracts/trips.md` §10.2–10.3. Nunca confía en un plan previo: «Guardar» vuelve a calcularlo. Un punto fuera
 * de la provincia NO es un error del plan (es un `verdict` por parada con 200); sí lo es al guardar
 * (`422 ROUTE_POINT_OUTSIDE_PROVINCE`). La ruta la calcula el proveedor SIMULADO: no es una ruta real por carretera.
 *
 * SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`).
 */
import type {
  PlannedStop,
  PlanIssue,
  PublishRouteBody,
  PublishRouteResponse,
  RoutePlaceInput,
  RoutePlanBody,
  RoutePlanResponse,
  Weekday,
} from "@/api/types";
import {
  ApiFailure,
  PLACES,
  addDaysToDate,
  computeProvinceCompliantSegmentPlan,
  computeRoutes,
  haversineM,
  insertTripWithPlan,
  isoWeekdayOf,
  isoReq,
  reply,
  labelForPoint,
  madridDate,
  madridDateTimeMs,
  pointCoveredByProvince,
  requireProvince,
  writeAudit,
  type JsonSchema,
  type PreviewDb,
  type PreviewRouter,
  type Principal,
} from "@/preview";
import { WEEKDAY_ORDER, WORKDAYS, tripMetaTable } from "@/features/search/preview/browseMeta";
import { materializeTrip } from "@/features/search/preview/requestWeekly";
import { assertDriverReady, requireDriver } from "./publishReadiness";

const MAX_STOPS = 10;
const MIN_ROUTE_M = 300;
const HORIZON_DAYS = 28;
const MAX_ADVANCE_DAYS = 90;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const point = (p: RoutePlaceInput): { latitude: number; longitude: number } => ({ latitude: p.lat, longitude: p.lng });
const labelOf = (p: RoutePlaceInput): string => (p.label?.trim() ? p.label.trim() : labelForPoint(point(p)));

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
function hhmmOf(totalMinutes: number): string {
  const n = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

/** Sitios DENTRO de la provincia más cercanos a un punto fuera de ella (geocodificación acotada de la vista previa). */
function alternativesFor(db: PreviewDb, provinceId: string, from: RoutePlaceInput) {
  const province = requireProvince(db, provinceId);
  return PLACES.filter((p) => (p.kind === "municipio" || p.kind === "ciudad") && pointCoveredByProvince(province, { latitude: p.lat, longitude: p.lng }))
    .map((p) => ({ p, d: haversineM(point(from), { latitude: p.lat, longitude: p.lng }) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map(({ p }) => ({ label: p.name, location: { lat: p.lat, lng: p.lng } }));
}

function validatePoints(body: { origin: RoutePlaceInput; destination: RoutePlaceInput; stops?: RoutePlaceInput[] | undefined }): RoutePlaceInput[] {
  const stops = body.stops ?? [];
  if (stops.length > MAX_STOPS) throw new ApiFailure("TOO_MANY_STOPS", `Una ruta admite como máximo ${MAX_STOPS} paradas intermedias.`, 422);
  if (stops.length === 0 && haversineM(point(body.origin), point(body.destination)) < MIN_ROUTE_M) {
    throw new ApiFailure("ROUTE_TOO_SHORT", "El origen y el destino están casi en el mismo sitio.", 422);
  }
  return [body.origin, ...stops, body.destination];
}

export function planRoute(db: PreviewDb, principal: Principal, body: RoutePlanBody): RoutePlanResponse {
  requireDriver(principal, "Necesitas el rol de conductor para planificar rutas.");
  const province = requireProvince(db, body.provinceId);
  const points = validatePoints(body);
  const computedAt = isoReq(db.nowMs());
  const departureMin = body.departureLocal !== undefined && TIME_RE.test(body.departureLocal) ? minutesOf(body.departureLocal) : null;

  const base: PlannedStop[] = points.map((p, index) => {
    const inProvince = pointCoveredByProvince(province, point(p));
    return {
      index,
      kind: index === 0 ? "origin" : index === points.length - 1 ? "destination" : "stop",
      label: labelOf(p),
      location: { lat: p.lat, lng: p.lng },
      optional: index > 0 && index < points.length - 1 && p.optional === true,
      inProvince,
      verdict: inProvince ? "ok" : "outside_province",
      message: inProvince ? null : `Esta parada no está en la provincia de ${province.name}.`,
      etaLocal: null,
      offsetMinutes: null,
      detourMinutes: null,
      alternatives: inProvince ? [] : alternativesFor(db, province.id, p),
    };
  });

  const outside = base.filter((s) => !s.inProvince);
  if (outside.length > 0) {
    return {
      provinceId: province.id,
      provinceName: province.name,
      canSave: false,
      headline: null,
      blockingMessage: "Corrige los puntos fuera de la provincia para guardar.",
      issues: outside.map((s) => ({
        code: "STOP_OUTSIDE_PROVINCE",
        severity: "error",
        stopIndex: s.index,
        message: `${s.label ?? "Esta parada"} está fuera de la provincia de ${province.name}.`,
      })),
      stops: base,
      route: null,
      computedAt,
    };
  }

  try {
    const plan = computeProvinceCompliantSegmentPlan(db, {
      provinceId: province.id,
      origin: point(body.origin),
      destination: point(body.destination),
      ...(body.stops && body.stops.length > 0 ? { intermediates: body.stops.map(point) } : {}),
      ...(departureMin !== null ? { departureTime: new Date(db.nowMs()).toISOString() } : {}),
    });
    let offset = 0;
    const stops = base.map((stop, index): PlannedStop => {
      if (index > 0) offset += (plan.segments[index - 1]?.durationSeconds ?? 0) / 60;
      let detour: number | null = null;
      if (stop.optional) {
        const prev = points[index - 1];
        const next = points[index + 1];
        if (prev && next) {
          const direct = computeRoutes({ origin: point(prev), destination: point(next), alternatives: false })[0]?.durationSeconds ?? 0;
          const via = (plan.segments[index - 1]?.durationSeconds ?? 0) + (plan.segments[index]?.durationSeconds ?? 0);
          detour = Math.max(1, Math.round((via - direct) / 60));
        }
      }
      return {
        ...stop,
        etaLocal: departureMin === null ? null : hhmmOf(departureMin + offset),
        offsetMinutes: Math.round(offset),
        detourMinutes: detour,
      };
    });
    return {
      provinceId: province.id,
      provinceName: province.name,
      canSave: true,
      headline: `Toda la ruta está dentro de la provincia de ${province.name}.`,
      blockingMessage: null,
      issues: [],
      stops,
      route: {
        distanceM: Math.round(plan.route.distanceMeters),
        durationMinutes: Math.max(1, Math.round(plan.route.durationSeconds / 60)),
        geometry: { type: "LineString", coordinates: plan.route.geometry.coordinates },
        provider: plan.route.provider,
        providerRef: plan.route.providerRef,
      },
      computedAt,
    };
  } catch (error) {
    if (error instanceof ApiFailure && error.code === "NO_ROUTE_WITHIN_PROVINCE") {
      const issue: PlanIssue = { code: "ROUTE_LEAVES_PROVINCE", severity: "error", stopIndex: null, message: `Ninguna ruta por carretera se queda dentro de la provincia de ${province.name}.` };
      return {
        provinceId: province.id,
        provinceName: province.name,
        canSave: false,
        headline: null,
        blockingMessage: "Corrige los puntos fuera de la provincia para guardar.",
        issues: [issue],
        stops: base,
        route: null,
        computedAt,
      };
    }
    throw error;
  }
}

function nextWorkday(from: string): string {
  let date = from;
  while (isoWeekdayOf(date) > 5) date = addDaysToDate(date, 1);
  return date;
}

export function publishRoute(db: PreviewDb, principal: Principal, body: PublishRouteBody, requestId?: string): PublishRouteResponse {
  requireDriver(principal, "Necesitas el rol de conductor para publicar rutas.");
  const vehicle = db.vehicles.get(body.vehicleId);
  if (!vehicle) throw new ApiFailure("VEHICLE_NOT_FOUND", "El vehículo no existe.", 404);
  if (vehicle.driver_user_id !== principal.userId) throw new ApiFailure("VEHICLE_NOT_OWNED", "Ese vehículo no es tuyo.", 403);
  assertDriverReady(db, principal.userId, vehicle.id);
  if (!Number.isInteger(body.seats) || body.seats < 1) throw new ApiFailure("INVALID_OFFERED_SEATS", "Las plazas deben ser al menos 1.", 422);
  if (body.seats > vehicle.passenger_seats) throw new ApiFailure("OFFERED_SEATS_EXCEED_VEHICLE", "Ofreces más plazas de las que tiene tu vehículo.", 422);
  if (!TIME_RE.test(body.outboundLocal) || (body.returnLocal !== undefined && body.returnLocal !== null && !TIME_RE.test(body.returnLocal))) {
    throw new ApiFailure("INVALID_TIME", "La hora no es válida.", 422);
  }

  const today = madridDate(db.nowMs());
  const oneOff = body.frequency === "one_off";
  if (oneOff && body.startDate === undefined) throw new ApiFailure("ONE_OFF_DATE_REQUIRED", "Un viaje puntual necesita su fecha.", 422);
  if (oneOff && body.endDate !== undefined && body.endDate !== null) throw new ApiFailure("INVALID_DATE_RANGE", "Un viaje puntual no tiene fecha de fin.", 422);
  const startDate = body.startDate ?? nextWorkday(today);
  if (!DATE_RE.test(startDate) || (body.endDate !== undefined && body.endDate !== null && !DATE_RE.test(body.endDate))) {
    throw new ApiFailure("INVALID_DATE_RANGE", "Las fechas no son válidas.", 422);
  }
  if (startDate < today) throw new ApiFailure("PUBLISH_START_DATE_IN_PAST", "La fecha de inicio ya ha pasado.", 422);
  if (startDate > addDaysToDate(today, MAX_ADVANCE_DAYS)) throw new ApiFailure("INVALID_DATE_RANGE", `Solo se puede publicar con ${MAX_ADVANCE_DAYS} días de antelación como máximo.`, 422);
  if (body.endDate !== undefined && body.endDate !== null && body.endDate < startDate) throw new ApiFailure("INVALID_DATE_RANGE", "El fin no puede ser anterior al inicio.", 422);
  const weekdays: Weekday[] = oneOff ? [] : [...new Set(body.weekdays && body.weekdays.length > 0 ? body.weekdays : WORKDAYS)].sort((a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b));
  if (!oneOff && weekdays.length === 0) throw new ApiFailure("INVALID_DATE_RANGE", "Elige al menos un día.", 422);

  const points = validatePoints(body);
  const returnLocal = body.returnLocal ?? null;
  const maxDetourMinutes = Math.max(0, Math.min(30, Math.round(body.maxDetourMinutes)));

  // Ida y, de forma independiente, vuelta (otro sentido, otra hora): las dos dentro de la provincia o no se publica nada.
  const common = { provinceId: body.provinceId } as const;
  const outPlan = computeProvinceCompliantSegmentPlan(db, {
    ...common,
    origin: point(body.origin),
    destination: point(body.destination),
    ...(body.stops && body.stops.length > 0 ? { intermediates: body.stops.map(point) } : {}),
  });
  if (returnLocal !== null) {
    computeProvinceCompliantSegmentPlan(db, {
      ...common,
      origin: point(body.destination),
      destination: point(body.origin),
      ...(body.stops && body.stops.length > 0 ? { intermediates: [...body.stops].reverse().map(point) } : {}),
    });
  }

  const dates: string[] = [];
  if (oneOff) dates.push(startDate);
  else {
    const horizon = addDaysToDate(today, HORIZON_DAYS - 1);
    const last = body.endDate !== undefined && body.endDate !== null && body.endDate < horizon ? body.endDate : horizon;
    for (let date = startDate; date <= last; date = addDaysToDate(date, 1)) {
      if (weekdays.includes(WEEKDAY_ORDER[isoWeekdayOf(date) - 1] as Weekday)) dates.push(date);
    }
  }
  const usable = dates.filter((date) => madridDateTimeMs(date, body.outboundLocal) > db.nowMs());
  if (usable.length === 0) throw new ApiFailure("PUBLISH_START_DATE_IN_PAST", "Esa salida ya ha pasado.", 422);

  return db.tx(() => {
    const firstDate = usable[0] as string;
    const optionalStops = points
      .slice(1, -1)
      .map((p, i) => ({ p, seq: i + 1 }))
      .filter(({ p }) => p.optional === true)
      .map(({ seq }) => ({ seq, detourMinutes: Math.max(1, Math.min(maxDetourMinutes || 1, 3)) }));
    const anchor = insertTripWithPlan(
      db,
      {
        driverUserId: principal.userId,
        vehicleId: vehicle.id,
        provinceId: body.provinceId,
        category: body.category,
        leg: "outbound",
        departureAtMs: madridDateTimeMs(firstDate, body.outboundLocal),
        flexibilityMinutes: body.flexibilityMinutes ?? 0,
        maxDetourM: maxDetourMinutes * 500,
        offeredSeats: body.seats,
        origin: point(body.origin),
        destination: point(body.destination),
        ...(body.stops && body.stops.length > 0 ? { intermediates: body.stops.map(point) } : {}),
        status: "published",
        stopLabels: points.map(labelOf),
      },
      outPlan,
    );
    const seriesId = oneOff ? null : db.ids.uuid();
    if (!oneOff) db.trips.update(anchor.id, { kind: "recurring" });
    const meta = {
      id: anchor.id,
      seriesId,
      weekdays: oneOff ? null : weekdays,
      returnLocal,
      pickupOnRoute: body.pickupOnRoute,
      maxDetourMinutes,
      optionalStops,
    };
    tripMetaTable(db).put(meta);

    const created: PublishRouteResponse["trips"] = [];
    let count = 0;
    for (const date of usable) {
      const out = materializeTrip(db, db.trips.get(anchor.id) ?? anchor, meta, date, "outbound", body.outboundLocal);
      count += 1;
      if (created.length < 2 && date === firstDate) created.push({ id: out.id, leg: "outbound", departureAt: isoReq(out.departure_at ?? 0), status: out.status });
      if (returnLocal !== null && madridDateTimeMs(date, returnLocal) > db.nowMs()) {
        const back = materializeTrip(db, db.trips.get(anchor.id) ?? anchor, meta, date, "return", returnLocal);
        count += 1;
        if (date === firstDate) created.push({ id: back.id, leg: "return", departureAt: isoReq(back.departure_at ?? 0), status: back.status });
      }
    }
    writeAudit(db, {
      actorUserId: principal.userId,
      action: "route.published",
      entityType: seriesId === null ? "trip" : "trip_series",
      entityId: seriesId ?? anchor.id,
      ...(requestId !== undefined ? { requestId } : {}),
      metadata: { distanceM: Math.round(outPlan.route.distanceMeters), occurrences: count, frequency: body.frequency },
    });
    return {
      seriesId,
      frequency: body.frequency,
      trips: created,
      occurrencesCreated: count,
      horizonUntil: oneOff ? null : (usable[usable.length - 1] as string),
      route: {
        distanceM: Math.round(outPlan.route.distanceMeters),
        durationMinutes: Math.max(1, Math.round(outPlan.route.durationSeconds / 60)),
        geometry: { type: "LineString", coordinates: outPlan.route.geometry.coordinates },
        provider: outPlan.route.provider,
        providerRef: outPlan.route.providerRef,
      },
    };
  });
}

const placeSchema: JsonSchema = {
  type: "object",
  required: ["lat", "lng"],
  additionalProperties: false,
  properties: {
    lat: { type: "number", minimum: -90, maximum: 90 },
    lng: { type: "number", minimum: -180, maximum: 180 },
    label: { type: "string", maxLength: 120 },
    optional: { type: "boolean" },
  },
};

const planSchema: JsonSchema = {
  type: "object",
  required: ["provinceId", "origin", "destination"],
  additionalProperties: false,
  properties: {
    provinceId: { type: "string", format: "uuid" },
    origin: placeSchema,
    destination: placeSchema,
    stops: { type: "array", items: placeSchema },
    departureLocal: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
  },
};

const publishSchema: JsonSchema = {
  type: "object",
  required: ["vehicleId", "provinceId", "category", "origin", "destination", "frequency", "outboundLocal", "seats", "maxDetourMinutes", "pickupOnRoute"],
  additionalProperties: false,
  properties: {
    vehicleId: { type: "string", format: "uuid" },
    provinceId: { type: "string", format: "uuid" },
    category: { type: "string", enum: ["work", "university", "fp_academies", "hospital", "sport", "other"] },
    origin: placeSchema,
    destination: placeSchema,
    stops: { type: "array", items: placeSchema },
    frequency: { type: "string", enum: ["daily_workdays", "one_off"] },
    outboundLocal: { type: "string" },
    returnLocal: { type: ["string", "null"] },
    startDate: { type: "string" },
    endDate: { type: ["string", "null"] },
    weekdays: { type: "array", items: { type: "string", enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] } },
    seats: { type: "integer", minimum: 1, maximum: 8 },
    maxDetourMinutes: { type: "integer", minimum: 0, maximum: 30 },
    pickupOnRoute: { type: "boolean" },
    flexibilityMinutes: { type: "integer", minimum: 0, maximum: 60 },
  },
};

export function registerRoutePublish(r: PreviewRouter, db: PreviewDb): void {
  r.post<{ Body: RoutePlanBody }>(
    "/v1/me/routes/plan",
    { summary: "Calcular ruta y validar la provincia por parada (pantallas 18–19)", tags: ["trips"], schema: { body: planSchema } },
    (req) => planRoute(db, req.auth(), req.body),
  );
  r.post<{ Body: PublishRouteBody }>(
    "/v1/me/routes",
    { summary: "Guardar y publicar la ruta (pantalla 19)", tags: ["trips"], idempotent: "required", schema: { body: publishSchema } },
    (req) => reply.created(publishRoute(db, req.auth(), req.body, req.requestId)),
  );
}
